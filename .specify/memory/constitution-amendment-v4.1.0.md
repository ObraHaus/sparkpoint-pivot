# Constitution Amendment v4.0.0 → v4.1.0 (MAJOR)

**Date:** 2026-09-19 · **Operator:** aldrickb · **Status:** **RATIFIED** (reviewed 2026-09-19, V.1; landed with the V3 deploy) · **Classification:** **MAJOR** — redefines Guardrail IV.5(b) admission governance ("no single key may add an entry", multisig+timelock) by introducing AI-autonomous admission under an on-chain cooling-off window and an operator instant-admission path; the timelock is confined to code/proxy upgrades and non-admission parameters. N1–N5 custody semantics are **unchanged**.

## Why (operator directive)

> *"I want the AI on its own to curate the list of Morpho vaults and deploy wrappers for them — with an additional control that an admin human can manually add or modify new vaults. The 3-day wait (6 days total) is not doable even if the constitution requires it; the client is already waiting for the vaults. Reinforce the timelock only for code/proxy upgrades (both factory and vault wrapper implementation). AI can auto whitelist + deploy, but must wait 1 day — configurable by an admin. Admin whitelist → immediate; admin can override an AI entry and deploy immediately. One wrapper per whitelisted vault. Admin-whitelisted vaults are not the AI's to deploy (off-chain rule in the AI cron)."*

The v4.0.0 fleet shipped on 4663 with **zero wrappers deployed** — the factory, beacon, implementation, and TimelockController hold no user funds. The admission model is therefore changed and the deployed **V2 factory is sunset** (beacon/implementation/timelock are retained; the beacon remains the upgrade authority for wrapper code). This amendment rides a fresh deploy, so nothing migrates and no existing wrapper is affected.

## The adopted model

**Off-chain half (already live, unchanged in spirit):** the curated board is assembled by the keyless curator runner (P12 crawler + Morpho `vaultV2s`), screened/scored, and published; the admin panel keeps manual add/edit/hide/deny. This amendment changes only the **on-chain admission gate**.

**On-chain half — `SparkPointVaultFactoryV3`, RBAC via OpenZeppelin `AccessControl`:**

