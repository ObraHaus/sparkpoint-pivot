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
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { BETA_OPEN } from "@/lib/auth/openBeta";
import { CHAT_STALL_TIMEOUT_MS, withChatDeadline } from "@/lib/agent/chatStreamDeadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SERVER-only config (NOT `NEXT_PUBLIC_*` — must never reach the client bundle). */
const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

/**
 * 061 A9 — a chat turn must not look alive forever.
 *
 * The proxy originally armed ONE timer at stream construction, which capped the TOTAL stream time
 * (60s) instead of how long the upstream could go SILENT; a legitimate slow answer was cut off
 * even while chunks kept arriving. `withChatDeadline` is now an IDLE/stall deadline: it re-arms on
 * every upstream chunk (including SSE keepalive/comment frames), keeps the time-to-first-byte
 * bound, and has a separate 5-minute absolute ceiling as a backstop. When either fires we emit the
 * normal `error` block on the open stream (the renderer understands it and the chat offers Retry),
 * close cleanly, and do NOT cancel the agent turn — see the helper's comment on refund/Retry.
 *
 * The same stall bound also gives the initial response-headers wait its budget. Overridable for
 * tests/ops via `AGENT_CHAT_TIMEOUT_MS` / `AGENT_CHAT_STREAM_CEILING_MS`.
 */
const CHAT_TIMEOUT_MS = CHAT_STALL_TIMEOUT_MS;

/**
 * Request headers we relay to the agent. Phase B: `x-account`/`x-owner` are NO LONGER accepted
 * from the client — identity is derived server-side from the verified SIWE session (see `proxy`),
 * so a browser can no longer assert an arbitrary owner. Only network selection + content
 * negotiation + idempotency cross from the client.
 */
const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "x-chain-id",
  "idempotency-key",
] as const;

/** First path segment of endpoints exempt from the beta gate (read-only liveness/readiness only). */
const STATUS_PATHS = new Set(["readyz", "healthz"]);

/**
 * 026 — the ONE write surface a signed-in but NON-BETA wallet may reach: its own alpha access
 * application (`/access/application`). Without this, the form at /verify could never be submitted,
 * because the beta gate below 403s every agent call for exactly the wallets that need to apply.
 *
 * Kept as narrow as it can be: a single first segment, still session-authenticated (the owner is
 * derived from the verified cookie below, never client-asserted), and the agent side is one
 * upsert-your-own-row endpoint with server-side length caps. `/admin/access/*` is NOT exempt — it
 * starts with `admin` and still requires beta plus the agent's own admin gate.
 */
const NON_BETA_PATHS = new Set(["access"]);

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

  // Identity comes from the VERIFIED session cookie, never from client headers. No valid session
  // ⇒ refuse (the app pages that call this are already session-gated by the middleware; this is the
  // server-side enforcement of that). /exit + /trust never reach here — they read chain state via
  // direct RPC — so this can never sit on the withdraw path (N2).
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) {
    return envelope("UNAUTHENTICATED", 401, "Sign in with your wallet to use the assistant.", false);
  }

  // BETA GATE (server-enforced, not just at the page middleware which exempts /api/*): the assistant
  // + every write/derivation endpoint requires an allowlisted (beta) session, so a signed-in but
  // non-beta wallet cannot drive the assistant or burn the shared LLM budget. Only read-only
  // liveness/readiness probes are exempt (admin routes need beta too — admin implies beta, and the
  // agent additionally enforces admin). Honest 403, never a silent pass. Never gates /exit,/trust
  // (those don't route through here — direct RPC, N2).
  // `BETA_OPEN=true` opens the beta to every signed-in wallet (2026-10-04): the beta gate above
  // passes anyone with a valid session, exactly as the middleware does. Admin is unaffected — the
  // agent still 404s non-admins on every /admin route.
  const head = path[0] ?? "";
  if (!STATUS_PATHS.has(head) && !NON_BETA_PATHS.has(head) && !claims.beta && !BETA_OPEN) {
    // Machine code stays BETA_NOT_ENABLED (stable API contract); only the human message tracks the
    // current stage wording — the app is in alpha, so don't tell a user they're "not in the beta".
    return envelope("BETA_NOT_ENABLED", 403, "Alpha access required — your wallet isn't in the alpha yet.", false);
  }

  // Allowlist inbound headers, then set the derived identity + inject the S2S bearer. We never
  // forward an inbound Authorization/Cookie — this tier is the sole authority injector.
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // account == owner (EOA-direct mode; the agent accepts this until AA accounts land).
  headers.set("x-owner", claims.address);
  headers.set("x-account", claims.address);
  if (AGENT_S2S_TOKEN) headers.set("authorization", `Bearer ${AGENT_S2S_TOKEN}`);

  // Body: the browser sends small JSON bodies (e.g. a /chat turn); read + relay
  // as text. GET/HEAD carry none. (The SSE concern is the RESPONSE, handled below.)
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.text() : undefined;

  // The chat proxy gets a bounded wait for RESPONSE HEADERS. The stream is bounded separately below
  // by STALL time, not total time (a slow answer is legitimate; a silent one is not).
  const connect = new AbortController();
  const connectTimer = setTimeout(() => connect.abort(), CHAT_TIMEOUT_MS);
  // Preserve client-disconnect propagation while adding the header deadline. The timer is cleared
  // as soon as headers arrive, so a legitimate long SSE body is not cut off here.
  const connectSignal = AbortSignal.any([req.signal, connect.signal]);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      // Never advertise the browser's cache; every call is per-identity + live.
      cache: "no-store",
      redirect: "manual",
      signal: connectSignal,
    });
  } catch {
    // Agent unreachable (down / DNS / refused / timed out): graceful error card, still no crash.
    return envelope("UPSTREAM_UNAVAILABLE", 502, "The assistant is unavailable right now.", true);
  } finally {
    clearTimeout(connectTimer);
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // SSE passthrough: stream the upstream body verbatim, no buffering, so ChatBlocks
  // render incrementally (/chat + /onboarding/turn). Only a 2xx SSE response takes
  // this path; a pre-stream error is JSON and falls through to the buffered branch.
  if (upstream.ok && upstream.body && contentType.includes("text/event-stream")) {
    const stream = head === "chat" ? withChatDeadline(upstream.body, CHAT_TIMEOUT_MS) : upstream.body;
    return new Response(stream, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Defeat proxy/response buffering so events flush as they arrive.
        "x-accel-buffering": "no",
        // 036 — AND declare the body already encoded, which is what actually stops it.
        //
        // `no-transform` and `x-accel-buffering` were both already set, and the stream was STILL
        // being buffered end-to-end for every browser. Measured against the live deployment on the
        // same question:
        //
        //     plain request                       tool_step 2.7s · 10.1s · 17.8s · answer 17.8s
        //     Accept-Encoding: gzip, deflate, br  EVERYTHING at 21.2s
        //
        // A browser always sends that header, so no user had ever seen this stream arrive
        // incrementally: the compressor held every event until the response closed. It was
        // invisible because the old waiting state was the single static word "Working…", which
        // looks identical whether anything is streaming or not — the progress trace only appeared
        // once the turn was already over, which is precisely when it is of no use.
        //
        // `identity` says the body is already in its final encoding, so nothing downstream may
        // re-encode (and therefore buffer) it. Compression stays on for every other response.
        "content-encoding": "identity",
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
