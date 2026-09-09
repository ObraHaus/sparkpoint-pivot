import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY_SECONDS,
  deriveSrkFaucetState,
  faucetErrorCopy,
  formatCountdown,
  pickSrkFaucetChain,
  type SrkFaucetChain,
  wholeSrk,
} from "./srkFaucet.ts";

const FAUCET = "0x93766a1C6c2076F658710770549af34Ac46dB2a9";
const NOW = 1_800_000_000;
const AMOUNT = 5_000n * 10n ** 18n;
const FLOAT = 10_000_000n * 10n ** 18n;

const base = {
  faucet: FAUCET,
  claimAmount: AMOUNT,
  cooldown: BigInt(DAY_SECONDS),
  available: FLOAT,
  nowSeconds: NOW,
  walletReady: true,
};

test("a funded faucet + a ready wallet + no prior claim ⇒ claimable", () => {
  const s = deriveSrkFaucetState(base);
  assert.equal(s.configured, true);
  assert.equal(s.loaded, true);
  assert.equal(s.canClaim, true);
  assert.equal(s.blockedReason, undefined);
  assert.equal(s.onCooldown, false);
  assert.equal(s.secondsRemaining, 0);
  assert.equal(s.claimsRemaining, 2000);
});

test("no faucet on this chain ⇒ unavailable, never a button that cannot work", () => {
  const s = deriveSrkFaucetState({ ...base, faucet: undefined });
  assert.equal(s.configured, false);
  assert.equal(s.canClaim, false);
  assert.match(s.blockedReason ?? "", /isn’t deployed/);
});

test("reads not back yet ⇒ NOT loaded and NOT claimable (no fabricated verdict)", () => {
  const s = deriveSrkFaucetState({ ...base, claimAmount: undefined, available: undefined });
  assert.equal(s.loaded, false);
  assert.equal(s.canClaim, false);
  assert.match(s.blockedReason ?? "", /Reading the faucet/);
});

test("wallet not connected / wrong chain ⇒ blocked with the actionable reason", () => {
  // The chain is passed IN. It used to be the literal "Base Sepolia" baked into the helper, which
  // became wrong the moment 043 phase 1 put a second SRK faucet on Robinhood testnet.
  const s = deriveSrkFaucetState({ ...base, walletReady: false, chainName: "Base Sepolia" });
  assert.equal(s.canClaim, false);
  assert.match(s.blockedReason ?? "", /Connect your wallet on Base Sepolia/);
});

test("claimAmount 0 is the admin PAUSE — reported as paused, not as empty", () => {
  const s = deriveSrkFaucetState({ ...base, claimAmount: 0n });
  assert.equal(s.paused, true);
  assert.equal(s.empty, false);
  assert.equal(s.canClaim, false);
  assert.equal(s.claimsRemaining, 0);
  assert.match(s.blockedReason ?? "", /paused/);
});

test("a float short of one claim ⇒ empty, with a top-up message", () => {
  const s = deriveSrkFaucetState({ ...base, available: AMOUNT - 1n });
  assert.equal(s.empty, true);
  assert.equal(s.canClaim, false);
  assert.equal(s.claimsRemaining, 0);
  assert.match(s.blockedReason ?? "", /out of SRK/);
});

test("exactly one claim left is still claimable", () => {
  const s = deriveSrkFaucetState({ ...base, available: AMOUNT });
  assert.equal(s.empty, false);
  assert.equal(s.canClaim, true);
  assert.equal(s.claimsRemaining, 1);
});

test("cooldown countdown counts down and clears exactly at nextClaimAt", () => {
  const nextAt = BigInt(NOW + 3600);
  const mid = deriveSrkFaucetState({ ...base, nextClaimAt: nextAt });
  assert.equal(mid.onCooldown, true);
  assert.equal(mid.secondsRemaining, 3600);
  assert.equal(mid.canClaim, false);
  assert.match(mid.blockedReason ?? "", /claim again in 1h 0m/);

  const atBoundary = deriveSrkFaucetState({ ...base, nextClaimAt: BigInt(NOW) });
  assert.equal(atBoundary.onCooldown, false);
  assert.equal(atBoundary.canClaim, true);

  const past = deriveSrkFaucetState({ ...base, nextClaimAt: BigInt(NOW - 1) });
  assert.equal(past.secondsRemaining, 0);
  assert.equal(past.canClaim, true);
});

