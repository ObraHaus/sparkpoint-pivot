"use client";

/**
 * 048 + 050 — the curated board on `/vault`, Option C (editorial feature, card-first, live-only).
 *
 * Layout: a full-width **Sparky recommends** feature card, then (admin sessions only) the in-flight
 * panel, then every live vault as a card that lazy-loads on scroll with an honest terminal message.
 *
 * Everything here is DISPLAY over the agent's stored record. Feature 050 tightened the public
 * rule: only `wrapped` vaults are shown — candidates, approved-but-unwrapped, whitelisted/cooling,
 * cancelled and failed rows are admin-panel data. The agent already filters server-side; the client
 * re-checks defensively so an in-flight row can never leak through a stale payload.
 *
 * Deposit routing (T303) is unchanged: `depositRail` sends a wrapped vault to the wrapper deposit
 * with the performance-fee disclosure; a claimed-but-undeployed wrapper is an honest "not yet".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";
import { toHref } from "@/lib/nav";
import { money } from "@/lib/utils";
import { useWrapperHolding } from "@/lib/portfolio/useHeldWrappers";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { useSession } from "@/lib/auth/useSiwe";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { useEarnVaults } from "@/lib/earn/useEarnVaults";
import {
  formatNetApy,
  formatTvl,
  previewPrompt,
  protocolLabel,
  protocolOf,
  vaultRowTitle,
} from "@/lib/earn/format";
import {
  kaminoLiveEnabledFromEnv,
  liveEarnHref,
  morphoLiveEnabledFromEnv,
  rheaLiveEnabledFromEnv,
} from "@/lib/earn/liveFlags";
import { findKaminoVault } from "@/lib/earn/kaminoLive";
import { findMorphoVault } from "@/lib/earn/morphoLive";
import {
  balanceDisplay,
  KNOWN_CHAINS,
  KNOWN_PROTOCOLS,
  chainDisplayName,
  chainKeyFromId,
  chainKeyFromSlug,
  collectFilterValues,
  emptyFilter,
  filterVaults,
  hasActiveFilter,
  liveDisplayName,
  mergeFilterValues,
  morphoPositionValue,
  protocolDisplayName,
  protocolKeyFromSource,
  type BalanceDisplay,
  type VaultTagFilter,
} from "@/lib/vault/vaultList";
import {
  useKaminoPositions,
  useRheaAccount,
  useRheaSupplied,
  useSolanaAccount,
} from "@/lib/vault/useVaultBalances";
import {
  boardEmptyCopy,
  boardProvenance,
  chatAskHref,
} from "@/lib/curation/board";
import { depositRail, type KnownVault } from "@/lib/curation/depositRail";
import {
  cardSparkline,
  earnApyBps,
  flatSparklinePath,
  heroPick,
  inFlightCounts,
  liveVaults,
  sparklinePath,
  type InFlightCounts,
} from "@/lib/curation/boardV2";
import type { EarnVault } from "@sparkpoint/shared/schemas";
import {
  curatorLabel,
  shortenAddressesInText,
  fmtApyBps,
  fmtUsdCompact,
  fmtWhen,
  newThisWeek,
  shortAddr,
  type ApyPoint,
  type CurationBoard as Board,
  type CurationVault,
} from "@/lib/curation/model";
import "@/components/screens/vault.css";
import "@/components/vault/board.css";

// ── shared bits ──────────────────────────────────────────────────────────────────────────────────

/** 052 — the vault's asset as a logo token (local art by address/symbol; avatar fallback). */
function assetToken(v: CurationVault) {
  return { symbol: v.asset.symbol ?? "?", address: v.asset.address ?? "", verified: true };
}

/** One set of tags on every card, so live/preview and chain/protocol read the same everywhere. */
function VaultTags({
  chain,
  protocol,
  live,
}: {
  chain: string;
  protocol: string;
  live: boolean;
}) {
  return (
    <div className="vb-badges" data-testid="vault-tags">
      <span className="vb-badge" data-tag="chain">
        {chainDisplayName(chain)}
      </span>
      <span className="vb-badge" data-tag="protocol">
        {protocolDisplayName(protocol)}
      </span>
      <span className={`vb-badge ${live ? "wrapped" : "ghosty"}`} data-tag="kind">
        {liveDisplayName(live)}
      </span>
    </div>
  );
}

