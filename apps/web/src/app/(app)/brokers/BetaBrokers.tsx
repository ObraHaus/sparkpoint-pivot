"use client";

/**
 * The 4663 beta broker surface (W.3.4) — the REAL engine state, replacing what used to be a
 * "coming soon" gate on this build.
 *
 * This is not the 043 flow. There is no sale, no activation registry and no SRK: the collection is
 * an OpenSea drop clone and the earning verbs live on the deployed `BrokerEngine`. A holder signs
 * three things here, each against live reads:
 *
 *   • **Clock in** — burns `clockInBurn` utility tokens through the engine; a broker then earns.
 *   • **Promote** — rank 2 or 3; charges only the difference the rank has not burned yet.
 *   • **Fuse** — two or three owned brokers become one; the first survives, the rest are BURNED.
 *     Requires an ERC-721 operator approval so the engine can burn the absorbed tokens.
 *
 * Everything irreversible is stated before the signature: fusion permanently shrinks the
 * collection, and clocking in burns again on every re-activation after a sale. Activation state is
 * read from the chain on every load and never cached as a flag — "a stranger keeps the access the
 * broker was sold with" is the one bug this system exists to prevent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, type Address } from "viem";
import { useAccount } from "wagmi";
import { chainName } from "@sparkpoint/shared/chains";
import {
  deriveClockIn,
  deriveFuse,
  derivePromote,
  FUSE_MAX_PARTS,
  fuseBurnFor,
  nextRanks,
  promoteBurnDue,
  rankLabel,
  RANK_ASSOCIATE,
} from "@/lib/chain/brokerEngine";
import {
  BROKER_ENGINE_CHAIN,
  useApproveEngineNft,
  useApproveEngineSpend,
  useBrokerBurnPrices,
  useBrokerCollection,
  useBrokerDeployment,
  useBrokerEngineStates,
  useBrokerPot,
  useBurnPosition,
  useClockIn,
  useFuse,
  usePromote,
  type BetaBroker,
  type BrokerBurnPrices,
} from "@/lib/chain/useBrokerEngine";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { useIndexedBrokers } from "@/lib/chain/useIndexedBrokers";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

/** The same bound the legacy page uses: a browser scan of `1..totalSupply`, never unbounded. */
const SCAN_LIMIT = 500;

/**
 * A burn, quoted EXACTLY as the engine will charge it.
 *
 * ⚠️ The beta burn schedule is denominated in base units and the LIVE values are single digits
 * (1 / 1, 2, 3 / 2, 3) — rescaling by the token's 18 decimals would render `0.000000000000000001`.
 * The app must never quote an amount different from the one `burnFrom` is called with.
 */
function formatBurn(amount: bigint | undefined, symbol: string | undefined): string {
  if (amount === undefined || symbol === undefined) return "…";
  return `${amount.toLocaleString("en-US")} ${symbol}`;
}

