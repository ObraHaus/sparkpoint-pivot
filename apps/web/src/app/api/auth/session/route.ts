/**
 * GET /api/auth/session — the current verified session, or null (Phase B auth).
 *
 * The client shell reads this to render the connected wallet + role-gated UI. Returns ONLY the
 * safe claims ({address, beta, admin}); the signed token itself never leaves the httpOnly cookie.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return NextResponse.json({ session: null });
  return NextResponse.json({
    session: { address: claims.address, beta: claims.beta, admin: claims.admin },
  });
}
