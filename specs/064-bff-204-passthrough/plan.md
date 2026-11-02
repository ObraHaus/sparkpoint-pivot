# Plan 064 — BFF 204 passthrough

## Constitution check

- **N1/N3:** no key, signature or custody surface touched. Feedback is advisory telemetry.
- **N2:** `/exit`, `/trust` and withdraw are untouched (direct RPC, not proxied).
- **III:** the status the agent sends is the status the browser sees — a stored rating reports
  success instead of a fabricated 500.
- **VII:** reuse the existing proxy seam; one small pure helper with unit tests.

## Approach

1. **New pure helper** `apps/web/src/lib/agent/proxyResponse.ts`:
   - `isNullBodyStatus(status)` for 101/103/204/205/304.
   - `nullBodyResponse(status, headers)` → `new Response(null, …)`, dropping `content-length`
     always and `content-type` for 204/205.
   - `bufferedUpstreamResponse({status, body, contentType, retryAfter})` → null-body branch never
     touches the buffer; otherwise relays it verbatim.
   - `sseUpstreamResponse(stream, status)` → the exact header set the route already used
     (`text/event-stream`, `no-cache, no-transform`, `keep-alive`, `x-accel-buffering: no`,
     `content-encoding: identity`).
2. **Route** `apps/web/src/app/api/agent/[...path]/route.ts`: buffered branch delegates to
   `bufferedUpstreamResponse`; SSE branch delegates to `sseUpstreamResponse`. Behaviour for every
   non-null-body response is unchanged.
3. **Client** `apps/web/src/lib/agent/client.ts`: already returned `undefined` for 204/205 before
   parsing; pinned with a unit test (including asserting no body read).
4. **Tests**: `proxyResponse.test.ts` (204 empty/null, 200 JSON, 429 envelope, SSE) and
   `client.test.ts` (204, 205, 200).

## Files

| File | Change |
|---|---|
| `apps/web/src/lib/agent/proxyResponse.ts` (+test) | Null-body-safe response builders. |
| `apps/web/src/app/api/agent/[...path]/route.ts` | Delegate buffered + SSE response construction. |
| `apps/web/src/lib/agent/client.test.ts` | Pin 204/205 no-parse handling. |
| `CHANGELOG.md`, `services/agent/content_seed/whats-new.json` | Living docs. |

## Risks / mitigations

- **Dropping legitimate 304 headers.** Only `content-length` is dropped for 304; representation
  headers such as `content-type` are kept.
- **Changing the SSE path.** The SSE helper is the same headers/body as before, extracted only;
  the existing `chatStreamDeadline` tests and this new SSE test guard it.
- **Upstream sending 101/103.** A `fetch`-based proxy cannot return those statuses anyway; they are
  handled defensively per the spec list without changing any working path.

## Verification

- `pnpm --filter @sparkpoint/web test`
- `pnpm --filter @sparkpoint/web typecheck:test`
- `pnpm --filter @sparkpoint/web lint`
