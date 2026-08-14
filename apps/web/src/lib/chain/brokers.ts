/**
 * brokers — pure, DOM-free helpers for the Sparky Broker screens (feature 043).
 *
 * A LEAF module by necessity, not by style: `node --experimental-strip-types` cannot resolve the
 * extensionless internal imports inside the `@sparkpoint/shared` barrels, so anything this file
 * value-imports would make the whole suite unloadable. Chain ids, addresses and ABIs are therefore
 * passed IN from the component, and nothing here reaches the network.
 *
 * Everything below mirrors an on-chain read. Where a value has not been read yet it stays
 * `undefined` rather than defaulting to a number the UI would present as fact — the same discipline
 * as `srkFaucet.ts`, and for the same reason: a fabricated "0 minted" is indistinguishable from a
 * real one.
 */

/** The collection's immutable supply cap. Read from the contract; this is the display fallback. */
export const COLLECTION_SIZE = 10_000;

/** `activatedAt` is a uint64 BLOCK NUMBER; 0 means never activated, or cleared by a transfer. */
export type ActivatedAtBlock = bigint;

export interface BrokerToken {
  readonly id: number;
  /** The block the activation happened in; `0n` when unactivated. */
  readonly activatedAt: ActivatedAtBlock;
}

export interface BrokerView {
  readonly id: number;
  readonly activated: boolean;
  /** `-a` is the gold-framed variant. The image is served by the collection's own deploy. */
  readonly imagePath: string;
  readonly label: string;
  /** Copy for the state chip. Never the word "burned" — see `retiredWord`. */
  readonly statusLabel: string;
}

/**
 * One broker, as the gallery shows it.
 *
 * @param origin the metadata service's origin (its OWN deploy — never this app; `apps/web`'s
 *   middleware fail-closes and would 307 an image request to a holding page).
 */
export function brokerView(token: BrokerToken, origin: string): BrokerView {
  const activated = token.activatedAt > 0n;
  const base = origin.replace(/\/+$/, "");
  return {
    id: token.id,
    activated,
    // The gold frame IS the entitlement, drawn. The two variants are pre-rendered by the generator.
    imagePath: `${base}/i/${token.id}${activated ? "-a" : ""}.png`,
    label: `#${String(token.id).padStart(4, "0")}`,
    statusLabel: activated ? "Active" : "Idle",
  };
}

export function brokerViews(tokens: readonly BrokerToken[], origin: string): BrokerView[] {
  return tokens.map((t) => brokerView(t, origin));
}

/**
 * ⚠️ The word. SRK is moved to an address nobody controls; the token has no `burn` and the total
 * supply is unchanged (there is a contract fuzz test asserting exactly that). So "retired" is the
 * only accurate verb, and "burned" would be a supply claim that is not true.
 *
 * Exported as a constant rather than typed at each call site so a copy pass can grep for it, and so
 * a test can assert no surface says "burn".
 */
export const RETIRED_VERB = "retired" as const;

export interface MintState {
  /** The sale address; falsy ⇒ no sale on this chain and the screen says so. */
  readonly sale?: string;
  /** `saleOpen()`; `undefined` = not read yet. */
  readonly open?: boolean;
  /** `mintedBy(wallet)`; `undefined` = not read yet. */
  readonly mintedByWallet?: bigint;
  /** `perWalletCap()`; `undefined` = not read yet. */
  readonly perWalletCap?: bigint;
  /** `totalMinted()` on the NFT; `undefined` = not read yet. */
  readonly totalMinted?: bigint;
  /** `MAX_SUPPLY()` on the NFT; `undefined` = not read yet. */
  readonly maxSupply?: bigint;
  /** Wallet connected AND on the broker's chain. */
  readonly walletReady?: boolean;
}

export interface MintVerdict {
  readonly configured: boolean;
  readonly loaded: boolean;
  readonly canMint: boolean;
  /** How many more this wallet may mint; 0 when capped or unknown. */
  readonly remaining: number;
  readonly mintedSoFar?: number;
  readonly supply?: number;
  /** Why the button is disabled — `undefined` when it is enabled. */
  readonly blockedReason?: string;
}

export function deriveMintState(i: MintState): MintVerdict {
  const configured = Boolean(i.sale);
  const loaded =
    configured &&
    i.open !== undefined &&
    i.mintedByWallet !== undefined &&
    i.perWalletCap !== undefined;

  const minted = i.mintedByWallet ?? 0n;
  const cap = i.perWalletCap ?? 0n;
  const remaining = loaded && cap > minted ? Number(cap - minted) : 0;
  const soldOut =
    i.totalMinted !== undefined && i.maxSupply !== undefined && i.totalMinted >= i.maxSupply;

  let blockedReason: string | undefined;
  if (!configured) blockedReason = "Sparky Broker isn’t available on this network.";
  else if (!loaded) blockedReason = "Reading the sale…";
  else if (i.open === false) blockedReason = "Minting is closed right now.";
  else if (soldOut) blockedReason = "Every broker has been minted.";
  else if (remaining === 0) blockedReason = "You’ve minted all the brokers this wallet can.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on this network to mint.";

  return {
    configured,
    loaded,
    canMint: blockedReason === undefined,
    remaining,
    mintedSoFar: i.totalMinted === undefined ? undefined : Number(i.totalMinted),
    supply: i.maxSupply === undefined ? undefined : Number(i.maxSupply),
    blockedReason,
  };
}

