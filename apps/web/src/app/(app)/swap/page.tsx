"use client";

/**
 * /swap — manual, NON-CUSTODIAL token swap (§B-swap). The user picks a DEX + tokens + amount; the
 * app quotes on-chain (Uniswap V3 QuoterV2), the user signs the swap from their OWN wallet
 * (wagmi `writeContractAsync` via `useExecuteSwapTx`). SparkPoint never holds a key or custody, and
 * the swap recipient is ALWAYS the connecting account.
 *
 * Honest states only: disconnected → connect prompt; a chain without Uniswap (or Aerodrome, which is
 * Base-mainnet-only) → an honest "not on this network" notice; no pool → "no liquidity"; a quote
 * failure → dashes. The Base-Sepolia pool is THIN, so price impact is shown prominently and a
 * slippage floor (`amountOutMinimum`) + deadline guard every swap.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { wagmiConfig } from "@/lib/wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { StatusTag } from "@/components/ui/status-tag";
import { Seg } from "@/components/ui/seg";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { DEXES, dexById, dexDisplayLabel, dexLiveOn, type DexId } from "@/lib/swap/dex";
import { swapTokens, isConfiguredToken, type SwapToken } from "@/lib/swap/tokens";
import { useSwapQuote } from "@/lib/swap/useSwapQuote";
import { useExecuteSwapTx, type SwapExec } from "@/lib/swap/useExecuteSwapTx";
import {
  afterFee,
  amountOutMinimum,
  formatBpsPercent,
  DEFAULT_DEADLINE_SECONDS,
  HIGH_IMPACT_BPS,
  ROUTING_FEE_BIPS,
  SLIPPAGE_PRESETS_BPS,
} from "@/lib/swap/math";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];
const DISPLAY_CHAIN_ID = 84532;
const DASH = "—";
/** Keep a little native ETH for gas when the user taps "Max" on an ETH-in swap. */
const ETH_GAS_BUFFER = 10n ** 15n; // 0.001 ETH

function parseSafe(s: string, decimals: number): bigint {
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return 0n;
  try {
    return parseUnits(cleaned, decimals);
  } catch {
    return 0n;
  }
}

