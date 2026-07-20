import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnownId, isRealUpdate, parseVersion, UNKNOWN_IDS } from "./version.ts";

test("isKnownId: only a present, non-placeholder id is comparable", () => {
  assert.equal(isKnownId("a1b2c3d4-1t3k9x"), true);
  assert.equal(isKnownId("dev-1t3k9x"), true); // a dev-fallback build still has a real id
  assert.equal(isKnownId(""), false);
  assert.equal(isKnownId("unknown"), false);
  assert.equal(isKnownId(null), false);
  assert.equal(isKnownId(undefined), false);
  assert.deepEqual([...UNKNOWN_IDS].sort(), ["", "unknown"]);
});

test("isRealUpdate: true only when both ids are known AND differ", () => {
  assert.equal(isRealUpdate("A", "B"), true);
  assert.equal(isRealUpdate("A", "A"), false); // equal → no-op
  assert.equal(isRealUpdate("", "B"), false); // our own id unknown → no-op
  assert.equal(isRealUpdate("A", ""), false); // server unknown → no-op
  assert.equal(isRealUpdate("A", "unknown"), false); // server placeholder → no-op
  assert.equal(isRealUpdate("unknown", "B"), false);
  assert.equal(isRealUpdate(null, "B"), false);
  assert.equal(isRealUpdate("A", null), false);
});

test("parseVersion: returns the version on a clean JSON 200", async () => {
  const res = new Response(JSON.stringify({ version: "abc-123" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await parseVersion(res), "abc-123");
});

test("parseVersion: null on every uncertainty (non-200, non-JSON, missing/empty, bad JSON)", async () => {
  const nonOk = new Response(JSON.stringify({ version: "x" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await parseVersion(nonOk), null);

  const html = new Response("<html>coming soon</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  assert.equal(await parseVersion(html), null);

  const missing = new Response(JSON.stringify({ nope: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await parseVersion(missing), null);

  const empty = new Response(JSON.stringify({ version: "" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await parseVersion(empty), null);

  const badJson = new Response("{not json", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await parseVersion(badJson), null);
});
