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

import { toHref } from "@/lib/nav";
import { useRouter } from "next/navigation";
import {
  AmountField,
  FlowCard,
  FlowDisclaimer,
  FlowModeToggle,
  FlowNextStep,
  FlowNotice,
  FlowPrimary,
  FlowSectionTitle,
  SummaryBox,
  VaultFlowPage,
} from "@/components/vault/VaultFlow";
import {
  morphoFlowRows,
  vaultFlowCopy,
  type VaultFlowSummaryRow,
} from "@/lib/vault/vaultFlow";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import {
  buildMorphoDepositPlan,
  buildMorphoWithdrawPlan,
  findMorphoVault,
  validateMorphoVaultMetadata,
  MORPHO_VAULTS,
  morphoAmountAfterModeChange,
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

export interface MorphoLiveFlowProps {
  readonly vault: string | null;
  readonly chain: string | null;
  readonly asset: string | null;
  readonly mode: LiveEarnMode;
  readonly initialAmount: string | null;
  readonly notice?: string | null;
}

interface GasEstimate {
  readonly approve?: bigint;
  readonly main?: bigint;
  readonly priceGwei?: string;
  readonly error?: string;
}

export function MorphoLiveFlow({ vault, chain, asset, mode: initialMode, initialAmount, notice }: MorphoLiveFlowProps) {
  const meta: MorphoVaultMeta = useMemo(
    () => findMorphoVault(vault) ?? MORPHO_VAULTS[0]!,
    [vault],
  );
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
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

  const router = useRouter();
  const copy = vaultFlowCopy({
    mode,
    assetSymbol: meta.assetSymbol,
    vaultName: `Morpho ${meta.name}`,
    primaryLabel: !isConnected
      ? "Connect your wallet"
      : wrongChain
        ? "Switch to Base"
        : "Review transaction",
  });

  const receiveEstimate =
    mode === "deposit"
      ? previewDepositShares === undefined
        ? "estimated after you enter an amount"
        : `≈ ${formatUnits(previewDepositShares, shareDecimals)} ${meta.symbol} shares`
      : previewRedeemAssets === undefined
        ? "estimated after you enter an amount"
        : `≈ ${formatUnits(previewRedeemAssets, meta.assetDecimals)} ${meta.assetSymbol}`;
  const summaryRows = morphoFlowRows({
    mode,
    receive: receiveEstimate,
    netApy: null,
    maxDeposit: maxDeposit === undefined ? null : `${formatUnits(maxDeposit, meta.assetDecimals)} ${meta.assetSymbol}`,
    maxRedeem: maxRedeem === undefined ? null : `${formatUnits(maxRedeem, shareDecimals)} ${meta.symbol} shares`,
    assetSymbol: meta.assetSymbol,
  });

  const reviewRows: VaultFlowSummaryRow[] = plan
    ? [
        { key: "vault", label: "Vault", value: `${meta.name} (${short(meta.address)})` },
        { key: "signer", label: "Signing account", value: short(plan.account, 8, 6) },
        {
          key: "pay",
          label: plan.kind === "deposit" ? "You deposit" : "You redeem",
          value: `${amount} ${plan.kind === "deposit" ? meta.assetSymbol : `${meta.symbol} shares`}`,
        },
        {
          key: "receive",
          label: "You receive (estimate)",
          value:
            plan.kind === "deposit"
              ? previewDepositShares === undefined
                ? "…"
                : `${formatUnits(previewDepositShares, shareDecimals)} ${meta.symbol}`
              : previewRedeemAssets === undefined
                ? "…"
                : `${formatUnits(previewRedeemAssets, meta.assetDecimals)} ${meta.assetSymbol}`,
        },
        {
          key: "asset",
          label: "Asset",
          value: `${meta.assetSymbol} (${liveAssetDecimals ?? meta.assetDecimals} dp) · ${short(liveAsset ?? meta.asset)}`,
        },
        {
          key: "maxDeposit",
          label: "Vault max deposit (now)",
          value: maxDeposit === undefined ? "…" : `${formatUnits(maxDeposit, meta.assetDecimals)} ${meta.assetSymbol}`,
        },
        ...(mode === "withdraw"
          ? [
              {
                key: "maxRedeem",
                label: "Your max redeem",
                value: maxRedeem === undefined ? "…" : `${formatUnits(maxRedeem, shareDecimals)} ${meta.symbol} shares`,
              },
            ]
          : []),
        { key: "shares", label: "Shares", value: `${meta.symbol} (${shareDecimals} dp)` },
        {
          key: "total",
          label: "Vault total assets",
          value: totalAssets === undefined ? "…" : formatUnits(totalAssets, meta.assetDecimals),
        },
        { key: "fee", label: "SparkPoint fee", value: "0% — none on a direct deposit", tone: "gain" },
        ...(plan.kind === "deposit"
          ? [
              {
                key: "approve",
                label: "Approve leg",
                value: plan.needsApprove
                  ? `Approve ${meta.assetSymbol} (one extra wallet step)`
                  : "Not needed — allowance is enough",
                tone: plan.needsApprove ? ("caution" as const) : ("gain" as const),
              },
            ]
          : []),
        gas?.error
          ? { key: "gas", label: "Gas estimate", value: gas.error, tone: "caution" as const }
          : totalGas
            ? { key: "gasUnits", label: "Gas units (est.)", value: totalGas }
            : { key: "gas", label: "Gas estimate", value: "…" },
        ...(totalGas
          ? [
              {
                key: "gasFee",
                label: "Network fee (est.)",
                value:
                  gasCostEth !== undefined
                    ? `≈ ${gasCostEth.toFixed(6)} ETH`
                    : `@ ${gas?.priceGwei ?? "?"} gwei`,
              },
            ]
          : []),
      ]
    : [];

  return (
    <VaultFlowPage
      backHref={toHref("vault")}
      title={copy.title}
      subtitle={copy.subtitle}
      riskTier={2}
      testId="morpho-live-flow"
      footer={
        <>
          {plan && (
            <FlowCard testId="morpho-live-review">
              <FlowSectionTitle>
                Review {plan.kind} · {amount} {plan.kind === "deposit" ? meta.assetSymbol : `${meta.symbol} shares`}
              </FlowSectionTitle>
              <SummaryBox rows={reviewRows} testId="morpho-review-summary" />

              {accountChanged && (
                <FlowNotice tone="caution">
                  Your wallet account changed after review. This plan was prepared for{" "}
                  {short(plan.account)}; reconnect that account or go back and review again. Nothing
                  will be signed from the new account.
                </FlowNotice>
              )}
              <FlowNotice tone="caution">
                Review only until you confirm. Your wallet signs
                {plan.kind === "deposit" && plan.needsApprove ? " the approve, then the deposit" : ""};
                SparkPoint never signs or submits.
              </FlowNotice>
              {execCtl.error && <FlowNotice tone="caution">{execCtl.error}</FlowNotice>}
              {execCtl.isDone && execCtl.txHash && (
                <FlowNotice tone="gain">
                  Confirmed:{" "}
                  <a
                    href={`https://basescan.org/tx/${execCtl.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--primary)" }}
                  >
                    {short(execCtl.txHash)} ↗
                  </a>
                </FlowNotice>
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
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
                {meta.assetSymbol} stays in the Morpho vault under your wallet. There is no SparkPoint
                fee on this direct deposit; Morpho&apos;s own vault fee is disclosed by the vault.
              </div>
            </FlowCard>
          )}

          {isConnected && (
            <FlowCard>
              <FlowSectionTitle>Your Morpho position</FlowSectionTitle>
              <SummaryBox
                rows={[
                  { key: "shares", label: "Shares", value: `${formatUnits(shareBalance, shareDecimals)} ${meta.symbol}` },
                  {
                    key: "value",
                    label: "Value",
                    value:
                      positionAssets === undefined
                        ? "…"
                        : `${formatUnits(positionAssets, meta.assetDecimals)} ${meta.assetSymbol}`,
                  },
                  { key: "fee", label: "Vault fee", value: "Set by the vault's curator — see the vault on app.morpho.org" },
                ]}
                testId="morpho-position-summary"
              />
            </FlowCard>
          )}
        </>
      }
    >
      {!plan && (
        <>
      {notice && <FlowNotice tone="caution">{notice}</FlowNotice>}

      {!isConnected ? (
        <FlowNotice tone="info">
          Connect an EVM wallet on <b>Base</b> to continue. Sign-in and connecting never move funds.
        </FlowNotice>
      ) : wrongChain ? (
        <FlowNotice tone="caution">
          Your wallet is on chain {chainId}. Morpho live deposits in this slice are on Base only.
        </FlowNotice>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, marginBottom: 8 }}>
          <span style={{ color: MUTED }}>Connected</span>
          <span className="mono">{address ? short(address, 8, 6) : "—"}</span>
        </div>
      )}

      {chain && chain !== "base" && (
        <FlowNotice tone="caution">
          This link came from {chain}. Live Morpho deposits are on Base only for now; the cross-chain
          option remains a preview in Sparky.
        </FlowNotice>
      )}
      {asset && asset.toUpperCase() !== meta.assetSymbol.toUpperCase() && (
        <FlowNotice tone="caution">
          This vault accepts {meta.assetSymbol}, not {asset}. Amounts below are in {meta.assetSymbol}.
        </FlowNotice>
      )}

          <FlowModeToggle
            mode={mode}
            onChange={(option) => {
              setAmount(morphoAmountAfterModeChange(mode, option, amount));
              setMode(option);
              setPlan(null);
              setGas(null);
              setError(null);
            }}
            testId="morpho-live-action"
          />

          <AmountField
            id="morpho-amount"
            label={copy.amountLabel}
            assetSymbol={mode === "deposit" ? meta.assetSymbol : "shares"}
            value={amount}
            onChange={(next) => setAmount(next)}
            onMax={withdrawBlocked ? undefined : () => setAmount(maxAmount)}
            helper={
              mode === "deposit"
                ? `Wallet ${meta.assetSymbol} ≈ ${formatUnits(assetBalance, meta.assetDecimals)}`
                : `Position ≈ ${formatUnits(shareBalance, shareDecimals)} ${meta.symbol} shares${
                    positionAssets !== undefined
                      ? ` ≈ ${formatUnits(positionAssets, meta.assetDecimals)} ${meta.assetSymbol}`
                      : ""
                  }`
            }
            extra={
              <>
                {mode === "deposit" && amountRaw !== null && (
                  <div className="hint">
                    You receive ≈{" "}
                    {previewDepositShares === undefined
                      ? "…"
                      : formatUnits(previewDepositShares, shareDecimals)}{" "}
                    {meta.symbol} shares
                  </div>
                )}
                {mode === "withdraw" && amountRaw !== null && (
                  <div className="hint">
                    You receive ≈{" "}
                    {previewRedeemAssets === undefined
                      ? "…"
                      : formatUnits(previewRedeemAssets, meta.assetDecimals)}{" "}
                    {meta.assetSymbol}
                  </div>
                )}
                {withdrawBlocked && (
                  <div className="hint" style={{ color: "var(--caution)" }}>
                    No shares to redeem in this vault — withdraw is disabled.
                  </div>
                )}
              </>
            }
          />

          {error && <FlowNotice tone="caution">{error}</FlowNotice>}

          <SummaryBox rows={summaryRows} />

          <FlowDisclaimer>{copy.disclaimer}</FlowDisclaimer>
          <FlowPrimary
            onClick={() => {
              if (!isConnected) {
                router.push(toHref("connect"));
                return;
              }
              if (wrongChain) {
                switchChain({ chainId: READ_CHAIN_ID });
                return;
              }
              void review();
            }}
            disabled={
              isConnected &&
              !wrongChain &&
              (amount.trim() === "" || withdrawBlocked)
            }
          >
            {copy.primaryLabel}
          </FlowPrimary>
          <FlowNextStep>{copy.nextStep}</FlowNextStep>
        </>
      )}
    </VaultFlowPage>
  );
}
