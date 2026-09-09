# Implementation Plan: Wrapper Vault Factory

**Branch**: `011-wrapper-vault-factory` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-wrapper-vault-factory/spec.md`

## Summary

Add a `SparkPointVaultFactory` (admin-gated, fund-less, CREATE2 **full-bytecode** deployer) that mints branded, single-purpose, **non-upgradeable** `SparkPointMorphoVault` instances — ERC-4626 wrappers that supply pooled USDC into exactly one **curated** Morpho vault and charge SparkPoint's own ≤20% profit-only HWM performance fee — plus the **manage** half of the unified `/admin/vaults` page (create + guardian-timelocked pause/fee/recipient/caps), plus user-signed deposit/withdraw into a branded wrapper reusing the shipped confirm gate. This is the **execution/manage** companion to `010-universal-vaults` (the **read/advisory** half): a newly deployed wrapper flows into the 010 registry/reader automatically and renders through the 010 read half on the same page (010 US3 ↔ 011 US4).

**This plan now PASSES the Constitution Check**, following the operator's **super-majority re-ratification** of the `v1.3.0 → v2.0.0` amendment (2026-07-21) that this feature's Phase-0 gate required. IV.5's whitelist now admits curated-allowlist Morpho vaults **for branded wrapper vaults only** (targets fixed immutably at CREATE2; allowlist governed by the pause multisig+timelock; ineligibility + separation-from-policy-path rules preserve "impossible by construction"); V permits a deploy-only factory of branded, single-purpose, non-upgradeable wrappers (the Aave vault remains the launch default, unchanged); VII ratifies these wrappers while keeping cross-vault optimizers/routers deferred. N1–N5, the pause-only kill-switch, and the AI-disposition rule were **extended verbatim** to the wrapper family — constraints added, none weakened. Per Principle VI the gate is honored: the amendment was ratified explicitly (never implicitly through implementation) **before** any implementation task began.

## Technical Context

**Language/Version**: Solidity (Foundry, `contracts/`) for the template + factory + tests; TypeScript 5 (Next.js 15 App Router, React 19) for `apps/web` admin + confirm surfaces; Python 3.12 for `services/agent` (registry/reader is 010, extended additively if at all).

**Primary Dependencies**: OpenZeppelin (`ERC4626`, `ERC20`, `TimelockController`, `Ownable`/`AccessControl`, `Create2`) already vendored for `SparkPointVault.sol`; Morpho ERC-4626 read via a minimal `IERC4626` interface (`contracts/src/interfaces/external`); viem 2 + wagmi 2 + `@sparkpoint/shared` for the app; the Morpho GraphQL API is a **read/data** feed owned by the 010 half, not a build dependency here. No new agent runtime dep expected.

**Storage**: On-chain — the factory's curated allowlist + per-instance immutables. Off-chain — a **011-owned** migration (`0016_vault_factory.sql`: the `morpho_curated_allowlist` + `sparkpoint_wrappers` provenance tables) + `packages/shared/src/addresses/*` per-chain factory entries. **010 introduces no DB registry table** — its registry is static config (`AddressBook.vaults[]`); 011 extends the 010 reader to merge the runtime wrapper rows. No new agent seed dir anticipated (if one is added, it needs an explicit `COPY` in `services/agent/Dockerfile`).

**Testing**: Foundry unit/fuzz (`contracts/test/fuzz`), fork (`contracts/test/fork`), invariant (`contracts/test/invariant`), refute (`contracts/test/refute`), factory determinism (`contracts/test/factory` / `contracts/test/DeployDeterminism.t.sol` pattern); `node:test`/Vitest + Playwright for the admin manage + confirm surfaces; `pytest` for any agent reader extension.

**Target Platform**: Base Sepolia (84532) alpha for end-to-end (self-created + seeded test Morpho vault/market/oracle — no ready curated vaults on testnet); Base mainnet (8453) for real curated vaults. Coolify dev/staging deploy.

**Project Type**: Multi-package monorepo — Solidity contracts + Next.js frontend + Python agent + shared TS package.

**Performance Goals**: Deploy + read paths bounded for the CPU-starved dev box and free/keyless RPC; the 010 reader already batches multi-vault reads. No hot-path perf target beyond "one wrapper's reads fit the existing multicall budget."

**Constraints**: Non-custodial by construction (N1–N5 preserved per instance); non-rebasing accounting (`totalAssets` via `convertToAssets`); `maxWithdraw` clamped to `morphoVault.maxWithdraw(this)`; Vaults V2 `max*==0` handled by deriving availability; guardian = OZ `TimelockController` (pause-deposits-only); factory holds no funds; curated-allowlist gate; fee ≤2000 bps profit-only HWM minted as shares; double-fee + non-Aave-source disclosed everywhere; policy allowlist/`Asset` enum unchanged except as ratified.

**Scale/Scope**: 1 template contract + 1 factory contract + 1 deploy script + Foundry suites; 1 admin page (manage half of `/admin/vaults`) + reuse of the confirm/execute/exit libs; a curated allowlist of a handful of vetted Morpho vaults; 2 chains (84532 test, 8453 real).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` **v2.0.0** (amended 2026-07-21 — Curated Morpho-Wrapper Vaults; see [`constitution-amendment.md`](./constitution-amendment.md)).

**GATE = PASS (post-ratification, v2.0.0).** This feature routes pooled user funds held by a SparkPoint vault into curated Morpho — a custody-surface + launch-scope change to NON-NEGOTIABLE principles, which (correctly) could **not** be cleared by a recorded scope note the way 007's user-signed swap was. It required — and, on 2026-07-21, **received** — an explicit **super-majority re-ratification** (`v1.3.0 → v2.0.0`). The gate below now clears against the amended constitution.

| Principle | PASS/FAIL | Assessment |
|---|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS (ratified v2.0.0)** | Each wrapper individually preserves N1 (no admin withdrawal), N2 (withdraw-always, pause-deposits-only), N3/N4 (user keys, no new automation/session keys), and N5 **as an instance** (full-bytecode CREATE2, non-upgradeable, no sweep/migrate). **But** N5's "single-purpose vault" and the overall custody surface change at the **product** level — a SparkPoint vault now directs pooled funds into Morpho. "Any change that touches custody semantics MUST be rejected by default and requires explicit re-ratification." → gated behind the amendment, not shippable as-is. |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS** | Deposits/withdrawals stay **user-signed** (like 007's swap), **outside** the deterministic policy engine, which is **unchanged** — no `Protocol`/`Asset` enum or `(target,selector)` widening. Model output still cannot reach chain without the policy layer + a user signature. The amendment authorizes the custody/whitelist change, not a policy-engine edit. |
| **III. Provable, Not Promised** | **PASS with a mandatory disclosure** | Results are on-chain reconstructable and yield is reported net of everything — **provided** every fee/APY surface discloses (a) the **stacked double-fee** (SparkPoint HWM fee on top of the Morpho curator's native fee) and (b) that the yield source is the external Morpho vault, **NOT** Aave v3. No return projections. FR-023 makes this disclosure mandatory; without it this becomes a FAIL. |
| **IV. Security & Bounded Blast Radius** | **PASS (ratified v2.0.0)** | IV.5 now admits — **for branded wrapper vaults only** — Morpho vaults on the on-chain **curated allowlist**. "Impossible by construction" is preserved: each wrapper's target is an **immutable CREATE2 constructor arg** (factory reverts if not allowlisted; no runtime mutable registry — frozen at the instance level); allowlist writes are gated by the **pause multisig+timelock** (deploy-time-only, future-deploys-only, custody-neutral); a vault is **ineligible** if any SparkPoint-controlled address holds a role over it; and the allowlist is a **separate registry unreadable by the policy/agent path**. On-chain caps + pause-only killswitch (IV.2/IV.3) apply per wrapper. |
| **V. Conservative, Transparent Launch** | **PASS (ratified v2.0.0)** | V now permits a **deploy-only factory** of branded, single-purpose, non-upgradeable ERC-4626 wrappers, each supplying **one** curated Morpho vault and charging the same 0-management / profit-only ≤20% HWM fee (share-dilution, never on principal). The conservative Aave Yield Vault **remains the launch default, unchanged**; each wrapper is a *separate* single-purpose vault — no new strategy under the launch vault's banner. Stacked double-fee disclosed net (FR-023). |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS** | This IS the spec-driven process: constitution → spec → plan → tasks. The plan's Constitution Check honestly fails and blocks tasks; no code lands before ratification + tasks. Cross-artifact consistency with [spec.md](./spec.md), [research.md](./research.md), and the 010 companion is maintained. |
| **VII. Simplicity & YAGNI** | **PASS (ratified v2.0.0)** | VII now ratifies curated single-purpose Morpho wrappers (one vault each, bound for life) as in-scope, while **explicitly keeping deferred**: cross-vault optimization, auto-rebalancing / fund-routing between wrappers, meta-vaults/routers, multi-strategy vaults, protocols beyond Aave/Aerodrome/curated-Morpho, TradFi, and the general assistant. Each wrapper stays simple + single-purpose; the factory is deploy-only. |

**N5 / custody-semantics note (resolved).** Because IV.5/V/VII + the product-level N5 effect touch custody semantics / launch scope of NON-NEGOTIABLE principles, this required a **super-majority re-ratification** — which the operator granted on **2026-07-21** (recorded in `.specify/memory/constitution.md` v2.0.0, full text [`constitution-amendment.md`](./constitution-amendment.md)). It was **not** self-authorized by an agent (ObraHaus playbook 2.6): the operator directed and ratified it explicitly. IV.6 now binds "single-purpose, non-upgradeable" to **every** vault instance, so each wrapper satisfies N5 as an instance while the ratified scope covers the product-level change.

### Ratified amendment (v1.3.0 → v2.0.0, 2026-07-21)

*✅ **RATIFIED** by the operator (super-majority, aldrickb) on **2026-07-21** and recorded in `.specify/memory/constitution.md` (v2.0.0). The exact applied text is in [`constitution-amendment.md`](./constitution-amendment.md); the hardened final wording (closing the underlying-curator N1 seam, allowlist governance, immutable-target, fee-as-share-dilution, and policy-path separation) supersedes the summary below.*

> **Amendment (v1.3.0 → v2.0.0) — Curated Morpho-Wrapper Vaults.** In addition to the single conservative Aave Yield Vault, which REMAINS the product default, SparkPoint MAY operate a factory that deploys **branded, single-purpose, NON-upgradeable ERC-4626 wrapper vaults**, each supplying pooled USDC into exactly **one** Morpho vault drawn from an **on-chain curated allowlist of vetted Morpho vaults**.
>
> 1. **IV.5 (whitelist)** is extended: the launch whitelist becomes **Aave v3, Aerodrome, and curated Morpho vaults on the factory's on-chain allowlist**. Interaction with any protocol/vault **not** on that allowlist MUST remain **impossible by construction** (the factory refuses to wrap un-vetted vaults; deployed wrappers are immutable and hold a single Morpho target).
> 2. **V (single vault)** is amended: branded wrappers are **separate single-purpose vaults**, NOT new strategies added "under the banner of the launch vault." The launch Aave vault's spec (0 mgmt fee, ≤20% profit-only HWM, non-upgradeable) is unchanged and remains the default.
> 3. **VII (single-vault / deferred scope)** is amended to move "a factory of curated single-purpose Morpho wrappers" from DEFERRED into ratified scope, while multi-strategy vaults (market-neutral, vol harvesting, yield optimization), non-curated protocols, TradFi, and the general assistant REMAIN deferred.
> 4. **N1–N5 are PRESERVED** and re-affirmed for every instance: no admin withdrawal (N1); withdraw-always escape hatch, pause-deposits-only killswitch (N2); user-owned keys (N3); no new automation/session keys beyond the existing PolicyModule (N4); **each instance is full-bytecode, non-upgradeable, single-purpose — no proxy/delegatecall-to-impl, no sweep/migrate/rescue** (N5). Guardian is the OZ `TimelockController` (pause only).
> 5. **Disclosure (III):** every surface showing a wrapper's fee/APY MUST disclose the **stacked double-fee** and that yield comes from the Morpho vault, **not** Aave.
> 6. **Policy boundary (II):** 011 does **NOT** widen the policy `Protocol`/`Asset` enums or the `(target,selector)` set. Wrapper deposit/withdraw is a **user-signed** action outside the agent policy path (like 007's swap), so no policy-enum edit is exercised; the Python + TS enums stay byte-identical (T098 parity). The amendment authorizes the **custody-surface / whitelist** change (a SparkPoint vault may hold funds in a curated Morpho vault), not a policy-engine edit.
>
> **Ratification:** ✅ **DONE** — super-majority, operator-directed, recorded in `.specify/memory/constitution.md` v2.0.0 on 2026-07-21.

**Result: GATE PASS** — the Phase-0 amendment (`tasks.md` **T001**) was **ratified 2026-07-21 (v2.0.0)**, so US2–US5 (template, factory, admin manage, app deposit/withdraw) are **unblocked**. No implementation began before ratification (Principle VI honored).

## Project Structure

### Documentation (this feature)

```text
specs/011-wrapper-vault-factory/
├── plan.md              # This file
├── spec.md              # WHAT/WHY (blocked on US1 ratification)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities & shapes (post-ratification)
├── quickstart.md        # Phase 1 — deploy + verify a test wrapper locally (post-ratification)
├── contracts/           # Phase 1 — internal interface contracts
│   └── vault-factory-interfaces.md   # template + factory + registry + timelock-op shapes
└── tasks.md             # Phase 2 — task list (T001 = ratification gate; all else blocked)
```

### Source Code (repository root) — *authored only after T001 ratification*

```text
contracts/src/vault/
├── SparkPointVault.sol            # (existing) Aave-hardwired launch vault — UNCHANGED (default)
└── SparkPointMorphoVault.sol      # NEW — single-purpose non-upgradeable ERC-4626 Morpho wrapper
                                   #   immutables: morphoVault(IERC4626), asset(USDC), guardian(Timelock), feeRecipient
                                   #   totalAssets()=morphoVault.convertToAssets(morphoVault.balanceOf(this)) (non-rebasing)
                                   #   maxWithdraw/maxRedeem clamped to morphoVault.maxWithdraw(this); V2 max*==0 handled
                                   #   perf fee: profit-only HWM, minted as shares, default 1000 / cap 2000 bps
contracts/src/factory/
└── SparkPointVaultFactory.sol     # NEW — admin-gated, fund-less, CREATE2 full-bytecode deploy + registry + curated allowlist
contracts/src/interfaces/
├── ISparkPointVault.sol           # (existing) fixed ABI the reader relies on
├── ISparkPointVaultFactory.sol    # NEW — factory interface (deploy, allowlist, registry views)
└── external/                      # add a minimal IERC4626 (Morpho) read/act interface if not present
contracts/script/
├── DeployCore.s.sol · DeploySepolia.s.sol   # (existing)
└── DeployMorphoVault.s.sol        # NEW — deploy factory + (test) create+seed a Morpho vault/market/oracle + deploy a wrapper
contracts/test/
├── fuzz/MorphoVault4626.t.sol         # NEW — ERC-4626 conformance + non-rebasing share math + rounding-safe fee
├── fork/VaultMorphoFork.t.sol         # NEW — partial-liquidity withdraw, offline+paused withdraw (N2), V2 max*==0 path
├── invariant/NonCustodyMorpho.t.sol   # NEW — no assets leave to non-user; factory balance == 0
├── invariant/PerformanceFeeMorpho.t.sol # NEW — fee never touches principal under non-rebasing
├── refute/RefuteN1Morpho.t.sol        # NEW — no admin/guardian withdraw-to-SparkPoint selector
├── refute/RefuteN2Morpho.t.sol        # NEW — withdraw survives offline + paused
├── refute/RefuteN5Morpho.t.sol        # NEW — no upgrade/proxy/sweep/migrate; runtime code-hash == full bytecode
└── factory/FactoryDeploy.t.sol        # NEW — admin-gate, curated-allowlist gate, CREATE2 determinism, not-a-proxy, register-once

apps/web/src/app/admin/vaults/
└── page.tsx                       # 010 READ half (live state) + 011 MANAGE half (create + timelocked pause/fee/recipient/caps)
apps/web/src/app/admin/killswitch/page.tsx  # (existing) reflects wrapper paused()/guardian() — pause-deposits-only visible
apps/web/src/lib/chain/
├── useVault.ts                    # (existing, 010) vaultAddressFor + reader — surfaces wrappers via 010 registry (no hardcode)
├── useVaultConfirm.tsx            # (existing) confirm gate — add branded name + stacked-double-fee + non-Aave-source disclosure
├── useExecuteVaultTx.ts           # (existing) reuse for user-signed deposit/withdraw into a wrapper
├── exit.ts                        # (existing) reuse for clamped user-signed withdraw
└── useVaultManage.ts              # NEW — queue/execute guardian TimelockController ops (pause/setFee/setFeeRecipient/caps)
packages/shared/src/
├── addresses/{types.ts,base.ts,baseSepolia.ts}  # add factory address + per-chain curated Morpho allowlist entries
├── policy/enums.ts                # UNCHANGED — 011 does NOT widen Protocol/Asset (T098 parity holds); wrapper deposit is user-signed, outside the policy engine
└── schemas/…                      # unchanged unless the amendment authorizes a wire change

services/agent/src/sparkpoint_agent/
├── chain/vault_reader.py          # (010) reads each registered wrapper via the fixed ERC-4626 ABI — wrappers appear automatically
├── policy/enums.py                # UNCHANGED — mirror stays byte-identical (T098 parity); no policy-enum edit in 011
└── config.py                      # (existing) single default vault stays the Aave vault

Living docs: CHANGELOG.md · DEVELOPMENT.md (factory address, curated allowlist, timelock op flow, any new env var) ·
services/agent/content_seed/whats-new.json (client-facing entry per user-visible phase)
```

**Structure Decision**: Multi-package monorepo. The custody-bearing work is in `contracts/` (template + factory + Foundry suites); the app work reuses the shipped confirm/execute/exit libs and adds one manage hook + the manage half of `/admin/vaults`; the agent side only consumes the 010 registry (no new hot path). No new top-level project.

## Phased design (maps to spec user stories)

**Phase ordering is a hard dependency chain — Phase 0 gates everything.**

- **Phase 0 → US1 (GOVERNANCE GATE — blocks everything).** The operator ratifies the drafted amendment by super-majority and records it in `.specify/memory/constitution.md` (version bump). The Constitution Check is re-run to **GATE PASS** citing the new clause. **No Solidity/TS is written in this phase.** Until this completes, Phases 1–4 MUST NOT begin (FR-001/FR-002; SC-001/SC-002).
- **Phase 1 → US2 (template + tests).** `SparkPointMorphoVault.sol` (non-rebasing `totalAssets`, clamped `maxWithdraw`, V2 `max*==0` handling, HWM fee minted as shares, timelock guardian, no sweep/migrate) + the fuzz/fork/invariant/refute suites re-proving N1/N2/N5 under non-rebasing shares + partial Morpho liquidity. Independently shippable as an audited, un-deployed template.
- **Phase 2 → US3 (factory + allowlist + deploy).** `SparkPointVaultFactory.sol` (admin-gated, fund-less, CREATE2 full-bytecode, curated-allowlist gate, register-once) + `DeployMorphoVault.s.sol` (on testnet: create+seed a test Morpho vault/market/oracle, then deploy a wrapper) + `FactoryDeploy.t.sol`. Deployed wrappers appear in the **010** reader.
- **Phase 3 → US4 (admin manage).** The **manage** half of `/admin/vaults` (create-vault flow + guardian-timelocked pause/setFee/setFeeRecipient/caps via `useVaultManage.ts`), rendering live state through the **010** read half (010 US3 ↔ 011 US4). The "no move-funds action exists" invariant is visible (FR-021).
- **Phase 4 → US5 (app deposit/withdraw).** User-signed deposit/withdraw into a branded wrapper, reusing `useVaultConfirm.tsx` (+ stacked-double-fee + non-Aave-source disclosure), `useExecuteVaultTx.ts`, and `exit.ts`; wrappers discovered via the 010 registry (no hardcoded addresses).

Each of Phases 1–4 is independently shippable to `develop` and honest at its own boundary — **after** Phase 0.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Super-majority constitution amendment (Phase 0, blocking)** | The feature crosses IV.5 (non-whitelisted protocol with custodied funds), V (beyond the single Aave vault), and VII (deferred multi-vault/protocol scope) — all NON-NEGOTIABLE / custody-or-scope changes | A recorded scope note (the 007 pattern) is **unavailable**: 007's surface was already outside the policy/vault boundary, whereas here a SparkPoint vault custodies pooled funds and directs them into Morpho — exactly the path IV.5 governs. Self-authorizing is forbidden (Governance / ObraHaus 2.6). No shippable simpler path exists; ratification is mandatory. |
| **Full-bytecode CREATE2 deploy (not EIP-1167 minimal-proxy clone)** | Each instance must be genuinely non-upgradeable + single-purpose (N5) | A minimal-proxy clone `delegatecall`s into a shared implementation, so the implementation address can change behaviour for every clone — a delegatecall-to-impl upgrade surface that violates N5. Higher per-deploy gas is accepted to keep each instance immutable. |
| **Non-rebasing `totalAssets` via `convertToAssets` + `maxWithdraw` clamp** | The Aave vault used `aUSDC.balanceOf` (rebasing); Morpho shares are non-rebasing and can have partial withdrawable liquidity | Reading a raw token balance would misprice shares; not clamping `maxWithdraw` would break the ERC-4626 "withdrawable now" assertion and revert legitimate partial exits (N2). |
| **Vaults V2 `max*`-returns-0 availability derivation** | Vaults V2 return 0 from `max*` by design; naïvely trusting it reads as "nothing withdrawable" and blocks all withdrawals | Trusting `max*==0` would be a fund-lock (N2 violation); availability is derived from underlying market/liquidity state instead ([research.md](./research.md) D3). |
| **Curated on-chain allowlist gate in the factory** | Preserves IV.5's "impossible by construction" after the whitelist is widened — un-vetted vaults stay un-wrappable | Letting the admin wrap an arbitrary address means a compromised admin session could point a wrapper at a malicious ERC-4626, defeating the amendment's safety premise. |
| **Guardian actions via OZ `TimelockController` (queue→delay→execute)** | Fee/pause/cap changes are custody-adjacent; a timelock bounds blast radius + gives users exit time (mirrors the Aave vault's timelock-governed pause) | Instant admin writes for `setFee`/pause would let a compromised admin change economics with no warning; the timelock is the pause-only, delayed-governance model the constitution already uses. |
| **Mandatory stacked-double-fee + non-Aave-source disclosure** | SparkPoint's HWM fee stacks on Morpho's native curator fee, and yield is not Aave — Principle III requires net-of-everything honesty | Showing a single fee or an Aave-flavored APY would misrepresent net yield and its source; disclosure is cheaper than the trust cost of hiding it. |
