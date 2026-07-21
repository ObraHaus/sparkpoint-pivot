---
description: "Task list for 011-wrapper-vault-factory"
---

# Tasks: Wrapper Vault Factory

> # ✅ UNBLOCKED — Phase-0 amendment RATIFIED (2026-07-21)
> **The Phase-0 constitution amendment (`v1.3.0 → v2.0.0`, Curated Morpho-Wrapper Vaults) was ratified by
> the operator (super-majority, aldrickb) on 2026-07-21** and recorded in `.specify/memory/constitution.md`
> (full text [`constitution-amendment.md`](./constitution-amendment.md)). The Constitution Check in
> [`plan.md`](./plan.md) is now **GATE PASS**. **T001 (and T002) are DONE**; US2–US5 (template → factory →
> admin manage → app deposit/withdraw) may proceed. The amendment was ratified explicitly by the operator —
> never self-authorized by an agent (ObraHaus Playbook 2.6) — and **before** any implementation task began.

**Input**: Design documents in `specs/011-wrapper-vault-factory/` (spec.md, plan.md, research.md,
data-model.md, contracts/vault-factory-interfaces.md, quickstart.md).

**Tests**: Included and load-bearing — this feature deploys new custodying contracts, so the Foundry
unit/fuzz/fork/invariant suites re-prove N1/N2/N5 under NON-rebasing shares + partial Morpho liquidity, and
a contract audit gates mainnet. Requested in the spec.