function fmt(v: bigint | undefined, decimals: number, max = 6): string {
  if (v === undefined) return DASH;
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export default function Page() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const activeChain = isConnected ? chainId : DISPLAY_CHAIN_ID;

  const [dexId, setDexId] = useState<DexId>("uniswap_v3");
  const [ethToUsdc, setEthToUsdc] = useState(true); // direction (only ETH↔USDC pair exists)
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(SLIPPAGE_PRESETS_BPS[0]);
  const [reviewing, setReviewing] = useState(false);

  const dex = dexById(dexId);
  const dexLive = dexLiveOn(dex, activeChain);

  // Chain-aware labels — the swap venue + network name follow the connected chain (Base Sepolia /
  // Base / Robinhood Testnet where the route is Synthra V3), so no copy hardcodes "Base Sepolia".
  const netLabel = activeChain === 46630 ? "Robinhood Testnet" : activeChain === 8453 ? "Base" : "Base Sepolia";
  const uniswapVenue = dexDisplayLabel(dexById("uniswap_v3"), activeChain);
  const swapTagTitle = `Real on-chain swaps via ${uniswapVenue} on ${netLabel}. You sign from your own wallet.`;

  // Resolve Uniswap addresses + the vault (for the routing-fee recipient) + tokens (fail-closed).
  const { router: routerAddr, quoter, vault, tokens } = useMemo(() => {
    try {
      const b = getAddresses(activeChain ?? DISPLAY_CHAIN_ID);
      return {
        router: b.uniswapV3SwapRouter02,
        quoter: b.uniswapV3QuoterV2,
        vault: b.vault,
        tokens: swapTokens(activeChain),
      };
    } catch {
      return { router: undefined, quoter: undefined, vault: undefined, tokens: [] as SwapToken[] };
    }
  }, [activeChain]);

  // §fee — the routing fee (0.20%, /fees page) is paid to the VAULT's feeRecipient(), read live so
  // the fee always lands on the real, on-chain recipient (matches /fees). Required to swap.
  const feeRecipientRead = useReadContract({
    address: vault,
    abi: sparkPointVaultAbi,
    functionName: "feeRecipient",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!vault },
  });
  const feeRecipient = feeRecipientRead.data as Address | undefined;
  // The 0.20% routing fee applies only where there's a vault to receive it (its feeRecipient). On a
  // chain with NO vault (e.g. Robinhood testnet 46630) the swap is fee-free and uses the plain path.
  const feeActive = !!vault;

  const eth = tokens.find((t) => t.isNative);
  const usdc = tokens.find((t) => !t.isNative);
  const tokenIn = ethToUsdc ? eth : usdc;
  const tokenOut = ethToUsdc ? usdc : eth;
  const pairReady =
    !!tokenIn && !!tokenOut && isConfiguredToken(tokenIn) && isConfiguredToken(tokenOut);

  const amountIn = tokenIn ? parseSafe(amount, tokenIn.decimals) : 0n;

  // Balances (direct-RPC, never the agent): native ETH + the USDC ERC-20.
  const ethBal = useBalance({ address, chainId: activeChain as WagmiChainId | undefined, query: { enabled: isConnected && !!address } });
  const usdcBal = useReadContract({
    address: usdc?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && !!usdc && isConfiguredToken(usdc) },
  });
  const allowance = useReadContract({
    address: usdc?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerAddr ? [address, routerAddr] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && !!usdc && !!routerAddr && !ethToUsdc },
  });
  const balanceIn = tokenIn?.isNative ? ethBal.data?.value : (usdcBal.data as bigint | undefined);

  const canQuote =
    dexId === "uniswap_v3" && dexLive && pairReady && amountIn > 0n && !!quoter && isConnected;
  const quote = useSwapQuote({
    chainId: activeChain,
    quoter,
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    amountIn,
    decimalsIn: tokenIn?.decimals ?? 18,
    enabled: canQuote,
  });

  // Gross = raw swap output; where a fee applies it's taken IN the swap, so the user nets output−fee.
  // Fee-free chains (no vault) net the gross output.
  const grossOut = quote.amountOut;
  const netOut =
    grossOut !== undefined ? (feeActive ? afterFee(grossOut, ROUTING_FEE_BIPS) : grossOut) : undefined;
  const minOut = grossOut !== undefined ? amountOutMinimum(grossOut, slippageBps) : undefined; // gross floor
  const netMinOut =
    minOut !== undefined ? (feeActive ? afterFee(minOut, ROUTING_FEE_BIPS) : minOut) : undefined;
  const needsApprove =
    !ethToUsdc && amountIn > 0n && (allowance.data === undefined || (allowance.data as bigint) < amountIn);
  const insufficient = balanceIn !== undefined && amountIn > balanceIn;

  // The real execution intent — built only when we have a live quote AND the fee recipient (the
  // 0.20% routing fee is taken in-swap, so we never execute without a resolved recipient).
  const exec: SwapExec | undefined = useMemo(() => {
    if (!routerAddr || !tokenIn || !tokenOut || !address || activeChain === undefined) return undefined;
    if (feeActive && !feeRecipient) return undefined; // fee chains need the recipient before executing
    if (quote.amountOut === undefined || quote.fee === undefined || minOut === undefined || amountIn <= 0n)
      return undefined;
    return {
      chainId: activeChain,
      router: routerAddr,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: quote.fee,
      account: address,
      amountIn,
      amountOutMinimum: minOut,
      deadlineSeconds: DEFAULT_DEADLINE_SECONDS,
      fromNative: tokenIn.isNative,
      toNative: tokenOut.isNative,
      needsApprove,
      feeBips: feeActive ? ROUTING_FEE_BIPS : 0,
      feeRecipient: feeActive ? feeRecipient : undefined,
      onDone: () => {
        void ethBal.refetch();
        void usdcBal.refetch();
        void allowance.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerAddr, tokenIn, tokenOut, address, activeChain, feeActive, feeRecipient, quote.amountOut, quote.fee, minOut, amountIn, needsApprove]);

  const swapCtrl = useExecuteSwapTx(reviewing ? exec : undefined);

  const highImpact = (quote.priceImpactBps ?? 0) >= HIGH_IMPACT_BPS;

  const onMax = () => {
    if (!tokenIn || balanceIn === undefined) return;
    const usable = tokenIn.isNative ? (balanceIn > ETH_GAS_BUFFER ? balanceIn - ETH_GAS_BUFFER : 0n) : balanceIn;
    setAmount(formatUnits(usable, tokenIn.decimals));
  };
  const flip = () => {
    setEthToUsdc((d) => !d);
    setAmount("");
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
          label={feeActive ? "You receive (estimated, after fee)" : "You receive (estimated)"}
          token={tokenOut}
          value={canQuote && netOut !== undefined && tokenOut ? fmt(netOut, tokenOut.decimals) : ""}
          placeholder={quote.isLoading ? "…" : "0.00"}
          editable={false}
        />

        {/* Quote details */}
        {canQuote && (
          <div style={{ marginTop: 14, display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row
              k="Price impact"
              v={quote.priceImpactBps === undefined ? DASH : formatBpsPercent(quote.priceImpactBps)}
              tone={highImpact ? "caution" : undefined}
            />
            <Row k="Pool fee tier" v={quote.fee !== undefined ? formatBpsPercent(quote.fee / 100) : DASH} />
            {feeActive && (
              <Row
                k={`SparkPoint routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`}
                v={grossOut !== undefined && netOut !== undefined && tokenOut
                  ? `${fmt(grossOut - netOut, tokenOut.decimals)} ${tokenOut.symbol}`
                  : DASH}
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
          <Notice>No {uniswapVenue} liquidity for this pair on {netLabel}.</Notice>
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
        {insufficient && <Notice>Amount exceeds your {tokenIn?.symbol} balance.</Notice>}
        {canQuote && !insufficient && feeActive && !feeRecipient && (
          <Notice>Reading the routing-fee recipient from the vault… the swap needs it before you can confirm.</Notice>
        )}

        {/* CTA / confirm / receipt */}
        {!swapCtrl.isDone ? (
          !reviewing ? (
            <button
              className="btn btn-primary btn-md"
              style={{ marginTop: 16, width: "100%" }}
              disabled={!canQuote || quote.amountOut === undefined || insufficient || amountIn <= 0n || (feeActive && !feeRecipient)}
              onClick={() => setReviewing(true)}
            >
              Review swap
            </button>
          ) : (
            <div className="card card-pad" style={{ marginTop: 16, background: "var(--muted-subtle, var(--card))" }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Confirm swap</div>
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                <Row k="You pay" v={`${amount} ${tokenIn?.symbol}`} />
                {feeActive && (
                  <Row
                    k={`SparkPoint routing fee (${formatBpsPercent(ROUTING_FEE_BIPS)})`}
                    v={grossOut !== undefined && netOut !== undefined && tokenOut
                      ? `${fmt(grossOut - netOut, tokenOut.decimals)} ${tokenOut.symbol}`
                      : DASH}
                  />
                )}
                <Row
                  k={feeActive ? "You receive (est., after fee)" : "You receive (est.)"}
                  v={netOut !== undefined && tokenOut ? `${fmt(netOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
                />
                <Row
                  k="Minimum received"
                  v={netMinOut !== undefined && tokenOut ? `${fmt(netMinOut, tokenOut.decimals)} ${tokenOut.symbol}` : DASH}
                />
                <Row k="Route" v={`${dexDisplayLabel(dex, activeChain)} · ${quote.fee !== undefined ? formatBpsPercent(quote.fee / 100) : DASH} pool`} />
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted-foreground)" }}>
                You sign this from your own wallet. SparkPoint never holds your keys or funds — the swap
                output{feeActive ? ` (net of the ${formatBpsPercent(ROUTING_FEE_BIPS)} routing fee)` : ""} goes
                straight to your address{feeActive ? ", and the fee goes on-chain straight to the vault's fee recipient" : ""}.
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
                  disabled={swapCtrl.isBusy || !exec}
                  onClick={() => swapCtrl.start()}
                >
                  {swapCtrl.isBusy ? swapCtrl.label : needsApprove ? `Approve + Swap` : "Confirm & swap"}
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
              {tokenOut?.symbol === "USDC" ? (
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
}: {
  label: string;
  token?: SwapToken;
  value: string;
  onChange?: (v: string) => void;
  editable: boolean;
  placeholder?: string;
  balance?: bigint;
  onMax?: () => void;
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
        <span className="pill" style={{ fontWeight: 700 }}>{token?.symbol ?? DASH}</span>
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
