"use client";

/**
 * NonCustodyBadge (T049) — the DISPLAY-ONLY trust panel for the vault surface.
 *
 * Reads the LIVE vault directly over RPC (via useVault → wagmi transport; no agent,
 * no backend) and renders, from on-chain truth:
 *   • the canonical performance-fee disclosure (agent-service-api.md §3.7, verbatim);
 *   • the 0-management / profit-only framing with the LIVE `performanceFeeBps` and the
 *     20% immutable hard cap (`MAX_PERFORMANCE_FEE_BPS`);
 *   • the beta caps meter (per-user / total / vault) via <CapsMeter/> + the policy mirror;
 *   • the provable-on-chain fee recipient + high-water mark;
 *   • a prominent self-custodial line: "withdraw anytime, even while paused", linking /exit.
 *
 * It NEVER gates anything. There are no disabled states, no whitelist checks, and it is
 * never on the withdraw/exit path (N1/N2). The chain re-checks every action at sign time;
 * this panel only labels what the chain enforces. Fail-closed: when the vault isn't
 * deployed on the resolved chain, the static trust copy still renders and the live block
 * degrades to a plain notice — no fabricated numbers.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T049 & T109; agent-service-api.md §3.7.
 */

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { stageCopy } from "@/lib/stage";
import { formatBps } from "@/lib/policy/mirror";
import { useVault } from "@/lib/chain/useVault";
import { CapsMeter } from "@/components/CapsMeter";
import {
  PERFORMANCE_FEE_DISCLOSURE,
  feeBasisShortLabel,
  feeCapEnforcementLabel,
  performanceFeeDisclosure,
} from "@/lib/policy/feeCopy";

/**
 * Re-exported for existing consumers; the canonical string now lives in the dependency-free
 * `@/lib/policy/feeCopy` so the deposit confirm gate (a lib hook) can reuse it without a
 * lib→component import. Rendered VERBATIM (agent-service-api.md §3.7).
 */
export { PERFORMANCE_FEE_DISCLOSURE };

const WAD = 1_000_000_000_000_000_000n;

/** WAD (1e18) share-price → decimal string with 4 dp (display only). */
function formatWad(x: bigint): string {
  const whole = x / WAD;
  const frac = ((x % WAD) * 10_000n) / WAD;
  return `${whole.toString()}.${frac.toString().padStart(4, "0")}`;
}

/** Truncated address for a provable-on-chain reference (display only). */
function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Performance-fee bounds from the policy SoT for `chainId`, with a safe fallback. */
function govBounds(chainId: number | undefined): { defaultBps: number; ceilingBps: number } {
  if (chainId === undefined) return { defaultBps: 1000, ceilingBps: 2000 };
  try {
    return getPolicyConstants(chainId).governance.performanceFee;
  } catch {
    return { defaultBps: 1000, ceilingBps: 2000 };
  }
}

export interface NonCustodyBadgeProps {
  /** Chain to verify against (defaults to the connected wallet's chain). */
  readonly chainId?: number;
}

export function NonCustodyBadge({ chainId }: NonCustodyBadgeProps) {
  const v = useVault({ chainId });
  const bounds = govBounds(v.chainId);

  const feePct = v.performanceFeeBps !== undefined ? formatBps(v.performanceFeeBps) : formatBps(bounds.defaultBps);
  const maxFeePct =
    v.maxPerformanceFeeBps !== undefined ? formatBps(v.maxPerformanceFeeBps) : formatBps(bounds.ceilingBps);

  return (
    <div className="card card-pad">
      <div className="card-hd">
        <span className="lbl">Non-custodial by construction</span>
        <span className="pill ghosty" style={{ cursor: "default" }}>
          <Icon name="shieldcheck" size={13} /> On-chain verified
        </span>
      </div>

      {/* Prominent self-custody line — always renders, links the public escape hatch. */}
      <div
        style={{
          display: "flex",
          gap: 9,
          alignItems: "flex-start",
          fontSize: 13.5,
          lineHeight: 1.5,
          marginTop: 12,
        }}
      >
        <span style={{ color: "var(--primary)", marginTop: 1 }}>
          <Icon name="lock" size={16} />
        </span>
        <span>
          <b style={{ color: "var(--foreground)" }}>Self-custodial — withdraw anytime, even while deposits are paused.</b>{" "}
          SparkPoint holds no key that can move your funds, and withdrawals are never pausable (N2).{" "}
          <Link className="cite" href={toHref("exit")} style={{ display: "inline-flex" }}>
            Exit on-chain <Icon name="ext" size={11} />
          </Link>
        </span>
      </div>

      {v.paused === true && (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--caution)",
            marginTop: 10,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          <Icon name="alert" size={13} /> Deposits are currently paused — your withdrawal still works, as guaranteed.
        </div>
      )}

      <div className="divider" />

      {/* Fee framing — live rate, hard cap, verbatim disclosure. */}
      <div className="card-hd">
        <span className="lbl">0-management · profit-only performance fee</span>
        <span className="tnum" style={{ fontSize: 13 }}>
          {feePct} of yield
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.55, marginTop: 8 }}>
        {feePct} of yield, charged only {feeBasisShortLabel(v.feeBasis)} — 0% on your principal, and 0% management,
        entry, and exit fees. Hard cap {maxFeePct} ({feeCapEnforcementLabel(v.feeBasis)}).
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--muted-foreground)",
          lineHeight: 1.55,
          marginTop: 10,
          padding: "10px 12px",
          background: "var(--background)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius)",
        }}
      >
        {performanceFeeDisclosure(v.feeBasis)}
      </div>

      {/* Provable-on-chain references (only when the live reads have resolved). */}
      {(v.highWaterMark !== undefined || v.feeRecipient !== undefined) && (
        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.6 }}>
          {v.highWaterMark !== undefined && (
            <span>
              High-water mark <span className="tnum">{formatWad(v.highWaterMark)}</span> (price/share)
            </span>
          )}
          {v.highWaterMark !== undefined && v.feeRecipient !== undefined && " · "}
          {v.feeRecipient !== undefined && (
            <span>
              Fee recipient <span className="tnum">{shortAddress(v.feeRecipient)}</span>
            </span>
          )}
          {" · provable on-chain"}
        </div>
      )}

      <div className="divider" />

      {/* Beta caps — display-only meter. Never gates; withdrawals are never cap-gated (N2). */}
      <div className="card-hd" style={{ marginBottom: 12 }}>
        <span className="lbl">{stageCopy.label} caps</span>
      </div>
      {v.isDeployed && v.chainId !== undefined ? (
        <CapsMeter
          chainId={v.chainId}
          totalAssets={v.totalAssets}
          userPosition={v.underlying}
          liveCaps={{ perUserCap: v.perUserCap, totalCap: v.totalCap, vaultCap: v.vaultCap }}
        />
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          Live on-chain verification of the vault isn&rsquo;t available on this network yet.
          Your funds and the caps are always provable on-chain.
        </div>
      )}
    </div>
  );
}