**Organization**: Grouped by user story (US1–US5 from spec.md) mapped to Phases 0–4. Phase 0 (US1) is the
governance gate; Phases 1–4 ship independently to `develop` ONLY after T001.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 / US5 (or SETUP / POLISH)
- **Every implementation task is explicitly GATED behind T001** — noted `(BLOCKED by T001)`.

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for any behavior/schema/infra change (the
      template, the factory, the 011-owned `0015_vault_factory.sql` migration (curated-allowlist +
      `sparkpoint_wrappers`), the
      admin-manage endpoints, the address-book factory/curated-vault fields all qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry per user-visible phase
      (US4: manage vaults from admin; US5: deposit/withdraw into a branded vault), stable `slug`.
- [ ] `DEVELOPMENT.md` documents every new config: the factory + curated-vault address-book fields, the
      `MORPHO_GRAPHQL_URL` (mainnet-only) data feed, and any new env var.
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint &&
      build` green; new web/agent tests green.
- [ ] **Foundry unit + fuzz + fork + invariant tests green** — the non-custody re-proof (N1 no-egress, N2
      withdraw-always under partial Morpho liquidity, N5 immutable single-purpose) is the gate, not an
      afterthought (Constitution I).
- [ ] **Contract-audit-before-mainnet gate**: `SparkPointMorphoVault` + `SparkPointVaultFactory` pass an
      external audit + `slither` (`contracts/slither.config.json`) clean before ANY mainnet (8453) deploy.
      Base Sepolia (84532) verification may precede the audit; mainnet MUST NOT.
- [ ] **Non-custody re-proof**: `contracts/script/AssertNonCustody.s.sol` extended to cover the wrapper +
      factory; non-custody invariants confirmed in review (Constitution I/II).
- [ ] No new env var undocumented; no new agent seed dir without an explicit `COPY` in
      `services/agent/Dockerfile` (none expected — 011 adds no seed dir).

---

## Phase 0 → User Story 1 — Ratify the constitution amendment (Priority: P0, GOVERNANCE GATE) ✅ DONE 2026-07-21

**Goal**: obtain the super-majority re-ratification that permits a factory of branded, single-purpose,
NON-upgradeable Morpho-wrapper vaults preserving N1–N5, amending Guardrail IV.5 (extend the whitelist to
curated Morpho vaults for USER-SIGNED branded wrappers), Principle V ("SINGLE … Aave Yield Vault"), and
Principle VII ("launch vault remains single-vault") — while KEEPING the conservative Aave vault as the
DEFAULT and preserving all five non-custody invariants + pause-only killswitch + AI-disposition.

**Independent Test**: quickstart US1 — the amendment record exists, the constitution version is bumped, and
the super-majority approval is logged BEFORE any code lands.

- [x] **T001 [US1] ✅ OPERATOR TASK (human) — ratified the constitution amendment (super-majority), 2026-07-21.**
      The operator (aldrickb) directed + approved the `v1.3.0 → v2.0.0` amendment; the hardened text (closing
      the underlying-curator N1 seam, allowlist governance, immutable target, fee-as-share-dilution, policy-path
      separation — found by a 3-lens adversarial review) is in [`constitution-amendment.md`](./constitution-amendment.md).
      Not self-authorized by an agent (Playbook 2.6). US2+ unblocked.
- [x] T002 [US1] Recorded the ratified amendment: `.specify/memory/constitution.md` bumped to **v2.0.0**
      (Edits 1–9: IV.5 curated-allowlist whitelist, IV.6 every-instance non-upgradeable, V deploy-only factory
      + N1–N5 per wrapper, VII deferrals, Chain&scope, named contracts, amendment-log entry). Files:
      `.specify/memory/constitution.md`.
- [x] T003 [US1] Updated the 011 Constitution Check from **GATE BLOCKED** → **GATE PASS** (ratified amendment
      cited); the honest conflict history is preserved in the amended rows + Complexity Tracking. Files:
      `specs/011-wrapper-vault-factory/plan.md`.
- [ ] T004 [P] [US1] (BLOCKED by T001) `CHANGELOG.md` — `## [Unreleased]` bullet: "gov: ratify Morpho-wrapper
      factory amendment (constitution vX.Y.0)". Files: `CHANGELOG.md`.

**Checkpoint**: amendment ratified + recorded. ONLY NOW may Phases 1–4 begin. If NOT ratified, STOP — the
feature does not exist.

---

## Phase 1 → User Story 2 — `SparkPointMorphoVault` template + non-custody re-proof (Priority: P1) ✅ DONE 2026-07-21

**Goal**: a branded, single-purpose, non-upgradeable ERC-4626 wrapper over ONE curated Morpho vault, with
Foundry unit/fuzz/fork/invariant tests re-proving N1/N2/N5 under NON-rebasing shares + partial Morpho
withdrawal liquidity.

**Independent Test**: quickstart US2.

### Tests for US2 (write first, ensure they fail)

- [ ] T005 [P] [US2] (BLOCKED by T001) Fuzz — non-rebasing accounting: `totalAssets()` tracks
      `morphoVault.convertToAssets(balanceOf)` UP and DOWN (Morpho-side loss reflected, never fabricated);
      deposit/redeem rounding stays in the vault's favor. Files:
      `contracts/test/fuzz/MorphoVault4626.t.sol`.
- [ ] T006 [P] [US2] (BLOCKED by T001) Invariant — N1 no fund-egress selector reaches `feeRecipient`/
      `guardian`/`factory`/any SparkPoint address; N2 `withdraw`/`redeem` succeed while `paused` and while
      the backend is "offline". Files: `contracts/test/invariant/MorphoVaultNonCustody.t.sol`.
- [ ] T007 [P] [US2] (BLOCKED by T001) Fuzz/unit — partial Morpho liquidity: withdraw succeeds up to the
      clamped `maxWithdraw`, reverts cleanly above it (no silent short-fill); Vaults-V2 `max*==0` path
      derives availability from market liquidity (N2 not spuriously blocked). Files:
      `contracts/test/fuzz/MorphoVault4626.t.sol`.
- [ ] T008 [P] [US2] (BLOCKED by T001) Fork — deploy the wrapper over a REAL Base-mainnet curated Morpho
      vault; deposit/withdraw round-trip; profit-only HWM fee accrues only above the HWM. Files:
      `contracts/test/fork/MorphoVaultFork.t.sol`.

### Implementation for US2

- [ ] T009 [P] [US2] (BLOCKED by T001) `ISparkPointMorphoVault` interface per
      [`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §1 (adds
      `morphoVault()`/`factory()`/`label()`; drops Aave views; keeps the full fee/pause/guardian spine).
      Files: `contracts/src/interfaces/ISparkPointMorphoVault.sol`.
- [ ] T010 [US2] (BLOCKED by T001) `SparkPointMorphoVault.sol` — clone `SparkPointVault.sol` by SOURCE,
      swap the Aave leg (`Pool.supply`/`withdraw`, `aUSDC.balanceOf`) for a single `IERC4626 morphoVault`
      (`deposit`/`withdraw`/`convertToAssets`); `totalAssets()` non-rebasing; clamp `maxWithdraw`/`maxRedeem`
      to `morphoVault.maxWithdraw(this)` with the Vaults-V2 fallback; constructor immutables
      (`morphoVault`, `guardian`, `factory`, `capRegistry`); seed the HWM; preserve NO sweep/migrate/rescue
      (N1), pause-deposits-only + withdraw-always (N2), non-upgradeable (N5). Files:
      `contracts/src/vault/SparkPointMorphoVault.sol` (depends on T009).
- [ ] T011 [US2] (BLOCKED by T001) Extend `contracts/script/AssertNonCustody.s.sol` to assert the wrapper
      exposes no fund-egress selector + immutable `morphoVault`. Files:
      `contracts/script/AssertNonCustody.s.sol` (depends on T010).
- [ ] T012 [P] [US2] (BLOCKED by T001) Living docs: `CHANGELOG.md` bullet ("feat(contracts):
      SparkPointMorphoVault template") + `DEVELOPMENT.md` note on the non-rebasing wrapper.

**Checkpoint**: ✅ DONE 2026-07-21 — template compiles + all Foundry suites green (**191 passed / 0 failed /
3 skipped**; 171 pre-existing unchanged; fork test env-gated); N1/N2/N5 re-proven under non-rebasing +
partial liquidity; both adversarial custody reviews **SOUND** (3 minor defense-in-depth items deferred to
the mainnet-audit gate — see `checklists/phase-1-wrapper-template.md`). No factory yet (Phase 2).

---

## Phase 2 → User Story 3 — `SparkPointVaultFactory` + curated allowlist + deploy (Priority: P2) ✅ DONE 2026-07-21

**Goal**: an admin-gated CREATE2 full-bytecode factory that deploys wrappers from a vetted, gated on-chain
Morpho allowlist; holds no funds.

**Independent Test**: quickstart US3.

### Tests for US3 (write first)

- [ ] T013 [P] [US3] (BLOCKED by T001) Unit — `createVault` reverts from non-owner, from a non-allowlisted
      `morphoVault`, and with `feeBps > 2000`; a success pushes to `vaults`, sets `isSparkPointVault`, emits
      `VaultCreated`, and lands at `predictVaultAddress`; the factory rejects value (holds no funds).
      Files: `contracts/test/factory/VaultFactory.t.sol`.
- [ ] T014 [P] [US3] (BLOCKED by T001) Unit — de-allowlisting a curated vault blocks FUTURE deploys but
      leaves an already-deployed instance fully withdrawable (N2). Files:
      `contracts/test/factory/VaultFactoryAllowlist.t.sol`.

### Implementation for US3

- [ ] T015 [P] [US3] (BLOCKED by T001) `ISparkPointVaultFactory` interface per
      [`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §2
      (`createVault`/`predictVaultAddress`/`allowlistMorphoVault`/`isAllowlisted`/`vaults`/
      `isSparkPointVault`; `Caps` struct; NO deposit/withdraw/sweep). Files:
      `contracts/src/interfaces/ISparkPointVaultFactory.sol`.
- [ ] T016 [US3] (BLOCKED by T001) `SparkPointVaultFactory.sol` — `owner`-gated (SHOULD be the Timelock)
      CREATE2 FULL-bytecode deploy (salt = `keccak256(morphoVault,label,chainId)`, NOT a minimal proxy);
      on-chain `morphoAllowlist`; `vaults`/`isSparkPointVault` registry; no `receive`/fund path. Files:
      `contracts/src/factory/SparkPointVaultFactory.sol` (depends on T015, T010).
- [ ] T017 [US3] (BLOCKED by T001) Deploy script — deploy the factory (`owner = TimelockController`),
      allowlist vetted curated vault(s), optionally deploy one smoke-test wrapper. Files:
      `contracts/script/DeployMorphoWrapperFactory.s.sol` (depends on T016).
- [ ] T018 [US3] (BLOCKED by T001) Extend `contracts/test/DeployDeterminism.t.sol` — factory + wrapper
      deploy at their predicted CREATE2 addresses. Files: `contracts/test/DeployDeterminism.t.sol`.
- [ ] T019 [US3] (BLOCKED by T001) Record the factory + curated-vault addresses as PLAIN address-book
      fields (NOT policy `TargetRef`s — no `TARGET_REF_FIELD`/T098 parity impact). Files:
      `packages/shared/src/addresses/base.ts`, `packages/shared/src/addresses/baseSepolia.ts`,
      `packages/shared/src/addresses/types.ts`.
- [ ] T020 [P] [US3] (BLOCKED by T001) Living docs: `CHANGELOG.md` + `DEVELOPMENT.md` (factory/curated-vault
      address fields).

**Checkpoint**: ✅ DONE 2026-07-21 — factory deploys allowlisted wrappers deterministically (predict ==
deployed address), admin/timelock-gated, holding no funds; whitelist-by-construction preserved at the
factory boundary; de-allowlist leaves deployed wrappers withdrawable (N2). `forge test` **209 passed / 0
failed / 3 skipped** (Phase-1's 191 unchanged; +18 new); both adversarial reviews **SOUND** (minor doc/test
notes applied or deferred to the mainnet-audit gate). T019 shared address-book fields added (plain,
non-`TargetRef`) with values left undefined until deploy; T020 living docs done. Full CREATE2/allowlist
gate + no-fund-path verified.

---

## Phase 3 → User Story 4 — `/admin/vaults` MANAGE half (Priority: P2)

**Goal**: the create-vault flow + guardian-gated (timelock) pause/setFee/setFeeRecipient/adjust-caps on the
unified `/admin/vaults` page; the "no move-funds action exists" invariant is visible AND enforced. Reuses
010's READ half.

**Independent Test**: quickstart US4.

### Tests for US4 (write first)

- [ ] T021 [P] [US4] (BLOCKED by T001) Migration — CREATE the two **011-owned** tables `morpho_curated_allowlist`
      + `sparkpoint_wrappers` (`vault_address`, `chain_id`, `kind`, `label`, `morpho_vault`, `native_fee_bps`,
      `deploy_tx`, `factory_address`, `created_at`) apply cleanly (`PGCLIENTENCODING=UTF8`); 010 has no DB table
      to ALTER. Files: `services/agent/migrations/0015_vault_factory.sql` (confirm next-free number at impl
      time; `0014` is the current max), `services/agent/tests/db/…`.
- [ ] T022 [P] [US4] (BLOCKED by T001) BFF unit — `/admin/vaults/create` refuses a non-allowlisted
      `morphoVault` + `feeBps>2000` and returns calldata (never signs); the guardian-action enum contains
      NO fund-moving verb (a fabricated `withdraw`/`sweep`/`migrate` is absent/rejected). Files:
      `services/agent/tests/api/test_admin_vaults.py`.

### Implementation for US4

- [ ] T023 [US4] (BLOCKED by T001) Admin BFF routes (read + prepare-only) per
      [`contracts/vault-factory-interfaces.md`](./contracts/vault-factory-interfaces.md) §4:
      `GET /admin/vaults`, `POST /admin/vaults/create`, `POST /admin/vaults/allowlist`,
      `POST /admin/vaults/{vault}/guardian-action`, `GET /admin/vaults/{vault}` — every mutating route
      returns prepared calldata (CREATE2 / `allowlistMorphoVault` / OZ-Timelock `schedule`+`execute`); NO
      server-held key, NO fund path. Files: `services/agent/src/sparkpoint_agent/api/admin_vaults.py`
      (depends on T021, T016).
- [ ] T024 [US4] (BLOCKED by T001) `/admin/vaults` MANAGE half — create-vault form (validates the curated
      allowlist, shows the predicted CREATE2 address, hands `createVault` calldata to the operator's wallet)
      + guardian-action panel (pause/unpause/setFee/setFeeRecipient/adjust caps via prepared Timelock
      calldata); render the "no move-funds action exists" invariant explicitly (mirror the read-only
      killswitch pattern). Files: `apps/web/src/app/admin/vaults/page.tsx` (depends on T023).
- [ ] T025 [US4] (BLOCKED by T001) Reuse the guardian-timelock signing UX from
      `apps/web/src/app/admin/killswitch/page.tsx` for the wrapper's pause/param actions (no in-app fund
      path). Files: `apps/web/src/app/admin/vaults/page.tsx`.
- [ ] T026 [P] [US4] (BLOCKED by T001) Living docs: `CHANGELOG.md` + `whats-new.json` ("Manage branded
      vaults from Admin") + `DEVELOPMENT.md` + `MIGRATIONS.md` (0015).

**Checkpoint**: operators create + govern wrappers from `/admin/vaults` via user-signed timelock actions; no
move-funds action exists; the 010 read half + 011 manage half share one page.

---

## Phase 4 → User Story 5 — App user-signed deposit/withdraw into a branded wrapper (Priority: P3)

**Goal**: users deposit/withdraw into a branded wrapper via the SAME confirm gate + universal-swap tx
patterns; the wrapper appears in the 010 registry/reader automatically; the double-fee + Morpho-not-Aave
disclosure is honest.

**Independent Test**: quickstart US5.

### Tests for US5 (write first)

- [ ] T027 [P] [US5] (BLOCKED by T001) Agent — `vault_reader.py` reads a `SparkPointMorphoVault` through 010's
      **split** reader (`_ERC4626_CORE_METHODS` + `_SPARKPOINT_EXTRA_METHODS`) with `abiKind:'sparkpoint'` (no
      ABI change needed); a wrapper row with verified `factory_address` provenance renders; unverified
      provenance is refused (fail-closed). Files:
      `services/agent/tests/chain/test_vault_reader.py`.
- [ ] T028 [P] [US5] (BLOCKED by T001) Web — portfolio derive carries `vaultAddress`+`label` for multiple
      vaults; the confirm gate shows the Morpho-not-Aave + stacked-double-fee disclosure. Files:
      `apps/web/src/lib/portfolio/derive.test.ts`.

### Implementation for US5

- [ ] T029 [US5] (BLOCKED by T001) Generalize `useVault.ts` from a singleton `vaultAddressFor(chainId)` to
      resolve BY `vaultAddress` (multi-vault, keyed on the 010 registry) + carry `kind`/`label`/
      `underlyingProtocol`; keep the launch vault the default. Files:
      `apps/web/src/lib/chain/useVault.ts`.
- [ ] T030 [US5] (BLOCKED by T001) `useVaultConfirm.tsx` — de-hardcode the "Aave Yield Vault"/spkUSDC copy;
      for `morpho_wrapper` show the branded `label`, state yield is **Morpho, not Aave**, and disclose the
      SparkPoint fee **stacks** on Morpho's native curator fee (III). Files:
      `apps/web/src/lib/chain/useVaultConfirm.tsx` (depends on T029).
- [ ] T031 [US5] (BLOCKED by T001) `useExecuteVaultTx.ts` + `exit.ts` — deposit/withdraw target the selected
      wrapper (reuse the confirm gate + universal-swap tx patterns); withdraw honors the clamped
      `maxWithdraw` (N2 escape hatch under partial liquidity). Files:
      `apps/web/src/lib/chain/useExecuteVaultTx.ts`, `apps/web/src/lib/chain/exit.ts` (depends on T029).
- [ ] T032 [US5] (BLOCKED by T001) `derive.ts` — widen the `'vault'` arm to carry `vaultAddress`+`label` so
      wrappers + the launch vault coexist in one portfolio view (additive discriminant, not a policy change).
      Files: `apps/web/src/lib/portfolio/derive.ts`.
- [ ] T033 [P] [US5] (BLOCKED by T001) Living docs: `CHANGELOG.md` + `whats-new.json` ("Deposit into branded
      vaults") + the in-app `/changelog` double-fee disclosure copy.

**Checkpoint**: a wrapper is deposit/withdrawable in-app via the confirm gate; it lists automatically in the
010 reader; the double-fee + non-Aave yield is disclosed honestly; N2 holds.

---

## Phase POLISH: Cross-cutting (all BLOCKED by T001)

- [ ] T034 [P] [POLISH] Playwright e2e `admin-vaults-manage.spec.ts` (create → allowlist-gated → predicted
      address) + `branded-vault-deposit.spec.ts` (deposit → disclosure → withdraw under paused). Files:
      `apps/web/e2e/pw/` (`domcontentloaded` + long hydration budget).
- [ ] T035 [POLISH] **Contract audit gate (MANDATORY before any mainnet 8453 deploy)** — external audit +
      `slither` clean on `SparkPointMorphoVault` + `SparkPointVaultFactory`. Base Sepolia verification may
      precede; mainnet MUST NOT. Files: `contracts/slither.config.json`, audit report link in the PR.
- [ ] T036 [POLISH] Re-run the full honest-state matrix (quickstart) on the develop/alpha env (84532) +
      paste evidence into the PR; confirm the wrapper shows in the 010 reader automatically.
- [ ] T037 [P] [POLISH] Confirm NO policy/parity CI drift — the factory/curated-vault fields are plain
      address-book entries, NOT `Asset`/`TargetRef` changes; run the T098 parity check; confirm the
      `policy/enums.py` ↔ `packages/shared/src/policy/enums.ts` `Protocol` enum is UNCHANGED (Constitution
      II/IV — the policy engine is not widened; user-signed deposits are outside it, like 007's swap).
- [ ] T038 [POLISH] Non-custody security self-review vs Constitution I/II/III + the spec FRs (N1 no-egress,
      N2 withdraw-always, N5 immutable single-purpose, honest double-fee + Morpho-not-Aave) before
      requesting review.

---

## Dependencies & Execution Order

- **T001 (Phase 0, GOVERNANCE GATE) is an absolute prerequisite for EVERYTHING** — no T002+ starts until the
  operator ratifies. If not ratified, the feature does not exist.
- Then **US2 (P1, template) → US3 (P2, factory) → US4 (P2, admin) → US5 (P3, app)**. Each ships to `develop`
  independently AFTER T001.
- Within a story: tests before implementation. US3's factory (T016) depends on the US2 template (T010).
  US4's admin BFF (T023) depends on the migration (T021) + factory (T016). US5's web (T029–T032) depends on
  the deployed wrapper + 010 registry rows.
- **Mainnet (8453) deploy is gated on the T035 audit** in addition to T001.

## Parallel Opportunities

- T005/T006/T007/T008 (Foundry suites) · T013/T014 (factory tests) · T021/T022 (migration + BFF unit) ·
  T027/T028 (agent + web unit) · all living-docs [P] tasks. Different-file [P] tasks within a phase run
  concurrently; shared-file tasks (`SparkPointMorphoVault.sol`, `SparkPointVaultFactory.sol`, `useVault.ts`,
  `admin/vaults/page.tsx`) must serialize.

## Notes

- Branch `011-wrapper-vault-factory` off `develop` — but ONLY after T001 is ratified.
- Confirm before any `git push` / PR / merge (repo CLAUDE.md) and before any Coolify/prod or mainnet action.
- Companion feature 010 (Universal Vaults, read/advisory half) owns the **static-config registry**
  (`AddressBook.vaults[]`; no DB table) + the generic reader; 011 owns the runtime `sparkpoint_wrappers` store,
  writes the rows the reader merges, and adds the manage half of the shared `/admin/vaults` page.
- Non-custody + honest disclosure are review gates, not afterthoughts (Constitution I/II/III); the T035
  audit + the Foundry non-custody re-proof are hard gates before mainnet.
