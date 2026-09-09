"use client";

/**
 * CapsMeter (T049) — the per-user / total / vault-deposit cap-utilisation meter.
 *
 * DISPLAY-ONLY. It turns the versioned policy caps (`@sparkpoint/shared/policy` via
 * the client policy mirror, src/lib/policy/mirror.ts) plus LIVE on-chain figures
 * (`totalAssets()` and the connected user's `convertToAssets(shares)` position, read
 * direct-RPC by the caller through useVault) into progress bars. It is a pure
 * presentational component: it holds no key, fetches nothing itself, and NEVER gates
 * anything — caps are enforced on-chain, and withdrawals are never cap-gated (N2).
 * The on-chain PolicyModule + ERC-4626 vault are the sole source of truth; these
 * numbers only LABEL what the chain enforces (see POLICY_MIRROR_DISCLAIMER).
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T049; policy-schema.md §4 (caps);
 * mirror.ts `describeCaps`/`capUtilization`.
 */

import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { capUtilization, describeCaps, formatTokenAmount, POLICY_MIRROR_DISCLAIMER } from "@/lib/policy/mirror";
import { liveCapRawFor, type TvlCapKey, type LiveVaultCaps } from "@/lib/policy/liveCaps";
import "@/components/screens/vault.css";

/** The TVL-relevant caps this meter can render (session caps are not TVL meters). Re-exported for callers. */
export type { TvlCapKey };

const DEFAULT_CAPS: readonly TvlCapKey[] = ["perUserTvl", "totalProtocol", "vaultDeposit"];

export interface CapsMeterProps {
  /** Chain whose policy caps to display (the vault's chain). */
  readonly chainId: number;
  /** Live `totalAssets()` (raw USDC base units) — drives the total/vault meters. */
  readonly totalAssets?: bigint;
  /** The connected user's live position value, `convertToAssets(shares)` — drives the per-user meter. */
  readonly userPosition?: bigint;
  /** Which caps to render, in order. Default: per-user, total protocol, vault deposit. */
  readonly caps?: readonly TvlCapKey[];
  /** Render the policy-mirror disclaimer footnote (default true). */
  readonly showDisclaimer?: boolean;
  /**
   * Live CapRegistry caps (US1) from `useVault` — the on-chain governance-settable per-user / total /
   * vault caps. Where a value is present it OVERRIDES the compile-time policy-mirror cap for that meter;
   * where absent (unresolved / CapRegistry not deployed) the mirror is used (honest, versioned fallback).
   */
  readonly liveCaps?: LiveVaultCaps;
}

/** Live "used" value for a cap key — `undefined` while loading / when disconnected (per-user). */
function usedFor(key: TvlCapKey, totalAssets?: bigint, userPosition?: bigint): bigint | undefined {
  switch (key) {
    case "perUserTvl":
      return userPosition;
    case "totalProtocol":
    case "vaultDeposit":
      return totalAssets;
  }
}

export function CapsMeter({
  chainId,
  totalAssets,
  userPosition,
  caps = DEFAULT_CAPS,
  showDisclaimer = true,
  liveCaps,
}: CapsMeterProps) {
  // getPolicyConstants is fail-closed (throws on unsupported chain). Callers only mount
  // this for a deployed vault (a supported chain); guard anyway so a bad chainId renders
  // nothing rather than crashing a display surface.
  let constants;
  try {
    constants = getPolicyConstants(chainId);
  } catch {
    return null;
  }
  const labels = describeCaps(chainId);
  const labelByKey = new Map(labels.map((c) => [c.key, c] as const));

  return (
    <div>
      {caps.map((key) => {
        const meta = labelByKey.get(key);
        const mirrorCap = constants.caps[key];
        if (meta === undefined) return null;

        // US1 — prefer the LIVE CapRegistry cap for this meter; fall back to the policy-mirror
        // TokenAmount when the on-chain read is unresolved / CapRegistry isn't deployed.
        const liveRaw = liveCaps ? liveCapRawFor(key, liveCaps) : undefined;
        const cap = liveRaw !== undefined ? { ...mirrorCap, amount: liveRaw } : mirrorCap;
        const capDisplay = formatTokenAmount(cap).display;

        const used = usedFor(key, totalAssets, userPosition);
        // capUtilization is display-only ratio math; only call it once the live "used" is known.
        const m = used !== undefined ? capUtilization(used, cap) : undefined;
        const pct = m?.pct ?? 0;

        return (
          <div key={key} style={{ marginBottom: 16 }}>
            <div className="card-hd" style={{ marginBottom: 8 }}>
              <span className="lbl" title={meta.description}>
                {meta.label}
              </span>
              <span className="tnum" style={{ fontSize: 12 }}>
                {used === undefined ? "—" : m?.used} / {capDisplay}
              </span>
            </div>
            <div className="capmeter">
              <i style={{ width: `${pct}%` }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>
              {used === undefined
                ? key === "perUserTvl"
                  ? "Connect your wallet to see your cap usage."
                  : "Reading the vault…"
                : `${m?.remaining} remaining.`}
            </div>
          </div>
        );
      })}

      {showDisclaimer && (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5, marginTop: 4 }}>
          {POLICY_MIRROR_DISCLAIMER}
        </div>
      )}
    </div>
  );
}