function shortId(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

/** Fire `onDone` once per confirmed transaction, then clear the write state so it cannot refire. */
function useOnSuccess(tx: { isSuccess: boolean; reset: () => void }, onDone: () => void) {
  const { isSuccess, reset } = tx;
  useEffect(() => {
    if (!isSuccess) return;
    onDone();
    reset();
  }, [isSuccess, reset, onDone]);
}

export function BetaBrokers() {
  const deployment = useBrokerDeployment();
  const { address, isConnected, chainId: walletChain } = useAccount();
  const walletReady = isConnected && walletChain === deployment.chainId;
  const { nft, engine, token } = deployment;

  const collection = useBrokerCollection(nft);
  const prices = useBrokerBurnPrices(engine);
  const position = useBurnPosition(deployment);
  const pot = useBrokerPot(engine);

  // Ownership: the indexer when it can answer (scales to 5,555), the bounded `1..totalSupply` scan
  // otherwise (survives an agent outage). Same two-path discipline as the legacy gallery.
  const indexed = useIndexedBrokers(walletReady);
  const scanIds = useMemo(() => {
    if (collection.totalSupply === undefined) return [];
    const count = Number(
      collection.totalSupply > BigInt(SCAN_LIMIT) ? BigInt(SCAN_LIMIT) : collection.totalSupply,
    );
    return Array.from({ length: count }, (_, i) => BigInt(i + 1));
  }, [collection.totalSupply]);
  const ids = useMemo(() => {
    if (indexed.ids !== undefined) return indexed.ids.map((n) => BigInt(n));
    return indexed.source === "scan" ? scanIds : [];
  }, [indexed.ids, indexed.source, scanIds]);

  const states = useBrokerEngineStates(ids, deployment);
  const { refetch: refetchStates } = states;
  const { refetch: refetchPosition } = position;
  const { refetch: refetchPot } = pot;
  const { refetch: refetchCollection } = collection;

  const mine = useMemo(() => {
    if (!address) return [];
    const want = address.toLowerCase();
    return states.brokers.filter(
      (b) => b.owner !== undefined && b.owner.toLowerCase() === want && !b.absorbed,
    );
  }, [states.brokers, address]);

  const clockInTx = useClockIn(deployment);
  const promoteTx = usePromote(deployment);
  const fuseTx = useFuse(deployment);
  const approveTx = useApproveEngineSpend(deployment);
  const approveNftTx = useApproveEngineNft(deployment);

  const busy =
    clockInTx.isSigning ||
    clockInTx.isMining ||
    promoteTx.isSigning ||
    promoteTx.isMining ||
    fuseTx.isSigning ||
    fuseTx.isMining ||
    approveTx.isSigning ||
    approveTx.isMining ||
    approveNftTx.isSigning ||
    approveNftTx.isMining;
  useHoldCriticalOp(busy, "locked");

  const [notice, setNotice] = useState<string>();
  const [selected, setSelected] = useState<number[]>([]);

  const refresh = useCallback(() => {
    void refetchStates();
    void refetchPosition();
    void refetchPot();
    void refetchCollection();
  }, [refetchStates, refetchPosition, refetchPot, refetchCollection]);

  const note = useCallback((msg: string) => {
    setNotice(msg);
    setSelected([]);
  }, []);

  const onClockInDone = useCallback(() => {
    note("Clocked in. It earns from the next settled round.");
    refresh();
  }, [note, refresh]);
  const onPromoteDone = useCallback(() => {
    note("Promoted. The new weight starts from the next round.");
    refresh();
  }, [note, refresh]);
  const onFuseDone = useCallback(() => {
    note("Fused. The absorbed brokers are burned and gone.");
    refresh();
  }, [note, refresh]);
  const onApproveDone = useCallback(() => {
    note("Approved. The allowance is in place.");
    refresh();
  }, [note, refresh]);
  const onApproveNftDone = useCallback(() => {
    note("Collection approved. Fusion can burn the absorbed brokers now.");
    refresh();
  }, [note, refresh]);

  useOnSuccess(clockInTx, onClockInDone);
  useOnSuccess(promoteTx, onPromoteDone);
  useOnSuccess(fuseTx, onFuseDone);
  useOnSuccess(approveTx, onApproveDone);
  useOnSuccess(approveNftTx, onApproveNftDone);

  const error =
    clockInTx.error ??
    promoteTx.error ??
    fuseTx.error ??
    approveTx.error ??
    approveNftTx.error;

  const toggle = (id: number) => {
    setNotice(undefined);
    setSelected((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= FUSE_MAX_PARTS
          ? cur
          : [...cur, id],
    );
  };

  const selectedBrokers = useMemo(
    () => selected.map((id) => mine.find((b) => b.id === BigInt(id))),
    [selected, mine],
  );
  const allSelectedOwned = selected.length > 0 && selectedBrokers.every((b) => b !== undefined);
  const fuseBurn = fuseBurnFor(selected.length, prices.prices);
  const fuseVerdict = deriveFuse({
    engine,
    token,
    ids: selected,
    allOwned: allSelectedOwned,
    anyAlreadyFused: selectedBrokers.some((b) => b !== undefined && (b.parts ?? 0) !== 0),
    nftApproved: position.nftApproved,
    burn: fuseBurn,
    balance: position.balance,
    allowance: position.allowance,
    symbol: position.symbol,
    walletReady,
  });

  const supplyLabel =
    collection.totalSupply === undefined || collection.maxSupply === undefined
      ? "…"
      : `${collection.totalSupply.toLocaleString()} of ${collection.maxSupply.toLocaleString()} exist`;
  const truncated =
    indexed.source === "scan" &&
    collection.totalSupply !== undefined &&
    collection.totalSupply > BigInt(SCAN_LIMIT);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Sparky Broker</h1>
          <div className="sub">
            Hold a broker, then clock it in — that is what puts it to work. Clocking in burns{" "}
            {formatBurn(prices.prices.clockIn, position.symbol)} through the
            engine, and a sale clears it: the next owner clocks their own.
          </div>
        </div>
      </div>

      {!nft || !engine || !token ? (
        <div className="card card-pad">
          <div className="payrow">
            <span className="muted">Sparky Broker on this network</span>
            <span>Unavailable — the broker contracts aren’t wired on {chainName(BROKER_ENGINE_CHAIN)}</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── the floor: collection + pot ──────────────────────────────────────── */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="card-hd">
              <span className="t">The floor</span>
              <span className="lbl">{chainName(BROKER_ENGINE_CHAIN)}</span>
            </div>

            <div className="payrow">
              <span className="muted">Supply</span>
              <span className="tnum">{supplyLabel}</span>
            </div>
            <div className="payrow">
              <span className="muted">Clocking in burns</span>
              <span className="tnum">
                {formatBurn(prices.prices.clockIn, position.symbol)} each time
              </span>
            </div>
            <div className="payrow">
              <span className="muted">Promotions burn</span>
              <span className="tnum">
                Associate {formatBurn(prices.prices.associate, position.symbol)}{" "}
                · Partner {formatBurn(prices.prices.partner, position.symbol)}
              </span>
            </div>
            <div className="payrow">
              <span className="muted">Revenue waiting to settle</span>
              <span className="tnum">
                {pot.eth === undefined ? "…" : `${formatEther(pot.eth)} ETH`}
              </span>
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 11.5,
                color: "var(--muted-foreground)",
                lineHeight: 1.55,
              }}
            >
              The collection mints on OpenSea. Holding one is the start; each broker then earns in
              proportion to the weight its rank records — and nothing renews.
            </div>
          </div>

          {/* ── your brokers ─────────────────────────────────────────────────────── */}
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Your brokers{mine.length > 0 ? ` · ${mine.length}` : ""}</span>
              {mine.length > 0 && (
                <span className="lbl">
                  {mine.filter((b) => b.isActive).length} of {mine.length} clocked in
                </span>
              )}
            </div>

            {!isConnected ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Connect a wallet to see the brokers you hold.
              </div>
            ) : indexed.source === "loading" || collection.totalSupply === undefined ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Reading the chain…
              </div>
            ) : collection.totalSupply === 0n ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                No broker exists yet — the drop hasn’t minted. Once you hold one, it shows up here
                to clock in.
              </div>
            ) : states.isLoading ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Reading the chain…
              </div>
            ) : mine.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                You don’t hold a broker yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {mine.map((b) => (
                  <BrokerRow
                    key={Number(b.id)}
                    broker={b}
                    engine={engine}
                    token={token}
                    prices={prices.prices}
                    symbol={position.symbol}
                    balance={position.balance}
                    allowance={position.allowance}
                    walletReady={walletReady}
                    busy={busy}
                    selected={selected.includes(Number(b.id))}
                    onToggle={() => toggle(Number(b.id))}
                    onClockInApproval={() => approveTx.approve(prices.prices.clockIn ?? 0n)}
                    onClockIn={() => clockInTx.clockIn(b.id)}
                    onPromoteApproval={(due) => approveTx.approve(due)}
                    onPromote={(target) => promoteTx.promote(b.id, target)}
                  />
                ))}
              </div>
            )}

            {truncated && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--loss)" }}>
                Showing brokers among the first {SCAN_LIMIT.toLocaleString()} minted only — this
                list is incomplete.
              </div>
            )}

            {/* ── the fuse bench ──────────────────────────────────────────────────── */}
            {selected.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border-soft)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontWeight: 620, fontSize: 14 }}>
                    Fuse {selected.length} broker{selected.length > 1 ? "s" : ""}
                  </span>
                  <button
                    className="btn btn-md"
                    type="button"
                    onClick={() => setSelected([])}
                    disabled={busy}
                  >
                    Clear
                  </button>
                </div>

                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
                  {selected.length < 2 ? (
                    <>Pick one more. The first picked survives; every other one is burned forever.</>
                  ) : (
                    <>
                      <b className="mono">{shortId(selected[0])}</b> survives.{" "}
                      {selected
                        .slice(1)
                        .map(shortId)
                        .join(" and ")}{" "}
                      {selected.length === 2 ? "is" : "are"} burned forever — the collection
                      permanently shrinks, and their banked earnings move to the survivor.
                    </>
                  )}
                </div>

                <div className="payrow" style={{ marginTop: 8 }}>
                  <span className="muted">Fusing burns</span>
                  <span className="tnum">
                    {formatBurn(fuseBurn, position.symbol)}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  {fuseVerdict.needsApproval && fuseVerdict.short === 0n && (
                    <button
                      className="btn btn-md"
                      disabled={busy || fuseBurn === undefined}
                      onClick={() => approveTx.approve(fuseBurn ?? 0n)}
                    >
                      Approve {formatBurn(fuseBurn, position.symbol)} to the engine
                    </button>
                  )}
                  {fuseVerdict.needsNftApproval && (
                    <button
                      className="btn btn-md"
                      disabled={busy || !allSelectedOwned}
                      onClick={() => approveNftTx.approveNft(true)}
                    >
                      Approve the collection (once)
                    </button>
                  )}
                  <button
                    className="btn btn-primary btn-md"
                    disabled={!fuseVerdict.canSubmit || busy}
                    onClick={() => fuseTx.fuse(selected.map((id) => BigInt(id)))}
                    title={fuseVerdict.blockedReason}
                  >
                    {fuseTx.isSigning
                      ? "Confirm in your wallet…"
                      : fuseTx.isMining
                        ? "Fusing…"
                        : `Fuse ${selected.length} brokers`}
                  </button>
                </div>

                {fuseVerdict.needsNftApproval && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      lineHeight: 1.5,
                    }}
                  >
                    Approving the whole collection is the only ERC-721 lever there is — revoke it
                    from your wallet when you’re done fusing.
                  </div>
                )}
                {!fuseVerdict.canSubmit && !fuseVerdict.needsNftApproval && fuseVerdict.blockedReason && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
                    {fuseVerdict.blockedReason}
                  </div>
                )}
              </div>
            )}

            {notice && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--gain)" }}>✓ {notice}</div>
            )}
            {error && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--loss)" }}>{error}</div>
            )}

            {nft && (
              <div className="payrow" style={{ marginTop: 12 }}>
                <span className="muted">Collection</span>
                {explorerAddressUrl(BROKER_ENGINE_CHAIN, nft) ? (
                  <a
                    className="mono"
                    href={explorerAddressUrl(BROKER_ENGINE_CHAIN, nft)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--primary)", fontSize: 11 }}
                  >
                    {nft.slice(0, 6)}…{nft.slice(-4)} ↗
                  </a>
                ) : (
                  <span className="mono" style={{ fontSize: 11 }}>
                    {nft.slice(0, 6)}…{nft.slice(-4)}
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface BrokerRowProps {
  readonly broker: BetaBroker;
  readonly engine: Address;
  readonly token: Address;
  readonly prices: BrokerBurnPrices;
  readonly symbol: string | undefined;
  readonly balance: bigint | undefined;
  readonly allowance: bigint | undefined;
  readonly walletReady: boolean;
  readonly busy: boolean;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly onClockInApproval: () => void;
  readonly onClockIn: () => void;
  readonly onPromoteApproval: (due: bigint) => void;
  readonly onPromote: (target: number) => void;
}

function BrokerRow(p: BrokerRowProps) {
  const { broker: b } = p;
  const rank = b.rank ?? 0;
  const target = nextRanks(rank)[0];
  const targetPrice = target === RANK_ASSOCIATE ? p.prices.associate : p.prices.partner;
  const due =
    targetPrice !== undefined && b.tierBurned !== undefined
      ? promoteBurnDue(targetPrice, b.tierBurned)
      : undefined;

  const clockIn = deriveClockIn({
    engine: p.engine,
    token: p.token,
    owns: true,
    alreadyActive: b.isActive,
    burn: p.prices.clockIn,
    balance: p.balance,
    allowance: p.allowance,
    symbol: p.symbol,
    walletReady: p.walletReady,
  });

  const promote = derivePromote({
    engine: p.engine,
    token: p.token,
    owns: true,
    rank: b.rank,
    target,
    due,
    balance: p.balance,
    allowance: p.allowance,
    symbol: p.symbol,
    walletReady: p.walletReady,
  });

  const weight = b.isActive ? b.weight : b.potentialWeight;
  // The hint explains the FIRST thing standing in the way of the row's primary action. An active
  // broker's clock-in verdict is always blocked ("already clocked in"), so it is never the hint.
  const hint =
    b.isActive === false && !clockIn.canSubmit
      ? clockIn.blockedReason
      : target !== undefined && !promote.canSubmit
        ? promote.blockedReason
        : undefined;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: p.selected ? "var(--gold-subtle)" : "var(--surface-2)",
        border: `1px solid ${p.selected ? "var(--warn)" : "var(--border-soft)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={p.onToggle}
          disabled={p.busy}
          aria-pressed={p.selected}
          title="Pick for fusion — the first picked survives"
          className="mono"
          style={{
            fontSize: 12.5,
            minWidth: 56,
            textAlign: "left",
            cursor: p.busy ? "default" : "pointer",
            background: "none",
            border: "none",
            color: "inherit",
            padding: 0,
          }}
        >
          {p.selected ? "◉" : "◯"} {shortId(Number(b.id))}
        </button>

        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            {rankLabel(rank)}
          </span>
          {(b.parts ?? 0) > 0 && (
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                padding: "2px 6px",
                borderRadius: 999,
                border: "1px solid var(--border-soft)",
                color: "var(--muted-foreground)",
              }}
              title="Made by a fusion — it cannot be absorbed again"
            >
              fused
            </span>
          )}
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 999,
              fontWeight: b.isActive ? 700 : 400,
              background: b.isActive ? "var(--warn)" : "transparent",
              color: b.isActive ? "#0B1120" : "var(--muted-foreground)",
              border: b.isActive ? "none" : "1px solid var(--border-soft)",
            }}
          >
            {b.isActive ? "clocked in" : "idle"}
          </span>
        </span>

        <span className="muted" style={{ fontSize: 11.5 }}>
          weight {weight === undefined ? "…" : weight.toString()} · earned{" "}
          {b.earnedEth === undefined ? "…" : `${formatEther(b.earnedEth)} ETH`}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!b.isActive &&
            (clockIn.needsApproval && clockIn.short === 0n ? (
              <button
                className="btn btn-md"
                disabled={p.busy || p.prices.clockIn === undefined}
                onClick={p.onClockInApproval}
              >
                Approve {formatBurn(p.prices.clockIn, p.symbol)}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-md"
                disabled={!clockIn.canSubmit || p.busy}
                onClick={p.onClockIn}
                title={clockIn.blockedReason}
              >
                Clock in
              </button>
            ))}
          {target !== undefined &&
            (promote.needsApproval && promote.short === 0n ? (
              <button
                className="btn btn-md"
                disabled={p.busy || due === undefined}
                onClick={() => p.onPromoteApproval(due ?? 0n)}
              >
                Approve {formatBurn(due, p.symbol)}
              </button>
            ) : (
              <button
                className="btn btn-md"
                disabled={!promote.canSubmit || p.busy}
                onClick={() => p.onPromote(target)}
                title={promote.blockedReason}
              >
                Promote to {rankLabel(target)}
              </button>
            ))}
        </span>
      </div>

      {hint && (p.balance !== undefined || b.isActive === false || !p.walletReady) && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11.5,
            color: "var(--muted-foreground)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
