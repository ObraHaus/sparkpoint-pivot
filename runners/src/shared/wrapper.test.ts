import assert from "node:assert/strict";
import { test } from "node:test";

import { toEventSelector, toFunctionSelector } from "viem";

import {
  FACTORY_ABI,
  isAddress,
  prepareJob,
  saltForJob,
  type DeployerConfig,
  type WrapperJob,
} from "./wrapper.ts";

const CONFIG: DeployerConfig = {
  chainId: 4663,
  rpcUrl: "https://rpc.example",
  factoryAddress: "0x1111111111111111111111111111111111111111",
  apiBaseUrl: "http://agent:31102",
  s2sToken: "s2s",
  reportOwner: "0x2222222222222222222222222222222222222222",
  pollSec: 120,
  maxFeeBps: 2000,
  fetchTimeoutSec: 30,
};

function job(over: Partial<WrapperJob> = {}): WrapperJob {
  return {
    id: "01234567-89ab-4cde-8fab-0123456789ab",
    chainId: 4663,
    childAddress: "0x3333333333333333333333333333333333333333",
    feeBps: 1000,
    perUserCap: "1000000000",
    totalCap: "100000000000",
    vaultCap: "100000000000",
    name: "SparkPoint Universal USDC",
    symbol: "spuUSDC",
    label: "Curated wrapper",
    ...over,
  };
}

test("a well-formed job maps to the factory's CreateVaultParams", () => {
  const check = prepareJob(job(), CONFIG);
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.args.child, job().childAddress);
  assert.equal(check.args.feeBps, 1000);
  assert.equal(check.args.perUserCap, 1_000_000_000n);
  assert.equal(check.args.totalCap, 100_000_000_000n);
  assert.equal(check.args.salt, saltForJob(job().id));
});

test("the salt is deterministic per request id and distinct across ids", () => {
  const a = saltForJob("01234567-89ab-4cde-8fab-0123456789ab");
  const b = saltForJob("01234567-89ab-4cde-8fab-0123456789ab");
  const c = saltForJob("11234567-89ab-4cde-8fab-0123456789ab");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("malformed jobs are rejected locally with a reason", () => {
  const cases: [Partial<WrapperJob>, RegExp][] = [
    [{ id: "not-a-uuid" }, /not a UUID/],
    [{ chainId: 8453 }, /chain/],
    [{ childAddress: "0x123" }, /not an address/],
    [{ feeBps: 2001 }, /outside 0\.\.2000/],
    [{ name: "" }, /non-empty/],
    [{ perUserCap: "abc" }, /integer strings/],
    [{ totalCap: "-1" }, /uint256/],
  ];
  for (const [over, pattern] of cases) {
    const check = prepareJob(job(over), CONFIG);
    assert.equal(check.ok, false, JSON.stringify(over));
    if (!check.ok) assert.match(check.reason, pattern);
  }
});

test("isAddress accepts only 20-byte 0x addresses", () => {
  assert.equal(isAddress("0x3333333333333333333333333333333333333333"), true);
  assert.equal(isAddress("0x3333"), false);
  assert.equal(isAddress("3333333333333333333333333333333333333333"), false);
});

test("selector pinning: the runner's ABI matches SparkPointVaultFactoryV2 exactly", () => {
  // Computed with `cast sig` against the compiled contract ABI. If the contract's tuple changes,
  // these fail loudly instead of the runner sending calldata the factory cannot decode.
  assert.equal(
    toFunctionSelector(
      "createVault((address,uint16,uint256,uint256,uint256,string,string,string,bytes32))",
    ),
    "0x0dd53a0d",
  );
  assert.equal(
    toFunctionSelector(
      "predictVaultAddress((address,uint16,uint256,uint256,uint256,string,string,string,bytes32))",
    ),
    "0x8d723339",
  );
  assert.equal(toFunctionSelector("isAllowlisted(address)"), "0x05a3b809");
  assert.equal(
    toEventSelector("VaultCreated(address,address,address,address,uint16,string)"),
    "0x59c80c58f461e5039ee33543a5d2e9f755bd4cbbff26680185acd0361d43083b",
  );
});

test("the runner ABI contains NO privileged selector (no upgrade/allowlist/pause)", () => {
  const names = FACTORY_ABI.filter((item) => item.type === "function").map((item) => item.name);
  assert.deepEqual(names.slice().sort(), ["createVault", "isAllowlisted", "predictVaultAddress"]);
});
