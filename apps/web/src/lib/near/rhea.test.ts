import test from "node:test";
import assert from "node:assert/strict";

import { rheaAccountSourceLabel, selectRheaAccount } from "./rhea.ts";

test("the connected NEAR account is used first", () => {
  assert.deepEqual(
    selectRheaAccount({
      connectedNearAccountId: "sparkpoint2026.near",
      pasted: "someone.near",
      rheaRecipient: "multica.near",
    }),
    { accountId: "sparkpoint2026.near", source: "connected" },
  );
});

test("a pasted account is the fallback when no wallet is connected", () => {
  assert.deepEqual(
    selectRheaAccount({
      connectedNearAccountId: null,
      pasted: "someone.near",
      rheaRecipient: "multica.near",
    }),
    { accountId: "someone.near", source: "pasted" },
  );
});

test("the preview's Rhea recipient is the last honest fallback", () => {
  assert.deepEqual(
    selectRheaAccount({
      connectedNearAccountId: null,
      pasted: "not valid!",
      rheaRecipient: "multica.near",
    }),
    { accountId: "multica.near", source: "rhea_recipient" },
  );
  assert.deepEqual(
    selectRheaAccount({ connectedNearAccountId: null, pasted: "", rheaRecipient: undefined }),
    { accountId: null, source: "none" },
  );
});

test("the source label names which account is used", () => {
  assert.match(rheaAccountSourceLabel("connected"), /connected NEAR wallet/i);
  assert.match(rheaAccountSourceLabel("pasted"), /pasted/i);
  assert.match(rheaAccountSourceLabel("rhea_recipient"), /Rhea account/i);
  assert.match(rheaAccountSourceLabel("none"), /No NEAR account/i);
});
