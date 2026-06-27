# Contract — `/api/subscribe`

The behavioral contract for the subscribe route and its upstream call. Tasks + the quickstart trace here.

## Configuration

| Key | Scope | Default | Purpose |
|---|---|---|---|
| `MAILJET_WIDGET_SUBSCRIBE_URL` | server | `https://14ij2.mjt.lu/wgt/14ij2/0r1n/subscribe?c=22cd210c` | The public Mailjet subscription-widget subscribe endpoint. Not a secret; env-overridable so the list/widget can change without a code edit. |

No Mailjet API key/secret is used. Nothing here is `NEXT_PUBLIC_*` (the endpoint stays server-side).

## `POST /api/subscribe` (our route)

**Request** (JSON):
```json
{ "email": "you@example.com" }
```

**Responses**:
| Status | Body | When |
|---|---|---|
| `200` | `{ "ok": true }` | upstream accepted (new **pending** contact, or already-subscribed — FR-009) |
| `400` | `{ "ok": false, "error": "invalid_email" }` | missing/malformed email (server-side validation) |
| `502` | `{ "ok": false, "error": "provider" }` | upstream non-2xx / network error / timeout |
| `405` | — | non-POST method |

- The route MUST NOT include any secret or upstream credentials in the response (there are none).
- Only `email` is read from the client; the destination URL + `consent` are server-controlled.

## Upstream call (route → Mailjet)

```
POST  {MAILJET_WIDGET_SUBSCRIBE_URL}
Content-Type: application/x-www-form-urlencoded   (or multipart FormData — match the widget)
Body: email=<email>&consent=<widget consent flag>
```
Treat an upstream **2xx** as success. Confirm the exact `consent` value + success body with one controlled test submit during implementation (see research.md "open implementation detail").

## Gate interaction

`/api/subscribe` MUST be in the construction gate's allow-list (`middleware.ts` `ALLOW_EXACT`) so the POST is processed (not 307 → `/coming-soon`) while the gate is on. It is the only non-landing path intentionally reachable while gated.

## Invariants

- **I-1**: No secret in repo / client bundle / response (only the public widget URL).
- **I-2**: Email validated server-side before any upstream call.
- **I-3**: Destination is fixed/server-controlled — the client cannot redirect the upstream POST (no SSRF).
- **I-4**: Every outcome maps to a deterministic client state (success or actionable error) — no silent drop.
- **I-5**: Works identically gate-ON and gate-OFF.
