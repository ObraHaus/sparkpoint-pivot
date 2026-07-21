# Implementation Plan: Limits & Priority Compute

**Branch**: `feature/008-limits-priority-compute` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-limits-priority-compute/spec.md`

## Summary

Introduce a **per-wallet tier limits engine** (a default **free** tier + a **premium** tier) for the AI
assistant. Enforcement is a new **`require_within_quota` FastAPI dependency** on the LLM-bearing agent
endpoints (`/chat`, `/recommendations`, `/onboarding/turn`) that resolves the caller's tier, checks and
atomically increments a per-wallet usage counter, and **refuses over-limit requests before any SSE stream
begins** by raising the already-defined `ErrorCode.RATE_LIMITED` (429). "Priority compute" is added at the
one genuinely scarce resource — the process-global LLM limiter in `llm/resilience.py` — made **tier-weighted**
so premium turns acquire preferentially and free degrades first under contention. All state lives in a new
forward-only migration **`0015_limits.sql`** (`tier_definitions`, `wallet_tier`, `usage_counters`,
`limits_audit`), fronted by a new `db/limits.py` store that copies the proven `AllowlistStore` pattern.

Operators configure every tier inclusion live from a rebuilt **Admin → Config** surface (today a static
mock) via a new `api/admin_limits.py` router, and monitor consumption/throttle-rate from a rebuilt
**Admin → Usage** surface (today "not instrumented") via a new `api/admin_usage.py`. Premium is granted by
**admin** for launch (allowlist-style + optional env seed); the SRK payment path is out of scope. The
increment also **bundles the gateway hardening** the security review surfaced: an enforced spend/rpm/tpm
ceiling on the LiteLLM virtual key, network-isolated ingress, and forced TLS.

**Technical approach** (from research.md): extend the existing agent request path and admin patterns rather
than add new infrastructure. The dependency-based limiter reuses the `require_admin` shape; the tier store
reuses `AllowlistStore`; the admin surfaces reuse the `admin_llm`/`admin_uptime` router pattern and the
`admin/allowlist` + `admin/gateway` page patterns; counters are atomic Postgres upserts (single-replica
alpha → no Redis). Limits touch **only advisory compute** and never the vault / custody / withdraw path.

## Technical Context

**Language/Version**: Python 3.12 (`services/agent`, FastAPI/Starlette) — the authoritative enforcement +
data layer; TypeScript 5 (Next.js 15 App Router, React 19) for `apps/web` — the admin config/monitoring UI,
the BFF soft pre-check, and the user self-usage view. Solidity/Foundry unaffected (no contract change).

**Primary Dependencies**: FastAPI + Starlette middleware/dependencies, `asyncpg` (Postgres pool), `yoyo`
(migrations); the LiteLLM proxy (`services/litellm`, virtual-key budgets/rpm/tpm — an existing capability,
newly configured); the Next.js BFF (`apps/web/src/app/api/agent/[...path]/route.ts`); existing admin UI
primitives (`components/admin/charts.tsx`, `CapsMeter`). **No new runtime dependency** is expected.

**Storage**: Postgres (agent-owned) — 4 new tables via `services/agent/migrations/0015_limits.sql`. Usage
counters are atomic `INSERT … ON CONFLICT DO UPDATE`. In-process concurrency limiter (per replica) for the
alpha — **no Redis** (deferred hardening). The LiteLLM virtual-key ceiling lives in the gateway's own store.

**Testing**: `pytest` for the agent (store units, the `require_within_quota` dependency incl. pre-stream
admit/deny + turn-level metering + fail-closed + idempotency, the tier-weighted limiter, admin routers);
`node:test`/Vitest for web helpers; Playwright e2e under `apps/web/e2e/pw` (admin config round-trip + a
free-cap-hit chat flow + custody-untouched assertion). A live, non-destructive probe validates the gateway
hardening (US5).

**Target Platform**: Web (desktop + mobile admin) + the Python agent service + the LiteLLM gateway
container, on the Coolify dev/staging alpha.

**Project Type**: Web application — Next.js frontend + Python agent service + LiteLLM gateway sidecar.

**Performance Goals**: the limit check adds one indexed counter upsert + one small tier read before the
stream — negligible latency; free-tier time-to-first-token shows no material regression when under its cap
(SC-009); priority scheduling must not starve free beyond the configured degradation.

**Constraints**: admit/deny **pre-stream** (SSE cannot emit a 429 mid-flight); meter the **whole turn**
(one turn fans out to several model calls); **fail-closed to free**; **never** gate the vault / withdraw /
exit / redeem path (N2); server-resolved identity only (owner EOA from the verified session); audit every
tier/limit mutation; **single-replica** alpha (in-process counting acceptable, documented).

**Scale/Scope**: 2 tiers; 3 networks (8453 / 84532 / 46630); 3 LLM-bearing endpoints metered; ~1 agent
replica; two admin surfaces (config + usage) + one user self-usage view; one gateway credential bounded.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS.** Limits meter/refuse **advisory compute only** (chat, recommendations, onboarding). FR-013/FR-014 + SC-003 forbid any limit, throttle, priority rule, or system ceiling from touching a withdrawal, exit, vault redeem, or funds-movement path — those stay available even when the assistant is fully throttled (N2). The vault kill-switch is deliberately **not** reused as a chat throttle. No custody semantics, session keys, or caps change (N1, N3, N4, N5). |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** The limiter only decides whether a *turn may start*; it never touches the deterministic policy layer, the guardrail checklist, or the user-signing/session-key path. A throttle cannot cause or suppress an on-chain action, and model output still passes policy + user-sign exactly as today. |
| **III. Provable, Not Promised** | **PASS.** Usage monitoring shows **real** records and honest-degrades when the source is unavailable (FR-022) — never fabricated numbers; wallets are masked and no prompt content is stored (FR-021). No return projections are introduced. |
| **IV. Security & Bounded Blast Radius** | **PASS — this feature *reduces* blast radius.** US5 / FR-023–FR-025 add a system-level inference ceiling (spend + rpm/tpm on the gateway credential), network-isolated ingress, and forced TLS, bounding a leaked-key or runaway loop. On-chain caps, the pause-only kill-switch, pre-trade simulation, and the Aave/Aerodrome whitelist are untouched. |
| **V. Conservative, Transparent Launch** | **PASS.** SRK stays **non-essential**: premium is granted by an operator for launch and the SRK payment path is NOT a prerequisite (FR-005); no core capability and nothing on the vault/custody/withdraw path is gated by SRK or premium (FR-028). The vault, its fee model, and the free tier's full capability are untouched. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** This plan follows spec → plan → tasks; no code lands before tasks exist; plan/spec/tasks trace to each other and to the constitution. |
| **VII. Simplicity & YAGNI** | **PASS with a recorded scope note (below).** Reuses existing patterns (allowlist store, content-entry seed-then-edit, admin routers, `charts.tsx`, `CapsMeter`); in-process counters (no Redis) for the single-replica alpha; premium entitlement is admin-grant only (no SRK/token infra built). |

**Recorded scope note (Principle VII / V — building "premium" ahead of the SRK cycle).** The constitution
defers "SRK v2 utility and governance." This feature builds the **limits/priority engine and an admin-granted
premium designation** — which is a **launch must-have** ("beta gating: whitelist, **per-user caps**, geo-fenced
frontend") and the approved freemium revenue stream — **without** building any SRK token utility, staking, or
payment. No SRK dependency is introduced; `users.srk_balance_cached` is not read (it is a display-only mirror,
VR-U4). The SRK-paid subscription remains a separate later increment that merely *flips this engine on*. This
is client/operator-directed (2026-07-21) and does not touch N1–N5, the policy engine, the kill-switch, or the
non-upgradeable vault, so no re-ratification is required. The **gateway-hardening** items (ingress isolation,
TLS, credential ceiling) are operator/infra actions on Coolify/Traefik + `services/litellm/config.yaml`,
tracked in `COOLIFY.md`.

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations.

## Project Structure

### Documentation (this feature)

```text
specs/008-limits-priority-compute/
├── plan.md                    # This file
├── spec.md                    # WHAT/WHY (approved)
├── research.md                # Phase 0 — decisions & rationale
├── data-model.md              # Phase 1 — entities, tables, wire shapes
├── quickstart.md              # Phase 1 — how to run/verify locally + per-story checks
├── contracts/
│   └── limits-interfaces.md   # Phase 1 — internal interface contracts (dependency, admin API, tier wire)
├── checklists/
│   └── requirements.md        # Spec-quality checklist (from specify)
└── tasks.md                   # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
services/agent/migrations/
└── 0015_limits.sql            # NEW — tier_definitions, wallet_tier, usage_counters, limits_audit (+ seed free/premium)

