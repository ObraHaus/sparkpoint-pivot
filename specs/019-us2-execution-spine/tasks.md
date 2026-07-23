# Tasks: US2 Execution Spine — the Single Signing Chokepoint

**Feature**: `specs/019-us2-execution-spine` | **Branch**: `feature/019-us2-execution-spine`

**Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/execution-endpoints.md](./contracts/execution-endpoints.md) ·
[quickstart.md](./quickstart.md)

Tests are **included** — non-custody (N1–N5), simulation-before-sign, and fail-closed are
constitution-mandated and must be pinned by contract/unit tests. `[P]` = parallelizable (different
files, no incomplete deps). Story labels map to spec user stories (US1 build, US2 drawer-sign, US3
re-simulate, US4 submit+status, US5 non-custody invariants).

---

## Phase 1: Setup

- [ ] T001 Create the migration `services/agent/migrations/0021_execution.sql` skeleton (banner comment + N1/N2 non-custody note + `PGCLIENTENCODING=UTF8` note), empty body, per data-model.md ordering.
- [ ] T002 [P] Create the new agent package dir + `__init__.py` at `services/agent/src/sparkpoint_agent/execution/__init__.py`.
- [ ] T003 [P] Create the web dirs `apps/web/src/components/execution/` and `apps/web/src/lib/execution/` (placeholder `.gitkeep` or first file).

## Phase 2: Foundational (BLOCKS all user stories)

**Migration + persistence**

- [ ] T004 Write `services/agent/migrations/0021_execution.sql`: the 5 guarded enums (`policy_verdict`, `execution_status`, `action_kind`, `signing_mode`, `attribution_method`) + `intent_bundles` (sim FK nullable, no FK to recommendations/session_keys) + `simulation_results` (inline FK→intent_bundles) + `ALTER TABLE intent_bundles ADD CONSTRAINT ... FOREIGN KEY(simulation_result_id)` + `executions` (inline FK + `UNIQUE(intent_bundle_id)`) + indexes, exactly per data-model.md.
- [ ] T005 [P] `services/agent/src/sparkpoint_agent/db/intent_bundles.py`: `@dataclass IntentBundleStore(db: Database)` with `insert(...) -> UUID` and `get(intent_id) -> row|None`, copying `db/network_diagnostics.py`/`db/subscriptions.py` idioms (`$n::jsonb`, `.lower()` addresses).
- [ ] T006 [P] `services/agent/src/sparkpoint_agent/db/simulations.py`: `SimulationStore` with `insert(...) -> UUID`, `get_by_bundle(...)`, `refresh(...)`.
- [ ] T007 [P] `services/agent/src/sparkpoint_agent/db/executions.py`: `ExecutionStore` with `insert_submitted(...) -> UUID|None` (`ON CONFLICT (intent_bundle_id) DO NOTHING RETURNING id`), `update_status(...)`, `get_by_intent(...)`.
- [ ] T008 Export the 3 stores from `services/agent/src/sparkpoint_agent/db/__init__.py`.

**Wire models + parity**

- [ ] T009 [P] `services/agent/src/sparkpoint_agent/execution/models.py`: pydantic `IntentStep`, `PackedUserOperation` (signature `None`), `Reason`, `GuardrailCheck`, `WirePolicyVerdict`, `IntentBundle`, and the request/response bodies `BuildTxRequest`, `SimulateRequest`, `SubmitSignedRequest`, `Submission`, `SubmissionStatus` — all `ConfigDict(extra="forbid")` + camelCase, reusing `sim.SimulationResult`; byte-parity with `packages/shared/src/schemas/*` per contracts/execution-endpoints.md.
- [ ] T010 [P] `services/agent/tests/execution/test_wire_parity.py`: assert the new pydantic model field-sets == the zod `.strict()` field-sets for `IntentBundle`/`SimulationResult`/`WirePolicyVerdict`/`IntentStep`/`PackedUserOperation` (read `packages/shared/dist` or the `.ts` field lists); fail on drift.

**Decode / build / assemble / serialize primitives (pure-ish, unit-testable)**

