/**
 * localFork (chainId 31337) address book — the Anvil fork of Base mainnet.
 *
 * R14: the local fork MIRRORS the Base-mainnet targets exactly (it forks Base
 * mainnet state), so this book is `base` re-stamped with chainId 31337. Keeping
 * it derived from `base` (rather than re-typed) guarantees the fork can never
 * drift from the mainnet targets it forks. This matches policy/constants.ts,
 * whose `getPolicyConstants(31337)` returns the Base-mainnet allowlist.
 */

import { CHAIN_ID } from "../policy/index.js";
import { base } from "./base.js";
import type { AddressBook } from "./types.js";

export const localFork: AddressBook = {
  ...base,
  chainId: CHAIN_ID.localFork,
  network: "localFork",
};
