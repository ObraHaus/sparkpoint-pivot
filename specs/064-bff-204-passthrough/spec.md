# Spec 064 — BFF passes 204 No Content through

**Status:** implemented · **Owner:** build · **Branch:** `fix/064-bff-204-passthrough`

## Why

On beta (prod build of `main` @ `a061f81`), rating an answer with thumbs up/down stores fine but
the browser sees HTTP 500. The web app POSTs to the same-origin BFF (`/api/agent/chat/feedback`),
which forwards to the agent's `POST /chat/feedback`. The agent correctly answers `204 No Content`.
The BFF then rebuilt the response with `new Response(arrayBuffer, { status: 204 })`. The Fetch
`Response` constructor rejects **any** body for a null-body status
(`TypeError: Response constructor: Invalid response status code 204`), so the route threw and the
browser got a 500 — even though the rating was persisted.

## Acceptance criteria

1. For null-body statuses (101, 103, 204, 205, 304) the BFF returns
   `new Response(null, { status, headers })`; it never passes a body (including an empty buffer or a
   stream). `content-length` is dropped, and `content-type` is dropped for 204/205.
2. A 200 (or any other) JSON response is relayed verbatim — status, body and the safe header
   allowlist unchanged.
3. SSE `/chat` streaming is byte-for-byte unchanged: same headers, same stream, same deadline.
4. `AgentClient.request` handles 204/205 by returning `undefined` without attempting to parse JSON.
5. Unit tests cover 204 → 204 with an empty body, 200 JSON unchanged, SSE unchanged and the client
   204 path.
6. `apps/web` unit tests, typecheck and lint pass as CI runs them; both changelogs updated.

## Non-goals

- No agent endpoint, migration, policy, custody or signing change.
- No change to the SSE deadline behaviour, headers or reducer.
- No client UI change; thumbs already POST the correct payload.

## Success signals

- `pnpm --filter @sparkpoint/web test` green (new proxy + client tests included).
- `pnpm --filter @sparkpoint/web typecheck:test` and `pnpm --filter @sparkpoint/web lint` green.
- A successful feedback POST surfaces as 204 to the browser, not 500.
