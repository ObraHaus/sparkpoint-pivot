# Constitution Amendment v3.2.0 → v4.0.0 (MAJOR)

**Date:** 2026-09-18 · **Operator:** aldrickb · **Status:** ratified by operator directive (super-majority re-ratification granted 2026-09-18) · **Classification:** **MAJOR** — redefines NON-NEGOTIABLE N5 (`non-upgradeable` custody semantics) and Guardrail IV.6, and extends the upgradeability constraint to admit a TimelockController-owned wrapper beacon. Adopted alongside a new upgradeable wrapper family and a scoped automated deployer.

## Why (operator directive)

> *"Bring back the vault wrapper — an upgradeable one — but make it universal, since all vaults share the same format. A factory which is also upgradable, and the per-vault wrapper is also upgradable, so when we create a wrapper we deploy a proxy — cheaper on gas — and we can upgrade the code. Also give our AI a dedicated wallet so the AI can deploy the wrapper on its own."*

The off-chain program (spec 048: curator, curated store, admin panel, `/vault` board, chat answers) is built and gated green. The on-chain wrapper (M1) is the remaining piece. This amendment adopts the **beacon fleet + scoped AI deployer** architecture studied in `sparkpoint-ai-morpho-vaults-plan.html` §4–§8 (research memo, 2026-09-18): one universal implementation, one upgradeable beacon owned by a TimelockController, one `BeaconProxy` per curated vault, and a scoped deploy-only hot key held by a deterministic runner.

## Research basis (why this shape, and what it costs)

The memo's evidence is the rationale; summarized:

