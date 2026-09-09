/**
 * COMPILE-TIME parity guard: `chains/index.ts` `CHAIN_IDS` vs `policy/constants.ts` `CHAIN_ID`.
 *
 * Two chain-id declarations now exist, and they exist for a reason that cannot be removed:
 * `chains/index.ts` must stay a LEAF (no relative imports, no enums) so `apps/web` unit tests can
 * value-import it under `node --experimental-strip-types`, while `policy/constants.ts` legitimately
 * imports `./enums` and is therefore unreachable from that runner. Duplication was the price of the
 * leaf rule — so the duplication is checked here instead of trusted.
 *
 * The check is types-only and runs inside `tsc --noEmit`, which is already a CI gate for this package
 * (`pnpm --filter @sparkpoint/shared typecheck`) and for `apps/web`. A drift — a renamed key, or the
 * same key with a different id — becomes a compile error naming the offending key, not a runtime
 * surprise on some chain nobody tested.
 *
 * THIS FILE MUST NOT BE IMPORTED BY `chains/index.ts`. It pulls in `../policy/index`, so importing it
 * from the barrel would drag the TS `enum` back into the leaf module and break every web unit test
 * that value-imports the chain registry. It is a standalone compilation unit, imported by nothing —
 * `tsc` still checks it because it sits under `src`.
 *
 * Direction of the assertion: `CHAIN_ID` (policy) ⊆ `CHAIN_IDS` (chains), key-for-key and
 * value-for-value. The chains registry is deliberately the WIDER of the two — it also declares
 * Robinhood mainnet 4663, which constitution v3.0.0 ratified but which is not yet wired into the
 * policy chain map, has no address book, and is rejected by the agent's supported-chain list. So a
 * new id may be declared in `chains` before `policy` learns about it, but never the reverse: an id
 * the policy engine acts on that has no metadata would render as "Unsupported network" with no
 * explorer link.
 */

import { CHAIN_ID } from "../policy/index";
import { CHAIN_IDS } from "./index";

/** Compile error iff `T` is not exactly `true`. */
type Assert<T extends true> = T;

/** Structural equality for the narrow literal shapes these two objects have. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * Every key of the policy `CHAIN_ID` must exist in `CHAIN_IDS` carrying the SAME literal id.
 *
 * Mapped over the policy keys, so the error message points at the specific key that drifted rather
 * than failing opaquely on the whole object.
 */
type PolicyKeysAgree = {
  readonly [K in keyof typeof CHAIN_ID]: K extends keyof typeof CHAIN_IDS
    ? Equals<(typeof CHAIN_ID)[K], (typeof CHAIN_IDS)[K]> extends true
      ? true
      : // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the message IS the failure
        { drift: K; policy: (typeof CHAIN_ID)[K]; chains: (typeof CHAIN_IDS)[K] }
    : { missingFromChainsRegistry: K };
};

type AllTrue<T> = T[keyof T] extends true ? true : false;

// The actual gate. If this line errors, a chain id drifted between the two registries.
export type _ChainIdParity = Assert<AllTrue<PolicyKeysAgree>>;

/**
 * Runtime belt-and-braces, exported so a caller MAY assert it, but never invoked on import (this
 * module has no side effects). Kept because the type-level check above cannot catch a `CHAIN_ID`
 * whose declared type has widened to `number` somewhere upstream.
 */
export function assertChainIdParity(): void {
  for (const [key, value] of Object.entries(CHAIN_ID)) {
    const mine = (CHAIN_IDS as Record<string, number>)[key];
    if (mine !== value) {
      throw new Error(
        `chain-id parity drift: policy CHAIN_ID.${key} = ${value} but chains CHAIN_IDS.${key} = ${String(mine)}`,
      );
    }
  }
}
