import assert from "node:assert/strict";
import { test } from "node:test";

import { tokenLogoUrl } from "./logos.ts";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C";

test("052: bundled local art resolves by chain + exact address (case-insensitive)", () => {
  assert.equal(tokenLogoUrl(4663, { symbol: "USDG", address: USDG }), "/tokens/usdg.png");
  assert.equal(tokenLogoUrl(4663, { symbol: "NVDA", address: NVDA }), "/tokens/nvda.svg");
  assert.equal(
    tokenLogoUrl(4663, { symbol: "USDG", address: USDG.toLowerCase() }),
    "/tokens/usdg.png",
  );
});

test("052: SPY has no bundled art and no 4663 CDN slug — it falls back to the avatar", () => {
  assert.equal(tokenLogoUrl(4663, { symbol: "SPY", address: SPY, verified: true }), undefined);
});

test("052: a VERIFIED symbol resolves local art; an unverified one never gets the real mark", () => {
  assert.equal(tokenLogoUrl(4663, { symbol: "USDG", address: USDG, verified: true }), "/tokens/usdg.png");
  // An unverified token that borrows the symbol at another address gets NOTHING from the symbol map.
  assert.equal(
    tokenLogoUrl(4663, { symbol: "USDG", address: "0x1111111111111111111111111111111111111111", verified: false }),
    undefined,
  );
  assert.equal(
    tokenLogoUrl(4663, { symbol: "USDC", address: "0x2222222222222222222222222222222222222222", verified: false }),
    undefined,
  );
});

test("052: native ETH is always the real ETH mark", () => {
  assert.equal(tokenLogoUrl(4663, { symbol: "ETH", address: "", isNative: true }), "/tokens/eth.png");
  assert.equal(tokenLogoUrl(undefined, { symbol: "ETH", address: "", isNative: true }), "/tokens/eth.png");
});

test("the Trust Wallet CDN remains the fallback for chains that have a slug", () => {
  const url = tokenLogoUrl(8453, {
    symbol: "SOMETHING",
    address: "0x3333333333333333333333333333333333333333",
    verified: false,
  });
  assert.ok(url?.startsWith("https://assets-cdn.trustwallet.com/blockchains/base/assets/"));
});
