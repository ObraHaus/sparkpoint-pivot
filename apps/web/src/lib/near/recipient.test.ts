import test from "node:test";
import assert from "node:assert/strict";

import { resolveCrossChainRecipient } from "./recipient.ts";

const EVM = "0x1111111111111111111111111111111111111111";
const NEAR = "sparkpoint2026.near";

test("EVM destination still prefills the connected EVM wallet", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "evm",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: NEAR,
    }),
    { value: EVM, source: "evm" },
  );
});

test("NEAR destination prefills the connected NEAR account", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: NEAR,
    }),
    { value: NEAR, source: "near" },
  );
});

test("an explicit override wins for every family, including clearing the field", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: "someone.near",
      evmAddress: EVM,
      nearAccountId: NEAR,
    }),
    { value: "someone.near", source: "manual" },
  );
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: "",
      evmAddress: EVM,
      nearAccountId: NEAR,
    }),
    { value: "", source: "manual" },
  );
});

test("no connected account of the matching family leaves the field empty", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: null,
    }),
    { value: "", source: "none" },
  );
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "sol",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: NEAR,
    }),
    { value: "", source: "none" },
  );
});

test("a recipient named in chat prefills a NEAR destination over a connected NEAR wallet", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: "connected.near",
      namedRecipient: NEAR,
    }),
    { value: NEAR, source: "named" },
  );
});

test("a named recipient also prefills when no NEAR wallet is connected", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: null,
      namedRecipient: NEAR,
    }),
    { value: NEAR, source: "named" },
  );
});

test("an explicit override still wins over a named recipient", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: "someone.else.near",
      evmAddress: EVM,
      nearAccountId: "connected.near",
      namedRecipient: NEAR,
    }),
    { value: "someone.else.near", source: "manual" },
  );
});

test("blank named recipients are ignored so the connected wallet can still prefill", () => {
  assert.deepEqual(
    resolveCrossChainRecipient({
      destinationKind: "near",
      recipientOverride: null,
      evmAddress: EVM,
      nearAccountId: NEAR,
      namedRecipient: "   ",
    }),
    { value: NEAR, source: "near" },
  );
});

