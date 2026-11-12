"use client";

/**
 * 072 — the read-only multi-chain portfolio card.
 *
 * Five independently-degradable sections (wallet balances, Morpho, Kamino, Rhea, cross-chain
 * swaps) plus totals. NOTHING here is signable: there is no calldata, no signature and no action,
 * and the card says so in its footer. A dead source or a missing Solana link degrades only its own
 * section to an honest reason; the rest still render.
 *
 * The same body is reused by the Portfolio screen's "Across chains" panel, so the chat and the
 * page can never drift.
 */

import { useState } from "react";

import type {
  PortfolioOverviewBlock,
  PortfolioRow,
  PortfolioSection,
  PortfolioSectionKey,
} from "@sparkpoint/shared/schemas";

import { Icon } from "@/lib/icons";
import { NearWalletPortfolioLine } from "@/components/near/NearWalletPortfolioLine";
import {
  apyLine,
  money,
  relativeTime,
  routeLabel,
  sectionEmptyCopy,
  shortenAddress,
  statusLabel,
  swapStatusLabel,
} from "@/lib/portfolio/format";

const MUTED = "var(--muted-foreground)";
const RHEA_APP_URL = "https://app.rhea.finance/lending";

function ChainBadge({ label }: { label: string }) {
  return (
    <span
      data-testid="portfolio-chain-badge"
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
      {label}
    </span>
  );
}

