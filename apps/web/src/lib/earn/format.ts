/**
 * 069/070 — display-only formatting for the earn cards.
 *
 * The agent already serializes money and APY as display strings (never floats the UI can feed back
 * into a quote). A `null` TVL/APY is a real "unknown" from the snapshot, so it renders as an em
 * dash — the card never invents a number to fill the gap. 070 adds the protocol and receipt-kind
 * labels; a missing protocol/receiptKind is the 069 Morpho default, never an invented value.
 */

import type {
  EarnOneTimeFee,
  EarnProtocol,
  EarnQuoteBlock,
  EarnReceiptKind,
  EarnSource,
  EarnVault,
} from "@sparkpoint/shared/schemas";

const DASH = "—";

/** The protocol a row belongs to. A missing wire field is the 069 Morpho default. */
export function protocolOf(vault: Pick<EarnVault, "protocol">): EarnProtocol {
  return vault.protocol ?? "morpho";
}

/** `Morpho` / `Kamino` / `Rhea` — the row badge and list title. */
export function protocolLabel(protocol: EarnProtocol): string {
  if (protocol === "kamino") return "Kamino";
  if (protocol === "rhea") return "Rhea";
  return "Morpho";
}

/** 071 — Rhea's lending app, the one verified withdraw/link-out target. */
export const RHEA_APP_URL = "https://app.rhea.finance/lending";

/** The row title. Rhea rows name the lending market and chain explicitly (071). */
export function vaultRowTitle(vault: Pick<EarnVault, "name" | "symbol" | "protocol">): string {
  if (protocolOf(vault) === "rhea") return "Rhea Lending (NEAR) supply";
  return vault.name || vault.symbol;
}

/** The protocols present in a list, in wire order. */
export function protocolsOf(vaults: readonly Pick<EarnVault, "protocol">[]): EarnProtocol[] {
  const seen: EarnProtocol[] = [];
  for (const vault of vaults) {
    const protocol = protocolOf(vault);
    if (!seen.includes(protocol)) seen.push(protocol);
  }
  return seen;
}

/**
 * The list card title: a single-protocol answer names it, a mixed list is the neutral "Earn
 * vaults", and an empty/failed snapshot never claims a protocol it cannot prove.
 */
export function vaultListTitle(vaults: readonly Pick<EarnVault, "protocol">[]): string {
  const protocols = protocolsOf(vaults);
  if (protocols.length === 1) return `${protocolLabel(protocols[0]!)} vaults`;
  return "Earn vaults";
}

/** `4.45% net APY` label for the row's APY stat. */
export function apyLabel(protocol: EarnProtocol): string {
  return `net APY (${protocolLabel(protocol)})`;
}

/**
 * How the 1Click receipt relates to the vault share. `undefined` means the vault has no configured
 * 1Click delivery, so there is nothing honest to label; a wrapper is the 069 Morpho default.
 */
export function receiptKindOf(vault: Pick<EarnVault, "rails">): EarnReceiptKind | null {
  const receipt = vault.rails.oneclickEarn?.receipt;
  if (!receipt) return null;
  return receipt.receiptKind ?? "wrapper";
}

/** `native vault shares` for Kamino's kV share mint, `1Click receipt (wrapper)` for Morpho. */
export function receiptLabel(kind: EarnReceiptKind): string {
  return kind === "native_shares" ? "native vault shares" : "1Click receipt (wrapper)";
}

/** The row's receipt label, or `null` when no 1Click receipt is configured. */
export function vaultReceiptLabel(vault: Pick<EarnVault, "rails">): string | null {
  const kind = receiptKindOf(vault);
  return kind === null ? null : receiptLabel(kind);
}

/** True when the preview delivers the native vault share (Kamino), not a NEAR wrapper. */
export function isNativeShares(
  block: Pick<EarnQuoteBlock, "receiptKind" | "rail" | "vault">,
): boolean {
  if (block.receiptKind) return block.receiptKind === "native_shares";
  return receiptKindOf(block.vault) === "native_shares";
}

