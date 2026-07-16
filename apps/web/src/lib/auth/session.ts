/**
 * Server session — an HMAC-signed, httpOnly session token (Phase B SIWE auth).
 *
 * After a wallet proves control via SIWE (nonce → sign → server verify), the server mints
 * this token carrying the VERIFIED wallet + its allowlist roles ({beta, admin}) resolved from
 * the agent's DB-backed allowlist at login time. The token is the source of truth for identity
 * everywhere server-side: the BFF derives X-Owner/X-Account from it (never from client headers),
 * and the middleware gates (app)/admin routes off its claims.
 *
 * Signed with Web Crypto (HMAC-SHA256) — NOT Node `crypto` — so the exact same verify runs in
 * the EDGE middleware and the Node route handlers. Format: `base64url(payloadJSON).base64url(sig)`.
 * Fail-closed: no `SESSION_SECRET` ⇒ no token can be minted or verified (nobody is authenticated).
 *
 * NON-CUSTODY: this is an ACCESS token only. It never carries a key or signing authority, and it
 * never gates /exit, /trust, or the on-chain withdraw path (N2) — those stay open to everyone.
 */

export const SESSION_COOKIE = "sp_session";
export const NONCE_COOKIE = "sp_siwe_nonce";

/** Session lifetime — 7 days; the wallet re-signs after expiry. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
/** SIWE nonce lifetime — a login must complete within 10 minutes of fetching the nonce. */
export const NONCE_TTL_SECONDS = 60 * 10;

export interface SessionClaims {
  /** The SIWE-verified wallet (lowercase 0x address). */
  readonly address: string;
  /** May enter the (app) shell (allowlist `beta`, or `admin` which implies beta). */
  readonly beta: boolean;
  /** May open /admin + call admin APIs (allowlist `admin`). */
  readonly admin: boolean;
  /** Issued-at (unix seconds). */
  readonly iat: number;
  /** Expiry (unix seconds). */
  readonly exp: number;
}

/** The signing secret (server-only). Fail-closed when unset. */
function getSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || null;
}

/**
 * Whether to mark cookies `Secure`, from the request protocol (we sit behind a TLS-terminating
 * proxy, so trust `x-forwarded-proto`). https ⇒ Secure; plain http (e.g. a bare-http dev/preview
 * host) ⇒ not Secure, so the SameSite=Lax session cookie still sets. Never downgrades https.
 */
export function isRequestSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();

/** Copy into a fresh ArrayBuffer — a `BufferSource` the Web Crypto typings accept across TS libs. */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asBufferSource(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Mint a signed session token for a SIWE-verified wallet. `address` is lowercased; roles are the
 * allowlist result resolved at login. Returns `null` (never throws) when no secret is configured.
 */
export async function signSession(input: {
  address: string;
  beta: boolean;
  admin: boolean;
}): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    address: input.address.toLowerCase(),
    beta: input.beta,
    admin: input.admin,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const key = await importKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, asBufferSource(encoder.encode(payload))),
  );
  return `${payload}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify + decode a session token. Returns the claims iff the signature is valid AND unexpired;
 * `null` for any tampering, malformation, missing secret, or expiry. Constant-time signature
 * check via `crypto.subtle.verify`.
 */
export async function verifySession(
  token: string | undefined | null,
  secretOverride?: string | null,
): Promise<SessionClaims | null> {
  // `secretOverride` lets the EDGE middleware pass a value it referenced directly (so Next inlines
  // it into the edge bundle at build) — the imported-module `process.env` read below is NOT reliably
  // inlined for edge, so middleware must hand the secret in. Node route callers omit it.
  const secret = secretOverride ?? getSecret();
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await importKey(secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      asBufferSource(base64UrlToBytes(sig)),
      asBufferSource(encoder.encode(payload)),
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as SessionClaims;
    if (typeof claims.address !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
