---
description: "Task list for SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)"
---

# Tasks: SparkPoint Pivot — AI-Native Onchain Hedge Fund (Launch MVP)

**Input**: Design documents from `/specs/001-sparkpoint-pivot-mvp/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/ (smart-contracts.md, agent-service-api.md, policy-schema.md)

**Tests**: Tests are OPTIONAL per Spec Kit. This feature is safety-critical, so contract/integration tests for the smart contracts and the five non-custody invariants (N1–N5) and the simulation-before-sign gate are INCLUDED and are gating; frontend tests are kept light.

> **AS-BUILT STATUS (2026-07-16) — the ledger is authoritative, not these checkboxes.** The Phase-2 build is **complete and deployed to develop**: waves W0–W6, operator work orders P0–P2, and **Phase A** (LLM gateway) / **Phase B** (SIWE auth + beta/admin gates + real shell + admin panel) / **Phase B.1** (auth hardening) / **Phase C** (embedder pin, knowledge T123 gaps, ve(3,3) fix, portfolio labels) all landed and CI-green. US1 (vault) is LIVE on Base Sepolia with non-custody proven on-chain; US2 (ERC-4337 account) built; US3–US5 (assistant) live behind the policy gate; US6 (session-key automation) is **Phase 3, undeployed**. **The authoritative, maintained state is `docs/orchestration/{wave-state.json,GATES.md}`** — the per-task checkboxes below are the ORIGINAL plan and are not individually ticked. The **Phase-2 Obsidian knowledge tier (T121–T126)** was added after this list was first written; it is captured in the block at the end of this file.

**Organization**: Tasks are grouped by user story (US1–US6, in priority order) to enable independent implementation and testing of each story. Phase 1 (Setup) and Phase 2 (Foundational) are shared and blocking. The final phase is Polish & cross-cutting.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6); blank for shared Setup/Foundational/Polish
- Exact file paths follow the monorepo structure in plan.md (`apps/web`, `services/agent`, `contracts`, `packages/shared`, `infra`)

## Monorepo path conventions (from plan.md)

- **Frontend**: `apps/web/` (Next.js App Router, Tailwind, shadcn/ui, Wagmi/Viem)
- **Agent service**: `services/agent/` (Python 3.12, FastAPI, OpenClaw/Hermes, `uv`)
- **Contracts**: `contracts/` (Foundry, Solidity `^0.8.24`, `evm_version=cancun`)
- **Shared seam**: `packages/shared/` (TS types, ABIs, address registry, zod schemas, **policy constants** — single source of truth for caps/slippage/allowlist)
- **Infra**: `infra/docker/`, `infra/deploy/`; CI in `.github/workflows/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo initialization, tooling, and CI scaffolding.

- [ ] T001 Initialize pnpm workspace + Turborepo at repo root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.nvmrc` (Node 22), `.editorconfig` per plan.md Project Structure
- [ ] T002 [P] Create `apps/web` Next.js 14 (App Router) + React 18 skeleton with TailwindCSS + shadcn/ui (Radix) + Recharts; `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx` (dark-first, tabular numerals, WCAG AA base)
- [ ] T003 [P] Create `services/agent` Python 3.12 skeleton managed by `uv`: `services/agent/pyproject.toml`, `services/agent/Dockerfile`, `services/agent/src/sparkpoint_agent/__init__.py`, FastAPI app entry `services/agent/src/sparkpoint_agent/api/main.py`
- [ ] T004 [P] Create `contracts` Foundry project: `contracts/foundry.toml` (`evm_version=cancun`, solc `^0.8.24`), `contracts/remappings.txt`, install OZ v5, `eth-infinitism/account-abstraction` (EntryPoint v0.7), Solady, forge-std via `contracts/.gitmodules`
- [ ] T005 [P] Create `packages/shared` TS package: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts` (will hold types, ABIs, address registry, zod schemas, policy constants)
- [ ] T006 [P] Configure linting/formatting: root ESLint + Prettier for TS (`.eslintrc.cjs`, `.prettierrc`), `ruff` + `mypy` config in `services/agent/pyproject.toml`, `forge fmt` config in `contracts/foundry.toml`, Slither config `contracts/slither.config.json` (advisory)
- [ ] T007 [P] CI workflows in `.github/workflows/`: `ci.yml` (root orchestration), `web.yml` (lint+typecheck+vitest), `agent.yml` (ruff+mypy+pytest), `contracts.yml` (forge build+test+fuzz+invariant, Slither advisory) — the N1–N5 invariant suite must be a required check
- [ ] T008 [P] Create `.env.example` at repo root documenting all secrets/keys (Alchemy Base RPC, Anthropic API, Tenderly, Dune, Postgres DSN, WalletConnect projectId, bundler) — **no real secrets committed**, per plan.md Storage ("no keys ever stored")

**Checkpoint**: All four workspaces build/lint clean; CI runs green on an empty skeleton.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared infrastructure that MUST be complete before ANY user story. Includes the contract⇄app seam, the deterministic policy engine scaffold, agent/DB/wallet skeletons, and the env/secrets plumbing.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The policy constants seam (T009) and the policy engine scaffold (T018) are load-bearing for every later story.

### Shared seam, policy constants, and ABIs (single source of truth — prevents off-chain/on-chain drift)

- [ ] T009 Define the single-source-of-truth **policy constants** in `packages/shared/src/policy/constants.ts`: `policyVersion` (`policy@2026.06.0`), caps (perUserTvl/total/vaultDeposit/sessionPerTx/sessionCumulative + ceilings), slippage (userMax/protocolFloor/absoluteCeiling), and the `(protocol, target, selector, assets, recipientMustBe, capGated, pauseGated, direction)` allowlist per policy-schema.md §3–§6 (BLOCKS T018, ArmGuardrails, on-chain seeding)
- [ ] T010 [P] Define canonical enums + reason codes in `packages/shared/src/policy/enums.ts`: `Protocol`, `Asset`, `ActionType`, `Direction`, `RiskProfile`, reason codes per policy-schema.md §2
- [ ] T011 [P] Address registry per chain in `packages/shared/src/addresses/{base,baseSepolia,localFork}.ts`: EntryPoint v0.7, Aave v3 Pool + WrappedTokenGatewayV3 + aUSDC, Aerodrome Router + Factory, USDC/WETH, plus placeholders for deployed SparkPoint contracts (filled by deploy)
- [ ] T012 [P] Zod schemas for the agent-service wire contract in `packages/shared/src/schemas/`: `IntentBundle`, `SimulationResult`, `PolicyVerdict`, `GuardrailCheck`, `Citation`, `ChatBlock`, `ActionType` per agent-service-api.md §2 (consumed by frontend fail-closed rendering)

### Contracts skeleton (interfaces + base scaffolding only; full logic lives in story phases)

- [ ] T013 [P] Create contract interfaces in `contracts/src/interfaces/`: `ISparkPointAccount`, `IAccountFactory`, `ISessionKeyValidator`, `IPolicyModule`, `ISparkPointVault`, plus `IPool`, `IAToken`, `IWrappedTokenGatewayV3`, `IAerodromeRouter`, `IEntryPoint`, and the `IntentLog` event, transcribed verbatim from contracts/smart-contracts.md §2–§6
- [ ] T014 [P] Stub source files (compile-only skeletons) in `contracts/src/`: `account/{SparkPointAccount,AccountFactory,SessionKeyValidator,PolicyModule}.sol`, `vault/SparkPointVault.sol`, `adapters/{AaveV3Adapter,AerodromeAdapter}.sol`, `governance/{CapRegistry,KillSwitch}.sol` — signatures + events only, so the test harness and ABI export compile
- [ ] T015 ABI export pipeline: `contracts/script/ExportAbis.s.sol` or build hook emitting ABIs to `packages/shared/src/abis/` consumed by frontend `lib/chain` (Turbo task wires `contracts` build → `packages/shared`)

### Database (Postgres + pgvector) — derived index only, never on the custody/withdrawal path

- [ ] T016 Provision Postgres + pgvector migration framework in `services/agent/`: pick migration tool (e.g. `alembic` or `yoyo`), `services/agent/migrations/`, enable `pgvector`, `citext`, UUID v7 helper; base conventions per data-model.md §0 (NUMERIC(78,0), TIMESTAMPTZ, CITEXT addresses)
- [ ] T017 Foundational schema migration `services/agent/migrations/0001_foundation.sql` creating shared/supporting tables that all stories depend on: `users`, `beta_whitelist`, `smart_accounts`, `audit_logs` (append-only via trigger), `onchain_events`, `price_snapshots`, `indexer_cursors`, `data_source_health`, `memory_chunks` (pgvector) per data-model.md §3,§4,§15,§16,§17

### Deterministic policy engine scaffold (G1 — the spine; pure, LLM-free, fail-closed)

- [ ] T018 Scaffold the pure deterministic policy layer in `services/agent/src/sparkpoint_agent/policy/`: `evaluate(action, context) -> PolicyVerdict` with the ordered, fail-closed step machine (SCHEMA → PROTOCOL → ASSET → RECIPIENT → CAPS(exit-skip) → MANDATE → SLIPPAGE/SIM → FRESHNESS → KILL-SWITCH(exit-skip) → SESSION) per policy-schema.md §8; loads constants from `packages/shared` (mirrored), **no LLM/embeddings/cache on the decision path** (depends on T009/T010)
- [ ] T019 [P] Policy-layer audit hook: write a `policy_evaluations`/`audit_logs` row (actor=`policy_layer`, `policy_version`, per-check reasons) for every verdict in `services/agent/src/sparkpoint_agent/policy/audit.py` per data-model.md §15.2 / VR-A2

