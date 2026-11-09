"use client";

/**
 * The manual, page-side counterpart to Sparky's earn card.
 *
 * `/vault` is no longer a Robinhood-only or Aave-only board: this section reads the same 069/070/071
 * earn registry the chat uses and shows Morpho (Base/Ethereum), Kamino (Solana) and Rhea (NEAR) with
 * a chain filter. It is READ-ONLY. Every row names its protocol, chain and rail availability so a
 * missing rail is visible ("needs funded wallet / key"), never a vanishing badge. Preview opens the
 * matching dry preview in Sparky; external apps open only where a verified link exists.
 */

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useEarnVaults } from "@/lib/earn/useEarnVaults";
import { publicXchainEnabled, xchainReviewHref } from "@/lib/earn/xchain";
import {
  chainLabel,
  formatNetApy,
  formatTvl,
  previewPrompt,
  protocolLabel,
  protocolOf,
  railChips,
  snapshotAgeCopy,
  vaultAppUrl,
} from "@/lib/earn/format";
import type { EarnProtocol, EarnVault } from "@sparkpoint/shared/schemas";
import {
  kaminoLiveEnabledFromEnv,
  liveEarnHref,
  morphoLiveEnabledFromEnv,
  rheaLiveEnabledFromEnv,
} from "@/lib/earn/liveFlags";
import { findKaminoVault } from "@/lib/earn/kaminoLive";
import { findMorphoVault } from "@/lib/earn/morphoLive";

const MUTED = "var(--muted-foreground)";

const CHAINS: { key: string; label: string }[] = [
  { key: "all", label: "All chains" },
  { key: "base", label: "Base" },
  { key: "eth", label: "Ethereum" },
  { key: "sol", label: "Solana" },
  { key: "near", label: "NEAR" },
];

const PROTOCOL_COLOR: Record<EarnProtocol, string> = {
  morpho: "var(--info)",
  kamino: "var(--primary)",
  rhea: "var(--gain)",
};

