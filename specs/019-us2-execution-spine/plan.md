# Implementation Plan: US2 Execution Spine — the Single Signing Chokepoint

**Branch**: `feature/019-us2-execution-spine` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-us2-execution-spine/spec.md`

## Summary

Wire the already-built, pure policy engine (`policy/evaluate.py`) and pre-trade simulator
(`sim/simulator.py`) into the execution REST spine so an AI-proposed **vault** action becomes a
single, unsigned, simulated, policy-approved **Intent Bundle** the user signs **once** in an
**Execution Drawer**, is submitted and tracked to confirmation, and is persisted for per-advice
attribution. Four agent endpoints (`POST /build-tx`, `POST /simulate`, `POST /submit-signed-tx`,
`GET /submit-signed-tx/{intentId}`), a `0021` migration (`intent_bundles` / `simulation_results` /
`executions`), three DB modules, a Python `IntentBundle`/wire-`PolicyVerdict` model set, a
wire→`Action` decoder + calldata builder + context assembler, and a web `ExecutionDrawer` (signs the
server-issued calldata **verbatim**, submits directly by default, relay optional). Non-custody
(N1–N5) and fail-closed are hard requirements. Testnet scope = the vault path
(`vault_deposit`/`vault_withdraw`/`vault_redeem`) via `opType=eoa_call`, `execMode=per_action`;
direct-Aave + Aerodrome swap sim stay honestly fail-closed. `intent_bundles.id` is the
`intent_action_id` that unlocks US5.

**The engine is ~70% pre-built.** This feature is disciplined wiring + persistence + one new UI
surface, not new custody logic. Everything routes through `policy.evaluate()` (unchanged) so the
deterministic gate — not the LLM — decides signability.

## Technical Context

**Language/Version**: Python 3.12 (agent, FastAPI); TypeScript 5 / Next.js 16 App Router (web).

**Primary Dependencies**: agent — FastAPI, asyncpg, `eth_abi`, `httpx` (existing `sim` engine), the
existing `policy` package, `pydantic` v2. web — wagmi v2 / viem, TanStack Query, the existing typed
`AgentClient` + the catch-all BFF proxy + `zod` `@sparkpoint/shared`.

**Storage**: Postgres (yoyo migrations, out-of-band). New: `intent_bundles`, `simulation_results`,
`executions` (+ enums) in `0021_execution.sql`. No key/signature/signed-payload is ever stored (N3).

**Testing**: agent — pytest (contract tests mirroring `tests/api/test_vault_simulate.py` +
`tests/policy/*`), `ruff` + `mypy --strict`. web — `node --experimental-strip-types --test`, `tsc`,
`tsc -p tsconfig.test.json`, eslint, `next build`. Shared — the policy-parity CI (constants) + a new
hand-written zod⟷pydantic parity test for the new models (parity is convention-only today; we add a
real check for `IntentBundle`/wire-`PolicyVerdict`).

**Target Platform**: Linux server (agent Docker on Coolify), browsers (web on Coolify). Base Sepolia
(84532) is the live testnet; the launch vault is the only real build target.

**Project Type**: Web (Next.js frontend + FastAPI agent service) + Postgres.

**Performance Goals**: build-tx returns in a couple of RPC round-trips (evaluate is pure/instant; the
sim is one live `eth_call` + `eth_estimateGas`). No new hot-path load; the withdraw-quote
parallelization is a separate deferred item.

**Constraints**: fail-closed everywhere; N2 exit path never gated; `signature` always null on the
wire from the service; amounts are base-unit integer strings (never floats); new pydantic models must
be byte-parity with the existing zod `.strict()` wire schemas.

**Scale/Scope**: closed alpha; the deployer wallet + a handful of beta users. One end-to-end
round-trip on Base Sepolia is the acceptance bar (SC-007).

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1 design (below).*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Non-custodial (N1–N5)** | N1 recipient forced to user; N2 exit never gated; N3 service never signs / stores no keys; N5 provable/reconstructable | **PASS by construction.** N1: build-tx pins `Action.recipient` to the connected owner **and** `policy.evaluate` independently rejects `RECIPIENT_NOT_USER` (belt+braces). N2: exit actions (`Direction.EXIT`) skip caps/pause/mandate/freshness inside `evaluate()` (already tested against a hostile ctx) and build even with no sim; the direct-RPC `/exit` path is untouched. N3: `IntentBundle.userOp.signature` is always `null`; the only inbound signature is at `/submit-signed-tx` and is only byte-matched + forwarded, never stored (we persist the *event* — tx/userop hashes). N5: every persisted figure is base-unit exact + reconstructable from chain. |
| **II. AI proposes, deterministic policy disposes** | policy gate authoritative, LLM never final | **PASS.** The signable decision is `PolicyVerdict.is_signable` from the pure `evaluate()`; no LLM/memory/cache feeds it. build-tx returns a bundle **only** when the deterministic verdict approves. |
| **III. Provable, not promised** | real reads or honest empty/error state, never faked | **PASS.** Sim is a real live `eth_call` dry-run (or an honest `SIMULATION_UNAVAILABLE`); an undeployed vault fails closed via a real view read before any calldata is built; swaps/direct-Aave are refused honestly (FR-024), never mocked. |
| **IV. Bounded blast radius** | policy wraps every decision; whitelist; sim before sign; pause-only | **PASS.** Only allowlisted (target, selector) tuples materialize; the sim is presented in the drawer before signing (VR-S3); the kill-switch only affects deposits. No new contract surface. |
| **V. Conservative launch** | vault single-purpose; no new strategy | **PASS.** Scope is the existing launch Aave vault path only; no new strategy, no fee-path change. |
| **VI. Spec-driven** | spec → plan → tasks before code | **PASS.** This plan follows the ratified spec; tasks next. |
| **VII. Simplicity/YAGNI** | build the narrow milestone | **PASS (one justified narrowing).** We do **not** build the ERC-4337 `userOp` path (that is US6) — testnet uses `eoa_call`. The `userOp` fields exist in the wire shape (schema parity) but are emitted `null`. No session keys, no swap sim, no direct-Aave. |

**No violations.** Complexity Tracking table omitted (nothing to justify). The one deliberate scope
narrowing (eoa_call only) is a *reduction*, recorded in research.md R1.

## Project Structure

### Documentation (this feature)

```text
specs/019-us2-execution-spine/
├── plan.md              # this file
├── spec.md              # ratified spec
├── research.md          # Phase 0 — the 8 design decisions
├── data-model.md        # Phase 1 — 0021 tables + enums + VR mapping
├── quickstart.md        # Phase 1 — end-to-end validation guide (SC-007)
├── contracts/
│   └── execution-endpoints.md   # concrete request/response + pydantic model shapes
└── checklists/requirements.md   # spec quality checklist (done)
```

### Source Code (repository root)

```text
services/agent/src/sparkpoint_agent/
├── api/
│   ├── execution.py            # NEW router: POST /build-tx, /simulate, /submit-signed-tx, GET status
│   └── main.py                 # register execution_router + submit-unavailable handler
├── execution/                  # NEW package (the wiring layer; keeps api/ thin, policy/ pure)
│   ├── __init__.py
│   ├── models.py               # NEW pydantic wire models: IntentBundle, IntentStep, PackedUserOperation,
│   │                           #   WirePolicyVerdict, Reason, GuardrailCheck + request/response bodies
│   ├── decode.py               # NEW wire ProposedAction dict -> policy.Action (recipient pinned; asset addr->Asset)
│   ├── builder.py              # NEW build unsigned eoa_call steps (reuse vault.py _encode_deposit/_encode_redeem)
│   ├── assemble.py             # NEW ContextAssembler: fresh caps/kill-switch/staleness/resolved vault + fresh sim -> PolicyContext
│   ├── serialize.py            # NEW policy.PolicyVerdict(internal)+Action+SimulationResult -> IntentBundle/WirePolicyVerdict
│   └── orchestrate.py          # NEW async build/simulate/submit orchestration (ordered fail-closed; N2 exit branch)
├── db/
│   ├── intent_bundles.py       # NEW store (insert/get)
│   ├── simulations.py          # NEW store (insert/get, links to bundle)
│   ├── executions.py           # NEW store (insert submitted, update status, get by intent)
│   └── __init__.py             # export the 3 stores
├── chain/vault_reader.py       # REUSE: caps/paused/asset()/preview reads for the assembler (may add a helper)
└── migrations/0021_execution.sql  # NEW: intent_bundles + simulation_results + executions + enums

packages/shared/src/schemas/    # intent-bundle.ts, simulation.ts, policy-verdict.ts ALREADY EXIST; pydantic mirrors match them

apps/web/src/
├── components/execution/ExecutionDrawer.tsx  # NEW single-signing chokepoint (renders IntentBundle; signs steps[].data verbatim)
├── lib/execution/
│   ├── useBuildTx.ts           # NEW: POST /build-tx via AgentClient.request (no signature -> ok)
│   ├── useSubmitSigned.ts      # NEW: raw fetch to /api/agent/submit-signed-tx (client refuses signatures) + status poll
│   └── executionModel.ts       # NEW: pure helpers (byte-match assert, expiry check, deltas render)
└── (BFF /api/agent/[...path]/route.ts unchanged — already proxies the new paths)
```

**Structure Decision**: Keep `policy/` pure (no I/O) and `api/` thin; put all wiring in a new
`execution/` package (decode → build → assemble → evaluate → serialize → persist). This mirrors the
018 pattern (`api/vault.py` handlers delegate to encoders + a `DryRunner`) and the constitution's
purity boundary (all chain I/O happens in the assembler, then the pure `evaluate()` is called).

## Implementation Design (the concrete wiring)

### Agent — the ordered, fail-closed build pipeline (`execution/orchestrate.py`)

`POST /build-tx` runs, in order (contract §3.5, fail-closed):

1. **Shape validate** the `BuildTxRequest` (pydantic) → else `VALIDATION_ERROR`.
2. **Decode** (`decode.py`): wire `action` dict → `policy.Action`, with `recipient` **pinned** to
   `account.owner` (== `account.account` today), asset **address → symbolic `Asset` enum**, amount →
   int, selector/target resolved from `policy.constants` for the request chain. Reject an unknown
   asset/type/selector honestly.
3. **Prove-deployed & assemble** (`assemble.py`): read the live vault via `VaultReader` (raises
   `VaultUnavailable(NOT_DEPLOYED)` → fail-closed **before** any calldata), gather fresh cap headroom
   (cap − current read), `paused()`, staleness, and `resolved_targets={'sparkpoint_vault': addr}`.
   For an **exit** action, skip the cap/pause reads entirely (N2) — never even gather a paused/at-cap
   read on the exit path.
4. **Build** (`builder.py`): unsigned `eoa_call` step(s) — reuse `vault.py._encode_deposit`
   (deposit `0x6e553f65`) / `_encode_redeem` (redeem `0xba087652`) / a new `_encode_withdraw`
   (`0xb460af94`), recipient/owner forced to the connected user. `signature` stays `null`.
5. **Simulate** (reuse the 018 `ViemEthCallChecker` via a `DryRunner` seam): fresh `eth_call` dry-run
   → `SimulationResult`. Deposit: if live allowance < amount, defer the dry-run (approval-first, not a
   false revert). **Exit: advisory only — a sim outage or revert NEVER blocks the build (N2).**
6. **Evaluate** (`policy.evaluate(action, ctx)` with the fresh sim folded into `PolicyContext`): the
   pure deterministic gate.
7. **Gate + persist + serialize**: if `verdict.is_signable` → persist `simulation_results` +
   `intent_bundles` (VR-X2: approved ⇒ references a passing sim), serialize to `IntentBundle`
   (`serialize.py`), return `{ intentBundle }`. On any rejection → persist the rejected verdict
   (audit trail) and return the §1.5 error envelope with `reasons[]` and **no** bundle.

> **N2 exit invariant is enforced twice**: by skipping the cap/pause gather + the sim gate in the
> orchestrator, AND inside `evaluate()` which structurally skips caps/pause/mandate/freshness for
> `Direction.EXIT`. A withdraw builds under a fully hostile context (SC-003).

`POST /simulate` (`{ intentId } | { steps }`): re-run the dry-run for a stored bundle → `{ simulation
}`; refresh the stored `simulation_results`. Errors: `SIMULATION_REVERT` / `SIMULATION_UNAVAILABLE` /
`NOT_FOUND` / `DATA_STALE`.

`POST /submit-signed-tx` (`{ intentId, signed }`): load the stored `intent_bundles` row; assert the
signed payload's `to`/`data`/`value`/sender **byte-match** the issued step (else `VALIDATION_ERROR`);
reject a null signature; **do not re-sign or alter**; record an `executions` row (`submitted`, keyed
to the intent — unique on `intent_bundle_id` for durable de-dup); return `202 { submission: pending
}`. Never `KILL_SWITCH_PAUSED` for a withdraw payload. (Relay/broadcast is convenience — accepting a
frontend-submitted `txHash`/`userOpHash` for correlation is sufficient; a full bundler relay is not
required on testnet.)

`GET /submit-signed-tx/{intentId}`: read the receipt, map to `pending|confirmed|failed`, update the
`executions` row, return status + tx hash + block.

**Router wiring**: `api/execution.py` = `APIRouter(tags=["execution"])` (no prefix, full paths),
registered in `api/main.py` via `include_router`; reuse `VaultUnavailable` (or a sibling) for the
fail-closed RPC/bundler-outage envelope. Auth + X-Owner scoping + Idempotency-Key replay come **free**
from the global `RequestContextMiddleware`. The router uses the same `get_account` dependency +
`ApiError`/`error_envelope` idioms as `vault.py`.

### Agent — persistence (`db/*` + `0021_execution.sql`)

Follow the modern additive/idempotent migration idiom (banner + N1/N2 note + `CREATE TABLE ... IF NOT
EXISTS`, enums via a `DO $$ … duplicate_object …$$` guard, `PGCLIENTENCODING=UTF8`). Three tables per
data-model §11/§12; enums `policy_verdict`, `execution_status`, `action_kind`, `signing_mode`,
`attribution_method`. Two traps handled: (1) FK referents `recommendations`/`session_keys` don't
exist → `recommendation_id` and `user_id` are **plain nullable UUID** (no FK); (2) the `intent_bundles
⇄ simulation_results` circular FK → create both, then `ALTER TABLE ... ADD CONSTRAINT` for
`intent_bundles.simulation_result_id`. DB modules copy the `db/network_diagnostics.py` /
`db/subscriptions.py` idioms. See [data-model.md](./data-model.md).

### Agent — wire models + parity (`execution/models.py`)

Add the missing pydantic mirrors of the existing zod schemas: `IntentBundle`, `IntentStep`,
`PackedUserOperation` (signature typed `None`, always null), `WirePolicyVerdict`
(`approved`/`reasons:[{code,message}]`/`normalizedAction`/`simulation`), `Reason`, `GuardrailCheck`.
All `ConfigDict(extra="forbid")` + camelCase, `T | None` for `.nullable()`, `Literal[...]` for enums —
byte-identical to `packages/shared/src/schemas/*`. Add a **real** parity test (the current
policy-parity CI only covers 6 constants; enum/model parity is convention-only) asserting the new
pydantic field-sets == the zod `.strict()` field-sets for `IntentBundle` / `SimulationResult` /
`WirePolicyVerdict`.

### Web — the ExecutionDrawer single-signing chokepoint

- `useBuildTx()` — `AgentClient.request('/build-tx', {method:'POST', body:{action, execMode:'per_action'}, idempotencyKey})` (no signature → passes `assertNoSignature`). Surfaces the typed `AgentApiError`.
- `ExecutionDrawer` — renders the returned `IntentBundle`: `guardrailChecklist` rows, `simulation.balanceDeltas`, `rationale`, `citations`, fee/risk disclosure. Enables **Sign** only when `policyVerdict.approved` && not expired && `steps[0].chainId === connectedChainId`. **Signs the server calldata verbatim**: `wagmi.sendTransaction({ to: step.to, data: step.data, value })` (NOT `writeContract` re-encode) → byte-match holds (SC-005). Withdraw stays ungated (N2).
- `useSubmitSigned()` — after the wallet returns a tx hash, submit directly by default; optionally call the relay via a **raw** `fetch('/api/agent/submit-signed-tx', …)` (the typed client refuses signature bodies); poll `GET /api/agent/submit-signed-tx/{intentId}`. Idempotency-Key stable per intent.
- **BFF**: zero new files — the catch-all `/api/agent/[...path]/route.ts` already proxies the new paths with session-derived `x-owner`/`x-account` + S2S bearer + beta gate.
- **Mount**: a "Sign" affordance on an **approved** recommendation/chat `action` block opens the drawer. The existing manual vault ConfirmFlow is left unchanged (FR-025).

### What we deliberately DON'T build (scope guard)

ERC-4337 `userOp` build/sign (US6); session keys; Aerodrome swap sim (mainnet-only, fails closed);
direct-Aave build (deferred, fails closed); a Postgres/Redis idempotency backing store (durable
de-dup for submit is the `executions` unique key; build reuses the process-local replay scaffold); the
withdraw-quote parallelization (separate deferred item).

## Post-Design Constitution Re-Check

Re-evaluated after the design above: **still PASS, no new violations.** The design keeps `policy/`
pure (I/O only in `assemble.py`), enforces N2 in two independent layers, emits `signature=null` on
every wire path, stores no secrets, and refuses out-of-scope actions honestly. The one narrowing
(eoa_call only) reduces surface. Proceeding to `/speckit-tasks`.

## Phases (Spec Kit)

- **Phase 0 — research.md**: the 8 design decisions. *(this command)*
- **Phase 1 — data-model.md + contracts/ + quickstart.md**: the 0021 schema, concrete endpoint
  request/response shapes, end-to-end validation guide. *(this command)*
- **Phase 2 — tasks.md**: dependency-ordered tasks. *(`/speckit-tasks`, separate command)*