### Agent service skeleton (Dockerized; holds no keys)

- [ ] T020 FastAPI app skeleton + auth middleware in `services/agent/src/sparkpoint_agent/api/`: service-to-service bearer auth, `X-Account`/`X-Owner`/`X-Chain-Id` header parsing, `Idempotency-Key` handling, standard error envelope + canonical error codes per agent-service-api.md §1
- [ ] T021 [P] Deterministic Coordinator DAG scaffold (no LLM router) in `services/agent/src/sparkpoint_agent/coordinator/dag.py` and the five empty agent modules `services/agent/src/sparkpoint_agent/agents/{portfolio_reader,strategy_recommender,executor,vault_manager,guardrail}.py` per plan.md Layer 2
- [ ] T022 [P] Scoped tool registries in `services/agent/src/sparkpoint_agent/tools/`: read tools (Dune/subgraph/DeFiLlama/RPC) broadly available; build/simulate tools (unsigned calldata + Tenderly) ONLY in executor/vault_manager registries; Portfolio Reader physically cannot build a tx (capability separation per plan.md Layer 2)
- [ ] T023 [P] Anthropic Claude client wrapper in `services/agent/src/sparkpoint_agent/llm/claude.py` (`claude-opus-4-8`, adaptive thinking, per-agent effort, `tool_runner`/`@beta_tool`), with refusal handling (`stop_reason == "refusal"` → safe fallback, no fabricated rec)

### Frontend foundation (wallet connect + custody-critical chain seam)

- [ ] T024 Wagmi v2 + Viem v2 providers in `apps/web/app/providers.tsx` and `apps/web/lib/chain/clients.ts`: WalletConnect v2 + Coinbase Wallet SDK connectors, TanStack Query v5, Base mainnet (8453) + Base Sepolia (84532)
- [ ] T025 The AA-SDK-swappable account adapter in `apps/web/lib/chain/account/` (thin interface so a ZeroDev/Kernel fallback swaps one module, not the UI) per plan.md Complexity Tracking, plus ABIs+addresses wiring in `apps/web/lib/chain/abis.ts` consuming `packages/shared`
- [ ] T026 [P] Edge geo-fence middleware `apps/web/app/middleware.ts` that gates app surfaces but **lets `/exit` and `/trust` through** (N2 escape hatch + provability never geo-blocked) per spec edge cases / FR-044 (SC-014)
- [ ] T027 [P] Typed agent client (SSE/REST) + fail-closed Zod card schemas in `apps/web/lib/agent/client.ts` and `apps/web/lib/agent/cards.ts` consuming `packages/shared` schemas; unknown/invalid blocks render inert (per plan.md Layer 1)
- [ ] T028 [P] Client-side policy mirror (display-only) in `apps/web/lib/policy/mirror.ts` consuming `packages/shared` constants — labels caps/allowlist/slippage in UI; chain is truth (never gates signing)

### Infra (local bring-up)

- [ ] T029 [P] Docker Compose local stack `infra/docker/compose.yml`: agent + Postgres/pgvector + Anvil (forked Base) per plan.md infra + quickstart.md; env templates `infra/deploy/env/*.template`
- [ ] T030 [P] Env/secrets management: typed config loader `services/agent/src/sparkpoint_agent/config.py` and `apps/web/lib/env.ts` validating required vars from `.env.example`; assert no private keys/secrets are persisted anywhere (plan.md Storage)

**Checkpoint**: Foundation ready — `pnpm dev` + `docker compose up` brings up web + agent + pgvector + Anvil fork; policy `evaluate()` scaffold rejects a malformed action; contracts compile and export ABIs. User story implementation can now begin.

---

## Phase 3: User Story 1 — Deposit into the Aave Yield Vault and withdraw anytime (Priority: P1) 🎯 MVP

**Goal**: A whitelisted user deposits USDC into the single 0-management / profit-only performance-fee, non-upgradeable Aave Yield Vault, accrues Aave yield (net of a 10%-of-yield performance fee charged only above a high-water mark, 0% on principal, hard-capped at 20%), and can withdraw in full at any time — including a direct onchain exit with the frontend and agents offline and while paused. Delivers the core promise with verifiable non-custody (N1, N2, N5) standalone.

**Independent Test**: Connect a whitelisted wallet on Base Sepolia, deposit USDC, confirm shares minted + balance accrues, redeem all shares back to USDC; separately redeem directly onchain (cast/`/exit`) with frontend+agents disabled and `paused()==true`.

**Maps to**: FR-017, FR-018, FR-025, FR-026, FR-033, FR-034, FR-037, FR-042, FR-043; SC-003, SC-004, SC-009; Entities E8 (Vault), E9 (Vault Position), E2 (SmartAccount), E15 (Whitelist); contracts `SparkPointVault`, `CapRegistry`, `KillSwitch`, `AaveV3Adapter`.

### Contracts — vault, caps, kill-switch (the security-critical core)

- [ ] T031 [US1] Implement `SparkPointVault` (ERC-4626, OZ v5, virtual-offset) in `contracts/src/vault/SparkPointVault.sol`: USDC asset, immutables (USDC/AAVE_POOL/aUSDC/guardian/capRegistry), `deposit`/`mint` `whenDepositsAllowed` + cap-checked, **`withdraw`/`redeem`/`_withdraw` carry NO pause modifier** and call `IPool.withdraw` directly to receiver, **management fee + entry/exit fee `pure constant 0`** (the profit-only performance fee is the SEPARATE lazy-accrual mechanism in T107, NOT an entry/exit/management fee), no proxy/`upgradeTo`/EIP-1967 slots per smart-contracts.md §6 (N1, N2, N5)
- [ ] T107 [US1] Implement the **profit-only performance fee** in `contracts/src/vault/SparkPointVault.sol`: the **constructor MUST SEED** `highWaterMark = convertToAssets(1e18)` (== 1e18 at empty-vault state under the OZ v5 virtual-shares offset) so the FIRST accrual can never charge the fee on principal (a default-0 HWM would tax the entire share value — FR-050); `_accrueFee()` lazy accrual called on deposit/withdraw/harvest that, when share price exceeds the stored **high-water mark (HWM)**, MINTS fee shares to a `feeRecipient` whose claim equals `feeRate × (assets gained above HWM since last accrual)` then advances the HWM — NEVER on principal, NEVER at/below HWM (no fee in flat/down periods); on **deposit**, the HWM advance MUST be a **MANDATORY (non-skippable, non-fail-open) step DECOUPLED from the fee-share MINT** — settle/advance the HWM to the current pps BEFORE pricing the new shares even if the MINT leg is skipped (only the MINT may fail open, never the HWM advance) so a late depositor is never later charged a fee on pre-entry yield (principal-dilution); `feeRecipient` is an ORDINARY non-privileged share holder (redeems via the same `withdraw`/`redeem` path, has NO admin/withdraw authority over others, cannot block/delay/reorder any redemption); `feeRate` is the ONLY mutable parameter — **TIMELOCKED, hard-capped at 20% (default 10%), multisig-bounded** — and can NEVER alter custody/withdraw/principal semantics; `_accrueFee`'s MINT leg MUST **FAIL-OPEN** (skip the fee, never revert/block) so `withdraw`/`redeem` never depend on a fee being collectible (entry/exit/management fee stay constant 0 per T031); vault remains NON-UPGRADEABLE in custody semantics per smart-contracts.md §6 / §6.1 (N1, N2, N5; FR-050; constitution v1.1.0)
- [ ] T032 [P] [US1] Implement `CapRegistry` in `contracts/src/governance/CapRegistry.sol`: per-user/total/vault caps multisig-settable ONLY within hard-coded ceilings; no fund path (G2, caps) per smart-contracts.md §6
- [ ] T033 [P] [US1] Implement `KillSwitch`/`Guardian` (pause-only) in `contracts/src/governance/KillSwitch.sol`: multisig wired to `pauseDeposits`/`unpauseDeposits` ONLY, no withdraw modifier reachable (N2, G3) per smart-contracts.md §6
- [ ] T034 [P] [US1] Implement `AaveV3Adapter` (stateless, only protocol-naming code for Aave) in `contracts/src/adapters/AaveV3Adapter.sol`: `supply`/`withdraw` with recipient forced to account, address+selector allowlist surface (G5) per plan.md Layer 3 + policy-schema.md §3

### Contracts — non-custody invariant + fuzz + fork tests (gating, write FIRST)

> **NOTE: Write these tests FIRST; they MUST FAIL before T031–T034 and T107 (performance fee) are complete, then pass.**

