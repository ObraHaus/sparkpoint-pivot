# Internal Interface Contracts: Limits & Priority Compute (Phase 1)

This feature adds agent HTTP endpoints (admin + self-usage), one enforcement dependency, one limiter change, a BFF header, and a gateway-config ceiling. Each contract below carries a test obligation. Admin endpoints are `require_admin`-gated with the invisible **404-not-403** posture and are **POST-only** for mutations (the BFF forwards GET/POST only).

## 1. Enforcement dependency — `services/agent/src/sparkpoint_agent/api/quota.py`

```python
async def require_within_quota(request: Request, metric: Metric) -> LimitDecision
# Metric = Literal['chat','recs','onboarding']; wired per-route via functools.partial / a factory.
# Reads request.state.account.owner. resolve_tier(owner) -> tier (fail-closed to default).
# Reads the tier's cap + the current usage_counters row; if over cap -> raise ApiError(RATE_LIMITED)
# BEFORE the route body. Else atomically increments (idempotency-aware) and returns LimitDecision.
async def resolve_tier(owner: str) -> str            # wallet_tier lookup, default if absent/error
def window_start(now: datetime) -> datetime          # rolling-24h bucket, Asia/Manila (tunable)
```

Wired as `Depends(...)` on `POST /chat` (before the pre-stream chain read), `POST /recommendations`, `POST /onboarding/turn`.

**Contract test obligations**: admits under cap and increments by exactly 1 per **turn** (not per model call); denies at cap+1 with a `429 RATE_LIMITED` **before** any stream byte; a resolution error resolves to the default tier (never premium); a retry with the same `Idempotency-Key` does not double-increment; a request on the withdraw/vault path is **never** routed through this dependency (custody path untouched); concurrent same-wallet requests cannot both pass the last slot (atomic upsert).

## 2. Tier-weighted limiter — `services/agent/src/sparkpoint_agent/llm/resilience.py` (+ `client.py`, `coordinator/dag.py`)

```python
# Limiter gains tier awareness; premium acquires preferentially, free degrades to LlmBusyError first.
async def acquire(self, *, priority: int) -> slot            # higher priority wins under contention
# tier/priority threaded: dag.run_chat(tier) -> AsyncClaudeClient(limiter, priority) -> call_with_resilience
```

**Contract test obligations**: under saturation a higher-priority (premium) acquire is granted before a lower-priority (free) one; free requests hit the busy path (`LlmBusyError → UPSTREAM_UNAVAILABLE`) first; a single global-limiter (no tier config) still behaves as today; priority never blocks the withdraw path (limiter is LLM-only).

## 3. Admin config API — `services/agent/src/sparkpoint_agent/api/admin_limits.py`

```text
GET  /admin/limits/tiers                 -> { tiers: [TierDefinition] }
POST /admin/limits/tiers                 { tier, <inclusion fields...> }        -> updated TierDefinition   (audited: tier_update)
POST /admin/limits/tiers/assign          { address, tier }                      -> { ok }                   (audited: grant)
POST /admin/limits/tiers/revoke          { address }                            -> { ok }                   (audited: revoke)
```

All `Depends(require_admin)` (404 to non-admins). Every mutation writes a `limits_audit` row in the same transaction.

**Contract test obligations**: a non-admin gets `404` (not 403) on every route; a `tier_update` that sets the default tier's `chat_daily_limit` to `0` is **rejected** with a clear reason (FR-008); a valid update is reflected on the **next** enforcement decision with no redeploy; grant/revoke take effect on the wallet's next request; every mutation produces exactly one audit row (actor, old/new, time); the BFF path `/api/agent/admin/limits/*` reaches these (GET/POST only).

## 4. Admin monitoring API — `services/agent/src/sparkpoint_agent/api/admin_usage.py`

```text
GET /admin/usage/summary   -> { configured: bool, byTier: [{ tier, activeWallets, turns, avgPerWallet }], throttleRate }
GET /admin/usage/top       -> { configured: bool, consumers: [{ subject(masked), tier, turns }] }
GET /admin/usage/events    -> { configured: bool, events: [{ verdict, metric, tier, subject(masked), at }] }
```

All `Depends(require_admin)`; `configured:false` honest-degrade when the data source is unavailable (copies `admin_uptime.py`).

**Contract test obligations**: reflects real `usage_counters` / `limits_event` data (no sample placeholder); wallets are **masked** (`6…4`) and no prompt content appears; throttle/deny rate is computed per tier; an unavailable source returns `configured:false` (never fabricated numbers); non-admin → `404`.

## 5. User self-usage + BFF tier forwarding — `apps/web/src/app/api/agent/[...path]/route.ts`, agent `GET /usage/self`

```text
Agent:  GET /usage/self            (owner-scoped)  -> { tier, metrics: [{ metric, used, limit, remaining, resetAt }] }
BFF:    forwards X-Tier: <tier>    (resolved LIVE) alongside X-Owner/X-Account/X-Chain-Id; soft pre-check may 429 early.
```

**Contract test obligations**: `/usage/self` returns only the caller's own usage (cannot read another wallet); the BFF derives `X-Owner`/`X-Tier` from the verified session, never from client headers; the agent re-resolves tier from its store and does **not** trust `X-Tier` as authority; a just-granted upgrade shows in `/usage/self` without re-login.

## 6. Error envelope — `services/agent/src/sparkpoint_agent/api/errors.py`

`ErrorCode.RATE_LIMITED` already exists and maps to `429` (retryable) in `ERROR_SPEC`. The over-limit refusal reuses it; the user-facing copy is the clear, non-blocking "daily free limit reached" message (FR-012), with a single dismissible upsell surfaced client-side (FR-027).

**Contract test obligations**: an over-limit `/chat` returns the `429 RATE_LIMITED` §1.5 envelope pre-stream; the client renders the friendly limit message + one dismissible upsell, never a raw error or partial answer.

## 7. Gateway credential ceiling — `services/litellm/config.yaml` (+ Coolify/Traefik, `COOLIFY.md`)

```yaml
# On the sparkpoint-chat virtual key (via LiteLLM key config / management):
#   max_budget, rpm_limit, tpm_limit  -> exceeding refuses further calls (bounded)
# Ingress: restrict to the agent (private network / Traefik source-IP allowlist / mTLS)
# TLS: force HTTP -> HTTPS; LITELLM_BASE_URL is https
```

**Contract test obligations (live, non-destructive probe)**: unauthenticated inference still `401`; UI/schema still `404`; a request from outside the backend network cannot obtain inference; `http://` redirects to `https://`; the credential ceiling, once configured, is visible via the existing `GET /admin/llm/status` (rpm/tpm/max_budget) and, when exceeded, further calls are refused rather than served unbounded.
