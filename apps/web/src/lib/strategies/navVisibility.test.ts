import assert from "node:assert/strict";
import { test } from "node:test";

import { strategiesNavVisible } from "./navVisibility.ts";

test("no saved plan → there is nothing to rank, so the entry is hidden", () => {
  assert.equal(strategiesNavVisible({ mandateStatus: "empty", recommendations: null }), false);
});

test("a ready plan with zero ranked strategies → hidden", () => {
  assert.equal(strategiesNavVisible({ mandateStatus: "ready", recommendations: [] }), false);
});

test("a ready plan with strategies → visible", () => {
  assert.equal(strategiesNavVisible({ mandateStatus: "ready", recommendations: [{}] }), true);
});

test("unknown states never hide a reachable page (N2)", () => {
  for (const status of ["disconnected", "loading", "error"] as const) {
    assert.equal(strategiesNavVisible({ mandateStatus: status, recommendations: null }), true, status);
  }
});
