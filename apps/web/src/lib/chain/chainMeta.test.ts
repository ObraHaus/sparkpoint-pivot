import { test } from "node:test";
import assert from "node:assert/strict";
// VALUE import of @sparkpoint/shared, which the other shared barrels cannot support under
// `node --experimental-strip-types` (extensionless relative specifiers + a TS `enum`). This import
// working IS the assertion that `packages/shared/src/chains/` stayed a leaf: no relative imports,
// no enums, no viem/wagmi. If someone adds an import there, this test file fails to load.
import {
  ALL_CHAIN_IDS,
  CHAIN_IDS,
  CHAIN_META,
  PREFERRED_CHAIN_ID,
  SWITCHABLE_CHAINS,
  chainMeta,
  chainName,
  explorerAddressUrl,
  explorerTxUrl,
  isSupportedChain,
  isTestnetChain,
  offersVault,
} from "@sparkpoint/shared/chains";

test("the shared chain registry is value-importable from a strip-types test (leaf invariant)", () => {
  assert.equal(typeof CHAIN_META, "object");
  assert.equal(CHAIN_IDS.baseSepolia, 84532);
});

test("chain ids are the ones the app is built around", () => {
  assert.deepEqual(
    { ...CHAIN_IDS },
    {
      base: 8453,
      baseSepolia: 84532,
      localFork: 31337,
      robinhoodTestnet: 46630,
      robinhoodMainnet: 4663,
    },
  );
  assert.deepEqual([...ALL_CHAIN_IDS], [4663, 8453, 31337, 46630, 84532]);
});

test("every declared id has metadata, and metadata agrees with its own key", () => {
  for (const id of ALL_CHAIN_IDS) {
    const meta = chainMeta(id);
    assert.ok(meta, `no metadata for chain ${id}`);
    assert.equal(meta.chainId, id, "a row's chainId must match the key it is filed under");
    assert.ok(meta.name.length > 0);
    assert.ok(meta.slug.length > 0);
  }
});

test("an unknown chain degrades honestly and never borrows another chain's identity", () => {
  assert.equal(chainMeta(999999), undefined);
  assert.equal(chainName(999999), "Unsupported network");
  assert.equal(chainName(undefined), "Unsupported network");
  assert.equal(isSupportedChain(999999), false);
  // NOT assumed to be a testnet, and NOT assumed to offer a vault.
  assert.equal(isTestnetChain(999999), false);
  assert.equal(offersVault(999999), false);
});

test("explorer URLs are built from one map, and are undefined rather than fabricated", () => {
  assert.equal(
    explorerTxUrl(84532, "0xabc"),
    "https://sepolia.basescan.org/tx/0xabc",
  );
  assert.equal(explorerAddressUrl(8453, "0xdef"), "https://basescan.org/address/0xdef");
  // The local fork has no public explorer — a caller must render a non-link.
  assert.equal(explorerTxUrl(31337, "0xabc"), undefined);
  assert.equal(explorerAddressUrl(31337, "0xabc"), undefined);
  // Unknown chain, and missing hash/address.
  assert.equal(explorerTxUrl(999999, "0xabc"), undefined);
  assert.equal(explorerTxUrl(84532, undefined), undefined);
  assert.equal(explorerAddressUrl(84532, undefined), undefined);
});

test("no explorer root carries a trailing slash (it would double up in every built URL)", () => {
  for (const id of ALL_CHAIN_IDS) {
    const root = chainMeta(id)?.explorerRoot;
    if (root !== undefined) assert.ok(!root.endsWith("/"), `${id} explorerRoot has a trailing slash`);
  }
});

// ── the honesty flags, which are capability claims and not aspirations ────────

test("Robinhood testnet 46630 offers NO vault — it has no Morpho deployment at all", () => {
  // v3.0.0 / D3: 46630 stays swap-only with the vault path fail-closed, and must never be given a
  // mock substitute. A `true` here would be a fabricated capability.
  assert.equal(offersVault(46630), false);
  assert.equal(isTestnetChain(46630), true);
});

test("neither mainnet offers a vault yet — both are gated on the external audit", () => {
  assert.equal(offersVault(8453), false);
  assert.equal(offersVault(4663), false);
  assert.equal(isTestnetChain(8453), false);
  assert.equal(isTestnetChain(4663), false);
});

test("Base Sepolia is the vault chain and the preferred switch target", () => {
  assert.equal(offersVault(84532), true);
  assert.equal(PREFERRED_CHAIN_ID, 84532);
  assert.equal(isTestnetChain(84532), true);
});

test("the switcher offers exactly the chains marked switchable", () => {
  assert.deepEqual(
    SWITCHABLE_CHAINS.map((c) => c.chainId).sort((a, b) => a - b),
    [46630, 84532],
  );
  // A chain the switcher offers must be one we support at all.
  for (const c of SWITCHABLE_CHAINS) assert.ok(isSupportedChain(c.chainId));
});

test("a chain that offers a vault must have an explorer, or a user cannot verify their tx", () => {
  for (const id of ALL_CHAIN_IDS) {
    const meta = chainMeta(id);
    if (meta?.offersVault && id !== 31337) {
      assert.ok(meta.explorerRoot, `chain ${id} offers a vault but has no explorer`);
    }
  }
});
