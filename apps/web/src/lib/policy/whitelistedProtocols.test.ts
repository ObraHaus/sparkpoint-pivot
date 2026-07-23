import { test } from "node:test";
import assert from "node:assert/strict";
import {
  whitelistedProtocols,
  protocolLabel,
  actionLabel,
  type AllowlistRow,
  type WhitelistedProtocol,
} from "./whitelistedProtocols.ts";

// Base-Sepolia-shaped resolved allowlist (vault + Aave; Aerodrome is already stripped by
// getPolicyConstants as `undeployed` on 84532). Addresses = the real 84532 SoT.
const AAVE = "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27";
const VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2";

const ALLOWLIST: AllowlistRow[] = [
  { protocol: "sparkpoint_vault", targetRef: "sparkpoint_vault", action: "vault_deposit" },
  { protocol: "sparkpoint_vault", targetRef: "sparkpoint_vault", action: "vault_redeem" },
  { protocol: "sparkpoint_vault", targetRef: "sparkpoint_vault", action: "vault_withdraw" },
  { protocol: "aave_v3", targetRef: "aave_v3_pool", action: "aave_supply" },
  { protocol: "aave_v3", targetRef: "aave_v3_pool", action: "aave_withdraw" },
];

const RESOLVED: Record<string, string> = { sparkpoint_vault: VAULT, aave_v3_pool: AAVE };
const resolve = (ref: AllowlistRow["targetRef"]): string | undefined => RESOLVED[ref];

test("groups the allowlist into one row per resolved target, in order, accumulating actions", () => {
  const out = whitelistedProtocols(ALLOWLIST, resolve);
  assert.equal(out.length, 2);
  assert.equal(out[0].targetRef, "sparkpoint_vault");
  assert.equal(out[1].targetRef, "aave_v3_pool");
  assert.equal(out[1].label, "Aave v3 Pool");
  assert.equal(out[1].address, AAVE);
  assert.deepEqual(out[1].actions, ["aave_supply", "aave_withdraw"]);
});

test("drops an entry whose target does not resolve (fail-closed, no placeholder)", () => {
  const withUnresolved: AllowlistRow[] = [
    ...ALLOWLIST,
    { protocol: "aerodrome", targetRef: "aerodrome_router", action: "aerodrome_swap" },
  ];
  const out = whitelistedProtocols(withUnresolved, resolve); // resolver returns undefined for aerodrome_router
  assert.equal(out.length, 2);
  assert.equal(out.find((p) => p.targetRef === "aerodrome_router"), undefined);
});

test("empty allowlist ⇒ no rows (46630 fail-closed)", () => {
  assert.deepEqual(whitelistedProtocols([], resolve), []);
});

test("caller can exclude the SparkPoint vault to leave external venues only (the /trust card)", () => {
  const external = whitelistedProtocols(ALLOWLIST, resolve).filter(
    (p) => p.targetRef !== "sparkpoint_vault",
  );
  assert.equal(external.length, 1);
  assert.equal(external[0].label, "Aave v3 Pool");
  assert.equal(external[0].address, AAVE);
});

test("protocolLabel & actionLabel map known values and fall back to the raw string", () => {
  assert.equal(protocolLabel("aave_v3"), "Aave v3 Pool");
  assert.equal(protocolLabel("unknown_proto"), "unknown_proto");
  assert.equal(actionLabel("aave_supply"), "Supply");
  assert.equal(actionLabel("aave_withdraw"), "Withdraw");
  assert.equal(actionLabel("mystery"), "mystery");
});

// keep the type-only import used under strict/no-unused lint (mirrors vaultOptions.test.ts)
export type _W = WhitelistedProtocol;
