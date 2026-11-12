/**
 * brokerEngine — pure, DOM-free helpers for the 4663 beta broker surface (W.3).
 *
 * Companion to `brokers.ts`, not a replacement: that leaf holds the pre-pivot 46630 collection
 * (sale + activation registry, SRK "retired"). This one models the beta's `BrokerEngine` — the
 * NFT-external verbs a holder signs there (`clockIn` / `promote` / `fuse`), where the Pons utility
 * token is burned **through the engine** (`burnFrom`) and fusion burns the absorbed NFTs.
 *
 * A LEAF by necessity, like `brokers.ts`: `node --experimental-strip-types` cannot resolve the
 * extensionless internal imports inside the `@sparkpoint/shared` barrels, so a test that
 * value-imports this module would make the whole suite unloadable. Chain ids, addresses, ABIs and
 * prices are passed IN, and nothing here reaches the network.
 *
 * ⚠️ The engine stores rank as a `uint8` 1/2/3 and its Solidity names are Intern/Manager/Director.
 * The PRODUCT (and 043's tier picker) calls them Analyst/Associate/Partner. This file uses the
 * product names and carries the engine's numbers, so neither vocabulary leaks into the other's
 * surface.
 */

/** Rank ids as the engine stores them. `0` is a broker that has never been clocked in. */
export const RANK_UNRANKED = 0;
export const RANK_ANALYST = 1;
export const RANK_ASSOCIATE = 2;
export const RANK_PARTNER = 3;

/** "Analyst" / "…" — the one place a rank becomes words, so no screen can invent another name. */
export function rankLabel(rank: number | undefined): string {
  if (rank === undefined) return "…";
  if (rank === RANK_ANALYST) return "Analyst";
  if (rank === RANK_ASSOCIATE) return "Associate";
  if (rank === RANK_PARTNER) return "Partner";
  return "Unranked";
}

/** A rank of 0 has never been clocked in; ranks only ever move up (the contract rejects `<=`). */
export function nextRanks(rank: number | undefined): readonly number[] {
  const r = rank ?? RANK_UNRANKED;
  return [RANK_ASSOCIATE, RANK_PARTNER].filter((n) => n > r);
}

export const FUSE_MIN_PARTS = 2;
export const FUSE_MAX_PARTS = 3;

/**
 * What a fuse costs in utility tokens, or `undefined` while the prices are unread.
 *
 * ⚠️ A three-part fuse is NOT `fuseThree` — the contract charges `fuseBurnTwo + fuseBurnThree`
 * (`BrokerEngine.fuse`, the `n == MIN_FUSE_PARTS ? … : …` branch). Reading it as a single term
 * would quote a third of the real price, the one direction a burn quote must never be wrong in.
 */
export function fuseBurnFor(
  parts: number,
  burns: { readonly fuseTwo?: bigint; readonly fuseThree?: bigint },
): bigint | undefined {
  if (burns.fuseTwo === undefined || burns.fuseThree === undefined) return undefined;
  if (parts === FUSE_MIN_PARTS) return burns.fuseTwo;
  if (parts === FUSE_MAX_PARTS) return burns.fuseTwo + burns.fuseThree;
  return undefined;
}

/**
 * What a promotion still owes: the target rank's price minus what the broker's current rank has
 * already burned. Zero when the holder is only ever charged the difference (the contract's `due`).
 */
export function promoteBurnDue(target: bigint, alreadyBurned: bigint): bigint {
  return target > alreadyBurned ? target - alreadyBurned : 0n;
}

/**
 * How many candidate ids the fallback ownership scan may walk: the collection's MINTED CAP, bounded
 * by the UI limit.
 *
 * ⚠️ Never `totalSupply`: that is the LIVE count, and a fusion burns an absorbed broker, so a burned
 * low id makes `totalSupply` smaller than the highest minted id. Bounding by it hid live brokers
 * (smoke wallet: 9 owned, 8 shown — id #10 was invisible because id 1 had been fused away).
 */
export function ownershipScanCount(
  maxSupply: bigint | undefined,
  totalSupply: bigint | undefined,
  limit: number,
): number {
  const cap = maxSupply ?? totalSupply;
  if (cap === undefined) return 0;
  return Number(cap > BigInt(limit) ? BigInt(limit) : cap);
}

/**
 * Is the fallback scan incomplete?
 *
 * The precise check: the wallet's `balanceOf` is how many live brokers it holds, so if the scan
 * found fewer owned ids than that, some live id sits outside the scanned range (or a read failed)
 * and the screen must say the list may be short. While `balanceOf` is unread, the honest fallback
 * is "the collection's cap exceeds the scan bound, so ids above it may exist".
 */
export function ownershipScanTruncated(
  found: number | undefined,
  balance: number | undefined,
  maxSupply: bigint | undefined,
  limit: number,
): boolean {
  if (found !== undefined && balance !== undefined) return found < balance;
  return maxSupply !== undefined && maxSupply > BigInt(limit);
}

