---
description: "Task list for 014-fee-multisig"
---

# Tasks: Fee Treasury Multisig Migration

**Input**: Design documents in `specs/014-fee-multisig/` (spec.md, plan.md, research.md, data-model.md, contracts/fee-multisig-interfaces.md, quickstart.md)

**Tests**: Included — this feature sits on the custody-governance boundary (N5 / Principle III), so the ceremony semantics (guardian-only setter, schedule→wait→execute, zero-address reject), the single-canonical-treasury address resolution, the `FEE_WALLET_ADDRESS` normalization, the swap-fee follow-the-vault fallback, the provable-nil-power surfaces, and the honest-degrade balance read are all tested. Required by the spec's Independent Tests + Success Criteria + Constitution (contract fuzz, custody-untouched, no-key-committed, honest-degrade).

**Organization**: Grouped by user story (US1–US5 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 / US5 (or SETUP / POLISH)
- Include exact file paths in descriptions

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for each change (the Safe as fee treasury; the Timelock `setFeeRecipient` ceremony; the Base-swap-fee auto-follow; the 46630 constant move; the new `FEE_WALLET_ADDRESS` config + the `feeTreasury` address-book field; the Trust-Center nil-power proof).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase, stable `slug` (US1/US2/US3: "the fee treasury is now a 2-of-3 multisig, receiving all protocol fees"; US4: "provably no power over your funds — see it on the Trust Center"). US5 is admin-only ⇒ **no** client entry.
- [ ] `MIGRATIONS.md` records **NO new migration** for 014 — explicitly state 014 adds none; the latest migration on disk is `0016_vault_factory.sql` (feature 011). No `PGCLIENTENCODING=UTF8` step and **no `services/agent/Dockerfile` seed-dir COPY** apply (there is no schema and no new seed dir) — confirm none was added.
- [ ] `DEVELOPMENT.md` documents the non-key `FEE_WALLET_ADDRESS` env var + the `feeTreasury` address-book field; `DEPLOYMENT.md` records the Safe creation + the Timelock `schedule`/`execute` ceremony (tx hashes, salt, before/after recipient — FR-016); `COOLIFY.md` records the 46630 web redeploy.
- [ ] `changelog-required` CI green (or `skip changelog` + justification); `pnpm -w typecheck && lint && build` green; agent `pytest` green; **contract `forge test` + fuzz green** for the ceremony fork test (no contract source edit — the setter already exists, so it is asserted, not modified); **N5 + N2 confirmed in review** (Constitution I/III — the Safe has provably nil authority over user funds; the withdraw-always exit is untouched).
- [ ] **No signer private key or seed** appears in the repo or committed config — only public addresses (FR-003, SC-006). No new env var left undocumented.

---

## Phase 0: Groundwork — address-book field + agent config constant (no Safe yet, no behavior change)

**Purpose**: land the additive, address-only plumbing so every later phase resolves the treasury from one place. Ships alone; the field is unset and the constant is `None`, so nothing changes on-chain or in the UI.

- [x] T001 [SETUP] `packages/shared/src/addresses/types.ts` — add a **plain optional** `readonly feeTreasury?: Address` field to `AddressBook` (mirrors `swapFeeRecipient`; explicitly **NOT** a `TargetRef` / no `TARGET_REF_FIELD`, no parity/drift impact) per data-model.md.
- [x] T002 [P] [SETUP] `services/agent/tests/config/test_config.py` — write first (fails until T003): a well-formed `FEE_WALLET_ADDRESS` normalizes onto `AgentConfig.fee_wallet_address`; a malformed value fails closed at load (like `SPARKPOINT_VAULT_ADDRESS`); an absent value yields `None`; `_assert_no_key_material()` still passes (contracts §5).
- [x] T003 [SETUP] `services/agent/src/sparkpoint_agent/config.py` — add `FEE_WALLET_ADDRESS_ENV = "FEE_WALLET_ADDRESS"`; in `from_env()` resolve `fee_wallet_address = _normalize_address(raw, FEE_WALLET_ADDRESS_ENV) if raw else None` (public address only, `_ADDRESS_RE = ^0x[0-9a-fA-F]{40}$`, copies the `SPARKPOINT_VAULT_ADDRESS` convention) (depends on T002).
- [x] T004 [P] [SETUP] `CHANGELOG.md` `## [Unreleased]` bullet: "feat(config): non-key `FEE_WALLET_ADDRESS` + `feeTreasury` address-book field (fee-treasury address of record)".

**Checkpoint**: `feeTreasury?` type field + `FEE_WALLET_ADDRESS` normalization exist and are green; both unset/`None`; no Safe, no fee moved, no UI change.

---

## Phase A → User Story 1 — Stand up the Safe and make it the address of record (Priority: P1) 🎯 MVP

**Goal**: create the 2-of-3 Safe on Base Sepolia and record its address as the single canonical fee-treasury reference — in the address book and the agent config — without moving any fee.

**Independent Test**: quickstart US1.

### Tests for US1 (write first, ensure they fail)

- [x] T005 [P] [US1] `packages/shared/src/addresses/feeTreasury.test.ts` — `getAddresses(84532).feeTreasury` resolves a **single** canonical Safe address; **no** code path resolves two different fee-treasury addresses for a network (FR-002); the field is a plain `Address` with no key material (FR-003) (fails until T008).

### Implementation for US1

- [x] T006 [US1] **Operator action** — create the **2-of-3 Safe** on Base Sepolia via `app.safe.global` (New Safe → Base Sepolia → owners `0xA71e24359A6cb7A939aae2d62dD12b6256365c30` (deployer) + `0x867ED872388D9fB613892E0a73c696c2207E5fEb` + `0x122DAB67a798179304CFEe0CD143b121E7A805Ed`, threshold 2). **No** Safe SDK / Foundry. Capture the Safe address as `$SAFE`; record its creation in `DEPLOYMENT.md`. ⚠️ Confirm before any on-chain action.
- [x] T007 [P] [US1] Repo-hygiene scan — `git grep -nE '(PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|mnemonic|seed phrase)' -- . ':!*.md'` returns clean; confirm the two new signer keys live only at `/home/hello/project/.claude/testnet-wallets.txt` (`0600`, outside the repo) — never committed (FR-003, SC-006).
- [x] T008 [US1] `packages/shared/src/addresses/baseSepolia.ts` — record `feeTreasury: "$SAFE"` (address of record only; it does **not** itself move the vault fee — that is US2) (depends on T001/T006).
- [x] T009 [US1] Set `FEE_WALLET_ADDRESS=$SAFE` in the `services/agent` dev/staging env and document it in `DEVELOPMENT.md` (public address only) (depends on T003/T006).
- [x] T010 [P] [US1] Verify no-op-on-chain (US1 acceptance #4): accrue a fee before US2 and confirm it still lands on the current recipient `0xA71e…5c30` — recording the address alone moves no money.
- [x] T011 [P] [US1] Living docs: `CHANGELOG.md` bullet + `services/agent/content_seed/whats-new.json` client entry ("Your protocol fees now flow to a 2-of-3 multisig treasury") + `DEVELOPMENT.md` `feeTreasury` field.

**Checkpoint**: one canonical Safe address resolves through the address book **and** the agent config; no signer key committed; no fee flow changed yet.

---

## Phase B → User Story 2 — Re-point the vault fee recipient via the Timelock ceremony (Priority: P1) 🛡️

**Goal**: move the vault `_feeRecipient` from the deployer EOA to the Safe **only** through `schedule`→wait `minDelay`→`execute`; this also auto-moves the Base / Base-Sepolia swap fee. No redeploy, immutable guardian untouched.

**Independent Test**: quickstart US2.

### Tests for US2 (write first, ensure they fail)

- [ ] T012 [P] [US2] `contracts/test/fork/FeeRecipientMigration.t.sol` — Foundry fork test (contracts §1/§2): a direct EOA `setFeeRecipient(Safe)` reverts `NotGuardian`; `schedule` with `delay < minDelay` rejected; an `execute` **before** the delay rejected; after the delay `execute` (msg.sender == guardian) succeeds, emits `FeeRecipientUpdated(old, Safe)`, and `feeRecipient() == Safe`; `setFeeRecipient(0x0)` reverts `ZeroAddress`; the derived `opId == hashOperation(...)` and a reused `(target,value,data,predecessor,salt)` collides (fresh salt required); the **vault address + immutable `_guardian` are unchanged** and `_feeRecipient` is the only state that changes. Include a fuzz case over `newRecipient` (non-zero ⇒ set; zero ⇒ revert).
- [ ] T013 [P] [US2] `apps/web/src/lib/swap/useSwapConfirm.test.ts` — with `baseSepolia.ts` leaving `swapFeeRecipient` unset, the resolved swap-fee recipient equals the live `vault.feeRecipient()` (so it follows the vault); setting `swapFeeRecipient` on Base Sepolia is explicitly NOT done (contracts §3, FR-007, D8).

### Implementation for US2

- [x] T014 [US2] **On-chain, as PROPOSER** — encode `DATA = cast calldata "setFeeRecipient(address)" $SAFE`; pick a **fresh** `SALT`; `schedule(target=VAULT 0x15D269…47f2, value=0, data=DATA, predecessor=0x0, salt=SALT, delay=60)` on `TimelockController 0x0A21A9B4c2cd2d6a68EC828188826B673572d720` (quickstart §Run step 3). ⚠️ Confirm before any on-chain action (depends on T008).
- [x] T015 [US2] **Verify BEFORE execute (D12/FR-005)** — re-derive `opId = hashOperation(VAULT,0,DATA,0x0,SALT)`, assert `isOperationPending(opId)`, and re-check the encoded selector + `$SAFE` argument in `DATA` before proceeding (depends on T014).
- [x] T016 [US2] **On-chain, as EXECUTOR** — after `>= minDelay`, `execute(VAULT,0,DATA,0x0,SALT)`; confirm settlement by a **live** `feeRecipient() == $SAFE` read at sufficient depth (never the execute receipt alone — testnet reorg) and by the `FeeRecipientUpdated` event (FR-008, D12) (depends on T015).
- [x] T017 [US2] On-chain post-cutover assertion — `cast call VAULT "feeRecipient()(address)" == $SAFE`, and confirm the **vault address + guardian are unchanged** vs `contracts/deployments/84532/addresses.json` (SC-002, FR-006) (depends on T016).
- [x] T018 [P] [US2] Verify a Base-Sepolia swap now routes its fee to the Safe **automatically** via the `swapFeeRecipient ?? vault.feeRecipient()` fallback, with **no** address-book change (FR-007) (depends on T016).
- [x] T019 [P] [US2] Living docs: `DEPLOYMENT.md` ceremony record (schedule/execute tx hashes, the salt, before/after recipient — FR-016) + `CHANGELOG.md` bullet.

**Checkpoint**: `feeRecipient() == Safe` via the Timelock; the Base swap fee follows automatically; no redeploy; the immutable guardian is untouched.

---

## Phase C → User Story 3 — Move the Robinhood 46630 swap fee to the Safe (Priority: P2)

**Goal**: update the hardcoded 46630 `swapFeeRecipient` constant to the Safe **and** redeploy web — complete only when both land. Independent of the Timelock (46630 has no vault).

**Independent Test**: quickstart US3.

### Tests for US3 (write first, ensure they fail)

- [ ] T020 [P] [US3] `packages/shared/src/addresses/robinhoodTestnet.test.ts` — `getAddresses(46630).swapFeeRecipient` equals the Safe after the edit; a zero/unset `swapFeeRecipient` on 46630 is disallowed (it would make the 46630 swap fee-free); the value is a plain `Address` with no key material (contracts §4, FR-009) (fails until T021).

### Implementation for US3

- [ ] T021 [US3] `packages/shared/src/addresses/robinhoodTestnet.ts` — change `swapFeeRecipient` from `0xA71e24359A6cb7A939aae2d62dD12b6256365c30` → the Safe (constant surface; does NOT follow the Timelock) (depends on T006).
- [ ] T022 [US3] **Redeploy `apps/web` on Coolify** — the change is NOT "done" until web ships the new bundle (FR-009, US3 acceptance #2); record in `COOLIFY.md`. ⚠️ Confirm before any Coolify/prod action (depends on T021).
- [ ] T023 [P] [US3] Verify a 46630 swap pays the Safe post-redeploy; confirm the US2 Timelock change did **not** affect 46630 (it has no vault — US3 acceptance #3) (depends on T022).
- [ ] T024 [P] [US3] Living docs: `CHANGELOG.md` bullet + `COOLIFY.md` (the 46630 web redeploy) + fold into the shared whats-new treasury entry.

**Checkpoint**: the 46630 swap fee pays the Safe after edit **and** redeploy; unaffected by the Timelock.

---

## Phase D → User Story 4 — Prove the Safe has zero fund-movement power (Priority: P2) 🛡️

**Goal**: the Trust Center / fees page prove, from live chain data, that the fee treasury is the Safe **and** that its authority over user funds is nil (N5). No data-source change — the surfaces already read `feeRecipient()` live.

**Independent Test**: quickstart US4.

### Tests for US4 (write first, ensure they fail)

- [ ] T025 [P] [US4] `apps/web/e2e/pw/fees.spec.ts` — the fees page + `NonCustodyBadge` show the Safe as the fee recipient within one page load of `execute`, with **no** data-source change (SC-003); the Trust Center permissions view represents the Safe's authority over user funds as **nil** (not guardian, no withdraw/redeem path) — provable from chain, not asserted; a withdraw/redeem is entirely **unaffected** (SC-004, FR-013) (`domcontentloaded` + long hydration budget on the CPU-starved box) (contracts §6).

### Implementation for US4

- [x] T026 [US4] `apps/web/src/app/(app)/trust/permissions/page.tsx` — surface the fee treasury's exact (nil) authority over user funds, **derived from chain** (guardian != Safe; no fund-movement path ⇒ power = NONE) — provable, not asserted copy (FR-012, Principle III / N5).
- [x] T027 [P] [US4] `apps/web/src/app/(app)/fees/page.tsx` — copy may note the treasury is now a multisig, but the **data source is unchanged** (still reads `vault.feeRecipient()` live); confirm `apps/web/src/components/NonCustodyBadge.tsx` needs **no** change (already live-reads).
- [x] T028 [P] [US4] Confirm the withdraw-always exit path is untouched (`apps/web/src/app/(app)/trust/exit/page.tsx`) — no limit, delay, or authority introduced by this feature touches it; the Safe cannot block, delay, or capture an exit (FR-013, N2, SC-004).
- [x] T029 [P] [US4] Living docs: `services/agent/content_seed/whats-new.json` ("Provably no power over your funds — verify it on the Trust Center") + `CHANGELOG.md` bullet.

**Checkpoint**: the Trust Center proves the Safe's nil power from chain; the fees page reflects the Safe live; the exit path is demonstrably unaffected.

---

## Phase E → User Story 5 — Operators see the Safe's balances on /admin/revenue (Priority: P3)

**Goal**: the admin revenue dashboard shows the Safe's real native + fee-token balances from a live on-chain read, honest-degrading (never a fabricated figure). This feature supplies the address + requirement; feature 013 owns the card.

**Independent Test**: quickstart US5.

### Tests for US5 (write first, ensure they fail)

- [ ] T030 [P] [US5] `apps/web/src/app/admin/revenue/revenue.test.ts` — the Safe balance card reflects **real** live `eth_getBalance` + ERC20 `balanceOf` (no persisted/cached figure treated as truth); `configured:false` honest-degrade ("cannot load") when the read is unavailable (mirrors `admin_usage.py`) — never a number in that state; a real zero renders as a real zero, not a placeholder (`SafeBalanceCard` shape, contracts §7, FR-014, SC-005).

### Implementation for US5

- [x] T031 [US5] Confirm feature 013's admin-revenue Safe-balance card (`apps/web/src/components/admin/revenue-multisig.tsx`) resolves the Safe **client-side** via `getAddresses(chainId).feeTreasury` (the address-of-record 014 sets, kept in sync with the agent `FEE_WALLET_ADDRESS`) and renders `SafeBalanceCard { configured, address, native, tokens[] }` from the live `eth_getBalance` + ERC20 `balanceOf` reads; 014 supplies the address, 013 owns the card (depends on T006/T009).
- [ ] T032 [P] [US5] Honest-degrade path — when the RPC read is unavailable, render `configured:false` "cannot load" (never a fabricated/sample figure); a real zero balance renders as a real zero (FR-014, US5 acceptance #2/#3).
- [ ] T033 [P] [US5] Living docs: `CHANGELOG.md` bullet (admin-only ⇒ no whats-new client entry).

**Checkpoint**: `Admin → Revenue` shows the Safe's real balances or an honest "cannot load"; no placeholder in any state.

---

## Phase POLISH: Cross-cutting

- [ ] T034 [P] [POLISH] Re-verify all surfaces on the develop/alpha environment across 84532 (vault + Base swap) + 46630 (constant); paste evidence (fees page + Trust Center reflect the Safe live; admin-revenue real-or-honest-degrade) into the PR body.
- [ ] T035 [POLISH] Contract-level review — run `contracts && forge test --match-path 'test/**/FeeRecipientMigration*.t.sol'` + fuzz and confirm **no contract source was edited** (the `setFeeRecipient` setter already exists; the migration is a ceremony, asserted not modified — contracts §1).
- [ ] T036 [P] [POLISH] Re-run the no-key repo scan and confirm the **shipped web bundle** carries the Safe on 46630 (Robinhood constant-drift check — edit without redeploy leaves the old EOA, research §Adversarial).
- [ ] T037 [POLISH] Security + non-custody self-review vs Constitution I/III (N1–N5, N2): the Safe has provably nil authority over user funds (not guardian, no Timelock role, no withdraw/redeem path); the withdraw-always exit is untouched; live reads honest-degrade; the ceremony moved only *where fees land*, not *who governs the vault* — before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first (address-book field + config constant) — every later phase reads it.
- **US1 (P1, MVP)** → **US2 (P1)** → **US3 (P2)** → **US4 (P2)** → **US5 (P3)**. Each ships to `develop` independently once green.
- Within a story: tests before implementation. The Safe creation (T006) gates recording it (T008/T009), which gates the Timelock schedule (T014). The ceremony is strictly sequential: `schedule` (T014) → verify (T015) → `execute` (T016) → assert (T017) → swap-fee check (T018). The Robinhood edit (T021) gates the web redeploy (T022) gates verification (T023). `FEE_WALLET_ADDRESS` recorded (T009) gates the admin-revenue card (T031).
- T006 / T014 / T016 / T022 are **operator / on-chain / Coolify** actions — confirm before each. **Cross-feature sequencing hint (D11, not a hard dep):** create + record the Safe (Phase A) first so 012/013 target it, and execute the vault Timelock move (Phase B) last to minimize the swap-fee indexer's dual-address window.

## Parallel Opportunities

- Tests are `[P]` (different files): T002 · T005 · T012/T013 · T020 · T025 · T030.
- Independent modules/docs `[P]`: T004, T007/T010/T011, T018/T019, T023/T024, T027/T028/T029, T032/T033, T034/T036.
- Serialized (shared file / on-chain sequence): the ceremony T014→T015→T016→T017; `robinhoodTestnet.ts` edit→redeploy T021→T022; the address-book edits T001→T008.

## Implementation Strategy

- **MVP first**: Phase 0 + US1 ship a recorded, multi-signer treasury address that changes no money flow — safe to land on `develop` alone (no on-chain fee move, cannot regress custody).
- **Incremental**: US2 moves the real revenue (vault + Base swap) via the delayed public ceremony; US3 catches the independent 46630 surface; US4 proves the non-custody posture from chain; US5 adds operator visibility. Each is independently valuable and independently shippable.

## Notes

- Commit after each task or logical group; branch **`feature/014-fee-multisig`** off `develop`.
- **Confirm before any `git push` / PR / merge** (repo CLAUDE.md) and before any on-chain (T006/T014/T016) or Coolify (T022) action.
- **No database migration** — 014 adds none; latest on disk is `0016_vault_factory.sql` (012 works `0017_subscriptions.sql`, 013 `0018_swap_fee_events.sql`; do not reintroduce provisional numbering). Record the "no migration" fact in `MIGRATIONS.md`.
- **No Safe SDK / `@safe-global/*`** is added — the Safe is created via `app.safe.global` and is a plain, non-privileged holder.
- **N5 + N2 are review gates, not afterthoughts** (Constitution I/III). A Safe with any fund-movement power over user funds, or any change that touches the withdraw path, is a blocking defect.
