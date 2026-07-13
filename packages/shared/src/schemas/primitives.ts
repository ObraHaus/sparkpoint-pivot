/**
 * Shared zod primitives for the agent-service wire schemas.
 *
 * Grounding: agent-service-api.md §1.4 (money = raw base-unit integer STRINGS +
 * decimals; USD = decimal strings; never floats), §1.1/§1.2 (chainId), §2.1
 * (0x-prefixed hex address/calldata/quantity fields), §2 (ISO-8601 timestamps).
 *
 * Design notes:
 *  - Hex values are BRANDED as `0x${string}` (chain-facing, no `any`) via a
 *    predicate that does NOT mutate the value — the service's byte-for-byte
 *    payload match (§3.6 submit-signed-tx) must compare the exact bytes, so a
 *    validating schema here may never lower-case/normalize/re-encode.
 *  - Amounts are strings, not numbers: JSON numbers lose precision past 2^53 and
 *    float-drift breaks reconstructability (§1.4, N5).
 */

import { z } from "zod";

import { CHAIN_ID, POLICY_VERSION } from "../policy/constants.js";

/** A 0x-prefixed, 20-byte EVM address (checksum-agnostic; value NOT normalized). */
export const HexAddressSchema = z.custom<`0x${string}`>(
  (v): v is `0x${string}` =>
    typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v),
  { message: "expected a 0x-prefixed 20-byte address" },
);

/** 0x-prefixed hex byte-string of any (even) length — calldata / factoryData. `0x` is valid (empty). */
export const HexDataSchema = z.custom<`0x${string}`>(
  (v): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v),
  { message: "expected 0x-prefixed hex data" },
);

/** 0x-prefixed hex quantity (≥ 1 nibble) — nonce, gas limits, fee caps, gas estimate. */
export const HexQuantitySchema = z.custom<`0x${string}`>(
  (v): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v),
  { message: "expected a 0x-prefixed hex quantity" },
);

/** Unsigned raw base-unit integer as a string, e.g. USDC `"100000000"` (§1.4). */
export const UintAmountSchema = z
  .string()
  .regex(/^\d+$/, "expected an unsigned base-unit integer string");

/** Signed raw base-unit integer as a string, e.g. a balance delta `"-100000000"` (§2.3). */
export const IntAmountSchema = z
  .string()
  .regex(/^-?\d+$/, "expected a signed base-unit integer string");

/** USD value as a decimal string, e.g. `"100.00"` / `"-0.25"` (§1.4). Never a float. */
export const UsdStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a decimal USD string");

/** ISO-8601 UTC timestamp, e.g. `"2026-06-15T12:34:56Z"` (expiresAt / asOf). */
export const IsoDateTimeSchema = z
  .string()
  .datetime({ message: "expected an ISO-8601 UTC datetime" });

/**
 * Supported chain ids (R14): 8453 Base · 84532 Base Sepolia · 31337 localFork.
 * Reuses the foundation `CHAIN_ID` constant so the wire never drifts from the
 * policy layer's chain set; infers to `8453 | 84532 | 31337` (== ChainId).
 */
export const ChainIdSchema = z.union([
  z.literal(CHAIN_ID.base),
  z.literal(CHAIN_ID.baseSepolia),
  z.literal(CHAIN_ID.localFork),
]);

/**
 * The pinned policy version stamped on every state-changing artifact (§2.1/§2.4,
 * N5). Pinned to the foundation `POLICY_VERSION` literal so a mismatched wire
 * version fails validation (fail-closed); bumps the constant, schema follows.
 */
export const PolicyVersionSchema = z.literal(POLICY_VERSION);
