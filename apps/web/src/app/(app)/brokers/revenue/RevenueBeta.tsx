"use client";

/**
 * The 4663 beta revenue surface (W.4) — where the fees go, and how a holder takes their share out.
 *
 * This is NOT the 044 distributor. There is no epoch document and no Merkle claim on 4663: the
 * engine accrues each asset per round, `deliver()` moves the credit into the immutable BrokerVault
 * keyed by token id, and the broker's current owner calls `withdraw()`. The route below is the
 * real one — Pons curve → RevenueSplitter (90/10) → engine pot → vault → holder — and every step
 * names the function that performs it, so the page's claims are checkable on-chain.
 *
 * ⚠️ Money copy rules, inherited from the legacy revenue page because they are the same rules:
 * nothing on this page projects, annualises or estimates; an empty pot says so as a plain fact;
 * and no number is shown before the chain has answered.
 */

import { useCallback, useMemo, useState } from "react";
import { type Address } from "viem";
import { useAccount } from "wagmi";
import { chainName } from "@sparkpoint/shared/chains";
import {
  AS_IS_DISCLOSURE,
  ENGINE_UPGRADE_NOTE,
  formatAssetAmount,
  REVENUE_ROUTE,
  VAULT_CUSTODY_NOTE,
  type RouteAddressKey,
} from "@/lib/chain/revenueBeta";
import {
  useAssetMeta,
  useBrokerPots,
  useBrokerWithdraw,
  useBrokerVaultHoldings,
  useEngineRounds,
  useSplitterWiring,
} from "@/lib/chain/useBrokerRevenue";
import {
  BROKER_ENGINE_CHAIN,
  useBrokerDeployment,
  useOwnedBrokers,
} from "@/lib/chain/useBrokerEngine";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { useOnTxSuccess } from "@/lib/ui/useOnTxSuccess";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function RevenueBeta() {
  const deployment = useBrokerDeployment();
  const { isConnected, chainId: walletChain } = useAccount();
  const walletReady = isConnected && walletChain === deployment.chainId;
  const { engine, vault, splitter } = deployment;

  const pot = useBrokerPots(engine);
  const rounds = useEngineRounds(engine);
  const wiring = useSplitterWiring(splitter);
  const owned = useOwnedBrokers(deployment);
  const holdings = useBrokerVaultHoldings(
    useMemo(() => owned.mine.map((b) => b.id), [owned.mine]),
    vault,
  );
  const withdrawTx = useBrokerWithdraw(vault);

  // Symbol + decimals for every ERC-20 the page may show (pot rows and vault holdings), read from
  // the tokens themselves. An unread token falls back to raw base units — never a guessed shift.
  const assetMeta = useAssetMeta(
    useMemo(
      () => [
        ...pot.rows.map((r) => r.asset),
        ...holdings.rows.map((r) => r.asset as Address),
      ],
      [pot.rows, holdings.rows],
    ),
  );
  const formatAmount = useCallback(
    (asset: string, amount: bigint) =>
      formatAssetAmount(asset, amount, assetMeta.byAsset.get(asset.toLowerCase())),
    [assetMeta.byAsset],
  );

  const busy = withdrawTx.isSigning || withdrawTx.isMining;
  useHoldCriticalOp(busy, "locked");

  const [notice, setNotice] = useState<string>();
  const [acting, setActing] = useState<number>();

  const refresh = useCallback(() => {
    void owned.refetch();
    void pot.refetch();
    holdings.refetch();
  }, [owned, pot, holdings]);

  const onWithdrawn = useCallback(() => {
    setNotice("Withdrawn. The assets are in your wallet.");
    setActing(undefined);
    refresh();
  }, [refresh]);
  useOnTxSuccess(withdrawTx, onWithdrawn);

  const routeAddress: Record<RouteAddressKey, string | undefined> = {
    curve: deployment.curve,
    feeEscrow: deployment.feeEscrow,
    splitter: deployment.splitter,
    engine: deployment.engine,
    vault: deployment.vault,
    sink: deployment.sink,
  };

  /**
   * What a wallet's brokers can withdraw right now, PER ASSET — the only totals this page ever
   * shows. ⚠️ Summing only ETH would report "nothing to withdraw" over a real ERC-20 holding.
   */
  const withdrawable = useMemo(() => {
    const totals = new Map<string, { asset: Address; amount: bigint }>();
    for (const row of holdings.rows) {
      const key = row.asset.toLowerCase();
      const current = totals.get(key);
      if (current) current.amount += row.amount;
      else totals.set(key, { asset: row.asset as Address, amount: row.amount });
    }
    return [...totals.values()];
  }, [holdings.rows]);

  const withdrawableLabel = useMemo(
    () =>
      withdrawable.length === 0
        ? "nothing to withdraw"
        : `${withdrawable.map((t) => formatAmount(t.asset, t.amount)).join(" + ")} ready`,
    [withdrawable, formatAmount],
  );

  const potLabel = useMemo(() => {
    if (pot.isLoading) return "…";
    if (pot.rows.length === 0) return "…"; // unread — the note below says so
    return pot.rows.map((r) => formatAmount(r.asset, r.amount)).join(" · ");
  }, [pot.isLoading, pot.rows, formatAmount]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Revenue</h1>
          <div className="sub">{AS_IS_DISCLOSURE}</div>
        </div>
      </div>

      {!engine || !vault || !splitter ? (
        <div className="card card-pad">
          <div className="payrow">
            <span className="muted">Revenue on this network</span>
            <span>
              Unavailable — the revenue contracts aren’t wired on {chainName(BROKER_ENGINE_CHAIN)}
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* ── the route ────────────────────────────────────────────────────────── */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="card-hd">
              <span className="t">Where the money goes</span>
              <span className="lbl">{chainName(BROKER_ENGINE_CHAIN)} · on-chain</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              {REVENUE_ROUTE.map((step) => {
                const addr = routeAddress[step.address];
                return (
                  <div key={step.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span
                      className="mono"
                      style={{
                        flex: "0 0 22px",
                        fontSize: 12,
                        color: "var(--muted-foreground)",
                        paddingTop: 2,
                      }}
                    >
                      {step.n}
                    </span>
                    <span>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{step.title}</span>
                      {step.n === 3 && wiring.holderBps !== undefined && wiring.treasuryBps !== undefined && (
                        <>
                          {" "}
                          <span className="tnum" style={{ fontSize: 12.5 }}>
                            · live: {Number(wiring.holderBps) / 100}% / {Number(wiring.treasuryBps) / 100}%
                          </span>
                        </>
                      )}
                      {step.n === 4 && rounds.currentRound !== undefined && rounds.settledRound !== undefined && (
                        <>
                          {" "}
                          <span className="tnum" style={{ fontSize: 12.5 }}>
                            · round {rounds.settledRound.toString()} settled
                            {rounds.currentRound < rounds.settledRound ? " (grid re-syncing)" : ""}
                          </span>
                        </>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted-foreground)",
                          lineHeight: 1.55,
                          marginTop: 2,
                        }}
                      >
                        {step.detail}
                        {addr && explorerAddressUrl(BROKER_ENGINE_CHAIN, addr as Address) && (
                          <>
                            {" "}
                            <a
                              className="mono"
                              href={explorerAddressUrl(BROKER_ENGINE_CHAIN, addr as Address)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "var(--primary)", fontSize: 11 }}
                            >
                              {short(addr)} ↗
                            </a>
                          </>
                        )}
                      </div>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── the pot ──────────────────────────────────────────────────────────── */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="card-hd">
              <span className="t">The pot</span>
              <span className="lbl">
                {rounds.roundSeconds === undefined
                  ? "…"
                  : `round ${Number(rounds.roundSeconds) / 3600}h`}
              </span>
            </div>
            <div className="payrow">
              <span className="muted">Waiting to be settled</span>
              <span className="tnum">{potLabel}</span>
            </div>
            <div className="payrow">
              <span className="muted">Rounds settled</span>
              <span className="tnum">
                {rounds.settledRound === undefined ? "…" : rounds.settledRound.toString()}
              </span>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 11.5,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              The pot is revenue that has arrived but not yet been booked to brokers — ETH and any
              registered ERC-20, each in its own units. `settle()` is permissionless — the runners
              call it at each round boundary, and so can you.
            </div>
            {pot.unread > 0 && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--loss)" }}>
                Some pot readings failed — an asset may be missing above. Nothing is lost; it stays
                in the engine until the next read.
              </div>
            )}
          </div>

          {/* ── what this wallet can withdraw ────────────────────────────────────── */}
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">
                Your brokers{owned.mine.length > 0 ? ` · ${owned.mine.length}` : ""}
              </span>
              <span className="lbl">{withdrawableLabel}</span>
            </div>

            {!isConnected ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Connect a wallet on {chainName(BROKER_ENGINE_CHAIN)} to see what its brokers can
                withdraw.
              </div>
            ) : !walletReady ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Switch to {chainName(BROKER_ENGINE_CHAIN)} to see your balances.
              </div>
            ) : owned.isLoading || holdings.isLoading ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Reading the chain…
              </div>
            ) : owned.mine.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                This wallet holds no broker. Revenue reaches holders through the brokers they hold —
                the vault pays each broker’s owner.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {owned.mine.map((b) => {
                  const rows = holdings.byBroker.get(b.id) ?? [];
                  const assets = rows.map((r) => r.asset as Address);
                  return (
                    <div
                      key={Number(b.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "var(--surface-2)",
                        border: "1px solid var(--border-soft)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="mono" style={{ fontSize: 12.5, minWidth: 56 }}>
                        #{String(Number(b.id)).padStart(4, "0")}
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {b.isActive ? "clocked in" : "idle"}
                        {b.rank !== undefined && b.rank > 0 ? ` · rank ${b.rank}` : ""}
                      </span>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {rows.length === 0
                          ? "nothing banked yet"
                          : rows.map((r) => formatAmount(r.asset, r.amount)).join(" · ")}
                      </span>
                      <span style={{ marginLeft: "auto" }}>
                        <button
                          className="btn btn-primary btn-md"
                          disabled={rows.length === 0 || busy}
                          onClick={() => {
                            setActing(Number(b.id));
                            setNotice(undefined);
                            withdrawTx.withdraw(b.id, assets);
                          }}
                        >
                          {busy && acting === Number(b.id)
                            ? withdrawTx.isSigning
                              ? "Confirm in your wallet…"
                              : "Withdrawing…"
                            : "Withdraw"}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {holdings.unread > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--loss)" }}>
                {holdings.unread} balance {holdings.unread === 1 ? "read" : "reads"} failed — a
                broker’s balance may be missing above. Nothing is lost; it stays in the vault.
              </div>
            )}

            {withdrawTx.error && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--loss)" }}>
                {withdrawTx.error}
              </div>
            )}
            {notice && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--gain)" }}>✓ {notice}</div>
            )}

            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--border-soft)",
                fontSize: 11.5,
                color: "var(--muted-foreground)",
                lineHeight: 1.6,
              }}
            >
              <div>{VAULT_CUSTODY_NOTE}</div>
              <div style={{ marginTop: 6 }}>{ENGINE_UPGRADE_NOTE}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
