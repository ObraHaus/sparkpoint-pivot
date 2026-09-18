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
  OFF_NAV_DESTINATIONS,
  SECONDARY,
  toHref,
  type NavGroup,
} from "./nav.ts";

/** The pre-regroup flat secondary rail — the regroup must HIDE NOTHING. */
const LEGACY_SECONDARY_ROUTES = [
  // "bridge" is deliberately HIDDEN for now (operator decision 2026-09-18). The page still renders
  // its honest "not part of the beta yet" state if visited by URL; it is not advertised in nav or ⌘K.
  "swap",
  "trust",
  "automation",
  "outcomes",
  "fees",
  "premium",
  "learn",
  "srk",
  "settings",
];

test("every destination stays reachable: nav routes + the off-nav Settings-surfaced pair", () => {
  // Client decision (Aug 2 evening): Premium and Automation leave the rail — they surface inside
  // Settings (Account / Security) and stay deep-linkable + ⌘K-searchable. Everything else that
  // was ever in the secondary nav is still IN it.
  const routes = navRoutes(SECONDARY);
  const offNav = OFF_NAV_DESTINATIONS.map((n) => n.route);
  for (const r of LEGACY_SECONDARY_ROUTES) {
    assert.ok(
      routes.includes(r) || offNav.includes(r),
      `route "${r}" is neither in the nav nor a tracked off-nav destination`,
    );
  }
  assert.deepEqual(offNav, ["premium", "automation", "srk", "changelog"]);
  assert.ok(!routes.includes("changelog"), "changelog moved into Settings (off-nav, searchable)");
  assert.ok(!routes.includes("srk"), "SRK moved inside Learn (off-nav, searchable)");
});

test("top-level order is the decided one: Swap, Information, Settings", () => {
  const top = SECONDARY.map((n) => (isNavGroup(n) ? `group:${n.key}` : n.route));
  assert.deepEqual(top, ["swap", `group:${INFORMATION_GROUP_KEY}`, "settings"]);
});

test("the Information group holds Trust Center, Outcome Log, Fees, Learn, Sparky Broker, Revenue share", () => {
  const group = SECONDARY.find((n): n is NavGroup => isNavGroup(n) && n.key === INFORMATION_GROUP_KEY);
  assert.ok(group);
  // 043 — Sparky Broker sits after SRK, deliberately: SRK is what you spend to activate one, so the
  // two read in the order a holder meets them.
  // 044 — Revenue share sits directly under Sparky Broker: it is the only thing an activated
  // broker's weight is FOR. ⚠️ It shipped with no nav entry at all and was reachable only by
  // typing the URL, which is why this list is asserted rather than trusted.
  assert.deepEqual(
    group.children.map((c) => c.route),
    ["trust", "outcomes", "fees", "learn", "brokers", "brokers/revenue"],
  );
});

test("the exit path is pinned OUTSIDE the tree — it can never sit inside a collapsed group (N2)", () => {
  assert.equal(EXIT_ITEM.route, "trust/exit");
  assert.equal(groupForRoute(SECONDARY, EXIT_ITEM.route), undefined);
  assert.ok(!navRoutes(SECONDARY).includes(EXIT_ITEM.route));
});

test("containsRoute sees group children (mobile 'More' stays active inside a collapsed group)", () => {
  assert.equal(containsRoute(SECONDARY, "srk"), false); // moved inside Learn
  assert.equal(containsRoute(SECONDARY, "fees"), true);
  assert.equal(containsRoute(SECONDARY, "changelog"), false); // moved into Settings
  assert.equal(containsRoute(SECONDARY, "chat"), false);
});

test("navLeaves flattens groups in source order", () => {
  const leaves = navLeaves(SECONDARY).map((n) => n.route);
  assert.deepEqual(leaves, [
    "swap",
    "trust",
    "outcomes",
    "fees",
    "learn",
    "brokers",
    "brokers/revenue",
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
  assert.equal(resolveGroupOpen({}, infoGroup, "trust"), true);
  assert.equal(resolveGroupOpen({}, infoGroup, "fees"), true);
});

test("an explicit stored choice wins in both directions", () => {
  assert.equal(resolveGroupOpen({ [INFORMATION_GROUP_KEY]: true }, infoGroup, "chat"), true);
  assert.equal(resolveGroupOpen({ [INFORMATION_GROUP_KEY]: false }, infoGroup, "fees"), false);
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

test("Sparky Broker has a real slot inside Information, and is searchable", () => {
  // The operator asked for it in the rail (Trust & Control → Information), so it is a nav route now
  // rather than the placeholder it shipped as. OFF_NAV_DESTINATIONS is untouched: that list means
  // "left the rail, now lives in Settings", which was never true of this one.
  const routes = navRoutes(SECONDARY);
  assert.ok(routes.includes("brokers"), "it lives in the nav tree");
  const info = SECONDARY.find((n): n is NavGroup => isNavGroup(n) && n.key === INFORMATION_GROUP_KEY);
  assert.ok(info);
  assert.ok(containsRoute(info.children, "brokers"), "specifically inside Information");
  assert.deepEqual(
    OFF_NAV_DESTINATIONS.map((n) => n.route),
    ["premium", "automation", "srk", "changelog"],
    "now also carries SRK (inside Learn) and the Changelog (inside Settings)",
  );

  const palette = commandActions().map((a) => a.route);
  assert.ok(palette.includes("brokers"), "⌘K must find it");
  assert.equal(toHref("brokers"), "/brokers");
});

/* --------------------- no page ships without a way to reach it --------------------- */

test("044: Revenue share is reachable from the nav, not only by typing the URL", () => {
  // ⚠️ This page shipped, deployed and passed a live copy audit while NOTHING linked to it. The
  // audit navigates by direct URL, so it rendered the page happily; a user browsing the app could
  // not find it at all. "It works if you know the address" is not shipped.
  assert.ok(containsRoute(SECONDARY, "brokers/revenue"), "it must be in the nav tree");
  assert.ok(navRoutes(SECONDARY).includes("brokers/revenue"));
  assert.equal(toHref("brokers/revenue"), "/brokers/revenue");

  const group = SECONDARY.find(
    (n): n is NavGroup => isNavGroup(n) && n.key === INFORMATION_GROUP_KEY,
  );
  assert.ok(group);
  const routes = group.children.map((c) => c.route);
  assert.equal(
    routes.indexOf("brokers/revenue"),
    routes.indexOf("brokers") + 1,
    "it belongs directly under Sparky Broker — the weight you activate for is what this pays",
  );
});

test("044: ⌘K finds revenue share by the words a holder would actually type", () => {
  const item = navLeaves(SECONDARY).find((n) => n.route === "brokers/revenue");
  assert.ok(item);
  for (const term of ["revenue", "claim", "payout"]) {
    assert.ok(
      item.keywords?.includes(term),
      `⌘K should find it by "${term}" — a holder looking for their money will not search "brokers"`,
    );
  }
});
