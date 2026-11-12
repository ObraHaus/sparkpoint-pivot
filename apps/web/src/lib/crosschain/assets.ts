/**
 * The client-side view of the 1Click route table used by the manual /swap page.
 *
 * This mirrors `services/agent/src/sparkpoint_agent/crosschain/routes.json`. It contains only
 * public asset metadata (never a key): the same keys the agent accepts on `POST /crosschain/quote`.
 * The agent remains the authority — an unknown or disabled asset is refused there — but the picker
 * needs a stable, testable list without a network round-trip.
 *
 * `enabled` / `unavailableReason` are surfaced honestly in the picker; a disabled asset never
 * becomes a fake quote.
 */

import type { CrossChainAddressKind } from "./address.ts";

export interface CrossChainAsset {
  readonly key: string;
  readonly chain: string;
  readonly chainLabel: string;
  readonly evmChainId: number | null;
  readonly symbol: string;
  readonly assetId: string;
  readonly decimals: number;
  readonly addressKind: CrossChainAddressKind;
  readonly enabled: boolean;
  readonly unavailableReason?: string;
}

export const CROSSCHAIN_ASSETS: readonly CrossChainAsset[] = [
  {
    key: "base:USDC",
    chain: "base",
    chainLabel: "Base",
    evmChainId: 8453,
    symbol: "USDC",
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    addressKind: "evm",
    enabled: true,
  },
  {
    key: "eth:USDC",
    chain: "eth",
    chainLabel: "Ethereum",
    evmChainId: 1,
    symbol: "USDC",
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    decimals: 6,
    addressKind: "evm",
    enabled: true,
  },
  {
    key: "eth:USDT",
    chain: "eth",
    chainLabel: "Ethereum",
    evmChainId: 1,
    symbol: "USDT",
    assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",
    decimals: 6,
    addressKind: "evm",
    enabled: true,
  },
  {
    key: "hood:USDG",
    chain: "hood",
    chainLabel: "Robinhood Chain",
    evmChainId: 4663,
    symbol: "USDG",
    assetId: "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near",
    decimals: 6,
    addressKind: "evm",
    enabled: true,
  },
  {
    key: "btc:BTC",
    chain: "btc",
    chainLabel: "Bitcoin",
    evmChainId: null,
    symbol: "BTC",
    assetId: "nep141:btc.omft.near",
    decimals: 8,
    addressKind: "btc",
    enabled: true,
  },
  {
    key: "sol:SOL",
    chain: "sol",
    chainLabel: "Solana",
    evmChainId: null,
    symbol: "SOL",
    assetId: "nep141:sol.omft.near",
    decimals: 9,
    addressKind: "sol",
    enabled: true,
  },
  {
    key: "sol:USDC",
    chain: "sol",
    chainLabel: "Solana",
    evmChainId: null,
    symbol: "USDC",
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    decimals: 6,
    addressKind: "sol",
    enabled: true,
  },
  {
    key: "near:wNEAR",
    chain: "near",
    chainLabel: "NEAR",
    evmChainId: null,
    symbol: "NEAR",
    assetId: "nep141:wrap.near",
    decimals: 24,
    addressKind: "near",
    enabled: true,
  },
  {
    key: "tron:USDT",
    chain: "tron",
    chainLabel: "Tron",
    evmChainId: null,
    symbol: "USDT",
    assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
    decimals: 6,
    addressKind: "tron",
    enabled: false,
    unavailableReason: "1Click is not quoting Tron payouts right now",
  },
];

export function crossChainAssetByKey(key: string | undefined | null): CrossChainAsset | undefined {
  if (!key) return undefined;
  return CROSSCHAIN_ASSETS.find((asset) => asset.key === key);
}

/** Assets the picker may offer (disabled ones stay visible with their reason in the UI). */
export function enabledCrossChainAssets(): readonly CrossChainAsset[] {
  return CROSSCHAIN_ASSETS.filter((asset) => asset.enabled);
}

/** The default origin: NEAR when that is the only connected wallet, otherwise Base USDC. */
export function defaultCrossChainOrigin(nearConnected: boolean): string {
  return nearConnected ? "near:wNEAR" : "base:USDC";
}

/** The default destination: Base USDC for a NEAR origin, otherwise Solana SOL. */
export function defaultCrossChainDestination(nearConnected: boolean): string {
  return nearConnected ? "base:USDC" : "sol:SOL";
}
