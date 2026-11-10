import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ChatBlockSchema } from "../src/schemas/chat-block.ts";

/**
 * 069 — the SHARED earn contract fixture. The same JSON files are asserted against the Python
 * `EarnVaultsBlock.to_wire()` / `EarnQuoteBlock.to_wire()` in
 * `services/agent/tests/earn/test_chat_block_fixtures.py`, so the two implementations cannot drift.
 */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/earn/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

test("earn_vaults ready fixture validates against ChatBlockSchema", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-vaults-list.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_vaults") return;
  assert.equal(parsed.data.state, "ready");
  assert.equal(parsed.data.vaults.length, 4);
  assert.equal(parsed.data.snapshotAgeMinutes, 12);
  assert.equal(parsed.data.snapshotSource, "persisted");

  const [gauntlet, moonwell, spark, mystery] = parsed.data.vaults;
  assert.equal(gauntlet?.name, "Gauntlet USDC Prime");
  assert.equal(gauntlet?.chain, "base");
  assert.equal(gauntlet?.asset.symbol, "USDC");
  assert.equal(gauntlet?.tvlUsd, "420000000");
  assert.equal(gauntlet?.netApy, "4.41");
  assert.equal(gauntlet?.curatedDefault, true);
  assert.deepEqual(gauntlet?.rails.available, ["direct", "oneclick_earn"]);
  assert.equal(gauntlet?.rails.oneclickEarn.liveness, "live");
  assert.equal(gauntlet?.rails.oneclickEarn.receipt?.symbol, "gtUSDCp");
  assert.equal(gauntlet?.rails.intentsConnect.available, false);
  assert.match(gauntlet?.rails.intentsConnect.reason ?? "", /disabled/);

  assert.equal(moonwell?.rails.oneclickEarn.available, false);
  assert.equal(moonwell?.rails.oneclickEarn.liveness, "no_liquidity");
  assert.equal(spark?.rails.oneclickEarn.liveness, "unknown");
  assert.equal(mystery?.tvlUsd, null);
  assert.equal(mystery?.netApy, null);
});

test("earn_vaults unavailable fixture is an honest empty list", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-vaults-unavailable.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_vaults") return;
  assert.equal(parsed.data.state, "unavailable");
  assert.deepEqual(parsed.data.vaults, []);
  assert.equal(parsed.data.unavailableReason, "no snapshot");
});

test("earn_quote one-click preview fixture validates with receipt and fee notes", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-preview-oneclick.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "preview");
  assert.equal(parsed.data.rail, "oneclick_earn");
  assert.equal(parsed.data.origin?.key, "eth:USDC");
  assert.equal(parsed.data.origin?.evmChainId, 1);
  assert.equal(parsed.data.amountIn, "100");
  assert.equal(parsed.data.amountOut, "89.146629");
  assert.equal(parsed.data.amountOutUsd, "99.55");
  assert.equal(parsed.data.timeEstimateSec, 52);
  assert.match(parsed.data.feeNote ?? "", /0\.25%/);
  assert.match(parsed.data.receiptNote ?? "", /not the native Morpho vault share/);
  assert.equal(parsed.data.unavailableReason, undefined);
  assert.equal(parsed.data.steps, undefined);
});

test("earn_quote direct fixture carries the native-share note and no amountOut", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-direct.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.rail, "direct");
  assert.equal(parsed.data.origin?.key, "base:USDC");
  assert.equal(parsed.data.amountIn, "100");
  assert.equal(parsed.data.amountOut, undefined);
  assert.match(parsed.data.receiptNote ?? "", /native Morpho vault share/);
});

test("earn_quote unavailable fixture states the reason and carries no numbers", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-unavailable.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "unavailable");
  assert.equal(parsed.data.unavailableReason, "No liquidity available");
  assert.equal(parsed.data.amountOut, undefined);
  assert.equal(parsed.data.origin, undefined);
});

