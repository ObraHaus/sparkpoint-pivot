"use client";

/**
 * 077 — protocol switch for the shared live earn route.
 *
 * The flags are OFF by default: with no `NEXT_PUBLIC_EARN_LIVE_*` the route says so plainly and
 * offers no wallet action. When on, it renders the Kamino (Solana) or Morpho (Base) flow and
 * keeps the same review → explicit wallet confirm shape for both.
 */

import Link from "next/link";

import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import {
  protocolLiveEnabled,
  type LiveEarnMode,
  type LiveEarnProtocol,
} from "@/lib/earn/liveFlags";
import { findKaminoVault } from "@/lib/earn/kaminoLive";
import { findMorphoVault } from "@/lib/earn/morphoLive";
import { KaminoLiveFlow } from "@/components/vault/KaminoLiveFlow";
import { MorphoLiveFlow } from "@/components/vault/MorphoLiveFlow";

const MUTED = "var(--muted-foreground)";

export interface LiveEarnFlowProps {
  readonly protocol: LiveEarnProtocol;
  readonly vault: string | null;
  readonly chain: string | null;
  readonly asset: string | null;
  readonly mode: LiveEarnMode;
  readonly initialAmount: string | null;
}

function Notice({ children, tone = "caution" }: { children: React.ReactNode; tone?: "caution" | "info" }) {
  const c = tone === "caution" ? "var(--caution)" : "var(--info)";
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: c,
        background: `color-mix(in srgb, ${c} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, transparent)`,
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      {children}
    </div>
  );
}

export function LiveEarnFlow({ protocol, vault, chain, asset, mode, initialAmount }: LiveEarnFlowProps) {
  const enabled = protocolLiveEnabled(protocol);

  if (!enabled) {
    return (
      <div className="card card-pad" data-testid="live-earn-disabled">
        <div style={{ fontSize: 15, fontWeight: 600 }}>Live {protocol === "kamino" ? "Kamino" : "Morpho"} earn isn&apos;t available right now</div>
        <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
          Live deposits aren&apos;t available here yet. The{" "}
          <Link href={toHref("vault")} style={{ color: "var(--primary)" }}>
            Vault page
          </Link>{" "}
          still shows the vault and its preview; nothing is signed or sent.
        </div>
      </div>
    );
  }

  if (protocol === "kamino") {
    const unknown = vault !== null && vault !== "" && findKaminoVault(vault) === null;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {unknown && (
          <Notice>
            This vault isn&apos;t available for live deposits here yet. Pick one of the curated
            vaults below; the other option stays a preview.
          </Notice>
        )}
        <KaminoLiveFlow
          vault={unknown ? null : vault}
          mode={mode}
          initialAmount={initialAmount}
        />
      </div>
    );
  }

  const unknown = vault !== null && vault !== "" && findMorphoVault(vault) === null;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {unknown && (
        <Notice>
          This vault isn&apos;t available for live deposits here yet. Pick the curated vault
          below; the other option stays a preview.
        </Notice>
      )}
      <MorphoLiveFlow
        vault={unknown ? null : vault}
        chain={chain}
        asset={asset}
        mode={mode}
        initialAmount={initialAmount}
      />
      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
        <Icon name="info" size={12} /> Live Morpho deposits are available on Base. Cross-chain
        options are previews in Sparky for now.
      </div>
    </div>
  );
}