- [ ] T011 [P] `services/agent/src/sparkpoint_agent/execution/decode.py`: `decode_action(wire: dict, *, owner: str, chain_id: int) -> policy.Action` — asset **address→symbolic Asset**, amount→int, recipient **pinned to owner**, selector/target resolved via `policy.constants`; raise a typed `DecodeError` (→ `VALIDATION_ERROR`) for unknown type/asset/selector or a non-vault action (honest refusal for swap/direct-Aave on testnet).
- [ ] T012 [P] `services/agent/src/sparkpoint_agent/execution/builder.py`: `build_steps(action, *, vault, owner, chain_id) -> tuple[IntentStep,...]` — reuse `vault._encode_deposit`/`_encode_redeem` + add `_encode_withdraw` (`0xb460af94`); `opType="eoa_call"`, recipient forced to owner, `signature` never set.
- [ ] T013 `services/agent/src/sparkpoint_agent/execution/assemble.py`: `assemble_context(action, *, reader, config, sim) -> policy.PolicyContext` — prove-deployed via `reader.asset()` (raises `VaultUnavailable(NOT_DEPLOYED)`), gather fresh cap headroom + `paused()` + staleness + `resolved_targets`, fold in the fresh `SimulationInput`; **skip cap/pause gather entirely when `action.direction is EXIT` (N2)**.
- [ ] T014 [P] `services/agent/src/sparkpoint_agent/execution/serialize.py`: `to_intent_bundle(...)` and `to_wire_verdict(policy.PolicyVerdict, *, action, simulation) -> WirePolicyVerdict` (status→approved bool, reason codes→`[{code,message}]`, drop `trace`, Action→`ProposedAction`), + `to_guardrail_checklist(verdict.trace) -> list[GuardrailCheck]`.
- [ ] T015 [P] `services/agent/tests/execution/test_decode.py` + `test_builder.py` + `test_serialize.py`: unit tests for the four primitives (recipient-pin, asset resolution, calldata selectors byte-exact, verdict→wire mapping, guardrail checklist).

**Router skeleton**

- [ ] T016 `services/agent/src/sparkpoint_agent/api/execution.py`: `router = APIRouter(tags=["execution"])`, the `get_account`/`get_vault_reader`/`get_sim_config`/`get_dry_runner` deps (reuse vault.py patterns), stub handlers returning `501`/NotImplemented; register `execution_router` + reuse `VaultUnavailable` handler in `api/main.py`.

## Phase 3: User Story 1 — Build a signable IntentBundle (Priority: P1) 🎯 MVP

**Goal**: `POST /build-tx` turns an approved vault action into one persisted, simulated,
policy-approved unsigned bundle; a rejected action returns reasons + no bundle.
**Independent test**: quickstart steps 1–2 (approved deposit → bundle; over-cap → reasons, no bundle).

- [ ] T017 [US1] `services/agent/src/sparkpoint_agent/execution/orchestrate.py`: `build_tx(request, *, account, reader, config, dry_run, stores) -> IntentBundle` running the ordered fail-closed pipeline (decode → prove-deployed/assemble → build → simulate → evaluate → gate → persist sim+bundle → serialize). On rejection: persist the rejected bundle row + raise the mapped `ApiError` with `reasons[]`.
- [ ] T018 [US1] Wire `POST /build-tx` in `api/execution.py` to `orchestrate.build_tx`; map policy reason codes → `ApiError` codes (`POLICY_REJECTED`/`CAP_EXCEEDED`/`SLIPPAGE_EXCEEDED`/`SIMULATION_REVERT`/`SIMULATION_UNAVAILABLE`/`DATA_STALE`/`KILL_SWITCH_PAUSED`); attach `simulation` to a `SIMULATION_REVERT` envelope.
- [ ] T019 [US1] Deposit allowance-defer: in the deposit path, read live USDC allowance; if `< amount`, skip the dry-run and return an honest approval-first state (mirror 018 `approvalRequired`), never a false revert.
- [ ] T020 [P] [US1] `services/agent/tests/api/test_build_tx.py`: approved deposit → 200 bundle (recipient=owner, `userOp:null`, `signature` absent, `policyVerdict.approved`, persisted sim referenced by bundle — VR-X2); over-cap → 422 `CAP_EXCEEDED` + no bundle; non-allowlisted target → `POLICY_REJECTED`; idempotency replay → same bundle; unsupported swap/direct-Aave → honest refusal.

## Phase 4: User Story 2 — Sign once in the ExecutionDrawer (Priority: P1)

**Goal**: the drawer renders a built bundle and produces exactly one wallet signature over the
server-issued calldata **verbatim** (byte-match); rejected/expired bundles offer no Sign.
**Independent test**: quickstart step 4 (render checklist/deltas/rationale; sign; signed `to`/`data`
byte-match the bundle).