| Role | Holder | Powers |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | **TimelockController** `0x62b8b01c…b0B5` | grant/revoke roles; `setBeacon`, `setGuardian`, `setFeeRecipient`, `setDeployLimit`; factory code upgrades via the ProxyAdmin (all through the 3-of-5 proposer + independent canceller + ≥72h delay) |
| `ADMIN_ROLE` | **Operator EOA** `0x376293DDb027555aB7F483c00e1D61b2a7757dE8` (stays EOA; the Safe remains for everything that needs a timelock) | `whitelistVault` → **immediately ready**; `releaseNow` (override an AI entry's cooldown); `unwhitelist`; `setCooldown` (bounded 1h–7d); `createVault` for any whitelisted + ready child |
| `DEPLOYER_ROLE` | **AI deployer** `0xB555dbEc2cC5908c8B245ED84cb038D5d205D875` (deterministic runner; never the LLM) | `whitelistVault` → **ready after the cooldown**; `createVault` for its own ready entries (fee ≤ cap, caps within bounds, child validated). **No other power** — no unwhitelist, no release, no cooldown config, no upgrade, no pause, no fund path |

**Admission rules (on-chain unless stated):**

1. `whitelistVault(child)` records `{ by, readyAt }`; AI entries set `readyAt = now + cooldown`, admin entries set `readyAt = 0`.
2. `cooldown`: default **24h (86,400s)**, minimum **1h (3,600s)**, maximum **7d (604,800s)**, admin-settable, evented. It is a plain inline `block.timestamp` check — **not** a TimelockController operation.
3. `createVault` requires: caller has ADMIN_ROLE or DEPLOYER_ROLE; entry exists; `readyAt == 0 || block.timestamp >= readyAt`; **`wrapperOf[child] == 0`** (exactly one wrapper per child — new, enforced); the existing fee/caps/child validation (code present, asset, decimals, non-reverting conversion, allowlist membership **of the whitelist entry**).
4. `releaseNow(child)` (admin) zeroes the cooldown of an AI entry so it can be deployed immediately; `unwhitelist(child)` (admin) cancels a pending entry.
5. **One wrapper per child** is recorded (`wrapperOf`) and reverts on a second attempt.
6. **AI rule (off-chain, in the runner):** the AI cron auto-deploys ONLY entries whose `by` is the AI deployer key. Entries added by the admin are **not the AI's to deploy** — no on-chain restriction; the runner checks provenance before taking action.

**Explicitly unchanged:** `SparkPointUniversalVault` implementation, the TimelockController-owned `UpgradeableBeacon`, the scoped-deployer posture, fee invariants (≤20% HWM performance-only, 0 management/entry/exit, share dilution to a non-privileged recipient), caps bounds, `deployLimit` rate limit, withdraw-always (N2), and the keyless agent/curator.

## Exact delta to `constitution.md`

| Clause | Before (v4.0.0) | After (v4.1.0) |
|---|---|---|
| **IV.5(b)** | "Additions to and removals from the curated allowlist are governed by the SAME multisig + timelock that governs the PAUSE kill-switch, with a mandatory timelock delay and guardian veto window (**no single key may add an entry**); they take effect for FUTURE deployments only…" | "Additions are admitted by the factory's RBAC: the **AI deployer** may admit a child that becomes deployable after an on-chain **cooling-off window** (default 24h, admin-bounded 1h–7d); the **operator admin** may admit a child that is deployable **immediately** and may release an AI entry early. Additions take effect for FUTURE deployments only; one wrapper per child is enforced on-chain. The timelock governs **code/proxy upgrades and non-admission parameters** (beacon, guardian, fee recipient, deploy limit, role administration) — not admission." |
| **V · factory** | "deployment is role-gated to the scoped deployer and limited to children already on the curated allowlist…" | same, with the admission rules above and the `wrapperOf` one-per-child check. |
| **"Additional · upgradeability"** | proxy upgradeability permitted for the factory (fundless infra) and the wrapper beacon (timelock) | unchanged; the factory's **ProxyAdmin remains the timelock**. The amendment narrows the *purpose* of the timelock: upgrades + non-admission params only. |

## Non-custody analysis (why this requires super-majority re-ratification)

- **N1–N5 hold.** No new asset path; the AI/admin roles can admit and deploy only; neither can upgrade, pause, move funds, change the fee recipient, or alter an existing wrapper. Admission remains deploy-time-only and the child is bound immutably at initialization.
- **The real change is trust, and it is recorded, not hidden:** v4.0.0 said "no single key may add an entry." v4.1.0 deliberately relaxes that for the **admission** step: the AI key can admit subject to the on-chain cooldown, and the operator EOA can admit/deploy instantly. The compensating controls are: on-chain validation + one-per-child, the cooling-off window for AI admission, the admin instant path being an intentional operator power, `deployLimit`, the admin's instant `unwhitelist`, and the unchanged upgrade timelock.
- **Disclosure (Principle III):** the Trust Center and both changelogs MUST state — AI admission is delayed by a configurable cooling-off window; the operator admin can admit and deploy immediately; the wrapper code and factory code upgrade only through the timelock; withdrawals are never gated.
- **Sunset:** the V2 factory `0x040A7BFD…466dE` is retired unused (no wrappers ever deployed). Its pending `setDeployer` timelock operation and its auto-execute cron are cancelled.

## Ratification

- **Grant:** operator (aldrickb), reviewed and approved 2026-09-19 (V.1) — ratified with the V3 factory deploy the same day.
- **Companion artifacts (landed):** `constitution.md` updated to **v4.1.0**; `specs/049-universal-vault-wrapper/tasks.md` phase W6 updated; the tracker section `V` carries the build checklist; the 4663 book records proxy `0x1de85106…6406` / implementation `0xa65596e6…2213` (roles, cooldown and ProxyAdmin verified on-chain).