- [ ] T035 [US1] N1 invariant suite in `contracts/test/invariant/NonCustody.t.sol`: `invariant_noAdminCanDrain` (no governance/admin selector moves underlying out; only share-owner/approved via `withdraw`/`redeem`) per smart-contracts.md §0/§6 (SC-004)
- [ ] T036 [US1] N2 withdraw-always test in `contracts/test/invariant/NonCustody.t.sol`: `test_withdrawWorks_whenPaused_andOffline` (redeem/withdraw succeed with `paused()==true`); grep-assert ONLY `deposit`/`mint` carry the pause modifier (SC-003, FR-034)
- [ ] T037 [US1] N5 non-upgradeable + pause-only-governance tests in `contracts/test/invariant/NonCustody.t.sol`: `test_vaultNotBehindProxy` (no `Upgraded`/`AdminChanged`, EIP-1967 slots empty, no delegatecall-to-impl), `test_governanceIsPauseOnly` (enumerate role-gated fns, none touch funds) (FR-037, SC-012)
- [ ] T038 [P] [US1] Caps invariants in `contracts/test/invariant/Caps.t.sol`: `invariant_totalAssetsLeTotalCap`, per-user shares ≤ per-user cap at deposit, caps NEVER reduce `maxWithdraw`/`maxRedeem` (FR-025, SC-009)
- [ ] T039 [P] [US1] ERC-4626 rounding fuzz in `contracts/test/fuzz/Vault4626.t.sol`: deposit/withdraw round-trips never extract more than `deposited + yield`; virtual-offset defeats first-depositor/donation inflation per smart-contracts.md §6/§7
- [ ] T040 [US1] Base-fork integration test in `contracts/test/fork/VaultAaveFork.t.sol`: against forked Base, deposit USDC → vault supplies to Aave v3 → aUSDC accrues → redeem returns principal + realized yield MINUS the profit-only performance fee (10% of yield above HWM, 0% on principal) per T107 (FR-017, FR-018)
- [ ] T108 [US1] Performance-fee invariant/fuzz suite in `contracts/test/invariant/PerformanceFee.t.sol` and `contracts/test/fuzz/PerformanceFee.t.sol` (write FIRST, MUST FAIL before T107): `invariant_feeOnlyAboveHwm` (fee shares minted ONLY when share price exceeds the HWM; zero fee in flat/down periods), `invariant_principalPreserved` (a user's redeemable PRINCIPAL is NEVER reduced below deposited principal by fee shares — fee accrues only against realized gains above HWM; N1), `test_withdrawAlways_failOpen_independentOfAccrual` (`withdraw`/`redeem` ALWAYS succeed — incl. paused/offline — even if `_accrueFee` would revert/skip; redemption never depends on fee collectibility; N2), `invariant_feeRateLeCap` (`feeRate ≤ 20%` hard cap always, including after any timelocked multisig update), `invariant_hwmNeverBelowInitial` (`highWaterMark ≥ 1e18` from block 0 via the constructor seed), `test_firstAccrualAfterFirstDeposit_chargesZeroFee` (after the FIRST deposit, with share price not risen above the seed, the first `accrueFee()` charges 0 fee / mints no fee shares and the depositor redeems exactly their principal — FR-050), `test_lateDepositor_notChargedOnPreEntryYield` (deposit WHILE accrual reverts so the fail-open MINT leg is skipped, then RAISE the Aave price and `accrueFee()`; assert the mandatory deposit-time HWM advance ran at entry so the late depositor still redeems `≥` their deposited principal — never charged on pre-entry yield), plus `feeRecipient` is non-privileged (redeems via the normal path, cannot block/reorder others) per smart-contracts.md §6 / §6.1 (N1, N2; SC-003/SC-004; FR-050; constitution v1.1.0)

### Contracts — deploy + post-deploy assertions

- [ ] T041 [US1] Deploy scripts in `contracts/script/`: `DeployCore.s.sol` (vault + CapRegistry + KillSwitch + AaveV3Adapter), `Verify.s.sol`, and `AssertNonCustody.s.sol` post-deploy assertion (management/entry/exit fee==0, performance `feeRate ≤ 20%` hard cap with default 10% and timelock/feeRecipient set per T107, non-upgradeable custody semantics, pause-only, owner/guardian reads) writing provenance to `contracts/deployments/<chain>/addresses.json` (SC-004 / SC-012)

### Agent service — vault quote helpers (read/preview only; never on withdraw path)

- [ ] T042 [P] [US1] `POST /vault/quote/deposit` in `services/agent/src/sparkpoint_agent/api/vault.py`: ERC-4626 `previewDeposit` + caps meter (`maxDeposit`, `wouldBreach`), `KILL_SWITCH_PAUSED` surfaced for deposit only, per agent-service-api.md §3.7 (FR-025, SC-009)
- [ ] T043 [P] [US1] `POST /vault/quote/withdraw` in `services/agent/src/sparkpoint_agent/api/vault.py`: `previewRedeem`/`previewWithdraw`, `maxWithdraw`/`maxRedeem`, **MUST NOT return `KILL_SWITCH_PAUSED` or `CAP_EXCEEDED`**, includes `exitHatchUrl:/exit` (N2) per agent-service-api.md §3.7
- [ ] T044 [P] [US1] Vault + vault-share indexer in `services/agent/src/sparkpoint_agent/data/vault_indexer.py`: index ERC-4626 `Deposit`/`Withdraw` events into `vault_share_events`, reconstruct redeemable balance from events alone (VR-VP2) per data-model.md §9
- [ ] T110 [P] [US1] **Performance-fee event indexing + admin revenue dashboard** in `services/agent/src/sparkpoint_agent/data/fee_indexer.py` (+ migration `services/agent/migrations/0002_vault.sql`, T045): index the fee-accrual/`FeeShareMinted`/HWM-advance events (feeRate, fee shares minted to `feeRecipient`, yield-above-HWM base, block, asOfBlock) into a `vault_fee_events` table, reconstructable from chain alone and **display/derived-index only — never on the custody/withdraw path** (N2); expose an aggregate read (cumulative realized performance-fee revenue, per-period, current `feeRate`/HWM) backing an admin revenue dashboard, surfaced read-only at `apps/web/app/app/admin/revenue/page.tsx` per data-model.md §9 (constitution v1.1.0)

### Data — vault entities

- [ ] T045 [US1] Migration `services/agent/migrations/0002_vault.sql`: `vaults` (mirror: `mgmt_fee_bps`/`entry_fee_bps`/`exit_fee_bps` CHECK = 0, `perf_fee_bps` CHECK ≤ 2000 hard cap with default 1000, `hwm`, `fee_recipient`, is_upgradeable=false), `vault_share_events`, `vault_fee_events` (for T110), `indexed_positions` (kind incl `vault_shares`), `portfolio_snapshots` per data-model.md §6,§8,§9

### Frontend — vault dashboard, deposit/withdraw, beta gate, and the PUBLIC escape hatch

- [ ] T046 [US1] Vault dashboard + deposit/withdraw UI in `apps/web/app/app/vault/page.tsx`: balance, accruing yield, caps meter, deposit and withdraw flows routed through the single `ExecutionDrawer` chokepoint (FR-017, FR-018)
- [ ] T109 [US1] Surface **performance-fee disclosure** in the vault UI (`apps/web/app/app/vault/page.tsx` + `apps/web/components/NonCustodyBadge.tsx`) and the deposit **quote API** (`POST /vault/quote/deposit` in `services/agent/src/sparkpoint_agent/api/vault.py`): show the canonical pre-deposit/receipt disclosure "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal" with the current on-chain `feeRate`/`feeRecipient`/HWM read via RPC and the **20% hard cap**, and display **net-of-everything APY** (yield net of the performance fee); replace any "0-fee" framing with "0-management / profit-only performance-fee" while keeping "0% on principal, 0% management" true; the withdraw quote (`POST /vault/quote/withdraw`, T043) stays unchanged and fee-independent (N2) per agent-service-api.md §3.7 (FR-017/018; constitution v1.1.0)
- [ ] T047 [US1] Beta whitelist + per-user-cap gate in `apps/web/lib/auth/whitelist.ts` and the authenticated shell `apps/web/app/app/layout.tsx`: only `enabled` + `geo_allowed` may transact through the app; never gates `/exit` (FR-042/043, VR-W1/W2, SC-014)
- [ ] T048 [US1] **PUBLIC withdraw-always escape hatch** `apps/web/app/exit/page.tsx`: imports NO agent client; builds `redeem`/`withdraw` calldata client-side from bundled ABIs + direct Alchemy RPC; works with agent + indexer + backend offline and while paused (N2, FR-034, SC-003)
- [ ] T049 [P] [US1] NonCustody badge + caps display components in `apps/web/components/NonCustodyBadge.tsx` reading vault `paused()`/caps/fees directly via RPC (display only)

### Light frontend test

- [ ] T050 [P] [US1] Playwright E2E (testnet-pointed) in `apps/web/e2e/vault.spec.ts`: deposit → shares shown → withdraw full; and an offline-mode `/exit` smoke (mock agent down) confirming the redeem path renders without backend (SC-003)

**Checkpoint**: US1 is fully functional and independently testable — a whitelisted user deposits/withdraws USDC via the vault, and can exit directly onchain with all SparkPoint infra offline and paused. **STOP and VALIDATE the MVP here.** N1/N2/N5 invariant suite green and gating CI.

---

## Phase 4: User Story 2 — Execute a DeFi action with pre-trade simulation and per-action signing (Priority: P1)

**Goal**: Every state-changing action (Aave deposit/withdraw USDC/ETH, Aerodrome swap, vault ops) shows a deterministic Tenderly pre-trade simulation BEFORE any signature is requested; the user signs per-action; nothing the AI proposes can execute without that signature; out-of-policy proposals are never made signable. The trust backbone (G1, G4, N1, N3).

**Independent Test**: Trigger an Aave deposit and an Aerodrome swap; confirm a simulation preview renders before any signature request; reject one (nothing executes); sign the other and confirm onchain result matches preview within tolerance; confirm a non-whitelisted/over-cap proposal is rejected before any sign button appears.

**Maps to**: FR-008, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-027, FR-035; SC-001, SC-002, SC-006; Entities E11 (Execution/Intent), E12 (Simulation), E2 (Account); contracts `SparkPointAccount`, `AccountFactory`, `AerodromeAdapter`.

### Contracts — smart account + factory (per-action owner signing; N1, N3)

- [ ] T051 [US2] Implement `SparkPointAccount` (ERC-4337 v0.7, UUPS owner-only upgrade) in `contracts/src/account/SparkPointAccount.sol`: `validateUserOp` (owner ECDSA), `execute`/`executeBatch` gated by `_requireFromEntryPointOrOwner`, `IntentLog` event on execute, NO sweep/rescue-to-arbitrary path (recipient pinned), `transferOwnership` owner-only per smart-contracts.md §2 (N1, N3)
- [ ] T052 [P] [US2] Implement `AccountFactory` (CREATE2, idempotent) in `contracts/src/account/AccountFactory.sol`: `createAccount(owner, salt)` binds owner == user EOA, `getAddress` counterfactual, `accountImplementation` public per smart-contracts.md §3 (N3)
- [ ] T053 [P] [US2] Implement `AerodromeAdapter` (stateless, only protocol-naming code for swaps) in `contracts/src/adapters/AerodromeAdapter.sol`: `swapExactTokensForTokens` with `to` forced to account, route `factory` constrained to whitelisted factory, `amountOutMin` slippage floor (G4, G5) per smart-contracts.md §7 + policy-schema.md §3/§5

### Contracts — account invariant tests (gating, write FIRST)

- [ ] T054 [US2] N1/N3 account invariants in `contracts/test/invariant/Account.t.sol`: `invariant_onlyEntryPointOrOwnerMovesFunds`, `invariant_noSparkPointRecipient`, `invariant_onlyOwnerUpgrades`, `invariant_factoryOwnerIsCaller` per smart-contracts.md §2/§3 (SC-004)
- [ ] T055 [P] [US2] Aerodrome swap fork test in `contracts/test/fork/AerodromeFork.t.sol`: swap honors `amountOutMin`, recipient forced to account, rejects non-whitelisted factory/route (FR-020, SC-006)

### Policy + simulation gate (the simulation-before-sign chokepoint)

- [ ] T056 [US2] Wire the full deterministic `evaluate()` gate in `services/agent/src/sparkpoint_agent/policy/evaluate.py`: PROTOCOL/SELECTOR allowlist (address-level), ASSET, RECIPIENT-pin, CAPS (exit-skip), SLIPPAGE/SIM, FRESHNESS, KILL-SWITCH (exit-skip) per policy-schema.md §8; fail-closed, `policyVersion` stamped (FR-008, FR-027)
- [ ] T057 [US2] Tenderly pre-trade simulation in `services/agent/src/sparkpoint_agent/tools/simulate.py`: fresh sim → `SimulationResult` (balance deltas, sharesOut/assetsOut/outAmount, slippage, revert); swaps fail-closed on `SIMULATION_UNAVAILABLE`, oracle-free custody ops may local `eth_call` dry-run per agent-service-api.md §2.3/§3.5 (FR-021, SC-002)
- [ ] T058 [US2] Policy contract tests (assert out-of-policy rejection) in `services/agent/tests/policy/test_evaluate.py`: non-whitelisted target, over-cap deposit, over-slippage swap, SparkPoint recipient, predicted revert all return rejected with reason and **no signable artifact**; withdraws skip cap+pause (FR-008/023/027, SC-006, N2)

### Agent service — build/simulate/submit endpoints (unsigned only; service holds no keys)

- [ ] T059 [US2] `POST /build-tx` in `services/agent/src/sparkpoint_agent/api/execute.py`: schema → policy `evaluate` → build UNSIGNED calldata/`PackedUserOperation` (factory+factoryData if counterfactual, `signature` null) → fresh Tenderly sim → re-assert; emit `IntentBundle` only on full pass, else error envelope with `reasons[]` and **no bundle** per agent-service-api.md §3.5 (N1, N3, FR-008/022)
- [ ] T060 [P] [US2] `POST /simulate` (standalone re-sim / freshness refresh) in `services/agent/src/sparkpoint_agent/api/execute.py` per agent-service-api.md §3.5 (re-sim when `expiresAt` near; VR-S2)
- [ ] T061 [P] [US2] `POST /submit-signed-tx` + `GET /submit-signed-tx/{intentId}` in `services/agent/src/sparkpoint_agent/api/submit.py`: byte-match the user-signed payload against the issued `IntentBundle` (reject tamper), forward to bundler/RPC, watch for receipt; **never** `KILL_SWITCH_PAUSED` for withdraw/redeem; service never signs per agent-service-api.md §3.6 (SC-001)

### Data — execution + simulation entities

- [ ] T062 [US2] Migration `services/agent/migrations/0003_execution.sql`: `intent_bundles` (policy_verdict/policy_version/policy_reasons), `simulation_results`, `executions` (signing_mode, status, intent_log_action_id, attribution_method) per data-model.md §11,§12

### Frontend — the single signing chokepoint

- [ ] T063 [US2] `ExecutionDrawer` component in `apps/web/components/ExecutionDrawer.tsx`: the ONE signing chokepoint for every write flow — renders balance deltas + guardrail checklist (G1–G6 + N1 recipient) + "simulation passed"; **Sign disabled** on warning/over-slippage/policy-reject; no card is signable without `policy.status==='approved'` per plan.md Layer 1 (SC-002, FR-021/023/024)
- [ ] T064 [P] [US2] Aave v3 deposit/withdraw (USDC + ETH-via-gateway) and Aerodrome swap flows in `apps/web/app/app/chat/` action cards + `apps/web/lib/chain/actions.ts`: build via `/build-tx`, sign in `ExecutionDrawer`, submit via own bundler/RPC path (FR-019, FR-020)
- [ ] T065 [P] [US2] Wallet-rejection / timeout / insufficient-funds handling in `apps/web/lib/chain/submit.ts`: no tx submitted on decline/reject; clear retry/cancel with no side effects (FR-024, spec edge cases)

### Light frontend test

- [ ] T066 [P] [US2] Playwright E2E in `apps/web/e2e/execution.spec.ts`: sim preview renders before any sign prompt for an Aave deposit + a swap; rejecting yields no tx; an out-of-policy proposal shows no Sign button (SC-001, SC-002, SC-006)

**Checkpoint**: US1 AND US2 both work independently. Every state-changing action is simulated-then-user-signed through `ExecutionDrawer`; out-of-policy proposals never become signable. N1/N3 account invariants green and gating.

---

## Phase 5: User Story 3 — Chat-driven onboarding into a personalized mandate (Priority: P2)

**Goal**: A new user completes a chat-based onboarding that collects goals + risk tolerance and produces a confirmed, persisted, human-readable mandate that shapes later flows.

**Independent Test**: Complete the onboarding chat, answer goal/risk questions, confirm a stored human-readable mandate is produced and surfaced back; edit goals and confirm a new version is created and reflected downstream.

**Maps to**: FR-001, FR-002, FR-003, FR-004; SC-007; Entities E3 (Mandate, versioned), E4 (Goal); contract `agent-service-api.md` §3.1.

### Data — mandate/goal entities

- [ ] T067 [US3] Migration `services/agent/migrations/0004_mandate.sql`: `mandates` (versioned, immutable-once-confirmed, `max_slippage_bps`, `summary_text`, `confirmed_at`), `goals`, plus `chat_messages` table per data-model.md §5,§16 (VR-M1..M5)

### Agent service — onboarding step machine + mandate CRUD

- [ ] T068 [US3] `POST /onboarding/turn` (SSE step machine) in `services/agent/src/sparkpoint_agent/api/onboarding.py` + the strategy-agnostic onboarding logic in `services/agent/src/sparkpoint_agent/agents/onboarding.py`: welcome→connect→experience→goals→timeline→risk_scenario→review, emits `mandate_draft` (NOT persisted) per agent-service-api.md §3.1 (FR-001, SC-007)
- [ ] T069 [P] [US3] `POST /mandate` (persist confirmed), `GET /mandate` (active or null), `PUT /mandate` (new versioned row) in `services/agent/src/sparkpoint_agent/api/mandate.py`: confirm sets `active_mandate_id`, `max_slippage_bps` clamped to `min(mandate, hard_ceiling)` per agent-service-api.md §3.1 + data-model.md VR-M3 (FR-002/003/004)

### Frontend — onboarding chat + mandate review/edit

- [ ] T070 [US3] Onboarding chat surface in `apps/web/app/app/onboarding/page.tsx`: streamed onboarding `ChatBlock`s, mandate-draft review card with explicit user confirmation before persist (FR-002, SC-007 < 5 min)
- [ ] T071 [P] [US3] Mandate edit in `apps/web/app/app/settings/page.tsx`: update goals/risk → `PUT /mandate` → new version; surfaces current mandate summary (FR-004)

**Checkpoint**: US1–US3 independently functional. A user produces a confirmed, versioned mandate that downstream flows can read.

---

## Phase 6: User Story 4 — View portfolio overview across Base assets (Priority: P2)

**Goal**: A portfolio overview reads onchain wallet activity and shows positions, per-position + total PnL, and allocation across Base assets including vault + Aave positions, reconciling with onchain balances; clean empty state.

**Independent Test**: Connect a wallet with Base assets + a vault position; open portfolio; confirm positions, PnL, allocation reconcile with onchain balances; an empty wallet shows an empty state without error.

**Maps to**: FR-009, FR-010, FR-011, FR-012, FR-013; SC-011; Entities E5 (Portfolio), E6 (Position), supporting `onchain_events`, `price_snapshots`.

### Data + indexing — onchain-reconstructable positions and PnL

- [ ] T072 [US4] Position/PnL indexer in `services/agent/src/sparkpoint_agent/data/position_indexer.py`: build `indexed_positions` (token_balance/aave_supply/vault_shares) from `onchain_events`, average-cost basis, accrued yield, realized/unrealized PnL marked to a pinned `price_snapshot` per data-model.md §6 (VR-P1..P4, SC-011)
- [ ] T073 [P] [US4] Price snapshot canon in `services/agent/src/sparkpoint_agent/data/pricing.py`: block-anchored Chainlink-on-Base canonical marks (HTTP price API long-tail display-only, flagged), every displayed number cites a `price_snapshot_id` per data-model.md §16 (VR-P3)

### Agent service — portfolio reads (degradable; never gates signing)

- [ ] T074 [US4] `GET /portfolio` + `GET /portfolio/positions/{positionId}` in `services/agent/src/sparkpoint_agent/api/portfolio.py` and the `portfolio_reader` agent: enriched positions/PnL/allocation/risk, `stale`-markable, returns 200 with `stale:true` rather than hard error per agent-service-api.md §3.3 (FR-009..013)

### Frontend — portfolio overview (custody-critical reads via direct RPC)

- [ ] T075 [US4] Portfolio overview in `apps/web/app/app/portfolio/page.tsx` + `apps/web/app/app/portfolio/[positionId]/page.tsx`: positions, per-position + total PnL, allocation breakdown (Recharts); **custody-critical balances read via direct RPC and reconciled** against the enriched `/portfolio` (SC-011); empty state without error (FR-013)

**Checkpoint**: US1–US4 independently functional. Portfolio reconciles with onchain balances and degrades safely when the indexer is stale.

---

## Phase 7: User Story 5 — Ranked strategy recommendations with rationale and outcome tracking (Priority: P2)

**Goal**: The assistant returns ranked recommendations scored against the mandate, each with plain-language rationale and citations, referencing only whitelisted protocols; acted-upon recommendations create an outcome log entry updated over time with realized PnL (wins + losses viewable).

**Independent Test**: With a mandate + portfolio, request recommendations and confirm a ranked, rationale-bearing, citation-backed, whitelist-only list; act on one and confirm an outcome log entry is created and later updated with realized PnL.

**Maps to**: FR-005, FR-006, FR-007, FR-014, FR-015, FR-016, FR-039, FR-040, FR-041; SC-005, SC-006, SC-010; Entities E7 (Recommendation), E13 (Outcome Log), E14 (Literacy Tip), supporting `context_snapshots`, `memory_chunks` (RAG).

### Data — recommendation, outcome, literacy, context entities

- [ ] T076 [US5] Migration `services/agent/migrations/0005_strategy_outcomes.sql`: `recommendations` (rank/rationale/citations/proposed_protocol∈whitelist/score/status), `outcome_logs` (recommendation→intent→execution link, realized/unrealized PnL, label, attribution_method), `context_snapshots`, `literacy_tips` + `literacy_tip_impressions`, `risk_events` per data-model.md §7,§13,§14,§16

### Agent service — chat assistant, recommender, outcome attribution

- [ ] T077 [US5] `POST /chat` (SSE) + `POST /chat/feedback` in `services/agent/src/sparkpoint_agent/api/chat.py`: coordinator DAG (portfolio_reader → strategy_recommender), streamed `ChatBlock`s (tool_step/text/recommendation/tip/citation), structured action/recommendation blocks emitted as COMPLETE JSON (never partially streamed), contextual literacy tips (FR-005/006/007); never returns a signable bundle per agent-service-api.md §3.2
- [ ] T078 [US5] `strategy_recommender` agent in `services/agent/src/sparkpoint_agent/agents/strategy_recommender.py` + `GET /recommendations`, `GET /recommendations/{recId}`: rank vs mandate version, plain-language `rationale` + `citations` grounded in tool results (not model memory), **only whitelisted protocols surfaced** (renderer shows nothing policy hasn't cleared), RAG over past outcomes scoped to risk_tier per agent-service-api.md §3.4 + data-model.md §17 (FR-014/015/016, SC-005/006)
- [ ] T079 [P] [US5] Outcome attribution + PnL worker in `services/agent/src/sparkpoint_agent/memory/outcomes.py`: on confirmation write `outcome_log` linking `recommendationId → tx` via `IntentLog` event (preferred) or heuristic `(sender,target,selector,asset,amount,block-window)` fallback (record `attribution_method`); periodically update realized PnL, label win/loss/flat per data-model.md §13 (FR-039/040/041, SC-010)
- [ ] T080 [P] [US5] `GET /outcomes` + `GET /outcomes/{recId}` in `services/agent/src/sparkpoint_agent/api/outcomes.py`: realized/unrealized PnL per recommendation, wins AND losses (no survivorship filtering), `reconstructable:true` per agent-service-api.md §3.8 (FR-041, VR-O4)

### Frontend — chat, strategy, outcomes surfaces

- [ ] T081 [US5] Chat surface in `apps/web/app/app/chat/page.tsx`: streamed structured cards (recommendation/tip/citation/outcome), each recommendation shows rank + rationale + citations; a card is signable only with `policy.status==='approved'` (SC-005)
- [ ] T106 [P] [US5] Contextual financial-literacy tips surface: a lightweight literacy capability in `services/agent/src/sparkpoint_agent/agents/literacy.py` that emits a non-signable, context-keyed `TipCard` `ChatBlock` (logging `literacy_tip_impressions`), plus the display-only `apps/web/components/chat/TipCard.tsx` card renderer registered in `apps/web/lib/agent/cards.ts` — surfaced contextually beside (never inside) recommendation/action cards, never policy-stamped or signable (FR-007, Literacy Tip entity E14)
- [ ] T082 [P] [US5] Strategy recommendations view in `apps/web/app/app/strategy/page.tsx` + `apps/web/app/app/strategy/[recId]/page.tsx`: ranked list + "why this?" detail + compare; whitelist-only (FR-014/016)
- [ ] T083 [P] [US5] Outcomes log view in `apps/web/app/app/outcomes/page.tsx`: realized PnL per past recommendation, wins + losses (FR-041, SC-010)

**Checkpoint**: US1–US5 independently functional. Recommendations are ranked, rationale-bearing, whitelist-only; acted-upon ones generate and update outcome logs.

---

## Phase 8: User Story 6 — Opt in to scoped, revocable auto-rebalance via session key (Priority: P3)

**Goal**: A user opts into automation by authorizing a time-boxed session key bounded onchain by `PolicyModule` (allowlisted targets only, per-tx + cumulative caps, max slippage, hard expiry); can revoke instantly and unilaterally; the agent can never exceed scope even if compromised (N4).

**Independent Test**: Authorize a session key with explicit caps + expiry; confirm an in-scope automated action succeeds and an out-of-scope action is rejected onchain; revoke and confirm no further automated actions; confirm an expired key is rejected.

**Maps to**: FR-028, FR-029, FR-030, FR-031, FR-032, FR-036; SC-008; Entities E10 (Session Key + Policy Scope); contracts `SessionKeyValidator`, `PolicyModule`.

### Contracts — session key validator + policy module (N4 final backstop)

- [ ] T084 [US6] Implement `PolicyModule` in `contracts/src/account/PolicyModule.sol`: `Policy` struct (sessionKey, validAfter/validUntil, perTxCap, cumulativeCap, monotonic `spent`, maxSlippageBps, revoked), account-associated storage, `isAllowedTarget(target,selector)` (address+selector level), `checkAction` view, `policyOf` view; the session-key allowlist realizes the constitution's "allowlisted vaults only" (N4) as the **minimal target+selector set strictly required to enter and exit the allowlisted vault(s)** — the vetted vault address plus ONLY the adapter selectors needed to deposit/withdraw to those vault(s), NOT arbitrary swaps or general targets; no fund path, no `approve`/arbitrary-call ever allowlisted per smart-contracts.md §5 (N4, G2, G5)
- [ ] T085 [US6] Implement `SessionKeyValidator` in `contracts/src/account/SessionKeyValidator.sol`: `validateUserOp` deterministic flow (recover signer → non-revoked → within [validAfter,validUntil] → allowlisted (target,selector) restricted to the minimal vault enter/exit set per T084 — the vetted vault address + only the deposit/withdraw adapter selectors, NOT arbitrary swaps or general targets → perTx + cumulative caps, `spent +=` → `amountOutMin ≥ floor` for any swap leg → recipient forced to account), live-storage read so revoke is immediate per smart-contracts.md §4 (N4, N1)
- [ ] T086 [US6] Wire `authorizeSessionKey`/`revokeSessionKey` into `SparkPointAccount` (owner-only, instant, unilateral, **never pausable**) per smart-contracts.md §2 (FR-031/032)

### Contracts — session-key invariant tests (gating, write FIRST)

- [ ] T087 [US6] Session-key invariant suite in `contracts/test/invariant/SessionKey.t.sol`: `invariant_sessionCannotExceedPerTxCap`, `invariant_sessionCumulativeMonotonicAndCapped`, `invariant_sessionRejectsAfterExpiry`, `invariant_sessionRejectsNonAllowlistedTarget`, `invariant_sessionRecipientIsAccount`, `invariant_revokeIsImmediate`, `test_revoke_isImmediate_andUnilateral`, `invariant_noApproveOrArbitraryCallEverAllowed` per smart-contracts.md §4/§5 (N4, SC-008)

### Policy + agent + data — session-key path (off-chain mirror)

- [ ] T088 [US6] Session-scope grammar validation in `services/agent/src/sparkpoint_agent/policy/session.py`: enforce `SessionScope` rules — the session allowlist is the **minimal vault enter/exit set strictly required to enter and exit the allowlisted vault(s)** (vetted vault address + only the deposit/withdraw adapter selectors, NOT arbitrary swaps or general targets) and MUST be ⊆ the global allowlist, `validUntil` required + ≤ maxSessionDurationDays, slippage ∈ [floor, ceiling], caps ≤ ceilings, recipient pin, forbidden selectors, revoke is `direction:exit` never gated — per policy-schema.md §6 (N4)
- [ ] T089 [P] [US6] `POST /session-keys/grant/build`, `POST /session-keys/revoke/build`, `GET /session-keys` in `services/agent/src/sparkpoint_agent/api/sessions.py`: build UNSIGNED grant/revoke UserOps (service generates only the session PUBLIC key, no user key), `scopeEcho` verbatim the on-chain `Policy`; revoke never depends on agent / never pause-gated per agent-service-api.md §3.9 (FR-029/031, SC-008)
- [ ] T090 [P] [US6] Migration `services/agent/migrations/0006_sessions.sql`: `session_keys` mirror (embedded policy scope, status, spent, valid_until, registered/revoked tx) per data-model.md §10 (VR-SK1..SK4)

### Frontend — automation enable/revoke (revoke buildable fully client-side)

- [ ] T091 [US6] Automation UI in `apps/web/app/app/automation/page.tsx`: enable session key (scope displayed VERBATIM from on-chain `Policy`, signed in `ExecutionDrawer`) + revoke (buildable entirely client-side, never depends on backend) + list active keys with `spent`/expiry read from chain (FR-029/031/032, SC-008)

**Checkpoint**: All six user stories independently functional. Session keys are onchain-bounded, instantly + unilaterally revocable, and cannot exceed scope even if the agent is compromised. N4 invariant suite green and gating.

---

## Phase 9: Trust Center & SRK (cross-cutting provability surfaces)

**Purpose**: The provable-non-custody surface (N5) and the non-gating SRK view. These complete FR-037/038 and FR-045/046 and depend on contracts from US1/US2/US6 being deployed.

- [ ] T092 [P] `GET /trust/permissions` + `GET /trust/status` in `services/agent/src/sparkpoint_agent/api/trust.py`: aggregate exact on-chain permissions (owner, validators, vault upgradeable=false, paused, guardian/pauser pause-only, management/entry/exit fee=0, performance `feeRate` + 20% hard cap + `feeRecipient` + HWM + timelock, caps, allowlist, canDo/cannotDo), all `asOfBlock`-stamped per agent-service-api.md §3.10 (FR-037/038, SC-012)
- [ ] T093 [US-trust] **PUBLIC** Trust Center hub `apps/web/app/trust/page.tsx` + "prove-it" permissions panel `apps/web/app/trust/permissions/page.tsx`: reads exact permissions DIRECTLY from chain via Viem (never depends on the agent service), each row linkable to BaseScan; renders caps/kill-switch(PAUSE_ONLY)/whitelist/cannotDo (N1/N5 provable) per plan.md Layer 1 (FR-037/038, SC-004/012)
- [ ] T094 [P] `permission_manifests` cache + generation in `services/agent/src/sparkpoint_agent/data/permissions.py` (cache of chain reads only; always re-read on render) per data-model.md §16
- [ ] T095 [P] SRK informational view `apps/web/app/app/srk/page.tsx` + `srk_view` read model: display-only SRK info, MUST NOT gate any core function; verify vault/assistant work with SRK absent (FR-045/046, SC-013, VR-U4)

**Checkpoint**: Trust Center independently proves non-custody from onchain state with the agent offline; SRK is purely informational.

---

## Phase 9a: Multi-Network (Base → Sui) + Bridge + In-Chat Inline Confirm (client-directed scope amendment)

**Purpose**: Realize the client-directed **multi-network** amendment (plan §Multi-network architecture note; constitution v1.3.0) at the **product / UX / non-custody level on the existing Base EVM stack**, plus the in-chat inline confirm surface. **Phase order: Base at launch (live), Sui as the designated fast-follow network**; networks beyond Base + Sui are out of scope. The Sui (non-EVM / Move) account/vault stack and the concrete bridge mechanism/provider contracts are a **separate follow-on** (see the FOLLOW-ON epic below) and are NOT broken into detailed tasks here.

**Non-custody discipline (must hold)**: the bridge stays **fully self-custodial** — user signs a lock/burn on the **source** network, receives funds in **their own wallet** on the **destination** network, SparkPoint **never** custodies in transit; **withdraw-always (N2) holds on every network**; bridge actions run the **same** simulation + guardrail checklist + you-sign gate as swaps/deposits, with per-network **and** per-bridge caps wired to policy limits. The in-chat confirm is a **UX-surface change only** — the trust gate and the sign-disabled-until-acknowledged invariant are preserved 1:1.

**Maps to**: plan §Multi-network architecture note + §In-chat inline confirm; data-model E17 (Network), E18 (BridgeTransfer); contracts/ "Bridge (cross-network)" note. User-facing trust term: **"fully self-custodial."**

### Network switcher + per-network state (frontend)

- [ ] T111 [P] **Network switcher** in the authenticated top bar (next to the wallet pill) in `apps/web/components/NetworkSwitcher.tsx` + `apps/web/lib/chain/networks.ts`: persistent control listing supported networks from `networks` (E17; `base` live, `sui` presented per phase order), switching sets the active-network indicator and the **per-network wallet address**; networks beyond Base + Sui are out of scope per plan §Multi-network architecture note
- [ ] T112 [P] **Per-network state** wiring in `apps/web/lib/chain/` + the authenticated shell `apps/web/app/app/layout.tsx`: scope per-network balances/positions/address by active `network_id`, custody-critical balances still read fresh per-network from RPC (never the mirror); user-facing trust copy reads **"fully self-custodial"** (NonCustodyBadge), keeping "non-custodial/self-custodial" only in technical/architecture text per data-model §15a (VR-N1)
- [ ] T113 [P] `networks` registry migration `services/agent/migrations/0007_networks.sql`: `networks` (id/name/live/vm_kind/chain_ref) per data-model.md §15a (E17), seeded with `base` (evm, live) and `sui` (move, not-yet-live)

### Bridge surface + confirm/bridge gate (frontend + agent + data)

- [ ] T114 [US-bridge] **Bridge surface** `apps/web/app/app/bridge/page.tsx` (route `#/bridge`): asset picker (USDC/ETH), from/to network selectors with a flip control, amount + max, route/fee/ETA preview, per-network + per-bridge caps meter, and a "how custody is preserved" explainer (lock/burn on source → received in your own wallet on destination → never custodied); CTA routes to `/confirm/bridge`
- [ ] T115 [US-bridge] **`/confirm/bridge` sign gate** reusing the single `ConfirmFlow`/`ExecutionDrawer` chokepoint in `apps/web/app/app/confirm/bridge/page.tsx`: pre-bridge simulation reveal → balance changes (out on source / in on destination) → guardrail checklist (incl. N1 recipient pinned to the user's OWN destination wallet + per-bridge cap) → "nothing moves until you sign" → Sign → "bridge initiated" success with tracking link; **Sign disabled** without a passed sim / on policy-reject (same trust gate as swaps/deposits)
- [ ] T116 [US-bridge] **Bridge policy + build endpoints** in `services/agent/src/sparkpoint_agent/api/bridge.py` + `services/agent/src/sparkpoint_agent/policy/`: extend `evaluate()` with a bridge action that pins `dest_recipient` to the user's own destination wallet (VR-BT1), enforces **per-network AND per-bridge caps** against policy limits, runs the source-leg simulation, and emits an UNSIGNED, policy-approved `IntentBundle` only on full pass (else error envelope + reasons, no bundle); service holds no keys and never custodies (VR-BT1/BT3)
- [ ] T117 [P] [US-bridge] `bridge_transfers` migration `services/agent/migrations/0008_bridge.sql` + indexer in `services/agent/src/sparkpoint_agent/data/bridge_indexer.py`: `bridge_transfers` (from/to network, asset, amount, dest_recipient, status, source/dest tx) per data-model.md §15a (E18); index the source lock/burn + destination mint/release legs (ONCHAIN-DERIVED, reconstructable; never on the withdraw path — VR-BT2/BT4)

### Chat bridge intent + in-chat inline confirm

- [ ] T118 [P] [US-bridge] **Chat bridge intent** in `services/agent/src/sparkpoint_agent/agents/` + `apps/web/lib/agent/cards.ts`: recognize "bridge" / "sui" / "cross-chain" / "move to <network>" → emit a non-signable `BridgeCard` `ChatBlock` proposing the Base ↔ Sui move → routes to the bridge confirm; whitelist/policy-cleared only, never a signable bundle from chat directly
- [ ] T119 **In-chat inline confirm — ONE `ConfirmFlow`, SECOND mount point** in `apps/web/components/ConfirmFlow.tsx` (extracted/shared) mounted inline in `apps/web/app/app/chat/page.tsx`: chat-initiated deposit/swap/**bridge** render the full confirm+sign flow INLINE in the chat thread (no navigation) running the **same** trust gate (simulation → balance changes → guardrail checklist → acknowledgement checkbox that GATES the Sign button → "nothing moves until you sign" → Sign → success); the standalone `/confirm/[intent]` routes REMAIN for non-chat entry points (vault page, ⌘K, etc.) — one component, two mount points; the sign-disabled-until-acknowledged invariant + whole trust gate + non-custody preserved 1:1 (UX-surface change only)

### Light frontend test

- [ ] T120 [P] [US-bridge] Playwright E2E in `apps/web/e2e/bridge-and-inline-confirm.spec.ts`: switch network updates indicator + per-network address; a chat bridge intent renders an inline confirm whose **Sign is disabled until the ack checkbox is checked**; rejecting yields no tx; assert the inline confirm and `/confirm/bridge` route mount the **same** `ConfirmFlow` (UX parity)

> **NOTE:** Phase 9a delivers the multi-network + bridge experience on the **existing Base EVM stack** at the product/UX/non-custody level. The Sui-side custody stack and the bridge's on-chain lock-mint contracts are the FOLLOW-ON epic below — do not implement them as part of these tasks.

---

## Phase 9b: FOLLOW-ON EPIC — Sui (non-EVM) stack + bridge contracts (SEPARATE technical design — NOT yet broken into detailed tasks)

> ⚠️ **FOLLOW-ON / DEFERRED — separate technical design required before any build.** This epic is **intentionally NOT decomposed into detailed tasks**. Sui is **non-EVM (Move-based)** and does **not** use ERC-4337 / ERC-4626 / Solidity, so its account/vault architecture cannot be expressed as a refinement of the Base EVM contracts, and the concrete bridge mechanism/provider is a separate cross-network contract design. Per plan §Follow-on and the contracts/ "Bridge (cross-network)" note, these are deferred technical designs flagged here, not specified. **Do NOT fabricate Move code or a detailed Sui contract spec.** The existing Base/EVM contract spec stays intact and authoritative for Base.

- [ ] FE-T001 [FOLLOW-ON] **Sui (Move) account + vault stack — technical design.** Design a Move-based account/vault architecture that re-establishes the non-custody invariants on Sui **by construction** — especially withdraw-always (N2) and user-sole-key (N3), plus Sui-native equivalents of N1/N4/N5 and the policy/simulation/sign gate. Output is a design doc + its own Phase 0/1 artifacts, NOT covered by the Base contract spec. *(Blocks any Sui custody build; not estimated here.)*
- [ ] FE-T002 [FOLLOW-ON] **Bridge mechanism / provider — cross-network contract design.** Design the on-source lock/burn + on-destination mint/release contracts (EVM-side notes in `contracts/`; the Sui side is non-EVM/Move), provider/route selection, per-bridge caps wired to policy limits, and the cross-network proof that funds are never custodied in transit (lock/burn → user's own destination wallet). *(Blocks any real bridge execution; the Phase 9a bridge UX/policy surface targets this design once ratified.)*

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Security hardening, contract fuzz/static analysis, monitoring, quickstart validation, and docs across all stories.

### Security hardening & contract assurance

- [ ] T096 [P] Slither static analysis (advisory gate) across `contracts/src/` wired into `contracts.yml`; triage + document findings in `contracts/SECURITY.md`
- [ ] T097 [P] Expand fuzz/invariant coverage in `contracts/test/fuzz/` and `contracts/test/invariant/`: edge cases for cap boundaries, partial Aave-illiquidity clamp-to-`maxWithdraw` (partial exit beats hard revert), reorg-safe indexing assumptions per smart-contracts.md §6
- [ ] T098 Drift-prevention CI job `.github/workflows/policy-parity.yml`: assert on-chain `PolicyModule`/`CapRegistry`/allowlist reads equal `packages/shared` policy constants, AND the vault's on-chain `feeRate`/hard cap (≤ 20%, default 10%)/`feeRecipient` equal the disclosed `packages/shared` fee constants surfaced in the UI/quote (T109); a mismatch FAILS the pipeline per policy-schema.md §9
- [ ] T099 [P] Kill-switch + circuit-breaker drill test (agent/integration) in `services/agent/tests/integration/test_killswitch.py`: paused → deposits/grants blocked (`KILL_SWITCH_PAUSED`), withdraws/redeems/revokes unaffected (SC-003, FR-026)

### Monitoring, data health, stale-data gate

- [ ] T100 [P] Tenderly Web3 Actions + alerting config in `infra/deploy/monitoring/`: post-deploy tx monitoring, cap-utilization + risk-event alerts; Sentry init in `apps/web` and `services/agent`
- [ ] T101 [P] Data-source health + stale-data gate in `services/agent/src/sparkpoint_agent/data/health.py`: maintain `data_source_health`, mark `is_stale`, block execution on stale-beyond-tolerance data while leaving custody/withdraw unaffected (VR-DS1/DS2, FR price-feed edge case)

### Validation & docs

- [ ] T102 Execute `quickstart.md` validation end-to-end: one-command local bring-up (agent + pgvector + Anvil fork) AND the withdraw-always drill (redeem with frontend + agents offline and paused) — gating before testnet (SC-003)
- [ ] T103 [P] Testnet + mainnet deploy workflows `.github/workflows/{deploy-testnet,deploy-mainnet}.yml`: run N1–N5 invariant suite + post-deploy `AssertNonCustody` as required gates before any deploy; the **mainnet deploy additionally REQUIRES a recorded internal-team security audit/hardening sign-off** for every contract as an explicit precondition (per constitution "Contract audit before mainnet" — no contract reaches Base mainnet until the internal team's audit + hardening are complete) — the workflow gates on this sign-off, not the invariant suite alone; commit `contracts/deployments/<chain>/addresses.json`
- [ ] T104 [P] Light frontend smoke + accessibility pass in `apps/web/e2e/smoke.spec.ts`: core routes load, WCAG AA / tabular numerals / dark-first sanity; equal desktop + mobile
- [ ] T105 [P] Developer docs: update `README.md` + `infra/deploy/runbooks/withdraw-always.md` (the offline escape-hatch runbook) and an architecture overview cross-referencing the four layers and N1–N5

**Checkpoint**: Security suite green, drift-prevention enforced, quickstart + withdraw-always drill validated, monitoring live.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**. The policy constants seam (T009) and policy engine scaffold (T018) are the critical path.
- **User Stories (Phases 3–8)**: All depend on Foundational. Recommended priority order P1 → P1 → P2 → P2 → P2 → P3 (US1 → US2 → US3 → US4 → US5 → US6).
- **Trust Center & SRK (Phase 9)**: Depends on the contracts from US1 (vault/caps/kill-switch), US2 (account), and US6 (session keys) being deployed/readable.
- **Polish (Phase 10)**: Depends on all desired user stories complete.

### User Story Dependencies

- **US1 (P1, MVP)**: After Foundational. No dependency on other stories. The standalone vault + non-custody core.
- **US2 (P1)**: After Foundational. Independently testable; shares the `ExecutionDrawer` chokepoint that US1's vault flows also use (build US1's vault deposit/withdraw to route through it once T063 lands, or use a thin drawer first and swap).
- **US3 (P2)**: After Foundational. No hard dependency on US1/US2; produces the mandate that US5 consumes.
- **US4 (P2)**: After Foundational. Independent; benefits from US1 vault positions existing but renders an empty state otherwise.
- **US5 (P2)**: After Foundational. Logically consumes US3's mandate + US4's portfolio context and US2's build/sim/submit for "act on a recommendation"; degrades gracefully if a mandate is absent (prompts onboarding).
- **US6 (P3)**: After Foundational + US2 (account exists). The session-key path reuses the account/adapter/policy machinery.

### Within Each User Story

- Contract invariant/fuzz/fork tests are written FIRST and must FAIL before the contracts pass them (safety-critical, gating).
- Contracts/migrations (models) before services; services before endpoints; endpoints before frontend wiring.
- Policy/simulation gate before any signable artifact is rendered.
- Story complete before moving to the next priority.

### Parallel Opportunities

- All Setup tasks marked [P] (T002–T008) run in parallel after T001.
- Foundational [P] tasks split cleanly by workspace: shared-seam (T009–T012), contracts skeleton (T013–T015), DB (T016–T017), policy (T018–T019), agent (T020–T023), frontend (T024–T028), infra (T029–T030) — different files, parallelizable within each cluster (respecting T009 → T018).
- Once Foundational completes, **US1–US6 can be staffed in parallel** (different workspaces/files), with the priority order as the single-developer sequence.
- Within a story, [P] tasks touch different files (e.g. contracts vs. agent endpoints vs. frontend pages) and run together; same-file tasks are serialized.

---

## Parallel Example: User Story 1

```bash
# Contract invariant/fuzz tests (write FIRST, expect FAIL), different files — run together:
Task: "N1 invariant suite in contracts/test/invariant/NonCustody.t.sol"            # T035
Task: "Caps invariants in contracts/test/invariant/Caps.t.sol"                     # T038
Task: "ERC-4626 rounding fuzz in contracts/test/fuzz/Vault4626.t.sol"              # T039

# Contracts (after interfaces from T013/T014), different files — run together:
Task: "CapRegistry in contracts/src/governance/CapRegistry.sol"                    # T032
Task: "KillSwitch in contracts/src/governance/KillSwitch.sol"                      # T033
Task: "AaveV3Adapter in contracts/src/adapters/AaveV3Adapter.sol"                  # T034

# Agent quote endpoints + frontend, different files — run together:
Task: "POST /vault/quote/deposit in services/agent/.../api/vault.py"              # T042
Task: "POST /vault/quote/withdraw in services/agent/.../api/vault.py"             # T043
Task: "NonCustody badge in apps/web/components/NonCustodyBadge.tsx"               # T049
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; land T009 policy constants + T018 policy scaffold early).
3. Complete Phase 3: User Story 1 (vault deposit/withdraw + N1/N2/N5 invariant suite + public `/exit`).
4. **STOP and VALIDATE**: deposit/withdraw on Base Sepolia; run the withdraw-always drill (redeem with frontend + agents offline, while paused); confirm the N1–N5 invariant suite is green and gating CI.
5. Deploy/demo the conservative 0-management / profit-only performance-fee vault (10% of yield above HWM, 0% on principal, hard-capped at 20%) — the smallest viable slice that proves "AI-managed yield with verifiable non-custody; we only earn when you earn — never on your principal, never by taking custody."

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 (vault + non-custody core) → validate → **MVP demo**.
3. US2 (simulation-before-sign + per-action signing + AA account) → validate → demo the trust backbone.
4. US3 (onboarding → mandate) → US4 (portfolio) → US5 (recommendations + outcomes) → each validated and demoed independently (P2 tier).
5. US6 (scoped session-key automation) → validate the N4 invariant suite (P3 tier).
6. Phase 9 (Trust Center + SRK) → Phase 10 (hardening, drift-prevention, monitoring, quickstart, docs).
7. Each story adds value without breaking previous stories; withdraw-always (N2) is verified at every step.

### Parallel Team Strategy

With multiple developers, after Setup + Foundational:

- **Contracts dev**: US1 vault/caps/kill-switch → US2 account/factory/adapters → US6 session-key validator/policy module, owning the N1–N5 invariant suite throughout (gating).
- **Agent/backend dev**: policy engine + simulation gate (US2) → onboarding/mandate (US3) → recommender + outcomes (US5) → portfolio indexer (US4) → session endpoints (US6).
- **Frontend dev**: wallet/account seam + `ExecutionDrawer` chokepoint (US2) → vault dashboard + public `/exit` (US1) → onboarding/portfolio/strategy/outcomes surfaces → automation + Trust Center.
- Custody-critical seam (`apps/web/lib/chain`, public `/exit` + `/trust`) is owned jointly and must never hard-depend on `services/agent` (N2).

---

## Non-Custody Invariant & Simulation-Gate Task Index (safety-critical, gating)

Quick reference to the tasks that implement/verify the five non-custody invariants and the simulation-before-sign gate:

| Invariant / Gate | Implementing tasks | Verifying tasks (gating tests) |
|---|---|---|
| **N1 — No admin withdrawal** | T031 (vault, no sweep/rescue), T034/T053 (adapters force recipient), T051 (account recipient pin), T056 (policy recipient-pin), T107 (perf-fee shares mint only against yield above HWM, never principal; non-privileged feeRecipient) | T035 `invariant_noAdminCanDrain`, T054 `invariant_noSparkPointRecipient`, T058 (policy rejects SparkPoint recipient), T108 `invariant_principalPreserved` / `invariant_feeOnlyAboveHwm` / `invariant_feeRateLeCap` |
| **N2 — Withdraw-always** | T031 (no pause on withdraw/redeem), T043 (withdraw quote never gated), T048 (public `/exit`), T056/T088 (exit-skip branches), T107 (`_accrueFee` FAIL-OPEN; redemption never depends on fee collectibility) | T036 `test_withdrawWorks_whenPaused_andOffline`, T099 (kill-switch drill), T102 (withdraw-always quickstart drill), T108 `test_withdrawAlways_failOpen_independentOfAccrual` |
| **N3 — User-owned keys** | T025 (account adapter), T051 (owner ECDSA), T052 (factory binds owner=EOA), T020 (service holds no keys) | T054 `invariant_factoryOwnerIsCaller` / `invariant_onlyOwnerUpgrades`, T058 (no signature ever returned) |
| **N4 — Scoped, revocable automation** | T084 (PolicyModule), T085 (SessionKeyValidator), T086 (authorize/revoke owner-only), T088 (scope grammar), T089 (unsigned grant/revoke) | T087 session-key invariant suite (`...AfterExpiry`, `...RecipientIsAccount`, `revoke_isImmediate_andUnilateral`, `noApproveOrArbitraryCallEverAllowed`) |
| **N5 — Non-upgradeable + provable** | T031 (no proxy/admin slot, mgmt/entry/exit fee=0 constant), T107 (perf-fee `feeRate` timelocked + 20% hard-capped, non-upgradeable custody semantics), T032/T033 (pause-only governance), T093 (Trust Center prove-it), T094 (permission manifests) | T037 `test_vaultNotBehindProxy` / `test_governanceIsPauseOnly`, T108 `invariant_feeRateLeCap`, T041 (post-deploy `AssertNonCustody`), T092 (permissions read) |
| **Simulation-before-sign gate** | T057 (Tenderly sim), T059 (`/build-tx` sim-then-bundle), T063 (`ExecutionDrawer` Sign disabled without passed sim) | T058 (policy blocks on revert/over-slippage), T066 (E2E: sim before every sign), T098 (off-chain↔on-chain parity) |

---

## Notes

- [P] tasks = different files, no dependencies; same-file tasks are serialized.
- [Story] label maps each task to its user story (US1–US6) for traceability; shared phases carry no story tag.
- Contract invariant/fuzz/fork tests are written before implementation, must FAIL first, and gate CI + deploy (safety-critical); frontend tests are intentionally light (Playwright smoke + a11y).
- The policy constants live ONCE in `packages/shared` (T009) and feed both the off-chain layer and on-chain deploy; T098 enforces no drift.
- Every state-changing flow funnels through the single `ExecutionDrawer` signing chokepoint; no card is signable without a `policy: { status: 'approved' }` stamp.
- The public `/exit` and `/trust` routes never import the agent client — withdraw-always and provability survive total backend loss (N2/N5).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently; never weaken a non-custody invariant for convenience.

---

## Phase 2 — Obsidian knowledge tier (T121–T126) — ADDED post-plan, DONE

The advisory RAG tier (retrieval-only; never on the custody path, N2). All landed on develop;
see `docs/orchestration/GATES.md` (P2 + Phase C) for the authoritative record.

- **T121** — Seed corpus + retrieval relevance. Obsidian seed notes under `services/agent/knowledge_seed/`; committed real qwen3-1024 vectors + a replayable relevance test (`tests/knowledge/test_knowledge_relevance.py`). ✅
- **T122** — Ingestion pipeline: parse Obsidian markdown → chunk (per-section) → embed → idempotent upsert into `memory_chunks` (`knowledge/ingestion.py`, `store.py`). ✅
- **T123** — Provenance + safety: each chunk stamped with `git_sha` + `ingested_at`; a **pre-ingest PII/secret denylist** (fail-closed); the search SQL scoped `user_id IS NULL`; and a proper **`knowledge` `memory_source` enum** (migrations 0006/0007) replacing the `literacy_tip` shim. ✅ (Phase C)
- **T124** — Shared embedder: a version-pinned space (`qwen3-embedding:8b`, MRL-truncated to 1024-dim + renormalized). The provider (`EMBEDDING_OPENAI_MODEL`) is validated against the pin — a foreign model is **rejected**, not silently stamped. ✅ (Phase C)
- **T125** — Retriever wired into BOTH DAG builders (chat + recommendations); `None` when unconfigured so CI stays green and citations are never fabricated. ✅
- **T126** — Boundary: the knowledge tier imports the stdlib + the `store` seam + the `embeddings` embedder ONLY (never `policy`/`agents`/`coordinator`); enforced by `test_knowledge_boundary.py`. ✅