/** The shape every verb verdict shares. */
export interface BrokerVerbVerdict {
  readonly configured: boolean;
  readonly loaded: boolean;
  /** The utility-token allowance to the ENGINE is short of the burn. */
  readonly needsApproval: boolean;
  /** How much more utility token the wallet needs; 0 when the balance covers it. */
  readonly short: bigint;
  /**
   * True only when clicking the verb RIGHT NOW would succeed — approvals included. The screen's
   * approve steps are separate transactions, so an unapproved verb canSubmit would send a call
   * that reverts on allowance.
   */
  readonly canSubmit: boolean;
  /** Why the button is disabled — `undefined` when it is enabled. */
  readonly blockedReason?: string;
}

interface BurnLeg {
  /** The holder's utility-token balance; `undefined` = not read yet. */
  readonly balance?: bigint;
  /** `allowance(wallet, engine)`; `undefined` = not read yet. Unread counts as 0 (ask, never revert). */
  readonly allowance?: bigint;
  /** The utility token's symbol, for the copy only. */
  readonly symbol?: string;
  readonly walletReady?: boolean;
}

/**
 * Whether the wallet needs an approval for `cost`, which is `undefined` until the price is read.
 *
 * ⚠️ An UNREAD allowance counts as zero, deliberately: the app asks for an approval it may not
 * need rather than sending a transaction that reverts `ERC20InsufficientAllowance`.
 */
function burnLeg(
  cost: bigint | undefined,
  leg: BurnLeg,
): { ready: boolean; needsApproval: boolean; short: bigint } {
  const ready = cost !== undefined && leg.balance !== undefined && leg.allowance !== undefined;
  const allowance = leg.allowance ?? 0n;
  const short = cost !== undefined && leg.balance !== undefined && leg.balance < cost ? cost - leg.balance : 0n;
  return { ready, needsApproval: cost !== undefined && allowance < cost, short };
}

function shortfallCopy(short: bigint, symbol: string | undefined): string {
  if (short === 0n) return "";
  return symbol ? `You don’t have enough ${symbol} yet.` : "You don’t have enough utility tokens yet.";
}

export interface ClockInInput extends BurnLeg {
  readonly engine?: string;
  readonly token?: string;
  readonly owns?: boolean;
  readonly alreadyActive?: boolean;
  /** `clockInBurn()` — live storage, never a constant. `undefined` = not read yet. */
  readonly burn?: bigint;
}

/**
 * Can this wallet clock this broker in right now, and why not.
 *
 * Mirrors the contract's own checks in its order (`TokenNotSet` → owner → `AlreadyActive`), then
 * the burn leg. Clocking in is idempotent in the wrong direction — the burn happens EVERY time —
 * so an already-active broker must be reported as such before the price is ever shown.
 */
export function deriveClockIn(i: ClockInInput): BrokerVerbVerdict {
  const leg = burnLeg(i.burn, i);
  const configured = Boolean(i.engine) && Boolean(i.token);

  let blockedReason: string | undefined;
  if (!i.engine) blockedReason = "The broker engine isn’t available on this network.";
  else if (!i.token) blockedReason = "The utility token isn’t available on this network.";
  else if (i.owns === undefined) blockedReason = "Checking ownership…";
  else if (i.owns === false) blockedReason = "You don’t hold this broker.";
  else if (i.alreadyActive === undefined) blockedReason = "Reading the chain…";
  else if (i.alreadyActive) blockedReason = "This broker is already clocked in.";
  else if (!leg.ready) blockedReason = "Reading the cost…";
  // The shortfall outranks the approval: approving is possible without the balance (ERC-20 does
  // not check it), but it would not unblock the verb, so the missing balance is the real answer.
  else if (leg.short > 0n) blockedReason = shortfallCopy(leg.short, i.symbol);
  else if (leg.needsApproval) blockedReason = "Approve the burn to the engine first.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on this network to clock in.";

  return {
    configured,
    loaded: leg.ready,
    needsApproval: leg.needsApproval,
    short: leg.short,
    canSubmit: blockedReason === undefined,
    blockedReason,
  };
}

export interface PromoteInput extends BurnLeg {
  readonly engine?: string;
  readonly token?: string;
  readonly owns?: boolean;
  /** The broker's current rank (`rankOf`); `undefined` = not read yet. */
  readonly rank?: number;
  /** The rank being promoted to — only 2 (Associate) or 3 (Partner) are valid. */
  readonly target?: number;
  /** The additional burn still due (`promoteBurnDue(targetPrice, tierBurned)`); `undefined` = not read. */
  readonly due?: bigint;
}

