import assert from "node:assert/strict";
import { test } from "node:test";

import { formatApyPercent } from "./apy.ts";

test("a long APY formats to two decimals and never leaks the raw string", () => {
  assert.equal(formatApyPercent("10.2023855120367229327150527"), "10.20%");
  assert.equal(formatApyPercent("10.2023855120367229327150527%"), "10.20%");
  assert.equal(formatApyPercent("14.05"), "14.05%");
  assert.equal(formatApyPercent("14.05%"), "14.05%");
  assert.equal(formatApyPercent("5"), "5.00%");
  assert.equal(formatApyPercent(0), "0.00%");
  assert.equal(formatApyPercent(null), null);
  assert.equal(formatApyPercent(""), null);
  assert.equal(formatApyPercent("n/a"), null);
});
