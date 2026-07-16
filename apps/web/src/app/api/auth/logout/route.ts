/**
 * POST /api/auth/logout — clear the session cookie (Phase B auth).
 *
 * This ends the app SESSION only. It does not (and cannot) touch the wallet, the account, or any
 * on-chain position — funds remain fully under the user's own key, withdrawable via /exit.
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