function BalanceLine({ display, testId }: { display: BalanceDisplay; testId?: string }) {
  return (
    <div className="vb-balance" data-testid={testId} data-state={display.state}>
      <span>Your balance</span>
      <b className="tnum">{display.text}</b>
    </div>
  );
}

/** The in-app live flow for a curated vault, when this exact vault is on the live allowlist. */
function curatedLiveMorpho(vault: CurationVault): `0x${string}` | null {
  if (vault.chainId !== 8453 || !morphoLiveEnabledFromEnv()) return null;
  return findMorphoVault(vault.address)?.address ?? null;
}

/** The in-app live flow for an earn-registry row, or `null` when only a preview is honest. */
function liveProtocolFor(vault: EarnVault): "kamino" | "morpho" | "rhea" | null {
  const protocol = protocolOf(vault);
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
  if (protocol === "rhea" && vault.chain === "near" && rheaLiveEnabledFromEnv()) {
    return "rhea";
  }
  return null;
}

function RailCta({
  vault,
  knownVaults,
  className = "btn btn-primary btn-sm",
}: {
  vault: CurationVault;
  knownVaults: KnownVault[];
  className?: string;
}) {
  const router = useRouter();
  const rail = depositRail(
    { ...vault, assetSymbol: vault.asset.symbol ?? undefined },
    knownVaults,
    explorerAddressUrl,
  );
  if (rail.kind === "wrapper" || rail.kind === "direct") {
    return (
      <button className={className} title={rail.disclosure} onClick={() => router.push(rail.href)}>
        {rail.label}
      </button>
    );
  }
  if (rail.kind === "direct-external") {
    return (
      <a className={className} href={rail.href} target="_blank" rel="noreferrer" title={rail.disclosure}>
        {rail.label}
      </a>
    );
  }
  return (
    <span className="muted" style={{ fontSize: 11, lineHeight: 1.4 }} title={rail.note}>
      {rail.label}
    </span>
  );
}

/** 060 — the stored APY's own as-of, from the freshest timestamp the row carries. */
function asOfLabel(vault: CurationVault): string {
  const stamp = vault.lastScanAt ?? vault.asOf ?? vault.updatedAt;
  return stamp ? `as of ${fmtWhen(stamp)}` : "recent data";
}

function Sparkline({
  points,
  flatBps,
  big = false,
}: {
  points?: Array<{ netApyBps: number }>;
  flatBps?: number | null;
  big?: boolean;
}) {
  const width = big ? 300 : 120;
  const height = big ? 96 : 34;
  const path = sparklinePath(points, width, height) ?? flatSparklinePath(flatBps, width, height);
  if (!path) return null;
  return (
    <svg
      className={big ? "vb-spark vb-spark-big" : "vb-spark"}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid={big ? "feature-sparkline" : "vault-sparkline"}
      data-placeholder={points && points.length >= 2 ? undefined : "collecting"}
    >
      <path d={path} fill="none" stroke="var(--gain)" strokeWidth={big ? 2.4 : 2} />
    </svg>
  );
}

function Badges({
  vault,
  isNew,
  light = false,
}: {
  vault: CurationVault;
  isNew: boolean;
  light?: boolean;
}) {
  const cls = light ? "vb-badge light" : "vb-badge";
  return (
    <div className="vb-badges">
      {vault.provenance === "ai" ? (
        <span className={`${cls} ai`}>AI-curated</span>
      ) : (
        <span className={`${cls} admin`}>Admin pick</span>
      )}
      <span className={`${cls} wrapped`}>Wrapped</span>
      <span className={`${cls} fee`}>Performance fee · above HWM</span>
      {isNew && <span className={`${cls} new`}>New this week</span>}
    </div>
  );
}

// ── Option C: the feature card ───────────────────────────────────────────────────────────────────

