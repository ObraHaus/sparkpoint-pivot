/**
 * T025 — the AA-SDK-swappable account adapter INTERFACE (seam contract).
 *
 * A deliberately THIN, framework-neutral surface so the concrete ERC-4337
 * account implementation swaps as ONE module (customAccount.ts, or a future
 * ZeroDev/Kernel fallback) without the UI, the agent client, or the execution
 * drawer changing. Signatures only — NO key handling, NO signing. The frontend
 * holds no private key and never derives one (non-custody is law); signing lives
 * in the user's wallet, and the chain is truth.
 *
 * Identity model (agent-service-api.md §1.2): the account is anchored by its
 * owner EOA (`X-Owner`); the smart-account address (`X-Account`) is CREATE2-
 * counterfactual and derivable from the owner, so the interface keys every method
 * by `owner`.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T025; plan.md Complexity
 * Tracking (AA-SDK swap isolated to one module); smart-contracts.md §1
 * (SparkPointAccount / AccountFactory).
 */

import type { Address } from "@sparkpoint/shared/addresses";
import type { Hex } from "viem";

/**
 * A single account execution — the shape encoded into `SparkPointAccount.execute`.
 * `value` is native-wei; `data` is the target calldata (`0x` for a plain transfer).
 */
export interface Call {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

/**
 * The swappable ERC-4337 account seam. An implementation is bound to a single
 * chain (see `createSparkPointAccount`); all methods are pure/read-only with
 * respect to keys.
 */
export interface SparkPointAccountAdapter {
  /**
   * The CREATE2-counterfactual `SparkPointAccount` address for `owner`.
   * Computable BEFORE deploy (the account may not yet exist on-chain).
   */
  getAddress(owner: Address): Promise<Address>;

  /** True once the account for `owner` has on-chain code (read via a PublicClient). */
  isDeployed(owner: Address): Promise<boolean>;

  /**
   * The factory calldata (initCode/factoryData) that deploys the account for
   * `owner`. Consumed as the UserOp `initCode` on the first operation.
   */
  buildDeployCalldata(owner: Address): Promise<Hex>;

  /** Encode a single {@link Call} into the account's `execute(...)` calldata. */
  encodeExecute(call: Call): Hex;
}
