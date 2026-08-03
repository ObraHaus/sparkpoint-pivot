/**
 * 035 — the admin nav, tested against the REAL rule.
 *
 * The predecessor of this file re-implemented `activeNav` and said so in a comment, because it
 * could not import a React client component. A test carrying its own copy of the logic passes when
 * the copy is right, which is not the question anyone is asking. The rule now lives in a pure leaf
 * module, so these assertions run against the code that ships.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { LEGACY_ROUTES, NAVMETA, NAV_HREF, activeNav, type NavKey } from "./nav.ts";

test("the menu is nine entries, not nineteen", () => {
  // Most of the nineteen were one screen each, and the grouping was something you had to know
  // rather than something you could see.
  const keys = Object.keys(NAV_HREF);
  assert.equal(keys.length, 9);
  assert.deepEqual(keys, Object.keys(NAVMETA), "every entry has a label and an icon");
});

test("updates and tips are gone from the menu but not from the app", () => {
  assert.ok(!("updates" in NAV_HREF));
  assert.ok(!("tips" in NAV_HREF));
  assert.equal(LEGACY_ROUTES["/admin/tips"], "/admin/knowledge?section=tips");
  assert.equal(LEGACY_ROUTES["/admin/updates"], "/admin/knowledge?section=updates");
});

test("the merged entries replace the ones they absorbed", () => {
  for (const gone of ["allowlist", "usage", "cfg", "tvl", "vaults", "uptime", "diagnostics", "killswitch", "audit"]) {
    assert.ok(!(gone in NAV_HREF), `${gone} should no longer be its own entry`);
  }
  assert.equal(NAV_HREF.users, "/admin/users");
  assert.equal(NAV_HREF.vault, "/admin/vault");
  assert.equal(NAV_HREF.system, "/admin/system");
});

test("a longer route never loses to a shorter prefix", () => {
  // `startsWith` alone would make every admin route look like Overview, because "/admin" is a
  // prefix of all of them.
  assert.equal(activeNav("/admin"), "overview");
  assert.equal(activeNav("/admin/users"), "users");
  assert.equal(activeNav("/admin/vault"), "vault");
  assert.equal(activeNav("/admin/system"), "system");
  assert.equal(activeNav("/admin/knowledge"), "knowledge");
});

test("a sub-route still belongs to its entry", () => {
  assert.equal(activeNav("/admin/vault/anything"), "vault");
});

test("changing section is not navigation", () => {
  // The point of a console: moving between tabs keeps you on the same nav entry, so the highlight
  // does not jump around while you read.
  for (const section of ["overview", "config"]) {
    assert.equal(activeNav(`/admin/vault?section=${section}`.split("?")[0]), "vault");
  }
});

test("an unknown admin route falls back to Overview rather than to nothing", () => {
  assert.equal(activeNav("/admin/does-not-exist"), "overview");
});

test("every legacy route points at a section of a console that exists", () => {
  // The promise to anyone who bookmarked one of the old screens: it still lands somewhere real.
  for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
    const [path, query] = to.split("?");
    const key = activeNav(path) as NavKey;
    assert.ok(NAV_HREF[key] === path, `${from} -> ${to} should land on a console`);
    assert.ok(query?.startsWith("section="), `${from} -> ${to} should name a section`);
  }
});

test("no legacy route redirects to itself", () => {
  for (const [from, to] of Object.entries(LEGACY_ROUTES)) {
    assert.notEqual(from, to.split("?")[0], `${from} would redirect to itself`);
  }
});
