/**
 * Pure vault-picker model (011 multi-vault) — JSX-free + agent-free so it unit-tests under
 * `node --test` (mirrors `vaultConfirmModel.ts`'s testable split). It turns the static address-book
 * SoT (the launch Aave vault + the curated `sparkPointWrappers` display list) into the ordered
 * options the picker renders, resolves the URL-selected option (default = launch — byte-identical to
 * the no-picker behavior), and maps a HELD wrapper into a portfolio-row input.
 *
 * NON-CUSTODY: this only produces `{ vaultAddress, kind, label }` display tuples + a portfolio input.
 * It adds NO gate — the deposit provenance/asset fail-closes live in `vaultConfirmModel`, and withdraw
 * is never gated (N2). All cross-package imports are `type`-only so the strip-types test runner never
 * resolves `@sparkpoint/*` or the wagmi-bearing `useVault` module at runtime.
 */
import type { Address } from "viem";
import type { SparkPointWrapper } from "@sparkpoint/shared/addresses";
import type { WrapperPositionInput } from "../portfolio/derive";
import type { VaultKind } from "./useVault";

/** One selectable vault in the picker. `vaultAddress` undefined ⇒ the launch Aave vault (the default). */
export interface VaultOption {
  readonly vaultAddress?: Address;
  readonly kind: VaultKind;
  readonly label: string;
  readonly symbol?: string;
  /** For a wrapper: its immutable underlying Morpho target (informational; app reads `morphoVault()` live). */
  readonly morphoVault?: Address;
  /**
   * RETIRED (024): still selectable and still fully withdrawable (N2) — but DEPOSIT is fail-closed
   * downstream in `deriveVaultConfirm`. Kept in the options list on purpose: dropping it would make
   * `resolveSelectedVault` silently fall back to the launch vault for a holder deep-linking with
   * `?vault=<retired>`, which is a worse failure than showing it plainly as retired.
   */
  readonly retired?: boolean;
  readonly retiredReason?: string;
  /**
   * 051 — curated provenance for a `universal_wrapper` option: true only when the address came from
   * the agent's curated board (`wrapped` + `wrapperAddress`). Deposit fail-closes without it.
   */
  readonly verified?: boolean;
}

/** The launch Aave vault option — matches `useVault`'s defaults exactly, so selecting it is byte-identical. */
export const LAUNCH_VAULT_OPTION: VaultOption = {
  vaultAddress: undefined,
  kind: "aave_launch",
  label: "Aave Yield Vault",
  symbol: "spvUSDC",
};

/**
 * The ordered picker options: the launch Aave vault ALWAYS first (index 0 = the default), then one
 * option per curated wrapper. With no wrappers this is `[launch]`, so the app renders exactly as before.
 *
 * The launch option intentionally carries `vaultAddress: undefined` — `useVault` resolves the chain's
 * real launch vault from the SoT, so no launch address needs threading in here.
 */
/**
 * 051 — a dynamically-deployed V3 wrapper from the curated board. Unlike `sparkPointWrappers`
 * (a static book), these are discovered at runtime: the agent's `wrapped` + `wrapperAddress` record
 * IS the provenance, so `buildVaultOptions` marks them `verified` and the deposit path trusts them.
 */
export interface UniversalWrapperInput {
  readonly address: Address;
  readonly label: string;
  readonly symbol?: string;
}

export function buildVaultOptions(input: {
  wrappers?: readonly SparkPointWrapper[];
  universalWrappers?: readonly UniversalWrapperInput[];
}): VaultOption[] {
  const wrapperOptions: VaultOption[] = (input.wrappers ?? []).map((w) => ({
    vaultAddress: w.address,
    kind: "morpho_wrapper" as const,
    label: w.label,
    symbol: w.symbol,
    morphoVault: w.morphoVault,
    retired: w.retired,
    retiredReason: w.retiredReason,
  }));
  const universalOptions: VaultOption[] = (input.universalWrappers ?? []).map((w) => ({
    vaultAddress: w.address,
    kind: "universal_wrapper" as const,
    label: w.label,
    symbol: w.symbol,
    verified: true,
  }));
  return [LAUNCH_VAULT_OPTION, ...wrapperOptions, ...universalOptions];
}

/**
 * Resolve the selected option from a URL `?vault=` value. Case-insensitive address match; an absent,
 * `"launch"`, or unknown value resolves to the launch vault — so the DEFAULT is always the conservative
 * launch vault (never a wrapper), keeping the no-selection path byte-identical.
 */
export function resolveSelectedVault(
  options: readonly VaultOption[],
  selected: string | null | undefined,
): VaultOption {
  const launch = options.find((o) => o.vaultAddress === undefined) ?? LAUNCH_VAULT_OPTION;
  if (!selected || selected.toLowerCase() === "launch") return launch;
  const target = selected.toLowerCase();
  return (
    options.find(
      (o) => o.vaultAddress !== undefined && o.vaultAddress.toLowerCase() === target,
    ) ?? launch
  );
}

/**
 * Map a curated wrapper + its LIVE `useVault` reads into a portfolio-row input — or `null` when the
 * user holds NO shares (so launch-only users get zero wrapper rows and `derivePortfolio` stays
 * byte-identical). `assetIsUsdc === false` still returns a row (shown in its own unit and excluded
 * from the USD total by `derive.ts` — no oracle invented).
 */
export function toWrapperPositionInput(
  wrapper: SparkPointWrapper,
  read: {
    underlying?: bigint;
    shares?: bigint;
    decimals?: number;
    assetIsUsdc?: boolean;
  },
): WrapperPositionInput | null {
  if (read.shares === undefined || read.shares === 0n) return null;
  return {
    vaultAddress: wrapper.address,
    label: wrapper.label,
    underlying: read.underlying,
    shares: read.shares,
    decimals: read.decimals,
    usdPriced: read.assetIsUsdc ?? true,
  };
}