/** True when this preview needs a pasted Solana recipient and has no EVM default. */
export function needsSolanaRecipient(
  block: Pick<EarnQuoteBlock, "walletSupport">,
): boolean {
  return block.walletSupport?.recipient === "paste_solana_address";
}

/** Chain slugs for Morpho's app (`eth` is `ethereum` there). */
export function morphoChainSlug(chain: string): string {
  return chain === "eth" ? "ethereum" : chain;
}

/** Human chain label used by the preview prompt and the row badge. */
export function chainLabel(chain: string): string {
  switch (chain) {
    case "eth":
      return "Ethereum";
    case "base":
      return "Base";
    case "arbitrum":
      return "Arbitrum";
    case "optimism":
      return "Optimism";
    case "polygon":
      return "Polygon";
    case "unichain":
      return "Unichain";
    case "world":
      return "World Chain";
    case "hyperevm":
      return "HyperEVM";
    case "katana":
      return "Katana";
    case "monad":
      return "Monad";
    case "robinhood":
      return "Robinhood Chain";
    case "sol":
      return "Solana";
    case "near":
      return "NEAR";
    default:
      return chain.charAt(0).toUpperCase() + chain.slice(1);
  }
}

/** `$420.7M` / `$115M` / `$12.3K` from a decimal string; `—` when absent or unparseable. */
export function formatTvl(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DASH;
  if (n >= 1_000_000_000) return `$${trim(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `$${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${trim(n / 1_000)}K`;
  return `$${trim(n)}`;
}

function trim(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

/**
 * `4.41%` from the API's display-percent string. Truncates (never rounds up) beyond two decimals
 * so a displayed APY can never be higher than the snapshot's figure. `—` when absent.
 */
export function formatNetApy(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  const truncated = Math.trunc(n * 100) / 100;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(truncated)}%`;
}

/**
 * The snapshot freshness line. A shipped fallback is called a cached snapshot; a fresh snapshot is
 * attributed to Morpho's API with its age in minutes.
 */
export function snapshotAgeCopy(
  ageMinutes: number | null | undefined,
  source: string | null | undefined,
  protocol?: EarnProtocol | null,
): string {
  if (ageMinutes === null || ageMinutes === undefined || !Number.isFinite(ageMinutes)) {
    return "cached snapshot";
  }
  const age = Math.max(0, Math.floor(ageMinutes));
  if (source === "shipped") {
    return `cached snapshot, ${age} min old`;
  }
  // Omitted keeps the 069 wording; `null` is a genuinely mixed list.
  const api =
    protocol === undefined || protocol === "morpho"
      ? "Morpho"
      : protocol === "kamino"
        ? "Kamino"
        : protocol === "rhea"
          ? "Rhea"
          : "vault";
  return `data from ${api} API, ${age} min ago`;
}

export interface RailChip {
  key: "direct" | "oneclick_earn" | "oneclick_rhea" | "intents_connect";
  label: string;
  available: boolean;
}

/**
 * The three rails, always named so a missing one is visible rather than omitted. A 1Click receipt
 * is only "live" when the last dry quote proved it; an unprobed receipt says so, and a no-liquidity
 * receipt says that instead. Intents Connect without an Aurora key is "needs key", never "live".
 */
export function railChips(vault: EarnVault): RailChip[] {
  const { direct, oneclickEarn, oneclickRhea, intentsConnect } = vault.rails;

  // 071 — Rhea has its own rail and no Morpho/Kamino 1Click receipt. Keep all three named so a
  // missing one is visible rather than silently omitted.
  if (oneclickRhea) {
    let rheaLabel = "1Click Rhea";
    if (!oneclickRhea.available) {
      rheaLabel =
        oneclickRhea.liveness === "no_liquidity"
          ? "1Click Rhea no liquidity"
          : "1Click Rhea unavailable";
    } else if (oneclickRhea.liveness === "live") {
      rheaLabel = "1Click Rhea live";
    }
    return [
      { key: "direct", label: "Direct", available: direct.available },
      { key: "oneclick_rhea", label: rheaLabel, available: oneclickRhea.available },
      {
        key: "intents_connect",
        label: intentsConnect.available ? "Intents Connect" : "Intents Connect n/a",
        available: intentsConnect.available,
      },
    ];
  }

  let oneclickLabel = "1Click Earn";
  if (!oneclickEarn?.available) {
    oneclickLabel =
      oneclickEarn?.liveness === "no_liquidity"
        ? "1Click Earn no liquidity"
        : "1Click Earn unavailable";
  } else if (oneclickEarn.liveness === "live") {
    oneclickLabel = "1Click Earn live";
  }

  // An unavailable Intents Connect rail is always the same honest answer: it needs the Aurora
  // key/config that this deployment does not have. A live rail says so plainly.
  const intentsLabel = intentsConnect.available ? "Intents Connect" : "Intents Connect needs key";

  return [
    { key: "direct", label: "Direct", available: direct.available },
    { key: "oneclick_earn", label: oneclickLabel, available: oneclickEarn?.available ?? false },
    { key: "intents_connect", label: intentsLabel, available: intentsConnect.available },
  ];
}

/**
 * `Deposit 100 USDC into Morpho Gauntlet USDC Prime on Base` — the row's Preview follow-up.
 * 070 names the row's own protocol and chain; the Morpho wording is unchanged.
 */
export function previewPrompt(vault: EarnVault): string {
  if (protocolOf(vault) === "rhea") {
    return `Deposit 100 ${vault.asset.symbol} into Rhea on ${chainLabel(vault.chain)}`;
  }
  return `Deposit 100 ${vault.asset.symbol} into ${protocolLabel(protocolOf(vault))} ${vault.name || vault.symbol} on ${chainLabel(vault.chain)}`;
}

/** The external (non-transactional) Morpho app link for this vault. */
export function morphoVaultUrl(vault: Pick<EarnVault, "chain" | "address">): string {
  return `https://app.morpho.org/${morphoChainSlug(vault.chain)}/vault/${vault.address}`;
}

/**
 * The external app link for a row, or `null` when this build has no verified link for the protocol.
 * Kamino rows deliberately get no link rather than a guessed URL; Rhea links to its lending app.
 */
export function vaultAppUrl(vault: Pick<EarnVault, "chain" | "address" | "protocol">): string | null {
  const protocol = protocolOf(vault);
  if (protocol === "morpho") return morphoVaultUrl(vault);
  if (protocol === "rhea") return RHEA_APP_URL;
  return null;
}

/**
 * 071 — the exact APY provenance line: `Rhea contract.main.burrow.near get_asset.supply_apr,
 * fetched <time>`. The contract/method/field are the agent's wire values, never a UI guess.
 */
export function sourceAttribution(source: EarnSource, label = "Rhea"): string {
  return `${label} ${source.contract} ${source.method}.${source.field}, fetched ${source.fetchedAt}`;
}

/** `One-time Rhea account setup fee: 0.30 USDC (first deposit only)`; `null` when no fee. */
export function oneTimeFeeLine(fee: EarnOneTimeFee | null | undefined): string | null {
  if (!fee) return null;
  return `One-time Rhea account setup fee: ${fee.amount} ${fee.symbol} (first deposit only)`;
}

/** `Net supplied ≈ 99.6808 USDC`; `null` when the backend has no net figure. */
export function netSuppliedLine(
  netSupplied: string | null | undefined,
  symbol: string,
): string | null {
  if (netSupplied === null || netSupplied === undefined || netSupplied.trim() === "") return null;
  return `Net supplied ≈ ${netSupplied} ${symbol}`;
}

/** `Supply APY 14.05% (Rhea, variable)`; `null` when the contract read failed. */
export function rheaApyLine(supplyApy: string | null | undefined): string | null {
  if (!supplyApy) return null;
  return `Supply APY ${supplyApy} (Rhea, variable)`;
}
