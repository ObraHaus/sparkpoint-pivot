import test from "node:test";
import assert from "node:assert/strict";

import type { EarnVault } from "@sparkpoint/shared/schemas";

import {
  apyLabel,
  chainLabel,
  formatNetApy,
  formatTvl,
  isNativeShares,
  morphoChainSlug,
  morphoVaultUrl,
  needsSolanaRecipient,
  previewPrompt,
  protocolLabel,
  protocolOf,
  protocolsOf,
  railChips,
  receiptKindOf,
  receiptLabel,
  snapshotAgeCopy,
  vaultAppUrl,
  vaultListTitle,
  vaultReceiptLabel,
} from "./format.ts";

function vault(overrides: Partial<EarnVault["rails"]> = {}, extra: Partial<EarnVault> = {}): EarnVault {
  return {
    chain: "base",
    chainId: 8453,
    address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    version: "v1",
    name: "Gauntlet USDC Prime",
    symbol: "GTUSDC",
    asset: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
    listed: true,
    tvlUsd: "420000000",
    netApy: "4.41",
    source: "morpho_api",
    fetchedAt: "2026-11-01T00:00:00+00:00",
    curatedDefault: true,
    rails: {
      available: ["direct", "oneclick_earn"],
      direct: { available: true, reason: null, note: "native share" },
      oneclickEarn: {
        available: true,
        liveness: "live",
        receipt: {
          symbol: "gtUSDCp",
          assetId: "nep141:base-0x0bb6.omft.near",
          decimals: 18,
          chain: "base",
          wrapperAddress: "0x0bb6",
          underlyingVault: "0xee8f",
        },
        reason: null,
        note: "not the native Morpho vault share",
        feeNote: "Includes 1Click's 0.25% keyless routing fee.",
      },
      intentsConnect: {
        available: false,
        reason: "Aurora Intents Connect is not configured on this deployment (requires Aurora API access).",
      },
      ...overrides,
    },
    ...extra,
  };
}

test("TVL is compact, formatted and never invented", () => {
  assert.equal(formatTvl("420000000"), "$420M");
  assert.equal(formatTvl("562807654.11"), "$562.8M");
  assert.equal(formatTvl("1200000000"), "$1.2B");
  assert.equal(formatTvl("12345"), "$12.3K");
  assert.equal(formatTvl("42"), "$42");
  assert.equal(formatTvl(null), "—");
  assert.equal(formatTvl(undefined), "—");
  assert.equal(formatTvl("garbage"), "—");
});

test("net APY truncates to two decimals and shows an em dash when absent", () => {
  assert.equal(formatNetApy("4.41"), "4.41%");
  assert.equal(formatNetApy("5.983023393148187"), "5.98%");
  assert.equal(formatNetApy("5"), "5%");
  assert.equal(formatNetApy(null), "—");
  assert.equal(formatNetApy("n/a"), "—");
});

test("snapshot age attributes a fresh snapshot to Morpho and calls a fallback cached", () => {
  assert.equal(snapshotAgeCopy(12, "morpho_api"), "data from Morpho API, 12 min ago");
  assert.equal(snapshotAgeCopy(12, "persisted"), "data from Morpho API, 12 min ago");
  assert.equal(snapshotAgeCopy(12, "shipped"), "cached snapshot, 12 min old");
  assert.equal(snapshotAgeCopy(undefined, "persisted"), "cached snapshot");
});

test("rail chips always name all three rails honestly", () => {
  assert.deepEqual(
    railChips(vault()).map((chip) => chip.label),
    ["Direct", "1Click Earn live", "Intents Connect needs key"],
  );

  const noLiquidity = railChips(
    vault({
      available: ["direct"],
      oneclickEarn: { available: false, liveness: "no_liquidity", reason: "No liquidity" },
    }),
  );
  assert.equal(noLiquidity[1]?.label, "1Click Earn no liquidity");
  assert.equal(noLiquidity[1]?.available, false);

  const disabled = railChips(
    vault({
      intentsConnect: { available: false, reason: "Aurora Intents Connect is disabled in the earn config." },
    }),
  );
  assert.equal(disabled[2]?.label, "Intents Connect needs key");

  const available = railChips(
    vault({
      intentsConnect: {
        available: true,
        reason: null,
        steps: [
          {
            to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            functionSignature: "approve(address,uint256)",
            parameters: ["0xee8f", "{MIN_AMOUNT_OUT}"],
            value: "0",
            metadata: { kind: "approve" },
          },
        ],
      },
    }),
  );
  assert.equal(available[2]?.label, "Intents Connect");
});

test("the preview prompt names the amount, vault and chain", () => {
  assert.equal(
    previewPrompt(vault()),
    "Deposit 100 USDC into Morpho Gauntlet USDC Prime on Base",
  );
  assert.equal(chainLabel("eth"), "Ethereum");
});