/**
 * Whether a promotion can be signed, and why not.
 *
 * Note there is NO `isActive` gate: rank can be raised on an idle broker too (the contract only
 * re-derives weight when one is active). An idle promotion is a legitimate way to raise a broker
 * before it starts earning.
 */
export function derivePromote(i: PromoteInput): BrokerVerbVerdict {
  const leg = burnLeg(i.due, i);
  const configured = Boolean(i.engine) && Boolean(i.token);

  let blockedReason: string | undefined;
  if (!i.engine) blockedReason = "The broker engine isn’t available on this network.";
  else if (!i.token) blockedReason = "The utility token isn’t available on this network.";
  else if (i.owns === undefined) blockedReason = "Checking ownership…";
  else if (i.owns === false) blockedReason = "You don’t hold this broker.";
  else if (i.target !== RANK_ASSOCIATE && i.target !== RANK_PARTNER) {
    blockedReason = "Pick Associate or Partner to promote this broker.";
  } else if (i.rank === undefined) blockedReason = "Reading the chain…";
  else if (i.target <= i.rank) blockedReason = "That rank is already held.";
  else if (!leg.ready) blockedReason = "Reading the cost…";
  else if (leg.short > 0n) blockedReason = shortfallCopy(leg.short, i.symbol);
  else if (leg.needsApproval) blockedReason = "Approve the burn to the engine first.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on this network to promote.";

  return {
    configured,
    loaded: leg.ready,
    needsApproval: leg.needsApproval,
    short: leg.short,
    canSubmit: blockedReason === undefined,
    blockedReason,
  };
}

export interface FuseInput extends BurnLeg {
  readonly engine?: string;
  readonly token?: string;
  /** The ids picked, in order: the first is the survivor, the rest are absorbed. */
  readonly ids: readonly number[];
  /** Does the wallet hold every picked broker? `undefined` = not read yet. */
  readonly allOwned?: boolean;
  /** Is any picked broker already fused? A fused broker cannot be absorbed again (any part). */
  readonly anyAlreadyFused?: boolean;
  /** `isApprovedForAll(wallet, engine)` on the collection — the engine must be able to `burn`. */
  readonly nftApproved?: boolean;
  /** `fuseBurnFor(ids.length, prices)`; `undefined` = not read yet. */
  readonly burn?: bigint;
}

export interface FuseVerdict extends BrokerVerbVerdict {
  /** The engine needs ERC-721 operator approval before it can burn the absorbed brokers. */
  readonly needsNftApproval: boolean;
}

/**
 * Whether a fusion can be signed, and why not.
 *
 * ⚠️ Fusion is the only irreversible verb here: the absorbed NFTs are burned and the collection
 * permanently shrinks. It therefore mirrors every contract check BEFORE the burn leg, including
 * the duplicate-id check (`BadFuse`) and the already-fused check on EVERY id — the contract
 * rejects a picked id with `parts != 0`, survivor included.
 *
 * The ERC-721 approval is a second, different approval (all-or-nothing — ERC-721 has no per-token
 * burn allowance), so it is reported separately and the UI must make it its own explained step.
 */
export function deriveFuse(i: FuseInput): FuseVerdict {
  const leg = burnLeg(i.burn, i);
  const configured = Boolean(i.engine) && Boolean(i.token);
  const needsNftApproval = i.nftApproved === false;

  const unique = new Set(i.ids).size === i.ids.length;

  let blockedReason: string | undefined;
  if (!i.engine) blockedReason = "The broker engine isn’t available on this network.";
  else if (!i.token) blockedReason = "The utility token isn’t available on this network.";
  else if (i.ids.length < FUSE_MIN_PARTS || i.ids.length > FUSE_MAX_PARTS) {
    blockedReason = `Pick ${FUSE_MIN_PARTS} or ${FUSE_MAX_PARTS} brokers to fuse.`;
  } else if (!unique) blockedReason = "The same broker is picked twice.";
  else if (i.allOwned === undefined) blockedReason = "Checking ownership…";
  else if (i.allOwned === false) blockedReason = "You must hold every broker you fuse.";
  else if (i.anyAlreadyFused === undefined) blockedReason = "Reading the chain…";
  else if (i.anyAlreadyFused) blockedReason = "One of those brokers is already fused.";
  else if (i.nftApproved === undefined) blockedReason = "Reading approvals…";
  else if (needsNftApproval) {
    blockedReason = "Approve the engine once so it can burn the brokers being absorbed.";
  } else if (!leg.ready) blockedReason = "Reading the cost…";
  else if (leg.short > 0n) blockedReason = shortfallCopy(leg.short, i.symbol);
  else if (leg.needsApproval) blockedReason = "Approve the burn to the engine first.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on this network to fuse.";

  return {
    configured,
    loaded: leg.ready,
    needsApproval: leg.needsApproval,
    needsNftApproval,
    short: leg.short,
    canSubmit: blockedReason === undefined,
    blockedReason,
  };
}
