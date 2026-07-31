/**
 * Tests for the Morpho Vault V2 read surface (024 Phase 3).
 *
 * LEAF-ONLY IMPORTS. This runs under `node --experimental-strip-types`, which cannot follow `@/…`
 * aliases, extensionless sibling value-imports, or the shared-abis barrel — hence the explicit
 * `.ts` specifier and a module under test that imports nothing.
 *
 * What these lock down are the three traps that would each ship a *plausible* wrong number rather
 * than an error, which is why they need tests rather than types:
 *   1. the WAD→bps conversion overflowing (it already did, in the shell version, to −8 bps)
 *   2. the launch-vault ABI silently "working" against a V2 and fabricating a 10% fee
 *   3. `max*` being read as a real limit when a V2 returns a hard-coded 0
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { morphoVaultV2Abi, wadToBpsCeil } from "./morphoVaultV2Abi.ts";

// `Set<string>`, not the inferred literal union: the point of these tests is to probe names that are
// DELIBERATELY absent, and a union-typed Set would reject those at compile time — turning a runtime
// assertion we want into a type error we do not.
const names: Set<string> = new Set(morphoVaultV2Abi.map((e) => e.name as string));

test("wadToBpsCeil converts the fee rates we actually expect", () => {
  assert.equal(wadToBpsCeil(0n), 0, "a 0 fee is 0 bps, and the deployed vault reads exactly this");
  assert.equal(wadToBpsCeil(10n ** 18n), 10_000, "1e18 WAD is 100%");
  assert.equal(wadToBpsCeil(10n ** 17n), 1000, "0.1e18 is the 10% SparkPoint fee");
  assert.equal(wadToBpsCeil(2n * 10n ** 17n), 2000, "0.2e18 is the 20% constitutional ceiling");
  assert.equal(wadToBpsCeil(5n * 10n ** 17n), 5000, "0.5e18 is Morpho V2's own 50% ceiling");
});

test("wadToBpsCeil does NOT overflow on a large fee — the bug the FR-020 gate actually hit", () => {
  // The shell version computed `wad * 10000` in 64-bit signed arithmetic. For a 25% fee that is
  // 2.5e21, which wrapped to a NEGATIVE number and read as -8 bps, passing a 0-bps ceiling — i.e.
  // it would have admitted a 25%-fee vault. Caught by pointing the gate at a real 25% vault.
  assert.equal(wadToBpsCeil(25n * 10n ** 16n), 2500, "a 25% fee must be 2500 bps, never negative");
  assert.ok(wadToBpsCeil(25n * 10n ** 16n) > 0, "must never go negative");
  // And the extreme: a 100x-over-ceiling fee must still be a large positive number.
  assert.equal(wadToBpsCeil(100n * 10n ** 18n), 1_000_000);
});

test("wadToBpsCeil rounds UP, so a fee just over a ceiling cannot pass it", () => {
  // 0.200001e18 is fractionally above the 20% cap. Truncating down yields exactly 2000 and would
  // PASS a 2000-bps ceiling; rounding up yields 2001 and fails it. Erring upward can only ever make
  // us refuse or over-disclose, never under-disclose.
  const justOver = 2n * 10n ** 17n + 1n;
  assert.equal(wadToBpsCeil(justOver), 2001);
  assert.ok(wadToBpsCeil(justOver) > 2000, "must not truncate into passing the 20% cap");
  assert.equal(wadToBpsCeil(1n), 1, "even 1 wei of fee rounds up to 1 bp, never down to 0");
});

test("wadToBpsCeil treats a non-positive fee as 0 rather than propagating a negative", () => {
  assert.equal(wadToBpsCeil(0n), 0);
  assert.equal(wadToBpsCeil(-1n), 0, "a negative can only come from a bad decode; never surface it");
});

test("the V2 ABI declares the fee selectors a V2 really has", () => {
  assert.ok(names.has("performanceFee"), "WAD-scaled, not bps");
  assert.ok(names.has("managementFee"));
  assert.ok(names.has("performanceFeeRecipient"));
});

test("the V2 ABI does NOT declare selectors a Vault V2 lacks", () => {
  // Each of these exists on SparkPoint's own ERC-4626 and NOT on a V2. Declaring one here would
  // invite a read that resolves to `undefined` under `allowFailure: true` — and an `undefined`
  // performance fee falls through to the policy DEFAULT of 1000, i.e. a confident 10% fee the vault
  // never reported. The deployed V2's real fee is 0.
  for (const absent of [
    "highWaterMark",
    "paused",
    "performanceFeeBps",
    "MAX_PERFORMANCE_FEE_BPS",
    "feeRecipient",
    "label",
    "morphoVault",
    "factory",
    "isSparkPointVault",
  ]) {
    assert.equal(names.has(absent), false, `${absent} must not be declared on the V2 ABI`);
  }
});

test("the V2 ABI omits max* entirely, so no surface can derive a limit from them (N2)", () => {
  // On a V2 these are `pure returns (0)` and are NOT enforced in deposit/withdraw. A UI that trusts
  // them tells a holder "you cannot withdraw" — false, and the worst possible thing to say.
  for (const absent of ["maxDeposit", "maxMint", "maxWithdraw", "maxRedeem"]) {
    assert.equal(names.has(absent), false, `${absent} is pure-0 on a V2 and must be unreachable`);
  }
});

test("the N2 exit surface IS present and is not gated by anything in this ABI", () => {
  for (const present of ["redeem", "withdraw", "forceDeallocate", "previewRedeem", "convertToAssets"]) {
    assert.ok(names.has(present), `${present} is part of the exit path and must be declared`);
  }
  // Nothing on the exit path may be view-gated on a SparkPoint decision; these are plain mutators.
  const redeem = morphoVaultV2Abi.find((e) => e.name === "redeem");
  assert.equal(redeem?.stateMutability, "nonpayable");
});

test("the governance/abdication evidence is readable, so the posture can be proven not asserted", () => {
  for (const present of ["owner", "curator", "abdicated", "timelock", "isSentinel"]) {
    assert.ok(names.has(present), `${present} is the on-chain evidence for the N2/FR-021 claims`);
  }
  const abdicated = morphoVaultV2Abi.find((e) => e.name === "abdicated");
  assert.equal(abdicated?.inputs[0]?.type, "bytes4", "abdicated is keyed by selector");
});

test("every declared entry is view/pure except the known mutators", () => {
  const mutators: Set<string> = new Set(["deposit", "mint", "withdraw", "redeem", "forceDeallocate"]);
  for (const e of morphoVaultV2Abi) {
    if (mutators.has(e.name)) continue;
    // Widened to `string` so the comparison stays a runtime check: TS narrows stateMutability to the
    // literals actually present, which would make `=== "pure"` a compile error rather than a test.
    const mut: string = e.stateMutability;
    assert.ok(
      mut === "view" || mut === "pure",
      `${e.name} must be read-only — this hook layer never signs`,
    );
  }
});

test("decimals is declared and is the SHARE scale — the 1e12 trap", () => {
  // A V2's own decimals() is 18 while its asset is 6-dp USDC. The ABI can only declare the selector;
  // the guard against conflating the two lives in useVault (asset decimals are read off asset()).
  // This test exists so the selector's meaning is recorded next to the ABI that exposes it.
  const d = morphoVaultV2Abi.find((e) => e.name === "decimals");
  assert.equal(d?.outputs[0]?.type, "uint8");
  assert.ok(names.has("asset"), "asset() must be declared so its own decimals can be read separately");
  assert.ok(names.has("virtualShares"), "virtualShares() is the on-chain proof of the decimals offset");
});
