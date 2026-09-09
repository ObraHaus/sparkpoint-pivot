import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfirmParams } from "./confirmParams.ts";

test("parses raw base-unit assets into a positive bigint", () => {
  const p = parseConfirmParams(new URLSearchParams("assets=1000000"));
  assert.equal(p.assets, 1_000_000n);
  assert.equal(p.shares, undefined);
  assert.equal(p.vaultSelected, null);
});

test("parses withdraw-by-shares + a vault selection", () => {
  const p = parseConfirmParams(new URLSearchParams("shares=5000000&vault=0xAbC"));
  assert.equal(p.shares, 5_000_000n);
  assert.equal(p.assets, undefined);
  assert.equal(p.vaultSelected, "0xAbC");
});

test("fails safe to undefined on missing / empty / non-integer / zero / negative amounts", () => {
  assert.equal(parseConfirmParams(new URLSearchParams("")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=0")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=1.5")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=-5")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=1e6")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=abc")).assets, undefined);
});

test("tolerates surrounding whitespace in an otherwise-integer amount", () => {
  const p = parseConfirmParams(new URLSearchParams("assets=%20100%20"));
  assert.equal(p.assets, 100n);
});

test("030 — the recommendation id survives the link from /strategies", () => {
  // Before 030 the strategies link carried neither an amount nor a rec id, so a deposit started
  // there could never be attributed back to the recommendation in the Outcome Log.
  const p = parseConfirmParams(
    new URLSearchParams("assets=100000000&rec=1ad4c33b-6a44-4e7c-868b-6fa682afac76"),
  );
  assert.equal(p.assets, 100000000n);
  assert.equal(p.recommendationId, "1ad4c33b-6a44-4e7c-868b-6fa682afac76");
});

test("030 — a malformed recommendation id is dropped, never forwarded", () => {
  for (const raw of ["", "   ", "a b", "<script>", "x".repeat(65), "rec/../../etc"]) {
    assert.equal(
      parseConfirmParams(new URLSearchParams(`rec=${encodeURIComponent(raw)}`)).recommendationId,
      undefined,
      raw,
    );
  }
  assert.equal(parseConfirmParams(new URLSearchParams("")).recommendationId, undefined);
});

test("030 — a plain rec_ slug is accepted", () => {
  assert.equal(
    parseConfirmParams(new URLSearchParams("rec=rec_vault_deposit")).recommendationId,
    "rec_vault_deposit",
  );
});
