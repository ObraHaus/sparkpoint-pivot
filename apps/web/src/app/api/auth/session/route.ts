/**
 * GET /api/auth/session — the current verified session, or null (Phase B auth).
 *
 * The client shell reads this to render the connected wallet + role-gated UI. Returns ONLY the
 * safe claims ({address, beta, admin}); the signed token itself never leaves the httpOnly cookie.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { BETA_OPEN } from "@/lib/auth/openBeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return NextResponse.json({ session: null });
  // `BETA_OPEN` is applied at read time as well as at mint time, so a session minted while the
  // beta was still closed (its cookie says `beta: false`) picks up the open beta without a
  // re-sign. Admin is never widened here.
  return NextResponse.json({
    session: {
      address: claims.address,
      chain: claims.chain,
      beta: claims.beta || BETA_OPEN,
      admin: claims.admin,
    },
  });
}
