"use client";

/**
 * resolveErc20 — on-chain metadata resolution for an ARBITRARY ERC-20 (universal swap, feature 007).
 *
 * When a user (or the assistant) supplies a token address, its identity MUST come from the chain, never
 * from the wire/agent/cache (spec FR-003): the on-chain `decimals()` is authoritative for scaling, and a
 * mis-scaled `decimals` on the input leg overspends by powers of ten. This resolver reads
 * decimals/symbol/name via a single `multicall(allowFailure)` on the same direct-RPC read plane the swap
 * quote uses (`getPublicClient`, never the agent), with a `bytes32` fallback for MakerDAO-era tokens
 * (MKR returns `bytes32`, not `string`), string sanitization against homoglyph/zero-width spoofing, and a
 * hard "is-contract + has-decimals" gate. Fail-closed: anything unreadable returns `{ ok: false }` and no
 * quote is produced. Pure helpers live in `./metadata.pure` (unit-tested); re-exported here for callers.
 */

import { type Address, erc20Abi, getAddress, hexToString, isHex } from "viem";
import { getPublicClient } from "@/lib/chain/clients";
import { isPlausibleDecimals, sanitizeMetaString, shortAddressLabel } from "./metadata.pure";

export { isPlausibleDecimals, sanitizeMetaString, shortAddressLabel } from "./metadata.pure";

export interface ResolvedToken {
  readonly address: Address;
  readonly symbol: string;
  readonly name?: string;
  readonly decimals: number;
}

export type ResolveResult =
  | { readonly ok: true; readonly token: ResolvedToken }
  | { readonly ok: false; readonly reason: string };

/** bytes32 `symbol()`/`name()` fallback ABI (MKR and other old tokens return bytes32, not string). */
const bytes32MetaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

/** Decode a right-zero-padded `bytes32` string (e.g. MKR's symbol) to a sanitized display string. */
export function decodeBytes32(hex: unknown): string {
  if (typeof hex !== "string" || !isHex(hex)) return "";
  try {
    return sanitizeMetaString(hexToString(hex as `0x${string}`));
  } catch {
    return "";
  }
}

/** In-memory cache of successful resolutions, keyed by chain + lowercased address (metadata is immutable). */
const cache = new Map<string, ResolvedToken>();
const cacheKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

/**
 * Resolve an arbitrary ERC-20's on-chain identity. Fail-closed: returns `{ ok: false, reason }` for a
 * bad address, a non-contract, or a token with no readable `decimals()` — the caller MUST NOT quote it.
 */
export async function resolveErc20(chainId: number, address: string): Promise<ResolveResult> {
  let addr: Address;
  try {
    addr = getAddress(address); // checksums + validates the 20-byte shape (throws otherwise)
  } catch {
    return { ok: false, reason: "That doesn't look like a valid token address." };
  }

  const cached = cache.get(cacheKey(chainId, addr));
  if (cached !== undefined) return { ok: true, token: cached };

  let client;
  try {
    client = getPublicClient(chainId);
  } catch {
    return { ok: false, reason: "Custom tokens aren't supported on this network." };
  }

  try {
    // is-contract gate: an EOA / undeployed address has no code and can't be an ERC-20.
    const code = await client.getCode({ address: addr });
    if (!code || code === "0x") {
      return { ok: false, reason: "This address has no contract code — it isn't an ERC-20 token." };
    }

    const [decRes, symRes, nameRes] = await client.multicall({
      allowFailure: true,
      contracts: [
        { address: addr, abi: erc20Abi, functionName: "decimals" },
        { address: addr, abi: erc20Abi, functionName: "symbol" },
        { address: addr, abi: erc20Abi, functionName: "name" },
      ],
    });

    // decimals is the HARD gate — no readable decimals ⇒ not a usable ERC-20 (never guess).
    if (decRes.status !== "success") {
      return { ok: false, reason: "This token doesn't expose decimals() — it can't be swapped safely." };
    }
    const decimals = Number(decRes.result);
    if (!isPlausibleDecimals(decimals)) {
      return { ok: false, reason: "This token reports unusual decimals — refusing to avoid mis-scaling." };
    }

    // symbol: string first, then bytes32, then an honest short-address label.
    let symbol = symRes.status === "success" ? sanitizeMetaString(symRes.result) : "";
    if (!symbol) {
      const b = await client
        .readContract({ address: addr, abi: bytes32MetaAbi, functionName: "symbol" })
        .catch(() => undefined);
      symbol = decodeBytes32(b);
    }
    if (!symbol) symbol = shortAddressLabel(addr);

    // name: optional; string then bytes32; omitted if unreadable.
    let name = nameRes.status === "success" ? sanitizeMetaString(nameRes.result) : "";
    if (!name) {
      const b = await client
        .readContract({ address: addr, abi: bytes32MetaAbi, functionName: "name" })
        .catch(() => undefined);
      name = decodeBytes32(b);
    }

    const token: ResolvedToken = { address: addr, symbol, decimals, ...(name ? { name } : {}) };
    cache.set(cacheKey(chainId, addr), token);
    return { ok: true, token };
  } catch {
    // Transport/RPC error — honest retryable failure, distinct from "not a token".
    return { ok: false, reason: "Couldn't read this token on-chain just now — check your connection and retry." };
  }
}
