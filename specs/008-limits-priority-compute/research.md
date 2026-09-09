# Research: Limits & Priority Compute (Phase 0)

Decisions and rationale grounding the plan. Sources: a direct code read of `services/agent/src/sparkpoint_agent/{api,llm,db,coordinator}/*`, `services/litellm/*`, the admin surfaces under `apps/web/src/app/admin/*` + `apps/web/src/app/api/agent/[...path]/route.ts`, a live non-destructive probe of the chat gateway, and the operator's locked decisions (spec §Clarifications).

## D1 — Enforce with a per-route FastAPI dependency, not global middleware

**Decision**: Add a `require_within_quota` dependency (mirroring the existing `require_admin`) to exactly the LLM-bearing routes — `POST /chat`, `POST /recommendations`, `POST /onboarding/turn` — rather than adding the check to `RequestContextMiddleware.dispatch`.

**Rationale**: The cost/availability risk is specifically the LLM path. A middleware limiter would wrongly meter vault-quote reads and every other route, and would sit one layer away from the custody path — exactly where the non-custody invariant (N2) says a throttle must never be. A dependency scopes enforcement to advisory compute and reads `request.state.account.owner` (already established by the middleware). Rejected: middleware (over-broad, N2 risk); per-call metering inside the LLM client (wrong granularity — see D2).

## D2 — Meter the whole turn, not the HTTP request or the model call

**Decision**: One `/chat` turn = one unit against the assistant allowance, regardless of internal fan-out.

**Rationale**: `CoordinatorDag.run_chat` fans a single turn out to `planner.classify` + `literacy.tip` and/or `recommender.propose` — several `messages.create` calls. Counting requests would under-count multi-endpoint flows; counting model calls would over-charge a user 2–3× for one message. The turn is the unit the user perceives and the unit the product sells ("N chats/day"). The dependency increments once, at admission.

## D3 — Admit or deny before the SSE stream starts

**Decision**: The quota check runs in the dependency, before `chat.py` returns its `StreamingResponse` (before the pre-stream chain read).

**Rationale**: `/chat` is Server-Sent Events. Once bytes flow, the handler can only degrade to an inert block; it cannot emit a `429`. So the decision must be made pre-stream. `ErrorCode.RATE_LIMITED` already maps to a `429` retryable envelope and is currently unused — wiring it from the dependency is a one-line raise. Rejected: mid-stream refusal (impossible to surface as an error).

## D4 — Fail closed to the free tier

**Decision**: Any failure to resolve a wallet's tier (store unreachable, ambiguous) resolves to **free**, never premium.

**Rationale**: Matches the codebase's fail-closed posture (unset S2S token rejects all; unreachable allowlist refuses login). A resolution bug that defaulted to premium would be a paid-bypass. Free is the safe default because free is fully capable and funds are never involved.

## D5 — Atomic Postgres counters + in-process limiter (no Redis) for the single-replica alpha

**Decision**: Usage counters are `INSERT … ON CONFLICT (address, metric, window_start) DO UPDATE SET count = count + 1 RETURNING count` on a new `usage_counters` table; the priority limiter stays the in-process `asyncio.Semaphore` in `llm/resilience.py`, made tier-aware.

**Rationale**: The locked decision is single-replica for the alpha, so per-process state is correct (the existing `GLOBAL_LIMITER` and `IdempotencyStore` are already per-process). Atomic upserts make the counter race-safe within the replica without a new dependency (Principle VII). Rejected for now: a shared Redis counter/limiter — real cross-replica hardening, but unnecessary infra for one replica; it is the documented first hardening item for scale-out.

## D6 — Resolve tier LIVE per request, not baked into the session cookie

**Decision**: The web BFF resolves the caller's tier on each request (via the agent's status read) and forwards it as an `X-Tier` header; the agent independently resolves/authorizes tier server-side (defense-in-depth). Tier is NOT stored in the 7-day `sp_session` cookie.

**Rationale**: `SessionClaims` are minted once and immutable for 7 days. Baking tier in would mean a just-granted upgrade (or a revocation) doesn't take effect until re-login — bad for a paid grant and worse for a revocation. Live resolution makes grant/revoke effective on the next request (SC-006). The wallet-switch logout already exists; tier changes need no re-login.

## D7 — "Priority compute" = tier-weighted acquisition of the existing limiter

**Decision**: Make the single global LLM limiter tier-aware (premium acquires preferentially; free gets a smaller share / shorter queue budget and degrades to the busy path first). Thread the resolved tier `owner → dag.run_chat → client → call_with_resilience` (the limiter field is already injectable).

**Rationale**: The genuinely scarce resource is the shared limiter + the free model's own upstream rate limit — not GPUs. For a free-model product, "priority" is *who waits less under contention*, which this delivers with no new infrastructure. Rejected: a separate premium model pool / dedicated GPU (no such resource; over-engineered). A per-tier LiteLLM virtual key with higher rpm/tpm is a compatible later enhancement (US4/hardening), not required for MVP priority.

