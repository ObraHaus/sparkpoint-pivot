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
