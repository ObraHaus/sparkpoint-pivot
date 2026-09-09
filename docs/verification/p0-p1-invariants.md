# P0/P1 go-live invariants — adversarial verification artifact

Independent adversarial verification of the P0/P1 changes (commits `509c278` P0, `86152a4` P1)
before exposing the public develop URL. 10 invariants, each checked by a separate agent tasked to
**refute** the claim against the real committed source (branch `feature/w0-foundation` == develop
HEAD at verification time), then a completeness critic. Static reads unless noted; the runtime
re-checks at the bottom were run live against the deploy.

## Result: 9/10 hold at high confidence → GO (conditional)

Every P0 **safety** invariant holds. The single failure is **cost-only**, not a safety/custody gap.

| # | Invariant | Verdict | Notes |
|---|---|---|---|
| 1 | token-never-logged | ✅ holds (high) | resilience logs only status/attempt/Retry-After/elapsed; regression test plants `SUPERSECRET-LEAK` and asserts absence; even a repr of the sync client with a planted secret leaked 0 times |
| 2 | retry-correctness | ✅ holds (high) | 429/529 only; Retry-After honored+clamped; cap 3 / ≤60s; full-jitter; SDK `max_retries=0` on the async client |
| 3 | sse-no-midstream-retry | ✅ holds (high) | resilient path wraps a non-streaming atomic `complete()`; `/chat` degrades to ONE inert block; no already-emitted token can be duplicated |
| 4 | concurrency-limiter | ✅ holds (high) | `GLOBAL_LIMITER` max_inflight=2 wraps the real call; burst queues |
| 5 | **prompt-caching** | ⚠️ **does NOT hold (LOW / cost-only)** | `cache_control` on a stable prefix is real, BUT the "integration check" hardcodes `cache_read_input_tokens=2048` in a fake — deleting `cache_control` leaves the test green. **Zero real coverage that caching works**; a silent miss only inflates token cost |
| 6 | fail-closed-ux | ✅ holds (high) | exhaustion → clean §1.5 UPSTREAM_UNAVAILABLE / inert block; no fabricated content; Retry-After logged |
| 7 | bff-security | ✅ holds (high) | token is server-env only; never in a response header/body; no inbound Authorization/Cookie forwarded; SSE passthrough; missing URL→503, fetch-throw→502 |
| 8 | trust-surface-purge | ✅ holds (high) | no setTimeout "sim", no fabricated receipts/Tenderly; Sign gated on real preview; receipt only on real on-chain confirm |
| 9 | non-custody-untouched | ✅ holds (high) | vault source + N1–N5 invariant tests untouched by P0/P1; withdraw/redeem carry no pause; /exit agent-independent |
| 10 | custody-seam | ✅ holds (high) | no import of services/agent|sparkpoint_agent from apps/web or packages/shared; CI gate present |

## Runtime re-checks (run live against the deploy)

- **Served JS bundle across 30 app-route chunks: 0 token matches** (Anthropic + S2S) and `sk-ant-`;
  `/api/agent` present → the client uses the BFF. No secret reaches the browser.
- **Agent Dockerfile CMD has no `--workers`** → single uvicorn process, so the process-global
  `max_inflight=2` limiter genuinely caps at 2 (not 2×N). Multi-worker multiplication does not apply.
- **`NEXT_PUBLIC_AGENT_BASE_URL` removed** (code + env) — no deploy can redirect user-scoped calls
  around the BFF (was flagged as a runtime routing exposure; now closed).

## Caveats surfaced (not blockers, tracked)

- **prompt-caching is unverified at runtime** — needs a *successful* chat turn to observe
  `cache_read_input_tokens > 0`; blocked while the shared OAuth quota is exhausted.
- **sync `/build-tx` client** (`llm/claude.py`) does not set `max_retries=0`, has no limiter, and its
  `.client` field is not `repr=False` — unreachable today (no live route constructs it), a latent
  regression-in-one-import. Tracked for the resilience follow-up.
- **custody-seam CI gate is line-anchored** — would miss a multi-line named import (none exists).

_Method: 11-agent workflow (10 refuters + 1 completeness critic), each reading the real files with
Read/Grep/Bash. Full per-agent transcripts are in the session's workflow journal._
