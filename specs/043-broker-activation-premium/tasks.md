# Tasks — 043 Sparky Broker: mint, activation, and NFT-derived Premium

**Branch**: `043-broker-activation-premium` · **Spec**: [spec.md](./spec.md) · **Plan**:
[plan.md](./plan.md)

Ordered so the feature's guarantee is provable before most of it is written. `[P]` = parallelisable
with its neighbours.

**Status: not started.** Implementation begins after review of spec + plan + tasks.

---

## Phase A — US1: Premium dies with the sale *(P1 — ships alone)*

The three brokers already on 46630 make this testable with no new contract and no UI. Phase A alone
is a shippable slice: it makes an already-activated broker confer Premium, and — more importantly —
makes selling it take Premium away.

- **T001** — Write the failing test **first** and watch it fail.
  `services/agent/tests/chain/test_broker_gate.py`: a wallet with an activated broker resolves
  premium; after the broker moves, it resolves free. Also: holding an *unactivated* broker never
  qualifies. This exists before `broker_gate.py` does; a test written after the code asserts what the
  code does rather than what the product promises.
- **T002** — `services/agent/src/sparkpoint_agent/chain/broker_gate.py`, mirroring `srk_gate.py`'s
  shape **and its discipline: every failure path returns a non-qualifying result and it never
  raises.** Implements research R1 — read `registry.activationsBy(wallet)` as a candidate set, then
  narrow with live `ownerOf` + `activatedAt`. Never a 10,000-id scan.
- **T003** — The 60s TTL cache, caching **the chain's answer**, never a derived tier, and **not**
  writing an entry on a read failure (so an outage cannot pin a non-qualifying answer).
- **T004** — Extend `LimitsStore.resolve_tier` in `db/limits.py`: premium if the stored tier is
  premium **OR** the broker gate qualifies. Signature unchanged. Add `resolve_tier_source`.
- **T005** — `services/agent/tests/db/test_limits_broker.py`: the existing subscription path is
  byte-for-byte unaffected (FR-004); subscription-expires-while-broker-held keeps premium and flips
  the named source; **chain unreadable ⇒ falls back to stored, never fails the request** (FR-006).
- **T006** — ⚠️ **The guard test**: assert that no code path writes a broker-derived row into
  `wallet_tier`. Grep-style, in the suite, so it fails a future well-meaning "let's cache the tier"
  refactor. The plan's "zero migrations" is a claim; this is what makes it enforced.
- **T007 [P]** — Env wiring: `BROKER_NFT_ADDRESS_46630`, `BROKER_REGISTRY_ADDRESS_46630`,
  `BROKER_GATE_CACHE_SECONDS`. Absent ⇒ the gate is **disabled and non-qualifying**, so the agent
  behaves exactly as today. Never a hardcoded address.
- **T008** — Verify on the live chain per `quickstart.md` §US1, **including step 5** (`SELECT` proves
  no broker-sourced row exists). Steps 1–4 can pass while the bug is still present.

**Checkpoint:** US1 is demonstrably true. Nothing below can be trusted before this is.

---

## Phase B — US2: activation in one transaction *(P2)*

- **T009** — `contracts/src/broker/BrokerActivationRegistry.sol` per
  [`contracts/broker-interfaces.md`](./contracts/broker-interfaces.md). Immutable `broker`, `srk`,
  `deadAddress`, `maxPrice`; mutable `price` only. **No** withdraw/sweep/rescue, **no `payable`
  anywhere** (so ETH can never be stranded — the `locked-ether` finding on the NFT is the precedent).
- **T010** — `contracts/test/broker/BrokerActivationRegistry.t.sol`: invariants I1–I7 and I9–I10.
  The fuzz that matters is **I2** — over the whole failure set (not owner / already activated /
  insufficient balance / insufficient allowance), assert the caller's SRK balance and `activatedAt`
  are *exactly* as before. There must be no state where SRK is spent and the broker is not activated.
- **T011 [P]** — I10 explicitly: an activation does **not** change SRK's `totalSupply()`. This is
  the test that keeps the product honest about the word "retired".
