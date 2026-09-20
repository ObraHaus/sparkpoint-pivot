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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { useSession } from "@/lib/auth/useSiwe";
import {
  boardEmptyCopy,
  boardProvenance,
  chatAskHref,
} from "@/lib/curation/board";
import { depositRail, type KnownVault } from "@/lib/curation/depositRail";
import {
  LIVE_BATCH_SIZE,
  filterBoard,
  hasMore,
  heroPick,
  inFlightCounts,
  liveVaults,
  nextBatch,
  sparklinePath,
  sparklineRange,
  type BoardFilters,
  type InFlightCounts,
} from "@/lib/curation/boardV2";
import {
  curatorLabel,
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
  const rail = depositRail(vault, knownVaults, explorerAddressUrl);
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

function Sparkline({ points, big = false }: { points?: ApyPoint[]; big?: boolean }) {
  const path = sparklinePath(points, big ? 300 : 120, big ? 96 : 34);
  if (!path) return null;
  return (
    <svg
      className={big ? "vb-spark vb-spark-big" : "vb-spark"}
      viewBox={`0 0 ${big ? 300 : 120} ${big ? 96 : 34}`}
      preserveAspectRatio="none"
      aria-hidden="true"
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
  const range = sparklineRange(pick.apyHistory);
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
            <h2 style={{ margin: 0 }}>{pick.label}</h2>
          </div>
          <div className="vb-feature-meta">
            {curatorLabel(pick)} · {pick.asset.symbol ?? "—"} ·{" "}
            <span className="mono">{shortAddr(pick.address)}</span>
            {pick.ageSeconds != null ? ` · ${Math.floor(pick.ageSeconds / 86_400)}d live` : ""}
          </div>
          {pick.reason && <p className="vb-feature-reason">{pick.reason}</p>}
          <div className="vb-stats">
            <div className="vb-stat big">
              <div className="v tnum">{fmtApyBps(pick.netApyBps)}</div>
              <div className="l">net APY · as stored</div>
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
          </div>
          <div className="vb-ctas">
            <RailCta vault={pick} knownVaults={knownVaults} className="btn btn-primary btn-md" />
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
            {range && <span>{range}</span>}
          </div>
          <Sparkline points={pick.apyHistory} big />
          {!range && (
            <div className="vb-chart-empty">
              History builds with each daily scan — the stored APY is shown without a chart until
              there are at least two observations.
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
  const range = sparklineRange(vault.apyHistory);
  return (
    <article className="vb-card" id={`vault-${vault.address}`}>
      <div className="vb-card-top">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TokenLogo token={assetToken(vault)} chainId={vault.chainId} size={28} />
          <div>
            <div className="vb-card-name">{vault.label}</div>
            <div className="vb-card-sub">
              {curatorLabel(vault)} · {vault.asset.symbol ?? "—"}
            </div>
          </div>
        </div>
        {isPick && <span className="vb-badge spark">✦ pick</span>}
      </div>
      <div className="vb-apyrow">
        <div className="vb-apy tnum">
          {fmtApyBps(vault.netApyBps)}
          <small>net APY</small>
        </div>
        <Sparkline points={vault.apyHistory} />
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
      <Badges vault={vault} isNew={isNew} />
      {vault.reason && <div className="vb-card-why">Why: {vault.reason}</div>}
      {range && <div className="vb-card-range">30d range {range} · stored scans</div>}
      <div className="vb-card-cta">
        <RailCta vault={vault} knownVaults={knownVaults} className="btn btn-primary btn-sm btn-block" />
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
        <h3>Not on this page — admin only</h3>
        <span className="vb-badge admin">operator view</span>
      </div>
      <p>
        In-flight rows are never public. These counts come from the admin endpoints, not the board:
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
        <span className="vb-badge ghosty">last scan {fmtWhen(board.lastRunAt)} · 0 wrapped</span>
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
  const [filters, setFilters] = useState<BoardFilters>({ newOnly: false, aiOnly: false });
  const [shown, setShown] = useState(LIVE_BATCH_SIZE);
  const [phase, setPhase] = useState<"idle" | "loading" | "end">("idle");
  const phaseRef = useRef<"idle" | "loading" | "end">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const live = useMemo(() => (board ? liveVaults(board) : []), [board]);
  const list = useMemo(
    () => (board ? filterBoard(live, filters, fetchedAt) : []),
    [board, live, filters, fetchedAt],
  );
  const pick = useMemo(() => (board ? heroPick(board) : null), [board]);
  const fresh = useMemo(
    () =>
      board && fetchedAt > 0
        ? new Set(newThisWeek(board.vaults, fetchedAt).map((v) => v.address))
        : new Set<string>(),
    [board, fetchedAt],
  );

  const applyFilters = useCallback((next: BoardFilters) => {
    setFilters(next);
    setShown(LIVE_BATCH_SIZE);
    phaseRef.current = "idle";
    setPhase("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const reveal = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    const total = list.length;
    phaseRef.current = "loading";
    setPhase("loading");
    if (shown >= total) {
      // Nothing left: one spinner beat, then the honest terminal message.
      timerRef.current = setTimeout(() => {
        phaseRef.current = "end";
        setPhase("end");
      }, 700);
      return;
    }
    timerRef.current = setTimeout(() => {
      setShown((current) => nextBatch(current, total));
      phaseRef.current = "idle";
      setPhase("idle");
    }, 600);
  }, [list.length, shown]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || list.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) reveal();
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reveal, list.length]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  if (state === "loading") {
    return (
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="card-hd">
          <span className="t">Curated vaults</span>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Reading Sparky’s board…
        </div>
      </div>
    );
  }

  if (state === "error" || board === null) {
    return (
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="card-hd">
          <span className="t">Curated vaults are unavailable</span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          Sparky couldn’t read the curation record just now. Nothing is wrong with your wallet or
          your funds — this board is a read, and it will come back on its own.
        </div>
      </div>
    );
  }

  const visible = list.slice(0, shown);

  return (
    <div className="vb-board">
      {pick ? <FeatureCard pick={pick} knownVaults={knownVaults} /> : <EmptyState board={board} />}

      <AdminInFlightPanel />

      {list.length > 0 && (
        <>
          <div className="vb-listhead">
            <h2>All live vaults</h2>
            <span className="vb-badge ghosty">wrapped only · {list.length}</span>
          </div>
          <div className="vb-chiprow" role="group" aria-label="Filter live vaults">
            <button
              className={`vb-chip${!filters.newOnly && !filters.aiOnly ? " on" : ""}`}
              onClick={() => applyFilters({ newOnly: false, aiOnly: false })}
            >
              All live
            </button>
            <button
              className={`vb-chip${filters.newOnly ? " on" : ""}`}
              onClick={() => applyFilters({ ...filters, newOnly: !filters.newOnly })}
            >
              New this week
            </button>
            <button
              className={`vb-chip${filters.aiOnly ? " on" : ""}`}
              onClick={() => applyFilters({ ...filters, aiOnly: !filters.aiOnly })}
            >
              AI-curated
            </button>
          </div>
          <div className="vb-grid">
            {visible.map((vault) => (
              <VaultCard
                key={vault.address}
                vault={vault}
                knownVaults={knownVaults}
                isNew={fresh.has(vault.address)}
                isPick={pick?.address === vault.address}
              />
            ))}
          </div>
          {visible.length === 0 && (
            <div className="vb-loadstatus">No live vaults match that filter.</div>
          )}
          <div className="vb-loadstatus" aria-live="polite">
            {phase === "loading" && (
              <>
                <span className="vb-spinner" />
                Loading more vaults…
              </>
            )}
            {phase === "end" && (
              <>You’ve reached the bottom — that’s every live vault Sparky has wrapped.</>
            )}
          </div>
          <div ref={sentinelRef} className="vb-sentinel" aria-hidden="true" />
        </>
      )}

      <div className="vb-boardfoot">
        Figures are as-of the stored scan — no projections. Curation runs off-chain and an admin can
        always override it; AI picks and admin decisions are labelled on each card.
        {hasMore(shown, list.length) ? " Scroll for more live vaults." : ""}
      </div>
    </div>
  );
}