test("nextClaimAt 0n means 'never claimed' — not 'overdue since 1970'", () => {
  const s = deriveSrkFaucetState({ ...base, nextClaimAt: 0n });
  assert.equal(s.secondsRemaining, 0);
  assert.equal(s.canClaim, true);
});

test("formatCountdown renders h/m/s and never goes negative", () => {
  assert.equal(formatCountdown(DAY_SECONDS - 1), "23h 59m");
  assert.equal(formatCountdown(3661), "1h 1m");
  assert.equal(formatCountdown(125), "2m 5s");
  assert.equal(formatCountdown(9), "9s");
  assert.equal(formatCountdown(0), "0s");
  assert.equal(formatCountdown(-500), "0s");
});

test("wholeSrk floors — a display can never claim more than the contract pays", () => {
  assert.equal(wholeSrk(AMOUNT), 5000);
  assert.equal(wholeSrk(AMOUNT - 1n), 4999);
  assert.equal(wholeSrk(0n), 0);
});

test("faucetErrorCopy turns the contract's custom errors into tester-readable copy", () => {
  assert.match(faucetErrorCopy("...CooldownActive(1700, 3600)..."), /one claim per address/);
  assert.match(faucetErrorCopy("execution reverted: FaucetPaused()"), /paused/);
  assert.match(faucetErrorCopy("InsufficientFloat(0, 5000)"), /out of SRK/);
  // anything else passes through, truncated
  const long = "x".repeat(300);
  assert.equal(faucetErrorCopy(long).length, 158);
  assert.equal(faucetErrorCopy("User rejected the request."), "User rejected the request.");
});

// ── 043 phase 1: SRK exists on two chains, so the card has to choose one ──────────────────────
const BASE_SEPOLIA: SrkFaucetChain = {
  chainId: 84532,
  name: "Base Sepolia",
  srk: "0x2dF90304126560F01Dd6EafB508B69c033dFeD52",
  faucet: "0x93766a1C6c2076F658710770549af34Ac46dB2a9",
};
const ROBINHOOD: SrkFaucetChain = {
  chainId: 46630,
  name: "Robinhood Testnet",
  srk: "0x4538B536b1da5940deC8e15048Ce07a053699B04",
  faucet: "0x39C38c86611FF3679802D5341E830c83DB7F4537",
};
const CHAINS = [BASE_SEPOLIA, ROBINHOOD];

test("the card follows the connected wallet when that chain has a faucet", () => {
  // A tester who switched to Robinhood to activate a broker must not be sent back to Base Sepolia.
  assert.equal(pickSrkFaucetChain(CHAINS, 46630)?.chainId, 46630);
  assert.equal(pickSrkFaucetChain(CHAINS, 84532)?.chainId, 84532);
});

test("an unknown / disconnected wallet falls back to the first configured chain, never blank", () => {
  assert.equal(pickSrkFaucetChain(CHAINS, undefined)?.chainId, 84532);
  assert.equal(pickSrkFaucetChain(CHAINS, 8453)?.chainId, 84532);
});

test("a chain without a faucet is never picked, even when the wallet is on it", () => {
  const noFaucet: SrkFaucetChain = { chainId: 46630, name: "Robinhood Testnet" };
  assert.equal(pickSrkFaucetChain([BASE_SEPOLIA, noFaucet], 46630)?.chainId, 84532);
  assert.equal(pickSrkFaucetChain([noFaucet], 46630), undefined);
  assert.equal(pickSrkFaucetChain([], 84532), undefined);
});

test("the two SRKs are different tokens — the picker never blends them", () => {
  const a = pickSrkFaucetChain(CHAINS, 84532);
  const b = pickSrkFaucetChain(CHAINS, 46630);
  assert.notEqual(a?.srk, b?.srk);
  assert.notEqual(a?.faucet, b?.faucet);
});

test("the wrong-network prompt names the chain being shown, not a hardcoded one", () => {
  const off = { ...base, walletReady: false, nowSeconds: NOW };
  assert.match(
    deriveSrkFaucetState({ ...off, chainName: "Robinhood Testnet" }).blockedReason ?? "",
    /Robinhood Testnet/,
  );
  assert.match(
    deriveSrkFaucetState({ ...off, chainName: "Base Sepolia" }).blockedReason ?? "",
    /Base Sepolia/,
  );
  // No chain name ⇒ stay generic rather than naming the wrong network.
  const generic = deriveSrkFaucetState(off).blockedReason ?? "";
  assert.doesNotMatch(generic, /Base Sepolia|Robinhood/);
  assert.match(generic, /Connect your wallet/);
});
