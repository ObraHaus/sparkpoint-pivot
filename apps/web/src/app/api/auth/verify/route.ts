/**
 * POST /api/auth/verify — verify a SIWE signature and mint a session (Phase B auth, step 2).
 *
 * Body: `{ message, signature }` (EIP-4361). We:
 *   1. read the server-issued nonce cookie (must exist + match the message's nonce);
 *   2. bind the DOMAIN + chain to the deployment (from trusted server config, never the message body)
 *      and require an expirationTime — so a signature phished on another domain / for another chain /
 *      without an expiry can't be replayed here;
 *   3. verify the signature against the message via viem `verifySiweMessage` (EOA offline recovery,
 *      or on-chain ERC-6492/1271 for smart accounts) — the recovered signer must equal the address;
 *   4. resolve the wallet's allowlist roles from the agent (server-only S2S);
 *   5. mint an httpOnly session cookie carrying {address, beta, admin}.
 * The single-use nonce cookie is CLEARED on EVERY outcome (success or failure) so a nonce can never
 * be retried after any verify attempt.
 *
 * NON-CUSTODY: proving control of a wallet authorizes NOTHING on-chain — the session is an access
 * token only. It never gates /exit, /trust, or withdraw (N2).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { base, baseSepolia, robinhoodTestnet } from "viem/chains";
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
  [robinhoodTestnet.id]: undefined, // §B3 — viem default RPC (rpc.testnet.chain.robinhood.com)
};

/** §B3 — the viem chain object per accepted chainId (used to build the verify client). */
const CHAIN_BY_ID = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [robinhoodTestnet.id]: robinhoodTestnet,
} as const;

/** Domain(s) this deployment will accept in a SIWE message — from a TRUSTED server env, never the
 * message body. Falls back to the proxy-set request host if unset (still not the message body). */
function allowedDomains(req: Request): string[] {
  const pinned = (process.env.SIWE_DOMAIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pinned.length) return pinned;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host ? [host] : [];
}

/**
 * Chain(s) this deployment accepts (§B3 — a SET, operator-approved chainId-in-set). Pin with a
 * comma-separated `SIWE_CHAIN_ID` (e.g. "84532,46630" on develop); a single value still works. When
 * unset, all supported nets are accepted: Base, Base Sepolia, Robinhood testnet.
 * ⚠️ If `SIWE_CHAIN_ID` is pinned to a single chain, login on the OTHERS is refused — set the full
 * set (or unset) to enable multi-network SIWE.
 */
function allowedChainIds(): number[] {
  const pinned = (process.env.SIWE_CHAIN_ID ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return pinned.length ? pinned : [base.id, baseSepolia.id, robinhoodTestnet.id];
}

export async function POST(req: Request): Promise<NextResponse> {
  const secure = isRequestSecure(req);
  // Every response clears the single-use nonce (success OR failure) so it can't be retried.
  const clearNonce = (res: NextResponse): NextResponse => {
    res.cookies.set(NONCE_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  };
  const bad = (error: string, status = 400): NextResponse =>
    clearNonce(NextResponse.json({ ok: false, error }, { status }));

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

  // Chain pinned to the deployment's network.
  if (!allowedChainIds().includes(chainId)) return bad("unsupported_chain");

  // Domain bound to the deployment (trusted config), never trusting the message's own claim blindly.
  const domains = allowedDomains(req);
  if (!parsed.domain || (domains.length > 0 && !domains.includes(parsed.domain))) {
    return bad("bad_domain");
  }

  // Require an expiration (viem's verify checks it against `time`; we also require it be present).
  if (!parsed.expirationTime) return bad("expiration_required");

  // §B3 — resolve the real viem chain for the message's chainId (allowlisted just above), so the
  // EIP-1271 verify client uses the correct network (EOA recovery is chain-agnostic; this keeps
  // smart-wallet verification correct on every supported chain).
  const chain = CHAIN_BY_ID[chainId as keyof typeof CHAIN_BY_ID] ?? baseSepolia;
  const client = createPublicClient({ chain, transport: http(RPC_URL[chainId]) });

  let valid = false;
  try {
    valid = await verifySiweMessage(client, {
      message,
      signature: signature as Hex,
      nonce,
      address,
      domain: parsed.domain, // already allowlisted above; verify also re-checks the field
      time: new Date(), // rejects an expired (or not-yet-valid) message
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
  return clearNonce(res);
}
