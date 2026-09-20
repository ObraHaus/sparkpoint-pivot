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

test("isRealUpdate: server must be strictly NEWER by the trailing build timestamp", () => {
  const id = (n: number) => `sha-${n.toString(36)}`;
  assert.equal(isRealUpdate(id(1000), id(2000)), true); // server newer → update
  assert.equal(isRealUpdate(id(2000), id(1000)), false); // OLDER replica (rolling deploy) → no reload
  assert.equal(isRealUpdate(id(1000), id(1000)), false); // identical → no-op
  // Unparseable trailing segment (non-base36) → fall back to plain inequality.
  assert.equal(isRealUpdate("x-@@", "y-##"), true);
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

test("isRealUpdate: commit-only ids (no timestamp suffix) compare by inequality", () => {
  const a = "7e19b0eae0074f94e16c9cb8ea4df4ba03eaad4c";
  const b = "f52b381dfc7befbf4aca0b565cf32d4cf8ca810c";
  assert.equal(isRealUpdate(a, b), true); // different commit → update
  assert.equal(isRealUpdate(a, a), false); // same commit, same build → no-op
});
