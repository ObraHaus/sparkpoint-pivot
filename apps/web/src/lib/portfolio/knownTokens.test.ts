import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedTokensKey,
  chainKnownTokens,
  isAddressShape,
  isZeroAddress,
  mergeTokens,
  parseAddedTokenList,
  parseTokenAddress,
} from "./knownTokens.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0xAbCd00000000000000000000000000000000AbCd";
const C_LOWER = "0xabcd00000000000000000000000000000000abcd";
const ZERO = "0x0000000000000000000000000000000000000000";

test("053: address shape accepts only 0x + 40 hex, and never the zero address", () => {
  assert.equal(isAddressShape(A), true);
  assert.equal(isAddressShape(C), true);
  assert.equal(isAddressShape("0x123"), false);
  assert.equal(isAddressShape("not-an-address"), false);
  assert.equal(isAddressShape(`${A}zz`), false);
  assert.equal(isZeroAddress(ZERO), true);
  assert.equal(parseTokenAddress(A), A);
  assert.equal(parseTokenAddress(`  ${A}  `), A);
  assert.equal(parseTokenAddress(ZERO), null);
  assert.equal(parseTokenAddress("0xzz"), null);
});

test("053: chainKnownTokens names the stable + wrapped native, excluding zero placeholders", () => {
  const toks = chainKnownTokens({ usdc: A, weth: B }, "USDG");
  assert.deepEqual(
    toks.map((t) => t.symbol),
    ["USDG", "WETH"],
  );
  // The stable's display name is chain-specific: USDG on 4663, USDC elsewhere (the default).
  assert.deepEqual(
    chainKnownTokens({ usdc: A }).map((t) => t.symbol),
    ["USDC"],
  );
  const onlyStable = chainKnownTokens({ usdc: A, weth: ZERO }, "USDG");
  assert.equal(onlyStable.length, 1);
  assert.equal(chainKnownTokens(undefined).length, 0);
});

test("053: mergeTokens de-dupes by lowercase address (first list wins)", () => {
  const merged = mergeTokens(
    [{ address: C, symbol: "USDG" }],
    [
      { address: C_LOWER as `0x${string}`, symbol: "WRONG" },
      { address: B, symbol: "WETH" },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].symbol, "USDG");
  assert.equal(merged[1].symbol, "WETH");
});

test("053: parseAddedTokenList drops corrupt entries and never throws", () => {
  assert.deepEqual(parseAddedTokenList(null), []);
  assert.deepEqual(parseAddedTokenList(""), []);
  assert.deepEqual(parseAddedTokenList("not json"), []);
  assert.deepEqual(parseAddedTokenList(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parseAddedTokenList(JSON.stringify([A, "nope", ZERO, 42, C])), [A, C]);
});

test("053: the added-token storage key is chain + wallet scoped (wallet case-insensitive)", () => {
  assert.equal(addedTokensKey(4663, C), `sp:added-tokens:4663:${C_LOWER}`);
  assert.equal(addedTokensKey(4663, C_LOWER), addedTokensKey(4663, C));
});
