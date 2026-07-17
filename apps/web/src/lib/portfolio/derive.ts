/**
 * Pure portfolio derivation from the LIVE `useVault` reads + native ETH — no agent, no indexer.
 *
 * Decimals are the hazard and are pinned here: USDC (underlying + idle) is 6-dp, vault shares
 * (spvUSDC) + native ETH are 18-dp. USD-denominated net worth is USDC-only — ETH is shown in ETH
 * (no price oracle, so it is never converted to USD or mixed into the USD total).
 */

import { formatUnits } from "viem";

const toNum = (x: bigint | undefined, decimals: number): number =>
  x === undefined ? 0 : Number(formatUnits(x, decimals));

export interface LivePosition {
  readonly key: "vault" | "idle";
  readonly label: string;
  readonly sub: string;
  readonly valueUsd: number;
  readonly shares?: number;
}

export interface DerivedPortfolio {
  readonly vaultValue: number; // USDC value of the vault position (6-dp source)
  readonly idleUsdc: number; // idle wallet USDC (6-dp source)
  readonly sharesNum: number; // vault shares (6-dp source: ERC-4626 share decimals == USDC)
  readonly ethBalance: number; // native ETH (18-dp source) — displayed in ETH, never USD
  readonly totalUsd: number; // net worth in USD = vaultValue + idleUsdc (ETH excluded)
  readonly hasPositions: boolean; // totalUsd > 0 (drives the empty state)
  readonly vaultPct: number; // allocation split (0 when empty)
  readonly idlePct: number;
  readonly positions: readonly LivePosition[];
}

export function derivePortfolio(input: {
  underlying?: bigint; // convertToAssets(shares) — 6-dp USDC
  usdcBalance?: bigint; // idle USDC — 6-dp
  shares?: bigint; // spvUSDC — 6-dp (vault share decimals == the USDC asset's)
  ethWei?: bigint; // native ETH — 18-dp
}): DerivedPortfolio {
  const vaultValue = toNum(input.underlying, 6);
  const idleUsdc = toNum(input.usdcBalance, 6);
  const sharesNum = toNum(input.shares, 6);
  const ethBalance = toNum(input.ethWei, 18);
  const totalUsd = vaultValue + idleUsdc;
  const hasPositions = totalUsd > 0;
  const vaultPct = hasPositions ? (vaultValue / totalUsd) * 100 : 0;
  const idlePct = hasPositions ? 100 - vaultPct : 0;
  const positions: LivePosition[] = [
    {
      key: "vault",
      label: "Aave Yield Vault",
      sub: `${sharesNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} spvUSDC`,
      valueUsd: vaultValue,
      shares: sharesNum,
    },
    { key: "idle", label: "Idle USDC", sub: "in your wallet", valueUsd: idleUsdc },
  ];
  return {
    vaultValue,
    idleUsdc,
    sharesNum,
    ethBalance,
    totalUsd,
    hasPositions,
    vaultPct,
    idlePct,
    positions,
  };
}
