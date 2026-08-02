import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTurns, type ConversationTurnDto } from "./conversationReplay.ts";

/** A persisted swap `action` block — the exact card the reopen bug used to destroy. */
const ACTION_BLOCK = {
  type: "action",
  proposedAction: {
    type: "aerodrome_swap",
    asset: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    amount: "10000000000000000",
    params: { maxSlippageBps: 50 },
  },
  policy: { status: "rejected", reason: "Swaps run on Uniswap V3." },
};

const REC_BLOCK = {
  type: "recommendation",
  recId: "rec_1",
  title: "Deposit into the vault",
  rank: 1,
  rationale: "steady",
  protocol: "sparkpoint_vault",
  proposedAction: { type: "vault_deposit", asset: "0xUSDC", decimals: 6, amount: "1000000" },
  policy: { status: "approved" },
  citations: [],
};

const TEXT_BLOCK = { type: "text", markdown: "Here's a swap." };

test("replays a persisted swap card as CARDS, not the lossy summary", () => {
  const turns: ConversationTurnDto[] = [
    { role: "user", content: "Swap ETH to USDC", blocks: [] },
    { role: "assistant", content: "[proposed action: aerodrome_swap]", blocks: [ACTION_BLOCK] },
  ];
  const out = replayTurns(turns);
  assert.deepEqual(out[0], { kind: "user", text: "Swap ETH to USDC" });
  assert.equal(out[1].kind, "cards");
  assert.deepEqual(out[1].kind === "cards" ? out[1].cards : [], [ACTION_BLOCK]);
});

test("replays a persisted recommendation card", () => {
  const out = replayTurns([
    { role: "assistant", content: "[recommended: Deposit into the vault]", blocks: [REC_BLOCK] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "cards");
  assert.deepEqual(out[0].kind === "cards" ? out[0].cards : [], [REC_BLOCK]);
});

test("preserves block order within a turn", () => {
  const out = replayTurns([
    { role: "assistant", content: "s", blocks: [TEXT_BLOCK, ACTION_BLOCK] },
  ]);
  const cards = out[0].kind === "cards" ? out[0].cards : [];
  assert.deepEqual(
    cards.map((c) => (c as { type: string }).type),
    ["text", "action"],
  );
});

test("LEGACY: a turn with no blocks field falls back to its text summary", () => {
  const out = replayTurns([
    { role: "user", content: "hello" },
    { role: "assistant", content: "[showed your portfolio]" },
  ]);
  assert.deepEqual(out, [
    { kind: "user", text: "hello" },
    { kind: "text", text: "[showed your portfolio]" },
  ]);
});

test("LEGACY: an empty blocks array falls back to its text summary", () => {
  const out = replayTurns([{ role: "assistant", content: "APY is your yearly yield.", blocks: [] }]);
  assert.deepEqual(out, [{ kind: "text", text: "APY is your yearly yield." }]);
});

test("drops transient tool_step blocks and keeps the real cards", () => {
  const out = replayTurns([
    {
      role: "assistant",
      content: "s",
      blocks: [
        { type: "tool_step", label: "Reading your portfolio", status: "running" },
        { type: "tool_step", label: "Reading your portfolio", status: "done" },
        ACTION_BLOCK,
      ],
    },
  ]);
  const cards = out[0].kind === "cards" ? out[0].cards : [];
  assert.deepEqual(cards, [ACTION_BLOCK]);
});

test("a turn of ONLY tool_step blocks falls back to its text summary", () => {
  const out = replayTurns([
    {
      role: "assistant",
      content: "the summary",
      blocks: [{ type: "tool_step", label: "Understanding your request", status: "done" }],
    },
  ]);
  assert.deepEqual(out, [{ kind: "text", text: "the summary" }]);
});

test("a cards-only turn survives even with an empty text summary", () => {
  // The old page filtered on `content.trim().length > 0`, which would have dropped this entirely.
  const out = replayTurns([{ role: "assistant", content: "", blocks: [ACTION_BLOCK] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "cards");
});

test("drops turns with neither cards nor text", () => {
  const out = replayTurns([
    { role: "assistant", content: "   ", blocks: [] },
    { role: "user", content: "" },
    { role: "assistant", content: "kept" },
  ]);
  assert.deepEqual(out, [{ kind: "text", text: "kept" }]);
});

test("trims whitespace on replayed text", () => {
  const out = replayTurns([{ role: "user", content: "  hello  " }]);
  assert.deepEqual(out, [{ kind: "user", text: "hello" }]);
});

test("FAIL-OPEN: a malformed payload degrades that turn, never the conversation", () => {
  const out = replayTurns([
    { role: "assistant", content: "a", blocks: "not-an-array" },
    { role: "assistant", content: "b", blocks: { type: "action" } },
    { role: "assistant", content: "c", blocks: [null, 7, "junk", ACTION_BLOCK] },
    { role: "assistant", content: "d", blocks: [123] },
  ]);
  assert.deepEqual(out[0], { kind: "text", text: "a" });
  assert.deepEqual(out[1], { kind: "text", text: "b" });
  // Non-object entries are dropped; the real card still replays.
  assert.deepEqual(out[2].kind === "cards" ? out[2].cards : [], [ACTION_BLOCK]);
  // All entries dropped → the text summary carries the turn.
  assert.deepEqual(out[3], { kind: "text", text: "d" });
});

test("FAIL-OPEN: a missing / non-array turns payload yields nothing, never a throw", () => {
  assert.deepEqual(replayTurns(undefined), []);
  assert.deepEqual(replayTurns(null), []);
  assert.deepEqual(replayTurns([]), []);
  assert.deepEqual(replayTurns("nope" as unknown as ConversationTurnDto[]), []);
  assert.deepEqual(replayTurns([null, undefined] as unknown as ConversationTurnDto[]), []);
});

test("an unknown role renders on the assistant side rather than vanishing", () => {
  const out = replayTurns([{ role: "system", content: "s", blocks: [ACTION_BLOCK] }]);
  assert.equal(out[0].kind, "cards");
});
