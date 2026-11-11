import test from "node:test";
import assert from "node:assert/strict";

import {
  portfolioConnectCopy,
  railPortfolioNote,
  railShowsMockPreview,
} from "./liveState.ts";

test("a signed-in NEAR session never gets the illustrative portfolio preview", () => {
  assert.equal(railShowsMockPreview({ evmConnected: false, nearSignedIn: true }), false);
  assert.equal(
    railPortfolioNote({ nearSignedIn: true, preview: false, live: false, loading: false }),
    "Vault position is EVM-only — connect an EVM wallet.",
  );
  // The mock figure stays available only to a genuinely signed-out browser.
  assert.equal(railShowsMockPreview({ evmConnected: false, nearSignedIn: false }), true);
  assert.equal(
    railPortfolioNote({ nearSignedIn: false, preview: true, live: false, loading: false }),
    "Preview — connect for your position",
  );
});

test("portfolio empty copy tells a NEAR viewer what is EVM-only and where NEAR data is", () => {
  for (const area of ["portfolio", "history", "allocation", "positions"] as const) {
    const copy = portfolioConnectCopy({ nearSignedIn: true, area });
    assert.match(copy, /Connect an EVM wallet/);
    assert.match(copy, /NEAR\/Rhea positions are under Across chains/);
  }
});

test("anonymous copy is unchanged", () => {
  assert.equal(
    portfolioConnectCopy({ nearSignedIn: false, area: "portfolio" }),
    "Connect your wallet to see your portfolio.",
  );
});
