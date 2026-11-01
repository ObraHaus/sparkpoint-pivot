"use client";

/**
 * 069/070 — the earn vault list card, rendered inline in Sparky's thread.
 *
 * It is a READ-ONLY table of the snapshot the agent already has: name, protocol + chain badges,
 * asset, TVL, net APY (labelled "net APY (Morpho|Kamino)") and the three honest rails. A `null`
 * TVL/APY renders as an em dash — the card never fabricates a figure. Kamino rows say their 1Click
 * receipt is the "native vault shares"; Morpho rows say "1Click receipt (wrapper)". "Preview" only
 * sends a normal chat message; there is no calldata, no signature and no transaction anywhere on
 * this card. "View on Morpho" is an external link, only for Morpho rows.
 *
 * `state="unavailable"` is an ordinary answer (an empty/failed snapshot), never an error card.
 */

import type { EarnVault, EarnVaultsBlock } from "@sparkpoint/shared/schemas";

import { Icon } from "@/lib/icons";
import {
  apyLabel,
  chainLabel,
  formatNetApy,
  formatTvl,
  previewPrompt,
  protocolLabel,
  protocolOf,
  protocolsOf,
  railChips,
  snapshotAgeCopy,
  vaultAppUrl,
  vaultListTitle,
  vaultReceiptLabel,
  vaultRowTitle,
} from "@/lib/earn/format";

const MUTED = "var(--muted-foreground)";

function ChainBadge({ chain }: { chain: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: ".02em",
        color: "var(--info)",
        background: "color-mix(in srgb, var(--info) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--info) 28%, transparent)",
        whiteSpace: "nowrap",
      }}
    >
      {chainLabel(chain)}
    </span>
  );
}

function ProtocolBadge({ vault }: { vault: EarnVault }) {
  const protocol = protocolOf(vault);
  return (
    <span
      data-testid="earn-protocol"
      data-protocol={protocol}
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: ".02em",
        color: protocol === "morpho" ? "var(--muted-foreground)" : "var(--primary)",
        background:
          protocol === "morpho"
            ? "transparent"
            : "color-mix(in srgb, var(--primary) 12%, transparent)",
        border: `1px solid ${
          protocol === "morpho"
            ? "var(--border-soft)"
            : "color-mix(in srgb, var(--primary) 28%, transparent)"
        }`,
        whiteSpace: "nowrap",
      }}
    >
      {protocolLabel(protocol)}
    </span>
  );
}

function RailChips({ vault }: { vault: EarnVault }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {railChips(vault).map((chip) => (
        <span
          key={chip.key}
          data-rail={chip.key}
          data-available={chip.available ? "true" : "false"}
          style={{
            padding: "1px 6px",
            borderRadius: 6,
            fontSize: 10.5,
            lineHeight: 1.6,
            color: chip.available ? "var(--gain)" : MUTED,
            background: chip.available
              ? "color-mix(in srgb, var(--gain) 10%, transparent)"
              : "transparent",
            border: `1px solid ${
              chip.available ? "color-mix(in srgb, var(--gain) 26%, transparent)" : "var(--border-soft)"
            }`,
            whiteSpace: "nowrap",
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 1 }} className="tnum">
        {value}
      </div>
    </div>
  );
}

export function EarnVaultsCard({
  block,
  onSend,
}: {
  block: EarnVaultsBlock;
  /** Send a follow-up chat message (the row's Preview action). Omitted → no button is shown. */
  onSend?: (text: string) => void;
}) {
  const protocols = protocolsOf(block.vaults);
  const singleProtocol = protocols.length === 1 ? protocols[0] : null;
  const snapshot = snapshotAgeCopy(
    block.snapshotAgeMinutes,
    block.snapshotSource,
    protocols.length > 1 ? null : singleProtocol,
  );
  const title = vaultListTitle(block.vaults);
  const count = block.vaults.length;
  const apyAttribution = singleProtocol ? `${protocolLabel(singleProtocol)}'s` : "each protocol's";

  return (
    <div className="ccard cf-card" data-card="earn-vaults" data-state={block.state} style={{ padding: 0, overflow: "hidden", maxWidth: 640 }}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {block.state === "ready" ? `${count} vault${count === 1 ? "" : "s"}` : "Unavailable"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }} data-testid="earn-snapshot">
          {snapshot}. Net APY is {apyAttribution} figure, shown as-is.
        </div>
      </div>

      {block.state === "unavailable" ? (
        <div className="cf-sec" data-testid="earn-vaults-unavailable">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>No vault list right now</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
            {block.unavailableReason ?? "The vault snapshot is empty."} Nothing was signed or sent.
          </div>
        </div>
      ) : (
        <div className="cf-sec" data-testid="earn-vaults-list" style={{ display: "grid", gap: 10 }}>
          {block.vaults.map((vault) => {
            const prompt = previewPrompt(vault);
            const receipt = vaultReceiptLabel(vault);
            const link = vaultAppUrl(vault);
            const protocol = protocolOf(vault);
            const sourceUrl = protocol === "rhea" ? link : null;
            return (
              <div
                key={`${vault.chain}:${vault.address}`}
                data-testid="earn-vault-row"
                data-curated={vault.curatedDefault ? "true" : "false"}
                style={{
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  padding: "10px 11px",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{vaultRowTitle(vault)}</span>
                      <ProtocolBadge vault={vault} />
                      <ChainBadge chain={vault.chain} />
                      {vault.curatedDefault && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--primary)" }}>Curated pick</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                      {vault.asset.symbol} · {vault.symbol}
                    </div>
                    {receipt && (
                      <div
                        data-testid="earn-receipt-kind"
                        style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}
                      >
                        1Click delivers {receipt}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 10, color: MUTED }}>{apyLabel(protocol)}</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">
                      {formatNetApy(vault.netApy)}
                    </div>
                    {sourceUrl && (
                      <a
                        data-testid="earn-vault-source"
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10.5,
                          color: MUTED,
                          textDecoration: "underline",
                        }}
                      >
                        source <Icon name="ext" size={10} />
                      </a>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                  <Stat label="TVL" value={formatTvl(vault.tvlUsd)} />
                  <RailChips vault={vault} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {onSend && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      data-testid="earn-vault-preview"
                      onClick={() => onSend(prompt)}
                    >
                      Preview
                    </button>
                  )}
                  {link && (
                    <a
                      data-testid="earn-vault-link"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--primary)",
                        textDecoration: "none",
                      }}
                    >
                      View on {protocolLabel(protocol)} <Icon name="ext" size={12} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}

          {block.note && (
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{block.note}</div>
          )}
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            This list is not a transaction. A preview is dry — you review every step and deposit from
            your own wallet.
          </div>
        </div>
      )}
    </div>
  );
}
