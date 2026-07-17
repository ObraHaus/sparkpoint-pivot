"use client";

/**
 * Beta whitelist gate (T047) — CLIENT, DEPOSIT-ONLY.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ THIS GATE GOVERNS THE DEPOSIT / TRANSACTING PATH ONLY.                       │
 * │ It MUST NEVER sit on the withdraw path, /exit, or /trust — those stay OPEN   │
 * │ to everyone, always (non-custody law, N2: withdraw-is-sacred). By            │
 * │ construction this module is imported ONLY by deposit/transact surfaces; the  │
 * │ exit + trust routes import neither `useBeta` nor `BetaGate`. Nothing here    │
 * │ reads or blocks chain state — a "not enabled" wallet can still withdraw its  │
 * │ full position on-chain via /exit while this gate says it can't deposit.      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * AUTHORITY: the SERVER session's `beta` claim (resolved at SIWE login from the agent's DB-backed
 * allowlist) is the source of truth, enforced by the route middleware + BFF. This client hook only
 * mirrors it for the deposit UI. There is deliberately NO client-side address allowlist: the old
 * `NEXT_PUBLIC_BETA_ALLOWLIST` shipped allowlisted wallet addresses in the public bundle (a privacy
 * leak once a real client is added), so it was removed. The client default is permissive
 * (deposit form shows) until the session resolves — the server + middleware do the real gating.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T047 (beta whitelist +
 * per-user-cap gate; NEVER gates /exit).
 */

import { useAccount } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { type Address } from "viem";
import { useSession } from "@/lib/auth/useSiwe";

/** Why the deposit/transact path is closed for this wallet (drives BetaGate copy). */
export type BetaBlockReason = { kind: "geo_blocked" } | { kind: "not_allowlisted" };

export interface BetaStatus {
  /** The connected account under evaluation (`undefined` when no wallet is connected). */
  readonly address: Address | undefined;
  /** The resolved chain (`undefined` when disconnected). */
  readonly chainId: number | undefined;
  readonly isConnected: boolean;
  /** True on Base Sepolia (84532) — the testnet MVP is default-permissive. */
  readonly isTestnet: boolean;
  /**
   * The beta program admits this wallet for NEW DEPOSITS (allowlisted, or on testnet,
   * or no allowlist configured → open). Never affects withdrawals.
   */
  readonly enabled: boolean;
  /** Jurisdiction/geo check passed. Placeholder (no compliance backend yet) → always true. */
  readonly geoAllowed: boolean;
  /**
   * THE single gate the deposit/transact surfaces consume: `enabled && geoAllowed`.
   * Deliberately does NOT require a connected wallet (that requirement belongs to
   * wallet-auth + the on-chain signer, not the beta gate) — so a disconnected visitor
   * with no allowlist configured still sees the deposit form exactly as designed.
   * NEVER consult this on the withdraw/exit/trust path.
   */
  readonly canTransact: boolean;
  /** Why `canTransact` is false (`null` when it is true). */
  readonly reason: BetaBlockReason | null;
}

/** Base Sepolia — the testnet MVP chain that is always open to transact (84532). */
const TESTNET_CHAIN_ID: number = baseSepolia.id;

/**
 * Geo/jurisdiction check. Placeholder until a compliance backend exists — structurally
 * present so it is trivially swappable. TODO(W6): resolve from the backend /beta-status
 * response (or a geo-IP edge check) keyed by the connecting wallet.
 */
function checkGeoAllowed(_address: Address | undefined): boolean {
  return true;
}

/**
 * Pure eligibility derivation (no React) — the SWAP SEAM. Replace the body with a
 * backend `/beta-status` result keyed by `address`; the {@link BetaStatus} return
 * shape stays identical, so callers never change.
 */
export function computeBetaStatus(input: {
  address?: Address;
  chainId?: number;
  isConnected?: boolean;
}): BetaStatus {
  const { address, chainId } = input;
  const isConnected = input.isConnected ?? address !== undefined;
  const isTestnet = chainId === TESTNET_CHAIN_ID;

  // Client default is PERMISSIVE — there is no client-side allowlist (the server session's `beta`
  // claim + the route middleware are authoritative). This value is only used pre-session (loading /
  // not signed in); `useBeta` overrides it with the server claim the moment a session exists.
  const enabled = true;
  const geoAllowed = checkGeoAllowed(address);
  const canTransact = enabled && geoAllowed;

  const reason: BetaBlockReason | null = canTransact
    ? null
    : !geoAllowed
      ? { kind: "geo_blocked" }
      : { kind: "not_allowlisted" };

  return { address, chainId, isConnected, isTestnet, enabled, geoAllowed, canTransact, reason };
}

/**
 * useBeta — the connected wallet's beta transacting eligibility.
 *
 * DEPOSIT-ONLY GATE. Deposit/transact surfaces read `canTransact` to decide whether to
 * render the amount form or <BetaGate/>. It NEVER gates /exit, /trust, or the withdraw
 * path — those import neither this hook nor BetaGate (non-custody law, N2).
 *
 * Phase B: when a SIWE session exists, the SERVER session's `beta` claim (resolved from the
 * agent's DB-backed allowlist at login) is AUTHORITATIVE — the client `computeBetaStatus`
 * default is used only while the session is still loading or when nobody is signed in. The
 * route-level middleware is the primary enforcement; this keeps the deposit UI consistent with it.
 */
export function useBeta(): BetaStatus {
  const { address, chainId, isConnected } = useAccount();
  const { session } = useSession();
  const base = computeBetaStatus({ address, chainId, isConnected });
  if (!session) return base; // undefined (loading) or null (not signed in) → client default
  const enabled = session.beta;
  const canTransact = enabled && base.geoAllowed;
  return {
    ...base,
    enabled,
    canTransact,
    reason: canTransact ? null : { kind: "not_allowlisted" },
  };
}
