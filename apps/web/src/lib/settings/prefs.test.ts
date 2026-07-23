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
  assert.deepEqual(coerceDisplayPrefs({ density: "compact", reducedMotion: true }), {
    density: "compact",
    reducedMotion: true,
  });
  assert.equal(coerceDisplayPrefs({ density: "cozy" }).density, "comfortable"); // out-of-domain → default
  assert.equal(coerceDisplayPrefs({ reducedMotion: "true" }).reducedMotion, false); // string not bool → default
});

test("displayAttrs: comfortable / motion-on map to absent (null) attributes", () => {
  assert.deepEqual(displayAttrs({ density: "comfortable", reducedMotion: false }), {
    density: null,
    reducedMotion: null,
  });
  assert.deepEqual(displayAttrs({ density: "compact", reducedMotion: true }), {
    density: "compact",
    reducedMotion: "true",
  });
});
