# Constitution Amendment v3.0.0 → v3.1.0 (MINOR)

**Date:** 2026-09-08 · **Operator:** aldrickb · **Status:** proposed (pending ratification-by-merge) · **Classification:** MINOR (standard amendment — no non-custody guarantee weakened; no super-majority required)

Establishes a **Robinhood-mainnet (chainId 4663) closed beta channel** and scopes two governance settings to it: **single-EOA ownership** for non-custodial operational contracts, and a **per-contract upgradeability policy**. See the "Mainnet beta channel — ownership & upgradeability" constraint and the amendment-log entry in `constitution.md`.

## Rationale

1. **Mainnet beta, not testnet.** Robinhood-Chain testnet DeFi liquidity and venues (DEXes especially) have thinned to where a testnet rehearsal no longer reflects production; mainnet execution is now cheap enough to run a gated beta on real rails. The closed beta therefore launches directly on 4663, beta-gated, with nominal/test-scale funds. This requires redeploying a fresh SRK token and Sparky Broker NFT onto 4663 (none exist there today).
2. **Single EOA (no multisig) — developer bandwidth.** Standing up and operating a 2-of-3 multisig is beyond current single-developer bandwidth. A single team-operated EOA will own the beta's 4663 contracts.
3. **Upgradeable for continuous development.** The operator asked whether contracts are upgradeable and to plan proxy/upgradeable contracts for ongoing mainnet development.

## The reconciliation (why the beta can ship both fast AND honest)

A census of all 16 deployable contracts (workflow, 2026-09-08) established two load-bearing facts:

- **The guardian/owner model is already safe under a single EOA.** The vault guardian is pause-only + a hard-capped (≤20%) forward-only fee + feeRecipient — there is *no* fund path. An EOA holding that role cannot move user funds. **What is NOT safe under an EOA is an *upgrade key over a value-bearing contract*** — that converts every "no admin fund path" guarantee into a rug.
- **Upgradeability already exists where it belongs.** `SparkPointAccount` is a UUPS proxy whose `_authorizeUpgrade` is gated to the **user's own EOA** (N3), never SparkPoint's. That is the correct template, not the thing to change.

Therefore: **a single EOA is safe *precisely because* the value/provenance contracts stay immutable**, and "continuous development" is achieved by the constitution's own ratified pattern — deploy a new instance and rewire the entitlement (`setMinter`/`setActivator`/`setBaseURI`) — with **no rug-key on the money contracts**.

## Per-contract decision matrix (4663 beta)

| Contract | Today | Owner (beta) | Upgradeable? | Why |
|---|---|---|---|---|
| **SparkPointAccount** (ERC-4337) | UUPS, user-owned | the **user** (N3) | Yes — already, user-only | Correct as-is. Operator EOA is expressly excluded from user-account upgrades. |
| **SRK token** (`SparkPointTestToken`) | immutable, no owner, fixed supply | n/a (no owner) | **No — immutable** | Fixed-supply/no-mint is fuzz-proven; faucet + activation trust depend on it. Redeploy fresh on 4663. |
| **Sparky Broker NFT** (separate repo) | immutable provenance + `MAX_SUPPLY`, Ownable2Step | single EOA | **No — immutable** | Frozen art = the entitlement. Flex via `setMinter`/`setActivator`/`setBaseURI-until-freeze`. |
| **BrokerRevenueDistributor** | immutable, no withdraw/sweep | single EOA | **No — immutable** | Holds pooled holder funds; an upgrade could add a sweep. EOA can `fundPeriod`/`publishAllocations` only — cannot drain or freeze existing claims. Keep claiming OFF until a funded run is verified. |
| **BrokerActivationRegistry** | immutable, `maxPrice` ceiling | single EOA | **No — immutable** | Spends user SRK allowances; upgrade = allowance drain. Rewire via `SparkyBroker.setActivator`. |
| **BrokerSale** | immutable, no custody | single EOA | Redeploy + `setMinter` | Fundless; the NFT's `setMinter` is the intended flex point — proxy redundant. |
| **SrkFaucet** | immutable, custom owner | single EOA | Redeploy (low priority) | Refundable float only; owner already controls it. |
| **SparkPointVaultFactory** | plain Ownable, deploys full-bytecode CREATE2 | single EOA / timelock | Optional (fundless) | May be UUPS if iteration needed — MUST keep deploying full-bytecode wrappers, never clones. |
| **SparkPointVault / SparkPointMorphoVault** | immutable (N5) | **DEFERRED — Base only** | **No — N5** | Not in the 4663 beta. Making it upgradeable/EOA-owned = separate MAJOR re-ratification. |
| **AaveV3Adapter**, **KillSwitch** | stubs | — | **Do not deploy to 4663** | Aave absent on 4663; KillSwitch unused (vault self-pauses). |

## What this amendment does NOT change (reaffirmed)

- **N1–N5** in full; the value-bearing contracts stay immutable, so "no admin can move funds" remains true by construction.
- **Non-upgradeable *vault* semantics** (N5, IV.6, wrapper-N5) and the **pause-only nature** of the kill-switch.
- The **Fee Wrapper's "owner is the multisig, never an EOA"** condition (Principle V) and the **multisig kill-switch** (IV.3) — for any fund-custody surface. These bind the deferred vault, not the beta.
- The **AI-disposition** rule (Principle II).

## Operator override (the one MAJOR path, NOT taken here)

If value-bearing contracts (SRK / distributor / NFT / a vault) are ever to be upgradeable-in-place under a single EOA, that is a deliberate move to a **custodial beta** and MANDATORILY requires: (a) a **super-majority re-ratification** (this is a custody-semantics change — cannot be done implicitly, `constitution.md` Governance); (b) deleting/weakening the N5 test batteries (`RefuteN5.t.sol`, `NonCustody.t.sol`) and the `AssertNonCustody.s.sol` deploy verifier (a UUPS proxy fails its own deploy gate); and (c) rewriting every "non-upgradeable / 2-of-3 multisig / no admin withdrawal / no withdraw-sweep-rescue" claim across the Trust Center, permissions page, vault page, and `REVENUE_SHARE_CUSTODY_NOTE` **before** any real deposit — anything less is on-chain-verifiably false.

## Affected artifacts / follow-ups (not done in this amendment)

- **Trust Center / permissions copy** must become 4663-aware: for 4663 contracts, "single team-operated EOA — no multisig, no timelock; contracts immutable" (`apps/web/src/app/(app)/trust/page.tsx`, `.../trust/permissions/page.tsx`). Do NOT show "2-of-3 multisig" for a 4663 contract.
- **DEPLOYMENT.md / COOLIFY.md** — record the EOA owner + the mainnet-beta channel.
- **Both changelogs** (`CHANGELOG.md` + in-app `/changelog`) — a custody/upgradeability posture change is client-visible.
- **Strategy artifact** (SparkPoint Mainnet Cutover) — updated in the same change.
