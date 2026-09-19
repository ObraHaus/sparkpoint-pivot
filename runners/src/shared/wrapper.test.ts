import assert from "node:assert/strict";
import { test } from "node:test";

import { toEventSelector, toFunctionSelector } from "viem";
import type { Address } from "viem";

import {
  FACTORY_ABI,
  ZERO_ADDRESS,
  decideAdmission,
  isAddress,
  prepareCandidate,
  saltForChild,
  type AdmissionState,
  type DeployerConfig,
  type WrapperCandidate,
} from "./wrapper.ts";

const CHILD = "0x3333333333333333333333333333333333333333" as Address;
const RUNNER = "0x7777777777777777777777777777777777777777" as Address;
const ADMIN = "0x8888888888888888888888888888888888888888" as Address;
const WRAPPER = "0x9999999999999999999999999999999999999999" as Address;

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

function candidate(over: Partial<WrapperCandidate> = {}): WrapperCandidate {
  return {
    childAddress: CHILD,
    feeBps: 1000,
    perUserCap: "1000000000",
    totalCap: "100000000000",
    vaultCap: "100000000000",
    name: "SparkPoint Wrapped Steakhouse USDG",
    symbol: "spwSTEAKUSDG",
    label: "Steakhouse USDG",
    ...over,
  };
}

function state(over: Partial<AdmissionState> = {}): AdmissionState {
  return { wrapper: ZERO_ADDRESS, whitelistedBy: ZERO_ADDRESS, ready: false, ...over };
}

test("a well-formed candidate maps to the factory's CreateVaultParams", () => {
  const check = prepareCandidate(candidate(), CONFIG);
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.args.child, CHILD);
  assert.equal(check.args.feeBps, 1000);
  assert.equal(check.args.perUserCap, 1_000_000_000n);
  assert.equal(check.args.totalCap, 100_000_000_000n);
  assert.equal(check.args.salt, saltForChild(CHILD));
});

test("the salt is deterministic per child and distinct across children", () => {
  const a = saltForChild(CHILD);
  const b = saltForChild(CHILD);
  const c = saltForChild(ADMIN);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test("malformed candidates are rejected locally with a reason", () => {
  const cases: [Partial<WrapperCandidate>, RegExp][] = [
    [{ childAddress: "0x123" as Address }, /not an address/],
    [{ feeBps: 2001 }, /outside 0\.\.2000/],
    [{ feeBps: 1.5 }, /outside 0\.\.2000/],
    [{ name: "" }, /non-empty/],
    [{ symbol: "" }, /non-empty/],
    [{ label: "" }, /non-empty/],
    [{ perUserCap: "abc" }, /integer strings/],
    [{ totalCap: "-1" }, /uint256/],
  ];
  for (const [over, pattern] of cases) {
    const check = prepareCandidate(candidate(over), CONFIG);
    assert.equal(check.ok, false, JSON.stringify(over));
    if (!check.ok) assert.match(check.reason, pattern);
  }
});

test("isAddress accepts only 20-byte 0x addresses", () => {
  assert.equal(isAddress(CHILD), true);
  assert.equal(isAddress("0x3333"), false);
  assert.equal(isAddress("3333333333333333333333333333333333333333"), false);
});

test("decideAdmission: the full provenance table", () => {
  assert.deepEqual(decideAdmission(state(), RUNNER), { action: "whitelist" });

  assert.deepEqual(decideAdmission(state({ whitelistedBy: RUNNER, ready: false }), RUNNER), {
    action: "wait",
  });
  assert.deepEqual(decideAdmission(state({ whitelistedBy: RUNNER, ready: true }), RUNNER), {
    action: "deploy",
  });

  const adminEntry = decideAdmission(state({ whitelistedBy: ADMIN, ready: true }), RUNNER);
  assert.equal(adminEntry.action, "skip");
  if (adminEntry.action === "skip") assert.match(adminEntry.reason, /admin/);

  const wrapped = decideAdmission(
    state({ wrapper: WRAPPER, whitelistedBy: RUNNER, ready: true }),
    RUNNER,
  );
  assert.equal(wrapped.action, "skip");
  if (wrapped.action === "skip") assert.match(wrapped.reason, /already wrapped/);
});

test("decideAdmission compares the provenance address case-insensitively", () => {
  const lower = RUNNER.toLowerCase() as Address;
  assert.deepEqual(decideAdmission(state({ whitelistedBy: lower, ready: true }), RUNNER), {
    action: "deploy",
  });
  assert.deepEqual(decideAdmission(state({ whitelistedBy: RUNNER, ready: true }), lower), {
    action: "deploy",
  });
});

test("selector pinning: the runner's ABI matches SparkPointVaultFactoryV3 exactly", () => {
  // Computed with `cast sig` against the compiled V3 contract ABI (`methodIdentifiers`), 2026-09-19.
  // If the contract's tuple/selectors change, these fail loudly instead of the runner sending
  // calldata the factory cannot decode.
  assert.equal(toFunctionSelector("whitelistVault(address)"), "0xe9d006ab");
  assert.equal(toFunctionSelector("whitelistOf(address)"), "0x91756d1f");
  assert.equal(toFunctionSelector("isReady(address)"), "0x3552f5a4");
  assert.equal(toFunctionSelector("wrapperOf(address)"), "0x0c9c836c");
  assert.equal(toFunctionSelector("cooldown()"), "0x787a08a6");
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
  assert.equal(
    toEventSelector("VaultCreated(address,address,address,address,uint16,string)"),
    "0x59c80c58f461e5039ee33543a5d2e9f755bd4cbbff26680185acd0361d43083b",
  );
  assert.equal(
    toEventSelector("VaultWhitelisted(address,address,uint64)"),
    "0xa7953ee9e888bc39dc33d2ac66c67af766e132e7ccbcb4e97c867350ba1cde94",
  );
});

test("the runner ABI carries only the AI's two writes and no admin/upgrade selector", () => {
  const names = FACTORY_ABI.filter((item) => item.type === "function").map(
    (item) => item.name as string,
  );
  assert.deepEqual(
    names.slice().sort(),
    [
      "cooldown",
      "createVault",
      "isReady",
      "predictVaultAddress",
      "whitelistOf",
      "whitelistVault",
      "wrapperOf",
    ],
  );
  const forbidden = [
    "unwhitelist",
    "releaseNow",
    "setCooldown",
    "grantRole",
    "revokeRole",
    "renounceRole",
    "setBeacon",
    "setGuardian",
    "setFeeRecipient",
    "setDeployLimit",
    "upgradeTo",
    "pause",
  ];
  for (const name of forbidden) {
    assert.equal(names.includes(name), false, `${name} must not be in the runner ABI`);
  }
});
