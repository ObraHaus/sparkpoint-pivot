"use client";

/**
 * InlineSwapConfirm — a FUNCTIONAL, non-custodial swap rendered inline in the chat thread (007 · US4).
 *
 * Reuses the SAME engines as `/swap`: `useSwapConfirm` (token-generic resolver → live quote + `SwapExec`)
 * and `useExecuteSwapTx` (user-signed). ETH + USDC are one-tap recommended tokens, but the user — OR the
 * assistant (via a proposed token pair) — can pick ANY ERC-20 on either leg; it is read from-chain, routed
 * single- or multi-hop, and charged the same 0.20% fee. Safety is at the SIGNING gate: a non-recommended
 * receive-token shows its address + verified/unverified badge and needs an "I understand" ack. An
 * assistant-proposed token is unverified by default. A proposal for a different network prompts a switch
 * rather than quoting on the wrong chain. SparkPoint never holds a key or custody.
 */

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import type { TokenRef } from "@sparkpoint/shared/schemas";
import { Icon } from "@/lib/icons";
import { Seg } from "@/components/ui/seg";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { useSwapConfirm } from "@/lib/swap/useSwapConfirm";
import { useExecuteSwapTx } from "@/lib/swap/useExecuteSwapTx";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { swapTokens, type SwapToken } from "@/lib/swap/tokens";
import { resolveErc20 } from "@/lib/swap/metadata";
import { isVerifiedAddress, findVerifiedBySymbol } from "@/lib/swap/tokenList";
import { TokenPicker } from "@/components/screens/swap/TokenPicker";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { formatBpsPercent, ROUTING_FEE_BIPS, SLIPPAGE_PRESETS_BPS } from "@/lib/swap/math";

const DASH = "—";
const DISPLAY_CHAIN_ID = 84532;
/** Keep a little native ETH for gas when the user taps "Max" on an ETH-in swap. */
const ETH_GAS_BUFFER = 10n ** 15n; // 0.001 ETH
const MUTED = "var(--muted-foreground)";

const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const netName = (id?: number) => (id === 46630 ? "Robinhood Testnet" : id === 8453 ? "Base" : id === 84532 ? "Base Sepolia" : `chain ${id ?? "?"}`);

function defaultTokens(chainId: number | undefined): { tin?: SwapToken; tout?: SwapToken } {
  const rec = swapTokens(chainId);
  return { tin: rec.find((t) => t.isNative) ?? rec[0], tout: rec.find((t) => !t.isNative) ?? rec[1] };
}

function fmt(v: bigint | undefined, decimals: number, max = 6): string {
  if (v === undefined) return DASH;
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ color: tone === "caution" ? "var(--caution)" : "var(--foreground)", fontWeight: 500 }}>{v}</span>
    </div>
  );
}

