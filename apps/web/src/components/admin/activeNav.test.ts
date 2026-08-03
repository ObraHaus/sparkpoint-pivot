import assert from "node:assert/strict";
import { test } from "node:test";

// The rule under test is pure. Re-implemented here rather than imported, because AdminShell is a
// React client component that the strip-types runner cannot load — the assertions below are the
// contract, and the component's copy of it must match.
type NavKey = string;
const HREF: Record<string, string> = {
  overview: "/admin",
  users: "/admin/users",
  knowledge: "/admin/knowledge",
  updates: "/admin/knowledge?section=updates",
  tips: "/admin/knowledge?section=tips",
};

function activeNav(pathname: string, section?: string | null): NavKey {
  if (pathname === "/admin/knowledge" && section) {
    const bySection: Record<string, NavKey> = { updates: "updates", tips: "tips" };
    const key = bySection[section];
    if (key) return key;
  }
  const entry = Object.entries(HREF)
    .map(([key, href]) => [key, href.split("?")[0]] as [NavKey, string])
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, href]) => pathname === href || pathname.startsWith(href + "/"));
  return entry ? entry[0] : "overview";
}

test("032 — a deep-linked section highlights ITS nav entry, not the page it lives on", () => {
  // Three nav entries now point at one page. Matching on pathname alone would highlight
  // "Knowledge" when the admin clicked "Tips".
  assert.equal(activeNav("/admin/knowledge", "tips"), "tips");
  assert.equal(activeNav("/admin/knowledge", "updates"), "updates");
});

test("the console itself still highlights Knowledge", () => {
  assert.equal(activeNav("/admin/knowledge"), "knowledge");
  assert.equal(activeNav("/admin/knowledge", null), "knowledge");
  // An unknown section is not a nav entry — fall back to the page it is on.
  assert.equal(activeNav("/admin/knowledge", "nonsense"), "knowledge");
});

test("a query on an href never breaks pathname matching", () => {
  // The hrefs now carry `?section=`; a pathname never does, so the comparison must strip it.
  assert.equal(activeNav("/admin/users"), "users");
  assert.equal(activeNav("/admin"), "overview");
  assert.equal(activeNav("/admin/users/0xabc"), "users");
});

test("an unknown route falls back to overview", () => {
  assert.equal(activeNav("/admin/nowhere"), "overview");
});
