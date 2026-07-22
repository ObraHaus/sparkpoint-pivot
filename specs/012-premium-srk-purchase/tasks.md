---
description: "Task list for 012-premium-srk-purchase"
---

# Tasks: Premium Purchase via SRK

**Input**: Design documents in `specs/012-premium-srk-purchase/` (spec.md, plan.md, research.md, data-model.md, contracts/premium-srk-interfaces.md, quickstart.md)

**Tests**: Included — this feature is the trust boundary that turns the 008 tier engine into a paid product, so the spec's Independent Tests + Success Criteria + Constitution (IV bounded blast radius, I non-custody) require them: contract unit + **fuzz** on the SRK token; a full payment-verifier receipt matrix (buyer≠owner rejected, replayed tx rejected, under-value rejected, `< N` confirmations pending, reverted/wrong-token/wrong-recipient refused, RPC-outage retryable); the anti-replay `UNIQUE(network_id, tx_hash)`; a **custody-untouched** proof; and an **expiry-resolves-to-free** proof.

**Organization**: Grouped by user story (US1–US5 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 / US5 (or SETUP / POLISH)
- Include exact file paths in descriptions

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for every behavior/schema/infra change (the SRK token + `DeploySRK` script, the `0017` tables/column, the `payments`/`subscriptions` ledgers, `POST /subscription/verify` + the keyless verifier, the expiry-aware tier resolve, the real pay surface all qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase with a **stable `slug`** (US1: "Buy Premium with SRK"; US3: "Premium renews and lapses honestly"; US5: "The pay screen now shows your real SRK"), backdated via `published_at` so the timeline reads honestly.
- [ ] `MIGRATIONS.md` records **`0017`** applied per environment; `0017_subscriptions.sql` applies with `PGCLIENTENCODING=UTF8` **before** the agent boots (an un-applied table degrades silently). **No new agent seed dir** is introduced, so no `services/agent/Dockerfile` `COPY` is needed — confirm none was added.
- [ ] `DEVELOPMENT.md` documents the new env — `SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS` (all read **directly**, not via the keyless `AgentConfig`) — plus the `srk` / `premiumTreasury` address-book fields; `DEPLOYMENT.md` / `COOLIFY.md` document the SRK deploy step + the agent billing env on the alpha.
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint && build` green; agent `pytest` green; **contract `forge test` incl. FUZZ green** where the token changes; **non-custody + verification invariants confirmed in review** (Constitution I/III/IV — buyer-bound `from == owner`, replay-proof `UNIQUE(network_id, tx_hash)`, finality-gated `head − block ≥ N`, and **no** premium/expiry/price check on any withdraw/redeem/exit path; SRK non-essential).
- [ ] No new env var left undocumented.

---

## Phase 0: Groundwork — SRK token + schema + subscription store (no grant yet)

**Purpose**: land the on-chain token, the address-book venue, and the data model + store so every later phase reads/writes one place. Ships alone; grants nothing, gates nothing.

- [ ] T001 [P] [SETUP] `contracts/test/token/SparkPointTestToken.t.sol` — write first (fails until T002): unit + **FUZZ** — `decimals() == 18`; `totalSupply() == INITIAL_SUPPLY` and the deployer holds all of it at construction; no callable path mints after construction; fuzzed transfer/approve/`transferFrom` preserve supply and respect balances/allowances (over-balance transfer reverts) (contracts §1).
- [ ] T002 [SETUP] `contracts/src/token/SparkPointTestToken.sol` — OZ v5.1.0 `ERC20("SparkPoint Test Token", "SRK")`, 18dp (not overridden), **all** supply `_mint(msg.sender, INITIAL_SUPPLY)` in the constructor, **no** public faucet mint (contracts §1) (depends on T001).
- [ ] T003 [SETUP] `contracts/script/DeploySRK.s.sol` — mirror `contracts/script/DeploySepolia.s.sol`; deploy `SparkPointTestToken` and write the address with the **3-arg** `vm.writeJson(vm.toString(address(srk)), "deployments/84532/addresses.json", ".SRK")` (or a separate `deployments/84532/srk.json`) — **never** a 2-arg write (clobbers the file) (contracts §2) (depends on T002).
- [ ] T004 [P] [SETUP] `packages/shared/src/addresses/types.ts` — add plain optional `srk?: Address` + `premiumTreasury?: Address` to `AddressBook`; **do NOT** add them to `TARGET_REF_FIELD` (no policy/parity impact — T098 drift guard stays green) (contracts §3).
- [ ] T005 [SETUP] `packages/shared/src/addresses/baseSepolia.ts` — hand-copy the deployed SRK address into `srk` and set `premiumTreasury` (the 014 fee Safe if it exists at build time, else the deployer EOA + a recorded cutover note); leave both `undefined` on 8453/46630 (depends on T003/T004).
- [ ] T006 [SETUP] `services/agent/migrations/0017_subscriptions.sql` — create `payments` (`UNIQUE(network_id, tx_hash)`, lowercased `tx_hash`/`buyer`/`token` CHECKs, `amount_raw NUMERIC >= 0`, `block_number`, `network_id REFERENCES networks(id)`) + `subscriptions` (`wallet`/`tier REFERENCES tier_definitions(tier)`/`started_at`/`expires_at NOT NULL`/`payment_tx_hash`/`amount_raw`, index `(wallet, started_at DESC)`) + `ALTER TABLE wallet_tier ADD COLUMN IF NOT EXISTS expires_at timestamptz`; **no** `wallet_tier.source` ALTER (`'srk'` already in the `0015` CHECK). Apply with `PGCLIENTENCODING=UTF8`; update `MIGRATIONS.md` (Develop → 0017) (data-model §payments/§subscriptions/§wallet_tier.expires_at).
- [ ] T007 [P] [SETUP] `services/agent/tests/db/test_subscriptions_store.py` — write first (fails until T008/T009): idempotent payment insert (a duplicate `(network_id, tx_hash)` raises and grants zero additional times); a fresh grant sets `expires_at = now + 1 month`; every grant writes a `subscriptions` row + a `limits_audit` row in one transaction; the wallet resolves premium via the existing `resolve_tier` afterward (contracts §6).
- [ ] T008 [SETUP] `services/agent/src/sparkpoint_agent/db/limits.py` — extend `LimitsStore.assign(address, tier, *, source, actor=None, expires_at=None)` to accept + persist `expires_at` (still writing grant + `limits_audit` in one tx; `source='srk'` already allowed by the `0015` CHECK) (contracts §7) (depends on T006).
- [ ] T009 [SETUP] `services/agent/src/sparkpoint_agent/db/subscriptions.py` — `SubscriptionStore.record_and_grant(*, buyer, tx_hash, network_id, token, amount_raw, block_number)` (mirror `db/limits.py`): in **one transaction** `INSERT INTO payments` (unique-violation aborts the grant) → compute `new_expiry` → `INSERT INTO subscriptions` → `LimitsStore.assign(buyer, "premium", source='srk', expires_at=new_expiry)`; returns `new_expiry`. Export from `db/__init__.py` (contracts §6) (depends on T007/T008).
- [ ] T010 [P] [SETUP] `CHANGELOG.md` `## [Unreleased]` bullets: "feat(contracts): SparkPoint test SRK ERC-20 + DeploySRK", "feat(agent): subscriptions schema (0017) + SubscriptionStore".

**Checkpoint**: SRK deployed + addressed; `0017` applied; `SubscriptionStore` green; nothing grants or gates yet.

---

## Phase A → User Story 1 — A user pays SRK and becomes premium for a month (Priority: P1) 🎯 MVP

**Goal**: a valid full-price SRK payment, verified server-side from its receipt, grants premium for one month via the 008 store — resolved on the wallet's next turn with no re-auth.

**Independent Test**: quickstart US1.

### Tests for US1 (write first, ensure they fail)

- [ ] T011 [P] [US1] `services/agent/tests/chain/test_payment_verifier.py` — the happy path: a receipt with `status == 0x1`, `head − blockNumber ≥ PREMIUM_MIN_CONFIRMATIONS`, and a `Transfer` log (`address == SRK`, `to == treasury`, `from == buyer`, `value ≥ PREMIUM_PRICE_SRK`) returns a `VerifiedPayment`; a `null` receipt returns `Pending` (contracts §4).
- [ ] T012 [P] [US1] `services/agent/tests/api/test_subscription.py` — the buyer is derived from `account.owner` (never the body; a body-supplied buyer/amount is ignored); a malformed `txHash` → `400 VALIDATION_ERROR`; a valid payment returns `{"status":"granted","tier":"premium","expiresAt":…}` with an expiry one month out; the audit record (buyer, tx hash, amount, expiry) is written (contracts §5, SC-008).

### Implementation for US1

- [ ] T013 [US1] `services/agent/src/sparkpoint_agent/chain/payment_verifier.py` — keyless `PaymentVerifier.verify(*, tx_hash, buyer) -> VerifiedPayment | Pending` reusing `data/log_source.py`'s raw-result `HttpxLogsRpc` (`eth_getTransactionReceipt` + `eth_blockNumber`) + `_addr_from_topic`; hardcoded `ERC20_TRANSFER_TOPIC0`; decode `value` from `log["data"]`; billing constants (`SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS`) read **directly** (like `PREMIUM_ALLOWLIST`), out of `AgentConfig` (contracts §4) (depends on T011).
- [ ] T014 [US1] `services/agent/src/sparkpoint_agent/api/subscription.py` — `POST /subscription/verify {txHash}` `get_account`-scoped (buyer = `account.owner`), `PurchaseSubmit` validated `^0x[0-9a-fA-F]{64}$`; on verified → `SubscriptionStore.record_and_grant(...)` → `{"status":"granted",…}`; `get_payment_verifier` / `get_subscription_store` DI deps (contracts §5) (depends on T009/T013).
- [ ] T015 [US1] `services/agent/src/sparkpoint_agent/api/main.py` — `from .subscription import router as subscription_router; app.include_router(subscription_router)` (depends on T014).
- [ ] T016 [P] [US1] `apps/web/src/lib/agent/*` — typed client call to `POST /api/agent/subscription/verify {txHash}` (BFF forwards GET/POST only, injects `X-Owner` + S2S bearer) so the client can submit the tx hash and read the granted/pending/refused outcome (contracts §5) (depends on T015).
- [ ] T017 [P] [US1] Living docs: `CHANGELOG.md` + `services/agent/content_seed/whats-new.json` client entry (slug "buy-premium-with-srk", "Buy Premium with SRK") + `DEVELOPMENT.md` billing env vars.

**Checkpoint**: a valid SRK payment grants premium for a month; the wallet resolves premium on its next turn; every grant is audited.

---

## Phase B → User Story 2 — The payment is verified on-chain, server-side, before any grant (Priority: P1)

**Goal**: harden the verifier to the full receipt matrix — buyer-bound, replay-proof, finality-gated, correct-token/recipient/amount in base units, RPC-outage retryable.

**Independent Test**: quickstart US2.

### Tests for US2 (write first)

- [ ] T018 [P] [US2] `services/agent/tests/chain/test_payment_verifier.py` — expand to the full matrix: a **different sender** (`from != buyer`) refused; **under-price** refused; **reverted** (`status != 0x1`) refused; **wrong-token** refused; **wrong-recipient** refused; **shallow/unmined** → `Pending` (retryable); an **RPC outage** propagates the mappable upstream error (→ `UPSTREAM_UNAVAILABLE`), never swallowed into a false "invalid"; amount compared in **base units**; verifier pinned to the SRK chain, fails closed elsewhere (contracts §4, SC-002).
- [ ] T019 [P] [US2] `services/agent/tests/api/test_subscription.py` — a `Pending` verify returns `{"status":"pending","confirmations":c,"required":N}` (200, not 4xx); a refusal raises `400 VALIDATION_ERROR` with a clear reason; an RPC outage raises `503 UPSTREAM_UNAVAILABLE`; the **same** hash resubmitted (by the same or a different wallet) grants **zero** additional times via the `payments` `UNIQUE(network_id, tx_hash)` (SC-003).

### Implementation for US2

- [ ] T020 [US2] `services/agent/src/sparkpoint_agent/chain/payment_verifier.py` — enforce the full assert sequence: `from == buyer` (buyer-binding, D8), `to == PREMIUM_TREASURY_ADDRESS`, `address == SRK_ADDRESS_84532`, `value >= PREMIUM_PRICE_SRK` (base units); `status != 0x1` ⇒ refuse; `head − block < N` or `null` receipt ⇒ `Pending`; RPC error surfaces as the upstream error (never a grant, never a false invalid) (contracts §4, FR-006/FR-007/FR-009/FR-010) (depends on T013/T018).
- [ ] T021 [US2] `services/agent/src/sparkpoint_agent/api/subscription.py` — map the three-way outcome: `Pending` → `{"status":"pending",…}` (200); refuse → `ApiError(VALIDATION_ERROR)` (400); RPC outage → `ApiError(UPSTREAM_UNAVAILABLE)` (503); a duplicate-hash unique violation from the store surfaces as "already granted", not a 500 (contracts §5, FR-008) (depends on T014/T020).
- [ ] T022 [P] [US2] Living docs: `CHANGELOG.md` bullet (buyer-bound / replay-proof / finality-gated verification + retryable-pending outcome).

**Checkpoint**: only a valid, sufficiently-confirmed, owner-originated, correct-recipient, full-amount, not-yet-seen payment grants; every other case is refused or retryable-pending; one payment grants at most once.

---

## Phase C → User Story 3 — Premium auto-expires to free, and renewals extend (Priority: P2)

**Goal**: expiry resolved lazily on the hot path (no sweeper), and a renewal extends `max(now, current_expiry) + 1 month`; null-expiry admin grants stay non-expiring.

**Independent Test**: quickstart US3.

### Tests for US3 (write first)

- [ ] T023 [P] [US3] `services/agent/tests/db/test_limits_expiry.py` — a `wallet_tier` row with a **past** `expires_at` resolves to the default (free) tier on the next call with **no** sweeper; a **future** `expires_at` resolves premium; a **NULL** `expires_at` resolves as non-expiring (an admin grant is never auto-lapsed); the resolve stays a single indexed read (contracts §7, FR-014/FR-016, SC-004).
- [ ] T024 [P] [US3] `services/agent/tests/db/test_subscriptions_store.py` — extending-renewal math: a second valid payment sets `expires_at = max(now, current_expiry) + 1 month` for both a still-active and an already-lapsed wallet (never a reset that truncates paid time); a renewal writes a **new** append-only `subscriptions` row (SC-004).

### Implementation for US3

- [ ] T025 [US3] `services/agent/src/sparkpoint_agent/db/limits.py` — change `_RESOLVE_SQL` (`:44`) to `SELECT tier FROM wallet_tier WHERE address = $1 AND (expires_at IS NULL OR expires_at > now())` (the single load-bearing edit; fail-closed to free on the hot path, no sweeper) (contracts §7, D13) (depends on T023).
- [ ] T026 [US3] `services/agent/src/sparkpoint_agent/db/subscriptions.py` — implement the renewal math in `record_and_grant`: read the wallet's current `wallet_tier.expires_at` and set `new_expiry = max(now(), current_expiry) + interval '1 month'` (extends, never resets) (contracts §6, FR-015) (depends on T009/T024).
- [ ] T027 [P] [US3] Living docs: `CHANGELOG.md` + `whats-new.json` client entry (slug "premium-renews-honestly", "Premium renews and lapses honestly").

**Checkpoint**: a lapsed wallet meters free on its next turn with no sweeper; a renewal adds a month; admin (null-expiry) grants never lapse.

---

## Phase D → User Story 4 — Non-custodial, never gates withdraw (Priority: P2) 🛡️

**Goal**: prove the SRK movement is a user-signed transfer to a disclosed recipient with no SparkPoint-signed leg / no standing pull-approval, and that **no** premium/expiry/subscription/price check sits on any funds-movement path.

**Independent Test**: quickstart US4.

### Tests for US4 (write first)

- [ ] T028 [P] [US4] `services/agent/tests/api/test_custody_untouched.py` — the vault-quote / deposit / withdraw / redeem / exit routes are NOT wrapped by any premium/expiry/subscription/price check and succeed identically for a **free**, **premium**, **lapsed**, and **verification-erroring** wallet; the expiry-aware `_RESOLVE_SQL` is called only from the three advisory-compute routes, never the custody path (contracts §7, FR-017/N2, SC-005).
- [ ] T029 [P] [US4] `apps/web/src/lib/chain/useExecutePremiumTx.ts` unit test (`node:test`/Vitest, co-located `*.test.ts`) — leg-1 is a plain `transfer` to the disclosed treasury (**no** `transferFrom`, no standing pull-approval to a SparkPoint contract); the user is the sole signer; a `status === "reverted"` receipt fails closed (contracts §8, SC-007).

### Implementation for US4

- [ ] T030 [US4] `services/agent/src/sparkpoint_agent/api/main.py` — audit the router wiring / confirm no `require_within_quota`-style or subscription/expiry dependency was attached to any custody route; keep the premium/expiry check strictly on chat / recommendations / onboarding (FR-017/FR-018, N2) (depends on T025).
- [ ] T031 [P] [US4] `apps/web/src/app/(app)/premium/pay/page.tsx` — disclose the exact on-chain `premiumTreasury` recipient address on the pay surface (verifiable, Principle III); if the treasury is a multisig, present it as a plain recipient with no fund-movement authority over user funds (FR-019, N5).
- [ ] T032 [P] [US4] Living docs: `CHANGELOG.md` bullet (non-custody + custody-untouched invariant; disclosed treasury).

**Checkpoint**: a free/lapsed/erroring wallet withdraws exactly as a premium one; SparkPoint signs no SRK leg and holds no pull-approval; the recipient is disclosed.

---

## Phase E → User Story 5 — The pay surfaces show real SRK balance/price and route through a real confirm gate (Priority: P3)

**Goal**: the pay screen reads live `balanceOf`/`allowance` + the configured price, builds the real approve-then-transfer, and routes "Review & sign" through the fail-closed confirm gate; honest "unavailable" when SRK is unconfigured.

**Independent Test**: quickstart US5.

### Tests for US5 (write first)

- [ ] T033 [P] [US5] `apps/web/src/app/(app)/premium/pay/*` pay-screen helper test (`node:test`/Vitest) — the displayed balance equals the on-chain `balanceOf(owner)` and the price equals the configured value (no hard-coded 320/500); an approve leg is computed only when `allowance(owner, treasury) < price`; an unset `srk` on the active chain drives the honest "unavailable" state (no fabricated balance/price) (contracts §8, SC-006, FR-020/FR-022).

### Implementation for US5

- [ ] T034 [US5] `apps/web/src/lib/chain/useExecutePremiumTx.ts` — clone `apps/web/src/lib/swap/useExecuteSwapTx.ts`: leg-0 `approve(treasury, price)` only if `allowance < price`; leg-1 `transfer(treasury, price)`; each `writeContractAsync` → `waitForTransactionReceipt`, `status === "reverted"` ⇒ fail closed; viem `erc20Abi` at the call site; user is sole signer (contracts §8, D5) (depends on T029).
- [ ] T035 [US5] `apps/web/src/app/(app)/premium/pay/page.tsx` — replace hardcoded `balance=320`/`price=500` with `useReadContract(erc20Abi, "balanceOf", [owner])` + `allowance(owner, treasury)` + the configured price; compute `needsApprove`; honest "insufficient SRK" + "unavailable" (unset `srk`) states; wire "Review & sign" to the built `useExecutePremiumTx` exec (not the `router.push` placeholder) (depends on T034).
- [ ] T036 [US5] `apps/web/src/components/ui/ConfirmFlow.tsx` (+ the `OnchainConfirmFlow` sign path) — generalize past the hardwired `deposit|withdraw` for a `premiumPay` exec variant (or an inline confirm modeled on `apps/web/src/components/screens/chat/inline-swap-confirm.tsx`); the Sign action is revealed only once the fail-closed pre-sign check passes; success renders only after a real on-chain receipt (contracts §8, FR-021, D6) (depends on T034).
- [ ] T037 [P] [US5] `apps/web/src/app/(app)/premium/page.tsx` — drop the `StatusTag variant="mock"`; show real SRK/price; keep the existing `/usage/self` read; any dollar figure labelled an illustrative peg only (FR-003) (depends on T035).
- [ ] T038 [P] [US5] Living docs: `CHANGELOG.md` + `whats-new.json` client entry (slug "real-srk-pay-screen", "The pay screen now shows your real SRK") + `DEPLOYMENT.md`/`COOLIFY.md` (SRK deploy + agent billing env on the alpha).

**Checkpoint**: the pay screen is live-real (balance/price/approve-if-needed), signs through the fail-closed gate, and honest-degrades when SRK is unset.

---

## Phase POLISH: Cross-cutting

- [ ] T039 [P] [POLISH] Playwright e2e `apps/web/e2e/pw/premium-pay.spec.ts` — approve→pay→verify→premium round-trip and the "SRK unavailable" honest-degrade (`domcontentloaded` + long hydration budget on the CPU-starved box).
- [ ] T040 [POLISH] Re-verify on the develop/alpha environment on Base Sepolia (84532): a real ≥500-SRK wallet pays, the agent verifies, premium resolves on the next turn; paste evidence into the PR body.
- [ ] T041 [POLISH] Security + non-custody self-review vs Constitution I/III/IV (buyer-bound `from == owner`; replay-proof `UNIQUE(network_id, tx_hash)`; finality-gated `head − block ≥ N`; no premium/expiry/price check on any withdraw/redeem/exit; SRK non-essential; treasury a plain recipient) before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first (token + schema + store) — everything reads it. The SRK deploy (T003) precedes the address-book fill (T005); the migration (T006) + `assign(expires_at)` (T008) precede the store (T009).
- **US1 (P1, MVP)** → **US2 (P1)** → **US3 (P2)** → **US4 (P2)** → **US5 (P3)**. Each ships to `develop` independently once green.
- Within a story: tests before implementation. The verifier (T013) + store (T009) gate the endpoint (T014) → mount (T015) → client call (T016). US2 hardens the same verifier (T020) + endpoint (T021). The `_RESOLVE_SQL` change (T025) makes expiry actually enforced; the renewal math (T026) rides on the store. `useExecutePremiumTx` (T034) gates the pay page (T035) + the confirm gate (T036) + the premium page (T037).
- US1 grants premium for a month (recorded) but expiry is not enforced until US3 (T025) — that is the intended incremental boundary, honest at each step.

## Parallel Opportunities

- Tests are `[P]` (different files): T001 · T007 · T011/T012 · T018/T019 · T023/T024 · T028/T029 · T033.
- Independent modules/docs `[P]`: T004 (types) alongside the contract work; T010, T016/T017, T022, T027, T031/T032, T037/T038.
- Shared-file tasks serialize: `chain/payment_verifier.py` (T013/T020), `api/subscription.py` (T014/T021), `db/subscriptions.py` (T009/T026), `db/limits.py` (T008/T025), `premium/pay/page.tsx` (T031/T035), `useExecutePremiumTx.ts` (T034 impl vs T029 test).

## Implementation Strategy

- **MVP first**: Phase 0 → US1 delivers a buyable premium (pay → verify → grant for a month) — the whole feature's value, shippable alone.
- **Incremental hardening**: US2 closes the exploit surface (buyer-binding, replay, finality) on the same verifier; US3 makes the subscription a real time-boxed product (lazy expiry + extending renewal); US4 proves the constitutional non-custody boundary; US5 replaces the mock pay surface with the real, honest front door.
- Each phase is independently shippable to `develop` and honest at its own boundary.

## Notes

- Commit after each task or logical group; branch **`feature/012-premium-srk-purchase`** off `develop`.
- **Confirm before any `git push` / PR / merge** (repo CLAUDE.md) and before any Coolify/prod or SRK-deploy action (T003/T040).
- Apply `0017` with `PGCLIENTENCODING=UTF8` **before** the agent boots; never-Friday prod deploys; batched prod date. Migration number **0017** is reconciled — feature 011 merged `0016_vault_factory`; do not re-introduce provisional numbering.
- **Non-custody (N2) + buyer-binding + anti-replay + finality are review gates, not afterthoughts** (Constitution I/IV). A premium/expiry/price check that can touch the withdraw path, a buyer taken from the body, or a grant on `status == 0x1` without confirmations is a blocking defect.
- Billing constants (`SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS`) are read **directly**, kept out of the keyless `AgentConfig`; SRK is **not** ABI-exported (viem `erc20Abi` at the call site).
