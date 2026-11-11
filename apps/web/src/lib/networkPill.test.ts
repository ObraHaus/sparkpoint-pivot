import test from "node:test";
import assert from "node:assert/strict";

import { networkPillLabel } from "./networkPill.ts";

test("the network pill shows the connected EVM chain when no NEAR account is connected", () => {
  assert.equal(
    networkPillLabel({ networkSettling: false, wrongNetwork: false, networkName: "Base" }),
    "Base",
  );
  assert.equal(
    networkPillLabel({
      networkSettling: false,
      wrongNetwork: false,
      networkName: "Base",
      nearAccountId: null,
    }),
    "Base",
  );
});

test("a connected NEAR account appends · NEAR to the EVM chain", () => {
  assert.equal(
    networkPillLabel({
      networkSettling: false,
      wrongNetwork: false,
      networkName: "Base",
      nearAccountId: "sparky.near",
    }),
    "Base · NEAR",
  );
});

test("settling and wrong-network states win over the NEAR suffix", () => {
  assert.equal(
    networkPillLabel({
      networkSettling: true,
      wrongNetwork: false,
      networkName: "Base",
      nearAccountId: "sparky.near",
    }),
    "Checking…",
  );
  assert.equal(
    networkPillLabel({
      networkSettling: false,
      wrongNetwork: true,
      networkName: "Base",
      nearAccountId: "sparky.near",
    }),
    "Unsupported network",
  );
});

test("a verified NEAR session shows NEAR, never Unsupported network", () => {
  assert.equal(
    networkPillLabel({
      networkSettling: false,
      wrongNetwork: false,
      networkName: "NEAR",
      nearAccountId: null,
    }),
    "NEAR",
  );
});
