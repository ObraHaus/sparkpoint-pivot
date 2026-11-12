"use client";

/**
 * 077 — Morpho (Base) live deposit/withdraw flow.
 *
 * A Morpho V1 vault is plain ERC-4626, so same-chain live access needs no quote or intent:
 * approve (only when the allowance is short) + deposit, or redeem. The user's wallet is the only
 * signer — this reuses the existing `useExecuteVaultTx` (wagmi) and never takes custody.
 *
 * Share decimals are read separately from the asset decimals: this vault is 6-dp USDC over 18-dp
 * shares. Formatting shares with 6 would be a 1e12 error, so the two never share a formatter.
 */

import { useCallback, useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { encodeFunctionData, erc20Abi, formatUnits, parseAbi, type Address } from "viem";

import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import Link from "next/link";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import {
  buildMorphoDepositPlan,
  buildMorphoWithdrawPlan,
  findMorphoVault,
  validateMorphoVaultMetadata,
  MORPHO_VAULTS,
  morphoMaxWithdrawShares,
  parseMorphoAmount,
  type MorphoPlan,
  type MorphoVaultMeta,
} from "@/lib/earn/morphoLive";
import { useExecuteVaultTx, type VaultExec } from "@/lib/chain/useExecuteVaultTx";
import type { LiveEarnMode } from "@/lib/earn/liveFlags";

const READ_CHAIN_ID = base.id;
const MUTED = "var(--muted-foreground)";

const morphoVaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
]);

function short(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" | "gain" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span
        style={{
          color: tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--foreground)",
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "caution" | "gain" }) {
  const c = tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--info)";
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 12,
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

export interface MorphoLiveFlowProps {
  readonly vault: string | null;
  readonly chain: string | null;
  readonly asset: string | null;
  readonly mode: LiveEarnMode;
  readonly initialAmount: string | null;
}

interface GasEstimate {
  readonly approve?: bigint;
  readonly main?: bigint;
  readonly priceGwei?: string;
  readonly error?: string;
}

