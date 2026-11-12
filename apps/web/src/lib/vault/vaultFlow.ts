/**
 * Shared deposit / withdraw layout copy (feature 073 — vault UI unification).
 *
 * The Morpho "Deposit USDG" amount screen is the reference layout: a back link, an H1
 * "Deposit <asset>" with an "Into <vault> · net APY …" subtitle, a risk pill, an amount card with
 * Max, a summary box, an estimates disclaimer, a full-width primary button and the "Next: …" line.
 *
 * Everything here is PURE display copy. Protocol containers keep their own hooks, data fetching,
 * review/sign flows and business logic; they only hand their real numbers into these builders so
 * Rhea, Kamino and Morpho can never drift into a second visual implementation.
 */

export type VaultFlowMode = "deposit" | "withdraw";

export type VaultFlowTone = "caution" | "gain" | "info";

export interface VaultFlowSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: VaultFlowTone;
}

/** The one closing line every protocol's amount screen ends with. */
export const VAULT_FLOW_NEXT_STEP = "Next: live quote + on-chain preview, then you sign.";

/** The honest no-history label for a list-card sparkline. */
export const VAULT_FLOW_COLLECTING = "collecting history";

export interface VaultFlowCopyInput {
  readonly mode: VaultFlowMode;
  readonly assetSymbol: string;
  readonly vaultName: string;
  /** Display-ready net APY (e.g. "4.82%"); omit rather than invent one. */
  readonly netApy?: string | null;
  /** Where the APY came from (e.g. "Morpho", "Kamino", "stored scan"). */
  readonly apySource?: string | null;
  /** Override the primary button copy (e.g. "Connect your wallet"). */
  readonly primaryLabel?: string | null;
}

export interface VaultFlowCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly amountLabel: string;
  readonly primaryLabel: string;
  readonly disclaimer: string;
  readonly nextStep: string;
}

export function vaultFlowTitle(mode: VaultFlowMode, assetSymbol: string): string {
  return `${mode === "deposit" ? "Deposit" : "Withdraw"} ${assetSymbol}`;
}

export function vaultFlowSubtitle(input: Pick<VaultFlowCopyInput, "mode" | "vaultName" | "netApy" | "apySource">): string {
  const netApy = input.netApy?.trim();
  if (netApy) {
    const source = input.apySource?.trim();
    return `Into ${input.vaultName} · net APY ${netApy}${source ? ` (${source})` : ""}`;
  }
  return `Into ${input.vaultName} · ${input.mode === "deposit" ? "supply" : "redeem"} directly with your wallet`;
}

export function vaultFlowDisclaimer(mode: VaultFlowMode): string {
  return mode === "deposit"
    ? "Estimates, not guarantees. Shares: your fixed slice of the vault; its value grows as the vault earns."
    : "No fees to exit. Nothing moves until you sign.";
}

export function vaultFlowPrimaryLabel(mode: VaultFlowMode): string {
  return mode === "deposit" ? "Review deposit" : "Review withdrawal";
}

export function vaultFlowCopy(input: VaultFlowCopyInput): VaultFlowCopy {
  return {
    title: vaultFlowTitle(input.mode, input.assetSymbol),
    subtitle: vaultFlowSubtitle(input),
    amountLabel: input.mode === "deposit" ? "Amount to deposit" : "Amount to withdraw",
    primaryLabel: input.primaryLabel?.trim() || vaultFlowPrimaryLabel(input.mode),
    disclaimer: vaultFlowDisclaimer(input.mode),
    nextStep: VAULT_FLOW_NEXT_STEP,
  };
}

export interface RheaFlowRowsInput {
  readonly mode: VaultFlowMode;
  /** "You'll supply / receive" value, already formatted and honest ("—" when unknown). */
  readonly receive: string;
  readonly netApy?: string | null;
  readonly account: string | null;
  /** True when a NEAR wallet can actually sign this flow (an EVM-only MCA cannot). */
  readonly canSign: boolean;
  readonly accountSource: "near" | "mca" | null;
}

