/**
 * T025 — ABI + address wiring for the SparkPoint on-chain contracts.
 *
 * Two responsibilities, both drift-safe:
 *  1. Re-export the @sparkpoint/shared address-registry helpers so consumers read
 *     concrete addresses through the SINGLE source of truth (getAddresses /
 *     resolveTargetRef). Addresses are NEVER hardcoded here — they live only in
 *     the shared registry (R14, T098 guards drift).
 *  2. Declare TYPED ABI placeholders for the SparkPoint-owned contracts. The real
 *     ABIs are emitted by the T015 export pipeline from the contracts build, which
 *     has NOT run yet, so these are empty `[] as const satisfies Abi` — a correct,
 *     narrow, viem-inferable placeholder rather than an invented/guessed ABI. Each
 *     is replaced wholesale by the generated artifact when T015 lands.
 *
 * Third-party ABIs (Aave v3 Pool, Aerodrome Router, ERC-20/ERC-4626 reads) are
 * intentionally NOT declared here: they are not T015 outputs and will be sourced
 * from their own packages/viem at the call site, again never invented.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T025 (ABIs+addresses wiring
 * consuming packages/shared) & T015 (ABI export); smart-contracts.md §1 (contract
 * inventory); addresses/index.ts (R14 registry).
 */

import type { Abi } from "viem";

// ── Address registry helpers (re-exported from the SoT — never re-implemented) ──
export { getAddresses, resolveTargetRef, addresses, ADDRESS_CHAIN_IDS } from "@sparkpoint/shared/addresses";
export type { Address, AddressBook, Network } from "@sparkpoint/shared/addresses";
export type { TargetRef } from "@sparkpoint/shared/policy";

/* ────────────────────────────────────────────────────────────────────────────
 * SparkPoint contract ABI placeholders (smart-contracts.md §1).
 * TODO(T015): replace each `[]` with the ABI emitted by the contracts build.
 * `satisfies Abi` keeps the narrow `readonly []` type so viem's inference stays
 * intact once the real items are generated in.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `SparkPointAccount` — ERC-4337 UUPS account (execute/validateUserOp). */
export const sparkPointAccountAbi = [] as const satisfies Abi;

/** `AccountFactory` — CREATE2 account factory bound to the owner EOA (N3). */
export const accountFactoryAbi = [] as const satisfies Abi;

/** `SessionKeyValidator` — ERC-4337 validator module (N4). */
export const sessionKeyValidatorAbi = [] as const satisfies Abi;

/** `PolicyModule` — on-chain allowlist/caps registry (N4, G2, G5). */
export const policyModuleAbi = [] as const satisfies Abi;

/** `SparkPointVault` — the non-upgradeable ERC-4626 Aave yield vault. */
export const sparkPointVaultAbi = [] as const satisfies Abi;

/** `CapRegistry` — bounded param store for the caps (G2). */
export const capRegistryAbi = [] as const satisfies Abi;

/** `KillSwitch`/`Guardian` — PAUSE-ONLY controller (N5). */
export const killSwitchAbi = [] as const satisfies Abi;
