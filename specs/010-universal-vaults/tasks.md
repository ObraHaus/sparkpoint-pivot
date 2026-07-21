---
description: "Task list for 010-universal-vaults"
---

# Tasks: Universal Vaults

**Input**: Design documents in `specs/010-universal-vaults/` (spec.md, plan.md, research.md, data-model.md,
contracts/vault-registry-interfaces.md, quickstart.md)

**Tests**: Included where they matter. 010 moves NO funds and signs nothing, so the test focus is the two
places correctness is load-bearing: (1) the **fail-open** market feed + generic reader (attacker-controlled
external vault data / flaky upstream), and (2) the **advisory-only invariant** — that the feed and registry
NEVER widen policy, i.e. Morpho is never policy-cleared and the signable candidate set is byte-identical with
the feed on or off. Requested in the spec.

**Organization**: Grouped by user story (US1–US4 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 (or SETUP / POLISH)

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for any behavior/schema/infra change (the market
      feed, the `AddressBook.vaults[]` registry field, the reader split, the read-only `/admin/vaults` page,
      the `MARKET_DATA_*` env vars all qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase
      (US1: the AI now sees live external yields; US3: the read-only universal-vaults view; US4: chat can
      compare vaults), stable `slug`. (US2 is internal plumbing — a `CHANGELOG.md` bullet suffices.)
- [ ] `DEVELOPMENT.md` documents every new config: the `MARKET_DATA_ENABLED` / `MORPHO_GRAPHQL_URL` /
      `MARKET_DATA_TTL_SECONDS` / `MARKET_DATA_TIMEOUT_MS` env vars **and** the `AddressBook.vaults[]` field
      (state explicitly: a plain, NON-policy registry field).
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint &&
      build` green; new unit tests green; **non-custody + advisory-only invariants confirmed in review**
      (Constitution I/II/IV): Morpho absent from `policy/enums.py` / `enums.ts` / `TARGET_REF_FIELD` /
      candidate set; feed-off ⇒ signable set unchanged.
- [ ] No new env var undocumented; no new agent seed dir without an explicit `COPY` in
      `services/agent/Dockerfile` (none expected this feature).

---

## Phase 0: Groundwork — the `VaultMeta` registry shape (no behavior change)

**Purpose**: land the shared registry type + the reader method split once, so every later phase consumes one
source of truth. Ships alone; pure additive plumbing, guarded by the parity + type checks.

- [ ] T001 [SETUP] Add `VaultMeta` + `AddressBook.vaults?: readonly VaultMeta[]` as a PLAIN, non-policy field
      (NOT a `TargetRef`; NOT in `TARGET_REF_FIELD`). Files: `packages/shared/src/addresses/types.ts`.
- [ ] T002 [SETUP] Mirror `VaultMeta` (frozen dataclass) + a `vaults: list[VaultMeta]` on `AgentConfig` in
      Python. Files: `services/agent/src/sparkpoint_agent/config.py`.
- [ ] T003 [P] [SETUP] Split `_REQUIRED_METHODS` into `_ERC4626_CORE_METHODS` + `_SPARKPOINT_EXTRA_METHODS`
      (keep `_REQUIRED_METHODS` = the superset for back-compat, drift guard unchanged). Files:
      `services/agent/src/sparkpoint_agent/chain/vault_reader.py`.
- [ ] T004 [P] [SETUP] `CHANGELOG.md` — `## [Unreleased]` bullet: "feat(shared/agent): universal vault
      registry shape + ERC-4626 reader method split (read-only, non-policy)".

**Checkpoint**: registry type exists on both sides; `TARGET_REF_FIELD` compile guard + T098 parity still
green (proving `vaults[]` is non-policy); reader superset behavior unchanged.

---

## Phase 1 → User Story 1 — The AI can see live vault yields (Priority: P1) 🎯 MVP

**Goal**: a keyless, fail-open market feed (Morpho GraphQL primary + DeFiLlama/on-chain fallback) wired into
the recommender's `MarketData` so it ranks the SparkPoint Aave vault vs external Morpho vaults on real net
APY/TVL — **advisory only, never influencing signability**.

**Independent Test**: quickstart US1.

### Tests for US1 (write first, ensure they fail)

- [ ] T005 [P] [US1] `test_market_data.py` — Morpho success ⇒ `StrategyMarket(source='morpho')` net of fees;
      Morpho timeout/5xx ⇒ fail-open to DeFiLlama; all fail ⇒ "unavailable" (**never `0`**, never raises);
      stale-cache ⇒ `stale=True`. Files: `services/agent/tests/data/test_market_data.py`.
- [ ] T006 [P] [US1] `test_advisory_only.py` — with the provider forced all-"unavailable", the set of
      **signable** candidates + every policy verdict is byte-identical to the populated run (the feed changes
      order/prose only); `Protocol` never gains a Morpho member. Files:
      `services/agent/tests/coordinator/test_advisory_only.py`.

### Implementation for US1

- [ ] T007 [P] [US1] `data/market_data.py` — `StrategyMarket`, `MarketDataProvider` protocol,
      `MorphoGraphQLProvider` (mainnet-only, keyless), `DeFiLlamaProvider`, `OnChainDerivedProvider`,
      `CompositeMarketProvider` (fail-open, in-memory TTL cache). Per contracts §2a. New
      `services/agent/src/sparkpoint_agent/data/market_data.py`.
- [ ] T008 [US1] Extend `MarketData` (add `source` / `as_of` / `stale` / `external: tuple[StrategyMarket,…]`)
      keeping defaults so `ChainContext` construction stays valid. Files:
      `services/agent/src/sparkpoint_agent/coordinator/dag.py` (depends on T007).
- [ ] T009 [US1] Wire `_build_chain_context` to call the provider fail-open: populate `gross_apy_bps` from the
      SparkPoint vault's snapshot (null on miss — NEVER fabricated), keep `projected_apy_bps=None` (no
      forecasts), attach `external`. Files: `services/agent/src/sparkpoint_agent/api/recommendations.py`
      (depends on T008).
- [ ] T010 [US1] Recommender reads `MarketData.external` to RANK/NARRATE only; `propose()` candidate set stays
      code-defined + unchanged; `_to_item` attaches per-candidate figures + external/estimated labels +
      citations to the wire item. Files: `services/agent/src/sparkpoint_agent/agents/recommender.py`,
      `services/agent/src/sparkpoint_agent/agents/strategy_recommender.py`,
      `services/agent/src/sparkpoint_agent/coordinator/dag.py` (depends on T008, T009).
- [ ] T011 [P] [US1] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Your assistant now
      sees live yields across external vaults") + `DEVELOPMENT.md` (`MARKET_DATA_*` / `MORPHO_GRAPHQL_URL`).

**Checkpoint**: recommendations carry real net APY/TVL and rank the Aave vault vs external Morpho vaults, all
labeled external/estimated; feed-off ⇒ signable set unchanged; no policy widening.

---

## Phase 2 → User Story 2 — Universal registry + generic ERC-4626 reader (Priority: P2)

**Goal**: adding a vault = a registry row. A generic reader (Python + web) reads any ERC-4626 vault via the
core method set; the SparkPoint vault keeps its superset; the web gains `resolveErc4626` + `useVaults`;
`derive.ts` widens to N vaults — all read-only.

**Independent Test**: quickstart US2.

### Tests for US2 (write first)

- [ ] T012 [P] [US2] `test_vault_reader.py` — generic 4626 read via the core set; missing core method ⇒
      fail-**open** `VaultUnavailable`; SparkPoint superset still fail-**closed** on drift; **non-custody
      structural test**: no state-changing selector registrable for any `abiKind`; hostile vault (revert / no
      code / `decimals>36`) ⇒ "unavailable". Files: `services/agent/tests/chain/test_vault_reader.py`.
- [ ] T013 [P] [US2] `resolveErc4626.test.ts` — resolves a generic row; `{status:'unavailable'}` on no-code /
      read failure without throwing; SparkPoint extras read only for `abiKind:'sparkpoint'`; a one-row
      failure does not reject the batch. Files: `apps/web/src/lib/vault/resolveErc4626.test.ts`.

### Implementation for US2

- [ ] T014 [US2] Generalize the reader to a `VaultMeta` + `abiKind`: `read_vault(cfg, meta)` selects the core
      vs superset registry, fail-open for `erc4626`, fail-closed for `sparkpoint`; still `view`/`pure`-only,
      keyless. Files: `services/agent/src/sparkpoint_agent/chain/vault_reader.py` (depends on T003).
- [ ] T015 [P] [US2] `resolveErc4626.ts` — generic web reader (wagmi multicall `allowFailure`, on-chain
      `decimals` authoritative + clamp `>36`, SparkPoint extras gated on `abiKind`), returns `VaultView`
      fail-open per row. New `apps/web/src/lib/vault/resolveErc4626.ts` (per contracts §1b).
- [ ] T016 [US2] `useVaults.ts` — iterate `getAddresses(chainId).vaults ?? []` → `resolveErc4626` each,
      fail-open, display-plane only; leave the single-vault `useVault.ts` untouched. New
      `apps/web/src/lib/chain/useVaults.ts` (depends on T015).
- [ ] T017 [US2] Widen `derive.ts` to N vaults: `key: 'vault' | 'idle' | 'ext:<addr>'` + `external` flag; keep
      the USD/decimals discipline (no oracle invented for unknown-price external assets). Files:
      `apps/web/src/lib/portfolio/derive.ts` (depends on T016).
- [ ] T018 [US2] Seed the registry rows: the SparkPoint vault (`abiKind:'sparkpoint'`, `verified:true`) + any
      curated external vault. Files: `packages/shared/src/addresses/base.ts`,
      `packages/shared/src/addresses/baseSepolia.ts`, `packages/shared/src/addresses/robinhoodTestnet.ts`,
      `services/agent/src/sparkpoint_agent/config.py` (depends on T001, T002).
- [ ] T019 [P] [US2] Living docs: `CHANGELOG.md` bullet + `DEVELOPMENT.md` (`AddressBook.vaults[]` — a plain,
      NON-policy registry field; adding a vault = a row).

**Checkpoint**: a generic 4626 vault reads via the registry with one row; SparkPoint reader unchanged;
`useVaults`/`derive` render N vaults read-only; no policy/enum touched.

---

## Phase 3 → User Story 3 — Read-only multi-vault visibility (Priority: P2)

**Goal**: the app shows the Aave vault + registered external vaults; a **read-only** `/admin/vaults` page
lists all vaults with live TVL/APY/state — **no management actions** (management is 011).

**Independent Test**: quickstart US3.

### Tests for US3 (write first)

- [ ] T020 [P] [US3] `admin-vaults.spec.ts` (Playwright, `domcontentloaded` + long hydration budget) — lists
      the SparkPoint vault + external rows; only the SparkPoint row carries SparkPoint chrome; external rows
      show external/estimated labels; feed-off ⇒ "unavailable" not `0`; **no** management control present.
      Files: `apps/web/e2e/pw/admin-vaults.spec.ts`.

### Implementation for US3

- [ ] T021 [US3] Read-only `/admin/vaults` page via `AdminShell` + `useVaults`: table of all registered vaults
      (label/protocol/verified/TVL/APY/state), SparkPoint row distinct, external rows labeled
      external/estimated, honest "unavailable" states. NO deposit/withdraw/pause/add controls. New
      `apps/web/src/app/admin/vaults/page.tsx` (depends on T016).
- [ ] T022 [US3] App-side multi-vault display: surface registered external vaults as market context alongside
      the single SparkPoint vault on the relevant portfolio/vault surface, reusing `useVaults` + the
      external/estimated chrome; keep the SparkPoint vault the only "your SparkPoint vault" element. Files:
      `apps/web/src/lib/chain/useVault.ts` (unchanged, referenced), the portfolio/vault screen components
      consuming `useVaults` (depends on T016, T017).
- [ ] T023 [US3] Add the `/admin/vaults` entry to the admin nav (read-only). Files:
      `apps/web/src/app/admin/layout.tsx` (or the AdminShell nav config).
- [ ] T024 [P] [US3] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("See every vault's
      live yield in one place — read-only").

**Checkpoint**: `/admin/vaults` + the app show all vaults read-only with honest live figures; zero management
control (deferred to 011's manage half); exit path independent of `useVaults`.

---

## Phase 4 → User Story 4 — Chat advisory parity (Priority: P3)

**Goal**: the assistant references + compares external vaults with citations, treating them as unverified
external market data — **no signable action** for any external vault.

**Independent Test**: quickstart US4.

### Tests for US4 (write first)

- [ ] T025 [P] [US4] Chat advisory test — a turn comparing the SparkPoint vault to a Morpho vault emits
      citations with `source` + `as_of` + the external/estimated label, emits **no** `proposedAction`
      targeting a non-whitelisted protocol, and never invokes the deterministic gate for an external vault.
      Files: `services/agent/tests/coordinator/test_chat_advisory.py`.

### Implementation for US4

- [ ] T026 [US4] Chat blocks carry external market context as prose + citation only (no new `proposedAction`
      field, no new `Asset`, no execution block); reference `StrategyMarket.source`/`as_of` + external label.
      Files: `services/agent/src/sparkpoint_agent/coordinator/chat_blocks.py` (depends on T007, T010).
- [ ] T027 [US4] Recommender/literacy prose can compare vaults on net APY using `MarketData.external`, always
      labeling external/estimated + "not a SparkPoint vault". Files:
      `services/agent/src/sparkpoint_agent/agents/recommender.py`,
      `services/agent/src/sparkpoint_agent/agents/strategy_recommender.py` (depends on T010).
- [ ] T028 [P] [US4] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Ask your assistant
      to compare vaults").

**Checkpoint**: chat compares vaults with citations; external vaults are advisory-only (no confirm card, no
gate, no proposed action); back-compatible.

---

## Phase POLISH: Cross-cutting

- [ ] T029 [P] [POLISH] `derive.test.ts` (web) — N-vault derivation keeps USD/decimals discipline; external
      positions labeled; unknown-price external asset shown in its unit, not folded into USD. Files:
      `apps/web/src/lib/portfolio/derive.test.ts`.
- [ ] T030 [POLISH] Re-run the honest-state matrix (quickstart) on develop/alpha across 8453 (real Morpho
      feed) + 84532/46630 (mainnet-only ⇒ "unavailable"); paste evidence into the PR body.
- [ ] T031 [P] [POLISH] Confirm NO policy/parity CI drift: `Protocol` is still exactly
      `{aave_v3, aerodrome, sparkpoint_vault}` on both `enums.py` + `enums.ts`; `TARGET_REF_FIELD` unchanged;
      `vaults[]` non-policy. Run the T098 parity check + `services/agent` policy tests.
- [ ] T032 [POLISH] Security self-review vs Constitution I/II/III/IV + the no-widen FR (spec.md, mirrors 007
      FR-024): read-only, no execution path into a non-whitelisted protocol, no fabricated figures, external
      data clearly labeled NOT the SparkPoint vault. Confirm before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first — the registry shape + reader split unblock every phase.
- **US1 (P1, MVP)** → **US2 (P2)** → **US3 (P2)** → **US4 (P3)**. Each ships to `develop` independently.
- Within a story: tests before implementation. `market_data.py` (T007) precedes the `MarketData`/context
  wiring (T008–T010). The generic reader (T014) + web `resolveErc4626` (T015) precede `useVaults` (T016) →
  `derive` (T017) → `/admin/vaults` (T021). Chat (US4) depends on the US1 feed.
- Registry seeding (T018) needs the shape from Phase 0 (T001/T002).

## Parallel Opportunities

- T005/T006 (tests) · T007 (new provider module) · T012/T013 (reader tests) · T015 (new web reader) ·
  living-docs [P] tasks. Shared-file tasks (`dag.py`, `recommendations.py`, `vault_reader.py`,
  `derive.ts`) must serialize within their phase.

## Notes

- Add deps with **pnpm 9 (NOT 11)** — the lockfile version trap.
- No new agent seed dir expected; if one is ever added it needs an explicit `COPY` in
  `services/agent/Dockerfile` (silent 0-rows in prod otherwise).
- Commit after each task or logical group; branch `010-universal-vaults` off `develop`.
- Confirm before any `git push` / PR / merge (repo CLAUDE.md) and before any Coolify/prod action.
- **Advisory-only + non-custody are review gates, not afterthoughts** (Constitution I/II/IV): 010 adds ZERO
  execution path into any non-whitelisted protocol. The signable/manage half is 011.