function ProtocolBadge({ protocol }: { protocol: string }) {
  const known = protocol === "morpho" || protocol === "kamino" || protocol === "rhea";
  const label = protocol === "morpho" ? "Morpho" : protocol === "kamino" ? "Kamino" : protocol === "rhea" ? "Rhea" : protocol;
  return (
    <span
      data-testid="portfolio-protocol-badge"
      data-protocol={protocol}
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: ".02em",
        color: known && protocol !== "morpho" ? "var(--primary)" : MUTED,
        background:
          known && protocol !== "morpho"
            ? "color-mix(in srgb, var(--primary) 12%, transparent)"
            : "transparent",
        border: `1px solid ${
          known && protocol !== "morpho"
            ? "color-mix(in srgb, var(--primary) 28%, transparent)"
            : "var(--border-soft)"
        }`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalised = status.trim().toUpperCase();
  const tone =
    normalised === "SUCCESS" || normalised === "COMPLETED"
      ? "var(--gain)"
      : normalised === "FAILED" || normalised === "REFUNDED"
        ? "var(--loss)"
        : "var(--caution)";
  return (
    <span
      data-testid="portfolio-swap-status"
      data-status={normalised}
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        color: tone,
        background: `color-mix(in srgb, ${tone} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 26%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {swapStatusLabel(status)}
    </span>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: MUTED }}>
      <span title={address} data-testid="portfolio-deposit-address">
        {shortenAddress(address)}
      </span>
      <button
        type="button"
        data-testid="portfolio-copy-address"
        aria-label={copied ? "Deposit address copied" : "Copy deposit address"}
        onClick={() => {
          void navigator.clipboard?.writeText(address).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          );
        }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          display: "inline-flex",
          color: copied ? "var(--gain)" : MUTED,
          cursor: "pointer",
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={12} />
      </button>
    </span>
  );
}

function SectionShell({
  section,
  headingId,
  children,
}: {
  section: PortfolioSection;
  headingId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`portfolio-section-${section.key}`}
      data-status={section.status}
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        padding: "12px 13px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <h3 id={headingId} style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
          {section.label}
        </h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          {section.totalUsd && (
            <span style={{ fontSize: 12.5, fontWeight: 600 }} className="tnum">
              {money(section.totalUsd)}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: section.status === "ok" ? "var(--gain)" : "var(--caution)",
            }}
          >
            {statusLabel(section.status)}
          </span>
        </span>
      </div>
      {children}
    </section>
  );
}

function SectionState({ section }: { section: PortfolioSection }) {
  if (section.status !== "ok") {
    return (
      <div data-testid={`portfolio-section-${section.key}-degraded`} style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, color: "var(--foreground)" }}>
          {section.status === "not_linked" ? "Not linked yet" : "Can't be read right now"}
        </div>
        <div style={{ marginTop: 3 }}>
          {section.reason ?? "This source is unavailable."}
        </div>
        {section.status === "not_linked" && section.key === "kamino" && (
          <div style={{ marginTop: 4, fontSize: 11.5 }}>
            Phase C: deposits to a linked Solana address from SparkPoint will populate this section.
          </div>
        )}
      </div>
    );
  }
  if (section.rows.length === 0) {
    return (
      <div data-testid={`portfolio-section-${section.key}-empty`} style={{ fontSize: 12.5, color: MUTED }}>
        {sectionEmptyCopy(section.key)}
      </div>
    );
  }
  return null;
}

function BalanceRow({ row }: { row: PortfolioRow }) {
  return (
    <li
      data-testid="portfolio-balance-row"
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{row.symbol}</span>
        <ChainBadge label={row.chainLabel} />
        <span style={{ fontSize: 11.5, color: MUTED }}>
          {row.amount ?? "—"} {row.symbol}
        </span>
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }} className="tnum">
        {money(row.valueUsd)}
      </span>
    </li>
  );
}

function needsState(section: PortfolioSection): boolean {
  return section.status !== "ok" || section.rows.length === 0;
}

function BalancesSection({ section, headingId }: { section: PortfolioSection; headingId: string }) {
  return (
    <SectionShell section={section} headingId={headingId}>
      {needsState(section) ? (
        <SectionState section={section} />
      ) : (
        <ul data-testid="portfolio-balance-list" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 7 }}>
          {section.rows.map((row, i) => (
            <BalanceRow key={`${row.chain}:${row.symbol}:${i}`} row={row} />
          ))}
        </ul>
      )}
      {section.chains && section.chains.length > 0 && (
        <div data-testid="portfolio-chain-status" style={{ display: "grid", gap: 4, borderTop: "1px solid var(--border-soft)", paddingTop: 7 }}>
          {section.chains.map((chain) => (
            <div key={chain.chain} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: MUTED }}>
              <ChainBadge label={chain.label} />
              <span>{chain.status === "ok" ? "Read successfully" : chain.reason ?? statusLabel(chain.status)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function EarnRow({ row, section }: { row: PortfolioRow; section: PortfolioSection }) {
  const title =
    row.vaultName ??
    (section.key === "rhea" ? "Rhea Lending supply" : row.symbol);
  const apy = section.key === "rhea" ? apyLine(row.apy, "supply") : apyLine(row.netApy, "net");
  const withdrawUrl = section.key === "rhea" ? section.appUrl ?? RHEA_APP_URL : null;
  return (
    <li
      data-testid="portfolio-earn-row"
      data-protocol={row.protocol}
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 9,
        padding: "9px 10px",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
            <ProtocolBadge protocol={row.protocol} />
            <ChainBadge label={row.chainLabel} />
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
            {row.amount ? `${row.amount} ${row.symbol}` : row.symbol}
            {row.assetSymbol && row.assetSymbol !== row.symbol ? ` · ${row.assetSymbol}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }} className="tnum">
            {money(row.valueUsd)}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED }} className="tnum">
            {apy}
          </div>
        </div>
      </div>
      {row.note && (
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{row.note}</div>
      )}
      {section.key === "rhea" && (
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          Live deposits, signing and withdraws arrive in Phase C. This is a read-only view.
        </div>
      )}
      {withdrawUrl && (
        <a
          data-testid="portfolio-rhea-withdraw"
          href={withdrawUrl}
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
            justifySelf: "start",
          }}
        >
          Withdraw on Rhea <Icon name="ext" size={12} />
        </a>
      )}
    </li>
  );
}

