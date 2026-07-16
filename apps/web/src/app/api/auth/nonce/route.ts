/**
 * GET /api/auth/nonce — issue a fresh SIWE nonce (Phase B auth, step 1).
 *
 * The nonce is returned to the client (to embed in the SIWE message it signs) AND stored in a
 * short-lived httpOnly cookie so the /verify step can bind the signed message to the nonce this
 * server issued — defeating replay. Single-use: /verify clears it on success.
 */

import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { NONCE_COOKIE, NONCE_TTL_SECONDS } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  const nonce = generateSiweNonce();
  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: NONCE_TTL_SECONDS,
  });
  return res;
}
