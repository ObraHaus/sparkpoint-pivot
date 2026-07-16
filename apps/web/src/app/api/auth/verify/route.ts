/**
 * POST /api/auth/verify — verify a SIWE signature and mint a session (Phase B auth, step 2).
 *
 * Body: `{ message, signature }` (EIP-4361). We:
 *   1. read the server-issued nonce cookie (must exist + match the message's nonce);
 *   2. verify the signature against the message via viem `verifySiweMessage` (EOA offline recovery,
 *      or on-chain ERC-6492/1271 for smart accounts) — the recovered signer must equal the address;
 *   3. resolve the wallet's allowlist roles from the agent (server-only S2S);
 *   4. mint an httpOnly session cookie carrying {address, beta, admin} and clear the nonce.
 *
 * NON-CUSTODY: proving control of a wallet authorizes NOTHING on-chain — the session is an access
 * token only. It never gates /exit, /trust, or withdraw (N2).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { fetchAllowlistStatus } from "@/lib/auth/agent-status";
import {
  NONCE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isRequestSecure,
  signSession,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL: Record<number, string | undefined> = {
  [base.id]: process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL,
  [baseSepolia.id]: process.env.BASE_SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
};

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as
    | { message?: unknown; signature?: unknown }
    | null;
  const message = body?.message;
  const signature = body?.signature;
  if (typeof message !== "string" || typeof signature !== "string") {
    return bad("bad_request");
  }

  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  if (!nonce) return bad("nonce_expired");

  const parsed = parseSiweMessage(message);
  const address = parsed.address;
  const chainId = parsed.chainId;
  if (!address || !isAddress(address) || !chainId) return bad("bad_message");
  if (chainId !== base.id && chainId !== baseSepolia.id) return bad("unsupported_chain");

  const chain = chainId === base.id ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http(RPC_URL[chainId]) });

  let valid = false;
  try {
    valid = await verifySiweMessage(client, {
      message,
      signature: signature as Hex,
      nonce,
      address,
    });
  } catch {
    valid = false;
  }
  if (!valid) return bad("invalid_signature", 401);

  // Roles from the agent's DB-backed allowlist. If we can't reach it, refuse rather than mint a
  // session with unverifiable roles (fail-closed).
  const status = await fetchAllowlistStatus(address.toLowerCase(), chainId);
  if (!status) return bad("allowlist_unavailable", 503);

  const token = await signSession({
    address: address.toLowerCase(),
    beta: status.beta,
    admin: status.admin,
  });
  if (!token) return bad("session_unconfigured", 500);

  const secure = isRequestSecure(req);
  const res = NextResponse.json({
    ok: true,
    address: address.toLowerCase(),
    beta: status.beta,
    admin: status.admin,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  // Single-use nonce — clear it.
  res.cookies.set(NONCE_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
