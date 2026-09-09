# Research: Premium Purchase via SRK (Phase 0)

Decisions and rationale grounding the plan. Sources: a direct code read of `contracts/{src,script,test}` (the
OZ v5.1.0 ERC20 convention, `DeploySepolia.s.sol`, `foundry.toml` `fs_permissions`), `services/agent/src/sparkpoint_agent/{api,db,chain,data}/*` (the 008 tier store `db/limits.py`, the keyless `data/log_source.py`
`HttpxLogsRpc` + `_addr_from_topic`, the `require_admin`/error-envelope patterns), the web pay/confirm
surfaces (`apps/web/src/app/(app)/premium/*`, `confirm/[intent]/page.tsx`, `lib/chain/useExecuteSwapTx.ts`,
`packages/shared/src/addresses/*`), and the operator's locked decisions (spec §Clarifications). This feature
threads three already-proven engines — the 008 tier gate, the 007 user-signed approve+pay, and the
`fee_indexer`/`log_source` receipt-decode primitives — so most decisions are "reuse X," not "invent X."

## D1 — A fresh, minimal SRK test ERC-20 in `src/`, not the MockERC20 and not the old listed SRK

**Decision**: Add `contracts/src/token/SparkPointTestToken.sol` — OpenZeppelin v5.1.0 `ERC20("SparkPoint Test
Token", "SRK")`, 18 decimals, **all** supply minted to the deployer in the constructor, **no** public faucet
`mint`. Deploy on Base Sepolia via a new `contracts/script/DeploySRK.s.sol`.

**Rationale**: The task charter is explicit that this is a *deliberately fresh* token, distinct from the old
CoinMarketCap-listed SRK, so premium is paid in a token SparkPoint controls the supply of for the alpha. It
lives in `src/` (not `test/mocks/Mocks.sol`) so it is a first-class, addressable, auditable contract — the
`MockERC20` has an unpermissioned open `mint`/`burn`, which is fine for unit tests but unacceptable as a
"real" deployed token. OZ is the whole repo's ERC20 convention (vault, mocks, adapters all import OZ).
Rejected: reuse `MockERC20` (open mint = anyone grants themselves unlimited pay-tokens); a faucet `mint`
(unnecessary for a deployer-minted alpha token and widens the supply surface).

## D2 — Write the SRK address without clobbering `addresses.json`

**Decision**: The deploy script writes the SRK address with the **3-arg** `vm.writeJson(vm.toString(srk),
"deployments/84532/addresses.json", ".SRK")` (writes only the `.SRK` key) **or** to a separate
`deployments/84532/srk.json`. Then hand-copy the address into `packages/shared/src/addresses/baseSepolia.ts`.

**Rationale**: A 2-arg `vm.writeJson(json, path)` **overwrites the whole file** — a naive SRK script that
serialized only its own key would erase the vault/timelock/guardian entries the core deploy wrote. The 3-arg
overload surgically sets one key. The Foundry artifact and the hand-maintained TS address book are **two
separate stores** kept in sync manually (the deploy does not auto-update the TS file), so the address must
also be added to `baseSepolia.ts`. Rejected: 2-arg write to the shared file (data loss).

## D3 — Address book: plain optional fields, not policy TargetRefs

**Decision**: Add `srk?: Address` and `premiumTreasury?: Address` to `packages/shared/src/addresses/types.ts`
as plain optional fields and fill them in `baseSepolia.ts`. Do **not** add them to `TARGET_REF_FIELD`.

**Rationale**: This is exactly the precedent the Uniswap-V3 swap wiring set (`uniswapV3SwapRouter02?`,
`swapFeeRecipient?` — "NOT policy TargetRefs … no TARGET_REF_FIELD / parity impact"). SRK and the treasury are
a token venue and a payment recipient, not policy-gated execution targets, so they carry no parity/drift
obligation and keep the T098 drift guard green. Unset ⇒ `getAddresses(chainId).srk === undefined` ⇒ the pay
screen fail-closes to "unavailable" instead of fabricating. Rejected: modelling them as TargetRefs (would
wrongly pull them into policy parity for no benefit).

## D4 — Web uses viem's built-in `erc20Abi`; no ABI export

