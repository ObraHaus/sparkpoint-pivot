"use client";

/**
 * 048 / T301 — wireframe A + C: the curated board (hero pick + table + provenance) with a chat
 * entry point ("Ask Sparky about vaults") that opens the assistant with the question prefilled.
 *
 * Everything here is DISPLAY over the agent's stored record: approval, publication and pins are
 * admin decisions, and the board never merges candidates into the public list. When there is
 * nothing to show it says so — the empty state is deliberate product copy, not a placeholder.
 *
 * Deposit routing (T303) is decided by `depositRail`: a wrapped vault goes to the wrapper deposit
 * with the performance-fee disclosure, an unwrapped one is a direct ERC-4626 deposit (no SparkPoint
 * fee) — and a claimed-but-undeployed wrapper is an honest "not yet", never a dead CTA.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import {
  boardEmptyCopy,
  boardIsEmpty,
  boardProvenance,
  chatAskHref,
  filterVaults,
  provenanceChip,
} from "@/lib/curation/board";
import { depositRail, type KnownVault } from "@/lib/curation/depositRail";
import {
  curatorLabel,
  fmtAge,
  fmtApyBps,
  fmtUsdCompact,
  newThisWeek,
  shortAddr,
  type CurationBoard as Board,
  type CurationVault,
} from "@/lib/curation/model";
import "@/components/screens/vault.css";

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
      <a
        className={className}
        href={rail.href}
        target="_blank"
        rel="noreferrer"
        title={rail.disclosure}
      >
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

function PickHero({ pick, knownVaults }: { pick: CurationVault; knownVaults: KnownVault[] }) {
  const rail = depositRail(pick, knownVaults, explorerAddressUrl);
  return (
    <div className="card card-pad" id="pick">
      <div className="card-hd">
        <span className="lbl">Sparky’s pick today</span>
        <span className="badge badge-ai">AI-curated</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.01em" }}>{pick.label}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {curatorLabel(pick)} · {pick.asset.symbol ?? "—"} ·{" "}
            <span className="mono">{shortAddr(pick.address)}</span>
            {pick.pinned ? " · pinned by an admin" : ""}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted-foreground)",
              marginTop: 12,
              maxWidth: 560,
              lineHeight: 1.55,
            }}
          >
            {pick.reason}
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 150 }}>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.02em" }} className="tnum">
            {fmtApyBps(pick.netApyBps)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            net APY · as stored
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            TVL {fmtUsdCompact(pick.tvlUsd)} · Score {pick.score ?? "—"}
          </div>
        </div>
      </div>
      <div className="divider" style={{ margin: "14px 0" }} />
      {rail.kind === "wrapper-pending" ? (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          {rail.note}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <RailCta vault={pick} knownVaults={knownVaults} className="btn btn-primary btn-md" />
          <Link className="btn btn-outline btn-md" href={chatAskHref()}>
            Ask Sparky about vaults
          </Link>
        </div>
      )}
      {rail.kind !== "wrapper-pending" && (
        <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
          {rail.disclosure}
        </div>
      )}
    </div>
  );
}

function EmptyBoard({ board }: { board: Board }) {
  const { title, body } = boardEmptyCopy(board);
  return (
    <div className="card card-pad">
      <div className="card-hd">
        <span className="t">{title}</span>
        <span className="lbl">curation is off-chain</span>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>{body}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <Link className="btn btn-outline btn-md" href={chatAskHref()}>
          Ask Sparky about vaults
        </Link>
        <span className="muted" style={{ fontSize: 12 }}>
          {boardProvenance(board)}
        </span>
      </div>
    </div>
  );
}

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
  const [query, setQuery] = useState("");
  const [newOnly, setNewOnly] = useState(false);

  const newAddresses = useMemo(() => {
    if (!board || fetchedAt === 0) return new Set<string>();
    return new Set(newThisWeek(board.vaults, fetchedAt).map((v) => v.address));
  }, [board, fetchedAt]);

  // `fetchedAt` is state stamped by the hook when the board arrived — never `Date.now()` in a
  // render, which is impure and trips the purity lint.
  const rows = useMemo(
    () => (board ? filterVaults(board.vaults, { query, newOnly }, fetchedAt) : []),
    [board, query, newOnly, fetchedAt],
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

  if (boardIsEmpty(board)) {
    return (
      <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
        <EmptyBoard board={board} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
      {board.pick && <PickHero pick={board.pick} knownVaults={knownVaults} />}

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Curated list</span>
          <span className="prov">
            {boardProvenance(board)} · {board.vaults.length} approved
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="Filter by name, symbol or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={newOnly}
              onChange={(e) => setNewOnly(e.target.checked)}
            />
            New this week
          </label>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 760 }}>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Asset</th>
                <th>Net APY</th>
                <th>TVL</th>
                <th>Curator</th>
                <th>Age</th>
                <th>Provenance</th>
                <th>Deposit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                    No vaults match that filter.
                  </td>
                </tr>
              ) : (
                rows.map((v) => {
                  const chip = provenanceChip(v);
                  return (
                    <tr key={v.address} id={`vault-${v.address}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {v.label}
                          {newAddresses.has(v.address) && (
                            <span className="pill info" style={{ marginLeft: 8 }}>
                              new
                            </span>
                          )}
                        </div>
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {shortAddr(v.address)}
                        </div>
                      </td>
                      <td className="mono">{v.asset.symbol ?? "—"}</td>
                      <td className="mono tnum">{fmtApyBps(v.netApyBps)}</td>
                      <td className="mono tnum">{fmtUsdCompact(v.tvlUsd)}</td>
                      <td>{curatorLabel(v)}</td>
                      <td className="muted">{fmtAge(v.ageSeconds)}</td>
                      <td>
                        <span className={`pill ${chip.tone}`}>{chip.label}</span>
                      </td>
                      <td>
                        <RailCta vault={v} knownVaults={knownVaults} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
          Figures are as-of the stored scan — no projections. Curation runs off-chain and an admin
          can always override it; AI picks and admin decisions are labelled per row.
        </div>
      </div>
    </div>
  );
}
