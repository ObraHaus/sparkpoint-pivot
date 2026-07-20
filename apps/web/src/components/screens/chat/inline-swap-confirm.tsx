"use client";

/**
 * InlineSwapConfirm — a FUNCTIONAL, non-custodial ETH↔USDC swap rendered inline in the chat thread.
 *
 * Reuses the SAME engines as the `/swap` page: `useSwapConfirm` (resolver → live QuoterV2 quote +
 * `SwapExec`) and `useExecuteSwapTx` (user-signed approve+swap). The user enters an amount, sees a
 * live quote + slippage + price impact + the 0.20% routing fee, and signs from their OWN wallet —
 * SparkPoint never holds a key or custody, the recipient is always the connecting account, and the
 * fee splits on-chain. Honest states (no route, quote error, high impact, insufficient, wrong network)
 * come straight from the reused engines; the Sign button is disabled until a real `exec` is ready.
 */

import { useState } from "react";
import { formatUnits } from "viem";
import { Icon } from "@/lib/icons";
import { Seg } from "@/components/ui/seg";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { useSwapConfirm } from "@/lib/swap/useSwapConfirm";
import { useExecuteSwapTx } from "@/lib/swap/useExecuteSwapTx";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { formatBpsPercent, ROUTING_FEE_BIPS, SLIPPAGE_PRESETS_BPS } from "@/lib/swap/math";

const DASH = "—";
/** Keep a little native ETH for gas when the user taps "Max" on an ETH-in swap. */
const ETH_GAS_BUFFER = 10n ** 15n; // 0.001 ETH

function fmt(v: bigint | undefined, decimals: number, max = 6): string {
  if (v === undefined) return DASH;
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

const MUTED = "var(--muted-foreground)";

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ color: tone === "caution" ? "var(--caution)" : "var(--foreground)", fontWeight: 500 }}>{v}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: "var(--caution)",
        background: "color-mix(in srgb, var(--caution) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--caution) 26%, transparent)",
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      {children}
    </div>
  );
}

export function InlineSwapConfirm({
  ethToUsdc: initialEthToUsdc,
  amountIn: initialAmountIn,
  slippageBps: initialSlippage,
}: {
  ethToUsdc?: boolean;
  amountIn?: bigint;
  slippageBps?: number;
}) {
  const [ethToUsdc, setEthToUsdc] = useState(initialEthToUsdc ?? true);
  // Seed from the agent-provided amount only for an ETH input (ETH is always 18-dp; USDC decimals
  // vary by chain, so a USDC-input seed is left for the user to type).
  const [amount, setAmount] = useState(() =>
    initialAmountIn && initialAmountIn > 0n && (initialEthToUsdc ?? true)
      ? formatUnits(initialAmountIn, 18)
      : "",
  );
  const [slippageBps, setSlippageBps] = useState<number>(initialSlippage ?? SLIPPAGE_PRESETS_BPS[0]);
  const [reviewing, setReviewing] = useState(false);

  const s = useSwapConfirm({ ethToUsdc, amount, slippageBps });
  const swapCtrl = useExecuteSwapTx(reviewing ? s.exec : undefined);
  // Feature 006: pause the force-refresh while an in-chat swap is signing/broadcasting (LOCKED).
  useHoldCriticalOp(swapCtrl.isBusy, "locked");
  const { tokenIn, tokenOut, quote, netOut, netMinOut, feeAmount } = s;

  const onMax = () => {
    if (!tokenIn || s.balanceIn === undefined) return;
    const usable = tokenIn.isNative ? (s.balanceIn > ETH_GAS_BUFFER ? s.balanceIn - ETH_GAS_BUFFER : 0n) : s.balanceIn;
    setAmount(formatUnits(usable, tokenIn.decimals));
    setReviewing(false);
  };
  const flip = () => {
    setEthToUsdc((d) => !d);
    setAmount("");
    setReviewing(false);
  };

  const canConfirm = s.canQuote && quote.amountOut !== undefined && !s.insufficient && s.amountIn > 0n && !s.feeRecipientPending;

  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
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
            {/* Amount + direction */}
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
              <span style={{ fontSize: 14, fontWeight: 600 }}>{tokenIn?.symbol ?? "—"}</span>
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
                <Icon name="swap" size={14} /> {tokenIn?.symbol} → {tokenOut?.symbol}
              </button>
            </div>

            {/* Live quote */}
            <div style={{ fontSize: 13 }}>
              You receive {s.feeActive ? "(est., after fee)" : "(est.)"}:{" "}
              <b>
                {s.canQuote && netOut !== undefined && tokenOut ? fmt(netOut, tokenOut.decimals) : (quote.isLoading ? "…" : DASH)}{" "}
                {tokenOut?.symbol}
              </b>
            </div>

            {s.canQuote && quote.amountOut !== undefined && (
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                <Row k="Price impact" v={quote.priceImpactBps === undefined ? DASH : formatBpsPercent(quote.priceImpactBps)} tone={s.highImpact ? "caution" : undefined} />
                <Row k="Pool fee tier" v={quote.fee !== undefined ? formatBpsPercent(quote.fee / 100) : DASH} />
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
            {s.canQuote && quote.noRoute && <Notice>No {s.uniswapVenue} liquidity for this pair on {s.netLabel}.</Notice>}
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
              <Notice>Reading the routing-fee recipient from the vault… needed before you can confirm.</Notice>
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
              <Row k="Route" v={`${s.uniswapVenue} · ${quote.fee !== undefined ? formatBpsPercent(quote.fee / 100) : DASH} pool`} />
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
              You sign this from your own wallet. The swap output{s.feeActive ? ` (net of the ${formatBpsPercent(ROUTING_FEE_BIPS)} routing fee)` : ""} goes straight to your address{s.feeActive ? ", and the fee goes on-chain to the vault's fee recipient" : ""}.
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