function EarnSection({ section, headingId }: { section: PortfolioSection; headingId: string }) {
  return (
    <SectionShell section={section} headingId={headingId}>
      {needsState(section) ? (
        <SectionState section={section} />
      ) : (
        <>
          <ul data-testid={`portfolio-${section.key}-list`} style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 7 }}>
            {section.rows.map((row, i) => (
              <EarnRow key={`${row.chain}:${row.vaultAddress ?? row.symbol}:${i}`} row={row} section={section} />
            ))}
          </ul>
          {section.note && (
            <div data-testid={`portfolio-${section.key}-note`} style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
              {section.note}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            {section.key === "kamino"
              ? "Kamino deposits and withdrawals are Phase C — this section reads shares on a linked Solana address only."
              : section.key === "morpho"
                ? "Deposits and withdrawals stay in the Morpho app in this phase; nothing here is signable."
                : "Rates are the protocol's own reads, shown as-is."}
          </div>
        </>
      )}
    </SectionShell>
  );
}

function SwapRow({ row, nowMs }: { row: PortfolioRow; nowMs: number }) {
  return (
    <li
      data-testid="portfolio-swap-row"
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 9,
        padding: "9px 10px",
        display: "grid",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{routeLabel(row)}</div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
            {row.amount ? `${row.amount} ${row.symbol}` : row.symbol}
            {row.amountOut ? ` → ${row.amountOut} ${row.destinationLabel?.split(" ").pop() ?? ""}`.trimEnd() : ""}
          </div>
        </div>
        <StatusPill status={row.lastStatus ?? ""} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: MUTED }}>{relativeTime(row.createdAt, nowMs)}</span>
        {row.depositAddress && <CopyAddress address={row.depositAddress} />}
      </div>
    </li>
  );
}

