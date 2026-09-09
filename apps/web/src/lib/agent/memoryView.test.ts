import { test } from "node:test";
import assert from "node:assert/strict";
import { shortDate, toMemoryView } from "./memoryView.ts";

test("shortDate formats an ISO timestamp and tolerates junk", () => {
  assert.equal(shortDate("2026-08-02T04:15:00Z").length > 0, true);
  assert.equal(shortDate(undefined), "");
  assert.equal(shortDate(null), "");
  assert.equal(shortDate("not-a-date"), "");
});

test("toMemoryView shows the stored lines VERBATIM, newest first", () => {
  // The card's whole claim is "this is what Sparky is given". Rewriting a line here would make
  // that claim false, so the mapper must pass the text through untouched.
  const view = toMemoryView({
    updatedAt: "2026-08-02T04:15:00Z",
    lines: [
      { at: "2026-08-01T10:00:00Z", line: "asked: where can I earn yield on my USDC" },
      { at: "2026-08-01T10:00:00Z", line: "was recommended: Aave USDC Supply (and 1 more)" },
      { at: "2026-08-02T04:15:00Z", line: "viewed portfolio" },
    ],
  });
  assert.equal(view.count, 3);
  assert.equal(view.isEmpty, false);
  assert.deepEqual(
    view.rows.map((r) => r.text),
    [
      "viewed portfolio",
      "was recommended: Aave USDC Supply (and 1 more)",
      "asked: where can I earn yield on my USDC",
    ],
  );
  assert.equal(view.updatedText.startsWith("Last updated "), true);
});

test("row keys are unique even when the same line is remembered twice", () => {
  const view = toMemoryView({
    lines: [{ line: "asked: hi" }, { line: "asked: hi" }],
  });
  assert.equal(new Set(view.rows.map((r) => r.key)).size, 2);
});

test("an empty, missing, or malformed body is the honest empty state", () => {
  for (const dto of [undefined, null, {}, { lines: [] }, { lines: undefined }]) {
    const view = toMemoryView(dto as never);
    assert.equal(view.isEmpty, true);
    assert.equal(view.count, 0);
    assert.deepEqual(view.rows, []);
    assert.equal(view.updatedText, "");
  }
});

test("blank and non-string entries are dropped, never rendered as empty rows", () => {
  const view = toMemoryView({
    lines: [{ line: "   " }, { line: "real line" }, { at: "x" }, { line: 7 } as never],
  });
  assert.deepEqual(
    view.rows.map((r) => r.text),
    ["real line"],
  );
});

test("a missing per-entry timestamp yields no date rather than a fake one", () => {
  const view = toMemoryView({ lines: [{ line: "asked: hi" }] });
  assert.equal(view.rows[0].dateText, "");
  assert.equal(view.rows[0].text, "asked: hi");
});
