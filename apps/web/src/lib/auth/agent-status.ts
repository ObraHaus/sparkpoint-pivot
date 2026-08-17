import "server-only";

/**
 * Server-side resolver for a wallet's allowlist roles, read from the agent's DB-backed allowlist
 * (`GET /allowlist/status`). Called ONLY at SIWE login to bake {beta, admin} into the session
 * token — never from the client. Uses the same server-only S2S bearer + internal URL as the BFF.
 *
 * Fail-closed: a missing config or any agent error returns `null` (login is refused with a 503,
 * so we never mint a session whose roles we could not actually verify).
 *
 * ⚠️ EVERY call here is BLOCKING THE USER'S LOGIN. `fetch` has no default timeout, so an agent that
 * accepts the connection and then goes quiet would hang `/verify` for as long as it liked — which
 * is exactly what alpha was doing (~20s stalls, while the button still said "Waiting for
 * signature…"). Both calls therefore carry an explicit `AbortSignal.timeout`. These are ceilings on
 * a hung peer, not latency targets: the healthy path is well under a second.
 */

const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

/** Roles are fail-CLOSED, so this one gets room to answer — refusing a login on a slow-but-alive
 *  agent is worse than waiting a moment. Still bounded: a hang must not be indefinite. */
const STATUS_TIMEOUT_MS = 5_000;

/** The SRK gate is fail-OPEN and the agent already enforces its own ~3s budget; this is only the
 *  outer backstop for the agent itself going quiet. Kept just above the agent's budget so a real
 *  gate answer is never cut off by the caller that asked for it. */
const GATE_TIMEOUT_MS = 4_000;

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
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
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
 * every failure (unset gate, RPC down, agent unreachable) returns `granted: false` and the wallet
 * simply sees the application form. It must never be able to block a login.
 *
 * `reason` is carried back so the form can tell the two silences apart: a wallet that genuinely
 * holds too little SRK ("below_threshold") is a settled answer, whereas one we never managed to
 * read ("timed_out") is not — and only the latter is worth inviting the user to retry.
 */
export interface SrkGateOutcome {
  /** True only when the wallet qualified AND the allowlist write succeeded. */
  readonly granted: boolean;
  /** The agent's machine-readable reason, or null when we never got an answer at all. */
  readonly reason: string | null;
}

export async function runSrkMainnetGate(
  address: string,
  chainId: number,
): Promise<SrkGateOutcome> {
  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) return { granted: false, reason: null };
  const base = AGENT_INTERNAL_URL.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${base}/allowlist/srk-gate-check`, {
      method: "POST",
      headers: s2sHeaders(address, chainId),
      cache: "no-store",
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
    if (!resp.ok) return { granted: false, reason: null };
    const data = (await resp.json()) as {
      qualified?: unknown;
      granted?: unknown;
      reason?: unknown;
    };
    // `granted` (not just `qualified`) — a qualifying wallet whose allowlist write failed is NOT
    // yet in the beta list, so re-resolving its status would still say false.
    return {
      granted: Boolean(data.qualified) && Boolean(data.granted),
      reason: typeof data.reason === "string" ? data.reason : null,
    };
  } catch {
    // Includes the AbortSignal timeout above: the agent went quiet, so the balance is UNKNOWN
    // rather than known-insufficient — surfaced as "timed_out" so the form can offer a retry.
    return { granted: false, reason: "timed_out" };
  }
}
