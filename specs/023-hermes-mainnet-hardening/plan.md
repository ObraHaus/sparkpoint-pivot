# Implementation Plan: Hermes Mainnet Hardening

**Branch**: `feature/023-hermes-mainnet-hardening` · **Spec**: [spec.md](./spec.md) ·
**Research**: [research.md](./research.md) · **Date**: 2026-07-30

**Constitution**: **v3.0.0** (`.specify/memory/constitution.md`) — N1–N5, Gate C, Principles I–VII.
*(Re-checked 2026-07-30 after feature 024 ratified v2.0.0 → v3.0.0 mid-flight; see the re-check note
under Constitution Check. Principle VI requires this gate to pass against the CURRENT constitution.)*

**Baseline**: `develop@03b7ed4` — 793 pytest green, `ruff check src` clean, strict mypy clean
(122 source files). Any red introduced here is this feature's defect.

## Summary

Close the agent-side defects that stand between Hermes and a Base-mainnet deployment, in one PR scoped
to `services/agent/` + its CI + the living docs. Nine items in two tiers: **Tier 0** closes paths where
the service can act on wrong facts on mainnet (unasserted chain identity, testnet-shaped readiness, a
Sepolia-constant gas envelope, an unenforced bundle expiry on the submission-that-really-submits, and an
un-scoped idempotency cache); **Tier 1** closes the provability gaps a Gate-C auditor would have to
adjudicate (exec-mode agreement in the audit record, superseded scaffolding that still claims to be
load-bearing, docstrings that contradict shipped behavior, and a lint gate that skips a tree its own
config declares).

**The organizing insight.** The deterministic policy layer is correct; it decides on a `PolicyContext`
that an **I/O layer** assembles. On Base Sepolia every assembly path is pinned to one chain and one gas
regime, so its inputs are trivially right. On mainnet three of those paths can be right-shaped and
wrong-valued, and `evaluate()` has no way to notice. This feature does not touch the policy layer — it
makes the inputs honest and the failure modes loud.

**What this is not.** It does not open Gate C, deploy anything, or perform the T103 audit. It is the tree
that audit should run against.

## The load-bearing item — chain identity (research.md §1)

