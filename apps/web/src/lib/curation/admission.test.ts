import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADMISSION_TONE,
  admissionRows,
  admissionSalt,
  cooldownHours,
  createVaultArgs,
  hoursToSeconds,
  phaseOf,
  remainingLabel,
  type AdmissionCandidate,
  type AdmissionEntry,
} from "./admission.ts";

const CHILD = "0x2222222222222222222222222222222222222222";
const NOW = 1_700_000_000;

function entry(over: Partial<AdmissionEntry> = {}): AdmissionEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    childAddress: CHILD,
    byAddress: "0xb555dbec2cc5908c8b245ed84cb038d5d205d875",
    readyAt: NOW + 86_400,
    ready: false,
    feeBps: 1000,
    perUserCap: "5000000000",
    totalCap: "1000000000000",
    vaultCap: "1000000000000",
    name: "Steakhouse USDG",
    symbol: "spUSDG",
    label: "Steakhouse USDG · SparkPoint wrapper",
    status: "pending",
    txHash: null,
    proxyAddress: null,
    capRegistry: null,
    error: null,
    createdAt: "2026-09-19T12:00:00+00:00",
    updatedAt: "2026-09-19T12:00:00+00:00",
    ...over,
  };
}

function candidate(over: Partial<AdmissionCandidate> = {}): AdmissionCandidate {
  return {
    childAddress: CHILD,
    vaultLabel: "Steakhouse USDG",
    assetSymbol: "USDG",
    assetDecimals: 6,
    status: "none",
    byAddress: null,
    readyAt: null,
    feeBps: 1000,
    perUserCap: "5000000000",
    totalCap: "1000000000000",
    vaultCap: "1000000000000",
    name: "Steakhouse USDG",
    symbol: "spUSDG",
    label: "Steakhouse USDG · SparkPoint wrapper",
    ...over,
  };
}

test("phaseOf: the full admission table", () => {
  assert.equal(phaseOf(null, NOW), "not-admitted");
  assert.equal(phaseOf(entry({ readyAt: NOW + 10 }), NOW), "cooling");
  assert.equal(phaseOf(entry({ readyAt: NOW }), NOW), "ready");
  assert.equal(phaseOf(entry({ readyAt: 0 }), NOW), "ready");
  assert.equal(phaseOf(entry({ status: "deployed" }), NOW), "deployed");
  assert.equal(phaseOf(entry({ status: "cancelled" }), NOW), "cancelled");
  assert.equal(phaseOf(entry({ status: "failed" }), NOW), "failed");
});

test("remainingLabel is honest and never negative", () => {
  assert.equal(remainingLabel(0, NOW), "ready now");
  assert.equal(remainingLabel(NOW - 500, NOW), "ready now");
  assert.equal(remainingLabel(NOW + 45, NOW), "45s");
  assert.equal(remainingLabel(NOW + 121, NOW), "2m 1s");
  assert.equal(remainingLabel(NOW + 86_400 + 60, NOW), "24h 1m");
});

test("admissionSalt matches the runner's saltForChild exactly", () => {
  // Same value as runners/src/shared/wrapper.ts saltForChild — one formula, two languages.
  assert.equal(
    admissionSalt(CHILD),
    "0xf31fefe1aad707d3eb6700822fea1deff026e7d4c2a3fa58749a8340691205ca",
  );
  assert.equal(admissionSalt(CHILD.toUpperCase().replace("0X", "0x")), admissionSalt(CHILD));
});

test("createVaultArgs maps the wire params to the factory tuple", () => {
  const args = createVaultArgs(candidate());
  assert.equal(args.child, CHILD);
  assert.equal(args.feeBps, 1000);
  assert.equal(args.perUserCap, 5_000_000_000n);
  assert.equal(args.totalCap, 1_000_000_000_000n);
  assert.equal(args.salt, admissionSalt(CHILD));
});

test("cooldown hours convert within the on-chain bounds only", () => {
  assert.equal(cooldownHours(86_400), 24);
  assert.equal(hoursToSeconds(1), 3_600);
  assert.equal(hoursToSeconds(24), 86_400);
  assert.equal(hoursToSeconds(168), 604_800);
  assert.equal(hoursToSeconds(0), null);
  assert.equal(hoursToSeconds(169), null);
  assert.equal(hoursToSeconds(1.5), null);
});

test("admissionRows keeps live candidates and appends history", () => {
  const rows = admissionRows({
    entries: [entry(), entry({ childAddress: "0x3333333333333333333333333333333333333333", status: "deployed" })],
    pending: 1,
    candidates: [candidate()],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.kind, "candidate");
  if (rows[0]?.kind === "candidate") assert.equal(rows[0].entry?.id, entry().id);
  assert.equal(rows[1]?.kind, "history");
});

test("every phase has a tone and a label", () => {
  for (const phase of ["not-admitted", "cooling", "ready", "deployed", "cancelled", "failed"] as const) {
    assert.ok(ADMISSION_TONE[phase]);
  }
});
