import assert from "node:assert/strict";
import { test } from "node:test";

import { FIRST_VISIT_CAP, releaseKey, selectFreshEntries } from "./whatsNew.ts";

const entries = [
  { slug: "r4", id: 4 },
  { slug: "r3", id: 3 },
  { slug: "r2", id: 2 },
  { slug: "r1", id: 1 },
];

test("no marker → a capped welcome, newest first", () => {
  assert.deepEqual(
    selectFreshEntries(entries, null).map((e) => e.slug),
    ["r4", "r3", "r2", "r1"],
  );
  const many = Array.from({ length: 10 }, (_, i) => ({ slug: `r${10 - i}`, id: 10 - i }));
  assert.equal(selectFreshEntries(many, null).length, FIRST_VISIT_CAP);
});

test("the newest release acknowledged → nothing, once per release", () => {
  assert.deepEqual(selectFreshEntries(entries, "r4"), []);
});

test("an older marker shows only the releases above it", () => {
  assert.deepEqual(
    selectFreshEntries(entries, "r2").map((e) => e.slug),
    ["r4", "r3"],
  );
});

test("an unknown marker falls back to the welcome, never a blank panel", () => {
  assert.deepEqual(
    selectFreshEntries(entries, "gone").map((e) => e.slug),
    ["r4", "r3", "r2", "r1"],
  );
});

test("a legacy row without a slug still gets a stable release key", () => {
  assert.equal(releaseKey({ id: 7 }), "id:7");
  assert.equal(releaseKey({ id: 7, slug: "  " }), "id:7");
  assert.equal(releaseKey({ id: 7, slug: "r7" }), "r7");
  assert.equal(releaseKey({}), null);
});

test("empty feed shows nothing", () => {
  assert.deepEqual(selectFreshEntries([], null), []);
  assert.deepEqual(selectFreshEntries([], "r4"), []);
});
