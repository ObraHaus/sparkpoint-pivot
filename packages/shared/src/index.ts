/**
 * @sparkpoint/shared — the single source of truth.
 *
 * W2 fills these seams (chainId-keyed per R14):
 *   - policy/    caps, slippage, allowlist, enums, reason codes, policyVersion
 *   - addresses/ Record<chainId, AddressBook> per chain (base, baseSepolia, localFork)
 *   - schemas/   zod wire schemas (IntentBundle, SimulationResult, PolicyVerdict, ...)
 *   - abis/      ABIs exported from the contracts build
 *
 * These are consumed once by the on-chain deploy scripts, the off-chain policy
 * layer, and the client policy mirror; T098 (policy-parity.yml) fails the
 * pipeline on any drift between them.
 */
export const SHARED_PACKAGE = "@sparkpoint/shared" as const;

// Policy foundation (T009 enums + T010 constants). addresses/ and schemas/ are
// re-exported by their owning tasks and via the package `exports` subpaths.
export * from "./policy/index.js";

// Address registry (T011): per-chain AddressBook + TargetRef resolution (R14).
export * from "./addresses/index.js";

// Zod wire schemas (T012) — the fail-closed mirror of agent-service-api.md §2.
export * from "./schemas/index.js";
