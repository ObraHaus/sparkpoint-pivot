import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseSegment,
  coerceNavGroupState,
  commandActions,
  containsRoute,
  EXIT_ITEM,
  groupForRoute,
  INFORMATION_GROUP_KEY,
  isNavGroup,
  matchesQuery,
  navLeaves,
  navRoutes,
  NOTIFICATIONS_ITEM,
  PERMISSIONS_ITEM,
  PRIMARY,
  resolveGroupOpen,
  SECONDARY,
  toHref,
  type NavGroup,
} from "./nav.ts";

/** The pre-regroup flat secondary rail — the regroup must HIDE NOTHING. */
const LEGACY_SECONDARY_ROUTES = [
  "swap",
  "bridge",
  "trust",
  "automation",
  "outcomes",
  "fees",
  "premium",
  "learn",
  "srk",
  "settings",
];

test("regroup keeps every legacy route reachable (nothing hidden, only moved)", () => {
  const routes = navRoutes(SECONDARY);
  for (const r of LEGACY_SECONDARY_ROUTES) {
    assert.ok(routes.includes(r), `legacy route "${r}" disappeared from the secondary nav`);
  }
  // Changelog used to be hardcoded in each surface; it is now a first-class top-level entry.
  assert.ok(routes.includes("changelog"));
});

test("top-level order is the decided one: Swap, Bridge, Automation, Changelog, Information, Premium, Settings", () => {
  const top = SECONDARY.map((n) => (isNavGroup(n) ? `group:${n.key}` : n.route));
  assert.deepEqual(top, [
    "swap",
    "bridge",
    "automation",
    "changelog",
    `group:${INFORMATION_GROUP_KEY}`,
    "premium",
    "settings",
  ]);
});

test("the Information group holds exactly Trust Center, Outcome Log, Fees, Learn, SRK", () => {
  const group = SECONDARY.find((n): n is NavGroup => isNavGroup(n) && n.key === INFORMATION_GROUP_KEY);
  assert.ok(group);
  assert.deepEqual(
    group.children.map((c) => c.route),
    ["trust", "outcomes", "fees", "learn", "srk"],
  );
});

test("the exit path is pinned OUTSIDE the tree — it can never sit inside a collapsed group (N2)", () => {
  assert.equal(EXIT_ITEM.route, "trust/exit");
  assert.equal(groupForRoute(SECONDARY, EXIT_ITEM.route), undefined);
  assert.ok(!navRoutes(SECONDARY).includes(EXIT_ITEM.route));
});

test("containsRoute sees group children (mobile 'More' stays active inside a collapsed group)", () => {
  assert.equal(containsRoute(SECONDARY, "srk"), true);
  assert.equal(containsRoute(SECONDARY, "fees"), true);
  assert.equal(containsRoute(SECONDARY, "changelog"), true);
  assert.equal(containsRoute(SECONDARY, "chat"), false);
});

test("navLeaves flattens groups in source order", () => {
  const leaves = navLeaves(SECONDARY).map((n) => n.route);
  assert.deepEqual(leaves, [
    "swap",
    "bridge",
    "automation",
    "changelog",
    "trust",
    "outcomes",
    "fees",
    "learn",
    "srk",
    "premium",
    "settings",
  ]);
});

/* ------------------------------- ⌘K palette ------------------------------- */

test("the ⌘K palette is derived — it covers every nav route plus the pinned items, deduped", () => {
  const actions = commandActions();
  const routes = actions.map((a) => a.route);
  assert.equal(new Set(routes).size, routes.length, "duplicate route in the palette");
  for (const r of [...PRIMARY.map((p) => p.route), ...navRoutes(SECONDARY)]) {
    assert.ok(routes.includes(r), `palette is missing "${r}"`);
  }
  assert.ok(routes.includes(EXIT_ITEM.route));
  assert.ok(routes.includes(PERMISSIONS_ITEM.route));
  assert.ok(routes.includes(NOTIFICATIONS_ITEM.route));
});

test("the palette lists the exit path first", () => {
  assert.equal(commandActions()[0].route, EXIT_ITEM.route);
});

test("the palette regains the entries the hardcoded copy had drifted away from", () => {
  const routes = commandActions().map((a) => a.route);
  for (const r of ["srk", "learn", "changelog"]) assert.ok(routes.includes(r), `still missing "${r}"`);
});

test("matchesQuery searches labels AND keywords (the old palette's phrasings still find things)", () => {
  const byRoute = (r: string) => commandActions().find((a) => a.route === r)!;
  assert.ok(matchesQuery(byRoute("trust/exit"), "withdraw now"));
  assert.ok(matchesQuery(byRoute("fees"), "how we make money"));
  assert.ok(matchesQuery(byRoute("automation"), "revoke"));
  assert.ok(matchesQuery(byRoute("swap"), "SWAP TOKENS"));
  assert.ok(!matchesQuery(byRoute("swap"), "zzzz"));
  // empty query matches everything (the palette opens showing the full list)
  assert.ok(matchesQuery(byRoute("srk"), "   "));
});

/* --------------------------- group open/closed state --------------------------- */

const infoGroup = SECONDARY.find((n): n is NavGroup => isNavGroup(n) && n.key === INFORMATION_GROUP_KEY)!;

test("never toggled + active route outside the group ⇒ COLLAPSED on first load", () => {
  assert.equal(resolveGroupOpen({}, infoGroup, "chat"), false);
});

test("never toggled + active route inside the group ⇒ open, so a deep link is never orphaned", () => {
  assert.equal(resolveGroupOpen({}, infoGroup, "srk"), true);
  assert.equal(resolveGroupOpen({}, infoGroup, "fees"), true);
});

test("an explicit stored choice wins in both directions", () => {
  assert.equal(resolveGroupOpen({ [INFORMATION_GROUP_KEY]: true }, infoGroup, "chat"), true);
  assert.equal(resolveGroupOpen({ [INFORMATION_GROUP_KEY]: false }, infoGroup, "srk"), false);
});

test("coerceNavGroupState drops anything that isn't a boolean (untrusted localStorage)", () => {
  assert.deepEqual(coerceNavGroupState({ information: true, junk: "yes", n: 1, nested: {} }), {
    information: true,
  });
  assert.deepEqual(coerceNavGroupState(null), {});
  assert.deepEqual(coerceNavGroupState("nope"), {});
  assert.deepEqual(coerceNavGroupState([true, false]), {});
});

/* ---------------------------------- routing ---------------------------------- */

test("toHref / baseSegment behaviour is unchanged by the regroup", () => {
  assert.equal(toHref("landing"), "/");
  assert.equal(toHref("settings/account"), "/settings");
  assert.equal(toHref("trust/exit"), "/trust/exit");
  assert.equal(toHref("srk"), "/srk");
  assert.equal(baseSegment("/vault/deposit"), "vault");
  assert.equal(baseSegment("/"), "chat");
});