services/agent/src/sparkpoint_agent/
├── db/limits.py               # NEW — LimitsStore (asyncpg): tier defs read/upsert, tier assign/revoke,
│                              #        atomic usage increment, all with in-tx limits_audit (copies AllowlistStore)
├── db/__init__.py             # export LimitsStore
├── api/quota.py               # NEW — require_within_quota dependency + resolve_tier(owner) + LimitDecision
├── api/admin_limits.py        # NEW — admin CRUD: GET/POST tiers, POST tiers/assign, POST tiers/revoke (require_admin, 404-posture, audited)
├── api/admin_usage.py         # NEW — admin monitoring: /admin/usage/summary, /top, /events (require_admin, honest-degrade)
├── api/chat.py                # add Depends(require_within_quota) on POST /chat (pre-stream, before chain read)
├── api/recommendations.py     # add Depends(require_within_quota) on POST /recommendations
├── api/mandate.py             # add Depends(require_within_quota) on POST /onboarding/turn
├── api/security.py            # AccountContext gains resolved tier (or resolved in the dependency) — key on owner EOA
├── api/main.py                # include_router(admin_limits, admin_usage); optional _seed_tier_limits(db) boot hook
├── llm/resilience.py          # Limiter → tier-weighted acquire (premium preferential; free shorter budget/degrades first)
├── llm/client.py              # thread per-request tier/priority into call_with_resilience (limiter is already injectable)
└── coordinator/dag.py         # pass the resolved tier down the turn (user=owner already set) for priority + model-alias select

