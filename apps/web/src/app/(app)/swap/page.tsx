"use client";

/**
 * /swap — manual, NON-CUSTODIAL token swap (§B-swap · universal swap, feature 007).
 *
 * Two honest rails:
 *   • SAME-CHAIN EVM — ETH + USDC are one-tap RECOMMENDED tokens, but the user can pick ANY ERC-20
 *     (pasted address, resolved on-chain). The app quotes on-chain (Uniswap V3 QuoterV2 via the
 *     shared `useSwapConfirm` resolver) and the user signs from their OWN wallet
 *     (`useExecuteSwapTx`). SparkPoint never holds a key or custody.
 *   • CROSS-CHAIN — the same 1Click flow Sparky uses in chat (quote → recipient → deposit → status),
 *     available with an EVM or a NEAR wallet. A NEAR origin is signed in the user's own NEAR wallet.
 *
 * Connected means an EVM wallet OR a NEAR wallet. Safety for arbitrary tokens is surfaced at the
 * SIGNING gate, not just the picker; honest states only (no route → "no liquidity", quote failure →
 * plain language, wrong network → notice); nothing is auto-signed or auto-sent.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import type { CrossChainQuoteBlock } from "@sparkpoint/shared/schemas";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { StatusTag } from "@/components/ui/status-tag";
import { Seg } from "@/components/ui/seg";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { chainName } from "@sparkpoint/shared/chains";
import { useNetwork } from "@/lib/network";
import { dexById, dexDisplayLabel, dexLiveOn } from "@/lib/swap/dex";
import { isSwapChain } from "@/lib/swap/chain";
import { swapTokens, type SwapToken } from "@/lib/swap/tokens";
import { findVerifiedBySymbol } from "@/lib/swap/tokenList";
import { useSwapConfirm } from "@/lib/swap/useSwapConfirm";
import { useExecuteSwapTx } from "@/lib/swap/useExecuteSwapTx";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { TokenPicker } from "@/components/screens/swap/TokenPicker";
import { CrossChainQuoteCard } from "@/components/screens/chat/crosschain-quote-card";
import { NearWalletControl } from "@/components/near/NearWalletControl";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { CROSSCHAIN_ASSETS, crossChainAssetByKey, defaultCrossChainDestination, defaultCrossChainOrigin } from "@/lib/crosschain/assets";
import { crossChainErrorMessage } from "@/lib/crosschain/errors";
import { crosschainChainIdHeader } from "@/lib/crosschain/requestHeaders";
import {
  crossChainAmountError,
  crossChainQuoteKey,
  isSwapConnected,
  type SwapMode,
} from "@/lib/crosschain/swapRoute";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { formatAmount, formatBpsPercent, HIGH_IMPACT_BPS, ROUTING_FEE_BIPS, SLIPPAGE_PRESETS_BPS } from "@/lib/swap/math";

const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;
const DASH = "—";
/** Keep a little native ETH for gas when the user taps "Max" on an ETH-in swap. */
const ETH_GAS_BUFFER = 10n ** 15n; // 0.001 ETH

const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function defaultTokens(chainId: number | undefined): { tin?: SwapToken; tout?: SwapToken } {
  const rec = swapTokens(chainId);
  return { tin: rec.find((t) => t.isNative) ?? rec[0], tout: rec.find((t) => !t.isNative) ?? rec[1] };
}

function fmt(v: bigint | undefined, decimals: number, max = 6): string {
  return formatAmount(v, decimals, max) ?? DASH;
}