- [ ] T021 [P] [US2] `apps/web/src/lib/execution/executionModel.ts`: pure helpers — `assertSignableBundle` (approved + unexpired + chain-match), `stepToTx(step)` (→ `{to,data,value}` for `sendTransaction`), `renderDeltas`, `expiresInMs`.
- [ ] T022 [P] [US2] `apps/web/src/lib/execution/useBuildTx.ts`: `AgentClient.request('/build-tx', {method:'POST', body:{action, execMode:'per_action'}, idempotencyKey})`; surface `AgentApiError`.
- [ ] T023 [US2] `apps/web/src/components/execution/ExecutionDrawer.tsx`: render `guardrailChecklist` + `simulation.balanceDeltas` + `rationale` + `citations` + fee/risk disclosure; Sign gated by `assertSignableBundle`; sign via `wagmi.sendTransaction(stepToTx(steps[0]))` (**no re-encode**); hold force-refresh during signing; withdraw stays ungated (N2).
- [ ] T024 [US2] Mount a "Sign" affordance on an **approved** recommendation/chat `action` block that opens the `ExecutionDrawer` (do NOT touch the existing manual vault ConfirmFlow).
- [ ] T025 [P] [US2] `apps/web/src/lib/execution/executionModel.test.ts`: byte-match `stepToTx` equals the bundle step; expiry + chain-match gating; rejected bundle → no sign.

## Phase 5: User Story 3 — Never sign stale data (Priority: P2)

**Goal**: a near-expiry bundle is re-simulated before signing.
**Independent test**: a bundle past its freshness threshold forces a `/simulate` call; fresh does not.

- [ ] T026 [US3] Wire `POST /simulate` in `api/execution.py` + `orchestrate.re_simulate(intentId|steps)`: re-run the dry-run for a stored bundle, refresh `simulation_results`, return `{ simulation }`; `NOT_FOUND`/`SIMULATION_UNAVAILABLE`/`DATA_STALE` honest.
- [ ] T027 [US3] Drawer: detect near-expiry (`expiresInMs` below threshold) and call `/simulate` (or rebuild) before enabling Sign; block a positive deposit revert (advisory-only on withdraw — N2).
- [ ] T028 [P] [US3] `services/agent/tests/api/test_simulate.py`: refresh returns a fresh sim; unknown intent → `NOT_FOUND`.

## Phase 6: User Story 4 — Durable execution record + status (Priority: P2)

**Goal**: relay a user-signed payload (byte-matched), record one execution, poll status to confirmation.
**Independent test**: quickstart step 5 (submit → 202 + one `executions` row; tampered → rejected;
status → confirmed).

- [ ] T029 [US4] Wire `POST /submit-signed-tx` in `api/execution.py` + `orchestrate.submit_signed`: load bundle; **byte-match** signed `to`/`data`/`value`/sender vs the issued step (else `VALIDATION_ERROR`); reject null signature; insert `executions` (`submitted`, unique on intent) — de-dup returns the existing row; `202 { submission: pending }`; never `KILL_SWITCH_PAUSED` for a withdraw.
- [ ] T030 [US4] Wire `GET /submit-signed-tx/{intentId}` + `orchestrate.submission_status`: read the receipt, map `pending|confirmed|failed`, update the `executions` row, return status + txHash + block.
- [ ] T031 [P] [US4] `apps/web/src/lib/execution/useSubmitSigned.ts`: after direct submit, optional relay via **raw** `fetch('/api/agent/submit-signed-tx', …)` (typed client refuses signatures); poll `GET …/{intentId}`; stable idempotency key per intent.
- [ ] T032 [P] [US4] `services/agent/tests/api/test_submit_signed.py`: byte-match happy path → 202 + one row; tampered payload → `VALIDATION_ERROR` + no row; null signature → rejected; double-submit → single row (unique); status transitions.

## Phase 7: User Story 5 — Non-custody invariants under adversarial conditions (Priority: P1)

**Goal**: prove N1/N2/N3 hold under hostile inputs across build/sign/submit. Enforcement lives in the
US1/US2/US4 tasks; this phase is the dedicated adversarial proof + any missing guards.
**Independent test**: quickstart step 3 + the non-custody spot checks.