export function MorphoLiveFlow({ vault, chain, asset, mode: initialMode, initialAmount }: MorphoLiveFlowProps) {
  const meta: MorphoVaultMeta = useMemo(
    () => findMorphoVault(vault) ?? MORPHO_VAULTS[0]!,
    [vault],
  );
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: READ_CHAIN_ID });

  const [mode, setMode] = useState<LiveEarnMode>(initialMode);
  const [amount, setAmount] = useState(initialAmount?.replace(/,/g, "") ?? "");
  const [plan, setPlan] = useState<MorphoPlan | null>(null);
  const [gas, setGas] = useState<GasEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== READ_CHAIN_ID;
  // The reviewed plan pins one account. If the wallet switches after review, the old plan must
  // never be signed from the new account.
  const accountChanged =
    plan !== null && !!address && plan.account.toLowerCase() !== address.toLowerCase();

  const amountRaw = useMemo(() => {
    const decimals = mode === "deposit" ? meta.assetDecimals : meta.shareDecimals;
    return parseMorphoAmount(amount, decimals);
  }, [amount, meta.assetDecimals, meta.shareDecimals, mode]);

  const vaultReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: meta.address, abi: morphoVaultAbi, chainId: READ_CHAIN_ID, functionName: "asset" },
      { address: meta.address, abi: morphoVaultAbi, chainId: READ_CHAIN_ID, functionName: "decimals" },
      { address: meta.address, abi: morphoVaultAbi, chainId: READ_CHAIN_ID, functionName: "totalAssets" },
    ],
  });
  const liveAsset = vaultReads.data?.[0]?.result as Address | undefined;
  const liveShareDecimals = vaultReads.data?.[1]?.result as number | undefined;
  const totalAssets = vaultReads.data?.[2]?.result as bigint | undefined;
  const shareDecimals = liveShareDecimals ?? meta.shareDecimals;

  const assetDecimalsRead = useReadContract({
    address: meta.asset,
    abi: erc20Abi,
    chainId: READ_CHAIN_ID,
    functionName: "decimals",
  });
  const liveAssetDecimals = assetDecimalsRead.data as number | undefined;

  const accountReads = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: meta.address,
        abi: morphoVaultAbi,
        chainId: READ_CHAIN_ID,
        functionName: "balanceOf",
        args: [address as Address],
      },
      {
        address: meta.asset,
        abi: erc20Abi,
        chainId: READ_CHAIN_ID,
        functionName: "balanceOf",
        args: [address as Address],
      },
      {
        address: meta.asset,
        abi: erc20Abi,
        chainId: READ_CHAIN_ID,
        functionName: "allowance",
        args: [address as Address, meta.address],
      },
      {
        address: meta.address,
        abi: morphoVaultAbi,
        chainId: READ_CHAIN_ID,
        functionName: "maxDeposit",
        args: [address as Address],
      },
      {
        address: meta.address,
        abi: morphoVaultAbi,
        chainId: READ_CHAIN_ID,
        functionName: "maxRedeem",
        args: [address as Address],
      },
      {
        address: meta.address,
        abi: morphoVaultAbi,
        chainId: READ_CHAIN_ID,
        functionName: "maxWithdraw",
        args: [address as Address],
      },
    ],
    query: { enabled: !!address },
  });
  const shareBalance = (accountReads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const assetBalance = (accountReads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const allowance = accountReads.data?.[2]?.result as bigint | undefined;
  const maxDeposit = accountReads.data?.[3]?.result as bigint | undefined;
  const maxRedeem = accountReads.data?.[4]?.result as bigint | undefined;
  const maxWithdraw = accountReads.data?.[5]?.result as bigint | undefined;

  const positionAssetsRead = useReadContract({
    address: meta.address,
    abi: morphoVaultAbi,
    chainId: READ_CHAIN_ID,
    functionName: "convertToAssets",
    args: [shareBalance],
    query: { enabled: shareBalance > 0n },
  });
  const positionAssets = positionAssetsRead.data as bigint | undefined;

  const previewDepositRead = useReadContract({
    address: meta.address,
    abi: morphoVaultAbi,
    chainId: READ_CHAIN_ID,
    functionName: "previewDeposit",
    args: [mode === "deposit" ? (amountRaw ?? 0n) : 0n],
    query: { enabled: mode === "deposit" && (amountRaw ?? 0n) > 0n },
  });
  const previewDepositShares = previewDepositRead.data as bigint | undefined;

  const previewRedeemRead = useReadContract({
    address: meta.address,
    abi: morphoVaultAbi,
    chainId: READ_CHAIN_ID,
    functionName: "previewRedeem",
    args: [mode === "withdraw" ? (amountRaw ?? 0n) : 0n],
    query: { enabled: mode === "withdraw" && (amountRaw ?? 0n) > 0n },
  });
  const previewRedeemAssets = previewRedeemRead.data as bigint | undefined;

  const exec: VaultExec | undefined = useMemo(() => {
    if (!plan || !address) return undefined;
    const onDone = () => {
      void vaultReads.refetch();
      void accountReads.refetch();
      void positionAssetsRead.refetch();
    };
    if (plan.kind === "deposit") {
      return {
        kind: "deposit",
        chainId: READ_CHAIN_ID,
        vault: plan.vault,
        usdc: plan.token,
        account: plan.account,
        assets: plan.assets,
        needsApprove: plan.needsApprove,
        onDone,
      };
    }
    return {
      kind: "withdraw",
      chainId: READ_CHAIN_ID,
      vault: plan.vault,
      account: plan.account,
      shares: plan.shares,
      onDone,
    };
  }, [accountReads, address, plan, positionAssetsRead, vaultReads]);

  const execCtl = useExecuteVaultTx(exec);

  const estimate = useCallback(
    async (nextPlan: MorphoPlan) => {
      setGas(null);
      if (!publicClient) return;
      try {
        if (nextPlan.kind === "deposit") {
          const approve = nextPlan.needsApprove
            ? await publicClient.estimateGas({
                account: nextPlan.account,
                to: nextPlan.token,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [nextPlan.vault, nextPlan.assets],
                }),
              })
            : undefined;
          const main = await publicClient.estimateGas({
            account: nextPlan.account,
            to: nextPlan.vault,
            data: encodeFunctionData({
              abi: sparkPointVaultAbi,
              functionName: "deposit",
              args: [nextPlan.assets, nextPlan.account],
            }),
          });
          const price = await publicClient.getGasPrice();
          setGas({
            approve,
            main,
            priceGwei: formatUnits(price, 9),
          });
        } else {
          const main = await publicClient.estimateGas({
            account: nextPlan.account,
            to: nextPlan.vault,
            data: encodeFunctionData({
              abi: sparkPointVaultAbi,
              functionName: "redeem",
              args: [nextPlan.shares, nextPlan.account, nextPlan.account],
            }),
          });
          const price = await publicClient.getGasPrice();
          setGas({ main, priceGwei: formatUnits(price, 9) });
        }
      } catch (cause) {
        setGas({
          error:
            cause instanceof Error
              ? `Gas estimate unavailable — the simulation reverted. ${cause.message.slice(0, 120)}`
              : "Gas estimate unavailable — the simulation reverted.",
        });
      }
    },
    [publicClient],
  );

  const review = useCallback(async () => {
    setError(null);
    if (!address) {
      setError("Connect an EVM wallet on Base first.");
      return;
    }
    if (wrongChain) {
      setError("Switch your wallet to Base before reviewing this Morpho transaction.");
      return;
    }
    try {
      validateMorphoVaultMetadata(meta, {
        asset: liveAsset ?? null,
        assetDecimals: liveAssetDecimals ?? null,
        shareDecimals: shareDecimals ?? null,
      });
      const limits = {
        maxDeposit: maxDeposit ?? null,
        maxRedeem: maxRedeem ?? null,
        maxWithdraw: maxWithdraw ?? null,
      };
      const nextPlan =
        mode === "deposit"
          ? buildMorphoDepositPlan({ vault: meta.address, account: address, amount, allowance: allowance ?? null, limits })
          : buildMorphoWithdrawPlan({ vault: meta.address, account: address, amount, limits });
      setPlan(nextPlan);
      await estimate(nextPlan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That amount could not be prepared.");
    }
  }, [address, allowance, amount, estimate, liveAsset, liveAssetDecimals, maxDeposit, maxRedeem, maxWithdraw, meta, mode, shareDecimals, wrongChain]);

  const resetPlan = useCallback(() => {
    setPlan(null);
    setGas(null);
    setError(null);
    execCtl.reset();
  }, [execCtl]);

  const maxWithdrawShares = morphoMaxWithdrawShares(shareBalance, maxRedeem);
  const maxAmount =
    mode === "deposit"
      ? formatUnits(assetBalance, meta.assetDecimals)
      : formatUnits(maxWithdrawShares, shareDecimals);
  const withdrawBlocked = mode === "withdraw" && maxWithdrawShares === 0n;

  const totalGas =
    gas?.main !== undefined ? (gas.main + (gas.approve ?? 0n)).toString() : undefined;
  const gasCostEth =
    gas?.main !== undefined && gas.priceGwei !== undefined
      ? (Number(gas.main + (gas.approve ?? 0n)) * Number(gas.priceGwei)) / 1e9
      : undefined;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card card-pad" data-testid="morpho-live-flow">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Morpho · {meta.name}</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
              Direct ERC-4626 {mode} on Base · {meta.assetSymbol} · {meta.symbol} shares
            </div>
          </div>
          <span className="pill" style={{ alignSelf: "flex-start", fontSize: 11.5 }}>
            Live · flagged
          </span>
        </div>

        {!isConnected ? (
          <Notice>
            Connect an EVM wallet on <b>Base</b> to continue. Sign-in and connecting never move funds.
          </Notice>
        ) : wrongChain ? (
          <Notice tone="caution">
            Your wallet is on chain {chainId}. Morpho live deposits in this slice are on Base only.{" "}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ marginLeft: 8 }}
              disabled={switching}
              onClick={() => switchChain({ chainId: READ_CHAIN_ID })}
            >
              {switching ? "Switching…" : "Switch to Base"}
            </button>
          </Notice>
        ) : (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
            <span style={{ color: MUTED }}>Connected</span>
            <span className="mono">{address ? short(address, 8, 6) : "—"}</span>
          </div>
        )}

        {chain && chain !== "base" && (
          <Notice tone="caution">
            This link came from a {chain} rail. The live slice is same-chain Base only — the
            cross-chain route stays a dry preview in Sparky.
          </Notice>
        )}
        {asset && asset.toUpperCase() !== meta.assetSymbol.toUpperCase() && (
          <Notice tone="caution">
            This vault accepts {meta.assetSymbol}, not {asset}. Amounts below are in {meta.assetSymbol}.
          </Notice>
        )}

        {error && <Notice tone="caution">{error}</Notice>}

        {!plan ? (
          <>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(["deposit", "withdraw"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`pill${mode === option ? "" : " ghosty"}`}
                    onClick={() => {
                      setMode(option);
                      setPlan(null);
                      setGas(null);
                      setError(null);
                    }}
                    style={{ cursor: "pointer", textTransform: "capitalize" }}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <div className="field">
                <label htmlFor="morpho-amount">
                  {mode === "deposit" ? `Amount to deposit (${meta.assetSymbol})` : `Shares to redeem (${meta.symbol} shares, not ${meta.assetSymbol})`}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    id="morpho-amount"
                    className="input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    style={{ flex: 1 }}
                  />
                  {!withdrawBlocked && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(maxAmount)}>
                      Max
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
                  {mode === "deposit"
                    ? `Wallet ${meta.assetSymbol} ≈ ${formatUnits(assetBalance, meta.assetDecimals)}`
                    : `Position ≈ ${formatUnits(shareBalance, shareDecimals)} ${meta.symbol} shares${
                        positionAssets !== undefined ? ` ≈ ${formatUnits(positionAssets, meta.assetDecimals)} ${meta.assetSymbol}` : ""
                      }`}
                </div>
                {withdrawBlocked && (
                  <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 4 }}>
                    No shares to redeem in this vault — withdraw is disabled.
                  </div>
                )}
              </div>

              {mode === "deposit" && amountRaw !== null && (
                <div style={{ fontSize: 12, color: MUTED }}>
                  You receive ≈{" "}
                  {previewDepositShares === undefined
                    ? "…"
                    : formatUnits(previewDepositShares, shareDecimals)}{" "}
                  {meta.symbol} shares
                </div>
              )}
              {mode === "withdraw" && amountRaw !== null && (
                <div style={{ fontSize: 12, color: MUTED }}>
                  You receive ≈{" "}
                  {previewRedeemAssets === undefined
                    ? "…"
                    : formatUnits(previewRedeemAssets, meta.assetDecimals)}{" "}
                  {meta.assetSymbol}
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!isConnected || wrongChain || amount.trim() === "" || withdrawBlocked}
              onClick={() => void review()}
            >
              Review transaction
            </button>
          </>
        ) : (
          <div data-testid="morpho-live-review" style={{ marginTop: 14, display: "grid", gap: 5 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Review {plan.kind} · {amount} {plan.kind === "deposit" ? meta.assetSymbol : `${meta.symbol} shares`}
            </div>
            <Row k="Vault" v={`${meta.name} (${short(meta.address)})`} />
            <Row k="Signing account" v={short(plan.account, 8, 6)} />
            <Row k={plan.kind === "deposit" ? "You deposit" : "You redeem"} v={`${amount} ${plan.kind === "deposit" ? meta.assetSymbol : `${meta.symbol} shares`}`} />
            <Row
              k="You receive (estimate)"
              v={
                plan.kind === "deposit"
                  ? previewDepositShares === undefined
                    ? "…"
                    : `${formatUnits(previewDepositShares, shareDecimals)} ${meta.symbol}`
                  : previewRedeemAssets === undefined
                    ? "…"
                    : `${formatUnits(previewRedeemAssets, meta.assetDecimals)} ${meta.assetSymbol}`
              }
            />
            <Row
              k="Asset"
              v={`${meta.assetSymbol} (${liveAssetDecimals ?? meta.assetDecimals} dp) · ${short(liveAsset ?? meta.asset)}`}
            />
            <Row
              k="Vault max deposit (now)"
              v={maxDeposit === undefined ? "…" : `${formatUnits(maxDeposit, meta.assetDecimals)} ${meta.assetSymbol}`}
            />
            {mode === "withdraw" && (
              <Row
                k="Your max redeem"
                v={maxRedeem === undefined ? "…" : `${formatUnits(maxRedeem, shareDecimals)} ${meta.symbol} shares`}
              />
            )}
            <Row k="Shares" v={`${meta.symbol} (${shareDecimals} dp)`} />
            <Row k="Vault total assets" v={totalAssets === undefined ? "…" : formatUnits(totalAssets, meta.assetDecimals)} />
            <Row k="SparkPoint fee" v="0% — none on a direct deposit" tone="gain" />
            {plan.kind === "deposit" && (
              <Row
                k="Approve leg"
                v={plan.needsApprove ? `Approve ${meta.assetSymbol} (one extra wallet step)` : "Not needed — allowance is enough"}
                tone={plan.needsApprove ? "caution" : "gain"}
              />
            )}
            {gas?.error ? (
              <Row k="Gas estimate" v={gas.error} tone="caution" />
            ) : totalGas ? (
              <>
                <Row k="Gas units (est.)" v={totalGas} />
                <Row
                  k="Network fee (est.)"
                  v={gasCostEth !== undefined ? `≈ ${gasCostEth.toFixed(6)} ETH` : `@ ${gas?.priceGwei ?? "?"} gwei`}
                />
              </>
            ) : (
              <Row k="Gas estimate" v="…" />
            )}

            {accountChanged && (
              <Notice tone="caution">
                Your wallet account changed after review. This plan was prepared for{" "}
                {short(plan.account)}; reconnect that account or go back and review again. Nothing
                will be signed from the new account.
              </Notice>
            )}
            <Notice tone="caution">
              Review only until you confirm. Your wallet signs{plan.kind === "deposit" && plan.needsApprove ? " the approve, then the deposit" : ""}; SparkPoint never signs or submits.
            </Notice>
            {execCtl.error && <Notice tone="caution">{execCtl.error}</Notice>}
            {execCtl.isDone && execCtl.txHash && (
              <Notice tone="gain">
                Confirmed:{" "}
                <a
                  href={`https://basescan.org/tx/${execCtl.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--primary)" }}
                >
                  {short(execCtl.txHash)} ↗
                </a>
              </Notice>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost btn-md" onClick={resetPlan} disabled={execCtl.isBusy}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-md"
                onClick={() => {
                  if (accountChanged) {
                    setError(
                      "Your wallet account changed after review. Go back and review again; nothing was signed.",
                    );
                    return;
                  }
                  execCtl.start();
                }}
                disabled={execCtl.isBusy || execCtl.isDone || accountChanged || wrongChain}
              >
                {execCtl.isBusy ? execCtl.label : execCtl.isDone ? "Confirmed" : "Confirm in wallet"}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
              {meta.assetSymbol} stays in the Morpho vault under your wallet. There is no SparkPoint
              fee on this direct deposit; Morpho&apos;s own vault fee is disclosed by the vault.
            </div>
          </div>
        )}
      </div>

      {isConnected && (
        <div className="card card-pad">
          <div style={{ fontSize: 14, fontWeight: 600 }}>Your Morpho position</div>
          <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
            <Row k="Shares" v={`${formatUnits(shareBalance, shareDecimals)} ${meta.symbol}`} />
            <Row
              k="Value"
              v={
                positionAssets === undefined
                  ? "…"
                  : `${formatUnits(positionAssets, meta.assetDecimals)} ${meta.assetSymbol}`
              }
            />
            <Row k="Vault fee" v="Set by the vault's curator — see the vault on app.morpho.org" />
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
        <Icon name="info" size={12} /> Prefer the registry view?{" "}
        <Link href={toHref("vault")} style={{ color: "var(--primary)" }}>
          Back to Vault
        </Link>
        . The cross-chain Morpho receipt preview in Sparky is unchanged.
      </div>
    </div>
  );
}