function SwapsSection({ section, headingId, nowMs }: { section: PortfolioSection; headingId: string; nowMs: number }) {
  return (
    <SectionShell section={section} headingId={headingId}>
      {needsState(section) ? (
        <SectionState section={section} />
      ) : (
        <ul data-testid="portfolio-swaps-list" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 7 }}>
          {section.rows.map((row, i) => (
            <SwapRow key={`${row.originKey ?? row.symbol}:${row.createdAt ?? i}`} row={row} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

function TotalsHeader({ block }: { block: PortfolioOverviewBlock }) {
  const { totals } = block;
  // 1112 — the classic Portfolio "Net worth" card values stablecoins/vault positions only and
  // shows native ETH separately. This panel is the full multi-chain priced sum, so when ETH is
  // priced here, say so: the two totals are intentionally different, not a double count.
  const nativeRow = block.sections
    .find((section) => section.key === "balances")
    ?.rows.find((row) => row.kind === "native" && row.valueUsd);
  return (
    <div className="cf-sec" data-testid="portfolio-totals" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
            Priced positions
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.01em" }} className="tnum">
            {totals.priced ? money(totals.totalUsd) : "—"}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, textAlign: "right", lineHeight: 1.5 }}>
          {totals.priced
            ? "Only readable sections are summed."
            : "Nothing here can be priced right now — no total is invented."}
        </div>
      </div>
      {nativeRow && (
        <div data-testid="portfolio-eth-note" style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          Includes {nativeRow.amount} {nativeRow.symbol} ({money(nativeRow.valueUsd)}). The Portfolio
          page&apos;s Net worth figure counts stablecoins and vault positions only, so it excludes
          ETH — the two totals can differ.
        </div>
      )}
      {(totals.byChain.length > 0 || totals.byProtocol.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="portfolio-breakdown">
          {totals.byChain.map((row) => (
            <span
              key={`chain:${row.chain}`}
              data-testid="portfolio-breakdown-chain"
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                border: "1px solid var(--border-soft)",
                color: MUTED,
              }}
            >
              {row.label} · <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{money(row.valueUsd)}</span>
            </span>
          ))}
          {totals.byProtocol.map((row) => (
            <span
              key={`protocol:${row.protocol}`}
              data-testid="portfolio-breakdown-protocol"
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                border: "1px solid var(--border-soft)",
                color: MUTED,
              }}
            >
              {row.protocol} · <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{money(row.valueUsd)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesLine({ block }: { block: PortfolioOverviewBlock }) {
  return (
    <div
      data-testid="portfolio-source"
      style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}
    >
      {block.sources && block.sources.length > 0
        ? `Sources: ${block.sources.join(" · ")}`
        : "Sources: session wallet reads"}
      {block.asOf ? ` · as of ${block.asOf}` : ""}
    </div>
  );
}

function orderedGroups(block: PortfolioOverviewBlock): ("balances" | "earn" | "swaps")[] {
  if (block.focus === "swaps") return ["swaps", "earn", "balances"];
  if (block.focus === "earn") return ["earn", "balances", "swaps"];
  return ["balances", "earn", "swaps"];
}

function sectionFor(block: PortfolioOverviewBlock, key: PortfolioSectionKey): PortfolioSection | undefined {
  return block.sections.find((section) => section.key === key);
}

/**
 * The card body — the exact same markup the chat card and the Portfolio screen panel render.
 * `nowMs` is injectable so tests never depend on the wall clock.
 */
export function PortfolioOverviewBody({
  block,
  nowMs,
}: {
  block: PortfolioOverviewBlock;
  nowMs?: number;
}) {
  // Anchor relative times to the read's own `asOf` (or an injected clock), never to a render-time
  // `Date.now()` — that keeps the render pure and the label stable across re-renders.
  const parsedAsOf = Date.parse(block.asOf);
  const now = nowMs ?? (Number.isFinite(parsedAsOf) ? parsedAsOf : 0);
  const groups = orderedGroups(block);

  return (
    <div data-testid="portfolio-overview-body" style={{ display: "grid" }}>
      <TotalsHeader block={block} />

      {groups.map((group) => {
        if (group === "balances") {
          const section = sectionFor(block, "balances");
          return section ? (
            <div className="cf-sec" key="balances">
              <BalancesSection section={section} headingId="portfolio-heading-balances" />
            </div>
          ) : null;
        }
        if (group === "earn") {
          const earn = (["morpho", "kamino", "rhea"] as const)
            .map((key) => sectionFor(block, key))
            .filter((section): section is PortfolioSection => section !== undefined);
          if (earn.length === 0) return null;
          return (
            <div className="cf-sec" key="earn" style={{ display: "grid", gap: 9 }}>
              <h2
                id="portfolio-heading-earn"
                style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: MUTED }}
              >
                Earn positions
              </h2>
              {earn.map((section) => (
                <EarnSection
                  key={section.key}
                  section={section}
                  headingId={`portfolio-heading-${section.key}`}
                />
              ))}
            </div>
          );
        }
        const section = sectionFor(block, "swaps");
        return section ? (
          <div className="cf-sec" key="swaps">
            <SwapsSection section={section} headingId="portfolio-heading-swaps" nowMs={now} />
          </div>
        ) : null;
      })}

      <div className="cf-sec" style={{ display: "grid", gap: 6 }}>
        <SourcesLine block={block} />
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          Read-only — nothing here moves funds.
        </div>
      </div>
    </div>
  );
}

function cardTitle(block: PortfolioOverviewBlock): string {
  if (block.focus === "swaps") return "Your swap history";
  if (block.focus === "earn") return "How much you're earning";
  return "Your multi-chain portfolio";
}

/** The chat-block card. */
export function PortfolioOverviewCard({ block }: { block: PortfolioOverviewBlock }) {
  return (
    <div
      className="ccard cf-card"
      data-card="portfolio-overview"
      data-state={block.state}
      data-focus={block.focus}
      style={{ padding: 0, overflow: "hidden", maxWidth: 680 }}
    >
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{cardTitle(block)}</h2>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {block.state === "ready"
              ? "Read-only · not signable"
              : block.state === "empty"
                ? "Nothing found yet"
                : "Unavailable"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          Your signed-in wallet across Base, Solana and NEAR. Each section reads on its own and says
          so when it can&apos;t.
        </div>
      </div>
      <NearWalletPortfolioLine />
      <PortfolioOverviewBody block={block} />
    </div>
  );
}