**Decision**: Balance/allowance/approve/transfer bind viem's built-in `erc20Abi`; SRK is **not** added to
`export-abis.sh`.

**Rationale**: The repo rule is that third-party/ERC-20/4626 ABIs are sourced from viem at the call site,
never re-declared through the generator (`useExecuteVaultTx`/`useExecuteSwapTx` already import `erc20Abi`
straight from viem). A plain ERC-20 has no custom function the frontend must bind to. Rejected: exporting an
SRK ABI (adds a CI-gated artifact for zero custom surface).

## D5 — User-signed two-leg approve+pay, cloned from `useExecuteSwapTx`

**Decision**: A new `apps/web/src/lib/chain/useExecutePremiumTx.ts` clones the 007 two-leg controller: leg-0
`approve(premiumTreasury, price)` **only if** `allowance < price`; leg-1 `transfer(premiumTreasury, price)`.
Each via `writeContractAsync` → `waitForTransactionReceipt`; a `status === "reverted"` receipt **fails
closed**. The user is the **sole signer**.

**Rationale**: This is the exact, tested shape of the live swap flow (approve→action, user-is-sole-signer,
receipt-gated), and it satisfies N1/N3 — SparkPoint signs nothing and never holds the SRK or keys. A direct
`transfer` (not `transferFrom` via a SparkPoint contract) means there is **no** standing pull-approval to a
SparkPoint-controlled address, so the approve leg exists only to the extent the token flow requires it.
Rejected: a bespoke `Subscription` contract that pulls via `transferFrom` (adds a custody-adjacent contract +
a standing approval for no benefit when a plain transfer to a disclosed recipient suffices).

## D6 — Route through the real confirm gate; the `premium` intent is already whitelisted

**Decision**: Surface the sign through the real `OnchainConfirmFlow` by generalizing
`ConfirmFlow.tsx`/`OnchainConfirmFlow` past the hardwired `deposit|withdraw` (adding a `premiumPay` exec
variant + a `usePremiumConfirm` builder), **or** an inline confirm modeled on `inline-swap-confirm.tsx`.
Either way the sign action is gated behind a fail-closed pre-sign check and revealed only once it passes.