apps/web/src/
├── app/api/agent/[...path]/route.ts   # BFF: resolve tier LIVE, forward as X-Tier; soft pre-check + friendly 429 passthrough
├── app/admin/config/page.tsx          # REPLACE the static mock with a fetch-driven tier-limits editor (copies admin/allowlist)
├── app/admin/usage/page.tsx           # REBUILD live from /api/agent/admin/usage/* (copies admin/gateway fetch pattern)
├── components/admin/role-context.tsx  # (if a new nav key is added) NavKey/NAVMETA/NAV_HREF/ROLES; else reuse 'cfg'/'usage'
├── lib/auth/agent-status.ts           # extend the s2s status read to also return tier (live resolution)
└── app/(app)/premium/…                # CapsMeter "usage this period" self-view (US6) + non-nagging upsell on cap-hit

services/litellm/
└── config.yaml                # virtual-key max_budget + rpm_limit/tpm_limit ceiling (US5)

Living docs: CHANGELOG.md · MIGRATIONS.md (0015 apply record) · DEVELOPMENT.md (tier config + PREMIUM_ALLOWLIST env) ·
COOLIFY.md (gateway ingress isolation + TLS) · services/agent/content_seed/whats-new.json (client-facing entries)
```

**Structure Decision**: Web-application layout (Next.js frontend + Python agent + LiteLLM sidecar). The
feature's authoritative logic is concentrated in `services/agent` (the new migration, store, quota
dependency, admin routers, and limiter change); `apps/web` gets the admin UI + BFF pre-check + user
self-usage view; `services/litellm` gets a config-only credential ceiling. No new top-level project.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| In-process counters + limiter (no shared Redis/Postgres coordinator) | Single-replica alpha (locked decision); atomic Postgres upserts already give correct per-wallet counts on one replica | A shared Redis/limiter is real hardening but adds infra + a new dependency for a single-replica alpha (Principle VII); it is the documented first hardening item, added when horizontal scale is real |
| Dual-layer enforcement (agent authoritative + BFF soft pre-check) | Locked decision: the agent must be the hard truth (closest to LLM spend, not bypassable); the BFF pre-check gives instant UX + sheds obvious overage early | Agent-only would make a free user wait for a full round-trip to learn they are capped; BFF-only is bypassable by anything reaching the agent directly and misses the scarce resource |
| Gateway credential ceiling + ingress isolation + TLS (infra, spans `services/litellm` + Coolify/Traefik) | US5 / FR-023–025 — per-user app limits cannot bound a leaked key; only a gateway-level ceiling + network isolation can | Leaving the single shared key as the only barrier keeps the abuse gap the security review flagged; app-tier limits alone do not close it |

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary.

- **Phase 0 — Data + store groundwork (no behavior change).** `0015_limits.sql` (4 tables, seed free +
  premium), `db/limits.py` `LimitsStore`, optional `_seed_tier_limits` boot hook. Applied with
  `PGCLIENTENCODING=UTF8` before the agent boots; `MIGRATIONS.md` updated. Nothing enforces yet.
- **Phase A → US1 (🎯 MVP).** `require_within_quota` dependency + `resolve_tier` (fail-closed to free) on
  `/chat` (+ `/recommendations`, `/onboarding/turn`); pre-stream admit/deny raising `RATE_LIMITED`;
  turn-level + idempotency-aware counting; the clear non-blocking limit message. Custody path explicitly
  untouched. Free-only is a viable MVP (fair, enforced, funds-safe).
- **Phase B → US2.** `api/admin_limits.py` (config CRUD + assign/revoke, audited, 404-posture, POST-only) +
  the rebuilt `admin/config` editor; live config read on the enforcement path (no redeploy); zero-cap
  refusal.
- **Phase C → US3.** `api/admin_usage.py` + the rebuilt `admin/usage` (per-tier consumption, top consumers,
  throttle/deny rate) from `usage_counters` + a throttle/deny event feed; masked wallets, no prompt content,
  honest-degrade.
- **Phase D → US4.** `wallet_tier` assignment surfaced in admin; tier-weighted priority in `resilience.py`
  threaded owner→dag→client; premium higher caps + preferential acquisition; grant/revoke live + audited.
- **Phase E → US5 (🛡️).** Gateway credential ceiling in `config.yaml`; ingress isolation + forced TLS on
  Coolify/Traefik (operator action, `COOLIFY.md`); re-probe to confirm; wire abuse spikes into the US3
  monitoring.
- **Phase F → US6.** `CapsMeter` self-usage view on the premium/manage surface; single dismissible,
  non-re-nagging upsell on a premium-only cap-hit.
