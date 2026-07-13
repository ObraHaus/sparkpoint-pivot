/**
 * T025 — the SparkPoint CUSTOM ERC-4337 account adapter (Gate-A: NO ZeroDev).
 *
 * This is the concrete {@link SparkPointAccountAdapter} the app ships with. Its
 * SHAPE is final and is what W4 delivers; its on-chain binding is not. The custom
 * factory/account addresses are deploy-time-determined and land with the W6
 * deploy, and the account's ABI is produced by the T015 export pipeline (not yet
 * run). Until then every method that needs those artifacts FAILS CLOSED with a
 * clear "account contracts not yet deployed (W6)" error — never a silent stub,
 * never a fabricated address.
 *
 * Non-custody: holds/derives NO private key. Address derivation is CREATE2 math
 * over the owner EOA; nothing here signs.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T025; smart-contracts.md §1
 * (SparkPointAccount UUPS impl + AccountFactory CREATE2, N3); Gate-A decision
 * (custom ERC-4337, no ZeroDev/Kernel). Addresses come exclusively from the
 * @sparkpoint/shared registry (never hardcoded).
 */

import { getAddresses } from "@sparkpoint/shared/addresses";
import type { Address } from "@sparkpoint/shared/addresses";
import type { Hex } from "viem";
import type { Call, SparkPointAccountAdapter } from "./types";

/** Config for a custom-account adapter instance (bound to one chain). */
export interface CustomAccountConfig {
  /** The chain the account resolves addresses/ABIs against (8453 · 84532 · 31337). */
  readonly chainId: number;
}

/**
 * Build the fail-closed "not yet deployed" error for `chainId`, reading the live
 * `accountFactory` from the SoT address book so the message reflects the actual
 * (currently `undefined`) deploy state rather than a hardcoded assumption.
 */
function accountContractsNotDeployed(chainId: number): never {
  // getAddresses() throws first if chainId is unsupported (fail-closed).
  const { accountFactory } = getAddresses(chainId);
  throw new Error(
    `SparkPoint account contracts not yet deployed (W6): accountFactory on chain ${chainId} is ` +
      `${accountFactory ?? "undefined"}. The custom ERC-4337 factory/account binding and its ABIs ` +
      `(T015 export) are pending; this adapter's shape is final, its on-chain logic lands with the W6 deploy.`,
  );
}

/**
 * The active custom-account adapter, bound to `chainId`. Every method is wired to
 * the @sparkpoint/shared address registry and throws until the W6 deploy + T015
 * ABI export fill in the factory/account.
 */
export function createSparkPointAccount({ chainId }: CustomAccountConfig): SparkPointAccountAdapter {
  return {
    // TODO(W6/T015): CREATE2 counterfactual = f(accountFactory, accountImpl, owner-derived salt).
    getAddress: async (_owner: Address): Promise<Address> => accountContractsNotDeployed(chainId),

    // TODO(W6): read on-chain code at getAddress(owner) via getPublicClient(chainId).
    isDeployed: async (_owner: Address): Promise<boolean> => accountContractsNotDeployed(chainId),

    // TODO(W6/T015): initCode = accountFactory ++ createAccount(owner, salt) calldata.
    buildDeployCalldata: async (_owner: Address): Promise<Hex> => accountContractsNotDeployed(chainId),

    // TODO(T015): encode SparkPointAccount.execute(to, value, data) once its ABI is exported.
    encodeExecute: (_call: Call): Hex => accountContractsNotDeployed(chainId),
  };
}
