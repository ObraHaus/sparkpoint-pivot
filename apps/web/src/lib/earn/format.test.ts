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
  netSuppliedLine,
  oneTimeFeeLine,
  previewPrompt,
  protocolLabel,
  protocolOf,
  protocolsOf,
  railChips,
  receiptKindOf,
  receiptLabel,
  rheaApyLine,
  RHEA_APP_URL,
  snapshotAgeCopy,
  sourceAttribution,
  vaultAppUrl,
  vaultListTitle,
  vaultReceiptLabel,
  vaultRowTitle,
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


/* ── 071 — Rhea (Burrow) lending on NEAR ─────────────────────────────────────── */

function rheaVault(extra: Partial<EarnVault> = {}): EarnVault {
  return {
    chain: "near",
    chainId: 0,
    address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    version: "lending",
    name: "Rhea Lending USDC",
    symbol: "USDC",
    asset: {
      address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      symbol: "USDC",
      decimals: 6,
    },
    listed: true,
    tvlUsd: "12733763.455236751",
    netApy: "14.05",
    source: "rhea_rpc",
    fetchedAt: "2026-11-01T00:00:00+00:00",
    curatedDefault: false,
    protocol: "rhea",
    rails: {
      available: ["oneclick_rhea"],
      direct: {
        available: false,
        reason: "Rhea lending is on NEAR; the beta has no NEAR wallet.",
      },
      oneclickRhea: {
        available: true,
        liveness: "live",
        reason: null,
        note: "Supplies into your Rhea (Burrow) account on NEAR through NEAR Intents 1Click.",
        feeNote: "Includes 1Click's 0.25% keyless routing fee.",
        assetId:
          "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      },
      intentsConnect: {
        available: false,
        reason: "Intents Connect does not apply to Rhea supply.",
      },
    },
    ...extra,
  };
}

test("Rhea labels name the protocol, NEAR chain and lending row", () => {
  assert.equal(protocolOf({ protocol: "rhea" }), "rhea");
  assert.equal(protocolLabel("rhea"), "Rhea");
  assert.equal(chainLabel("near"), "NEAR");
  assert.deepEqual(protocolsOf([rheaVault()]), ["rhea"]);
  assert.equal(vaultListTitle([rheaVault()]), "Rhea vaults");
  assert.equal(apyLabel("rhea"), "net APY (Rhea)");
  assert.equal(vaultRowTitle(rheaVault()), "Rhea Lending (NEAR) supply");
  assert.equal(vaultRowTitle(vault()), "Gauntlet USDC Prime");
  assert.equal(
    snapshotAgeCopy(4, "persisted", "rhea"),
    "data from Rhea API, 4 min ago",
  );
});

test("Rhea rail chips name the Rhea rail and keep the others visible", () => {
  const chips = railChips(rheaVault());
  assert.deepEqual(
    chips.map((chip) => [chip.key, chip.label, chip.available]),
    [
      ["direct", "Direct", false],
      ["oneclick_rhea", "1Click Rhea live", true],
      ["intents_connect", "Intents Connect n/a", false],
    ],
  );

  const noLiquidity = railChips(
    rheaVault({
      rails: {
        ...rheaVault().rails,
        available: [],
        oneclickRhea: {
          available: false,
          liveness: "no_liquidity",
          reason: "1Click currently reports no liquidity for this Rhea asset.",
        },
      },
    }),
  );
  assert.equal(noLiquidity[1]?.label, "1Click Rhea no liquidity");
  assert.equal(noLiquidity[1]?.available, false);
});

test("Rhea preview copy is honest about the contract APY and the one-time fee", () => {
  assert.equal(
    sourceAttribution({
      kind: "contract",
      contract: "contract.main.burrow.near",
      method: "get_asset",
      field: "supply_apr",
      uiUrl: RHEA_APP_URL,
      fetchedAt: "2026-11-01T00:00:00+00:00",
      stale: false,
    }),
    "Rhea contract.main.burrow.near get_asset.supply_apr, fetched 2026-11-01T00:00:00+00:00",
  );
  assert.equal(
    oneTimeFeeLine({ amount: "0.30", symbol: "USDC", reason: "one-time Rhea account fee" }),
    "One-time Rhea account setup fee: 0.30 USDC (first deposit only)",
  );
  assert.equal(oneTimeFeeLine(undefined), null);
  assert.equal(netSuppliedLine("99.6808", "USDC"), "Net supplied ≈ 99.6808 USDC");
  assert.equal(netSuppliedLine(undefined, "USDC"), null);
  assert.equal(netSuppliedLine("", "USDC"), null);
  assert.equal(rheaApyLine("14.05%"), "Supply APY 14.05% (Rhea, variable)");
  assert.equal(rheaApyLine(undefined), null);

  assert.equal(vaultAppUrl(rheaVault()), RHEA_APP_URL);
  assert.equal(receiptKindOf(rheaVault()), null);
  assert.equal(vaultReceiptLabel(rheaVault()), null);
  assert.equal(previewPrompt(rheaVault()), "Deposit 100 USDC into Rhea on NEAR");
});
