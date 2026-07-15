/**
 * BFF proxy for the Hermes agent service (same-origin Backend-for-Frontend).
 *
 * The browser calls the web app's OWN origin at `/api/agent/*`; this server-side
 * catch-all Route Handler injects the service-to-service bearer and forwards the
 * request to the internal agent. This is what keeps the agent URL and the S2S
 * token OUT of the client bundle — the browser never sees either (they are read
 * from SERVER env only, never `NEXT_PUBLIC_*`).
 *
 * Contract (agent-service-api.md §1.2/§1.3/§1.5, §3.2):
 *   - forwards the browser-supplied identity/idempotency headers
 *     (X-Account / X-Owner / X-Chain-Id / Idempotency-Key) + Content-Type / Accept,
 *     adding `Authorization: Bearer <AGENT_S2S_TOKEN>`.
 *   - STREAMS SSE responses through untouched (the upstream `ReadableStream` is
 *     returned verbatim with `text/event-stream`, no buffering) so `/chat` +
 *     `/onboarding/turn` stay incremental. SSE is detected by the upstream
 *     Content-Type, which also routes a pre-stream error envelope (JSON) down the
 *     buffered path with its real status — exactly what the client's
 *     `parseErrorEnvelope` expects.
 *   - all other endpoints return the upstream JSON body + status verbatim.
 *
 * GRACEFUL OFFLINE (non-custody law): a missing `AGENT_INTERNAL_URL`, or any
 * network failure reaching the agent, returns a clean §1.5 error envelope that the
 * client renders as an "assistant offline" / error card. It NEVER blocks the app,
 * and NEVER sits on the withdraw/exit path (those are direct-RPC, not via here).
 *
 * SECURITY: the token is read server-side and used only to set the outgoing
 * Authorization header — it is never placed in any response header or body, and no
 * inbound Authorization/Cookie header is forwarded (we set our own auth). Only an
 * explicit allowlist of headers crosses in either direction.
 */

// This route proxies live, per-request identity + streams — it must never be
// statically cached or prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SERVER-only config (NOT `NEXT_PUBLIC_*` — must never reach the client bundle). */
const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

/** Request headers we relay to the agent (identity/idempotency + content negotiation). */
const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "x-account",
  "x-owner",
  "x-chain-id",
  "idempotency-key",
] as const;

/** Build a §1.5 error envelope Response the client's `parseErrorEnvelope` understands. */
function envelope(code: string, httpStatus: number, message: string, retryable: boolean): Response {
  return new Response(
    JSON.stringify({ error: { code, httpStatus, message, retryable, reasons: [] } }),
    { status: httpStatus, headers: { "content-type": "application/json" } },
  );
}

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  // Missing internal URL ⇒ the agent isn't wired to this deployment: surface a
  // clean 503 the client renders as "assistant offline" (graceful, never a crash).
  if (!AGENT_INTERNAL_URL) {
    return envelope("UPSTREAM_UNAVAILABLE", 503, "The assistant is offline right now.", true);
  }

  const { path } = await ctx.params;
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  const search = new URL(req.url).search;
  const target = `${base}/${path.join("/")}${search}`;

  // Allowlist inbound headers, then inject the S2S bearer. We never forward an
  // inbound Authorization/Cookie — this tier is the sole authority injector.
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (AGENT_S2S_TOKEN) headers.set("authorization", `Bearer ${AGENT_S2S_TOKEN}`);

  // Body: the browser sends small JSON bodies (e.g. a /chat turn); read + relay
  // as text. GET/HEAD carry none. (The SSE concern is the RESPONSE, handled below.)
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      // Never advertise the browser's cache; every call is per-identity + live.
      cache: "no-store",
      redirect: "manual",
      signal: req.signal,
    });
  } catch {
    // Agent unreachable (down / DNS / refused): graceful error card, still no crash.
    return envelope("UPSTREAM_UNAVAILABLE", 502, "The assistant is unavailable right now.", true);
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // SSE passthrough: stream the upstream body verbatim, no buffering, so ChatBlocks
  // render incrementally (/chat + /onboarding/turn). Only a 2xx SSE response takes
  // this path; a pre-stream error is JSON and falls through to the buffered branch.
  if (upstream.ok && upstream.body && contentType.includes("text/event-stream")) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Defeat proxy/response buffering so events flush as they arrive.
        "x-accel-buffering": "no",
      },
    });
  }

  // Everything else: relay the JSON body + the upstream status verbatim (§1.5 error
  // envelopes included, so the client keys off the real code/status). We copy only
  // a minimal, safe header allowlist — never the token or any upstream auth header.
  const outHeaders = new Headers();
  if (contentType) outHeaders.set("content-type", contentType);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) outHeaders.set("retry-after", retryAfter);

  const buffered = await upstream.arrayBuffer();
  return new Response(buffered, { status: upstream.status, headers: outHeaders });
}

export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx);
}

export function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx);
}