export default function Page() {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const { accountId: nearAccountId } = useNearWallet();
  const { switchToChain } = useNetwork();
  // Follow the wallet's chain when it is supported (Base or Robinhood Chain on the beta build),
  // rather than clamping every tester to one network. An unsupported chain keeps the display
  // chain for labels but surfaces `s.wrongChain` so the page asks for a switch, never a quote.
  const supportedConnected = isConnected && isSwapChain(chainId);
  const activeChain = supportedConnected ? chainId : DISPLAY_CHAIN_ID;

  const nearConnected = !!nearAccountId;
  const swapConnected = isSwapConnected({ evmConnected: isConnected, nearAccountId });
  // A NEAR-only user starts on the cross-chain rail; an EVM user starts on the same-chain form.
  // Once the user clicks a tab their choice wins, so a connected NEAR wallet can no longer pin the
  // view to cross-chain. No effect: the default is derived from what is actually connected.
  const [requestedMode, setRequestedMode] = useState<SwapMode | null>(null);
  const nearOnly = !isConnected && nearConnected;
  const mode: SwapMode = requestedMode ?? (nearOnly ? "cross-chain" : "same-chain");

  const initial = defaultTokens(DISPLAY_CHAIN_ID);
  const [tokenIn, setTokenIn] = useState<SwapToken | undefined>(initial.tin);
  const [tokenOut, setTokenOut] = useState<SwapToken | undefined>(initial.tout);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(SLIPPAGE_PRESETS_BPS[0]);
  const [reviewing, setReviewing] = useState(false);
  const [ackUnverified, setAckUnverified] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  // Cross-chain form state. `null` means "not chosen yet", so the defaults can follow the connected
  // wallet (NEAR origin, Base destination) without an effect or overriding a user's choice.
  const [crossOriginKey, setCrossOriginKey] = useState<string | null>(null);
  const [crossDestKey, setCrossDestKey] = useState<string | null>(null);
  const [crossAmount, setCrossAmount] = useState("");
  const [preview, setPreview] = useState<CrossChainQuoteBlock | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const originKey = crossOriginKey ?? defaultCrossChainOrigin(nearConnected);
  const destinationKey = crossDestKey ?? defaultCrossChainDestination(nearConnected);
  const originAsset = crossChainAssetByKey(originKey);
  const destinationAsset = crossChainAssetByKey(destinationKey);
  const amountError = originAsset ? crossChainAmountError(crossAmount, originAsset.decimals) : null;
  const canGetQuote =
    !!originAsset &&
    !!destinationAsset &&
    originAsset.enabled &&
    destinationAsset.enabled &&
    originAsset.key !== destinationAsset.key &&
    amountError === null;
  const currentQuoteKey =
    originAsset && destinationAsset
      ? crossChainQuoteKey(originAsset.key, destinationAsset.key, crossAmount)
      : null;
  const previewMatches = !!preview && !!currentQuoteKey && previewKey === currentQuoteKey;

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

  // One venue wired for execution (Uniswap V3) — the route is chosen on-chain by the quote engine, so
  // there is no venue selector. Kept as `dex` for the labels + the live availability check.
  const dex = dexById("uniswap_v3");
  const dexLive = dexLiveOn(dex, activeChain);
  const uniswapVenue = dexDisplayLabel(dexById("uniswap_v3"), activeChain);
  // Registry-derived: the swap page must agree with the top bar / settings on what to call the
  // connected network, and unknown chains must never be silently renamed.
  const netLabel = chainName(activeChain);
  const swapTagTitle = `Swap on your connected network with ${uniswapVenue}, or across chains with NEAR Intents. You sign from your own wallet.`;

  const s = useSwapConfirm({ tokenIn, tokenOut, amount, slippageBps });
  const swapCtrl = useExecuteSwapTx(reviewing ? s.exec : undefined);
  // Feature 006: pause the force-refresh while a swap is signing/broadcasting (LOCKED).
  useHoldCriticalOp(swapCtrl.isBusy, "locked");

  const { quote, netOut, netMinOut, feeAmount } = s;
  const balanceIn = s.balanceIn;

  // §fee-router (W.7): when the book wires a router the fee is taken on the INPUT side — disclose the
  // bps and destination read LIVE from the router (never a hardcoded percentage string).
  const feeOnInput = s.feeRouterActive;
  const feePct =
    feeOnInput && s.feeBpsLive !== undefined
      ? formatBpsPercent(s.feeBpsLive)
      : formatBpsPercent(ROUTING_FEE_BIPS);
  const feeDisplay = feeOnInput
    ? s.feeAmountIn !== undefined && tokenIn
      ? `${fmt(s.feeAmountIn, tokenIn.decimals)} ${tokenIn.symbol}`
      : DASH
    : feeAmount !== undefined && tokenOut
      ? `${fmt(feeAmount, tokenOut.decimals)} ${tokenOut.symbol}`
      : DASH;

  // Safety gate — a non-recommended (unverified) receive-token must be acknowledged before confirming.
  const outUnverified = !!tokenOut && !tokenOut.isNative && !tokenOut.verified;
  const outCollision = outUnverified ? findVerifiedBySymbol(activeChain ?? 0, tokenOut!.symbol) : undefined;
  const outCollisionMismatch = !!outCollision && !eqAddr(outCollision.address, tokenOut!.address);
  const safetyGateOk = !outUnverified || ackUnverified;

  const canQuote = dexLive && s.canQuote;
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

  const clearPreview = () => {
    setPreview(null);
    setPreviewKey(null);
    setPreviewError(null);
  };
  const onOriginChange = (key: string) => {
    setCrossOriginKey(key);
    if (key === destinationKey) {
      const next = CROSSCHAIN_ASSETS.find((asset) => asset.enabled && asset.key !== key);
      if (next) setCrossDestKey(next.key);
    }
    clearPreview();
  };
  const onDestinationChange = (key: string) => {
    setCrossDestKey(key);
    if (key === originKey) {
      const next = CROSSCHAIN_ASSETS.find((asset) => asset.enabled && asset.key !== key);
      if (next) setCrossOriginKey(next.key);
    }
    clearPreview();
  };

  async function getCrossChainQuote() {
    if (!canGetQuote || !originAsset || !destinationAsset) return;
    const key = crossChainQuoteKey(originAsset.key, destinationAsset.key, crossAmount);
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/agent/crosschain/quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chain-id": crosschainChainIdHeader(originAsset.evmChainId, chainId),
        },
        body: JSON.stringify({
          originKey: originAsset.key,
          destinationKey: destinationAsset.key,
          amount: crossAmount.trim(),
          dry: true,
        }),
      });
      if (!res.ok) {
        setPreviewError(await crossChainErrorMessage(res));
        return;
      }
      const body = (await res.json()) as CrossChainQuoteBlock;
      setPreview(body);
      setPreviewKey(key);
    } catch {
      setPreviewError("Couldn't reach the cross-chain service. Nothing was signed or sent — please retry.");
    } finally {
      setPreviewBusy(false);
    }
  }

  // ── Guard states ─────────────────────────────────────────────────────────
  if (!swapConnected) {
    return (
      <Shell tagTitle={swapTagTitle}>
        <div className="card card-pad muted" style={{ padding: "26px 18px" }}>
          Connect a wallet to swap tokens. Your wallet stays in your control — SparkPoint never holds
          your keys or funds.
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("connect"))}>
              <Icon name="wallet" size={16} /> Connect a wallet
            </button>
            <NearWalletControl />
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted-foreground)" }}>
            MetaMask for on-chain swaps, or Meteor for NEAR. Both can use cross-chain swaps.
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tagTitle={swapTagTitle}>
      <div style={{ marginBottom: 14 }}>
        <Seg
          options={[
            { value: "same-chain", label: "Same chain" },
            { value: "cross-chain", label: "Cross-chain" },
          ]}
          value={mode}
          onChange={(v) => {
            setRequestedMode(v as SwapMode);
            setReviewing(false);
            clearPreview();
          }}
        />
      </div>

      {mode === "cross-chain" ? (
        <>
          <div className="card card-pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 600 }}>Cross-chain swap</div>
              <span className="muted" style={{ fontSize: 11.5 }}>
                NEAR Intents · 1Click
              </span>
            </div>

            <div>
              <label className="lbl" htmlFor="cross-origin" style={{ display: "block", marginBottom: 6 }}>
                From
              </label>
              <select
                id="cross-origin"
                value={originKey}
                onChange={(e) => onOriginChange(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {CROSSCHAIN_ASSETS.map((asset) => (
                  <option key={asset.key} value={asset.key} disabled={!asset.enabled}>
                    {asset.symbol} on {asset.chainLabel}
                    {asset.enabled ? "" : " — unavailable"}
                  </option>
                ))}
              </select>
              {originAsset && !originAsset.enabled && (
                <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--caution)" }}>
                  {originAsset.unavailableReason ?? "This route is unavailable right now."}
                </div>
              )}
            </div>

            <div>
              <label className="lbl" htmlFor="cross-amount" style={{ display: "block", marginBottom: 6 }}>
                You pay
              </label>
              <input
                id="cross-amount"
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={crossAmount}
                onChange={(e) => {
                  setCrossAmount(e.target.value);
                  clearPreview();
                }}
              />
            </div>

            <div>
              <label className="lbl" htmlFor="cross-destination" style={{ display: "block", marginBottom: 6 }}>
                To
              </label>
              <select
                id="cross-destination"
                value={destinationKey}
                onChange={(e) => onDestinationChange(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {CROSSCHAIN_ASSETS.map((asset) => (
                  <option key={asset.key} value={asset.key} disabled={!asset.enabled}>
                    {asset.symbol} on {asset.chainLabel}
                    {asset.enabled ? "" : " — unavailable"}
                  </option>
                ))}
              </select>
              {destinationAsset && !destinationAsset.enabled && (
                <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--caution)" }}>
                  {destinationAsset.unavailableReason ?? "This route is unavailable right now."}
                </div>
              )}
            </div>

            {crossAmount.trim() !== "" && amountError && <Notice>{amountError}</Notice>}
            {originAsset && destinationAsset && originAsset.key === destinationAsset.key && (
              <Notice>Pick two different assets to swap.</Notice>
            )}
            {previewError && <Notice>{previewError}</Notice>}

            <button
              className="btn btn-primary btn-md"
              style={{ width: "100%" }}
              disabled={!canGetQuote || previewBusy}
              onClick={() => void getCrossChainQuote()}
            >
              {previewBusy ? "Getting quote…" : "Get cross-chain quote"}
            </button>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              This asks for a live quote and a one-time deposit address. Nothing is signed and no funds
              move until you review and send from your own wallet.
            </div>
          </div>

          {previewMatches && preview && (
            <div style={{ marginTop: 14 }}>
              <CrossChainQuoteCard
                key={`${previewKey ?? ""}:${preview.quotedAt ?? ""}`}
                block={preview}
                conversationId="swap"
              />
            </div>
          )}
        </>
      ) : (
        <div className="card card-pad">
          {pickerFor && (
            <TokenPicker
              chainId={activeChain}
              exclude={pickerFor === "in" ? tokenOut?.address : tokenIn?.address}
              onSelect={(t) => onPick(pickerFor, t)}
              onClose={() => setPickerFor(null)}
            />
          )}

          {/* Swap form */}
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
            chainId={activeChain}
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
            label={s.feeActive && !feeOnInput ? "You receive (estimated, after fee)" : "You receive (estimated)"}
            token={tokenOut}
            value={canQuote && netOut !== undefined && tokenOut ? fmt(netOut, tokenOut.decimals) : ""}
            placeholder={quote.isLoading ? "…" : "0.00"}
            editable={false}
            onPickToken={() => setPickerFor("out")}
            chainId={activeChain}
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
                  k={`SparkPoint swap fee (${feePct})`}
                  v={feeDisplay}
                />
              )}
              {feeOnInput && s.feeDestination && (
                <Row k="Fee destination" v={`RevenueSplitter ${shortAddr(s.feeDestination)}`} />
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
          {!dexLive && (
            <Notice>{uniswapVenue} isn&apos;t available on this network — switch to a supported network.</Notice>
          )}
          {s.wrongChain && (
            <Notice>
              Your wallet is on a different network.{" "}
              <a
                style={{ color: "var(--primary)", cursor: "pointer" }}
                onClick={() => switchToChain(APP_DEFAULT_CHAIN_ID as Parameters<typeof switchToChain>[0])}
              >
                Switch to {chainName(APP_DEFAULT_CHAIN_ID)}
              </a>{" "}
              to swap.
            </Notice>
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
          {s.feeRouterPending && s.amountIn > 0n && (
            <Notice>Reading the swap fee from the router… the swap needs its fee and destination before you can confirm.</Notice>
          )}
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
                  {s.feeActive && <Row k={`SparkPoint swap fee (${feePct})`} v={feeDisplay} />}
                  {feeOnInput && s.feeDestination && (
                    <Row k="Fee destination" v={`RevenueSplitter ${shortAddr(s.feeDestination)}`} />
                  )}
                  <Row
                    k={s.feeActive && !feeOnInput ? "You receive (est., after fee)" : "You receive (est.)"}
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
                  output
                  {s.feeActive && !feeOnInput ? ` (net of the ${feePct} routing fee)` : ""} goes straight to
                  your address
                  {feeOnInput
                    ? `, and the ${feePct} fee is charged on the amount you pay and sent on-chain to the RevenueSplitter`
                    : s.feeActive
                      ? ", and the fee goes on-chain straight to the vault's fee recipient"
                      : ""}
                  .
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
      )}
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
          <StatusTag variant="live" label="On-chain + cross-chain" title={tagTitle} />
        </div>
        <div className="sub">
          Swap tokens on your connected network or across chains — non-custodial, you sign every trade.
        </div>
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
  chainId,
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
  chainId?: number;
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
          style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid var(--border)" }}
        >
          {token && <TokenLogo token={token} chainId={chainId} size={20} />}
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
