/**
 * Address registry barrel — `Record<chainId, AddressBook>` (R14) + resolution
 * helpers. The single source of truth for concrete on-chain addresses, consumed
 * by the deploy/arm scripts, the off-chain policy layer, and the client policy
 * mirror. The policy allowlist references targets symbolically (`TargetRef`);
 * `resolveTargetRef(chainId, ref)` performs the address join here so addresses
 * live in exactly one place and cannot drift (the property T098 guards).
 */

import { CHAIN_ID, type TargetRef } from "../policy/index";
import { base } from "./base";
import { baseSepolia } from "./baseSepolia";
import { localFork } from "./localFork";
import { type Address, type AddressBook, TARGET_REF_FIELD } from "./types";

export type { Address, AddressBook, Network } from "./types";
export { TARGET_REF_FIELD } from "./types";
export { base } from "./base";
export { baseSepolia } from "./baseSepolia";
export { localFork } from "./localFork";

/**
 * Per-chain address books (R14). `31337` (localFork) mirrors `8453` (Base
 * mainnet) because it is the Anvil fork of Base mainnet.
 */
export const addresses: Record<number, AddressBook> = {
  [CHAIN_ID.base]: base,
  [CHAIN_ID.baseSepolia]: baseSepolia,
  [CHAIN_ID.localFork]: localFork,
};

/** The chain ids this registry knows (parity with policy/constants SUPPORTED_CHAIN_IDS). */
export const ADDRESS_CHAIN_IDS: readonly number[] = Object.values(CHAIN_ID);

/**
 * The address book for `chainId`.
 * @throws if `chainId` is not one of the supported chains (fail-closed — same
 *   contract as `getPolicyConstants`).
 */
export function getAddresses(chainId: number): AddressBook {
  const book = addresses[chainId];
  if (book === undefined) {
    throw new Error(
      `getAddresses: unsupported chainId ${chainId} (supported: ${ADDRESS_CHAIN_IDS.join(", ")})`,
    );
  }
  return book;
}

/**
 * Resolve a policy `TargetRef` to its concrete address on `chainId` — the join
 * that forms the `(target, selector)` pair the on-chain `PolicyModule` and the
 * T098 drift check compare.
 *
 * Returns `undefined` when the target is not deployed / not yet known on this
 * chain (Aerodrome on Base Sepolia; the vault before deploy). This is
 * fail-closed by design: a `undefined` target cannot form a `(target, selector)`
 * pair, so the action correctly fails allowlisting — never silently permitted.
 *
 * @throws if `chainId` is unsupported (via `getAddresses`).
 */
export function resolveTargetRef(chainId: number, ref: TargetRef): Address | undefined {
  return getAddresses(chainId)[TARGET_REF_FIELD[ref]];
}
