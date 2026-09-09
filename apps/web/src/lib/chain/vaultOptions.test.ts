import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVaultOptions,
  resolveSelectedVault,
  toWrapperPositionInput,
  LAUNCH_VAULT_OPTION,
  type VaultOption,
} from "./vaultOptions.ts";

// ── fixtures ──────────────────────────────────────────────────────────────────
const WRAPPER = "0xff0a43FA397a90c1277C96A783e1171e1efbE9BB" as const;
const MORPHO = "0x7f377fe96DaD2eEa494F0fb095233EF4aB438420" as const;
const wrapper = {
  address: WRAPPER,
  label: "SparkPoint Morpho USDC",
  symbol: "spMORPHO",
  morphoVault: MORPHO,
} as const;

// ── buildVaultOptions ───────────────────────────────────────────────────────────
test("buildVaultOptions: launch is always index 0", () => {
  const opts = buildVaultOptions({ wrappers: [wrapper] });
  assert.equal(opts[0].kind, "aave_launch");
  assert.equal(opts[0].vaultAddress, undefined);
  assert.equal(opts[0].label, "Aave Yield Vault");
});

test("buildVaultOptions: no wrappers ⇒ launch-only (byte-identical to today)", () => {
  const opts = buildVaultOptions({});
  assert.equal(opts.length, 1);
  assert.deepEqual(opts[0], LAUNCH_VAULT_OPTION);
});

test("buildVaultOptions: a wrapper maps to a morpho_wrapper option", () => {
  const opts = buildVaultOptions({ wrappers: [wrapper] });
  assert.equal(opts.length, 2);
  const w = opts[1];
  assert.equal(w.vaultAddress, WRAPPER);
  assert.equal(w.kind, "morpho_wrapper");
  assert.equal(w.label, "SparkPoint Morpho USDC");
  assert.equal(w.symbol, "spMORPHO");
  assert.equal(w.morphoVault, MORPHO);
});

// ── resolveSelectedVault ────────────────────────────────────────────────────────
test("resolveSelectedVault: absent/unknown/launch ⇒ the launch option (default byte-identical)", () => {
  const opts = buildVaultOptions({ wrappers: [wrapper] });
  assert.equal(resolveSelectedVault(opts, null).kind, "aave_launch");
  assert.equal(resolveSelectedVault(opts, undefined).kind, "aave_launch");
  assert.equal(resolveSelectedVault(opts, "launch").kind, "aave_launch");
  assert.equal(resolveSelectedVault(opts, "0xdeadbeef").kind, "aave_launch");
});

test("resolveSelectedVault: a wrapper address (mixed case) ⇒ that wrapper", () => {
  const opts = buildVaultOptions({ wrappers: [wrapper] });
  const sel = resolveSelectedVault(opts, WRAPPER.toLowerCase());
  assert.equal(sel.kind, "morpho_wrapper");
  assert.equal(sel.vaultAddress, WRAPPER);
  // and the exact checksum casing resolves too
  assert.equal(resolveSelectedVault(opts, WRAPPER).vaultAddress, WRAPPER);
});

// ── toWrapperPositionInput ──────────────────────────────────────────────────────
test("toWrapperPositionInput: 0 / undefined shares ⇒ null (no row for launch-only users)", () => {
  assert.equal(toWrapperPositionInput(wrapper, { shares: 0n }), null);
  assert.equal(toWrapperPositionInput(wrapper, { shares: undefined }), null);
  assert.equal(toWrapperPositionInput(wrapper, {}), null);
});

test("toWrapperPositionInput: shares > 0 ⇒ a WrapperPositionInput row", () => {
  const row = toWrapperPositionInput(wrapper, {
    underlying: 25_000_000n,
    shares: 25_000_000n,
    decimals: 6,
    assetIsUsdc: true,
  });
  assert.notEqual(row, null);
  assert.equal(row!.vaultAddress, WRAPPER);
  assert.equal(row!.label, "SparkPoint Morpho USDC");
  assert.equal(row!.underlying, 25_000_000n);
  assert.equal(row!.shares, 25_000_000n);
  assert.equal(row!.decimals, 6);
  assert.equal(row!.usdPriced, true);
});

test("toWrapperPositionInput: assetIsUsdc false ⇒ still a row, usdPriced false (excluded from USD total)", () => {
  const row = toWrapperPositionInput(wrapper, { shares: 1n, assetIsUsdc: false });
  assert.notEqual(row, null);
  assert.equal(row!.usdPriced, false);
});

test("toWrapperPositionInput: assetIsUsdc omitted ⇒ defaults usdPriced true", () => {
  const row = toWrapperPositionInput(wrapper, { shares: 1n });
  assert.equal(row!.usdPriced, true);
});

// avoid unused-type-import lint in strict configs
export type _Opt = VaultOption;

// ── 024: retirement flows through, and a retired address still RESOLVES ────────
test("buildVaultOptions: retired + retiredReason pass through to the option", () => {
  const opts = buildVaultOptions({
    wrappers: [{ ...wrapper, retired: true, retiredReason: "mock underlying" }],
  });
  assert.equal(opts[1].retired, true);
  assert.equal(opts[1].retiredReason, "mock underlying");
});

test("buildVaultOptions: a non-retired wrapper leaves retired undefined (no behaviour change)", () => {
  const opts = buildVaultOptions({ wrappers: [wrapper] });
  assert.equal(opts[1].retired, undefined);
});

// This is the reason a retired wrapper stays IN the options list: dropping it would make a holder
// deep-linking to ?vault=<retired> silently land on the launch vault — a wrong-vault fallback that is
// worse than plainly showing it as retired.
test("resolveSelectedVault: a RETIRED wrapper still resolves, never silently falls back to launch", () => {
  const opts = buildVaultOptions({ wrappers: [{ ...wrapper, retired: true }] });
  const sel = resolveSelectedVault(opts, WRAPPER);
  assert.equal(sel.vaultAddress, WRAPPER);
  assert.equal(sel.retired, true);
  assert.notEqual(sel.kind, "aave_launch");
});
