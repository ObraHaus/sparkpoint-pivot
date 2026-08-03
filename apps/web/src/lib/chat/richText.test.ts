import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRichText, plainText } from "./richText.ts";

/** The fees answer, verbatim from the agent — it rendered with visible asterisks. */
const FEES =
  "I can't show a per-wallet total. What you're charged: **0% on deposits, withdrawals and " +
  "your principal**, a **10% performance fee**, and **0.20%** on swaps.";

test("bold markers become structure, never visible characters", () => {
  const [para] = parseRichText(FEES);
  assert.ok(!para.some((s) => s.text.includes("*")), "no asterisk survives into the output");
  const bolded = para.filter((s) => s.bold).map((s) => s.text);
  assert.deepEqual(bolded, [
    "0% on deposits, withdrawals and your principal",
    "10% performance fee",
    "0.20%",
  ]);
});

test("blank lines become paragraphs — the advice boundary is three of them", () => {
  const advice = "I can't tell you to do that.\n\nConcentration is the real risk.\n\nSet a mandate.";
  const paras = parseRichText(advice);
  assert.equal(paras.length, 3);
  assert.equal(paras[1][0].text, "Concentration is the real risk.");
});

test("a single newline is a space, not a paragraph break", () => {
  const paras = parseRichText("one line\nsame paragraph");
  assert.equal(paras.length, 1);
  assert.equal(paras[0][0].text, "one line same paragraph");
});

test("an unmatched marker is left alone rather than swallowing the answer", () => {
  const [para] = parseRichText("a ** stray marker and some real text");
  assert.equal(para.map((s) => s.text).join(""), "a ** stray marker and some real text");
});

test("no output segment ever contains markup", () => {
  const nasty = "**<script>alert(1)</script>** and <b>raw</b>";
  const [para] = parseRichText(nasty);
  // The parser does not interpret HTML at all — it stays literal text, which React escapes.
  assert.equal(para.map((s) => s.text).join(""), "<script>alert(1)</script> and <b>raw</b>");
});

test("empty and missing input produce nothing to render", () => {
  for (const v of [undefined, null, "", "   \n\n  "]) {
    assert.deepEqual(parseRichText(v), []);
  }
});

test("plainText round-trips the content without the formatting", () => {
  assert.ok(!plainText(FEES).includes("*"));
  assert.ok(plainText(FEES).includes("10% performance fee"));
});

test("text with no formatting at all is a single plain paragraph", () => {
  const [para] = parseRichText("Bridging to another chain isn't available yet.");
  assert.equal(para.length, 1);
  assert.equal(para[0].bold, false);
});