- [ ] T033 [US5] `services/agent/tests/api/test_build_tx_noncustody.py`: a `vault_withdraw`/`vault_redeem` build succeeds under a fully hostile ctx (paused + at-cap + stale + no-sim) and **never** returns `KILL_SWITCH_PAUSED`/`CAP_*`/`DATA_STALE`; a deposit while paused → `KILL_SWITCH_PAUSED` + no bundle (asymmetry).
- [ ] T034 [P] [US5] `services/agent/tests/api/test_build_tx_noncustody.py` (cont.): every build response has `userOp.signature is None`/absent; recipient in every `steps[].data` decodes to the connected owner; a recipient override attempt is impossible (rejected `RECIPIENT_NOT_USER`).
- [ ] T035 [P] [US5] Assert the manual vault ConfirmFlow + direct `/exit` path are untouched (grep/test): `apps/web` build + existing `useConfirmPreview`/`vaultConfirmModel` tests still green; no `/api/agent/*` call added to `/exit`.
- [ ] T036 [US5] `services/agent/tests/api/test_submit_signed.py` (cont.): the service never stores a signature/key — only `tx_hash`/`userop_hash` (assert the `executions` row + no secret columns); VR-X1 (no `submitted` without a signature event).

## Phase 8: Polish, Housekeeping & Ship

- [ ] T037 Run the full agent gate locally: `cd services/agent && uv run ruff check src && uv run mypy src && uv run pytest -q` — all green.
- [ ] T038 Run the full web gate locally: `cd apps/web && pnpm run typecheck && pnpm run typecheck:test && pnpm run lint && node --experimental-strip-types --test "src/lib/execution/**/*.test.ts" && pnpm run build` — all green; `cd packages/shared && pnpm run build`.
- [ ] T039 [P] Update `CHANGELOG.md` (Added: execution spine endpoints + 0021 migration + ExecutionDrawer; behavior/schema/infra bullets) and `MIGRATIONS.md` (0021 row + changelog + current-state = develop@0021).
- [ ] T040 [P] Add an in-app `/changelog` entry: seed `services/agent/content_seed/whats-new.json` (tags New/Improved/Fixed only) — client-friendly "Sign AI-proposed vault actions in one place" entry; also plan the direct `content_entries` upsert for a redeploy-free go-live.
- [ ] T041 [P] Update `docs/phase-3-deferred.md` row 8 (US2): mark the build-tx chokepoint + ExecutionDrawer + submit relay + 0021 shipped; keep direct-Aave + Aerodrome swap sim deferred/honest; note US5 attribution now unblocked (row 7). Update `docs/architecture-as-built.md` if topology changed.
- [ ] T042 Apply migration 0021 to the develop DB (`DATABASE_URL … PGCLIENTENCODING=UTF8 uv run --group migrations yoyo apply …`) **before** the agent redeploy; verify the 3 tables + enums exist.
- [ ] T043 Open the PR (base `develop`), ensure CI green (agent ruff+mypy+pytest, web tsc/typecheck:test/eslint/build/unit, shared parity, changelog-required), address review, merge.
- [ ] T044 Deploy agent + web on Coolify (manual trigger), confirm `/api/version` == the merged SHA; run the quickstart end-to-end on alpha (SC-007) with the deployer wallet via the real SIWE flow; validate the non-custody spot checks live.
- [ ] T045 Update memory (`MEMORY.md` + a `sparkpoint-019-execution-spine.md` note): what shipped, the 0021 migration, the eoa_call scope, the byte-match, and that US5 attribution is unblocked.

---

## Dependencies & order

- **Setup (P1)** → **Foundational (P2)** block everything.
- **US1 (T017–T020)** depends on Foundational; it is the MVP and unblocks US2/US3/US4.
- **US2 (T021–T025)** depends on US1's `/build-tx`.
- **US3 (T026–T028)** and **US4 (T029–T032)** depend on US1 (+ US4 needs `executions`).
- **US5 (T033–T036)** verifies invariants built into US1/US2/US4 — run after them.
- **Polish/Ship (T037–T045)** last; migration apply (T042) before agent redeploy (T044).

## Parallel opportunities

- Foundational: T005/T006/T007 (db modules), T009/T010 (models+parity), T011/T012/T014/T015 (primitives+their tests) run in parallel after T004.
- US1: T020 parallel with UI once T017–T019 land.
- US2: T021/T022/T025 parallel; T023/T024 serial after.
- Polish: T039/T040/T041 parallel.

## MVP scope

**US1 + US2** (build + sign + direct submit) is the demonstrable MVP: an AI-proposed vault deposit
becomes a signed on-chain tx through the single chokepoint. US3/US4 add refresh + durable
record/status; US5 is the non-custody proof. Ship all for the full anchor (unlocks US5 attribution).

## Format validation

All tasks use `- [ ] Txxx [P?] [USx?] description + file path`. Setup/Foundational/Polish carry no
story label; US phases carry `[US1]`–`[US5]`.
