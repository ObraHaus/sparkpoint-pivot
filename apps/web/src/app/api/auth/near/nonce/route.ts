/**
 * GET /api/auth/near/nonce — start a NEAR NEP-413 sign-in (076).
 *
 * The nonce is minted server-side and stored in the agent DB (single-use, 10-minute expiry). The
 * response carries the canonical message the wallet must sign; the nonce is ALSO put in a
 * short-lived httpOnly cookie so /verify can bind the request to this browser. No transaction is
 * built, and nothing here authorizes an on-chain action.
 */

import { NextResponse } from "next/server";
import { issueNearNonce } from "@/lib/auth/near-agent";
import { NEAR_NONCE_COOKIE, NONCE_TTL_SECONDS, isRequestSecure } from "@/lib/auth/session";
import { buildNearLoginMessage } from "@/lib/near/login";
import { nearLoginRecipient } from "@/lib/near/login-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const issued = await issueNearNonce();
  if (!issued) {
    return NextResponse.json({ ok: false, error: "nonce_unavailable" }, { status: 503 });
  }
  const recipient = nearLoginRecipient(req);
  if (!recipient) {
    return NextResponse.json({ ok: false, error: "recipient_unconfigured" }, { status: 503 });
  }
  const message = buildNearLoginMessage({
    recipient,
    nonce: issued.nonce,
    issuedAt: issued.issuedAt,
    expiresAt: issued.expiresAt,
  });
  const res = NextResponse.json({
    ok: true,
    nonce: issued.nonce,
    message,
    recipient,
    expiresAt: issued.expiresAt,
  });
  res.cookies.set(NEAR_NONCE_COOKIE, issued.nonce, {
    httpOnly: true,
    secure: isRequestSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: NONCE_TTL_SECONDS,
  });
  return res;
}
