/**
 * 077 — Morpho on Base live slice, pure plan builders.
 *
 * A Morpho V1 vault (MetaMorpho) is a standard ERC-4626. Same-chain live access needs no quote,
 * no intent and no receipt:
 *
 *   deposit → approve(asset, vault, assets) when allowance is short, then deposit(assets, account)
 *   withdraw → redeem(shares, account, account)
 *
 * This module only decides *what* the user's wallet will sign. The signing is the existing
 * user-signed `useExecuteVaultTx` (wagmi `writeContractAsync`); the agent never signs or submits.
 */

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface MorphoVaultMeta {
  readonly address: `0x${string}`;
  readonly name: string;
  readonly symbol: string;
  readonly chainId: number;
  readonly asset: `0x${string}`;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly shareDecimals: number;
  readonly appUrl: string;
}

/** Curated Base vaults the live flow may target. Kept small on purpose. */
export const MORPHO_VAULTS: readonly MorphoVaultMeta[] = [
  {
    address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    name: "Gauntlet USDC Prime",
    symbol: "gtUSDCp",
    chainId: BASE_CHAIN_ID,
    asset: BASE_USDC_ADDRESS,
    assetSymbol: "USDC",
    assetDecimals: 6,
    shareDecimals: 18,
    appUrl: "https://app.morpho.org/base/vault/0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  },
];

export function findMorphoVault(address: string | null | undefined): MorphoVaultMeta | null {
  if (!address) return null;
  const target = address.toLowerCase();
  return MORPHO_VAULTS.find((v) => v.address.toLowerCase() === target) ?? null;
}

export type MorphoLiveErrorCode = "unknown_vault" | "invalid_account" | "invalid_amount";

export class MorphoLiveError extends Error {
  readonly code: MorphoLiveErrorCode;
  constructor(code: MorphoLiveErrorCode, message: string) {
    super(message);
    this.name = "MorphoLiveError";
    this.code = code;
  }
}

/** Parse a positive decimal into raw units without floats. `null` when invalid/zero. */
export function parseMorphoAmount(input: string, decimals: number): bigint | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > decimals) return null;
  const wholeRaw = whole === "" ? 0n : BigInt(whole);
  const fractionRaw = fraction === "" ? 0n : BigInt(fraction.padEnd(decimals, "0"));
  const raw = wholeRaw * 10n ** BigInt(decimals) + fractionRaw;
  return raw > 0n ? raw : null;
}

export interface MorphoDepositPlan {
  readonly kind: "deposit";
  readonly chainId: number;
  readonly vault: `0x${string}`;
  readonly token: `0x${string}`;
  readonly account: `0x${string}`;
  readonly assets: bigint;
  readonly needsApprove: boolean;
}

export interface MorphoWithdrawPlan {
  readonly kind: "withdraw";
  readonly chainId: number;
  readonly vault: `0x${string}`;
  readonly account: `0x${string}`;
  readonly shares: bigint;
}

export type MorphoPlan = MorphoDepositPlan | MorphoWithdrawPlan;

function requireVault(address: string | null | undefined): MorphoVaultMeta {
  const vault = findMorphoVault(address);
  if (!vault) throw new MorphoLiveError("unknown_vault", "That vault is not enabled for live deposits.");
  return vault;
}

function requireAccount(account: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account.trim())) {
    throw new MorphoLiveError("invalid_account", "Connect an EVM wallet on Base.");
  }
  return account.trim() as `0x${string}`;
}

/** `deposit` needs an approve leg only when the live allowance is short of the amount. */
export function buildMorphoDepositPlan(input: {
  vault: string;
  account: string;
  amount: string;
  allowance: bigint | null | undefined;
}): MorphoDepositPlan {
  const vault = requireVault(input.vault);
  const account = requireAccount(input.account);
  const assets = parseMorphoAmount(input.amount, vault.assetDecimals);
  if (assets === null) {
    throw new MorphoLiveError("invalid_amount", `Enter a ${vault.assetSymbol} amount with at most ${vault.assetDecimals} decimals.`);
  }
  return {
    kind: "deposit",
    chainId: vault.chainId,
    vault: vault.address,
    token: vault.asset,
    account,
    assets,
    needsApprove: input.allowance === null || input.allowance === undefined || input.allowance < assets,
  };
}

/** `redeem` takes SHARES at the vault's own share decimals (18 here), not the asset's 6. */
export function buildMorphoWithdrawPlan(input: {
  vault: string;
  account: string;
  amount: string;
}): MorphoWithdrawPlan {
  const vault = requireVault(input.vault);
  const account = requireAccount(input.account);
  const shares = parseMorphoAmount(input.amount, vault.shareDecimals);
  if (shares === null) {
    throw new MorphoLiveError("invalid_amount", `Enter a share amount with at most ${vault.shareDecimals} decimals.`);
  }
  return {
    kind: "withdraw",
    chainId: vault.chainId,
    vault: vault.address,
    account,
    shares,
  };
}

/** Fee copy in bps: `0%` / `0.05%` / `5%`, never a rounded-to-zero lie for a tiny fee. */
export function feeBpsLabel(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "0%";
  const percent = bps / 100;
  return `${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
