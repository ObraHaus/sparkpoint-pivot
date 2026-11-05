/**
 * POST /api/auth/near/verify — verify a NEP-413 signature and mint a NEAR session (076).
 *
 * Order (fail-closed at every step):
 *   1. the nonce cookie must exist and match the body nonce;
 *   2. the nonce is CONSUMED once in the agent DB (replay ⇒ nonce_expired);
 *   3. the signed message must equal the server's canonical message for that nonce;
 *   4. ed25519 signature over the NEP-413 borsh payload (tag 2^31+413, recipient = app domain);
 *   5. the key must be a FullAccess key of the account via read-only `view_access_key` (skipped
 *      ONLY in the explicit, env-gated test mode for a designated throwaway test account);
 *   6. roles are resolved from the agent allowlist, then an httpOnly session carrying
 *      `{ chain: 'near', address: accountId }` is minted.
 *
 * NON-CUSTODY: proving account control authorizes NOTHING on-chain.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { consumeNearNonce } from "@/lib/auth/near-agent";
import { fetchAllowlistStatus } from "@/lib/auth/agent-status";
import { BETA_OPEN } from "@/lib/auth/openBeta";
import {
  NEAR_NONCE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isRequestSecure,
  signSession,
} from "@/lib/auth/session";
import { verifyNearLogin } from "@/lib/near/login";
import { nearLoginRecipient, nearLoginTestMode } from "@/lib/near/login-server";
import { isFullAccessKey } from "@/lib/near/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const secure = isRequestSecure(req);
  const clearNonce = (res: NextResponse): NextResponse => {
    res.cookies.set(NEAR_NONCE_COOKIE, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  };
  const bad = (error: string, status = 400): NextResponse =>
    clearNonce(NextResponse.json({ ok: false, error }, { status }));

  const body = (await req.json().catch(() => null)) as
    | {
        accountId?: unknown;
        publicKey?: unknown;
        signature?: unknown;
        message?: unknown;
        nonce?: unknown;
      }
    | null;
  if (
    typeof body?.accountId !== "string" ||
    typeof body.publicKey !== "string" ||
    typeof body.signature !== "string" ||
    typeof body.message !== "string" ||
    typeof body.nonce !== "string"
  ) {
    return bad("bad_request");
  }

  const jar = await cookies();
  const cookieNonce = jar.get(NEAR_NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== body.nonce) return bad("nonce_expired");

  const test = nearLoginTestMode();
  const result = await verifyNearLogin(
    {
      accountId: body.accountId,
      publicKey: body.publicKey,
      signature: body.signature,
      message: body.message,
      nonce: body.nonce,
    },
    {
      expectedRecipient: nearLoginRecipient(req),
      consumeNonce: consumeNearNonce,
      keyIsFullAccess: isFullAccessKey,
      testMode: test.enabled,
      testAccountId: test.accountId,
    },
  );
  if (!result.ok) {
    const status = result.error === "invalid_signature" ? 401 : 400;
    return bad(result.error, status);
  }

  // Roles come from the agent's DB-backed allowlist, keyed on the SAME owner string. A NEAR
  // account is not an EVM wallet, so the EVM SRK auto-gate is not run.
  let status = await fetchAllowlistStatus(body.accountId, 8453, "near");
  if (!status) {
    // Test mode exists so CI/Playwright can prove the login path without a funded/allowlisted
    // account. It is server-env gated and account-pinned; production never sets it.
    if (test.enabled && (!test.accountId || body.accountId === test.accountId)) {
      status = { beta: true, admin: false };
    } else {
      return bad("allowlist_unavailable", 503);
    }
  }
  const beta = status.beta || BETA_OPEN;

  const token = await signSession({
    address: body.accountId,
    chain: "near",
    beta,
    admin: status.admin,
  });
  if (!token) return bad("session_unconfigured", 500);

  const res = NextResponse.json({
    ok: true,
    address: body.accountId,
    chain: "near",
    beta,
    admin: status.admin,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return clearNonce(res);
}