**Problem.** `_resolve_rpc_url` ([`config.py:135-140`](../../services/agent/src/sparkpoint_agent/config.py#L135-L140))
resolves chain `8453` as `SPARKPOINT_RPC_URL` → **`SIM_FORK_RPC_URL`** → **`BASE_SEPOLIA_RPC_URL``.
Nothing anywhere compares the RPC's reported `eth_chainId` to the configured `CHAIN_ID` (the only
`eth_chainId` read in the service is inside the simulator's own healthcheck). So a mainnet deployment
missing one env var reads the Anvil fork — or Sepolia — and presents it as mainnet.

**Why it is the highest-severity item.** Cap headroom, `paused()`, `totalAssets()` and the ERC-4626
previews all flow into `evaluate()`, while the built calldata still targets the **mainnet** vault from
env. The failure mode is therefore not a bad read — it is a bundle **approved against one chain's state
and signed on another**. The policy layer behaves perfectly and still produces the wrong answer, which is
precisely the class of bug that no amount of gate-hardening catches.

**Fix — two independent layers** (neither sufficient alone):

1. **Static**: per-chain env lists containing only urls that can legitimately serve that chain. No
   cross-chain fallback in either direction — this also removes `SIM_FORK_RPC_URL` from the `84532` list,
   which today can serve a Base-mainnet fork as Sepolia (same bug, opposite sign).
2. **Dynamic**: a TTL-cached `eth_chainId` assertion modelled on the existing `_llm_ready` probe, with
   **three** states — `verified` / `mismatch` / `unknown` (RPC unreachable). Both non-verified states fail
   the chain-dependent surface closed; only `mismatch` is a latched configuration error, while `unknown`
   re-probes.

**Why not fail at boot.** `api/main.py` makes an explicit, load-bearing choice that startup never blocks
on I/O — a slow dependency gets the container killed, and the data layer is never on the custody path. A
mainnet instance that won't boot on a transient RPC blip is worse than one that boots and honestly reports
not-ready.

**Blast radius, deliberately bounded.** The gate wraps the chain-dependent surface only (vault
quotes/simulations, portfolio, outcomes, build/simulate/submit, session-key builds) at the existing
`get_sim_config` / `get_vault_reader` dependency seam, and reuses `VaultUnavailable` + a new
`VaultUnavailableReason` member as the fail-closed envelope carrier. It does **not** gate `/healthz`,
chat's non-chain paths, the admin surfaces, or anything the frontend's direct-RPC exit relies on (N2).

**Stated limit.** This catches **misconfiguration**, not a hostile RPC. A provider that lies about
`eth_chainId` defeats it; the operator's choice of provider is trusted, as it already is for every read.
Saying so in the code is part of the deliverable — an overstated guarantee is its own defect.

## Constitution Check

*GATE: must pass before tasks are generated. Re-checked after design.*

| Principle / invariant | Assessment |
|---|---|
| **I. Non-Custodial by Construction (NON-NEGOTIABLE)** | **PASS — strengthened.** No new key material (the config env allowlist gains only RPC/bundler urls, and `_assert_no_key_material` runs at module load over that allowlist); no new signing path; `signature` stays typed `None`. FR-023-020 forbids any weakening and SC-023-009 makes it diff-verifiable. |
| **N1 — no admin withdrawal** | **PASS.** No recipient logic changes. The recipient pin in `decode_action` and the `RECIPIENT` step in both policy machines are untouched. |
| **N2 — withdraw-always** | **PASS — explicitly protected.** The chain gate must not reach the exit path (FR-023-004); the expiry check is confined to the UserOp branch so the wallet-path relay still records an already-broadcast exit (FR-023-012); the idempotency store fails **open** so a DB blip cannot block a build. A dedicated test extends `tests/api/test_custody_untouched.py`. |
| **N3 — user-owned keys** | **PASS.** The service still holds no session private key; the gas envelope change alters only values inside the op the **client** signs. |
| **N4 — scoped, revocable automation** | **PASS — strengthened.** `evaluate_session_grant` is untouched; the submit-path expiry + exec-mode checks make the off-chain half of the guarantee structural rather than cooperative. |
| **N5 — non-upgradeable custody + verifiable non-custody** | **PASS — strengthened.** Tier 1 exists precisely so non-custody stays *provable*: one reachable interposition, docstrings that match behavior, a lint gate that covers what it claims. |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** No LLM touches any code path in this feature. `policy/evaluate.py` and `policy/session.py` decision logic are not modified — the diff makes their *inputs* trustworthy. |
| **III. Provable, Not Promised** | **PASS — the point of Tier 1.** Every item removes a place where the code asserts something untrue (a chain it hasn't verified, a readiness it can't back, a PnL it says is null, an interposition that doesn't run). |
| **IV. Security & Bounded Blast Radius** | **PASS.** Closes an open R1 medium (un-scoped idempotency key). Fail-closed everywhere the wrong answer is unsafe; fail-open only where blocking would be the greater harm (serving, per N2), each choice stated. |
| **V. Conservative, Transparent Launch** | **PASS.** No cap, fee, or gating change. Launch caps are flagged for operator ratification (spec assumption 3), deliberately not touched in code. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** spec → clarify (2 decisions recorded) → plan → tasks before implementation, per playbook §9. |
| **VII. Simplicity & YAGNI** | **PASS with one recorded trade** — see Complexity Tracking: the durable idempotency store adds a migration where scoping alone would have closed the security hole. Taken on the operator's explicit clarify decision. |
| **Workflow: contract audit before mainnet / simulation before sign / beta-gating** | **N/A to this diff** — no contract change, no new signing surface, no gating change. This feature is a *prerequisite* to the T103 audit gate, not a substitute for it. |

**Verdict: PASS.** No violation requires an exception. One complexity trade is recorded below.

### v3.0.0 re-check (2026-07-30)

Feature 024 ratified the constitution **v2.0.0 → v3.0.0** (a MAJOR amendment) while this feature was
in flight, so the gate was re-run rather than assumed. v3.0.0's substantive changes are: Morpho Vault
V2 Fee Wrappers admitted as a permitted wrapper shape; `SparkPointMorphoVault` superseded for NEW
deployments; the Base-Sepolia demo wrapper retired; IV.5's ineligibility rule narrowed to exclude
*discretionary* roles; and **Robinhood Chain mainnet (4663) added to the in-scope network set**.

**Still PASS, and nothing in this feature is affected by the wrapper/fee changes** — 023 touches no
contract, no vault, no fee path, and no wrapper. Two interactions were checked explicitly:

1. **The 4663 chain-scope extension.** 4663 is ratified but is NOT yet in
   `policy.SUPPORTED_CHAIN_IDS` (still `8453 · 84532 · 31337 · 46630` on develop), so this feature
   correctly does not carry a `_CHAIN_RPC_ENVS` row for it. An unlisted chain resolves only from the
   explicit override, which is fail-closed and safe. A ⚠️ handoff comment now sits on
   `_CHAIN_RPC_ENVS` so whoever implements 4663 adds its row rather than silently inheriting the
   override-only path. **The per-chain design is what makes adding 4663 safe** — under the old
   cross-chain fallback, a new chain would have inherited a Base or fork url by default.
2. **The v3.0.0 fee-disclosure obligations** (a Fee Wrapper has no high-water mark, so the "above a
   high-water mark" phrasing must not be used for one) are a WEB/copy concern, tracked by 024 as
   T024. 023 changes no fee copy and no disclosure string.

The Principle I/II/III assessments above hold verbatim under v3.0.0: none of the amended text touches
the non-custody invariants, the AI-disposition rule, or the provable-not-promised standard, and this
feature strengthens the third.

## Technical Context

**Language/Version**: Python 3.12 (`services/agent`), strict mypy.

**Primary Dependencies**: FastAPI, httpx, pydantic v2, asyncpg, eth-abi. **No new runtime dependency** —
the gas estimator, the JSON-RPC reads and the store all use clients already in the tree.

**Storage**: Postgres + pgvector (`spark-postgres` on develop). **One new migration: `0026`** (additive,
idempotent, `IF NOT EXISTS`, applied with `PGCLIENTENCODING=UTF8`).

**Testing**: pytest + pytest-asyncio, injected fakes at the existing seams (no network, no live chain).
Baseline 793; this feature adds ~25–30.

**Target Platform**: Linux/Docker, single uvicorn worker (see FR-023-019).

**Project Type**: backend service (agent) — no web or contract change.

**Performance Goals**: keep the suite at ~7 s; add **at most one** cached RPC round-trip per TTL window to
the read path (the chain probe) and **two** per session-key build (estimate + fee read) — the latter only
on a path that already makes an RPC call for the nonce.

**Constraints**: no change to `policy/evaluate.py` or `policy/session.py` decision logic; no env var that
trips `_FORBIDDEN_ENV_SUBSTRINGS`; anonymous `/readyz` stays a bare boolean; RPC urls never logged.

**Scale/Scope**: 9 requirement groups, ~19 source files (13 edited, 3 new, 3 marker-only), 1 migration,
1 CI edit, 4 living docs, 7 test files (5 new, 2 extended + `test_app_lifespan.py`).

**Deploy ordering (load-bearing)**: migration `0026` MUST be applied **before** the agent is redeployed.
The idempotency store fails open, so the reverse order runs with no replay protection, no error, and no
failing check — the one HIGH finding from `/speckit-analyze`. `0026` is additive, so applying it first is
safe for the currently-live agent (FR-023-015a; tasks T018, T029).

## Project Structure

### Documentation (this feature)

```
specs/023-hermes-mainnet-hardening/
├── spec.md          # WHAT + WHY (21 FRs, 11 success criteria, 2 clarify decisions)
├── research.md      # 9 resolved unknowns, with rejected alternatives
├── plan.md          # this file — Constitution Check + structure
└── tasks.md         # ordered, per-item, testable
```

### Source Code (repository root)

```
services/agent/
├── migrations/
│   └── 0026_idempotency.sql                    # NEW — durable replay cache
├── src/sparkpoint_agent/
│   ├── config.py                               # per-chain RPC lists; no cross-chain fallback
│   ├── chain/
│   │   └── chain_identity.py                   # NEW — TTL-cached eth_chainId assertion (3 states)
│   ├── api/
│   │   ├── main.py                             # readyz: chain_rpc + chain_identity; worker warning
│   │   ├── idempotency.py                      # composite scope + durable store seam
│   │   ├── vault.py                            # chain-gate at get_sim_config/get_vault_reader
│   │   └── portfolio.py                        # docstring truth (no behavior change)
│   ├── db/
│   │   └── idempotency.py                      # NEW — PgIdempotencyStore (+ retention sweep)
│   ├── execution/
│   │   ├── session_userop.py                   # estimator-driven envelope + named bounds
│   │   ├── bundler.py                          # fee read alongside the existing estimator
│   │   └── orchestrate.py                      # submit: expiry + exec-mode agreement (userop only)
│   └── coordinator/
│       ├── coordinator.py                      # SUPERSEDED marker + prose correction
│       ├── flows.py                            # SUPERSEDED marker + prose correction
│       └── agentic_loop.py                     # SUPERSEDED marker + prose correction
└── tests/
    ├── chain/test_chain_identity.py            # NEW
    ├── api/test_idempotency_scope.py           # NEW
    ├── api/test_readyz_chain.py                # NEW
    ├── api/test_custody_untouched.py           # EXTENDED (N2 guards)
    ├── execution/test_session_gas.py           # NEW
    ├── api/test_submit_signed.py               # EXTENDED (expiry / mode agreement)
    └── coordinator/test_superseded_markers.py  # NEW

.github/workflows/agent.yml                     # ruff check . (src + tests)
CHANGELOG.md · MIGRATIONS.md · DEPLOYMENT.md · DEVELOPMENT.md
```

**Untouched by design**: `policy/` (both machines), `apps/web/`, `contracts/`, `packages/shared/`,
`services/litellm/`, every Coolify resource.

## Complexity Tracking

| Trade | Why it is taken | Simpler option rejected because |
|---|---|---|
| **A migration (`0026`) for durable idempotency**, where composite scoping alone would close the security hole | Operator's clarify decision (2026-07-30): close FR-023-015 in-feature. Replay protection then survives restarts and spans workers, and the R1 medium closes completely rather than half. | *Scope-only* leaves a documented gap that would need its own spec, PR, migration and prod apply later — i.e. the same cost, deferred, plus a window where a restart drops replay protection on mainnet. Cost of doing it now: a MIGRATIONS.md entry, a develop apply, and a prod apply step before first mainnet boot. |
| **Retaining superseded scaffolding** rather than deleting it | Operator's clarify decision. Keeps the only code-form record of the per-flow `AgentSpec`→DAG mapping and the read/execution design intent. | *Deletion* gives a cleaner grep but discards that record. The residual risk (an auditor believing dead code is live) is closed by an **enforcing test**, not by prose — prose alone would be exactly the failure mode the playbook warns about. |
| **Fail-open on an idempotency-store outage** | The data layer is never on the withdraw/exit path (N2); idempotency guards a double-emit on an *advisory build*. Matches how the quota gate already degrades. | *Fail-closed* would invent a new way for a DB blip to block a user's build — a custody-adjacent regression to protect a convenience property. |
| **Two RPC calls per session-key build** (estimate + fee) | The envelope is inside the `userOpHash`; the client signs it and cannot repair it. Only live values are right on both chains. | *Constants with raised ceilings* trade a guaranteed mainnet failure for an unbounded overpay, and break again on the next L1 gas spike. |

## Phase gate

`tasks.md` may be generated: Constitution Check **PASS**, both clarify questions **resolved**, no
`NEEDS CLARIFICATION` remaining in Technical Context.
