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
