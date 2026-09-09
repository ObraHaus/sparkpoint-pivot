/**
 * T025 — account adapter barrel: the ACTIVE adapter + the seam interface.
 *
 * The single import point later waves use for the ERC-4337 account. Swapping the
 * implementation (e.g. to a ZeroDev/Kernel fallback) is a ONE-LINE change HERE —
 * repoint `createAccountAdapter` — with no UI/agent-client change, which is the
 * whole point of the thin {@link SparkPointAccountAdapter} seam.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T025; plan.md Complexity
 * Tracking (AA-SDK swap isolated to one module).
 */

export type { Call, SparkPointAccountAdapter } from "./types";
export type { CustomAccountConfig } from "./customAccount";

import { createSparkPointAccount } from "./customAccount";

/**
 * The active account-adapter constructor per Gate-A: the SparkPoint custom
 * ERC-4337 account (NO ZeroDev). Call with a `chainId` to obtain the adapter for
 * that chain. Consumers import ONLY this binding, so swapping the implementation
 * (e.g. a ZeroDev/Kernel fallback) is a one-line repoint HERE — one module, not
 * the UI.
 */
export const createAccountAdapter = createSparkPointAccount;