**Rationale**: `"premium"` is **already** in both the `INTENTS` set in `confirm/[intent]/page.tsx` and the
`ConfirmIntent` union — but the route always renders the **placeholder** (it never passes `onchain`), and
`OnchainConfirmFlow` is hardwired to the two vault sides. Today "Review & sign" just `router.push`es to that
placeholder and never builds a tx — it looks live but is a mock (Principle III). The gate's `showReveal =
previewOk` pattern is the "simulate before sign" control the constitution requires; premium must reuse it.
Rejected: leaving the placeholder (dishonest); a wholly separate confirm system (the gate already exists).

## D7 — Verify server-side from the receipt; never trust a client "I paid" claim

**Decision**: A new `api/subscription.py` exposes `POST /subscription/verify {txHash}` (mounted in
`api/main.py`). It reads the on-chain receipt and grants only on a passing verification — it never trusts a
client assertion of payment, and never takes an amount/recipient/buyer from the body.

**Rationale**: Provable-not-promised (Principle III) and bounded blast radius (Principle IV): the only thing
the client contributes is a tx **hash**; everything material (status, confirmations, token, recipient, sender,
value) is read from chain. This mirrors how every admin write in the agent re-derives authority server-side.
Rejected: trusting a `{paid:true}` body or a client-reported amount (trivially forgeable).

## D8 — Buyer = server-scoped `account.owner`, asserted equal to on-chain `from`

**Decision**: The buyer is always `account.owner` (the SIWE-verified owner EOA from the S2S-scoped headers),
**never** a body field; verification requires the SRK Transfer's `from` to equal that owner.

**Rationale**: This closes the highest-severity exploit — without binding `from` to the header-scoped owner,
wallet A could submit wallet B's payment tx hash and mint itself premium off B's SRK. The agent already uses
`account.owner` (not a body field) for every scoped/admin action; the verifier follows suit. Rejected: taking
the buyer from the body (free-ride replay of any third party's payment).

## D9 — Reuse the keyless `HttpxLogsRpc` + `_addr_from_topic`; hardcode the Transfer topic0

**Decision**: `chain/payment_verifier.py` reuses `data/log_source.py`'s raw-result `HttpxLogsRpc.call(...)`
for `eth_getTransactionReceipt` and `eth_blockNumber`, and its `_addr_from_topic` to decode indexed
`from`/`to`. Match on the hardcoded `ERC20_TRANSFER_TOPIC0 =
0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`; decode the non-indexed `value` from
`log["data"]` via `eth_abi`.

**Rationale**: A receipt is a JSON **object** — the string-only `HttpxJsonRpcTransport` (vault reader) rejects
arrays/objects, so the raw-result `HttpxLogsRpc` is the correct existing transport. Transfer-log decoding is
already solved keccak-free in this codebase (fixed topic0 constants + `_addr_from_topic`); reusing it keeps
the verifier **keyless and keccak-free**, matching the module's provable-keyless posture. Rejected: adding a
web3/ABI dependency, or a keccak call, when the primitives already exist.

## D10 — Finality gate: confirmations, with pending as a distinct retryable outcome

**Decision**: Require `head − receipt.blockNumber ≥ PREMIUM_MIN_CONFIRMATIONS` (head via `eth_blockNumber`)
before granting. A not-yet-mined / under-confirmed tx returns a **retryable pending** result — neither a grant
nor a hard failure. A reverted (`status != 0x1`) tx never grants.

**Rationale**: `status == 0x1` is necessary but insufficient — a shallow confirmation can reorg out (testnet
reorgs are common), which would grant premium for a payment that never settled. The confirmation depth makes
the grant durable. Distinguishing *pending* from *invalid* lets the client poll a freshly-broadcast tx
instead of erroring, without ever granting on an unsettled payment. Rejected: granting on `status == 0x1`
alone (reorg-exploitable); treating pending as a hard failure (breaks the normal broadcast→confirm latency).

## D11 — Anti-replay is `UNIQUE(network_id, tx_hash)`, not the idempotency key

**Decision**: The new `payments` ledger carries a **global `UNIQUE(network_id, tx_hash)`**; a hash that has
already granted is rejected on re-submission (same or different wallet). The BFF `Idempotency-Key` is **not**
relied on for this.

**Rationale**: The `Idempotency-Key` middleware only dedupes *identical retries* of one request — it does
nothing against a *different* caller submitting the *same* payment hash to claim a second grant. The tx-hash
uniqueness (the same pattern `fee_events` uses with `UNIQUE(network_id, tx_hash, log_index)`) is the
authoritative one-payment-one-grant control. The insert-then-grant happens in a single transaction so a unique
violation aborts the grant. Rejected: relying on the idempotency cache (wrong scope — see the adversarial
notes).

## D12 — Grant via the 008 store with `source='srk'`; no CHECK ALTER

**Decision**: On a verified payment, grant premium via the existing `LimitsStore.assign(wallet, "premium",
source='srk')` (`db/limits.py:207`), extended to accept an `expires_at`. `'srk'` is **already** in the `0015`
`wallet_tier.source` CHECK — **no `ALTER`** needed.

**Rationale**: 008 already reserved `'srk'` in the CHECK constraint precisely for this paid path, and its
`assign` already writes the grant + an audit row in one transaction and immediately makes the wallet resolve
premium via the existing `resolve_tier` on the quota gate. Reusing it means the next chat/recs/onboarding turn
just works, with zero new enforcement code. Rejected: a new `'purchase'` source (needs an ALTER for no
benefit); a parallel grant mechanism (would duplicate 008's resolve/audit).

## D13 — Expiry resolved lazily on the hot path; `wallet_tier` is the single resolution source

**Decision**: Add a nullable `wallet_tier.expires_at` and change 008's `_RESOLVE_SQL` (`db/limits.py:44`) to
`… AND (expires_at IS NULL OR expires_at > now())`. A lapsed row resolves to **free** on the hot path with no
sweeper. `NULL` ⇒ non-expiring (admin grant). The `subscriptions`/`payments` tables are **history/audit**
only, not the resolution source.

**Rationale**: 008's hot path resolves tier by *existence* with no time check; if expiry lived only in
`subscriptions`, a lapsed sub would keep resolving premium until a sweeper ran (dual-source drift + a new
background job). Putting `expires_at` on `wallet_tier` makes expiry **fail-closed to free** for free, on the
same query, consistent with the existing fail-closed-to-default posture — no sweeper, no drift. Keeping a
single resolution source is the key anti-drift decision. Rejected: `subscriptions`-as-resolution-source + a
sweeper (drift window + infra); a `status` enum (redundant with a timestamp compare).

## D14 — Renewal extends; price compared in SRK base units; billing constants read directly

**Decision**: A renewal sets `expires_at = max(now, current_expiry) + 1 month` (extends, never resets). The
verifier compares `value >= PREMIUM_PRICE_SRK` in **SRK base units** (18-dp), never dollars. New constants —
`SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS` — are read
**directly** (like `PREMIUM_ALLOWLIST`), kept out of the keyless `AgentConfig`.

**Rationale**: Extending (not resetting) means paying early never truncates paid time and paying after a lapse
starts fresh — the honest recurring-subscription semantics. There is **no USD oracle** for SRK anywhere, so a
dollar comparison is impossible and the web mock's "≈ $12.00" is a display peg only (must be labelled
illustrative or dropped, Principle III). Keeping the billing constants out of `AgentConfig` preserves that
module's provable-keyless allowlist posture (none are key-bearing, but the vault-read config stays minimal).
Rejected: reset-on-renewal (steals paid time); any USD price (no feed); funnelling constants through
`AgentConfig` (needless coupling to the keyless allowlist).

## Adversarial review notes (recorded)

- **Buyer-binding / free-ride replay (highest).** If `subscription/verify` granted to `account.owner` without
  asserting `from == account.owner`, wallet A could submit wallet B's payment hash and mint itself premium off
  B's SRK. Answered by D8 (bind on-chain `from` to the header-scoped owner) **and** D11 (`UNIQUE(network_id,
  tx_hash)` so one payment grants at most once). The `Idempotency-Key` cache is explicitly **not** this
  control.
- **Reorg / finality.** `status == 0x1` alone is reorg-exploitable on a shallow tx. Answered by D10
  (`head − blockNumber ≥ N`; pending is retryable, not a grant; reverted never grants).
- **Expiry two-store drift.** 008 resolves by existence with no time check; a `subscriptions`-only expiry
  would grant lapsed premium until a sweeper ran. Answered by D13 (`expires_at` on `wallet_tier`, one-clause
  resolve change, single resolution source, no sweeper).
- **Double-count / recipient collision.** If a shared treasury also receives swap fees, a naive indexer could
  double-read the same Transfer. Not an issue for *this* feature (it verifies a specific submitted hash, not a
  scan), but recorded because feature 013's revenue indexer must disambiguate premium (`from==buyer ∧
  token==SRK`) from swap (`from==router`) — the treasury address alone is not a discriminator.
- **N5 / multisig authority.** If `premiumTreasury` is the 014 Safe, it must gain **zero** fund-movement
  authority over user funds — it is a plain recipient, not the vault guardian (making it guardian is
  impossible without a redeploy anyway, since `_guardian` is immutable). The Trust Center must show its actual
  (nil) on-chain power (Principle III). Answered by FR-019/US4.
- **Timelock ceremony (out of scope here, flagged for 014).** Moving the vault fee recipient to the Safe is a
  Timelock `schedule`→wait→`execute` (`setFeeRecipient` is `onlyGuardian`), **not** an EOA setter call — 012
  only *points* `premiumTreasury` at whatever recipient exists; the cutover mechanics belong to 014.
- **Native-ETH gap.** SRK is an ERC-20; a native-ETH payment emits no Transfer log and is unverifiable — the
  flow only ever signs an SRK `transfer`, so there is no native leg to under-count.
- **No USD oracle.** There is no SRK price feed; the verifier compares base units (D14). Any dollar figure is
  an explicitly illustrative peg, never a verification input.
- **RPC outage vs invalid.** An upstream RPC failure must surface as `UPSTREAM_UNAVAILABLE` (retryable), never
  a grant and never a false "invalid payment" — the `HttpxLogsRpc` path already raises the mappable upstream
  error; the verifier must not swallow it into a hard refusal.
