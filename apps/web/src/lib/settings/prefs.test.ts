import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceDisplayPrefs,
  coerceNotifPrefs,
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_NOTIF_PREFS,
  displayAttrs,
  NOTIF_KEYS,
} from "./prefs.ts";

test("coerceNotifPrefs: absent / non-object → a fresh copy of the full defaults", () => {
  assert.deepEqual(coerceNotifPrefs(undefined), DEFAULT_NOTIF_PREFS);
  assert.deepEqual(coerceNotifPrefs(null), DEFAULT_NOTIF_PREFS);
  assert.deepEqual(coerceNotifPrefs("nope"), DEFAULT_NOTIF_PREFS);
  assert.notEqual(coerceNotifPrefs({}), DEFAULT_NOTIF_PREFS); // new object, not the shared default ref
});

test("coerceNotifPrefs: partial/drifted blob merges over defaults; unknown keys & bad types dropped", () => {
  const m = coerceNotifPrefs({ txResults: false, outcomeUpdates: true, bogus: 1, capsNearLimit: "yes" });
  assert.equal(m.txResults, false); // overridden
  assert.equal(m.outcomeUpdates, true); // overridden
  assert.equal(m.capsNearLimit, DEFAULT_NOTIF_PREFS.capsNearLimit); // bad type → default
  assert.equal(m.rateChanges, DEFAULT_NOTIF_PREFS.rateChanges); // absent → default
  assert.equal("bogus" in m, false); // unknown key dropped
  assert.deepEqual(Object.keys(m).sort(), [...NOTIF_KEYS].sort());
});

test("default notif prefs preserve the design's first-three-on states", () => {
  assert.deepEqual(DEFAULT_NOTIF_PREFS, {
    txResults: true,
    rateChanges: true,
    capsNearLimit: true,
    sessionKeyExpiry: false,
    outcomeUpdates: false,
  });
});

test("coerceDisplayPrefs: each field validated against its domain", () => {
  assert.deepEqual(coerceDisplayPrefs(undefined), DEFAULT_DISPLAY_PREFS);
  // A whole-shape assertion, deliberately: it fails when a field is ADDED, which is how 038's new
  // `expandSources` was caught rather than silently appearing in stored blobs.
  assert.deepEqual(coerceDisplayPrefs({ density: "compact", reducedMotion: true }), {
    density: "compact",
    reducedMotion: true,
    expandSources: false,
  });
  assert.equal(coerceDisplayPrefs({ density: "cozy" }).density, "comfortable"); // out-of-domain → default
  assert.equal(coerceDisplayPrefs({ reducedMotion: "true" }).reducedMotion, false); // string not bool → default
});

test("displayAttrs: comfortable / motion-on map to absent (null) attributes", () => {
  assert.deepEqual(displayAttrs({ density: "comfortable", reducedMotion: false, expandSources: false }), {
    density: null,
    reducedMotion: null,
  });
  assert.deepEqual(displayAttrs({ density: "compact", reducedMotion: true, expandSources: true }), {
    density: "compact",
    reducedMotion: "true",
  });
});

// ── 038: the Sources card preference ────────────────────────────────────────

test("038 — sources are folded by default", () => {
  // The card regularly ran longer than the answer it supported, so the thing the user asked for
  // was the smallest object on the screen.
  assert.equal(DEFAULT_DISPLAY_PREFS.expandSources, false);
});

test("038 — a stored preference is honoured, and a bad one is ignored", () => {
  assert.equal(coerceDisplayPrefs({ expandSources: true }).expandSources, true);
  assert.equal(coerceDisplayPrefs({ expandSources: "yes" }).expandSources, false);
  assert.equal(coerceDisplayPrefs({ expandSources: 1 }).expandSources, false);
});

test("038 — a blob written before this preference existed still loads", () => {
  // Every device already has a stored display blob without this key. It must read as the default,
  // not as undefined, or the card renders neither open nor closed.
  const old = { density: "compact", reducedMotion: true };
  const out = coerceDisplayPrefs(old);
  assert.equal(out.expandSources, false);
  assert.equal(out.density, "compact", "the fields that were there are untouched");
  assert.equal(out.reducedMotion, true);
});

test("038 — the preference does not leak into the html data attributes", () => {
  // density and reduced-motion are stamped on <html> for CSS. This one is read by a component, so
  // stamping it would be a second source of truth that could disagree with the first.
  const attrs = displayAttrs({ density: "comfortable", reducedMotion: false, expandSources: true });
  assert.deepEqual(attrs, { density: null, reducedMotion: null });
});
