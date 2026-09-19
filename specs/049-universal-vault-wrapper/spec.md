# Feature Specification: Universal upgradeable vault wrapper (beacon fleet)

**Feature Branch**: `feat/049-universal-vault-wrapper`

**Created**: 2026-09-18

**Status**: Specified — architecture ratified by operator (constitution v4.0.0, `.specify/memory/constitution-amendment-v4.0.0.md`). **Not implemented.**

**Input**: Operator directive 2026-09-18 (late): *"Bring back the vault wrapper — an upgradeable one — but make it universal, since all vaults share the same format. A factory which is also upgradable, and the per-vault wrapper is also upgradable, so when we create a wrapper we deploy a proxy — cheaper on gas — and we can upgrade the code. Also give our AI a dedicated wallet so the AI can deploy the wrapper on its own."* Research basis: `sparkpoint-ai-morpho-vaults-plan.html` §4–§8 (universal/upgradeable wrapper memo).

## Context

Spec 048 built the off-chain half (curator, curated store, admin panel, `/vault` board, chat). The on-chain half (M1) was gated on a live ERC-4626 vault on 4663; Morpho's Vault V2 factory is deployed there but no vault exists yet (verified on-chain 2026-09-18: factory `0x0FBad…803c`, 23,124 bytes; API returns 0 vaults). This spec supersedes 048's "reuse feature-011" M1 with the ratified **beacon fleet** model.

## Requirements

- **FR-049-001 (universal implementation).** ONE implementation contract (`SparkPointUniversalVault`) supports any **allowlisted** ERC-4626 child. "Universal" is a code property, not a trust property: each instance is bound to exactly one child at initialization with no setter, and admission is gated by the curated allowlist plus an on-chain validation pass. A single contract holding many vaults is forbidden (no meta-vault).
- **FR-049-002 (per-vault proxy).** Each curated vault gets its own `BeaconProxy` deployed by `SparkPointVaultFactoryV2` (deploy-only, itself behind a Transparent proxy whose ProxyAdmin owner is the timelock) via CREATE2, initialized atomically, with its own `CapRegistry`. One wrapper per child; a change of child is only a NEW wrapper the user chooses to enter.
- **FR-049-003 (bounded upgradeability).** The beacon (`UpgradeableBeacon`) is owned by an OZ `TimelockController`: proposer = 3-of-5 multisig, canceller = independent 2-of-3 guardian (cancel only), executor permissionless after **≥72h**. No EOA can propose or execute. A pending upgrade MUST NOT pause, gate, or delay withdrawals (N2; the delay is the exit window). The beacon MAY be renounced once stable.
- **FR-049-004 (scoped AI deployer).** A dedicated hot key (generated `0xB555dbEc2cC5908c8B245ED84cb038D5d205D875`) held by a **deterministic runner** — never the LLM agent — may call `createVault` ONLY for: an already-allowlisted child, `feeBps ≤ 2000`, caps within factory bounds. It MUST NOT hold upgrade, allowlist, pause, fee-recipient, or fund power. Every deploy is reported and monitored; an unreported deploy is an incident. The key is rotatable by the timelock without touching any wrapper.
- **FR-049-005 (fee invariants).** Performance fee ONLY: above a share-price high-water mark, share dilution to a non-privileged recipient, hard-capped ≤20% (default 10%). 0 management / 0 entry / 0 exit; never on principal, never on a flat or losing period. The fee rate is the only mutable parameter (guardian, hard-capped, timelocked per the deployed policy) and never alters custody. The fee is fail-open on the exit path.
- **FR-049-006 (N1/N2 by construction).** No sweep/rescue/migrate/re-target selector; the only asset-out paths are withdraw/redeem to the share owner's chosen receiver; withdraw/redeem carry no pause modifier and unwind directly from the child; insufficient child liquidity is the only permissible cause of a partial/failed exit.
- **FR-049-007 (on-chain validation).** The factory validates each child before deploy: `asset()` equality, share `decimals()` bounds, non-reverting `convertToShares/Assets`, contract code present, and allowlist membership; it refuses `feeBps > 2000`, malformed caps, and zero addresses. Async (ERC-7540) / multi-asset (ERC-7575) children are out of scope for v1 and rejected by policy + review (documented).
- **FR-049-008 (wrapper defenses).** Virtual shares + decimals offset (and/or a dead-share seed), `minSharesOut` slippage overload on deposit, mint from measured balance delta, burn-before-external-call ordering, per-wrapper caps via CapRegistry, deposit-side pause only.
- **FR-049-009 (upgrade engineering).** ERC-7201 namespaced storage; implementation `_disableInitializers()`; atomic proxy init; no `selfdestruct`; no arbitrary `delegatecall`; every upgrade passes OZ `upgrades-core validate` + Slither `slither-check-upgradeability` + differential old-vs-new tests + post-upgrade invariant fuzzing (withdraw-always, fee ≤ cap, child unchanged, no asset path to any SparkPoint address); fork rehearsal before execution; external review expected.
- **FR-049-010 (disclosure).** Trust Center, fee copy, and both changelogs update in the same release as the contracts; the upgrade authority and the residual risk ("an upgrade key can replace custody code; the timelock is a speed limit, not an impossibility proof") MUST be stated plainly. Fail-closed: until contracts are deployed and verified on the target chain, every surface keeps saying so.

## Non-goals

- Meta-vault, cross-vault routing/rebalancing, or any contract holding many children.
- Broadening admission beyond the curated Morpho allowlist (separate amendment if ever).
- EOA-controlled upgrades; instant upgrades; upgradeable value-bearing beta contracts (revenue subsystem stays immutable).
- ERC-7540/7575 support in v1.

## Test plan

- **Unit (Foundry):** initializer guards (double-init, implementation init disabled), child binding immutability (no setter; upgrade cannot re-point), deposit/mint/withdraw/redeem accounting, fee math above/below HWM (fuzz), fee cap, caps enforcement, pause-deposits-only, minSharesOut slippage, inflation/donation (virtual offset), factory validation rejects, deployer role gating.
- **Upgrade (Foundry):** beacon upgrade preserves all storage and invariants; a mock "bad" implementation cannot be shipped silently (CI checks + invariant suite); storage-layout compatibility across versions.
- **Fork rehearsal (when a child exists):** real vault on a 4663 fork (or a supported chain vault on its fork) — deposit, accrue, withdraw, upgrade-with-position.
- **Runner (node:test):** scoped `createVault` payload building, allowlist/fee/caps pre-checks, reporting, refusal paths.
- **Negative:** non-deployer calls revert; allowlist bypass reverts; fee > cap reverts; child asset mismatch reverts; withdraw never blocked by pause or a pending upgrade.

## Success criteria

- Wrapper fleet deploys on 4663 with one proxy per curated vault, all sharing one implementation behind the timelocked beacon.
- A wrapped vault charges the fee ONLY on gains above HWM (fuzzed), and a user can always redeem directly even while an upgrade is pending.
- A compromised AI deploy key cannot upgrade, allowlist, pause, or move funds — proven by role tests, not policy prose.
- Every upgrade is delayed ≥72h, cancellable by the independent guardian, and gated by CI + fork rehearsal.