function FeatureCard({ pick, knownVaults }: { pick: CurationVault; knownVaults: KnownVault[] }) {
  const chart = cardSparkline(pick.apyHistory, pick.netApyBps);
  const router = useRouter();
  const { address: account } = useAccount();
  // 053 — a holder gets a Withdraw action on the card itself (not only via Trust & Exit).
  const holding = useWrapperHolding({
    chainId: pick.chainId,
    account,
    wrapper: (pick.wrapperAddress as `0x${string}` | null) ?? undefined,
    assetDecimals: pick.asset.decimals ?? 6,
  });
  const held = (holding.shares ?? 0n) > 0n;
  const withdrawHref = `${toHref("vault/withdraw")}?vault=${pick.wrapperAddress ?? ""}`;
  const amount = morphoPositionValue(holding.shares, holding.underlying, pick.asset.decimals ?? 6);
  const balance = balanceDisplay({
    connected: !!account,
    loading: holding.isLoading,
    error: holding.isError,
    value: amount === null ? null : `${amount} ${pick.asset.symbol ?? "USDC"}`,
  });
  return (
    <section className="vb-feature" aria-label="Sparky recommends">
      <div className="vb-feature-grid">
        <div>
          <div className="vb-badges">
            <span className="vb-badge light spark">✦ Sparky recommends</span>
            <span className="vb-badge light">{pick.provenance === "ai" ? "AI-curated" : "Admin pick"}</span>
            <span className="vb-badge light">Wrapped · deposit live</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <TokenLogo token={assetToken(pick)} chainId={pick.chainId} size={34} />
            <h2 style={{ margin: 0 }}>{shortenAddressesInText(pick.label)}</h2>
          </div>
          <div className="vb-feature-meta">
            {pick.curator ? `${curatorLabel(pick)} · ` : ""}{pick.asset.symbol ?? "—"} ·{" "}
            <span className="mono">{shortAddr(pick.address)}</span>
            {pick.ageSeconds != null ? ` · ${Math.floor(pick.ageSeconds / 86_400)}d live` : ""}
          </div>
          {pick.reason && <p className="vb-feature-reason">{shortenAddressesInText(pick.reason)}</p>}
          <div className="vb-stats">
            <div className="vb-stat big">
              <div className="v tnum">{fmtApyBps(pick.netApyBps)}</div>
              <div className="l">net APY · {asOfLabel(pick)}</div>
            </div>
            <div className="vb-stat">
              <div className="v tnum">{fmtUsdCompact(pick.tvlUsd)}</div>
              <div className="l">TVL</div>
            </div>
            <div className="vb-stat">
              <div className="v tnum">{fmtUsdCompact(pick.liquidityUsd)}</div>
              <div className="l">withdrawable</div>
            </div>
            {pick.score != null && (
              <div className="vb-stat">
                <div className="v tnum">{pick.score}</div>
                <div className="l">Sparky score</div>
              </div>
            )}
            <div className="vb-stat" data-testid="feature-balance" data-state={balance.state}>
              <div className="v tnum">{balance.text}</div>
              <div className="l">your balance</div>
            </div>
          </div>
          <div className="vb-ctas">
            <RailCta vault={pick} knownVaults={knownVaults} className="btn btn-primary btn-md" />
            {held && (
              <button
                className="btn vb-btn-on-feature btn-md"
                onClick={() => router.push(withdrawHref)}
                title={
                  holding.valueUsd !== undefined
                    ? `Withdraw your ${money(holding.valueUsd)} position`
                    : "Withdraw your position"
                }
              >
                Withdraw{holding.valueUsd !== undefined ? ` ${money(holding.valueUsd)}` : ""}
              </button>
            )}
            <Link className="btn vb-btn-on-feature btn-md" href={chatAskHref()}>
              Ask Sparky why
            </Link>
          </div>
          <div className="vb-feature-note">
            Performance-only fee above your high-water mark · no deposit, exit or management fee ·
            exits are direct on-chain calls, never gated.
          </div>
        </div>
        <div className="vb-feature-chart">
          <div className="vb-chart-hd">
            <span>NET APY · 30d</span>
            <span data-testid="feature-sparkline-label">{chart.rangeLabel}</span>
          </div>
          <Sparkline points={chart.points} flatBps={chart.flatBps} big />
          {!chart.hasHistory && (
            <div className="vb-chart-empty">
              History is still building — this is today&apos;s APY, not a trend. It updates as
              more data comes in.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Option C: a live-vault card ──────────────────────────────────────────────────────────────────

function VaultCard({
  vault,
  knownVaults,
  isNew,
  isPick,
}: {
  vault: CurationVault;
  knownVaults: KnownVault[];
  isNew: boolean;
  isPick: boolean;
}) {
  const chart = cardSparkline(vault.apyHistory, vault.netApyBps);
  const router = useRouter();
  const { address: account } = useAccount();
  const chain = chainKeyFromId(vault.chainId);
  const protocol = protocolKeyFromSource(vault.source);
  // 053 — a holder sees their position on the card and can withdraw straight from it. A direct
  // curated vault is its own ERC-4626, so the same read works with the vault address.
  const holding = useWrapperHolding({
    chainId: vault.chainId,
    account,
    wrapper: ((vault.wrapperAddress ?? vault.address) as `0x${string}`) || undefined,
    assetDecimals: vault.asset.decimals ?? 6,
  });
  const held = (holding.shares ?? 0n) > 0n;
  const amount = morphoPositionValue(holding.shares, holding.underlying, vault.asset.decimals ?? 6);
  const balance = balanceDisplay({
    connected: !!account,
    loading: holding.isLoading,
    error: holding.isError,
    value: amount === null ? null : `${amount} ${vault.asset.symbol ?? "USDC"}`,
  });
  const liveMorpho = curatedLiveMorpho(vault);
  const liveHref = liveMorpho
    ? liveEarnHref({
        protocol: "morpho",
        chain: "base",
        vault: liveMorpho,
        asset: vault.asset.symbol ?? undefined,
        mode: "deposit",
      })
    : null;
  return (
    <article className="vb-card" id={`vault-${vault.address}`}>
      <div className="vb-card-top">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TokenLogo token={assetToken(vault)} chainId={vault.chainId} size={28} />
          <div>
            <div className="vb-card-name">{shortenAddressesInText(vault.label)}</div>
            <div className="vb-card-sub">
              {vault.curator ? `${curatorLabel(vault)} · ` : ""}{vault.asset.symbol ?? "—"}
            </div>
          </div>
        </div>
        {isPick && <span className="vb-badge spark">✦ pick</span>}
        {held && holding.valueUsd !== undefined && (
          <span className="vb-badge" title="Your position in this vault (read on-chain)">
            You hold {money(holding.valueUsd)}
          </span>
        )}
      </div>
      <VaultTags chain={chain} protocol={protocol} live />
      <div className="vb-apyrow">
        <div className="vb-apy tnum">
          {fmtApyBps(vault.netApyBps)}
          <small>net APY</small>
        </div>
        <Sparkline points={chart.points} flatBps={chart.flatBps} />
      </div>
      <div className="vb-metrics">
        <div className="vb-metric">
          <b className="tnum">{fmtUsdCompact(vault.tvlUsd)}</b>TVL
        </div>
        <div className="vb-metric">
          <b className="tnum">{fmtUsdCompact(vault.liquidityUsd)}</b>withdrawable
        </div>
        <div className="vb-metric">
          <b>perf-only</b>fee above HWM
        </div>
      </div>
      <BalanceLine display={balance} testId="curated-vault-balance" />
      <Badges vault={vault} isNew={isNew} />
      {vault.reason && <div className="vb-card-why">Why: {shortenAddressesInText(vault.reason)}</div>}
      <div className="vb-card-range" data-testid="vault-card-range">
        {chart.rangeLabel}
      </div>
      <div className="vb-card-cta">
        {liveHref ? (
          <a className="btn btn-primary btn-sm btn-block" href={liveHref} data-testid="curated-live-deposit">
            Live deposit
          </a>
        ) : (
          <RailCta vault={vault} knownVaults={knownVaults} className="btn btn-primary btn-sm btn-block" />
        )}
        {held && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => router.push(`${toHref("vault/withdraw")}?vault=${vault.wrapperAddress ?? ""}`)}
          >
            Withdraw
          </button>
        )}
        <a
          className="btn btn-outline btn-sm"
          href={explorerAddressUrl(vault.chainId, vault.address)}
          target="_blank"
          rel="noreferrer"
        >
          Details
        </a>
      </div>
    </article>
  );
}

// ── a live/preview earn-registry card, in the SAME card UI as the curated vaults ────────────────

function EarnVaultCard({ vault, history }: { vault: EarnVault; history?: ApyPoint[] }) {
  const chart = cardSparkline(history, earnApyBps(vault.netApy));
  const protocol = protocolOf(vault);
  const chain = chainKeyFromSlug(vault.chain);
  const live = liveProtocolFor(vault);
  const { address: evmAccount } = useAccount();
  const { accountId: nearAccount } = useNearWallet();
  const solanaAccount = useSolanaAccount();
  // A connected NEAR wallet wins; an EVM-only session reads the Rhea MCA the portfolio path uses.
  const rheaAccount = useRheaAccount(nearAccount, protocol === "rhea");

  // Each hook is called for every card but only enabled for its own protocol, so the card never
  // asks the wrong chain's wallet (and react-query de-dupes reads across cards).
  const rhea = useRheaSupplied(protocol === "rhea" ? rheaAccount.account : null);
  const kamino = useKaminoPositions(protocol === "kamino" ? solanaAccount : null);
  const morpho = useWrapperHolding({
    chainId: vault.chainId,
    account: protocol === "morpho" && vault.chainId === 8453 ? evmAccount : undefined,
    wrapper:
      protocol === "morpho" && vault.chainId === 8453
        ? (vault.address as `0x${string}`)
        : undefined,
    assetDecimals: vault.asset.decimals ?? 6,
  });

  const symbol = vault.asset.symbol ?? "USDC";
  let balance: BalanceDisplay;
  if (protocol === "rhea") {
    balance = balanceDisplay({
      connected: !!rhea.account,
      currentAccount: rhea.account,
      valueAccount: rhea.account,
      loading: rhea.loading,
      error: rhea.error,
      value: `${rhea.amount ?? "0"} ${rhea.symbol}`,
    });
  } else if (protocol === "kamino") {
    const position = kamino.positions.find((row) => row.vaultAddress === vault.address);
    const unreadable = !!position && position.estimatedTokens === null;
    const value = position
      ? position.estimatedTokens === null
        ? null
        : `${position.estimatedTokens} ${position.assetSymbol ?? symbol}`
      : `0 ${symbol}`;
    balance = balanceDisplay({
      connected: !!kamino.account,
      currentAccount: solanaAccount,
      valueAccount: kamino.account,
      loading: kamino.loading,
      error: kamino.error || unreadable,
      value,
    });
  } else {
    const amount =
      vault.chainId === 8453
        ? morphoPositionValue(morpho.shares, morpho.underlying, vault.asset.decimals ?? 6)
        : null;
    balance = balanceDisplay({
      connected: protocol === "morpho" && vault.chainId === 8453 && !!evmAccount,
      loading: morpho.isLoading,
      error: morpho.isError,
      value: amount === null ? null : `${amount} ${symbol}`,
    });
  }

  const depositHref = live
    ? liveEarnHref({
        protocol: live,
        chain: vault.chain,
        vault: vault.address,
        asset: vault.asset.symbol,
        mode: "deposit",
      })
    : null;
  const withdrawHref = live
    ? liveEarnHref({
        protocol: live,
        chain: vault.chain,
        vault: vault.address,
        asset: vault.asset.symbol,
        mode: "withdraw",
      })
    : null;
  const previewHref = `${toHref("chat")}?ask=${encodeURIComponent(previewPrompt(vault))}`;
  const appUrl = live === null && protocol === "morpho" ? vaultExternalUrl(vault) : null;
  const noRail = vault.rails.available.length === 0;

  return (
    <article
      className="vb-card"
      id={`vault-${vault.chain}-${vault.address}`}
      data-testid="earn-vault-card"
      data-protocol={protocol}
      data-chain={chain}
    >
      <div className="vb-card-top">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TokenLogo
            token={{ symbol, address: vault.asset.address ?? "", verified: true }}
            chainId={vault.chainId}
            size={28}
          />
          <div>
            <div className="vb-card-name">{vaultRowTitle(vault)}</div>
            <div className="vb-card-sub">
              {protocolLabel(protocol)} · {vault.asset.symbol} · {vault.symbol || shortAddr(vault.address)}
            </div>
          </div>
        </div>
      </div>
      <VaultTags chain={chain} protocol={protocol} live={!!live} />
      <div className="vb-apyrow">
        <div className="vb-apy tnum">
          {formatNetApy(vault.netApy)}
          <small>net APY · {protocolLabel(protocol)}</small>
        </div>
        <Sparkline points={chart.points} flatBps={chart.flatBps} />
      </div>
      <div className="vb-metrics">
        <div className="vb-metric">
          <b className="tnum">{formatTvl(vault.tvlUsd)}</b>TVL
        </div>
        <div className="vb-metric">
          <b className="tnum">{vault.asset.symbol}</b>asset
        </div>
        <div className="vb-metric">
          <b>{live ? "In app" : "Preview"}</b>deposit
        </div>
      </div>
      <BalanceLine display={balance} testId="earn-vault-balance" />
      <div className="vb-card-range" data-testid="earn-vault-range">
        {chart.rangeLabel}
      </div>
      <div className="vb-card-cta">
        {depositHref ? (
          <a className="btn btn-primary btn-sm btn-block" href={depositHref} data-testid="earn-live-deposit">
            Live deposit
          </a>
        ) : (
          <a className="btn btn-primary btn-sm btn-block" href={previewHref}>
            Preview in Sparky
          </a>
        )}
        {withdrawHref && (
          <a className="btn btn-outline btn-sm" href={withdrawHref} data-testid="earn-live-withdraw">
            Withdraw
          </a>
        )}
        {depositHref && (
          <a className="btn btn-outline btn-sm" href={previewHref}>
            Preview
          </a>
        )}
        {appUrl && (
          <a className="btn btn-outline btn-sm" href={appUrl} target="_blank" rel="noreferrer">
            Details
          </a>
        )}
      </div>
      {noRail && (
        <div style={{ fontSize: 11.5, color: "var(--caution)", lineHeight: 1.45 }}>
          Live deposit and withdraw aren&apos;t available for this vault yet. You can still preview it
          with Sparky.
        </div>
      )}
    </article>
  );
}

function vaultExternalUrl(vault: EarnVault): string | null {
  if (protocolOf(vault) === "morpho") {
    return `https://app.morpho.org/${vault.chain === "eth" ? "ethereum" : vault.chain}/vault/${vault.address}`;
  }
  return null;
}

// ── 050: admin-only in-flight panel ──────────────────────────────────────────────────────────────

interface WhitelistWire {
  entries?: Array<{ status: string; ready: boolean }>;
  candidates?: unknown[];
}
interface CurationWire {
  vaults?: Array<{ status: string }>;
}

/**
 * Rendered ONLY for an admin session, directly under the feature card. The counts come from the
 * admin-gated endpoints (they 404 for everyone else), and the panel hides itself on any failure —
 * a public visitor never sees it and never triggers the calls.
 */
function AdminInFlightPanel() {
  const { session } = useSession();
  const isAdmin = Boolean(session?.admin);
  const [counts, setCounts] = useState<InFlightCounts | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const get = (path: string) =>
      fetch(path, { headers: { "x-chain-id": APP_CHAIN_ID_HEADER }, cache: "no-store" }).then(
        (res) => (res.ok ? res.json() : null),
      );
    Promise.all([
      get("/api/agent/admin/vaults/whitelist"),
      get("/api/agent/admin/vaults/curation"),
    ])
      .then(([wl, cu]: [WhitelistWire | null, CurationWire | null]) => {
        if (!live || !wl || !cu) return;
        setCounts(
          inFlightCounts({
            entries: wl.entries ?? [],
            candidates: wl.candidates ?? [],
            curation: cu.vaults ?? [],
          }),
        );
      })
      .catch(() => {
        /* best-effort admin view; never break the public page */
      });
    return () => {
      live = false;
    };
  }, [isAdmin]);

  if (!isAdmin || counts === null) return null;
  return (
    <section className="vb-admin" aria-label="Admin: in-flight vaults">
      <div className="vb-admin-hd">
        <h3>In-flight vaults</h3>
        <span className="vb-badge admin">operator view</span>
      </div>
      <p>
        These vaults are not on the public board yet:
      </p>
      <div className="vb-admin-counts">
        <span>
          <b className="tnum">{counts.approvedUnwrapped}</b> approved, no wrapper
        </span>
        <span>
          <b className="tnum">{counts.whitelisted}</b> whitelisted
          {counts.cooling > 0 ? ` (${counts.cooling} cooling)` : ""}
        </span>
        <span>
          <b className="tnum">{counts.failed}</b> failed
        </span>
        <span>
          <b className="tnum">{counts.candidates}</b> candidates
        </span>
      </div>
      <Link className="btn btn-primary btn-sm" href="/admin/vault?section=curated">
        Manage in Admin → Vaults
      </Link>
    </section>
  );
}

