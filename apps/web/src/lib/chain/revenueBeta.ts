/**
 * revenueBeta — pure, DOM-free helpers for the 4663 beta revenue surface (W.4).
 *
 * A LEAF like `brokers.ts` and `brokerEngine.ts`: `node --experimental-strip-types` cannot resolve
 * the extensionless internal imports inside the `@sparkpoint/shared` barrels, so a test that
 * value-imports this module would make the whole suite unloadable. Addresses stay in the caller.
 *
 * The routes and disclosures here are COPY — the kind that has to be exactly true or it is worse
 * than absent. The live numbers (the pot, each broker's balance) are read from the chain by the
 * hooks; nothing in this file estimates, annualises or projects, and a test pins the disclosure
 * non-empty so it cannot be quietly deleted.
 */

/** Which deployment address a route step points at. */
export type RouteAddressKey = "curve" | "feeEscrow" | "splitter" | "engine" | "vault" | "sink";

export interface RouteStep {
  /** 1-based, because the route is read top-to-bottom. */
  readonly n: number;
  readonly title: string;
  readonly detail: string;
  readonly address: RouteAddressKey;
}

/**
 * The real fee route on 4663, as deployed 2026-09-16. Every step names the function that performs
 * it so a holder can check the claim on-chain rather than take the page's word.
 *
 * ⚠️ There is no swap and no conversion anywhere in it: fees arrive as ETH (Pons creator fees and
 * ETH-in swap fees) and as registered ERC-20s (USDG-in swap fees) and are delivered in the SAME
 * asset. Writing a "converted to USDC" step here would describe a system that does not exist.
 */
export const REVENUE_ROUTE: readonly RouteStep[] = [
  {
    n: 1,
    title: "Trading fees accrue",
    detail:
      "A 1% creator fee on every Pons trade is owed to the RevenueSplitter contract — the fee recipient is the contract itself, not a wallet, so nobody can divert it.",
    address: "curve",
  },
  {
    n: 2,
    title: "Anyone sweeps",
    detail:
      "Anyone may call sweepCurve() on the splitter (or claim() the escrow) to pull the accrued fees in. The runners do it every 5 minutes; a holder can do it too.",
    address: "feeEscrow",
  },
  {
    n: 3,
    title: "Split 90 / 10",
    detail:
      "The splitter sends 90% to the BrokerEngine and 10% to the SparkPoint treasury — both immutable addresses, both constants on the contract. 100% stays on-chain.",
    address: "splitter",
  },
  {
    n: 4,
    title: "The engine books it",
    detail:
      "The engine holds each fee asset — ETH and any registered ERC-20 — as pendingPot until settle() closes a round, then credits it to the brokers that were clocked in, in proportion to their recorded weight.",
    address: "engine",
  },
  {
    n: 5,
    title: "Delivered to the vault",
    detail:
      "deliver() moves each broker's credit into the BrokerVault, keyed by token id — so what a broker earned rides the broker if it is sold.",
    address: "vault",
  },
  {
    n: 6,
    title: "You withdraw",
    detail:
      "The vault pays the broker's current owner on withdraw(). Only the owner can move a token's balance; the vault has no owner, no fee and no rescue path.",
    address: "vault",
  },
];

/**
 * The one-sentence version of the model, for the top of the page.
 *
 * ⚠️ "AS-IS" is the whole architecture: fees are delivered in the asset they arrived in — ETH, and
 * any registered ERC-20 (today USDG from USDG-in swaps). A page that omitted this would leave a
 * holder to assume a swap into a stablecoin that does not happen.
 */
export const AS_IS_DISCLOSURE =
  "Revenue is delivered exactly as it arrives — ETH in, ETH out, and an ERC-20 fee (today USDG " +
  "from USDG-in swaps) in that same token. There is no swap, no conversion and no payout asset, " +
  "and nothing is projected: this page only shows what the contracts hold and what your brokers " +
  "can withdraw right now.";

/** What the vault cannot do, stated because a holder cannot verify the absence by looking. */
export const VAULT_CUSTODY_NOTE =
  "The BrokerVault has no owner, no upgrade path, no fee parameter and no rescue function. The " +
  "only way value leaves it is the current owner of a broker withdrawing that broker's balance.";

/** What the engine can still do, stated for the same reason. */
export const ENGINE_UPGRADE_NOTE =
  "The BrokerEngine is a UUPS proxy: its owner can upgrade the implementation, and today that owner " +
  "is the Sparky deployer. The vault holding the money is immutable and not upgradeable.";

/** One asset amount held by one broker. */
export interface HoldingRow {
  readonly tokenId: bigint;
  /** The asset the fee arrived in; the zero address is native ETH. */
  readonly asset: string;
  readonly amount: bigint;
}

/**
 * Drop the zero rows.
 *
 * ⚠️ The vault remembers an asset a broker once held (its bitmap never clears), so `assetsOf`
 * keeps naming assets whose balance is now 0. Rendering those as "0 ETH" rows would read as an
 * empty position that is somehow still listed; they are simply not part of the answer.
 */
export function nonzeroHoldings<T extends HoldingRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.amount > 0n);
}

/** The holding rows, grouped by broker, in the input order. */
export function holdingsByBroker<T extends HoldingRow>(rows: readonly T[]): Map<bigint, T[]> {
  const out = new Map<bigint, T[]>();
  for (const row of rows) {
    const list = out.get(row.tokenId);
    if (list === undefined) out.set(row.tokenId, [row]);
    else list.push(row);
  }
  return out;
}

/** Does the zero address mean native ETH here? Yes — that is the engine's and vault's convention. */
export const NATIVE_ASSET = "0x0000000000000000000000000000000000000000";

/** An ERC-20's own units, read from the token — the page never guesses a symbol or a shift. */
export interface AssetMeta {
  readonly symbol: string;
  readonly decimals: number;
}

/** `0x5fc5…d168` — for the honest fallback when a token's metadata could not be read. */
export function shortAsset(asset: string): string {
  return `${asset.slice(0, 6)}…${asset.slice(-4)}`;
}

/**
 * Exact base units as a decimal string, trailing zeros trimmed (never a float, never a round).
 * `exactUnits(810n, 6)` → `"0.00081"`.
 */
function exactUnits(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

/**
 * One asset amount in the units a holder reads.
 *
 * ⚠️ Multi-token is the architecture (spec 047): the engine delivers each fee in the asset it
 * arrived in. The zero address is native ETH; a registered ERC-20 renders with the metadata read
 * from the token itself; an asset whose metadata could not be read falls back to base units plus
 * the address — never a decimal-shifted number that looks like a real quantity.
 */
export function formatAssetAmount(asset: string, amount: bigint, meta?: AssetMeta): string {
  if (asset.toLowerCase() === NATIVE_ASSET) return `${exactUnits(amount, 18)} ETH`;
  if (meta !== undefined) return `${exactUnits(amount, meta.decimals)} ${meta.symbol}`;
  return `${amount.toLocaleString("en-US")} units of ${shortAsset(asset)}`;
}