function ProtocolBadge({ protocol }: { protocol: EarnProtocol }) {
  return (
    <span
      data-testid="earn-protocol"
      data-protocol={protocol}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".02em",
        color: PROTOCOL_COLOR[protocol],
        background: `color-mix(in srgb, ${PROTOCOL_COLOR[protocol]} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${PROTOCOL_COLOR[protocol]} 30%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {protocolLabel(protocol)}
    </span>
  );
}

function ChainBadge({ chain }: { chain: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        color: "var(--muted-foreground)",
        background: "var(--muted)",
        border: "1px solid var(--border-soft)",
        whiteSpace: "nowrap",
      }}
    >
      {chainLabel(chain)}
    </span>
  );
}

function RailChips({ vault }: { vault: EarnVault }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} data-testid="earn-rails">
      {railChips(vault).map((chip) => (
        <span
          key={chip.key}
          data-rail={chip.key}
          data-available={chip.available ? "true" : "false"}
          title={chip.available ? "Rail available in this build" : "This rail is not available yet — the preview says why"}
          style={{
            padding: "1px 6px",
            borderRadius: 6,
            fontSize: 10.5,
            lineHeight: 1.6,
            color: chip.available ? "var(--gain)" : MUTED,
            background: chip.available ? "color-mix(in srgb, var(--gain) 10%, transparent)" : "transparent",
            border: `1px solid ${chip.available ? "color-mix(in srgb, var(--gain) 26%, transparent)" : "var(--border-soft)"}`,
            whiteSpace: "nowrap",
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function liveProtocolFor(vault: EarnVault): "kamino" | "morpho" | "rhea" | null {
  const protocol = protocolOf(vault);
  // Only link to the one shared live flow when this exact registry row is on the curated
  // allowlist; otherwise the CTA would silently open a different vault/asset.
  if (
    protocol === "kamino" &&
    vault.chain === "sol" &&
    kaminoLiveEnabledFromEnv() &&
    findKaminoVault(vault.address) !== null
  ) {
    return "kamino";
  }
  if (
    protocol === "morpho" &&
    vault.chain === "base" &&
    morphoLiveEnabledFromEnv() &&
    findMorphoVault(vault.address) !== null
  ) {
    return "morpho";
  }
  // 078 — Rhea same-chain NEAR rail. Its /vault/live branch is server-gated too.
  if (protocol === "rhea" && vault.chain === "near" && rheaLiveEnabledFromEnv()) {
    return "rhea";
  }
  return null;
}

function VaultRow({ vault }: { vault: EarnVault }) {
  const protocol = protocolOf(vault);
  const appUrl = vaultAppUrl(vault);
  const previewHref = `${toHref("chat")}?ask=${encodeURIComponent(previewPrompt(vault))}`;
  const noRail = vault.rails.available.length === 0;
  // 079 — the cross-chain Rhea review entry point (071 MCA/1Click; NOT 078 same-chain).
  const xchainHref =
    protocol === "rhea" && publicXchainEnabled()
      ? xchainReviewHref({ chain: "near", origin: "base:USDC", vault: vault.address })
      : null;
  const liveProtocol = liveProtocolFor(vault);
  const liveHref = (mode: "deposit" | "withdraw") =>
    liveProtocol
      ? liveEarnHref({
          protocol: liveProtocol,
          chain: vault.chain,
          vault: vault.address,
          asset: vault.asset.symbol,
          mode,
        })
      : null;

  return (
    <div
      data-testid="earn-vault-row"
      data-protocol={protocol}
      data-chain={vault.chain}
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        padding: "10px 12px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{vault.name || vault.symbol || vault.address}</span>
            <ProtocolBadge protocol={protocol} />
            <ChainBadge chain={vault.chain} />
            {vault.curatedDefault && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--primary)" }}>Curated pick</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
            {vault.asset.symbol} · {vault.symbol || vault.address}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 10, color: MUTED }}>net APY ({protocolLabel(protocol)})</div>
          <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">
            {formatNetApy(vault.netApy)}
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>TVL {formatTvl(vault.tvlUsd)}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <RailChips vault={vault} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {liveHref("deposit") && (
            <>
              <a className="btn btn-primary btn-sm" href={liveHref("deposit")!} data-testid="earn-live-deposit">
                Live deposit
              </a>
              <a className="btn btn-outline btn-sm" href={liveHref("withdraw")!} data-testid="earn-live-withdraw">
                Live withdraw
              </a>
            </>
          )}
          <a className="btn btn-outline btn-sm" href={previewHref}>
            <Icon name="chat" size={13} /> Preview in Sparky
          </a>
          {xchainHref && (
            <a
              className="btn btn-outline btn-sm"
              href={xchainHref}
              data-testid="earn-rhea-xchain-review"
            >
              Review cross-chain deposit
            </a>
          )}
          {appUrl && (
            <a className="btn btn-ghost btn-sm" href={appUrl} target="_blank" rel="noopener noreferrer">
              Open {protocolLabel(protocol)} <Icon name="ext" size={11} />
            </a>
          )}
        </div>
      </div>
      {noRail && (
        <div style={{ fontSize: 11.5, color: "var(--caution)", lineHeight: 1.45 }}>
          No enabled rail in this build yet — this is an honest unavailable state, not a funded-wallet
          prompt. The dry preview explains which rail is missing.
        </div>
      )}
    </div>
  );
}

export function EarnAcrossChains() {
  const { vaults, snapshot, loading, error, online, refetch } = useEarnVaults();
  const [chain, setChain] = useState("all");

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: vaults.length, base: 0, eth: 0, sol: 0, near: 0 };
    for (const vault of vaults) map[vault.chain] = (map[vault.chain] ?? 0) + 1;
    return map;
  }, [vaults]);

  const shown = useMemo(() => {
    if (chain !== "all") return vaults.filter((vault) => vault.chain === chain).slice(0, 30);
    // The live registry can hold 100+ Morpho vaults, which would bury Kamino/Rhea many screens
    // down. Keep the all-chains view to the top five per protocol; a chain chip shows the rest.
    const perProtocol: Record<string, number> = {};
    return vaults.filter((vault) => {
      const protocol = protocolOf(vault);
      perProtocol[protocol] = (perProtocol[protocol] ?? 0) + 1;
      return perProtocol[protocol] <= 5;
    });
  }, [chain, vaults]);

  const snapshotText = snapshot
    ? snapshotAgeCopy(snapshot.ageMinutes, snapshot.source, null)
    : "loading the stored snapshot";

  return (
    <section className="card card-pad" data-testid="earn-across-chains" style={{ marginBottom: 18 }}>
      <div className="card-hd" style={{ alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className="t">Earn across chains</span>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.55, maxWidth: 720 }}>
            Morpho on Base/Ethereum, Kamino on Solana and Rhea on NEAR — the same registry Sparky
            reads. Rows are previews; where a live direct rail is flagged on, the row links to the
            one shared review+confirm flow. Nothing signs or sends from this page.
          </div>
        </div>
        <span className="lbl" data-testid="earn-snapshot" title="Stored registry snapshot — never a live quote">
          {snapshotText}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }} data-testid="earn-chain-filters">
        {CHAINS.map((option) => {
          const count = counts[option.key] ?? 0;
          const active = chain === option.key;
          return (
            <button
              key={option.key}
              type="button"
              className={`pill${active ? "" : " ghosty"}`}
              aria-pressed={active}
              onClick={() => setChain(option.key)}
              title={`${count} vault${count === 1 ? "" : "s"} on ${option.label}`}
              style={{ fontSize: 11.5, cursor: "pointer", opacity: count === 0 && option.key !== "all" ? 0.55 : 1 }}
            >
              {option.label}
              <span className="mono" style={{ fontSize: 10.5 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {!online ? (
        <div className="muted" style={{ padding: "12px 0", fontSize: 13 }} data-testid="earn-offline">
          Sign in to read the multi-chain earn registry. Nothing here moves funds.
        </div>
      ) : loading ? (
        <div className="muted" style={{ padding: "12px 0", fontSize: 13 }} data-testid="earn-loading">
          Reading Morpho, Kamino and Rhea vaults…
        </div>
      ) : error ? (
        <div data-testid="earn-error" style={{ padding: "8px 0", fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 600 }}>The multi-chain earn read didn&apos;t complete</div>
          <div style={{ color: MUTED, marginTop: 4 }}>{error}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={refetch} type="button">
            Retry
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0", fontSize: 13 }} data-testid="earn-empty">
          {vaults.length === 0
            ? "No earn vaults are available from the registry right now. This is the honest empty state — nothing is hidden."
            : `No ${chainLabel(chain)} vaults in the current registry snapshot. Pick another chain to see the rest.`}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }} data-testid="earn-vault-list">
          {shown.map((vault) => (
            <VaultRow key={`${vault.chain}:${vault.address}`} vault={vault} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
        {chain === "all" && vaults.length > shown.length
          ? "Showing the top five per protocol. Pick a chain chip to see more. "
          : ""}
        Deposits need a funded wallet on the origin chain and a live rail. Where a rail is missing the
        row says so instead of hiding the vault; Sparky&apos;s preview names the exact reason.
      </div>
    </section>
  );
}
