import "server-only";

/**
 * Server-side resolver for a wallet's allowlist roles, read from the agent's DB-backed allowlist
 * (`GET /allowlist/status`). Called ONLY at SIWE login to bake {beta, admin} into the session
 * token — never from the client. Uses the same server-only S2S bearer + internal URL as the BFF.
 *
 * Fail-closed: a missing config or any agent error returns `null` (login is refused with a 503,
 * so we never mint a session whose roles we could not actually verify).
 */

const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

export interface AllowlistStatus {
  readonly beta: boolean;
  readonly admin: boolean;
}

export async function fetchAllowlistStatus(
  address: string,
  chainId: number,
): Promise<AllowlistStatus | null> {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return null;
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${base}/allowlist/status`, {
      headers: {
        authorization: `Bearer ${AGENT_S2S_TOKEN}`,
        accept: "application/json",
        "x-account": address,
        "x-owner": address,
        "x-chain-id": String(chainId),
      },
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { beta?: unknown; admin?: unknown };
    return { beta: Boolean(data.beta), admin: Boolean(data.admin) };
  } catch {
    return null;
  }
}