// ── states ───────────────────────────────────────────────────────────────────────────────────────

function EmptyState({ board }: { board: Board }) {
  const { title, body } = boardEmptyCopy(board);
  return (
    <section className="vb-empty">
      <div className="vb-empty-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
            stroke="var(--primary)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"
            fill="var(--primary)"
            opacity=".55"
          />
        </svg>
      </div>
      <h2>{board.note ? "Sparky is screening vaults" : title}</h2>
      <p>{board.note ?? body}</p>
      <div className="vb-empty-cta">
        <Link className="btn btn-primary btn-md" href={chatAskHref()}>
          Ask Sparky about vaults
        </Link>
        <span className="vb-badge ghosty">last updated {fmtWhen(board.lastRunAt)} · 0 wrapped</span>
      </div>
      <div className="vb-empty-prov">{boardProvenance(board)}</div>
    </section>
  );
}

// ── the board ────────────────────────────────────────────────────────────────────────────────────

export function CuratedBoard({
  board,
  state,
  knownVaults = [],
  fetchedAt = 0,
}: {
  board: Board | null;
  state: "loading" | "ok" | "error";
  knownVaults?: KnownVault[];
  fetchedAt?: number;
}) {
  const [tagFilter, setTagFilter] = useState<VaultTagFilter>(emptyFilter());
  const earn = useEarnVaults();

  // Curated wrapped vaults and the live Rhea/Kamino/Morpho registry rows become ONE list. The
  // registry can hold 100+ Morpho vaults, so the all-protocol view keeps a short per-protocol tail.
  const curatedItems = useMemo(() => {
    if (!board) return [];
    return liveVaults(board).map((vault) => ({
      kind: "curated" as const,
      key: `curated:${vault.chainId}:${vault.address}`,
      chain: chainKeyFromId(vault.chainId),
      protocol: protocolKeyFromSource(vault.source),
      live: true,
      vault,
    }));
  }, [board]);

  const apyHistoryByVault = useMemo(() => {
    const map = new Map<string, ApyPoint[]>();
    for (const vault of board?.vaults ?? []) {
      if (vault.apyHistory && vault.apyHistory.length >= 2) {
        map.set(`${vault.chainId}:${vault.address.toLowerCase()}`, vault.apyHistory);
      }
    }
    return map;
  }, [board]);

  const earnItems = useMemo(() => {
    const curatedKeys = new Set(
      curatedItems.map((item) => `${item.chain}:${item.vault.address.toLowerCase()}`),
    );
    const perProtocol: Record<string, number> = {};
    return earn.vaults
      .map((vault) => ({
        kind: "earn" as const,
        key: `earn:${vault.chain}:${vault.address}`,
        chain: chainKeyFromSlug(vault.chain),
        protocol: protocolOf(vault),
        live: liveProtocolFor(vault) !== null,
        vault,
      }))
      .filter((item) => !curatedKeys.has(`${item.chain}:${item.vault.address.toLowerCase()}`))
      .filter((item) => {
        perProtocol[item.protocol] = (perProtocol[item.protocol] ?? 0) + 1;
        return perProtocol[item.protocol] <= 6;
      });
  }, [curatedItems, earn.vaults]);

  const allItems = useMemo(() => [...curatedItems, ...earnItems], [curatedItems, earnItems]);
  const list = useMemo(() => filterVaults(allItems, tagFilter), [allItems, tagFilter]);
  // Chips are present before both data sources resolve, so the row never appears to lose options.
  const chainOptions = useMemo(
    () => mergeFilterValues(collectFilterValues(allItems, "chain"), KNOWN_CHAINS),
    [allItems],
  );
  const protocolOptions = useMemo(
    () => mergeFilterValues(collectFilterValues(allItems, "protocol"), KNOWN_PROTOCOLS),
    [allItems],
  );
  const pick = useMemo(() => (board ? heroPick(board) : null), [board]);
  const fresh = useMemo(
    () =>
      board && fetchedAt > 0
        ? new Set(newThisWeek(board.vaults, fetchedAt).map((v) => v.address))
        : new Set<string>(),
    [board, fetchedAt],
  );

  const applyFilters = useCallback((next: VaultTagFilter) => {
    setTagFilter(next);
  }, []);

  if (state === "loading") {
    return (
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="card-hd">
          <span className="t">Vaults</span>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Reading the vault list…
        </div>
      </div>
    );
  }

  if (state === "error" || board === null) {
    return (
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="card-hd">
          <span className="t">Vaults are unavailable</span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          Sparky couldn’t read the vault list just now. Nothing is wrong with your wallet or your
          funds — this list is a read, and it will come back on its own.
        </div>
      </div>
    );
  }

  const visible = list;
  const filtered = list.length !== allItems.length;

  return (
    <div className="vb-board">
      {pick ? (
        <FeatureCard pick={pick} knownVaults={knownVaults} />
      ) : allItems.length === 0 ? (
        <EmptyState board={board} />
      ) : null}

      <AdminInFlightPanel />

      {allItems.length > 0 && (
        <>
          <div className="vb-listhead">
            <h2>All vaults</h2>
            <span className="vb-badge ghosty">
              {filtered ? `${list.length} of ${allItems.length}` : allItems.length} · live and preview
            </span>
          </div>
          <div className="vb-chiprow" role="group" aria-label="Filter by chain">
            <button
              className={`vb-chip${tagFilter.chain === "all" ? " on" : ""}`}
              onClick={() => applyFilters({ ...tagFilter, chain: "all" })}
            >
              All chains
            </button>
            {chainOptions.map((chain) => (
              <button
                key={chain}
                className={`vb-chip${tagFilter.chain === chain ? " on" : ""}`}
                onClick={() => applyFilters({ ...tagFilter, chain })}
              >
                {chainDisplayName(chain)}
              </button>
            ))}
          </div>
          <div className="vb-chiprow" role="group" aria-label="Filter by protocol">
            <button
              className={`vb-chip${tagFilter.protocol === "all" ? " on" : ""}`}
              onClick={() => applyFilters({ ...tagFilter, protocol: "all" })}
            >
              All protocols
            </button>
            {protocolOptions.map((protocol) => (
              <button
                key={protocol}
                className={`vb-chip${tagFilter.protocol === protocol ? " on" : ""}`}
                onClick={() => applyFilters({ ...tagFilter, protocol })}
              >
                {protocolDisplayName(protocol)}
              </button>
            ))}
            {hasActiveFilter(tagFilter) && (
              <button className="vb-chip" onClick={() => applyFilters(emptyFilter())}>
                Clear filters
              </button>
            )}
          </div>
          <div className="vb-grid">
            {visible.map((item) =>
              item.kind === "curated" ? (
                <VaultCard
                  key={item.key}
                  vault={item.vault}
                  knownVaults={knownVaults}
                  isNew={fresh.has(item.vault.address)}
                  isPick={pick?.address === item.vault.address}
                />
              ) : (
                <EarnVaultCard
                  key={item.key}
                  vault={item.vault}
                  history={apyHistoryByVault.get(`${item.vault.chainId}:${item.vault.address.toLowerCase()}`)}
                />
              ),
            )}
          </div>
          {visible.length === 0 && (
            <div className="vb-loadstatus">
              No vaults match these filters. Clear the filters to see all vaults.
            </div>
          )}
        </>
      )}

      <div className="vb-boardfoot">
        Figures reflect recent data; not projections. Each card names its chain and protocol,
        and “Preview” means the live in-app deposit isn’t available yet.
      </div>
    </div>
  );
}
