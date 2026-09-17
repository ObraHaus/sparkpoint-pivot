/**
 * POST /api/debug/network — capture a client-side wallet/network diagnostic at the SIWE access gate.
 *
 * WHY: a tester reported the /verify gate showing "wrong network" while their wallet was genuinely on
 * a supported chain (Base Sepolia / Robinhood testnet). The `useAccount().chainId` the gate reads is a
 * pass-through: it is `undefined` mid-reconnect and — when several wallet extensions are installed — can
 * bind to the WRONG injected provider (on an unsupported chain). Both are hard to reproduce from a bug
 * report. This endpoint records the one capture that tells them apart: the wallet's own `eth_chainId`
 * (ground truth) vs the chainId wagmi surfaced, plus the discovered EIP-6963 providers and the connector.
 *
 * FAIL-OPEN + pre-session: it MUST run before the user signs in (they're stuck at the network step),
 * so it takes no session — the middleware lets `/api/*` through (INFRA_PREFIX) before the session check,
 * and `/api/debug/network` is also in the locked-deploy allowlist. It (1) always writes one structured
 * `[net-debug]` line to stdout (Coolify-captured), AND (2) best-effort forwards the capture to the agent
 * over S2S so ops can review it at `/admin/diagnostics` (persisted). Neither can throw or block the
 * response — a stuck user's beacon must always get a clean `{ok:true}`.
 *
 * NON-CUSTODY: records nothing but a CLIENT-REPORTED (unverified) wallet address + browser network state.
 * It moves no funds, touches no keys, and cannot change the access verdict — it only reveals WHY the gate
 * misfired. The persisted address is unverified BY CONSTRUCTION (no SIWE proof exists pre-sign-in).
 */

import { NextResponse } from "next/server";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SERVER-only (never `NEXT_PUBLIC_*`): reused from the BFF so the token never reaches the client. */
const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

/** Cap the payload so an unauthenticated caller cannot flood the logs / the diagnostics table. */
const MAX_BODY_CHARS = 4096;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Valid-format placeholder when the beacon carries no usable wallet address (satisfies the agent's
 * X-Owner format gate; the real, possibly-absent address still lives in the body we forward). */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Best-effort S2S forward to the agent so the capture is persisted for /admin/diagnostics. The
 * agent's header gate requires a 20-byte X-Owner and a SUPPORTED X-Chain-Id — so we scope the
 * request with the claimed wallet (or the zero sentinel) + a fixed supported chain (84532). The
 * capture's REAL chain (possibly unsupported/undefined — the whole point of the bug) travels in the
 * body, never the header, so it can't be rejected. Fire-and-forget; a failure only means no row. */
async function forwardToAgent(raw: string): Promise<void> {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return;
  let owner = ZERO_ADDRESS;
  try {
    const claimed = (JSON.parse(raw) as { wagmi?: { address?: unknown } })?.wagmi?.address;
    if (typeof claimed === "string" && ADDRESS_RE.test(claimed)) owner = claimed;
  } catch {
    // A non-JSON / truncated body still forwards; the agent parses leniently (or drops it).
  }
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  try {
    await fetch(`${base}/diagnostics/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${AGENT_S2S_TOKEN}`,
        "x-owner": owner,
        "x-account": owner,
        "x-chain-id": APP_CHAIN_ID_HEADER, // transport scoping ONLY — the real chain is in the body
      },
      body: raw,
      cache: "no-store",
    });
  } catch {
    // Agent down/unreachable — the stdout log still captured it; never surface to the user.
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // Read as text (never parse) so a malformed body can't throw — fail-open like /api/subscribe.
  let raw = "";
  try {
    raw = (await req.text()).slice(0, MAX_BODY_CHARS);
  } catch {
    raw = "<unreadable>";
  }

  // One structured line to stdout. Grep the container logs for `[net-debug]` to pull an incident
  // capture, then JSON.parse the line and its inner `body` field. We log the userAgent (standard web
  // log field) but deliberately NOT the forwarded IP or cookies (non-custody / minimal PII).
  console.warn(
    "[net-debug] " +
      JSON.stringify({
        at: new Date().toISOString(),
        ua: req.headers.get("user-agent") ?? undefined,
        body: raw,
      }),
  );

  // Persist for the admin viewer — awaited so the write lands before the (short-lived) route
  // handler returns, but wrapped so it can never turn a beacon into an error for the stuck user.
  await forwardToAgent(raw).catch(() => undefined);

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
