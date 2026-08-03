import assert from "node:assert/strict";
import { test } from "node:test";

import { pickRestoreTarget } from "./lastConversation.ts";

const HISTORY = [{ id: "cnv_c" }, { id: "cnv_b" }, { id: "cnv_a" }]; // newest first

test("the conversation the user was in is the one that comes back", () => {
  assert.equal(pickRestoreTarget(HISTORY, "cnv_b"), "cnv_b");
});

test("with nothing remembered, the most recent conversation is restored", () => {
  assert.equal(pickRestoreTarget(HISTORY, null), "cnv_c");
  assert.equal(pickRestoreTarget(HISTORY, undefined), "cnv_c");
  assert.equal(pickRestoreTarget(HISTORY, ""), "cnv_c");
});

test("a remembered conversation that no longer exists never causes a broken read", () => {
  // Deleted here, deleted on another device, or belonging to a wallet that has since changed.
  assert.equal(pickRestoreTarget(HISTORY, "cnv_deleted"), "cnv_c");
});

test("a first-time user with no history starts blank", () => {
  assert.equal(pickRestoreTarget([], "cnv_b"), null);
  assert.equal(pickRestoreTarget([], null), null);
});
