/**
 * Token + network logo sourcing (online, with a safe fallback).
 *
 * 052 — LOCAL FIRST. The collected art is bundled under `apps/web/public/tokens/` and resolved by
 * exact chain+address (the Robinhood stock tokens, USDG) or by a VERIFIED symbol (ETH/WETH/USDC/
 * USDG). Local-first means no hotlinking, no third-party outage/geo-block, and no token address
 * sent to a CDN. Only when nothing local matches do we fall back to the Trust Wallet CDN, then to
 * the deterministic letter avatar.
 *
 * Two safety rules are UNCHANGED:
 *  1. A curated symbol logo (ETH/USDC/…) is used ONLY for a VERIFIED token — a fake "USDC"
 *     (unverified) never gets the real USDC logo; it falls through to the by-address lookup (which
 *     404s for a scam/testnet token) → the letter avatar. So an icon never reinforces a phishing
 *     symbol.
 *  2. The icon is decorative only — it is NEVER a trust signal. The verified/unverified badge stays
 *     the authoritative safety indicator.
 */

import { getAddress } from "viem";

const CDN = "https://assets-cdn.trustwallet.com/blockchains";
const ETH_LOGO = `${CDN}/ethereum/info/logo.png`;
/** Canonical mainnet USDC — its logo is used for any VERIFIED USDC (testnet USDC has no logo of its own). */
const USDC_LOGO = `${CDN}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`;

/** Bundled art by symbol — applied to a VERIFIED token only (native ETH is always real). */
const LOCAL_BY_SYMBOL: Record<string, string> = {
  ETH: "/tokens/eth.png",
  WETH: "/tokens/weth.png",
  USDC: "/tokens/usdc.png",
  USDG: "/tokens/usdg.png",
};

/**
 * Bundled art by chain + exact lowercase address — the Robinhood stock tokens + USDG on 4663.
 * SPY, QQQ and GLD are deliberately absent (no reliable public logo) and keep the letter avatar.
 */
const LOCAL_BY_ADDRESS: Record<number, Record<string, string>> = {
  4663: {
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "/tokens/usdg.png", // USDG
    "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "/tokens/nvda.svg", // NVDA
    "0x322f0929c4625ed5bad873c95208d54e1c003b2d": "/tokens/tsla.svg", // TSLA
    "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3": "/tokens/googl.svg", // GOOGL
    "0xc0d6457c16cc70d6790dd43521c899c87ce02f35": "/tokens/meta.svg", // META
    "0x6330d8c3178a418788df01a47479c0ce7ccf450b": "/tokens/coin.svg", // COIN
    "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "/tokens/aapl.svg", // AAPL
    "0x12f190a9f9d7d37a250758b26824b97ce941bf54": "/tokens/amzn.svg", // AMZN
    "0xe93237c50d904957cf27e7b1133b510c669c2e74": "/tokens/msft.svg", // MSFT
    "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea": "/tokens/spcx.svg", // SPCX
    "0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5": "/tokens/crcl.svg", // CRCL (mono)
    "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c": "/tokens/rddt.svg", // RDDT
  },
};

/**
 * chainId → Trust Wallet blockchain slug for the by-address asset path. Testnet chains map to their
 * MAINNET equivalent, so a token that also exists on mainnet at the same address resolves; a
 * testnet-only token 404s and falls back to the avatar. Robinhood (4663/46630) has no slug → no CDN
 * lookup (the local map above covers what we ship).
 */
const TW_SLUG: Record<number, string> = { 1: "ethereum", 8453: "base", 84532: "base" };

export interface LogoToken {
  readonly symbol: string;
  readonly address: string;
  readonly isNative?: boolean;
  readonly verified?: boolean;
}

/** An online/local logo URL for a token, or `undefined` when none is known (caller shows an avatar). */
export function tokenLogoUrl(chainId: number | undefined, token: LogoToken): string | undefined {
  if (token.isNative) return LOCAL_BY_SYMBOL.ETH; // native ETH is always the real ETH
  if (chainId !== undefined) {
    try {
      const local = LOCAL_BY_ADDRESS[chainId]?.[getAddress(token.address).toLowerCase()];
      if (local) return local;
    } catch {
      /* not a valid address — fall through to the symbol/CDN paths */
    }
  }
  const sym = token.symbol?.toUpperCase();
  if (token.verified) {
    if (sym && LOCAL_BY_SYMBOL[sym]) return LOCAL_BY_SYMBOL[sym];
    if (sym === "USDC") return USDC_LOGO;
  }
  const slug = chainId !== undefined ? TW_SLUG[chainId] : undefined;
  if (!slug) return undefined;
  try {
    return `${CDN}/${slug}/assets/${getAddress(token.address)}/logo.png`;
  } catch {
    return undefined; // not a valid address → avatar
  }
}

/** Per-network logo URL, or `undefined` (caller shows the network's colored dot). */
const NETWORK_LOGO: Record<number, string> = {
  1: ETH_LOGO,
  8453: `${CDN}/base/info/logo.png`,
  84532: `${CDN}/base/info/logo.png`,
  46630: "/networks/robinhood.png", // Robinhood Chain testnet — bundled brand asset (no CDN logo exists)
  4663: "/networks/robinhood.png", // Robinhood Chain mainnet — same Robinhood brand asset as 46630
};
export function networkLogoUrl(chainId: number | undefined): string | undefined {
  return chainId !== undefined ? NETWORK_LOGO[chainId] : undefined;
}

/** A deterministic avatar background color from a token symbol (fallback when there's no logo). */
const PALETTE = ["#0052FF", "#00C805", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#14b8a6"];
export function avatarColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
