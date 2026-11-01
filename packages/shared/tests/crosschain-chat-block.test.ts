import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ChatBlockSchema } from "../src/schemas/chat-block.ts";

/**
 * 068 — the SHARED contract fixture. The same JSON files are asserted against the Python
 * `CrossChainQuoteBlock.to_wire()` in `services/agent/tests/crosschain/test_chat_block_fixtures.py`,
 * so the two implementations cannot drift independently.
 */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/crosschain/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

test("crosschain_quote preview fixture validates against ChatBlockSchema", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("crosschain-preview.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "crosschain_quote") return;
  assert.equal(parsed.data.state, "preview");
  assert.equal(parsed.data.origin.key, "base:USDC");
  assert.equal(parsed.data.origin.evmChainId, 8453);
  assert.equal(parsed.data.destination.key, "btc:BTC");
  assert.equal(parsed.data.destination.addressKind, "btc");
  assert.equal(parsed.data.amountOut, "0.06439596");
  assert.equal(parsed.data.minAmountOut, "0.063752");
  assert.equal(parsed.data.timeEstimateSec, 480);
});

test("crosschain_quote unavailable fixture validates against ChatBlockSchema", () => {
  const parsed = ChatBlockSchema.safeParse(fixture("crosschain-unavailable.json"));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  if (!parsed.success || parsed.data.type !== "crosschain_quote") return;
  assert.equal(parsed.data.state, "unavailable");
  assert.equal(parsed.data.destination.addressKind, "tron");
  assert.match(parsed.data.unavailableReason ?? "", /Tron/);
  assert.equal(parsed.data.amountOut, undefined);
});

test("crosschain_quote is strict: unknown fields and wrong nullability are rejected", () => {
  const preview = fixture("crosschain-preview.json") as Record<string, unknown>;
  assert.equal(ChatBlockSchema.safeParse({ ...preview, unexpected: true }).success, false);

  const nonEvmOrigin = {
    ...(preview.origin as Record<string, unknown>),
    evmChainId: undefined,
  };
  assert.equal(ChatBlockSchema.safeParse({ ...preview, origin: nonEvmOrigin }).success, false);

  const badState = { ...preview, state: "live" };
  assert.equal(ChatBlockSchema.safeParse(badState).success, false);
});
