# Contract: Admin metrics API — `GET /api/admin/rpc-proxy`

**Consumer**: `RpcProxyPanel` (Admin → System → RPC proxy), 15 s poll.
**Provider**: Next.js server route (apps/web), scraping eRPC's Prometheus endpoint over the LAN.

## Request

- `GET /api/admin/rpc-proxy` — no params, no body.
- **Auth**: identical gate to the existing admin-only server surface (admin session required; anonymous → 404, matching the repo's "all `/admin/*` are 404 to anonymous" posture). The exact shared helper is resolved at implementation from the current admin routes — the *contract* is: no admin session ⇒ the route reveals nothing, not even its existence.

## Behavior

- Reads `RPC_PROXY_METRICS_URL` (server-side env; e.g. `http://sparkpoint-erpc:4001/metrics`).
  - **Unset** ⇒ `200` with `{ reachable: false, scrapedAt, configured: false }` — the panel renders "not configured"; honest absence, not an error (FR-012).
- Fetches with a short timeout (≈2 s); parses only the allowlisted `erpc_*` series (verbatim names pinned at Stage 0 — research D7) into `RpcProxySnapshot` ([data-model.md §1](../data-model.md)).
- In-route response cache ≈5 s (the panel polls at 15 s; concurrent admins share one scrape).
- The route never proxies raw metrics text to the browser — typed JSON only (the metrics endpoint leaks upstream URLs and traffic shape; port 4001 stays LAN-only).

## Responses

| Case | Status | Body |
|---|---|---|
| Scrape OK | 200 | `RpcProxySnapshot` with `reachable: true` |
| Proxy down / timeout / parse failure | 200 | `{ reachable: false, scrapedAt, configured: true }` — panel shows "unreachable"; **not** a 5xx (a dead proxy is a *reported state*, and the System console must keep rendering) |
| No admin session | 404 | empty (indistinguishable from a nonexistent route) |

## Non-goals

No mutations, no query params, no streaming, no historical series (the panel shows point-in-time + whatever windows the counters natively encode). History/graph retention is out of scope for 039.
