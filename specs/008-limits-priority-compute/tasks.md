---
description: "Task list for 008-limits-priority-compute"
---

# Tasks: Limits & Priority Compute

**Input**: Design documents in `specs/008-limits-priority-compute/` (spec.md, plan.md, research.md, data-model.md, contracts/limits-interfaces.md, quickstart.md)

**Tests**: Included — this feature guards a funds-safety invariant (a throttle must NEVER touch the withdraw/vault path) and fails closed to free, so the pre-stream admit/deny, turn-level + idempotency-aware counting, custody-untouched, fail-closed-to-free, and monitoring-hygiene behaviors are tested. Requested via the spec's Independent Tests + Success Criteria.

**Organization**: Grouped by user story (US1–US6 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 / US5 / US6 (or SETUP / POLISH)
- Include exact file paths in descriptions

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for any behavior/schema/infra change (the `0015` tables, the quota dependency, the admin surfaces, the tier-weighted limiter, the gateway ceiling all qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase (A: fair free limits, B: operator-tunable, C/—: n/a internal, D: premium higher limits & priority, F: see your usage), stable `slug`.
- [ ] `MIGRATIONS.md` records `0015` applied per environment; the migration applies with `PGCLIENTENCODING=UTF8` **before** the agent boots. **No new agent seed dir** is introduced (0015 seeds via SQL inserts), so no `services/agent/Dockerfile` `COPY` is needed — confirm none was added.
- [ ] `DEVELOPMENT.md` documents the `PREMIUM_ALLOWLIST` env + the tier-config model; `COOLIFY.md` documents the gateway ingress isolation + TLS + credential ceiling.
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint && build` green; agent `pytest` green; **non-custody invariants confirmed in review** (Constitution I/II — no limit ever on the withdraw/vault path; fail-closed to free).
- [ ] No new env var left undocumented.

---

## Phase 0: Groundwork — schema + store (no enforcement yet)

**Purpose**: land the data model + store so every later phase reads/writes one place. Ships alone; enforces nothing.

- [ ] T001 [SETUP] `services/agent/migrations/0015_limits.sql` — create `tier_definitions`, `wallet_tier`, `usage_counters`, `limits_event`, `limits_audit` per data-model.md (CHECK constraints, indexes, partial-unique `is_default`); seed `free` (default) + `premium` rows. Apply with `PGCLIENTENCODING=UTF8`; update `MIGRATIONS.md`.
- [ ] T002 [P] [SETUP] `tests/db/test_limits_store.py` — write first (fails until T003): tier read/upsert, assign/revoke, atomic increment (`ON CONFLICT`), in-tx audit row, seed idempotency, zero-cap-on-default rejected.
- [ ] T003 [SETUP] `services/agent/src/sparkpoint_agent/db/limits.py` — `LimitsStore` (asyncpg dataclass, copies `AllowlistStore`): `get_tiers`, `upsert_tier`, `assign`, `revoke`, `increment(address,metric,window_start)`, `record_event`, all with in-tx `limits_audit`; `seed_from_env`. Export from `db/__init__.py` (depends on T001/T002).
- [ ] T004 [P] [SETUP] `services/agent/src/sparkpoint_agent/api/main.py` — best-effort `_seed_tier_limits(db)` boot hook (mirrors `_seed_allowlists`) seeding premium from `PREMIUM_ALLOWLIST`.
- [ ] T005 [P] [SETUP] `CHANGELOG.md` `## [Unreleased]` bullet: "feat(agent): tier/limits schema (0015) + store".

**Checkpoint**: `0015` applied; `LimitsStore` green; nothing enforces yet.

---

## Phase A → User Story 1 — Free fair-use, funds untouched (Priority: P1) 🎯 MVP

**Goal**: per-wallet assistant limits enforced pre-stream on the 3 LLM endpoints, fail-closed to free, custody path never touched.

**Independent Test**: quickstart US1.

### Tests for US1 (write first, ensure they fail)

- [ ] T006 [P] [US1] `tests/api/test_quota.py` — admits under cap, increments by 1 per **turn** (not per model call); denies at cap+1 with `429 RATE_LIMITED` **before** any stream byte; resolution error ⇒ default (free) tier; same `Idempotency-Key` retry does not double-increment; concurrent same-wallet cannot both take the last slot.
- [ ] T007 [P] [US1] `tests/api/test_custody_untouched.py` — vault-quote / deposit / withdraw / exit routes are NOT wrapped by `require_within_quota` and succeed while the wallet is fully over its assistant cap (SC-003).

### Implementation for US1

- [ ] T008 [US1] `services/agent/src/sparkpoint_agent/api/quota.py` — `require_within_quota(metric)` factory + `resolve_tier(owner)` (fail-closed to default) + `window_start()` (rolling-24h, Asia/Manila) + `LimitDecision`; raises `ApiError(ErrorCode.RATE_LIMITED)` pre-check (contracts §1) (depends on T003).
- [ ] T009 [US1] `services/agent/src/sparkpoint_agent/api/chat.py` — add `Depends(require_within_quota('chat'))` on `POST /chat` **before** the pre-stream chain read; friendly limit copy (FR-012) (depends on T008).
- [ ] T010 [P] [US1] `services/agent/src/sparkpoint_agent/api/recommendations.py` — add `Depends(require_within_quota('recs'))` on `POST /recommendations` (depends on T008).
- [ ] T011 [P] [US1] `services/agent/src/sparkpoint_agent/api/mandate.py` — add `Depends(require_within_quota('onboarding'))` on `POST /onboarding/turn` (depends on T008).
- [ ] T012 [US1] Idempotency-aware increment: tie the counter bump to the middleware's `Idempotency-Key` record so a replayed POST does not double-charge (D13). `api/quota.py` + `api/middleware.py` (read-only touch).
- [ ] T013 [P] [US1] Client limit UX: render the `429 RATE_LIMITED` as the clear non-blocking "daily free limit reached" block in `apps/web/src/components/screens/chat/*` (no partial/garbled answer).
- [ ] T014 [P] [US1] Living docs: `CHANGELOG.md` + `whats-new.json` client entry ("A fair daily amount of free AI chat").

**Checkpoint**: free wallets are fairly capped pre-stream; funds paths provably untouched; fail-closed to free.

---

## Phase B → User Story 2 — Live admin configuration (Priority: P1)

**Goal**: operators edit every tier inclusion from the admin panel, effective next request, audited; zero-cap refused.

**Independent Test**: quickstart US2.

### Tests for US2 (write first)

- [ ] T015 [P] [US2] `tests/api/test_admin_limits.py` — non-admin ⇒ `404` (not 403) on every route; a valid `tier_update` is used by the **next** enforcement decision (no redeploy); default-tier `chat_daily_limit=0` ⇒ rejected with reason; each mutation writes exactly one `limits_audit` row.

### Implementation for US2

- [ ] T016 [US2] `services/agent/src/sparkpoint_agent/api/admin_limits.py` — `GET/POST /admin/limits/tiers`, `POST /admin/limits/tiers/assign`, `POST /admin/limits/tiers/revoke`; `Depends(require_admin)` (404-posture), POST-only, in-tx audit, zero-cap-on-default guard (contracts §3). Register in `api/main.py` (depends on T003).
- [ ] T017 [US2] `apps/web/src/app/admin/config/page.tsx` — replace the static mock with a fetch-driven tier editor (copies `admin/allowlist/page.tsx`: refresh/busy/msg, chartcard/statusrow/pill) hitting `/api/agent/admin/limits/*` (depends on T016).
- [ ] T018 [P] [US2] `apps/web/src/components/admin/role-context.tsx` — ensure the `cfg`/limits nav entry routes correctly (reuse `cfg` → `/admin/config`, or add a dedicated key).
- [ ] T019 [P] [US2] Living docs: `CHANGELOG.md` + `DEVELOPMENT.md` (tier-config model + `PREMIUM_ALLOWLIST`).

**Checkpoint**: an operator tunes any cap live, audited; the dead "Preview" config surface is gone.

---

## Phase C → User Story 3 — Admin monitoring (Priority: P1)

**Goal**: real per-tier consumption, top consumers (masked), throttle/deny rate — honest-degrade, no prompt content.

**Independent Test**: quickstart US3.

### Tests for US3 (write first)

- [ ] T020 [P] [US3] `tests/api/test_admin_usage.py` — reflects real `usage_counters`/`limits_event` (no sample data); wallets masked `6…4`, no prompt content; per-tier throttle/deny rate computed; unavailable source ⇒ `configured:false`; non-admin ⇒ `404`.

### Implementation for US3

- [ ] T021 [US3] `api/quota.py` + `db/limits.py` — write a `limits_event` row (`allow`/`deny`/`throttle`, masked subject) on each decision + on `LlmBusyError` saturation (feeds the throttle-rate).
- [ ] T022 [US3] `services/agent/src/sparkpoint_agent/api/admin_usage.py` — `GET /admin/usage/{summary,top,events}` (copies `admin_uptime.py`: `require_admin`, `configured:false` degrade, `_mask_user`, secret-scrub) (contracts §4). Register in `api/main.py` (depends on T003/T021).
- [ ] T023 [US3] `apps/web/src/app/admin/usage/page.tsx` — rebuild from the static placeholder to a live fetch of `/api/agent/admin/usage/*` (copies `admin/gateway/page.tsx` state machine); render `StackedBars` (per-tier), `Kpi`+`Sparkline`, `adtbl` top consumers, `funnels` throttle-rate (depends on T022).
- [ ] T024 [P] [US3] Living docs: `CHANGELOG.md` bullet.

**Checkpoint**: `Admin → Usage` shows real limits/compute usage; masked; honest-degrade.

---

## Phase D → User Story 4 — Premium higher limits + priority (Priority: P2)

**Goal**: admin-granted premium gets higher caps AND preferential compute; grant/revoke live + audited.

**Independent Test**: quickstart US4.

### Tests for US4 (write first)

- [ ] T025 [P] [US4] `tests/llm/test_priority_limiter.py` — under saturation a premium (higher-priority) acquire is granted before a free one; free hits `LlmBusyError` first; no-tier-config behaves as today; the limiter never sits on the withdraw path.
- [ ] T026 [P] [US4] `tests/api/test_tier_grant.py` — grant ⇒ premium caps on next request (no re-login); revoke ⇒ free next request; both audited.

### Implementation for US4

- [ ] T027 [US4] `services/agent/src/sparkpoint_agent/llm/resilience.py` — make the `Limiter` tier-weighted (`acquire(priority=...)`: premium preferential, free shorter budget/degrades first) (contracts §2).
- [ ] T028 [US4] Thread the resolved tier/priority `owner → coordinator/dag.py:run_chat → llm/client.py → call_with_resilience` (the limiter field is already injectable) (depends on T027).
- [ ] T029 [P] [US4] `api/admin_limits.py` assign/revoke surfaced in `apps/web/src/app/admin/config/page.tsx` (grant/revoke premium per wallet, with audit view) (depends on T016/T017).
- [ ] T030 [P] [US4] Optional per-tier `model_alias` selection at `dag.py`/`client.py` (premium → a higher/less-limited alias if configured); default unchanged.
- [ ] T031 [P] [US4] Living docs: `CHANGELOG.md` + `whats-new.json` ("Premium: higher limits & priority compute").

**Checkpoint**: premium wallets get more + go first under load; grant/revoke instant + audited.

---

## Phase E → User Story 5 — Gateway abuse ceiling (Priority: P2) 🛡️

**Goal**: bound the shared inference independent of app tiers — credential ceiling, network isolation, TLS.

**Independent Test**: quickstart US5.

- [ ] T032 [US5] `services/litellm/config.yaml` — set `max_budget` + `rpm_limit`/`tpm_limit` on the `sparkpoint-chat` virtual key so exceeding it refuses further calls (contracts §7).
- [ ] T033 [US5] **Operator/infra** (Coolify/Traefik): restrict gateway ingress to the agent (private network / source-IP allowlist / mTLS) + force HTTP→HTTPS; ensure `LITELLM_BASE_URL` is `https`. Document in `COOLIFY.md`. ⚠️ Confirm before any Coolify-mutating action.
- [ ] T034 [P] [US5] Re-run the non-destructive gateway probe (quickstart US5) and paste evidence: UI/schema 404, unauth 401, http→https redirect, ceiling visible via `GET /admin/llm/status`; wire an abnormal-spike signal into the US3 throttle view.
- [ ] T035 [P] [US5] Living docs: `CHANGELOG.md` + `COOLIFY.md` (ingress/TLS/ceiling).

**Checkpoint**: a leaked/abused credential is bounded; "SparkPoint-only" is network-enforced; key never in cleartext.

---

## Phase F → User Story 6 — User self-usage + honest upsell (Priority: P3)

**Goal**: a user sees their own usage; a single dismissible, non-re-nagging upsell on a premium-only cap-hit.

**Independent Test**: quickstart US6.

- [ ] T036 [US6] Agent `GET /usage/self` (owner-scoped) → `{ tier, metrics:[{metric,used,limit,remaining,resetAt}] }`; extend `GET /allowlist/status` to also return `tier` (contracts §5).
- [ ] T037 [US6] BFF `apps/web/src/app/api/agent/[...path]/route.ts` — resolve tier LIVE, forward `X-Tier`, add the soft pre-check; expose `/usage/self` to the client (depends on T036).
- [ ] T038 [US6] `apps/web/src/app/(app)/premium/*` — `CapsMeter` "usage this period" from `/usage/self`; single dismissible, non-re-nagging upsell on a premium-only cap-hit (dismiss persists; no modal-on-open/countdown) (FR-027).
- [ ] T039 [P] [US6] Living docs: `whats-new.json` ("See your usage this period").

**Checkpoint**: users see real usage; upsell is honest and never nags.

---

## Phase POLISH: Cross-cutting

- [ ] T040 [P] [POLISH] Playwright e2e `apps/web/e2e/pw/limits.spec.ts` — admin sets a low free cap → free chat hits the friendly limit block; `custody-untouched.spec.ts` — over-cap wallet still deposits/withdraws (`domcontentloaded` + long hydration budget on the CPU-starved box).
- [ ] T041 [POLISH] Re-verify on the develop/alpha environment across 84532 + 46630; paste evidence into the PR body.
- [ ] T042 [P] [POLISH] Confirm the free-tier TTFT does not materially regress with limits/priority on (SC-009); tune seeded caps if needed.
- [ ] T043 [POLISH] Security + non-custody self-review vs Constitution I/II/III/IV (no limit on the withdraw path; fail-closed to free; masked/no-content monitoring; gateway bounded) before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first (schema + store) — everything reads it.
- **US1 (P1, MVP)** → **US2 (P1)** → **US3 (P1)** → **US4 (P2)** → **US5 (P2)** → **US6 (P3)**. Each ships to `develop` independently once green.
- Within a story: tests before implementation. `require_within_quota` (T008) gates T009–T013. `admin_limits` (T016) gates the config page (T017) + grant/revoke UI (T029). `limits_event` writes (T021) gate the usage API (T022) → page (T023). The limiter change (T027) gates the threading (T028).
- US5 T033 is an operator/infra action (confirm before any Coolify mutation). US6 T036 (agent) lands before T037 (BFF) forwards.

## Parallel Opportunities

- Tests are `[P]` (different files): T002 · T006/T007 · T015 · T020 · T025/T026.
- Independent modules/docs `[P]`: T004/T005, T010/T011 (different endpoint files), T013/T014, T018/T019, T024, T030/T031, T034/T035, T039.
- Shared-file tasks serialize: `api/quota.py` (T008/T012/T021), `admin/config/page.tsx` (T017/T029), `resilience.py`→`dag.py`/`client.py` (T027/T028).

## Notes

- Commit after each task or logical group; branch **`feature/008-limits-priority-compute`** off `develop`.
- **Confirm before any `git push` / PR / merge** (repo CLAUDE.md) and before any Coolify/prod action (T033).
- Apply `0015` with `PGCLIENTENCODING=UTF8` **before** the agent boots; never-Friday prod deploys; batched prod date.
- **Non-custody (N2) + fail-closed-to-free are review gates, not afterthoughts** (Constitution I/II). A limit that can touch the withdraw path is a blocking defect.