test("earn blocks are strict: unknown fields and bad enums are rejected", () => {
  const list = fixture("earn-vaults-list.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...list, unexpected: true }).success, false);

  const quote = fixture("earn-quote-preview-oneclick.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...quote, rail: "flying" }).success, false);
  assert.equal(ChatBlockSchema.safeParse({ ...quote, amountOut: 89.146629 }).success, false);

  const vault = (list.vaults as Record<string, unknown>[])[0] as Record<string, unknown>;
  assert.equal(
    ChatBlockSchema.safeParse({ ...list, vaults: [{ ...vault, netApy: undefined }] }).success,
    false,
    "netApy is required-but-nullable",
  );
});

/* ── 070 — Kamino SOL vaults + native-share previews ───────────────────────── */

test("earn_vaults Kamino fixture validates with protocol, Solana and native-share receipt", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-vaults-kamino.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_vaults") return;
  assert.equal(parsed.data.state, "ready");
  assert.equal(parsed.data.vaults.length, 1);
  assert.match(parsed.data.note ?? "", /Kamino/);

  const [vault] = parsed.data.vaults;
  assert.equal(vault?.name, "SOL Balanced");
  assert.equal(vault?.protocol, "kamino");
  assert.equal(vault?.chain, "sol");
  assert.equal(vault?.chainId, 0);
  assert.equal(vault?.version, "kvault");
  assert.equal(vault?.asset.symbol, "SOL");
  assert.deepEqual(vault?.rails.available, ["oneclick_earn"]);
  assert.equal(vault?.rails.direct.available, false);
  assert.match(vault?.rails.direct.reason ?? "", /Solana wallet/);
  assert.equal(vault?.rails.oneclickEarn.receipt?.symbol, "kV-gtSOLb");
  assert.equal(vault?.rails.oneclickEarn.receipt?.protocol, "kamino");
  assert.equal(vault?.rails.oneclickEarn.receipt?.receiptKind, "native_shares");
  assert.match(vault?.rails.oneclickEarn.note ?? "", /native Kamino kVault share/);
});

test("earn_quote Kamino preview carries receiptKind, walletSupport and a Solana recipient", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-kamino-preview.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "preview");
  assert.equal(parsed.data.rail, "oneclick_earn");
  assert.equal(parsed.data.receiptKind, "native_shares");
  assert.deepEqual(parsed.data.walletSupport, {
    recipient: "paste_solana_address",
    deposit: "evm_wallet",
  });
  assert.equal(parsed.data.origin?.key, "base:USDC");
  assert.equal(parsed.data.amountOut, "0.9835");
  assert.equal(parsed.data.amountOutUsd, "99.2");
  assert.equal(parsed.data.timeEstimateSec, 47);
  assert.match(parsed.data.feeNote ?? "", /0\.25%/);
  assert.match(parsed.data.receiptNote ?? "", /native Kamino kVault share/);
  assert.equal(parsed.data.vault.protocol, "kamino");
});

test("earn_quote Kamino SOL-origin preview uses the copy-address deposit path", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-kamino-preview-sol-origin.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.origin?.key, "sol:USDC");
  assert.equal(parsed.data.origin?.evmChainId, null);
  assert.equal(parsed.data.walletSupport?.deposit, "copy_address");
  assert.equal(parsed.data.walletSupport?.recipient, "paste_solana_address");
});

test("earn_quote Kamino unavailable fixture keeps the honest no-liquidity answer", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-kamino-unavailable.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "unavailable");
  assert.equal(parsed.data.unavailableReason, "No liquidity available");
  assert.equal(parsed.data.amountOut, undefined);
  assert.equal(parsed.data.walletSupport, undefined);
  assert.equal(parsed.data.vault.protocol, "kamino");
});

test("070 additions are strict: an unknown walletSupport mode is rejected", () => {
  const quote = fixture("earn-quote-kamino-preview.json") as Record<string, unknown>;
  assert.equal(
    ChatBlockSchema.safeParse({
      ...quote,
      walletSupport: { recipient: "paste_solana_address", deposit: "bank_transfer" },
    }).success,
    false,
  );
  assert.equal(
    ChatBlockSchema.safeParse({
      ...quote,
      walletSupport: { recipient: "use_evm_wallet", deposit: "evm_wallet" },
    }).success,
    false,
  );

  const list = fixture("earn-vaults-kamino.json") as Record<string, unknown>;
  const vault = (list.vaults as Record<string, unknown>[])[0] as Record<string, unknown>;
  assert.equal(
    ChatBlockSchema.safeParse({ ...list, vaults: [{ ...vault, protocol: "aave" }] }).success,
    false,
  );
});

/* ── 071 — Rhea (Burrow) lending on NEAR ─────────────────────────────────────── */

test("earn_vaults Rhea fixture validates with the near chain and the Rhea rail", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-vaults-rhea.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_vaults") return;
  assert.equal(parsed.data.state, "ready");
  assert.equal(parsed.data.vaults.length, 1);
  assert.match(parsed.data.note ?? "", /Rhea \(Burrow\)/);

  const [vault] = parsed.data.vaults;
  assert.equal(vault?.name, "Rhea Lending USDC");
  assert.equal(vault?.protocol, "rhea");
  assert.equal(vault?.chain, "near");
  assert.equal(vault?.chainId, 0);
  assert.equal(vault?.version, "lending");
  assert.equal(vault?.asset.symbol, "USDC");
  assert.equal(vault?.netApy, "14.05");
  assert.equal(vault?.source, "rhea_rpc");
  assert.deepEqual(vault?.rails.available, ["oneclick_rhea"]);
  assert.equal(vault?.rails.oneclickEarn, undefined);
  assert.equal(vault?.rails.direct.note, undefined);
  assert.match(vault?.rails.direct.reason ?? "", /NEAR wallet/);
  assert.equal(vault?.rails.oneclickRhea?.available, true);
  assert.equal(vault?.rails.oneclickRhea?.liveness, "live");
  assert.match(vault?.rails.oneclickRhea?.assetId ?? "", /^nep141:/);
  assert.match(vault?.rails.oneclickRhea?.feeNote ?? "", /one-time 0\.60 USDC.*DApp registration/);
  assert.equal(vault?.rails.intentsConnect.available, false);
});

