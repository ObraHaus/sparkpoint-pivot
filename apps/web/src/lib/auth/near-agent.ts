import "server-only";

/**
 * 076 — server-only S2S calls for the NEAR login nonce.
 *
 * The nonce lives in the agent's Postgres (single-use across workers), not in the cookie alone.
 * Fail-closed: a missing agent config or any error returns null and the login cannot start/finish.
 */

const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;
const TIMEOUT_MS = 5_000;

export interface IssuedNearNonce {
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

function base(): string | null {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return null;
  return AGENT_INTERNAL_URL.replace(/\/+$/, "");
}

function headers(): HeadersInit {
  return {
    authorization: `Bearer ${AGENT_S2S_TOKEN}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

export async function issueNearNonce(): Promise<IssuedNearNonce | null> {
  const root = base();
  if (!root) return null;
  try {
    const resp = await fetch(`${root}/auth/near/nonce`, {
      method: "POST",
      headers: headers(),
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<IssuedNearNonce>;
    if (
      typeof data.nonce !== "string" ||
      typeof data.issuedAt !== "string" ||
      typeof data.expiresAt !== "string"
    ) {
      return null;
    }
    return { nonce: data.nonce, issuedAt: data.issuedAt, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

export interface ConsumedNearNonce {
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export async function consumeNearNonce(nonce: string): Promise<ConsumedNearNonce | null> {
  const root = base();
  if (!root) return null;
  try {
    const resp = await fetch(`${root}/auth/near/consume`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ nonce }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      ok?: unknown;
      issuedAt?: unknown;
      expiresAt?: unknown;
    };
    if (data.ok !== true) return null;
    if (typeof data.issuedAt !== "string" || typeof data.expiresAt !== "string") return null;
    return { issuedAt: data.issuedAt, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}
