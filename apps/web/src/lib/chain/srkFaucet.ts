/**
 * srkFaucet — pure, DOM-free helpers for the SRK faucet card (feature 026) so its cooldown/countdown
 * logic is unit-testable without a wallet or a clock.
 *
 * The faucet is a standalone dispenser (`contracts/src/token/SrkFaucet.sol`) holding a
 * hand-transferred float: SRK itself has a FIXED supply and no mint path, so nothing here can ever
 * create tokens. Every field below mirrors an on-chain read — nothing is fabricated, and an unread
 * value stays `undefined` rather than defaulting to a number the UI would present as fact.
 */

/** Seconds in a day — the deployed default cooldown. */
export const DAY_SECONDS = 86_400;

/**
 * The faucet card's DOM id on /premium. Shared so the "Get SRK" CTA on /premium/pay and the anchor
 * it scrolls to can never drift apart.
 */
export const SRK_FAUCET_ANCHOR = "srk-faucet";

export interface SrkFaucetInputs {
  /** The faucet address on the active chain — falsy ⇒ no faucet here (honest "unavailable"). */
  readonly faucet?: string;
  /** `claimAmount()` in base units; `undefined` = not yet read. `0n` = the admin PAUSED claiming. */
  readonly claimAmount?: bigint;
  /** `cooldown()` in seconds; `undefined` = not yet read. */
  readonly cooldown?: bigint;
  /** `nextClaimAt(owner)` — unix seconds, `0n` when this address has never claimed. */
  readonly nextClaimAt?: bigint;
  /** `available()` — the faucet's remaining float, in base units. */
  readonly available?: bigint;
  /** Current wall-clock in unix SECONDS (injected so the countdown is testable). */
  readonly nowSeconds: number;
  /** Whether a wallet is connected AND on the faucet's chain. */
  readonly walletReady?: boolean;
}

export interface SrkFaucetState {
  /** A faucet address exists on this chain. */
  readonly configured: boolean;
  /** Every on-chain field needed for a verdict has been read. */
  readonly loaded: boolean;
  /** `claimAmount == 0` — the admin paused the faucet without moving the float. */
  readonly paused: boolean;
  /** The float can't cover one more claim. */
  readonly empty: boolean;
  /** Seconds still to wait for THIS address; 0 when off cooldown (or never claimed). */
  readonly secondsRemaining: number;
  /** On cooldown right now. */
  readonly onCooldown: boolean;
  /** True only when a claim would actually succeed AND the wallet can sign it. */
  readonly canClaim: boolean;
  /** How many more claims the float covers at the current amount. */
  readonly claimsRemaining: number;
  /** Why the button is disabled — `undefined` when it is enabled. */
  readonly blockedReason?: string;
}

/** "23h 41m" / "41m 12s" / "12s" — a compact, honest countdown. Never negative. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Whole SRK from base units, for display only (18 dp, floor — never rounds a claim UP). */
export function wholeSrk(baseUnits: bigint): number {
  return Number(baseUnits / 10n ** 18n);
}

export function deriveSrkFaucetState(i: SrkFaucetInputs): SrkFaucetState {
  const configured = Boolean(i.faucet);
  const loaded =
    configured && i.claimAmount !== undefined && i.cooldown !== undefined && i.available !== undefined;

  const claimAmount = i.claimAmount ?? 0n;
  const available = i.available ?? 0n;
  const paused = loaded && claimAmount === 0n;
  const empty = loaded && !paused && available < claimAmount;

  const nextAt = Number(i.nextClaimAt ?? 0n);
  const secondsRemaining = nextAt > i.nowSeconds ? nextAt - i.nowSeconds : 0;
  const onCooldown = secondsRemaining > 0;

  const claimsRemaining = claimAmount > 0n ? Number(available / claimAmount) : 0;

  let blockedReason: string | undefined;
  if (!configured) blockedReason = "The SRK faucet isn’t deployed on this network.";
  else if (!i.walletReady) blockedReason = "Connect your wallet on Base Sepolia to claim.";
  else if (!loaded) blockedReason = "Reading the faucet…";
  else if (paused) blockedReason = "Claiming is paused right now.";
  else if (empty) blockedReason = "The faucet is out of SRK — an admin needs to top it up.";
  else if (onCooldown) blockedReason = `You can claim again in ${formatCountdown(secondsRemaining)}.`;

  return {
    configured,
    loaded,
    paused,
    empty,
    secondsRemaining,
    onCooldown,
    canClaim: blockedReason === undefined,
    claimsRemaining,
    blockedReason,
  };
}

/**
 * Turn a wallet/RPC revert into copy a tester can act on. The contract's `CooldownActive` error is
 * decoded by viem into a message naming the wait; anything else is passed through, truncated.
 */
export function faucetErrorCopy(raw: string): string {
  if (/CooldownActive/i.test(raw)) {
    return "You’ve already claimed recently — the faucet allows one claim per address per cooldown period.";
  }
  if (/FaucetPaused/i.test(raw)) return "Claiming is paused right now. Try again later.";
  if (/InsufficientFloat/i.test(raw)) {
    return "The faucet is out of SRK — an admin needs to top it up.";
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}