- **T012** — `script/DeployBrokerRegistry.s.sol`, `--slow` (deliberate on this stack).
- **T013** — Deploy to 46630, then `setActivator(registry)` from the NFT owner. Record in
  `DEPLOYMENT.md` **with the research-R1 caveat**: re-pointing `activator` at a different registry
  splits the activation record, and any successor must read through to this one.
- **T014** — Verify per `quickstart.md` §US2, including every failure row with a balance check
  either side.

---

## Phase C — US3: mint *(P3)*

- **T015** — ⚠️ **Decide and write down how the mainnet-SRK holder gate is proven to a contract on
  Robinhood Chain.** No contract can read another chain. The honest options — a signed allowlist
  root, an operator-maintained on-chain allowlist, or UI-only gating accepted as advisory — differ in
  **trust model**, so this is a design decision with a written rationale, not an implementation
  detail. **Blocks T016.**
- **T016** — `contracts/src/broker/BrokerSale.sol`. Per-wallet allocation here; the 10,000 cap stays
  on the NFT (two caps eventually disagree). Testnet price/allocation are constructor arguments.
- **T017** — `contracts/test/broker/BrokerSale.t.sol`: eligibility, allocation, cap-at-the-NFT, and
  **I8 — a minted broker is never activated**.
- **T018** — `script/DeployBrokerSale.s.sol`; deploy to 46630; `setMinter(sale)`; record.

---

## Phase D — US4: the four screens *(P3)*

- **T019 [P]** — `apps/web/src/lib/chain/brokers.ts` — pure leaf helpers + node:test. **Must be a
  LEAF module**: no runtime import of `@sparkpoint/shared/*` (its barrels use extensionless internal
  imports that `node --experimental-strip-types` cannot resolve). Probe before designing.
- **T020** — `/brokers` — mint + your brokers. Activation state read per load, never held in
  component state as a flag that could outlive a transfer. No invented price, allocation or date;
  where a term is undecided the screen says so.
- **T021** — The activation confirm step, reusing the existing execution-drawer shape: what leaves,
  what arrives, what ends it, which network. **Price read live at signing** (FR-015).
- **T022** — `/premium` names its source, for all four combinations of (subscription) × (broker),
  and states that a broker-sourced Premium has no expiry and ends on transfer.
- **T023 [P]** — Copy pass: **"retired", never "burned"** anywhere it would read as a supply claim
  (FR-021); activation is never described as permanent (a transfer clears it and re-activation costs
  SRK again).
- **T024** — Address book + ABIs: `brokerNft`, `brokerRegistry`, `brokerSale` on
  `robinhoodTestnet.ts`. ⚠️ Do **not** add anything that would make `/premium/pay` think this chain
  can settle a Premium payment — `PREMIUM_SETTLEMENT_CHAIN_IDS` stays `[84532]`.

---

## Phase E — ship

- **T025** — Both changelogs: `CHANGELOG.md` **and** `services/agent/content_seed/whats-new.json`.
  ⚠️ whats-new `tag` must be one of **New / Fixed / Improved / Announcement** — never `Added`
  (`tests/test_whats_new_seed.py` enforces it), and **backdate** `published_at`, never round up (the
  future-dating guard fails on a timestamp ahead of the runner clock).
- **T026** — Full gates: forge (unit + fuzz), pytest, node:test, `tsc`, `typecheck:test`, eslint,
  `next build`.
- **T027** — Live pass over the whole of `quickstart.md`, then restore the environment as found.
- **T028** — Record everything in `DEPLOYMENT.md`. **No migration is added** — if one appears in this
  diff, the design has been violated (see `data-model.md`).

---

## Traceability

| Story | Tasks | The requirement that would make it a lie if broken |
|---|---|---|
| US1 — Premium dies with the sale | T001–T008 | FR-002 (never stored), FR-003 (short window) |
| US2 — one-transaction activation | T009–T014 | FR-012 (no partial outcome), FR-013 (no custody) |
| US3 — mint | T015–T018 | FR-018 (a mint never activates) |
| US4 — the screens | T019–T024 | FR-019 (nothing invented), FR-021 ("retired") |

## Not in these tasks

Changing `SparkyBroker.sol` · a second path that clears activation · revenue-payout weighting ·
any mainnet deployment · royalties · anything touching the vault, chat, onboarding or withdrawals.