/** Rhea rows: the MCA read is a balance/Max convenience; signing still needs a NEAR wallet. */
export function rheaFlowRows(input: RheaFlowRowsInput): VaultFlowSummaryRow[] {
  const signer = input.canSign
    ? "NEAR wallet (connected)"
    : "NEAR wallet required to sign";
  return [
    {
      key: "receive",
      label: input.mode === "deposit" ? "You'll supply ≈" : "You'll receive ≈",
      value: input.receive,
    },
    {
      key: "apy",
      label: "Net APY",
      value: input.netApy ?? "shown by Rhea",
    },
    {
      key: "account",
      label: "Rhea account",
      value: input.account ?? "Not connected",
    },
    {
      key: "source",
      label: "Balance & Max source",
      value:
        input.accountSource === "mca"
          ? "Rhea MCA (linked EVM wallet)"
          : input.accountSource === "near"
            ? "Connected NEAR wallet"
            : "—",
      tone: input.accountSource === "mca" ? "caution" : undefined,
    },
    {
      key: "signer",
      label: "Signing wallet",
      value: signer,
      tone: input.canSign ? "gain" : "caution",
    },
    { key: "network", label: "Network", value: "NEAR" },
  ];
}

export interface KaminoFlowRowsInput {
  readonly mode: VaultFlowMode;
  readonly receive: string;
  readonly netApy?: string | null;
  readonly minDeposit?: string | null;
  readonly minWithdraw?: string | null;
  readonly assetSymbol: string;
  readonly crankNote?: string | null;
}

/** Kamino rows keep the protocol's own minimum/crank facts in the shared summary style. */
export function kaminoFlowRows(input: KaminoFlowRowsInput): VaultFlowSummaryRow[] {
  const rows: VaultFlowSummaryRow[] = [
    {
      key: "receive",
      label: input.mode === "deposit" ? "You'll receive ≈" : "You'll receive ≈",
      value: input.receive,
    },
    { key: "apy", label: "Net APY", value: input.netApy ?? "shown by Kamino" },
    {
      key: input.mode === "deposit" ? "min" : "min",
      label: input.mode === "deposit" ? "Min deposit (vault)" : "Min withdraw (vault)",
      value:
        input.mode === "deposit"
          ? input.minDeposit ?? "—"
          : input.minWithdraw ?? "—",
    },
    { key: "network", label: "Network", value: "Solana" },
  ];
  if (input.mode === "deposit") {
    rows.push({
      key: "crank",
      label: "Crank-fee buffer",
      value: input.crankNote ?? "applied above the vault minimum",
      tone: "info",
    });
  }
  rows.push({ key: "asset", label: "Asset", value: input.assetSymbol });
  return rows;
}

export interface MorphoFlowRowsInput {
  readonly mode: VaultFlowMode;
  readonly receive: string;
  readonly netApy?: string | null;
  readonly maxDeposit?: string | null;
  readonly maxRedeem?: string | null;
  readonly assetSymbol: string;
}

/** Morpho rows: ERC-4626 previews + the vault's own limits, never a SparkPoint fee. */
export function morphoFlowRows(input: MorphoFlowRowsInput): VaultFlowSummaryRow[] {
  return [
    {
      key: "receive",
      label: "You'll receive ≈",
      value: input.receive,
    },
    { key: "apy", label: "Net APY", value: input.netApy ?? "set by the vault curator" },
    {
      key: "limits",
      label: input.mode === "deposit" ? "Vault max deposit (now)" : "Your max redeem",
      value:
        input.mode === "deposit"
          ? input.maxDeposit ?? "—"
          : input.maxRedeem ?? "—",
    },
    { key: "fee", label: "SparkPoint fee", value: "0% — none on a direct deposit", tone: "gain" },
    { key: "network", label: "Network", value: `Base · ${input.assetSymbol}` },
  ];
}

/** True when the shared layout contract is complete; used by the wiring tests. */
export function hasCompleteFlowCopy(copy: VaultFlowCopy): boolean {
  return Boolean(
    copy.title &&
      copy.subtitle &&
      copy.amountLabel &&
      copy.primaryLabel &&
      copy.disclaimer &&
      copy.nextStep,
  );
}
