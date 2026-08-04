/**
 * 041 — admin-gated scrape of the RPC proxy's Prometheus metrics → typed JSON.
 *
 * The proxy's metrics port (4001) is LAN-only: raw exposition leaks upstream URLs and traffic
 * shape, so the browser NEVER sees it — this server route fetches it, parses the allowlisted
 * series (lib/admin/rpcProxyTiles), and returns only the typed snapshot.
 *
 * Contract (specs/041-erpc-rpc-proxy/contracts/admin-metrics-api.md):
 *   - no admin session ⇒ 404, indistinguishable from a nonexistent route (the repo's standing
 *     "all /admin/* are 404 to anonymous" posture);
 *   - RPC_PROXY_METRICS_URL unset ⇒ 200 {reachable:false, configured:false} — "not configured"
 *     is a STATE the panel renders, not an error;
 *   - proxy down / timeout / parse failure ⇒ 200 {reachable:false, configured:true} — a dead
 *     proxy is a REPORTED state; the System console must keep rendering (never a 5xx here);
 *   - ~5s in-route cache: concurrent admins share one scrape (the panel polls at 15s).
 */

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { parseRpcProxyMetrics, type RpcProxySnapshot } from "@/lib/admin/rpcProxyTiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRAPE_TIMEOUT_MS = 2_000;
const CACHE_MS = 5_000;

/** Module-level share: last snapshot + when it was taken (per server process — that's the point). */
let last: { atMs: number; body: RpcProxySnapshot } | null = null;

function json(body: RpcProxySnapshot): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  // Admin only — and invisible to everyone else. (Session claims carry the allowlist-resolved
  // admin role; no claim or no cookie reads exactly like a route that doesn't exist.)
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims?.admin) return new Response(null, { status: 404 });

  const now = Date.now();
  if (last !== null && now - last.atMs < CACHE_MS) return json(last.body);

  const scrapedAt = new Date().toISOString(); // server clock, UTC (the 033 future-dating lesson)
  const url = process.env.RPC_PROXY_METRICS_URL;

  if (!url) {
    return json({ reachable: false, configured: false, scrapedAt });
  }

  let body: RpcProxySnapshot;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`metrics scrape: HTTP ${res.status}`);
    const text = await res.text();
    body = { reachable: true, configured: true, scrapedAt, ...parseRpcProxyMetrics(text) };
  } catch {
    body = { reachable: false, configured: true, scrapedAt };
  }

  last = { atMs: now, body };
  return json(body);
}
