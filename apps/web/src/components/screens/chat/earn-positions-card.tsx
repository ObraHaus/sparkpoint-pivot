"use client";

/**
 * 071 — the read-only Rhea (Burrow) positions card.
 *
 * This is a VIEW of the signed-in wallet's Multichain Account (MCA) on NEAR: supplied symbol,
 * amount and the contract's supply APR. It is never signable and never a transaction. `empty` is
 * an honest "no Rhea account yet for this wallet" (with the backend's explainer), and `unavailable`
 * says the NEAR RPC read failed — neither is an error card. Withdraw is an external link-out to
 * Rhea's lending app in this phase.
 */

import type { EarnPositionsBlock } from "@sparkpoint/shared/schemas";

import { Icon } from "@/lib/icons";
import { chainLabel, sourceAttribution } from "@/lib/earn/format";
import { formatApyPercent } from "@/lib/format/apy";

const MUTED = "var(--muted-foreground)";

function Shell({
  block,
  children,
}: {
  block: EarnPositionsBlock;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ccard cf-card"
      data-card="earn-positions"
      data-state={block.state}
      style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}
    >
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Your Rhea positions</div>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {block.state === "ready"
              ? "Read-only · not signable"
              : block.state === "empty"
                ? "No positions yet"
                : "Unavailable"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          Rhea (Burrow) lending on {chainLabel("near")}
          {block.mca ? ` · ${block.mca}` : ""}. Nothing is signed or sent.
        </div>
      </div>
      <div className="cf-sec" style={{ display: "grid", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

export function EarnPositionsCard({ block }: { block: EarnPositionsBlock }) {
  const withdraw = block.appUrl ? (
    <a
      data-testid="earn-positions-withdraw"
      href={block.appUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12.5,
        fontWeight: 600,
        color: "var(--primary)",
        textDecoration: "none",
        justifySelf: "start",
      }}
    >
      Withdraw on Rhea <Icon name="ext" size={12} />
    </a>
  ) : null;

  const source = block.source ? (
    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }} data-testid="earn-positions-source">
      {sourceAttribution(block.source)}{" "}
      <a
        href={block.source.uiUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--primary)", fontWeight: 600 }}
      >
        source ↗
      </a>
    </div>
  ) : null;

  if (block.state === "unavailable") {
    return (
      <Shell block={block}>
        <div data-testid="earn-positions-unavailable">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Positions can&apos;t be read right now</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
            {block.unavailableReason ?? "The NEAR RPC read is unavailable."} Nothing was signed or
            sent.
          </div>
        </div>
        {source}
        {withdraw}
      </Shell>
    );
  }

  if (block.state === "empty" || block.supplied.length === 0) {
    return (
      <Shell block={block}>
        <div data-testid="earn-positions-empty">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {block.mca ? "No supplied positions yet" : "No Rhea account yet for this wallet"}
          </div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
            {block.explainer ??
              (block.mca
                ? "This Rhea account has no supplied positions."
                : "Your first Rhea deposit creates your account and starts earning on NEAR.")}{" "}
            Nothing was signed or sent.
          </div>
        </div>
        {source}
        {withdraw}
      </Shell>
    );
  }

  return (
    <Shell block={block}>
      <div data-testid="earn-positions-list" style={{ display: "grid", gap: 8 }}>
        {block.supplied.map((position) => (
          <div
            key={position.symbol}
            data-testid="earn-position-row"
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              padding: "10px 11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{position.symbol}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>Supplied on Rhea</div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }} className="tnum">
                {position.amount} {position.symbol}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED }} className="tnum">
                {formatApyPercent(position.apy)
                  ? `${formatApyPercent(position.apy)} supply APY`
                  : "APY unavailable"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {block.totalUsd && (
        <div
          data-testid="earn-positions-total"
          style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}
        >
          <span style={{ color: MUTED }}>Total supplied (stablecoin estimate)</span>
          <span style={{ fontWeight: 600 }} className="tnum">
            ${block.totalUsd}
          </span>
        </div>
      )}

      {source}
      {block.note && <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{block.note}</div>}
      {withdraw}
      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
        This card only reads your Rhea account. You can supply or withdraw on the Rhea page with
        the same wallet, and SparkPoint never holds your funds.
      </div>
    </Shell>
  );
}
