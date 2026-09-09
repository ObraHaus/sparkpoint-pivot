# Contract: GET /api/version

Same-origin web route. Purpose: report the running deployment's release id so a client can detect a newer build.

**Request**: `GET /api/version` — no params, no auth, no body.

**Route config**: `export const runtime = 'nodejs'`; `export const dynamic = 'force-dynamic'`.

**Response 200** (`application/json`, `Cache-Control: no-store`):
```json
{ "version": "a1b2c3d4-1t3k9x" }
```
- `version`: the baked `NEXT_PUBLIC_BUILD_ID` of the running container (string). Echoed constant — **never** recomputed per request.

**Middleware**: `/api/version` MUST be in `ALLOW_EXACT` so the fail-closed `SITE_LOCKED` gate does not 307 it to `/coming-soon`.

**Client rules**:
- Poll ~60 s + on `visibilitychange`→visible / `focus`.
- Compare `data.version` to the client's own `NEXT_PUBLIC_BUILD_ID`.
- No-op if: own id empty/undefined; response non-200; `content-type` not JSON; redirected; `version` empty/`unknown`; or ids equal.
- Require 2 consecutive differing reads before flagging (rolling-deploy debounce).

**Invariant (CI)**: a build-time/post-build assert MUST confirm `GET /api/version` === the baked `NEXT_PUBLIC_BUILD_ID`.
