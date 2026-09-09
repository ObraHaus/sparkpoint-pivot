/**
 * T025 — ABI + address wiring for the SparkPoint on-chain contracts.
 *
 * Two responsibilities, both drift-safe:
 *  1. Re-export the @sparkpoint/shared address-registry helpers so consumers read
 *     concrete addresses through the SINGLE source of truth (getAddresses /
 *     resolveTargetRef). Addresses are NEVER hardcoded here — they live only in
 *     the shared registry (R14, T098 guards drift).
 *  2. Re-export the REAL contract ABIs emitted by the T015 export pipeline
 *     (contracts/script/export-abis.sh → @sparkpoint/shared/abis). The vault +
 *     governance contracts (W5-US1) and the ERC-4337 account/factory/validator/policy
 *     contracts (W6-US2) are all implemented, so every ABI here is a generated
 *     artifact — no hand-maintained or placeholder ABIs remain.
 *
 * Third-party ABIs (Aave v3 Pool, Aerodrome Router, ERC-20/ERC-4626 reads) are
 * intentionally NOT declared here: they are not T015 outputs and will be sourced
 * from their own packages/viem at the call site, again never invented.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T025 (ABIs+addresses wiring
 * consuming packages/shared) & T015 (ABI export); smart-contracts.md §1 (contract
 * inventory); addresses/index.ts (R14 registry).
 */

// ── Address registry helpers (re-exported from the SoT — never re-implemented) ──
export { getAddresses, resolveTargetRef, addresses, ADDRESS_CHAIN_IDS } from "@sparkpoint/shared/addresses";
export type { Address, AddressBook, Network } from "@sparkpoint/shared/addresses";
export type { TargetRef } from "@sparkpoint/shared/policy";

/* ────────────────────────────────────────────────────────────────────────────
 * REAL ABIs — implemented contracts (W5-US1), from the T015 export pipeline.
 * These are the generated artifacts (contracts/script/export-abis.sh); the vault
 * ABI is what the PUBLIC /exit path encodes redeem/withdraw calldata against (N2).
 * ──────────────────────────────────────────────────────────────────────────── */

/** `SparkPointVault` — the non-upgradeable ERC-4626 Aave yield vault. */
export { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
/** `CapRegistry` — bounded param store for the caps (G2). */
export { capRegistryAbi } from "@sparkpoint/shared/abis";
/** `KillSwitch`/`Guardian` — PAUSE-ONLY controller (N5). */
export { killSwitchAbi } from "@sparkpoint/shared/abis";
/** `AaveV3Adapter` — stateless allowlist adapter (recipient forced). */
export { aaveV3AdapterAbi } from "@sparkpoint/shared/abis";

/* ────────────────────────────────────────────────────────────────────────────
 * REAL ABIs — ERC-4337 account stack (W6-US2), from the T015 export pipeline.
 * These are the generated artifacts; the account/session ABIs are what the
 * client encodes execute/validateUserOp/authorizeSessionKey calldata against.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `SparkPointAccount` — ERC-4337 UUPS account (execute/validateUserOp; N1/N3/N4). */
export { sparkPointAccountAbi } from "@sparkpoint/shared/abis";
/** `AccountFactory` — CREATE2 account factory bound to the owner EOA (N3). */
export { accountFactoryAbi } from "@sparkpoint/shared/abis";
/** `SessionKeyValidator` — ERC-4337 validator module (N4). */
export { sessionKeyValidatorAbi } from "@sparkpoint/shared/abis";
/** `PolicyModule` — on-chain allowlist/caps registry (N4, G2, G5). */
export { policyModuleAbi } from "@sparkpoint/shared/abis";
