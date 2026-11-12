import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  VAULT_FLOW_NEXT_STEP,
  hasCompleteFlowCopy,
  kaminoFlowRows,
  morphoFlowRows,
  rheaFlowRows,
  vaultFlowCopy,
  vaultFlowDisclaimer,
  vaultFlowSubtitle,
  vaultFlowTitle,
} from "./vaultFlow.ts";
import { resolveRheaAccount } from "./vaultList.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the shared copy matches the Morpho reference layout", () => {
  const deposit = vaultFlowCopy({
    mode: "deposit",
    assetSymbol: "USDC",
    vaultName: "Steakhouse USDC",
    netApy: "4.82%",
    apySource: "Morpho",
  });
  assert.equal(deposit.title, "Deposit USDC");
  assert.equal(deposit.subtitle, "Into Steakhouse USDC · net APY 4.82% (Morpho)");
  assert.equal(deposit.amountLabel, "Amount to deposit");
  assert.equal(deposit.primaryLabel, "Review deposit");
  assert.equal(deposit.nextStep, "Next: live quote + on-chain preview, then you sign.");
  assert.equal(hasCompleteFlowCopy(deposit), true);

  const withdraw = vaultFlowCopy({
    mode: "withdraw",
    assetSymbol: "USDC",
    vaultName: "Rhea Lending (NEAR)",
  });
  assert.equal(withdraw.title, "Withdraw USDC");
  assert.equal(withdraw.amountLabel, "Amount to withdraw");
  assert.equal(withdraw.primaryLabel, "Review withdrawal");
  assert.match(withdraw.subtitle, /^Into Rhea Lending \(NEAR\)/);
  assert.equal(withdraw.nextStep, VAULT_FLOW_NEXT_STEP);

  // Never invent an APY: absent means protocol-accurate copy, not "0%".
  assert.doesNotMatch(withdraw.subtitle, /0(?:\.0+)?%/);
  assert.equal(vaultFlowTitle("deposit", "USDG"), "Deposit USDG");
  assert.equal(vaultFlowDisclaimer("withdraw"), "No fees to exit. Nothing moves until you sign.");
  assert.match(vaultFlowSubtitle({ mode: "deposit", vaultName: "V", netApy: "3.10%" }), /3\.10%/);
});

test("Rhea rows keep the MCA read and the NEAR-only signer requirement", () => {
  const mca = rheaFlowRows({
    mode: "deposit",
    receive: "25 USDC supplied",
    netApy: null,
    account: "rhea-mca.near",
    canSign: false,
    accountSource: "mca",
  });
  const byKey = Object.fromEntries(mca.map((row) => [row.key, row]));
  assert.equal(byKey.receive?.label, "You'll supply ≈");
  assert.equal(byKey.source?.value, "Rhea MCA (linked EVM wallet)");
  assert.equal(byKey.source?.tone, "caution");
  assert.equal(byKey.signer?.value, "NEAR wallet required to sign");
  assert.equal(byKey.signer?.tone, "caution");
  // No fabricated APY: the row says where it comes from instead.
  assert.equal(byKey.apy?.value, "shown by Rhea");

  const near = rheaFlowRows({
    mode: "withdraw",
    receive: "10 USDC",
    account: "alice.near",
    canSign: true,
    accountSource: "near",
  });
  const nearSigner = near.find((row) => row.key === "signer");
  assert.equal(nearSigner?.value, "NEAR wallet (connected)");
  assert.equal(nearSigner?.tone, "gain");

  // The account resolution used by the page: an EVM-only session still reads the MCA.
  assert.deepEqual(resolveRheaAccount(null, "rhea-mca.near"), {
    account: "rhea-mca.near",
    source: "mca",
    canSign: false,
  });
  assert.equal(resolveRheaAccount("alice.near", "rhea-mca.near").canSign, true);
});

test("Kamino rows keep the crank-fee buffer and vault minimums in the shared summary style", () => {
  const rows = kaminoFlowRows({
    mode: "deposit",
    receive: "≈ 25.01 shares",
    netApy: "4.10%",
    minDeposit: "0.001 SOL",
    minWithdraw: "0.001 shares",
    assetSymbol: "SOL",
    crankNote: "Minimum deposit includes a small network fee buffer",
  });
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.equal(byKey.min?.label, "Min deposit (vault)");
  assert.equal(byKey.min?.value, "0.001 SOL");
  assert.equal(byKey.crank?.value, "Minimum deposit includes a small network fee buffer");
  assert.equal(byKey.apy?.value, "4.10%");
  assert.equal(byKey.network?.value, "Solana");
});