function Notice({ children, tone = "caution" }: { children: React.ReactNode; tone?: "caution" | "info" }) {
  const c = tone === "info" ? "var(--info)" : "var(--caution)";
  return (
    <div
      style={{
        marginTop: 12,
        fontSize: 12.5,
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

function PickerButton({ token, chainId, onClick }: { token?: SwapToken; chainId?: number; onClick: () => void }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, border: "1px solid var(--border)" }}
    >
      {token && <TokenLogo token={token} chainId={chainId} size={18} />}
      {token?.symbol ?? "Select"}
      <Icon name="chevron-down" size={12} />
    </button>
  );
}

export function InlineSwapConfirm({
  ethToUsdc: initialEthToUsdc,
  amountIn: initialAmountIn,
  slippageBps: initialSlippage,
  tokenIn: propIn,
  tokenOut: propOut,
  chainId: propChainId,
}: {
  ethToUsdc?: boolean;
  amountIn?: bigint;
  slippageBps?: number;
  tokenIn?: TokenRef;
  tokenOut?: TokenRef;
  chainId?: number;
}) {
  const { isConnected, chainId } = useAccount();
  const activeChain = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const chainMismatch = propChainId !== undefined && activeChain !== undefined && propChainId !== activeChain;

  const init = defaultTokens(DISPLAY_CHAIN_ID);
  const [tokenIn, setTokenIn] = useState<SwapToken | undefined>(init.tin);
  const [tokenOut, setTokenOut] = useState<SwapToken | undefined>(init.tout);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(initialSlippage ?? SLIPPAGE_PRESETS_BPS[0]);
  const [reviewing, setReviewing] = useState(false);
  const [ackUnverified, setAckUnverified] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  // Resolve the assistant-proposed pair on-chain (or fall back to recommended defaults), keyed to the
  // wallet's chain. setState runs only inside the async body (after awaits), so it syncs to external
  // systems (RPC) rather than firing synchronously in the effect. Skipped on a chain mismatch.
  useEffect(() => {
    if (chainMismatch) return;
    let cancelled = false;
    void (async () => {
      const rec = swapTokens(activeChain);
      const recEth = rec.find((t) => t.isNative);
      const recUsdc = rec.find((t) => !t.isNative);
      const resolveRef = async (ref?: TokenRef): Promise<SwapToken | undefined> => {
        if (!ref) return undefined;
        const match = rec.find((t) => eqAddr(t.address, ref.address)); // a recommended token?
        if (match) return match;
        const res = await resolveErc20(activeChain ?? DISPLAY_CHAIN_ID, ref.address); // on-chain (decimals authoritative)
        return res.ok
          ? { symbol: res.token.symbol, name: res.token.name, address: res.token.address, decimals: res.token.decimals, isNative: false, source: "imported", verified: isVerifiedAddress(activeChain ?? 0, res.token.address) }
          : undefined;
      };

      if (propIn || propOut) {
        const [ti, to] = await Promise.all([resolveRef(propIn), resolveRef(propOut)]);
        if (cancelled) return;
        setTokenIn(ti ?? recEth);
        setTokenOut(to ?? recUsdc);
      } else {
        if (cancelled) return;
        const eth = initialEthToUsdc ?? true;
        setTokenIn(eth ? recEth : recUsdc);
        setTokenOut(eth ? recUsdc : recEth);
      }
      // Seed the amount ONLY for a native-ETH input (18-dp, chain-agnostic). For any other input token the
      // agent's base-units amount can't be trusted (decimals vary/unknown) — the user types it, and the web
      // scales it with the on-chain decimals. Mirrors the original card's ETH-only seeding.
      const inIsNative = (propIn ? eqAddr(propIn.address, recEth?.address) : (initialEthToUsdc ?? true));
      setAmount(initialAmountIn && initialAmountIn > 0n && inIsNative ? formatUnits(initialAmountIn, 18) : "");
      setReviewing(false);
      setAckUnverified(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChain, chainMismatch, propIn?.address, propOut?.address, initialEthToUsdc, initialAmountIn]);

  const s = useSwapConfirm({ tokenIn, tokenOut, amount, slippageBps });
  const swapCtrl = useExecuteSwapTx(reviewing ? s.exec : undefined);
  // Feature 006: pause the force-refresh while an in-chat swap is signing/broadcasting (LOCKED).
  useHoldCriticalOp(swapCtrl.isBusy, "locked");
  const { quote, netOut, netMinOut, feeAmount } = s;

  // Safety gate — a non-recommended (unverified) receive-token must be acknowledged before confirming.
  const outUnverified = !!tokenOut && !tokenOut.isNative && !tokenOut.verified;
  const outCollision = outUnverified ? findVerifiedBySymbol(activeChain ?? 0, tokenOut!.symbol) : undefined;
  const outCollisionMismatch = !!outCollision && !eqAddr(outCollision.address, tokenOut!.address);
  const safetyGateOk = !outUnverified || ackUnverified;

  const onMax = () => {
    if (!tokenIn || s.balanceIn === undefined) return;
    const usable = tokenIn.isNative ? (s.balanceIn > ETH_GAS_BUFFER ? s.balanceIn - ETH_GAS_BUFFER : 0n) : s.balanceIn;
    setAmount(formatUnits(usable, tokenIn.decimals));
    setReviewing(false);
  };
  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount("");
    setReviewing(false);
    setAckUnverified(false);
  };
  const onPick = (side: "in" | "out", token: SwapToken) => {
    if (side === "in") {
      if (eqAddr(token.address, tokenOut?.address)) setTokenOut(tokenIn);
      setTokenIn(token);
    } else {
      if (eqAddr(token.address, tokenIn?.address)) setTokenIn(tokenOut);
      setTokenOut(token);
      setAckUnverified(false);
    }
    setReviewing(false);
  };

  const canConfirm =
    s.canQuote && quote.amountOut !== undefined && !s.insufficient && s.amountIn > 0n && !s.feeRecipientPending && safetyGateOk;

  // A proposal for a different network — ask to switch rather than quoting on the wrong chain.
  if (chainMismatch) {
    return (
      <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
        <div className="cf-hd">
          <div style={{ fontSize: 16, fontWeight: 600 }}>Swap</div>
        </div>
        <div className="cf-sec">
          <Notice tone="info">
            This swap is for <b>{netName(propChainId)}</b>, but your wallet is on <b>{netName(activeChain)}</b>. Switch your
            wallet network to <b>{netName(propChainId)}</b> to review and sign it.
          </Notice>
        </div>
      </div>
    );
  }

  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
      {pickerFor && (
        <TokenPicker
          chainId={activeChain}
          exclude={pickerFor === "in" ? tokenOut?.address : tokenIn?.address}
          onSelect={(t) => onPick(pickerFor, t)}
          onClose={() => setPickerFor(null)}
        />
      )}
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Swap</div>
          <span style={{ fontSize: 11.5, color: MUTED }}>{s.uniswapVenue} · {s.netLabel}</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          Non-custodial — you review the quote and sign from your own wallet. <b>Sparky can&apos;t move your funds.</b>
        </div>
      </div>

      <div className="cf-sec" style={{ display: "grid", gap: 10 }}>
        {swapCtrl.isDone ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <span style={{ color: "var(--gain)" }}><Icon name="check" size={18} /></span> Swap confirmed
            </div>
            <div style={{ fontSize: 13 }}>
              You swapped {amount} {tokenIn?.symbol} for {tokenOut?.symbol}.
            </div>
            {(() => {
              const url = explorerTxUrl(s.activeChain, swapCtrl.txHash);
              return url ? (
                <a className="cite" href={url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4 }}>
                  View transaction <Icon name="ext" size={11} />
                </a>
              ) : null;
            })()}
            <button
              className="btn btn-ghost btn-sm"
              style={{ justifySelf: "start", marginTop: 2 }}
              onClick={() => {
                swapCtrl.reset();
                setReviewing(false);
                setAmount("");
              }}
            >
              New swap
            </button>
          </div>
        ) : !reviewing ? (
          <>
            {/* Amount + pay token */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                placeholder="0.0"
                onChange={(e) => {
                  setAmount(e.target.value);
                  setReviewing(false);
                }}
                style={{
                  flex: 1, minWidth: 0, fontSize: 18, fontWeight: 600, padding: "8px 10px",
                  background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
                  color: "var(--foreground)", outline: "none",
                }}
              />
              <PickerButton token={tokenIn} chainId={activeChain} onClick={() => setPickerFor("in")} />
              <button className="btn btn-ghost btn-sm" onClick={onMax} disabled={s.balanceIn === undefined}>Max</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>
                Balance: {tokenIn ? fmt(s.balanceIn, tokenIn.decimals) : DASH} {tokenIn?.symbol}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                title="Flip direction"
                onClick={flip}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="swap" size={14} /> Flip
              </button>
            </div>

            {/* Receive token */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13 }}>
                You receive {s.feeActive ? "(est., after fee)" : "(est.)"}:{" "}
                <b>
                  {s.canQuote && netOut !== undefined && tokenOut ? fmt(netOut, tokenOut.decimals) : (quote.isLoading ? "…" : DASH)}
                </b>
              </span>
              <PickerButton token={tokenOut} chainId={activeChain} onClick={() => setPickerFor("out")} />
            </div>

            {/* Unverified receive-token safety (also gates Confirm) */}
            {outUnverified && tokenOut && (
              <Notice>
                <div style={{ fontWeight: 600 }}>
                  ⚠ Unverified token{outCollisionMismatch ? ` — this is NOT the official ${tokenOut.symbol}` : ""}
                </div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, marginTop: 3, wordBreak: "break-all" }}>
                  {tokenOut.address}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={ackUnverified} onChange={(e) => setAckUnverified(e.target.checked)} />
                  I understand and want to receive this token.
                </label>
              </Notice>
            )}

            {s.canQuote && quote.amountOut !== undefined && (
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                <Row k="Price impact" v={quote.priceImpactBps === undefined ? DASH : formatBpsPercent(quote.priceImpactBps)} tone={s.highImpact ? "caution" : undefined} />
                <Row
                  k="Route"
                  v={quote.route === undefined ? DASH : quote.route.kind === "single" ? `${formatBpsPercent(quote.route.fee / 100)} pool` : `via ${quote.route.via} · 2 hops`}
                />
                {s.feeActive && (
                  <Row k={`Routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`} v={feeAmount !== undefined && tokenOut ? `${fmt(feeAmount, tokenOut.decimals)} ${tokenOut.symbol}` : DASH} />
                )}
                <Row k={`Min received (slippage ${formatBpsPercent(slippageBps)})`} v={netMinOut !== undefined && tokenOut ? `${fmt(netMinOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH} />
              </div>
            )}

            {/* Slippage */}
            <div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>Max slippage</div>
              <Seg
                options={SLIPPAGE_PRESETS_BPS.map((b) => ({ value: String(b), label: formatBpsPercent(b) }))}
                value={String(slippageBps)}
                onChange={(v) => setSlippageBps(Number(v))}
              />
            </div>

            {/* Honest states */}
            {!s.dexLive && <Notice>Swaps aren&apos;t available on this network — switch to Base Sepolia or Robinhood Testnet.</Notice>}
            {s.canQuote && quote.noRoute && <Notice>No {s.uniswapVenue} route for this pair on {s.netLabel} — no direct pool or WETH/USDC path has liquidity.</Notice>}
            {s.canQuote && quote.isError && (
              <Notice>
                Couldn&apos;t fetch a quote just now —{" "}
                <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => quote.refetch()}>retry</a>.
              </Notice>
            )}
            {s.canQuote && s.highImpact && (
              <Notice>High price impact ({formatBpsPercent(quote.priceImpactBps ?? 0)}) — this pool is thin. Try a smaller amount or raise slippage.</Notice>
            )}
            {s.insufficient && <Notice>Amount exceeds your {tokenIn?.symbol} balance.</Notice>}
            {s.canQuote && !s.insufficient && s.feeRecipientPending && (
              <Notice>Reading the routing-fee recipient… needed before you can confirm.</Notice>
            )}

            <button
              className="btn btn-primary btn-md"
              style={{ width: "100%", marginTop: 2 }}
              disabled={!canConfirm}
              onClick={() => setReviewing(true)}
            >
              Review swap
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
              <Row k="You pay" v={`${amount} ${tokenIn?.symbol}`} />
              {s.feeActive && (
                <Row k={`Routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`} v={feeAmount !== undefined && tokenOut ? `${fmt(feeAmount, tokenOut.decimals)} ${tokenOut.symbol}` : DASH} />
              )}
              <Row k={s.feeActive ? "You receive (est., after fee)" : "You receive (est.)"} v={netOut !== undefined && tokenOut ? `${fmt(netOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH} />
              <Row k="Minimum received" v={netMinOut !== undefined && tokenOut ? `${fmt(netMinOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH} />
              <Row
                k="Route"
                v={quote.route === undefined ? DASH : quote.route.kind === "single" ? `${s.uniswapVenue} · ${formatBpsPercent(quote.route.fee / 100)} pool` : `${s.uniswapVenue} · ${tokenIn?.symbol} → ${quote.route.via} → ${tokenOut?.symbol}`}
              />
            </div>
            {tokenOut && !tokenOut.isNative && (
              <div style={{ fontSize: 11, color: outUnverified ? "var(--caution)" : MUTED, wordBreak: "break-all" }}>
                {outUnverified ? "⚠ Unverified" : "✓ Verified"} · {tokenOut.symbol} {tokenOut.address}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
              You sign this from your own wallet. The swap output{s.feeActive ? ` (net of the ${formatBpsPercent(ROUTING_FEE_BIPS)} routing fee)` : ""} goes straight to your address{s.feeActive ? ", and the fee goes on-chain to the routing-fee recipient" : ""}.
            </div>
            {swapCtrl.error && <div style={{ fontSize: 12.5, color: "var(--loss)" }}>{swapCtrl.error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button className="btn btn-outline btn-md" onClick={() => { swapCtrl.reset(); setReviewing(false); }} disabled={swapCtrl.isBusy}>Back</button>
              <button
                className="btn btn-primary btn-md"
                style={{ flex: 1 }}
                disabled={swapCtrl.isBusy || !s.exec}
                onClick={() => swapCtrl.start()}
              >
                {swapCtrl.isBusy ? swapCtrl.label : s.needsApprove ? "Approve + Swap" : "Confirm & swap"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
