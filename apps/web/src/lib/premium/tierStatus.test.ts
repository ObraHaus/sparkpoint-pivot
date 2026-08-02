import assert from "node:assert/strict";
import { test } from "node:test";

import { premiumStatusView, shortfallPurpose } from "./tierStatus.ts";

test("a premium tier with a valid expiry is active with a readable date", () => {
  const s = premiumStatusView("premium", "2026-09-02T17:13:35.644751+00:00");
  assert.equal(s.active, true);
  assert.ok(s.untilLabel && /2026/.test(s.untilLabel));
});

test("free, unknown, empty and null tiers all read as NOT premium (fail-open to today's UI)", () => {
  for (const tier of ["free", "", null, undefined, "PREMIUM", "gold"]) {
    assert.deepEqual(premiumStatusView(tier, "2026-09-02T00:00:00Z"), {
      active: false,
      untilLabel: null,
    });
  }
});

test("a premium tier with a missing or garbage expiry is still active, just dateless", () => {
  assert.deepEqual(premiumStatusView("premium", null), { active: true, untilLabel: null });
  assert.deepEqual(premiumStatusView("premium", "not-a-date"), { active: true, untilLabel: null });
});

test("the shortfall copy never claims a first month for an active subscriber", () => {
  assert.equal(
    shortfallPurpose(premiumStatusView("premium", null)),
    "to extend Premium by a month",
  );
  assert.equal(shortfallPurpose(premiumStatusView("free", null)), "for the first month");
});
