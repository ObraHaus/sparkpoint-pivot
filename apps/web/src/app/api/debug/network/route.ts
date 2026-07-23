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
 * Deliberately minimal + FAIL-OPEN: log-only (Coolify captures container stdout — the repo's de-facto
 * telemetry sink), no DB, no reflection, and no auth. It MUST run pre-session because the user is stuck
 * at the network step BEFORE they ever sign in; the middleware already lets `/api/*` through (INFRA_PREFIX)
 * before the session check, and `/api/debug/network` is also in the locked-deploy allowlist for parity.
 *
 * NON-CUSTODY: records nothing but the wallet address + browser network state. It moves no funds, touches
 * no keys, and cannot change the access verdict — it exists solely to reveal WHY the gate misfired.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap the logged payload so an unauthenticated caller cannot flood the logs. */
const MAX_BODY_CHARS = 4096;

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

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
