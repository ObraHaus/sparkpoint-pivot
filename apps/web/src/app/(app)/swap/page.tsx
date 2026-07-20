"use client";

/**
 * /swap — manual, NON-CUSTODIAL token swap (§B-swap · universal swap, feature 007).
 *
 * ETH + USDC are one-tap RECOMMENDED tokens, but the user can pick ANY ERC-20 (pasted address, resolved
 * on-chain) on either leg. The app quotes on-chain (Uniswap V3 QuoterV2 via the shared `useSwapConfirm`
 * resolver — the SAME engine the in-chat swap uses) and the user signs from their OWN wallet
 * (`useExecuteSwapTx`). SparkPoint never holds a key or custody; the recipient is ALWAYS the connecting
 * account; the 0.20% routing fee is split on-chain.
 *
 * Safety for arbitrary tokens is surfaced at the SIGNING gate, not just the picker: any non-recommended
 * receive-token shows its address + a verified/unverified badge, a symbol-collision warning, and requires
 * an "I understand" acknowledgement before the swap can be confirmed. Honest states only (no route → "no
 * liquidity", quote failure → dashes, wrong network → notice); a slippage floor + deadline guard every swap.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { StatusTag } from "@/components/ui/status-tag";
import { Seg } from "@/components/ui/seg";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { DEXES, dexById, dexDisplayLabel, dexLiveOn, type DexId } from "@/lib/swap/dex";
import { swapTokens, type SwapToken } from "@/lib/swap/tokens";
import { findVerifiedBySymbol } from "@/lib/swap/tokenList";
import { useSwapConfirm } from "@/lib/swap/useSwapConfirm";
import { useExecuteSwapTx } from "@/lib/swap/useExecuteSwapTx";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { TokenPicker } from "@/components/screens/swap/TokenPicker";
import { formatBpsPercent, HIGH_IMPACT_BPS, ROUTING_FEE_BIPS, SLIPPAGE_PRESETS_BPS } from "@/lib/swap/math";

const DISPLAY_CHAIN_ID = 84532;
const DASH = "—";
/** Keep a little native ETH for gas when the user taps "Max" on an ETH-in swap. */
const ETH_GAS_BUFFER = 10n ** 15n; // 0.001 ETH

const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function defaultTokens(chainId: number | undefined): { tin?: SwapToken; tout?: SwapToken } {
  const rec = swapTokens(chainId);
  return { tin: rec.find((t) => t.isNative) ?? rec[0], tout: rec.find((t) => !t.isNative) ?? rec[1] };
}