test("earn_quote Rhea first deposit carries the fee, net supplied and message to sign", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-rhea-first-deposit.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "preview");
  assert.equal(parsed.data.rail, "oneclick_rhea");
  assert.equal(parsed.data.protocol, "rhea");
  assert.equal(parsed.data.firstDeposit, true);
  assert.equal(parsed.data.mca, null);
  assert.equal(parsed.data.recipient, "multica.near");
  assert.equal(parsed.data.amountOut, "99.9808");
  assert.equal(parsed.data.oneTimeFee?.amount, "0.60");
  assert.equal(parsed.data.oneTimeFee?.symbol, "USDC");
  assert.match(parsed.data.oneTimeFee?.reason ?? "", /DApp registration/);
  assert.equal(parsed.data.netSupplied, "99.3808");
  assert.match(parsed.data.customRecipientMsg ?? "", /BurrowRegisterAndSupply/);
  assert.match(parsed.data.messageToSign ?? "", /^\[\{"EVM"/);
  assert.equal(parsed.data.supplyApy, "14.05%");
  assert.equal(parsed.data.source?.kind, "contract");
  assert.equal(parsed.data.source?.contract, "contract.main.burrow.near");
  assert.equal(parsed.data.source?.method, "get_asset");
  assert.equal(parsed.data.source?.field, "supply_apr");
  assert.equal(parsed.data.source?.uiUrl, "https://app.rhea.finance/lending");
  assert.equal(parsed.data.source?.stale, false);
  assert.equal(parsed.data.withdraw?.kind, "external_link");
  assert.equal(parsed.data.withdraw?.url, "https://app.rhea.finance/lending");
});

test("earn_quote Rhea existing-MCA supply omits the fee and message", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-rhea-supply.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.firstDeposit, false);
  assert.equal(parsed.data.mca, "abc.multica.near");
  assert.equal(parsed.data.recipient, "abc.multica.near");
  assert.equal(parsed.data.oneTimeFee, undefined);
  assert.equal(parsed.data.messageToSign, undefined);
  assert.equal(parsed.data.netSupplied, "99.9808");
  assert.match(parsed.data.customRecipientMsg ?? "", /BurrowSupply/);
  assert.doesNotMatch(parsed.data.customRecipientMsg ?? "", /RegisterAndSupply/);
});

test("earn_quote Rhea unavailable keeps the smaller-amount hint", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-quote-rhea-unavailable.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_quote") return;
  assert.equal(parsed.data.state, "unavailable");
  assert.match(parsed.data.unavailableReason ?? "", /No liquidity available/);
  assert.match(parsed.data.unavailableReason ?? "", /try a smaller amount/);
  assert.equal(parsed.data.amountOut, undefined);
  assert.equal(parsed.data.oneTimeFee, undefined);
});

test("earn_positions Rhea fixture validates supplied rows, total and source", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-positions-rhea.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_positions") return;
  assert.equal(parsed.data.state, "ready");
  assert.equal(parsed.data.mca, "abc.multica.near");
  assert.deepEqual(parsed.data.supplied, [{ symbol: "USDC", amount: "100", apy: "14" }]);
  assert.equal(parsed.data.totalUsd, "100");
  assert.equal(parsed.data.source?.method, "get_account_all_positions");
  assert.equal(parsed.data.appUrl, "https://app.rhea.finance/lending");
  assert.match(parsed.data.note ?? "", /Read-only view/);
});

test("earn_positions Rhea empty fixture is an honest no-account explainer", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("earn-positions-rhea-empty.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "earn_positions") return;
  assert.equal(parsed.data.state, "empty");
  assert.equal(parsed.data.mca, null);
  assert.deepEqual(parsed.data.supplied, []);
  assert.match(parsed.data.explainer ?? "", /don't have a Rhea account yet/);
  assert.equal(parsed.data.appUrl, "https://app.rhea.finance/lending");
});

test("071 additions are strict: unknown Rhea rails and incomplete sources are rejected", () => {
  const quote = fixture("earn-quote-rhea-first-deposit.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...quote, rail: "oneclick_rhea_v2" }).success, false);
  assert.equal(
    ChatBlockSchema.safeParse({ ...quote, source: { kind: "contract" } }).success,
    false,
  );
  assert.equal(ChatBlockSchema.safeParse({ ...quote, firstDeposit: "yes" }).success, false);

  const positions = fixture("earn-positions-rhea.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...positions, state: "pending" }).success, false);
  assert.equal(
    ChatBlockSchema.safeParse({
      ...positions,
      supplied: [{ symbol: "USDC", amount: 100 }],
    }).success,
    false,
  );
});