- **Universality is a code property, not a trust property.** ERC-4626 normalizes an interface, not behavior (reverting previews, `max*` hard-coded 0 in Morpho V2, queued exits in Ethena/Maple/Centrifuge, Yearn `redeem` defaulting to 100% loss, Fluid's non-standard limits, FoT/rebasing assets, wrapper-specific inflation attacks). The wrapper is therefore **universal in implementation** but **admission-gated per child** (curated allowlist + on-chain validation). "One contract that accepts any arbitrary vault" is rejected by every audited precedent found.
- **Upgradeable custody is a known, governable risk — not a removed one.** Production precedents (Euler EVK: beacon + factory governor + timelock + security-council canceller; Aave/Compound/Maple timelocks) sit opposite a failure record dominated by *control-layer* failures (Radiant ~$50–58M, Bybit ~$1.46B, WazirX ~$235M, a single-EOA upgrade key at ioTube, UUPS via a leaked deployer key at Wasabi). The mitigations adopted below are the researched minimum.
- **The uncomfortable fact is recorded, not hidden:** an upgrade key can replace custody code. The timelock and canceller change the *speed*, not the *capability*. That is the price of upgradeability, and it MUST be disclosed (Principle III).

## The adopted architecture

| Piece | Role |
|---|---|
| `SparkPointUniversalVault` | The ONE implementation: any allowlisted ERC-4626 child, share-price HWM performance fee (≤20%, share dilution to a non-privileged recipient), 0 management/entry/exit, pause deposits only, withdraw always open, no sweep/rescue/upgrade selector of its own, child bound at initialization with **no setter**. |
| `UpgradeableBeacon` (`SparkPointVaultBeacon`) | Owner = the **TimelockController**. A beacon upgrade replaces the implementation for every proxy at once (fleet-wide; accepted and disclosed). |
| `SparkPointVaultFactoryV2` | **Deploy-only**: validates the child on-chain, CREATE2-deploys a `BeaconProxy` + initializes it, deploys the per-wrapper `CapRegistry`. Holds no funds and retains **no** authority over deployed wrappers (the beacon owner is the timelock, not the factory). The factory itself runs behind a **Transparent proxy** (ProxyAdmin owner = timelock): its implementation carries no upgrade function and no payable function, so it can never hold value. |
| Scoped deployer | A dedicated hot key (generated `0xB555dbEc2cC5908c8B245ED84cb038D5d205D875`) held by a **deterministic runner** (keeper-style), never by the LLM agent. Factory role-gated to it: it can deploy for an **already-allowlisted** child with fee ≤ cap and caps within bounds, and nothing else. Gas only. |

**Authority split (mandatory, enforced by construction):**

- **TimelockController** — proposer: 3-of-5 multisig (hardware wallets, distinct operators); canceller: an **independent** 2-of-3 guardian that can cancel but never propose; executor: permissionless after **≥72h** (Radiant's post-incident standard). Optional renounce to burn upgradeability once stable.
- **Automated deployer** — deploy only. It MUST NOT hold, and the factory MUST NOT grant it, any upgrade, allowlist, pause, fee-recipient, or fund power.
- **No EOA** may ever propose or execute an upgrade; no single key may upgrade.

**Non-negotiable technical requirements that accompany the change:**

1. ERC-7201 namespaced storage; `_disableInitializers()` on the implementation; atomic proxy initialization; no `selfdestruct`; no arbitrary `delegatecall`.
2. A pending upgrade MUST NOT pause, gate, or delay withdrawal — the delay IS the user-exit window (N2).
3. Every upgrade MUST pass CI: OpenZeppelin `upgrades-core validate` + Slither `slither-check-upgradeability`, differential old-vs-new implementation tests, and post-upgrade invariant tests (withdraw-always, fee ≤ cap, child unchanged, no asset path to any SparkPoint address).
4. Every upgrade SHOULD have an external review and MUST have a fork rehearsal before execution.
5. The wrapper's own defenses ship regardless: virtual shares + decimals offset / dead-share seed, `minSharesOut` slippage on deposits, mint from measured balance delta, burn-before-external-call ordering.
6. Deployment monitoring: every deploy alerts (address + tx + child); a deploy without a report is an incident; the deploy key is rotatable by the timelock without touching any wrapper.

## Exact delta to `constitution.md`

| Clause | Before | After |
|---|---|---|
| **I · N5** | "Non-upgradeable custody semantics + verifiable non-custody. The vault MUST be single-purpose and non-upgradeable. Any multisig or timelock MUST govern PAUSE ONLY, never fund movement…" | "Bounded, verifiable custody semantics. The vault MUST be single-purpose. Code is immutable by default; a wrapper admitted under IV.5 MAY be upgraded **only** through a TimelockController-owned beacon (3-of-5 proposer, independent canceller, ≥72h delay) whose upgrade path is never an asset path and never gates withdrawals. Multisig/timelock govern PAUSE and bounded parameters, never fund movement. The Trust Center MUST surface the exact upgrade authority so non-custody is provable." |
| **IV.5(a)** | child "immutable **constructor argument fixed at CREATE2 deployment**, never re-pointable, re-targetable, or upgradeable thereafter" | child "bound **at initialization, immutably and with no setter** (a proxy upgrade may not re-point it — enforced by review + CI); the factory MUST verify curated-allowlist membership at deploy time and REVERT otherwise; no wrapper consults a mutable registry at runtime." |
| **IV.6** | "Every vault … MUST be bounded, single-purpose, and non-upgradeable." | "Every vault … MUST be bounded and single-purpose; upgradeability is permitted ONLY under the IV.5/v4.0.0 wrapper rule (TimelockController beacon; no upgrade may alter the child, the fee cap, or the withdraw path)." |
| **V · intro** | wrapper family "**non-upgradeable** … bound immutably at construction" | same family, now "each bound to exactly one allowlisted child at initialization; upgradeable only via the IV.5/v4.0.0 beacon rule". |
| **V · N5** | "each wrapper is a plain, non-upgradeable … (**full-bytecode CREATE2, not a minimal-proxy clone**)" | "each wrapper is a single-purpose contract with exactly one child; the permitted shapes are immutable full-bytecode OR a `BeaconProxy` behind the TimelockController-owned beacon. A proxy may never re-point its child, and the implementation may never introduce an asset path." |
| **V · shapes** | (a) `SparkPointMorphoVault`, (b) Morpho V2 Fee Wrapper | adds **(c) `SparkPointUniversalVault`** via `SparkPointVaultFactoryV2`, under IV.5 admission + the IV.5/v4.0.0 upgrade rule. (a) stays superseded for new deploys; (b) stays available. |
| **V · factory** | deploy-only, no post-deploy authority | adds: role-gated to a **scoped deployer** with no upgrade/allowlist/pause/fund power. |
| **VII** | "each wrapper is bound to exactly one **Morpho** vault for its entire lifetime" | "exactly one **allowlisted child vault** for its entire lifetime" — single-child rule unchanged; no meta-vault, no cross-vault routing. **Admission remains Morpho-allowlist-scoped unless separately amended** (the wrapper's code is universal; admission is not). |
| **Additional · chain & scope** | "single-purpose, non-upgradeable ERC-4626 wrapper" | same sentence, upgraded to "single-purpose wrapper under the IV.5/v4.0.0 upgrade rule". |
| **Additional · upgradeability** | UUPS permitted only for the user account + fundless infra | generalized to "proxy upgradeability (UUPS or Transparent/ProxyAdmin)"; adds "(c) the wrapper **beacon**, owned by the TimelockController under IV.5/v4.0.0; the automated deployer holds no upgrade power." |
| **Contracts (authoritative)** | `SparkPointMorphoVault` family | adds `SparkPointUniversalVault`, `SparkPointVaultFactoryV2`, and the TimelockController-owned beacon; the scoped deployer runner. |

## Non-custody analysis (why this is a super-majority re-ratification)

- **N1 holds:** no new asset path. The upgrade path is not a withdrawal path; the fee is share dilution (never a transfer of principal); no sweep/rescue/migrate exists. The upgrade key CAN replace code — that is a *trust* change, and it is why this is MAJOR, not MINOR.
- **N2 holds and is strengthened:** withdrawals are never gated, including during an upgrade window; the delay doubles as an exit window.
- **N3/N4 unchanged:** user-signed deposits/withdrawals; session keys remain PolicyModule-bounded; the curated allowlist remains unreadable by the policy/agent path.
- **N5 is REDEFINED, not removed:** bounded + single-purpose + no-re-point + disclosed upgrade authority replace absolute non-upgradeability. Per Governance, changes to N5 require super-majority; the operator has granted it.
- **AI disposition unchanged:** the **LLM agent stays keyless**; the deploy key is a scoped hot key on a deterministic runner, exactly like the existing keeper/sweeper runners — it cannot move funds, upgrade, allowlist, or pause.

## Explicitly NOT taken

- No meta-vault, no cross-vault routing, no rebalancing between wrappers (Principle VII unchanged).
- No broadening of admission beyond the curated allowlist at this time (extending to non-Morpho ERC-4626 children would be a separate amendment).
- No EOA-controlled upgrade path, ever. No upgrade without delay. No upgrade of value-bearing 4663 beta contracts (revenue subsystem stays immutable per v3.1.0/v3.2.0).

## Ratification

- **Grant:** operator (aldrickb), 2026-09-18, super-majority re-ratification for the N5/IV.5/IV.6/upgradeability changes.
- **Companion artifacts:** `constitution.md` updated to **v4.0.0** in the same change; spec `049-universal-vault-wrapper` carries the build plan; `sparkpoint-ai-morpho-vaults-plan.html` §5/§8 holds the design + skeleton; the Trust Center copy rewrite lands with the contracts (P11) so no surface describes an undeployed contract as current.
