import test from "node:test";
import assert from "node:assert/strict";

import {
  RHEA_NEP413_RECIPIENT,
  buildRheaSignRequest,
  phaseCSignEnabled,
  randomNonce,
  shouldOfferRheaSign,
} from "./phaseC.ts";

test("Phase C is off unless the flag is exactly true", () => {
  assert.equal(phaseCSignEnabled(undefined), false);
  assert.equal(phaseCSignEnabled(""), false);
  assert.equal(phaseCSignEnabled("false"), false);
  assert.equal(phaseCSignEnabled("1"), false);
  assert.equal(phaseCSignEnabled("yes"), false);
  assert.equal(phaseCSignEnabled("true"), true);
  assert.equal(phaseCSignEnabled(" TRUE "), true);
});

test("with the flag off no sign call is offered even when everything else is ready", () => {
  assert.equal(
    shouldOfferRheaSign({
      enabled: false,
      accountId: "sparkpoint2026.near",
      messageToSign: '[{"EVM":"abc"}]',
    }),
    false,
  );
});

test("with the flag on signing needs a valid account and a message", () => {
  assert.equal(
    shouldOfferRheaSign({
      enabled: true,
      accountId: "sparkpoint2026.near",
      messageToSign: '[{"EVM":"abc"}]',
    }),
    true,
  );
  assert.equal(
    shouldOfferRheaSign({ enabled: true, accountId: null, messageToSign: "x" }),
    false,
  );
  assert.equal(
    shouldOfferRheaSign({ enabled: true, accountId: "not valid!", messageToSign: "x" }),
    false,
  );
  assert.equal(
    shouldOfferRheaSign({ enabled: true, accountId: "sparkpoint2026.near", messageToSign: "   " }),
    false,
  );
});

test("the NEP-413 request carries the preview message and a 32-byte nonce (never a transaction)", () => {
  const nonce = new Uint8Array(32).fill(7);
  const request = buildRheaSignRequest('[{"EVM":"abc"}]', nonce);
  assert.equal(request.message, '[{"EVM":"abc"}]');
  assert.equal(request.recipient, RHEA_NEP413_RECIPIENT);
  assert.equal(request.nonce.length, 32);
  assert.deepEqual([...request.nonce], [...nonce]);
  assert.equal("actions" in request, false);
  assert.equal("receiverId" in request, false);
});

test("randomNonce fills 32 bytes and throws when crypto.getRandomValues is unavailable", () => {
  const nonce = randomNonce();
  assert.equal(nonce.length, 32);
  assert.equal(nonce.every((byte) => byte === 0), false);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    assert.throws(() => randomNonce(), /crypto\.getRandomValues/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete (globalThis as { crypto?: Crypto }).crypto;
  }
});