test("Morpho links use the app's chain slug", () => {
  assert.equal(morphoChainSlug("eth"), "ethereum");
  assert.equal(morphoChainSlug("base"), "base");
  assert.equal(
    morphoVaultUrl(vault()),
    "https://app.morpho.org/base/vault/0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  );
  assert.equal(
    morphoVaultUrl({ chain: "eth", address: "0xBEEF" }),
    "https://app.morpho.org/ethereum/vault/0xBEEF",
  );
});


/* ── 070 — Kamino protocol + native-share labels ───────────────────────────── */

function kaminoVault(extra: Partial<EarnVault> = {}): EarnVault {
  return {
    chain: "sol",
    chainId: 0,
    address: "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
    version: "kvault",
    name: "SOL Balanced",
    symbol: "kV",
    asset: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
    listed: true,
    tvlUsd: "2443425.6",
    netApy: "4.45",
    source: "kamino_api",
    fetchedAt: "2026-11-01T00:00:00+00:00",
    curatedDefault: true,
    protocol: "kamino",
    rails: {
      available: ["oneclick_earn"],
      direct: {
        available: false,
        reason: "Direct Kamino deposits require a Solana wallet, which the beta does not support yet.",
        note: "The beta has no Solana wallet connection, so 1Click Earn is the only rail.",
      },
      oneclickEarn: {
        available: true,
        liveness: "live",
        receipt: {
          symbol: "kV-gtSOLb",
          assetId: "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near",
          decimals: 9,
          chain: "sol",
          wrapperAddress: "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
          underlyingVault: "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
          protocol: "kamino",
          receiptKind: "native_shares",
        },
        reason: null,
        note: "This route delivers the native Kamino kVault share token on Solana.",
        feeNote: "Includes 1Click's 0.25% keyless routing fee.",
      },
      intentsConnect: {
        available: false,
        reason: "Aurora Intents Connect is disabled in the earn config.",
      },
    },
    ...extra,
  };
}

test("protocol defaults to Morpho when the wire omits it, and Kamino stays explicit", () => {
  assert.equal(protocolOf({}), "morpho");
  assert.equal(protocolOf({ protocol: "kamino" }), "kamino");
  assert.equal(protocolLabel("morpho"), "Morpho");
  assert.equal(protocolLabel("kamino"), "Kamino");
  assert.deepEqual(protocolsOf([vault(), kaminoVault()]), ["morpho", "kamino"]);
  assert.equal(vaultListTitle([vault()]), "Morpho vaults");
  assert.equal(vaultListTitle([kaminoVault()]), "Kamino vaults");
  assert.equal(vaultListTitle([vault(), kaminoVault()]), "Earn vaults");
  assert.equal(vaultListTitle([]), "Earn vaults");
  assert.equal(apyLabel("kamino"), "net APY (Kamino)");
  assert.equal(chainLabel("sol"), "Solana");
});

test("receipt labels say native shares for Kamino and wrapper for Morpho", () => {
  assert.equal(receiptKindOf(vault()), "wrapper");
  assert.equal(receiptLabel("wrapper"), "1Click receipt (wrapper)");
  assert.equal(vaultReceiptLabel(vault()), "1Click receipt (wrapper)");

  assert.equal(receiptKindOf(kaminoVault()), "native_shares");
  assert.equal(receiptLabel("native_shares"), "native vault shares");
  assert.equal(vaultReceiptLabel(kaminoVault()), "native vault shares");

  const noReceipt = vault({
    oneclickEarn: { available: false, reason: "No 1Click receipt is configured for this vault." },
  });
  assert.equal(receiptKindOf(noReceipt), null);
  assert.equal(vaultReceiptLabel(noReceipt), null);
});

test("Kamino previews are native shares and need a pasted Solana recipient", () => {
  const block = {
    rail: "oneclick_earn" as const,
    vault: kaminoVault(),
    receiptKind: "native_shares" as const,
  };
  assert.equal(isNativeShares(block), true);
  assert.equal(isNativeShares({ rail: "oneclick_earn", vault: kaminoVault() }), true);
  assert.equal(isNativeShares({ rail: "oneclick_earn", vault: vault() }), false);

  assert.equal(
    needsSolanaRecipient({ walletSupport: { recipient: "paste_solana_address", deposit: "evm_wallet" } }),
    true,
  );
  assert.equal(needsSolanaRecipient({}), false);
});

test("Kamino snapshot copy names Kamino, a mixed list stays neutral, and no link is guessed", () => {
  assert.equal(snapshotAgeCopy(3, "persisted", "kamino"), "data from Kamino API, 3 min ago");
  assert.equal(snapshotAgeCopy(3, "persisted", "morpho"), "data from Morpho API, 3 min ago");
  assert.equal(snapshotAgeCopy(3, "persisted", null), "data from vault API, 3 min ago");
  assert.equal(snapshotAgeCopy(3, "shipped", "kamino"), "cached snapshot, 3 min old");

  assert.equal(vaultAppUrl(kaminoVault()), null);
  assert.equal(
    vaultAppUrl(vault()),
    "https://app.morpho.org/base/vault/0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  );
  assert.equal(
    previewPrompt(kaminoVault()),
    "Deposit 100 SOL into Kamino SOL Balanced on Solana",
  );
});
