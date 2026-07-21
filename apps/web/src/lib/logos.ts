/**
 * Token + network logo sourcing (online, with a safe fallback).
 *
 * Icons are sourced from the Trust Wallet asset CDN. Two safety rules:
 *  1. A curated symbol logo (ETH/USDC) is used ONLY for a VERIFIED token — a fake "USDC" (unverified)
 *     never gets the real USDC logo; it falls through to the by-address lookup (which 404s for a
 *     scam/testnet token) → the letter avatar. So an icon never reinforces a phishing symbol.
 *  2. The icon is decorative only — it is NEVER a trust signal. The verified/unverified badge stays the
 *     authoritative safety indicator.
 * A per-address lookup sends the token address to the CDN (a minor privacy trade-off the user opts into
 * by asking for online icons); most testnet tokens have no logo and resolve to the local avatar anyway.
 */

import { getAddress } from "viem";

const CDN = "https://assets-cdn.trustwallet.com/blockchains";
const ETH_LOGO = `${CDN}/ethereum/info/logo.png`;
/** Canonical mainnet USDC — its logo is used for any VERIFIED USDC (testnet USDC has no logo of its own). */
const USDC_LOGO = `${CDN}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`;

/**
 * chainId → Trust Wallet blockchain slug for the by-address asset path. Testnet chains map to their
 * MAINNET equivalent, so a token that also exists on mainnet at the same address resolves; a
 * testnet-only token 404s and falls back to the avatar. Robinhood (46630) has no slug → no CDN lookup.
 */
const TW_SLUG: Record<number, string> = { 1: "ethereum", 8453: "base", 84532: "base" };

export interface LogoToken {
  readonly symbol: string;
  readonly address: string;
  readonly isNative?: boolean;
  readonly verified?: boolean;
}

/** An online logo URL for a token, or `undefined` when none is known (caller shows a letter avatar). */
export function tokenLogoUrl(chainId: number | undefined, token: LogoToken): string | undefined {
  if (token.isNative) return ETH_LOGO; // native ETH is always the real ETH
  const sym = token.symbol?.toUpperCase();
  if (token.verified) {
    if (sym === "ETH" || sym === "WETH") return ETH_LOGO;
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
  // 46630 Robinhood testnet — no reliable online logo; falls back to the network color dot.
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
