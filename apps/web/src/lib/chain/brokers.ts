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

/** Tier ids as the registry defines them. `0` is not a tier. */
export const TIER_ANALYST = 1;
export const TIER_ASSOCIATE = 2;
export const TIER_PARTNER = 3;

export interface ActivationTier {
  readonly id: number;
  readonly name: string;
  /** SRK retired at this tier, in base units. Read LIVE from the registry, never hardcoded. */
  readonly price?: bigint;
  /** Payout weight in basis points of 1.0x — 10000 = 1.0x, 33000 = 3.3x. */
  readonly weightBps?: number;
}

/** "3.3×" from 33000 bps. Basis points exist because 3.3 is not an integer multiplier. */
export function weightLabel(weightBps: number | undefined): string {
  if (weightBps === undefined) return "…";
  const x = weightBps / 10_000;
  return `${Number.isInteger(x) ? x.toFixed(1) : String(x)}×`;
}

/**
 * ⚠️⚠️ The sentence every tier picker MUST carry.
 *
 * A higher tier costs more SRK and records a larger payout weight — and **nothing pays out**. There
 * is no epoch, no pot and no claim path in any deployed contract. Until one exists, choosing Partner
 * over Analyst costs 4× the SRK and buys the holder nothing they can use today.
 *
 * Recording a weight is honest. Letting someone infer it earns them money is not, and the difference
 * is 750,000 SRK of their money. If a payout ever ships, this constant is the thing to change — and
 * a test asserts the disclosure is non-empty so it cannot be quietly deleted.
 */
export const TIER_WEIGHT_DISCLOSURE =
  "All three tiers unlock exactly the same Premium. A higher tier records a larger payout weight — " +
  "but revenue sharing is not built yet and nothing pays out today, so a higher tier buys you " +
  "nothing you can use right now. Choose Analyst unless you specifically want the larger weight " +
  "recorded on-chain for later.";

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

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * 044 — revenue share
 *
 * The distributor is deployed and CLAIMING IS OFF. Not behind a flag: `claim` reverts until a
 * period is published, so the off state is structural. These helpers therefore spend most of their
 * effort on describing an empty pot honestly, because that is the state the screen will be in for
 * as long as anyone can currently foresee.
 *
 * ⚠️ The hard rule from the spec, and the reason this lives in a leaf module with tests: NO
 * projected, illustrative, per-month or annualised figure may ever reach the screen. The only
 * number a holder may see is what the chain says is claimable right now. If that is zero, the
 * screen says zero. The prototype that started this feature showed "+$14.00/month" against a pot
 * that has never held more than 2.18 test-USDC.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** A published period, as read from the distributor. */
export interface PeriodView {
  readonly periodId: number;
  readonly token: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  /** Total the period allocated across all holders. */
  readonly totalAllocated: bigint;
  /** 0 = not published. A period exists before it is published. */
  readonly publishedAt: number;
}

export interface ClaimState {
  /** The deployed distributor, or `undefined` when the app has none configured. */
  readonly distributor?: string;
  /** `periodCount()`. `undefined` = not read yet; 0 = no period has ever been opened. */
  readonly periodCount?: number;
  /** The wallet's allocation for the selected period, from the published inputs. */
  readonly allocation?: bigint;
  /** Has this wallet already claimed this period? */
  readonly alreadyClaimed?: boolean;
  /** Is the selected period published? An unpublished period cannot be claimed by anyone. */
  readonly published?: boolean;
  readonly walletReady?: boolean;
  /** Does this wallet hold any activated broker? Drives which empty state is shown. */
  readonly holdsActivatedBroker?: boolean;
}

export type ClaimStatus =
  | "unconfigured"
  | "loading"
  | "no-periods"
  | "not-published"
  | "nothing-allocated"
  | "already-claimed"
  | "claimable";

export interface ClaimVerdict {
  readonly status: ClaimStatus;
  readonly canClaim: boolean;
  readonly headline: string;
  readonly detail: string;
}

/**
 * What the claim screen should say, and whether the button does anything.
 *
 * ⚠️ Every branch here is a state the product is actually in today except the last one. `claimable`
 * is unreachable until someone publishes an allocation, so the copy that matters most is the copy
 * for an empty pot — it must read as a plain fact, never as an error and never as a teaser.
 * "Coming soon" is a promise; "nothing has been distributed" is a description.
 */
export function deriveClaimState(i: ClaimState): ClaimVerdict {
  if (!i.distributor) {
    return {
      status: "unconfigured",
      canClaim: false,
      headline: "Revenue share is not available here",
      detail: "This network has no distributor deployed.",
    };
  }
  if (!i.walletReady || i.periodCount === undefined) {
    return { status: "loading", canClaim: false, headline: "Checking…", detail: "" };
  }
  if (i.periodCount === 0) {
    return {
      status: "no-periods",
      canClaim: false,
      headline: "Nothing has been distributed yet",
      detail:
        i.holdsActivatedBroker === true
          ? "Your broker's weight is recorded on-chain and will count when a period is distributed. No period has been opened, so there is nothing to claim."
          : "No period has been opened, so there is nothing to claim.",
    };
  }
  if (i.published === false) {
    // Funded but not published: value is in the contract and provably not claimable by anyone,
    // including us. Worth saying, because it is the more reassuring half of the truth.
    return {
      status: "not-published",
      canClaim: false,
      headline: "This period has not been published",
      detail:
        "Its allocation has not been committed yet, so nobody can claim from it — including SparkPoint.",
    };
  }
  if (i.allocation === undefined || i.alreadyClaimed === undefined) {
    return { status: "loading", canClaim: false, headline: "Checking…", detail: "" };
  }
  if (i.alreadyClaimed) {
    return {
      status: "already-claimed",
      canClaim: false,
      headline: "Already claimed",
      detail: "You have claimed your share of this period.",
    };
  }
  if (i.allocation === 0n) {
    return {
      status: "nothing-allocated",
      canClaim: false,
      headline: "Nothing allocated to this wallet",
      detail:
        "This period allocated nothing to you. Only brokers that were activated when the period closed receive a share.",
    };
  }
  return {
    status: "claimable",
    canClaim: true,
    headline: "Ready to claim",
    detail: "This is the amount the published allocation recorded for this wallet.",
  };
}

/**
 * A token amount for display. Exact, never rounded up, and never annualised.
 *
 * Truncates rather than rounding: showing more than the chain will actually pay is the one error
 * direction that turns into a support ticket about missing money.
 */
export function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number,
  symbol: string,
): string {
  if (amount === undefined) return "—";
  if (amount === 0n) return `0 ${symbol}`;
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  if (frac === 0n) return `${whole.toString()} ${symbol}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} ${symbol}`;
}

/**
 * What the screen says about the pot itself.
 *
 * ⚠️ Deliberately carries no rate, no projection and no per-broker estimate. The honest answer to
 * "what will I get?" today is "nothing has been distributed", and any number placed next to that
 * sentence would be read as a forecast.
 */
export const REVENUE_SHARE_DISCLOSURE =
  "Revenue share pays out whatever protocol revenue is actually distributed for a closed period, " +
  "split by the payout weight recorded on each activated broker. Nothing has been distributed so " +
  "far. There is no rate, no schedule and no projection — this page only ever shows what the " +
  "contract says is claimable right now.";

/** What the distributor cannot do. Stated because it is the part a holder cannot verify by looking. */
export const REVENUE_SHARE_CUSTODY_NOTE =
  "The distributor has no withdraw, sweep or rescue function. The only way value leaves it is a " +
  "holder claiming their own share; anything unclaimed stays and rolls into the next period.";