function fmt(v: bigint | undefined, decimals: number, max = 6): string {
  if (v === undefined) return DASH;
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export default function Page() {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const activeChain = isConnected ? chainId : DISPLAY_CHAIN_ID;

  const [dexId, setDexId] = useState<DexId>("uniswap_v3");
  const initial = defaultTokens(DISPLAY_CHAIN_ID);
  const [tokenIn, setTokenIn] = useState<SwapToken | undefined>(initial.tin);
  const [tokenOut, setTokenOut] = useState<SwapToken | undefined>(initial.tout);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(SLIPPAGE_PRESETS_BPS[0]);
  const [reviewing, setReviewing] = useState(false);
  const [ackUnverified, setAckUnverified] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  // Chain switch = a different set of tokens (the same 0x address is a DIFFERENT contract per chain) —
  // reset to that chain's recommended defaults so we never quote/execute the wrong token. setState here
  // syncs to an EXTERNAL change (the connected network), the sanctioned use of an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const d = defaultTokens(activeChain);
    setTokenIn(d.tin);
    setTokenOut(d.tout);
    setAmount("");
    setReviewing(false);
    setAckUnverified(false);
  }, [activeChain]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dex = dexById(dexId);
  const dexLive = dexLiveOn(dex, activeChain);
  const uniswapVenue = dexDisplayLabel(dexById("uniswap_v3"), activeChain);
  const netLabel = activeChain === 46630 ? "Robinhood Testnet" : activeChain === 8453 ? "Base" : "Base Sepolia";
  const swapTagTitle = `Real on-chain swaps via ${uniswapVenue} on ${netLabel}. You sign from your own wallet.`;

  const s = useSwapConfirm({ tokenIn, tokenOut, amount, slippageBps });
  const swapCtrl = useExecuteSwapTx(reviewing ? s.exec : undefined);
  // Feature 006: pause the force-refresh while a swap is signing/broadcasting (LOCKED).
  useHoldCriticalOp(swapCtrl.isBusy, "locked");

  const { quote, netOut, netMinOut, feeAmount } = s;
  const balanceIn = s.balanceIn;

  // Safety gate — a non-recommended (unverified) receive-token must be acknowledged before confirming.
  const outUnverified = !!tokenOut && !tokenOut.isNative && !tokenOut.verified;
  const outCollision = outUnverified ? findVerifiedBySymbol(activeChain ?? 0, tokenOut!.symbol) : undefined;
  const outCollisionMismatch = !!outCollision && !eqAddr(outCollision.address, tokenOut!.address);
  const safetyGateOk = !outUnverified || ackUnverified;

  const canQuote = dexId === "uniswap_v3" && dexLive && s.canQuote;
  const highImpact = (quote.priceImpactBps ?? 0) >= HIGH_IMPACT_BPS;
  const canReview =
    canQuote && quote.amountOut !== undefined && !s.insufficient && s.amountIn > 0n && !s.feeRecipientPending && safetyGateOk;

  const onMax = () => {
    if (!tokenIn || balanceIn === undefined) return;
    const usable = tokenIn.isNative ? (balanceIn > ETH_GAS_BUFFER ? balanceIn - ETH_GAS_BUFFER : 0n) : balanceIn;
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
      if (eqAddr(token.address, tokenOut?.address)) setTokenOut(tokenIn); // avoid same-token pair
      setTokenIn(token);
    } else {
      if (eqAddr(token.address, tokenIn?.address)) setTokenIn(tokenOut);
      setTokenOut(token);
      setAckUnverified(false);
    }
    setReviewing(false);
  };

  // ── Guard states ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <Shell tagTitle={swapTagTitle}>
        <div className="card card-pad muted" style={{ padding: "26px 18px" }}>
          Connect your wallet to swap tokens. Your wallet stays in your control — SparkPoint never holds
          your keys or funds.
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("connect"))}>
              <Icon name="wallet" size={16} /> Connect wallet
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tagTitle={swapTagTitle}>
      {pickerFor && (
        <TokenPicker
          chainId={activeChain}
          exclude={pickerFor === "in" ? tokenOut?.address : tokenIn?.address}
          onSelect={(t) => onPick(pickerFor, t)}
          onClose={() => setPickerFor(null)}
        />
      )}

      {/* DEX selector */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="card-hd">
          <span className="lbl">Route via</span>
        </div>
        <Seg
          options={DEXES.map((d) => ({ value: d.id, label: dexDisplayLabel(d, activeChain) }))}
          value={dexId}
          onChange={(v) => {
            setDexId(v as DexId);
            setReviewing(false);
          }}
        />
        {!dexLive && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--caution)" }}>
            {dex.unavailableNote ?? `${dex.label} isn't available on this network.`}
          </div>
        )}
      </div>

      {/* Swap form */}
      <div className="card card-pad">
        <TokenRow
          label="You pay"
          token={tokenIn}
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setReviewing(false);
          }}
          editable
          balance={balanceIn}
          onMax={onMax}
          onPickToken={() => setPickerFor("in")}
        />
        <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
          <button
            className="btn btn-ghost"
            title="Flip direction"
            onClick={flip}
            style={{ borderRadius: 999, width: 34, height: 34, padding: 0 }}
          >
            <Icon name="swap" size={16} />
          </button>
        </div>
        <TokenRow
          label={s.feeActive ? "You receive (estimated, after fee)" : "You receive (estimated)"}
          token={tokenOut}
          value={canQuote && netOut !== undefined && tokenOut ? fmt(netOut, tokenOut.decimals) : ""}
          placeholder={quote.isLoading ? "…" : "0.00"}
          editable={false}
          onPickToken={() => setPickerFor("out")}
        />

        {/* Unverified-token safety (surfaced again at the signing gate, not just the picker) */}
        {outUnverified && tokenOut && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12.5,
              lineHeight: 1.55,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--caution-subtle)",
              color: "var(--caution)",
              border: "1px solid color-mix(in srgb,var(--caution) 26%,transparent)",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              ⚠ Unverified token{outCollisionMismatch ? ` — this is NOT the official ${tokenOut.symbol}` : ""}
            </div>
            <div style={{ marginTop: 3 }}>
              Anyone can create a token with any name. Confirm you trust this exact contract:
            </div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, marginTop: 4, wordBreak: "break-all" }}>
              {tokenOut.address}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={ackUnverified} onChange={(e) => setAckUnverified(e.target.checked)} />
              I understand and want to receive this token.
            </label>
          </div>
        )}

        {/* Quote details */}
        {canQuote && (
          <div style={{ marginTop: 14, display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row
              k="Price impact"
              v={quote.priceImpactBps === undefined ? DASH : formatBpsPercent(quote.priceImpactBps)}
              tone={highImpact ? "caution" : undefined}
            />
            <Row
              k="Route"
              v={
                quote.route === undefined
                  ? DASH
                  : quote.route.kind === "single"
                    ? `${formatBpsPercent(quote.route.fee / 100)} pool`
                    : `via ${quote.route.via} · 2 hops`
              }
            />
            {s.feeActive && (
              <Row
                k={`SparkPoint routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`}
                v={feeAmount !== undefined && tokenOut ? `${fmt(feeAmount, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
              />
            )}
            <Row
              k={`Min received (slippage ${formatBpsPercent(slippageBps)})`}
              v={netMinOut !== undefined && tokenOut ? `${fmt(netMinOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
            />
          </div>
        )}

        {/* Slippage control */}
        <div style={{ marginTop: 14 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>Max slippage</div>
          <Seg
            options={SLIPPAGE_PRESETS_BPS.map((b) => ({ value: String(b), label: formatBpsPercent(b) }))}
            value={String(slippageBps)}
            onChange={(v) => setSlippageBps(Number(v))}
          />
        </div>

        {/* Honest state messages */}
        {dexId !== "uniswap_v3" && (
          <Notice>Only {uniswapVenue} is wired for execution right now. Pick {uniswapVenue} to swap.</Notice>
        )}
        {dexId === "uniswap_v3" && !dexLive && (
          <Notice>{uniswapVenue} isn&apos;t available on this network — switch to Base Sepolia or Robinhood Testnet.</Notice>
        )}
        {canQuote && quote.noRoute && (
          <Notice>No {uniswapVenue} route for this pair on {netLabel} — no direct pool or WETH/USDC path has liquidity.</Notice>
        )}
        {canQuote && quote.isError && (
          <Notice>
            Couldn&apos;t fetch a quote just now — check your connection and{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => quote.refetch()}>retry</a>.
          </Notice>
        )}
        {canQuote && highImpact && (
          <Notice>
            High price impact ({formatBpsPercent(quote.priceImpactBps ?? 0)}) — this pool is thin. Try a
            smaller amount or raise your slippage.
          </Notice>
        )}
        {s.insufficient && <Notice>Amount exceeds your {tokenIn?.symbol} balance.</Notice>}
        {canQuote && !s.insufficient && s.feeRecipientPending && (
          <Notice>Reading the routing-fee recipient from the vault… the swap needs it before you can confirm.</Notice>
        )}

        {/* CTA / confirm / receipt */}
        {!swapCtrl.isDone ? (
          !reviewing ? (
            <button
              className="btn btn-primary btn-md"
              style={{ marginTop: 16, width: "100%" }}
              disabled={!canReview}
              onClick={() => setReviewing(true)}
            >
              Review swap
            </button>
          ) : (
            <div className="card card-pad" style={{ marginTop: 16, background: "var(--muted-subtle, var(--card))" }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Confirm swap</div>
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                <Row k="You pay" v={`${amount} ${tokenIn?.symbol}`} />
                {s.feeActive && (
                  <Row
                    k={`SparkPoint routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`}
                    v={feeAmount !== undefined && tokenOut ? `${fmt(feeAmount, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
                  />
                )}
                <Row
                  k={s.feeActive ? "You receive (est., after fee)" : "You receive (est.)"}
                  v={netOut !== undefined && tokenOut ? `${fmt(netOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
                />
                <Row
                  k="Minimum received"
                  v={netMinOut !== undefined && tokenOut ? `${fmt(netMinOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
                />
                <Row
                  k="Route"
                  v={
                    quote.route === undefined
                      ? DASH
                      : quote.route.kind === "single"
                        ? `${dexDisplayLabel(dex, activeChain)} · ${formatBpsPercent(quote.route.fee / 100)} pool`
                        : `${dexDisplayLabel(dex, activeChain)} · ${tokenIn?.symbol} → ${quote.route.via} → ${tokenOut?.symbol}`
                  }
                />
              </div>
              {tokenOut && !tokenOut.isNative && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: outUnverified ? "var(--caution)" : "var(--muted-foreground)", wordBreak: "break-all" }}>
                  {outUnverified ? "⚠ Unverified" : "✓ Verified"} · {tokenOut.symbol} {tokenOut.address}
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted-foreground)" }}>
                You sign this from your own wallet. SparkPoint never holds your keys or funds — the swap
                output{s.feeActive ? ` (net of the ${formatBpsPercent(ROUTING_FEE_BIPS)} routing fee)` : ""} goes
                straight to your address{s.feeActive ? ", and the fee goes on-chain straight to the vault's fee recipient" : ""}.
              </div>
              {swapCtrl.error && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--loss)" }}>{swapCtrl.error}</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  className="btn btn-outline btn-md"
                  onClick={() => {
                    swapCtrl.reset();
                    setReviewing(false);
                  }}
                  disabled={swapCtrl.isBusy}
                >
                  Back
                </button>
                <button
                  className="btn btn-primary btn-md"
                  style={{ flex: 1 }}
                  disabled={swapCtrl.isBusy || !s.exec}
                  onClick={() => swapCtrl.start()}
                >
                  {swapCtrl.isBusy ? swapCtrl.label : s.needsApprove ? `Approve + Swap` : "Confirm & swap"}
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="card card-pad" style={{ marginTop: 16, background: "var(--gain-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <Icon name="check" size={18} /> Swap confirmed
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              You swapped {amount} {tokenIn?.symbol} for {tokenOut?.symbol}.
            </div>
            {(() => {
              const url = explorerTxUrl(activeChain, swapCtrl.txHash);
              return url ? (
                <a className="cite" href={url} target="_blank" rel="noreferrer" style={{ marginTop: 8, display: "inline-flex", gap: 4 }}>
                  View transaction <Icon name="ext" size={11} />
                </a>
              ) : null;
            })()}
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button
                className="btn btn-outline btn-md"
                onClick={() => {
                  swapCtrl.reset();
                  setReviewing(false);
                  setAmount("");
                }}
              >
                New swap
              </button>
              {tokenOut?.symbol === "USDC" && tokenOut?.verified ? (
                <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("vault/deposit"))}>
                  Deposit USDC into vault
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────

function Shell({ children, tagTitle }: { children: React.ReactNode; tagTitle: string }) {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1>Swap</h1>
          <StatusTag variant="live" title={tagTitle} />
        </div>
        <div className="sub">Swap tokens directly on-chain — non-custodial, you sign every trade.</div>
      </div>
      {children}
    </div>
  );
}

function TokenRow({
  label,
  token,
  value,
  onChange,
  editable,
  placeholder,
  balance,
  onMax,
  onPickToken,
}: {
  label: string;
  token?: SwapToken;
  value: string;
  onChange?: (v: string) => void;
  editable: boolean;
  placeholder?: string;
  balance?: bigint;
  onMax?: () => void;
  onPickToken?: () => void;
}) {
  return (
    <div className="field">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label>{label}</label>
        {balance !== undefined && token && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            Balance: {fmt(balance, token.decimals, 4)} {token.symbol}
            {onMax && (
              <button className="btn btn-ghost" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }} onClick={onMax}>
                Max
              </button>
            )}
          </span>
        )}
      </div>
      <div className="amtbox" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          className="input big"
          inputMode="decimal"
          placeholder={placeholder ?? "0.00"}
          style={{ border: "none", boxShadow: "none", padding: 0, background: "none", flex: 1 }}
          value={value}
          readOnly={!editable}
          onChange={editable && onChange ? (e) => onChange(e.target.value) : undefined}
        />
        <button
          className="pill"
          onClick={onPickToken}
          style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid var(--border)" }}
        >
          {token?.symbol ?? "Select"}
          <Icon name="chevron-down" size={13} />
        </button>
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span className="muted">{k}</span>
      <span style={{ fontWeight: 600, color: tone === "caution" ? "var(--caution)" : undefined }} className="tnum">{v}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        fontSize: 12.5,
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--caution-subtle)",
        color: "var(--caution)",
        border: "1px solid color-mix(in srgb,var(--caution) 26%,transparent)",
      }}
    >
      {children}
    </div>
  );
}
