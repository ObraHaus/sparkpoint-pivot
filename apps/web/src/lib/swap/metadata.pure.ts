/**
 * Pure, dependency-free token-metadata helpers (universal swap, feature 007).
 *
 * Split out from metadata.ts so they can be unit-tested under `node --experimental-strip-types` without
 * pulling the `@/…` path alias or viem. These carry the SAFETY-critical string handling: an attacker
 * controls a custom token's `symbol()`/`name()`, so everything shown to the user is sanitized here first,
 * and trust decisions are made on the ADDRESS elsewhere (never on these strings).
 */

/** Max characters kept for a displayed symbol/name (defeat over-long strings that break the trust UI). */
export const MAX_META_LEN = 40;
/** Reject absurd decimals; 0 is legal-but-unusual and allowed. ERC-20 `decimals` is a uint8 anyway. */
export const MAX_DECIMALS = 36;

/** Zero-width space, ZWNJ, ZWJ, word-joiner, and BOM — code points stripped before display/compare. */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/** True for a C0/C1 control code point (also stripped). */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Strip control + zero-width characters, NFKC-normalize, collapse whitespace, trim, and cap length.
 * Purely a DISPLAY sanitizer — trust decisions key off the ADDRESS (see tokenList), never this string, so
 * a homoglyph symbol can mislead the eye but cannot defeat the verified-token check. Built from numeric
 * code points (no literal invisible characters) so the filter is exact and reviewable.
 */
export function sanitizeMetaString(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw.normalize("NFKC")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp) || ZERO_WIDTH.has(cp)) continue;
    out += ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_META_LEN ? out.slice(0, MAX_META_LEN) : out;
}

/** A short `0x1234…abcd` label — the honest last-resort name when symbol + name are both unreadable. */
export function shortAddressLabel(address: string): string {
  return address.length >= 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** decimals must be a non-negative integer within a sane bound (rejects garbage / non-ERC-20 returns). */
export function isPlausibleDecimals(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_DECIMALS;
}