export interface ActivateState {
  readonly registry?: string;
  /** `price()` in base units; `undefined` = not read yet. Read LIVE at signing, never hardcoded. */
  readonly price?: bigint;
  /** The wallet's SRK balance; `undefined` = not read yet. */
  readonly balance?: bigint;
  /** `allowance(wallet, registry)`; `undefined` = not read yet. */
  readonly allowance?: bigint;
  /** Does the connected wallet own this broker? `undefined` = not read yet. */
  readonly ownsToken?: boolean;
  /** Is it already activated? `undefined` = not read yet. */
  readonly alreadyActivated?: boolean;
  readonly walletReady?: boolean;
}

export interface ActivateVerdict {
  readonly configured: boolean;
  readonly loaded: boolean;
  /** An approval for at least `price` is needed before `activate` can be signed. */
  readonly needsApproval: boolean;
  readonly short: bigint;
  readonly canActivate: boolean;
  readonly blockedReason?: string;
}

/**
 * Whether this wallet can activate this broker right now, and why not.
 *
 * Mirrors the contract's own checks in the same order, so the button is disabled for exactly the
 * reasons a transaction would revert — the UI never offers a click that cannot work.
 */
export function deriveActivateState(i: ActivateState): ActivateVerdict {
  const configured = Boolean(i.registry);
  const loaded =
    configured &&
    i.price !== undefined &&
    i.balance !== undefined &&
    i.allowance !== undefined &&
    i.ownsToken !== undefined &&
    i.alreadyActivated !== undefined;

  const price = i.price ?? 0n;
  const balance = i.balance ?? 0n;
  const allowance = i.allowance ?? 0n;
  const short = loaded && balance < price ? price - balance : 0n;
  const needsApproval = loaded && allowance < price;

  let blockedReason: string | undefined;
  if (!configured) blockedReason = "Activation isn’t available on this network.";
  else if (!loaded) blockedReason = "Reading the chain…";
  else if (i.ownsToken === false) blockedReason = "You don’t hold this broker.";
  else if (i.alreadyActivated === true) blockedReason = "This broker is already active.";
  else if (short > 0n) blockedReason = "You don’t have enough SRK yet.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on this network to activate.";

  return {
    configured,
    loaded,
    needsApproval,
    short,
    canActivate: blockedReason === undefined,
    blockedReason,
  };
}

/** Whole SRK from base units, for display only. Floors — never rounds a price DOWN below the real one. */
export function wholeSrk(baseUnits: bigint): number {
  return Number(baseUnits / 10n ** 18n);
}

/** "10,000 SRK" — the one place the price is formatted, so no screen can invent a different one. */
export function formatSrk(baseUnits: bigint | undefined): string {
  if (baseUnits === undefined) return "…";
  return `${wholeSrk(baseUnits).toLocaleString()} SRK`;
}

/**
 * 043 phase F — the SRK monthly subscription is retired in favour of the Sparky Broker.
 *
 * Lives HERE, in the leaf, because two surfaces depend on it: `/premium` must stop offering the buy,
 * and `/premium/pay` must stop selling. Held in one page and copied to the other is how they end up
 * contradicting each other — offering a purchase that the next screen says is retired.
 *
 * A flag rather than a deletion, deliberately: the whole purchase path stays in the tree and
 * reversible while the broker route beds in on testnet, so undoing this is one line.
 */
export const SUBSCRIPTIONS_RETIRED = true;

export type PremiumSource = "broker" | "stored" | null;

export interface PremiumSourceView {
  readonly headline: string;
  readonly detail: string;
  /** What would end this access. The failure mode here is a holder who cannot tell. */
  readonly endsWhen: string;
  readonly showsExpiry: boolean;
}

/**
 * How the Premium page describes where the access comes from.
 *
 * ⚠️ A broker-sourced tier has NO expiry — it ends on transfer, not on a date — so this never
 * fabricates one. It is also unresolvable in practice: `activatedAt` is a block number and on
 * Robinhood Chain that is not addressable as an RPC block height, so even the activation date cannot
 * honestly be shown there.
 */
export function premiumSourceView(source: PremiumSource, tokenId?: number): PremiumSourceView {
  if (source === "broker") {
    const which = tokenId === undefined ? "an activated broker" : `broker #${String(tokenId).padStart(4, "0")}`;
    return {
      headline: `Active · via ${which}`,
      detail:
        "Your Premium comes from an activated Sparky Broker, so it has no expiry date and nothing renews.",
      endsWhen: `It ends if you transfer ${tokenId === undefined ? "that broker" : `#${String(tokenId).padStart(4, "0")}`}.`,
      showsExpiry: false,
    };
  }
  if (source === "stored") {
    // Post-043-phase-F this is a GRANT, not a purchase. The monthly SRK subscription is retired, so
    // "comes from a subscription — extend it" would point at a path that no longer exists. It may
    // carry an expiry (a grant can be time-boxed) or not, so the caller decides whether to show one.
    return {
      headline: "Active",
      detail: "Your Premium was granted directly to this wallet, rather than coming from a broker.",
      endsWhen: "It ends on its expiry date, if it has one. Activating a broker makes it yours to keep.",
      showsExpiry: true,
    };
  }
  return {
    headline: "Not active",
    detail: "Premium unlocks deeper analysis and higher limits.",
    endsWhen: "Activate a Sparky Broker to switch it on — it stays with the broker, not with a date.",
    showsExpiry: false,
  };
}
