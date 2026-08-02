import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INLINE_EXECUTABLE_ACTION_TYPES,
  isInlineExecutable,
  unsupportedActionBody,
  unsupportedActionLabel,
  unsupportedActionTitle,
  unsupportedIntent,
} from "./actionSupport.ts";

/** The full §2.2 ActionType taxonomy (packages/shared policy/enums.ts). */
const ALL_ACTION_TYPES = [
  "vault_deposit",
  "vault_withdraw",
  "vault_redeem",
  "aave_supply",
  "aave_withdraw",
  "aerodrome_swap",
  "session_key_grant",
  "session_key_revoke",
];

test("the executable set is exactly the four types with a real in-app signing path", () => {
  assert.deepEqual([...INLINE_EXECUTABLE_ACTION_TYPES].sort(), [
    "aerodrome_swap",
    "vault_deposit",
    "vault_redeem",
    "vault_withdraw",
  ]);
});

test("aave_supply — the reported case — is NOT inline-executable", () => {
  assert.equal(isInlineExecutable("aave_supply"), false);
  assert.equal(isInlineExecutable("aave_withdraw"), false);
});

test("the vault + swap paths stay executable (untouched by this fix)", () => {
  assert.equal(isInlineExecutable("vault_deposit"), true);
  assert.equal(isInlineExecutable("vault_withdraw"), true);
  assert.equal(isInlineExecutable("vault_redeem"), true);
  assert.equal(isInlineExecutable("aerodrome_swap"), true);
});

test("an unknown / future action type falls to the inert notice, never to an executable path", () => {
  assert.equal(isInlineExecutable("morpho_deposit"), false);
  assert.equal(isInlineExecutable(""), false);
});

test("the fallback intent is inert and carries the real action type", () => {
  const intent = unsupportedIntent("aave_supply");
  assert.equal(intent.kind, "unsupported");
  assert.equal(intent.actionType, "aave_supply");
});

test("NO copy on the unsupported path implies a paywall — for ANY action type", () => {
  // The bug: the fallback rendered "Confirm: Premium subscription", so a purely technical gap
  // read as "this needs a paid tier". Nothing on this path may hint at payment ever again.
  const forbidden = /premium|subscription|upgrade|paid|pay\b|plan\b|tier|SRK|purchase|billing|unlock/i;
  const surfaces = [...ALL_ACTION_TYPES, "morpho_deposit", ""].flatMap((t) => [
    unsupportedActionLabel(t),
    unsupportedActionTitle(t),
    unsupportedActionBody(t),
  ]);
  for (const text of surfaces) {
    assert.equal(forbidden.test(text), false, `paywall-flavoured copy: ${JSON.stringify(text)}`);
  }
});

test("the notice states the non-custody facts: nothing signed, nothing moved, funds in wallet", () => {
  const body = unsupportedActionBody("aave_supply");
  assert.ok(/nothing to sign/i.test(body));
  assert.ok(/nothing has moved/i.test(body));
  assert.ok(/your wallet/i.test(body));
});

test("labels are human and never empty, including for unmapped types", () => {
  assert.equal(unsupportedActionLabel("aave_supply"), "Supplying directly to Aave");
  assert.equal(unsupportedActionLabel("session_key_grant"), "Granting a session key");
  assert.equal(unsupportedActionLabel("morpho_deposit"), "Morpho deposit");
  assert.equal(unsupportedActionLabel(""), "This action");
  for (const t of [...ALL_ACTION_TYPES, "", "weird-type"]) {
    assert.ok(unsupportedActionLabel(t).length > 0);
    assert.equal(unsupportedActionTitle(t).includes("undefined"), false);
  }
});

test("the title names the gap as availability, not entitlement", () => {
  assert.equal(
    unsupportedActionTitle("aave_supply"),
    "Supplying directly to Aave isn’t available in the app yet",
  );
});
