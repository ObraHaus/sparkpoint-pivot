# Research — 028 Sparky Memory v2 (Platform-Activity Awareness)

All decisions below were verified against develop `3fa4382` by reading the code, not assumed.
No `NEEDS CLARIFICATION` markers remained in the spec; this file records the technical
resolutions the plan builds on.

## R1 — Owner identity: which address keys each source?

**Decision**: fold executions by `AccountContext.account`; fold vault flows, swaps, and the
faucet probe by `AccountContext.owner`.

**Rationale**: `executions.smart_account_address` is populated from `bundle.smart_account_address`
which originates as `account.account` (`execution/orchestrate.py:167`), while `onchain_events`
rows key on the on-chain `owner` and `swap_fee_events.from_address` is the swapping wallet.
Today the two identities are the SAME string for all web traffic — the BFF sets both `x-owner`
and `x-account` from the verified session address (`apps/web/src/app/api/agent/[...path]/route.ts:124-125`)
— but keying each source by the identity it actually records stays correct if a future
smart-account deployment makes them diverge (session-key userops record the smart account).
The chat turn's `AccountContext` carries both, so the fold needs no lookup.

**Alternatives considered**: fold everything by `owner` (wrong for future userop executions);
fold by both addresses on every source (extra queries for zero benefit today).

## R2 — Swap source: new store method needed

**Decision**: add `SwapFeeStore.list_for_swapper(network_id, from_address, after: (block, log) | None, limit)`
to `db/swap_fees.py` — a thin SELECT over `swap_fee_events` filtered by `from_address` and
`(block_number, log_index) > after`, ascending, LIMIT-bounded.

**Rationale**: the existing `fetch(network_id, since, until)` filters by time only (built for the
revenue dashboard) — filtering client-side would read every swap on the network. The table
already CHECK-constrains `from_address` to lowercase, so the query is a straight equality on the
lowered owner. Both networks (`base` — which on develop carries Base-Sepolia data — and the
Robinhood network id) are queried; network ids are read from the rows the indexer actually
writes rather than hardcoded assumptions (verified: `swap_fee_events.network_id` REFERENCES
`networks(id)`).

**Alternatives considered**: reuse `fetch` + client-side filter (unbounded read); index change
(unnecessary — `swap_fee_events_net_block_idx` plus the equality filter is fine at alpha scale).

## R3 — Faucet claims: fold-time probe, not an indexer

**Decision**: new `chain/faucet_probe.py` doing two keyless `eth_call`s — `nextClaimAt(owner)`
(selector from the deployed `SrkFaucet`) and `cooldown()` — against `BASE_SEPOLIA_RPC_URL`
with a **hard 3-second total budget**; `last_claim_ts = nextClaimAt − cooldown`; a claim folds
when `last_claim_ts > cursor.faucet`.

**Rationale**: the faucet's `Claimed` event is not indexed anywhere and standing up a new
indexer stream for a testnet convenience is disproportionate. The probe is one round-trip,
keyless (agent stays provably keyless — read-only `eth_call` via the existing `HttpxLogsRpc`
transport pattern used by `chain/srk_gate.py`), and self-limiting: only the most recent claim
is derivable, which the spec accepts (memory is a digest). The 3s budget is a deliberate
improvement over the 026 srk-gate's missing timeout (flagged in that PR's review); on timeout
the source is skipped silently for this fold — the cursor does not advance, so the claim is
picked up next turn.

**Alternatives considered**: extend the vault indexer to watch `Claimed` (new stream, cursor,
and deploy surface for marginal value); `getLogs` per user at fold time (Alchemy free-tier
10-block getLogs cap makes ranged log scans unreliable here — the documented reason the vault
indexer pins `VAULT_INDEX_RPC_URL`).

## R4 — Cursor placement and Clear semantics

**Decision**: one nullable JSONB column `user_memory.activity_cursor` (migration 0031);
`clear()` continues to wipe `lines` but **must not touch** `activity_cursor`.

**Rationale**: the cursor is per-user state with the same lifecycle as the memory row and the
row's upsert already exists; a sibling table would add a join for one column. Keeping the
cursor across Clear is what implements FR-009 (cleared activity never resurrects) with zero
extra machinery. `UndefinedColumnError` on read/write follows the exact 0028/0030 fallback
precedent in `db/conversations.py` / `db/user_memory.py`: warn once, degrade to memory v1.

**Alternatives considered**: separate `user_activity_cursors` table (join + second upsert for
nothing); resetting the cursor on Clear (violates FR-009 — months of history would flood back).

## R5 — Execution cursor must be two-part (the deferred-pending trap)

**Decision**: the executions sub-cursor is `{"ts": iso8601, "deferred": [ids...]}` — advance
`ts` to the newest row *seen*, and carry still-pending execution ids (bounded, ≤10) in
`deferred` so they fold once they reach a terminal state.

**Rationale**: a naive single timestamp cursor either (a) advances past a `submitted` row and
loses it forever when it confirms, or (b) refuses to advance until it terminalizes, re-reading
everything behind it each fold. A small carried set implements "pending are deferred, not
dropped" (FR-005) with bounded state. Terminal-success = `confirmed`/`indexed`; `reverted`
folds as the gentle line; `built`/`policy_rejected`/`declined`/`dropped` never fold and are
skipped permanently.

**Alternatives considered**: single-timestamp cursor (loses or re-reads, above); folding
`submitted` immediately with a "pending" line (memory would assert outcomes it doesn't know).

## R6 — Dedup and labeling

**Decision**: vault flows are the primary stream. Executions are matched to flows by tx hash
(executions store BYTEA, flows store hex strings — normalize to lower hex without `0x` for
comparison). A flow with a matching execution folds ONCE, labeled via-Sparky; an execution
with no flow (session-key ops, reverted attempts, non-vault kinds) folds as its own line;
a flow with no execution folds as "yourself".

**Rationale**: flows see everything on-chain (including manual actions); executions add
attribution + non-vault kinds. Matching by tx hash is exact, already indexed on both sides,
and needs no schema change.

## R7 — What "recommendation-linked" means for labeling

**Decision**: v2 labels ANY app-signed execution "via Sparky's plan" without distinguishing
whether the intent bundle carried a `recommendation_id`.

**Rationale**: every drawer execution starts from a Sparky-proposed action card, so the label
is truthful; joining through `intent_bundles` to differentiate "recommended" vs "user-asked"
adds a query and a nuance no user-visible copy currently needs. Revisit if product wants the
distinction.

## R8 — First-fold backfill and per-fold caps

**Decision** (client D1 + plan): first fold (cursor NULL) takes the 5 most recent events
across ALL sources merged chronologically, then sets every sub-cursor to head. Every fold
caps at 10 lines; per-source reads cap at LIMIT 25 before merge. When the cap truncates,
cursors advance only past events actually folded (except first-fold, which jumps to head
by design — the backfill is a sample, not a ledger).

**Rationale**: keeps the first folded digest conversational (5 lines cannot evict much of a
40-line digest) and bounds every fold's work regardless of how active the user was.