## D8 — Dual-layer enforcement (agent authoritative, BFF soft pre-check)

**Decision**: The agent dependency is the hard, authoritative refusal; the BFF adds a soft pre-check that can short-circuit obvious overage and give instant UX feedback. Both resolve tier live and must agree.

**Rationale**: Locked decision. Agent-only would force a full round-trip before a capped free user learns they're capped; BFF-only is bypassable by anything reaching the agent directly and is blind to the real scarce resource. The BFF already owns identity derivation + the beta gate, so the pre-check sits naturally there.

## D9 — Key tier assignment by lowercased wallet TEXT; key usage counters by the same wallet

**Decision**: `wallet_tier.address` and `usage_counters.address` are the lowercased `0x` EOA (the owner), following the access/audit convention (`wallet_allowlist`, `gateway_audit`) — not a `users.id` FK.

**Rationale**: A tier can then be granted before the wallet has ever written product data (no user-row-must-exist ordering dependency), matching how `wallet_allowlist` gates access today. The owner EOA is the stable payer identity and survives the future ERC-4337 account/owner split (key on owner, not the counterfactual account). Rejected: `users.id` FK (adds a lazy-upsert ordering dependency for no benefit here).

## D10 — Bound the shared inference at the gateway, isolate its ingress, force TLS

**Decision**: Set `max_budget` + `rpm_limit`/`tpm_limit` on the LiteLLM virtual key; restrict the gateway's ingress to SparkPoint's backend (private network / Traefik source-IP allowlist / mTLS); force HTTP→HTTPS.

**Rationale**: The live probe confirmed the gateway already refuses unauthenticated inference and never ships its key to the browser — good. But "SparkPoint-only" rests entirely on one shared key with no per-key budget/rate cap, and http is not redirected. App-tier limits live inside the agent and cannot bound a leaked key; only a gateway ceiling + network isolation can (Principle IV). Current blast radius is availability (free models); it becomes financial on a paid model — so bound spend now. Rejected: relying on the obscure hostname (security-by-obscurity is not a control).

## D11 — Rolling 24h window, PH/Asia-Manila, keyed by window bucket

**Decision**: Allowance windows default to rolling 24h in Asia/Manila; the counter row is keyed by a computed `window_start` bucket so a new window is a new row (old rows age out). Operator-tunable.

**Rationale**: Locked default. Bucketed rows make "reset" free (no cron to zero counters) and make historical per-window usage readable for monitoring. Calendar-day is a one-line change to the bucket function if the operator prefers it later.

## D12 — Reuse the proven patterns, add nothing new

**Decision**: `LimitsStore` copies `AllowlistStore` (asyncpg dataclass, in-tx audit, seed-from-env); the admin routers copy `admin_llm.py`/`admin_uptime.py` (`require_admin`, 404-posture, secret-scrub, honest-degrade); the admin pages copy `admin/allowlist` (CRUD) + `admin/gateway` (live fetch); charts reuse `components/admin/charts.tsx`; the user self-usage view reuses `CapsMeter`.

**Rationale**: Every seam this feature needs already has a live, tested precedent in the repo. Reuse keeps the surface auditable and matches the constitution's Simplicity principle. No new runtime dependency.

## D13 — Idempotency-aware counting

**Decision**: The counter increment is tied to the request's idempotency key where present, so a client retry that replays the cached response does not double-charge (and does not under-charge a genuine new turn).

**Rationale**: The middleware already captures/replays POST responses by `Idempotency-Key`. A quota decrement that ignored it would double-charge a user whose client retried a slow request. The dependency checks the idempotency record before incrementing.

## Adversarial review notes (recorded)

- **Trust boundary (unchanged, but higher stakes).** The agent trusts `X-Owner`/`X-Tier` from the BFF with no server-side SIWE re-verification — the same model as all existing scoping. The agent still re-resolves tier from its own store (not the forwarded header) as the authority, so a spoofed `X-Tier` past a compromised S2S boundary cannot grant premium; the header is a hint/pre-check only. Documented so a reviewer does not mistake the header for the authority.
- **Free-UX regression risk.** The free model already runs ~26–30s/turn under load. Caps + deprioritization must be tuned generously (SC-009) so limits don't compound existing scarcity into an unusable free tier; the throttle-rate monitor (US3) is the early-warning signal.
- **Seed/migration ordering.** `0015` must be applied (yoyo, `PGCLIENTENCODING=UTF8`) before the agent boots or the store/seed hooks degrade silently; the boot seed is best-effort try-swallow, so a missing table = no limits (fail-open on *config*, but enforcement then simply admits — acceptable as it never blocks funds; called out for ops).
