import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlausibleDecimals, sanitizeMetaString, shortAddressLabel, MAX_META_LEN } from "./metadata.pure.ts";

// A token's symbol()/name() are attacker-controlled — sanitizeMetaString is the display guard.
test("sanitizeMetaString keeps an ordinary symbol unchanged", () => {
  assert.equal(sanitizeMetaString("USDC"), "USDC");
  assert.equal(sanitizeMetaString("Wrapped Ether"), "Wrapped Ether");
});

test("sanitizeMetaString strips zero-width characters (a common phishing trick)", () => {
  // "USD" + ZERO-WIDTH SPACE + "C" must collapse to "USDC".
  assert.equal(sanitizeMetaString("USD" + String.fromCharCode(0x200b) + "C"), "USDC");
  // ZWNJ / ZWJ / word-joiner / BOM are all removed.
  assert.equal(
    sanitizeMetaString("A" + String.fromCharCode(0x200c, 0x200d, 0x2060, 0xfeff) + "B"),
    "AB",
  );
});

test("sanitizeMetaString strips C0/C1 control characters", () => {
  assert.equal(sanitizeMetaString("A" + String.fromCharCode(0x07) + "B"), "AB");
  assert.equal(sanitizeMetaString(String.fromCharCode(0x00) + "USDC" + String.fromCharCode(0x1f)), "USDC");
});

test("sanitizeMetaString collapses whitespace and trims", () => {
  assert.equal(sanitizeMetaString("  Wrapped   Ether  "), "Wrapped Ether");
  assert.equal(sanitizeMetaString("\tUSDC\n"), "USDC");
});

test("sanitizeMetaString NFKC-normalizes compatibility forms (fullwidth → ASCII)", () => {
  // Fullwidth letters (U+FF21 'Ａ' …) normalize to plain ASCII under NFKC.
  assert.equal(sanitizeMetaString("ＵＳＤＣ"), "USDC");
});

test("sanitizeMetaString caps length and rejects non-strings", () => {
  const long = "X".repeat(80);
  assert.equal(sanitizeMetaString(long).length, MAX_META_LEN);
  assert.equal(sanitizeMetaString(undefined), "");
  assert.equal(sanitizeMetaString(123), "");
  assert.equal(sanitizeMetaString(null), "");
});

test("shortAddressLabel renders 0x1234…abcd for a full address, else the input", () => {
  assert.equal(shortAddressLabel("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
  assert.equal(shortAddressLabel("0xabc"), "0xabc"); // too short to truncate
});

test("isPlausibleDecimals accepts sane decimals and rejects the rest", () => {
  for (const ok of [0, 6, 8, 18, 36]) assert.equal(isPlausibleDecimals(ok), true, `${ok} should be ok`);
  for (const bad of [-1, 37, 100, 6.5, NaN, Infinity]) {
    assert.equal(isPlausibleDecimals(bad), false, `${bad} should be rejected`);
  }
});
