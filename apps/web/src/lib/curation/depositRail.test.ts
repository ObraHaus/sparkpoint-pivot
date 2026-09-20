import assert from "node:assert/strict";
import { test } from "node:test";

import {
  depositRail,
  directFeeDisclosure,
  findKnownVault,
  wrapperFeeDisclosure,
  type ExplorerLink,
  type KnownVault,
  type RailVault,
} from "./depositRail.ts";

/** Stub explorer: only chains with a public explorer return a URL (31337 does not). */
const explorer: ExplorerLink = (chainId, address) =>
  chainId === 4663 ? `https://explorer.example/address/${address}` : undefined;

const WRAPPER = "0xWraPper0000000000000000000000000000000001";
const DIRECT = "0xDirect00000000000000000000000000000000001";

function vault(over: Partial<RailVault> = {}): RailVault {
  return {
    chainId: 4663,
    address: DIRECT,
    label: "Alpha USDC",
    wrapped: false,
    wrapperAddress: null,
    depositMode: "direct",
    ...over,
  };
}

const KNOWN: KnownVault[] = [
  { address: WRAPPER, depositHref: `/vault/deposit?vault=${WRAPPER}` },
  { address: DIRECT, depositHref: `/vault/deposit?vault=${DIRECT}` },
];

test("a wrapped vault with a deployed wrapper routes to the wrapper deposit and discloses the fee", () => {
  const rail = depositRail(
    vault({ wrapped: true, wrapperAddress: WRAPPER, depositMode: "wrapper" }),
    KNOWN,
    explorer,
  );
  assert.equal(rail.kind, "wrapper");
  if (rail.kind === "wrapper") {
    assert.match(rail.href, /vault=0xWraPper/);
    assert.match(rail.disclosure, /gains above the high-water mark/);
    assert.match(rail.disclosure, /no deposit fee/i);
  }
});

test("a deployed wrapper this build cannot route into gets the truth, not 'not deployed'", () => {
  const rail = depositRail(
    vault({ wrapped: true, wrapperAddress: "0xDeployed", depositMode: "wrapper" }),
    KNOWN,
    explorer,
  );
  assert.equal(rail.kind, "wrapper-pending");
  if (rail.kind === "wrapper-pending") {
    assert.match(rail.label, /coming soon/i);
    assert.match(rail.note, /deployed on-chain/);
    assert.equal("href" in rail, false);
  }
});

test("a wrapped record with NO wrapper address gets the honest not-deployed note", () => {
  const rail = depositRail(
    vault({ wrapped: true, wrapperAddress: null, depositMode: "wrapper" }),
    KNOWN,
    explorer,
  );
  assert.equal(rail.kind, "wrapper-pending");
  if (rail.kind === "wrapper-pending") {
    assert.match(rail.note, /not deployed yet/);
    assert.equal("href" in rail, false);
  }
});

test("an unwrapped registered vault routes to the in-app direct deposit with no-fee disclosure", () => {
  const rail = depositRail(vault(), KNOWN, explorer);
  assert.equal(rail.kind, "direct");
  if (rail.kind === "direct") {
    assert.match(rail.href, /vault=0xDirect/);
    assert.match(rail.disclosure, /charges no fee/);
  }
});

test("an unwrapped external vault opens its explorer page — a raw ERC-4626 deposit is user-signed", () => {
  const rail = depositRail(
    vault({ address: "0x1111111111111111111111111111111111111111" }),
    KNOWN,
    explorer,
  );
  assert.equal(rail.kind, "direct-external");
  if (rail.kind === "direct-external") {
    assert.match(rail.href, /0x1111111111111111111111111111111111111111/i);
    assert.match(rail.disclosure, /directly into the vault contract/);
  }
});

test("no explorer and no in-app rail means no fabricated link", () => {
  const rail = depositRail(vault({ chainId: 31337 }), [], explorer);
  assert.equal(rail.kind, "wrapper-pending");
  assert.match(
    rail.kind === "wrapper-pending" ? rail.note : "",
    /isn't registered|no public explorer/,
  );
});

test("known-vault matching is case-insensitive; missing addresses never match", () => {
  assert.ok(findKnownVault(WRAPPER.toLowerCase(), KNOWN));
  assert.equal(findKnownVault(null, KNOWN), undefined);
  assert.equal(findKnownVault("", KNOWN), undefined);
});

test("both disclosures state the performance-fee-only model in the user's terms", () => {
  assert.match(wrapperFeeDisclosure("the wrapper"), /performance fee/);
  assert.match(wrapperFeeDisclosure("the wrapper"), /losing position/);
  assert.match(directFeeDisclosure(), /withdraw directly/);
});
