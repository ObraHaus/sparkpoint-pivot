import test from "node:test";
import assert from "node:assert/strict";

import { liveEarnEnabled, liveEarnHref, kaminoServerLiveEnabled } from "./liveFlags.ts";

test("live earn is off unless the flag is exactly true", () => {
  assert.equal(liveEarnEnabled(undefined), false);
  assert.equal(liveEarnEnabled(""), false);
  assert.equal(liveEarnEnabled("false"), false);
  assert.equal(liveEarnEnabled("1"), false);
  assert.equal(liveEarnEnabled("yes"), false);
  assert.equal(liveEarnEnabled("true"), true);
  assert.equal(liveEarnEnabled(" TRUE "), true);
});

test("the server gate accepts either the server or public flag", () => {
  assert.equal(kaminoServerLiveEnabled({}), false);
  assert.equal(kaminoServerLiveEnabled({ EARN_LIVE_KAMINO: "true" }), true);
  assert.equal(kaminoServerLiveEnabled({ NEXT_PUBLIC_EARN_LIVE_KAMINO: "true" }), true);
  assert.equal(kaminoServerLiveEnabled({ EARN_LIVE_KAMINO: "false", NEXT_PUBLIC_EARN_LIVE_KAMINO: "TRUE" }), true);
});

test("the shared live link carries only the values it has", () => {
  assert.equal(
    liveEarnHref({ protocol: "kamino", vault: "DcCRSd", mode: "deposit", amount: "0.01", asset: "SOL", chain: "sol" }),
    "/vault/live?protocol=kamino&chain=sol&vault=DcCRSd&mode=deposit&amount=0.01&asset=SOL",
  );
  assert.equal(liveEarnHref({ protocol: "morpho" }), "/vault/live?protocol=morpho");
});
