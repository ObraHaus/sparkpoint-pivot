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

function s2sHeaders(address: string, chainId: number): HeadersInit {
  return {
    authorization: `Bearer ${AGENT_S2S_TOKEN}`,
    accept: "application/json",
    "x-account": address,
    "x-owner": address,
    "x-chain-id": String(chainId),
  };
}

export async function fetchAllowlistStatus(
  address: string,
  chainId: number,
): Promise<AllowlistStatus | null> {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return null;
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${base}/allowlist/status`, {
      headers: s2sHeaders(address, chainId),
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { beta?: unknown; admin?: unknown };
    return { beta: Boolean(data.beta), admin: Boolean(data.admin) };
  } catch {
    return null;
  }
}

/**
 * 026 — ask the agent to run the Ethereum-mainnet SRK auto-gate for this wallet and, if it holds
 * at least the threshold, add it to the beta allowlist. Called at SIWE login for a wallet that
 * came back `beta: false`, BEFORE the session cookie is minted, so a qualifying holder gets in on
 * the same login rather than the next one.
 *
 * FAIL-OPEN, deliberately the mirror of `fetchAllowlistStatus`'s fail-closed posture: that one
 * refuses a login rather than mint unverifiable roles, whereas this one only ever ADDS access, so
 * every failure (unset gate, RPC down, agent unreachable) returns `false` and the wallet simply
 * sees the application form. It must never be able to block a login.
 */
export async function runSrkMainnetGate(address: string, chainId: number): Promise<boolean> {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return false;
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${base}/allowlist/srk-gate-check`, {
      method: "POST",
      headers: s2sHeaders(address, chainId),
      cache: "no-store",
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { qualified?: unknown; granted?: unknown };
    // `granted` (not just `qualified`) — a qualifying wallet whose allowlist write failed is NOT
    // yet in the beta list, so re-resolving its status would still say false.
    return Boolean(data.qualified) && Boolean(data.granted);
  } catch {
    return false;
  }
}
