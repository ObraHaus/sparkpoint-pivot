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
