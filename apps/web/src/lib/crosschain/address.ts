/**
 * 068 — client-side destination/refund address FORMAT checks.
 *
 * Mirrors `services/agent/src/sparkpoint_agent/crosschain/addresses.py` exactly. These are shape
 * checks only: 1Click remains the authority on whether an address is usable, and the agent
 * re-validates every address on the confirm (`dry=false`) call. Keeping the copy client-side means
 * an obvious typo never leaves the browser, not that the browser is trusted.
 */

export type CrossChainAddressKind = "evm" | "btc" | "sol" | "tron" | "near";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BTC_BECH32_RE = /^(?:bc1|tb1)[02-9ac-hj-np-z]{11,71}$/;
const BTC_BASE58_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const NEAR_RE = /^[a-z0-9][a-z0-9._-]{1,62}(?:\.near)?$/;

/** True when `value` has the expected shape for `kind` (after trimming surrounding whitespace). */
export function isValidAddress(value: string, kind: CrossChainAddressKind): boolean {
  const candidate = value.trim();
  if (!candidate) return false;
  switch (kind) {
    case "evm":
      return EVM_RE.test(candidate);
    case "btc":
      return BTC_BECH32_RE.test(candidate) || BTC_BASE58_RE.test(candidate);
    case "sol":
      return SOL_RE.test(candidate);
    case "tron":
      return TRON_RE.test(candidate);
    case "near":
      return NEAR_RE.test(candidate);
    default:
      return false;
  }
}

/** A short human description, matching the agent's 400 messages. */
export function expectedAddressDescription(kind: CrossChainAddressKind): string {
  switch (kind) {
    case "evm":
      return "a 20-byte 0x address";
    case "btc":
      return "a Bitcoin bech32 or base58 address";
    case "sol":
      return "a base58 Solana address (32–44 characters)";
    case "tron":
      return "a Tron address (T + 33 base58 characters)";
    case "near":
      return "a NEAR account id";
    default:
      return "a valid address";
  }
}

/**
 * The address family of an ORIGIN leg. The chat block carries `evmChainId` but deliberately does
 * not duplicate `addressKind` on the origin, so infer it: any EVM chain id means `evm`, otherwise
 * the short chain key (btc/sol/tron/near) names the family.
 */
export function addressKindForOrigin(
  chain: string,
  evmChainId: number | null | undefined,
): CrossChainAddressKind | null {
  if (typeof evmChainId === "number") return "evm";
  switch (chain.trim().toLowerCase()) {
    case "btc":
      return "btc";
    case "sol":
      return "sol";
    case "tron":
      return "tron";
    case "near":
      return "near";
    default:
      return null;
  }
}