test("Morpho rows carry the ERC-4626 limits and the zero SparkPoint fee", () => {
  const rows = morphoFlowRows({
    mode: "deposit",
    receive: "≈ 24.9 gtUSDCp shares",
    netApy: null,
    maxDeposit: "1,000,000 USDC",
    maxRedeem: null,
    assetSymbol: "USDC",
  });
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.equal(byKey.limits?.value, "1,000,000 USDC");
  assert.equal(byKey.fee?.tone, "gain");
  assert.equal(byKey.apy?.value, "set by the vault curator");
  assert.equal(byKey.network?.value, "Base · USDC");
});

test("every deposit/withdraw container renders the shared layout pieces (no second implementation)", () => {
  const shared = ["VaultFlowPage", "AmountField", "SummaryBox", "FlowDisclaimer", "FlowPrimary", "FlowNextStep"];
  const containers = [
    source("../../components/vault/RheaLiveEarn.tsx"),
    source("../../components/vault/KaminoLiveFlow.tsx"),
    source("../../components/vault/MorphoLiveFlow.tsx"),
    source("../../app/(app)/vault/_amount-screen.tsx"),
  ];
  for (const file of containers) {
    assert.match(file, /from "@\/components\/vault\/VaultFlow"/);
    for (const piece of shared) {
      assert.match(file, new RegExp(`\\b${piece}\\b`), `missing shared piece ${piece}`);
    }
  }

  // The shared file is the only place these primitives are defined.
  const layout = source("../../components/vault/VaultFlow.tsx");
  for (const piece of shared) {
    assert.match(layout, new RegExp(`export function ${piece}\\b`));
  }

  // Rhea's balance + Max still come from the MCA-aware account read, never an EVM signer.
  const rhea = source("../../components/vault/RheaLiveEarn.tsx");
  assert.match(rhea, /useRheaAccount\(nearAccountId\)/);
  assert.match(rhea, /availableAmount/);
  assert.match(rhea, /onMax=/);
  assert.match(rhea, /EVM wallet cannot sign this Rhea deposit or withdraw/);
});

test("every /vault card renders the shared Sparkline and a range/collecting-history line", () => {
  const board = source("../../components/vault/CuratedBoard.tsx");
  assert.match(board, /cardSparkline\(/);
  assert.match(board, /earnApyBps\(/);
  // Curated cards (Galaxy), the feature card and the earn-registry cards all use one component.
  assert.match(board, /<Sparkline points=\{chart\.points\} flatBps=\{chart\.flatBps\} \/>/);
  assert.match(board, /<Sparkline points=\{chart\.points\} flatBps=\{chart\.flatBps\} big \/>/);
  assert.match(board, /data-testid="vault-card-range"/);
  assert.match(board, /data-testid="earn-vault-range"/);
  // Earn cards read the same stored history when a curated row exists for the same vault.
  assert.match(board, /apyHistoryByVault\.get/);
});

test("Kamino's amount field always offers Max once a Solana wallet is connected", () => {
  const kamino = source("../../components/vault/KaminoLiveFlow.tsx");
  // The button is not conditional on the balance read finishing — it shows (disabled until then)
  // exactly like Rhea/Morpho, and uses the reserve-aware `maxAmount` computation.
  assert.match(kamino, /onMax=\{\s*wallet/);
  assert.match(kamino, /maxDisabled=\{!maxAmount\}/);
  assert.match(kamino, /maxSolDepositLamports|maxAmount/);
});

test("the vault board renders every filtered card and known chips from first paint", () => {
  const board = source("../../components/vault/CuratedBoard.tsx");
  // No lazy batch may hide cards: the rendered list IS the filtered list.
  assert.match(board, /const visible = list;/);
  assert.match(
    board,
    /mergeFilterValues\(collectFilterValues\(allItems, "chain"\), KNOWN_CHAINS\)/,
  );
  assert.match(
    board,
    /mergeFilterValues\(collectFilterValues\(allItems, "protocol"\), KNOWN_PROTOCOLS\)/,
  );
  assert.doesNotMatch(board, /Scroll for more vaults/);
});

test("the swap tab choice wins over the NEAR-only cross-chain default", () => {
  const swap = source("../../app/(app)/swap/page.tsx");
  assert.match(swap, /useState<SwapMode \| null>\(null\)/);
  assert.match(swap, /requestedMode \?\? \(nearOnly \? "cross-chain" : "same-chain"\)/);
});

test("the Rhea balance read is bounded by a timeout so it cannot read forever", () => {
  const rhea = source("../../components/vault/RheaLiveEarn.tsx");
  assert.match(rhea, /new AbortController\(\)/);
  assert.match(rhea, /controller\.abort\(\)/);
  assert.match(rhea, /Balance unavailable/);
});
