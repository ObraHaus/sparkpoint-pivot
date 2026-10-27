import assert from "node:assert/strict";
import { test } from "node:test";

import { clearStreamText, reduceTextDelta, type StreamTextState } from "./streamText.ts";

const start: StreamTextState = { text: "" };

test("same stream appends deltas in order", () => {
  const one = reduceTextDelta(start, { kind: "text_delta", target: "text", delta: "Hel", streamId: "s1" });
  const two = reduceTextDelta(one, { kind: "text_delta", target: "text", delta: "lo", streamId: "s1" });
  assert.equal(two.text, "Hello");
  assert.equal(two.streamId, "s1");
});

test("a new streamId resets instead of concatenating a retry", () => {
  const one = reduceTextDelta(start, { kind: "text_delta", target: "text", delta: "bad answer", streamId: "a1" });
  const retry = reduceTextDelta(one, { kind: "text_delta", target: "text", delta: "Good answer", streamId: "a2" });
  assert.equal(retry.text, "Good answer");
  assert.equal(retry.streamId, "a2");
});

test("a target switch (text → tip) also resets", () => {
  const one = reduceTextDelta(start, { kind: "text_delta", target: "text", delta: "prose", streamId: "s1" });
  const tip = reduceTextDelta(one, { kind: "text_delta", target: "tip", delta: "A vault pools deposits.", streamId: "s1" });
  assert.equal(tip.text, "A vault pools deposits.");
  assert.equal(tip.target, "tip");
});

test("a missing streamId is treated as the same stream (forward compatible)", () => {
  const one = reduceTextDelta(start, { kind: "text_delta", target: "text", delta: "a", streamId: "s1" });
  const two = reduceTextDelta(one, { kind: "text_delta", target: "text", delta: "b" });
  assert.equal(two.text, "ab");
});

test("the final block clears the provisional paint so it cannot outlive the answer", () => {
  const painted = reduceTextDelta(start, {
    kind: "text_delta",
    target: "text",
    delta: "provisional",
    streamId: "s1",
  });
  const final = clearStreamText();
  assert.deepEqual(final, { text: "" });
  assert.notEqual(painted.text, final.text);
});
