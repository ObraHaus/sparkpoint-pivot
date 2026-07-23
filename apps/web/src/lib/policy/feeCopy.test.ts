import { test } from "node:test";
import assert from "node:assert/strict";
import { PERFORMANCE_FEE_DISCLOSURE } from "./feeCopy.ts";

test("PERFORMANCE_FEE_DISCLOSURE is the verbatim §3.7 canonical string", () => {
  assert.equal(
    PERFORMANCE_FEE_DISCLOSURE,
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your " +
      "principal. We only earn when you earn — never on your principal, never by taking custody.",
  );
});
