# Feature Specification: Wrapper Vault Factory

**Feature Branch**: `011-wrapper-vault-factory`

**Created**: 2026-07-21

**Status**: Draft — **BLOCKED on a super-majority constitution amendment** (see [plan.md](./plan.md) Constitution Check; Phase 0 / User Story 1)

**Input**: User description: "A factory (admin-panel) that deploys branded, non-custodial ERC-4626 Morpho-wrapper vaults from a curated list, each charging SparkPoint's own performance fee; plus the manage half of a unified /admin/vaults page; so stakeholders can launch new vaults later."

## Clarifications

Resolved with the operator on 2026-07-21 (see the approved plan artifact, the pre-derived Constitution Gate in [plan.md](./plan.md), and Assumptions):

- **This feature does NOT pass the Constitution Check as written.** It routes pooled user funds into Morpho — a protocol NOT on the launch whitelist (Aave v3 + Aerodrome) — and adds vaults beyond the "SINGLE conservative Aave Yield Vault." Both are custody-surface / launch-scope changes. Per Governance ("custody-touching amendments … require SUPER-MAJORITY approval + explicit re-ratification; MUST NOT be made implicitly through implementation") the whole feature is gated behind **User Story 1 (a ratified amendment)**. No contract, script, or admin write may be built before ratification. This is the honest, spec-driven outcome (Principle VI), not a failure to design.
- **Companion to 010.** Feature `010-universal-vaults` is the **read / advisory** half (it added the vault registry, the multi-vault reader, and the *read-only* `/admin/vaults` state view). This feature `011` is the **execution / manage** half. 011 consumes the 010 registry/reader (a newly deployed wrapper appears in the 010 reader automatically) and fills in the manage actions on the same `/admin/vaults` page. See cross-references throughout and [010 spec](../010-universal-vaults/spec.md).
- **Instance-level non-custody is preserved, product-level custody semantics still change.** Each deployed wrapper individually preserves N1–N5 (no admin withdrawal, withdraw-always escape hatch, user keys, no automation added, non-upgradeable single-purpose). But N5's "single-purpose vault" at the *product* level, IV.5's "impossible by construction" protocol bound, and V/VII's "single-vault" launch scope are all affected. That is exactly why re-ratification — not an implementation-time scope note — is required (contrast 007, whose surface was already outside the policy/vault boundary).
- **Full-bytecode CREATE2 deploys, NOT minimal-proxy clones.** A minimal-proxy (EIP-1167) clone `delegatecall`s into a shared implementation. That gives the implementation address the power to change behaviour for every clone and re-introduces a delegatecall-to-impl upgrade surface, violating N5 ("non-upgradeable"). The factory MUST deploy the **full** `SparkPointMorphoVault` bytecode per instance via CREATE2, so each instance is genuinely single-purpose and non-upgradeable.
- **Curated Morpho vaults only, vetted + gated.** The factory MUST NOT deploy a wrapper around an arbitrary operator-supplied address. The target Morpho vault MUST come from a curated, on-chain-gated allowlist (a set the factory checks by construction), so a compromised admin session cannot point a wrapper at a malicious ERC-4626.
- **Double-fee disclosed honestly.** A branded wrapper charges SparkPoint's own ≤20% profit-only HWM performance fee **on top of** the Morpho curator's native fee already taken inside the underlying vault. The net-of-everything yield and the stacked-fee structure MUST be disclosed at every surface where the vault's fee/APY is shown (Principle III).
- **Default stays the Aave vault.** The conservative single-purpose Aave `SparkPointVault` (spkUSDC) remains the product default and is untouched by this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator ratifies the constitution amendment (Priority: P0) 🚧 GOVERNANCE PREREQUISITE — NOT code

Before any wrapper vault, factory, admin write, or test is built, the operator (governance) must ratify — by the **super-majority** process the Governance section requires — an explicit amendment to the SparkPoint Constitution permitting a factory of **branded, single-purpose, non-upgradeable Morpho-wrapper vaults that preserve N1–N5**, while keeping the conservative Aave vault as the default. The amendment touches IV.5 (extend the launch whitelist to *curated* Morpho vaults, for user-signed branded wrappers only), V ("SINGLE … Aave Yield Vault" / "new strategies … under the banner of the launch vault"), and VII ("launch vault remains single-vault"; multi-strategy + additional protocols deferred). It MUST preserve all five non-custody invariants, the pause-only killswitch, and AI-disposition (Principle II).

**Why this priority**: The Governance section is explicit — custody-touching amendments "MUST NOT be made implicitly through implementation," and an agent "may NOT self-authorize this." Every downstream story mutates the custody surface or launch scope, so all of them are blocked until this human super-majority decision is recorded. This is the ObraHaus 2.6 gate.

**Independent Test**: The ratified amendment text exists in `.specify/memory/constitution.md` at a bumped version with a recorded super-majority approval; [plan.md](./plan.md)'s Constitution Check can be re-run and flips from **GATE BLOCKED** to **GATE PASS** citing the new clause; and `tasks.md` T001 is checked off with the ratification reference. No Solidity or TypeScript is written to satisfy this story.

**Acceptance Scenarios**:

1. **Given** the current constitution v1.3.0 with IV.5 / V / VII as written, **When** the Constitution Check in [plan.md](./plan.md) is run for this feature, **Then** it returns **GATE BLOCKED** and names IV.5, V, and VII as FAIL/CONFLICT — and no implementation task may start.
2. **Given** the operator convenes governance, **When** a super-majority approves the drafted amendment (see [plan.md](./plan.md) "Proposed amendment (operator decision)"), **Then** the amendment text and approval are recorded in `.specify/memory/constitution.md` with a version bump, and re-ratification is explicit (not implied by any merged code).
3. **Given** no ratification has occurred, **When** anyone attempts to begin US2–US5, **Then** the work is refused with a pointer to this gate — the plan documents that no code may begin until ratified.
4. **Given** ratification is declined or deferred, **Then** the feature stays Draft/Blocked, the Aave vault remains the sole vault, and nothing in the codebase changes.

---

### User Story 2 - Non-upgradeable Morpho-wrapper vault template, re-proving non-custody (Priority: P1)

*(Blocked by US1.)* A `SparkPointMorphoVault` template — a single-purpose, non-upgradeable ERC-4626 ("branded wrapper") that supplies its pooled USDC into exactly **one** curated Morpho ERC-4626 vault and mints branded shares — with a Foundry unit/fuzz/fork suite that re-proves N1, N2, and N5 hold under the two new conditions Aave never exposed: **non-rebasing** underlying shares and **partial withdrawal liquidity** in the Morpho vault.

**Why this priority**: The template is the load-bearing custody artifact. If it cannot re-prove non-custody under non-rebasing accounting and constrained liquidity, nothing downstream may ship. It is the smallest slice that proves the amendment can be honoured in code.

**Independent Test**: Deploy the template in a Foundry fork against a seeded test Morpho vault, deposit as several users, drain the Morpho vault's available liquidity to a partial level, and assert every user can still withdraw their pro-rata available balance on-chain with SparkPoint offline; assert no code path moves assets to a SparkPoint address; assert there is no `sweep`/`migrate`/`rescue`/`upgradeTo` selector.

**Acceptance Scenarios**:

1. **Given** the wrapper holds Morpho vault shares (non-rebasing), **When** `totalAssets()` is read, **Then** it returns `morphoVault.convertToAssets(morphoVault.balanceOf(address(this)))` — never a raw token balance — so share price tracks the underlying honestly.
2. **Given** the underlying Morpho vault currently has only partial withdrawable liquidity, **When** a user calls `withdraw`/`redeem` up to their available share, **Then** `maxWithdraw`/`maxRedeem` are **clamped** to `morphoVault.maxWithdraw(address(this))` so the ERC-4626 "the returned amount is withdrawable now" assertion holds and the tx does not revert on an over-ask (N2 partial-exit).
3. **Given** the underlying is a Morpho **Vaults V2** whose `max*` functions return 0 by design, **When** availability is derived, **Then** the wrapper derives withdrawable liquidity from the underlying market state rather than trusting `max*==0` as "nothing withdrawable" (documented in [research.md](./research.md) D3).
4. **Given** SparkPoint is fully offline and the wrapper is paused, **When** a user withdraws, **Then** the withdrawal still succeeds on-chain (N2 withdraw-always; pause blocks **deposits only**).
5. **Given** any caller including the guardian/owner, **When** they attempt to move user funds to a non-user address, **Then** no such function exists — the refute tests `RefuteN1Morpho`/`RefuteN2Morpho`/`RefuteN5Morpho` fail to find one.
6. **Given** a profit above the high-water mark, **When** the performance fee accrues, **Then** it is minted as **fee-shares** to `feeRecipient` (never a principal transfer), profit-only, HWM-gated, and capped ≤2000 bps (default 1000).

---

### User Story 3 - Admin-gated factory + curated Morpho allowlist (Priority: P2)

*(Blocked by US1; depends on US2.)* A `SparkPointVaultFactory` — admin-gated, holding **no funds** — that deploys full-bytecode `SparkPointMorphoVault` instances via CREATE2 from a **curated, on-chain-gated allowlist** of vetted Morpho vaults, and registers each new instance so it flows into the 010 registry/reader. Plus a Foundry deploy script `DeployMorphoVault.s.sol`.

**Why this priority**: The factory is the "launch new vaults later" capability the brief asks for, but it is only safe once the template (US2) is proven and the amendment (US1) is ratified. Curated-allowlist gating is the guardrail that keeps IV.5's "impossible by construction" spirit even after the whitelist is widened.

**Independent Test**: From a non-admin account, a `deploy` call reverts; from the admin, deploying against an **allowlisted** Morpho vault produces a working wrapper whose code hash equals the expected full-bytecode hash (not a 45-byte proxy) and which appears in the 010 reader; deploying against a **non-allowlisted** address reverts by construction; the factory's own balance is provably always zero.

**Acceptance Scenarios**:

1. **Given** a curated allowlist entry for a vetted Morpho vault, **When** the admin deploys a wrapper for it, **Then** a new `SparkPointMorphoVault` is created at a deterministic CREATE2 address, initialized with that single Morpho vault immutable, and registered.
2. **Given** a Morpho address NOT on the curated allowlist, **When** any deploy is attempted, **Then** it reverts — the factory cannot wrap an un-vetted vault by construction (curated-allowlist gate).
3. **Given** a non-admin caller, **When** they call any deploy or allowlist-mutation function, **Then** it reverts (admin-gated).
4. **Given** any sequence of factory calls, **When** the factory's USDC/ETH balance is checked, **Then** it is zero — the factory is deploy-only and never custodies funds.
5. **Given** a deployed instance, **When** its runtime code is hashed, **Then** it is the full `SparkPointMorphoVault` bytecode (a genuine non-upgradeable instance), NOT an EIP-1167 minimal-proxy delegating to an implementation (N5).

---

### User Story 4 - /admin/vaults MANAGE half: create + guardian-gated actions (Priority: P2)

*(Blocked by US1; depends on US3.)* The **manage** half of the unified `/admin/vaults` page (whose **read** half shipped in 010 US3): a create-vault flow (pick a curated Morpho target → deploy via the factory → record in the admin DB and the 010 registry) plus guardian-gated operational actions — `pause`/unpause, `setFee`, `setFeeRecipient`, adjust caps — each routed through the OZ `TimelockController` guardian. The UI makes the "**no move-funds action exists**" invariant visible.

**Why this priority**: Without a manage surface the factory (US3) is operator-only via scripts. This is the stakeholder-facing "launch + operate vaults" capability. It reuses the 010 read half so operators see live state and pending timelock actions in one place.

**Independent Test**: On `/admin/vaults`, an admin creates a wrapper from a curated target and sees it appear (via the 010 reader) with live `paused`/`feeBps`/`hwm`/`totalAssets`; queuing a `setFee` produces a timelock operation that only executes after the delay and only from the guardian; the page exposes no "withdraw to treasury" / "move funds" control because no such contract function exists.

**Acceptance Scenarios**:

1. **Given** the ratified amendment and a deployed factory, **When** the admin runs the create-vault flow against a curated target, **Then** the wrapper deploys and its live state renders through the **010** reader on the same page (010 US3 ↔ 011 US4).
2. **Given** a deployed wrapper, **When** the admin changes the performance fee, **Then** the call is **queued on the OZ Timelock** (guardian) and executes only after the timelock delay — never as an instant admin write (mirrors the vault's timelock-governed pause).
3. **Given** the fee is changed, **When** the new fee is > 2000 bps, **Then** the action is rejected client-side and on-chain (≤20% cap, default 10%).
4. **Given** the manage page, **When** an operator looks for a way to move user funds out, **Then** none is presented, and the page states the non-custody invariant (N1) explicitly.
5. **Given** the killswitch surface (existing `apps/web/src/app/admin/killswitch/page.tsx`), **When** a wrapper is paused via the guardian, **Then** it pauses **new deposits only** and withdrawals remain open (N2, pause-only killswitch).

---

### User Story 5 - App user-signed deposit/withdraw into a branded wrapper (Priority: P3)

*(Blocked by US1; depends on US2/US3.)* An end user can deposit into and withdraw from a branded wrapper vault from the app, entirely **user-signed**, reusing the existing vault confirm gate and the universal-swap tx patterns. The wrapper is discovered automatically through the 010 registry/reader — no per-vault frontend hardcoding.

**Why this priority**: This delivers user value from the new vaults, but only after the custody template, factory, and manage surface exist. It is deliberately last and thin because it reuses shipped confirm/execute plumbing.

**Independent Test**: With a wallet, select a branded wrapper surfaced by the 010 reader, deposit USDC (user-signed, funds land in the user's share position), see the honest stacked-fee + "yield is not Aave" disclosure, then withdraw to the user's own address with SparkPoint holding nothing at any point.

**Acceptance Scenarios**:

1. **Given** a wrapper in the 010 registry, **When** the app lists vaults, **Then** the wrapper appears automatically with its branded name/symbol and live APY-net-of-everything — no hardcoded per-vault address in the frontend.
2. **Given** a deposit, **When** the user confirms, **Then** the existing confirm gate (`apps/web/src/lib/chain/useVaultConfirm.tsx`) shows the branded name, the **stacked double-fee** (SparkPoint fee + Morpho curator fee), and that the yield source is the Morpho vault, **not** Aave (Principle III); the user signs and receives branded shares.
3. **Given** a withdrawal, **When** the user confirms, **Then** assets return to the user's own address (N1/N2), clamped to available Morpho liquidity, using `apps/web/src/lib/chain/exit.ts` patterns.
4. **Given** a wrapper paused via the guardian, **When** the user tries to deposit, **Then** the deposit is blocked but the withdraw path stays enabled (N2).

---

### Edge Cases

- **Underlying Morpho vault paused/insolvent/deprecated.** The wrapper must not fabricate liquidity; withdrawals clamp to `morphoVault.maxWithdraw(this)`; the manage UI surfaces the degraded underlying state (from the 010 reader) honestly.
- **Vaults V2 `max*` returns 0.** Availability must be derived from underlying market state, not read as "zero withdrawable" (see [research.md](./research.md) D3), or every withdraw would falsely revert.
- **Non-rebasing rounding.** `totalAssets()` via `convertToAssets` can round down; share-price and fee HWM math must be rounding-safe so the fee never dips into principal (invariant test).
- **Curated target de-listed after deployment.** Existing wrappers keep functioning (immutable target); the factory simply refuses to deploy *new* wrappers for the de-listed target. Withdrawals never depend on allowlist membership.
- **Admin session compromise.** Even a compromised admin cannot (a) wrap a non-allowlisted vault, (b) instant-change fees (timelock), or (c) withdraw user funds (no such function). Blast radius is bounded to pausing new deposits and queuing timelocked fee/cap changes.
- **CREATE2 address collision / re-deploy of same salt.** The factory must refuse to redeploy to an occupied address and register each instance exactly once.
- **Double-fee not disclosed.** Any surface showing APY/fee without the stacked-fee + non-Aave-source disclosure is a Principle III failure and must fail review.
- **Guardian mis-set.** A wrapper whose guardian is not the OZ TimelockController must be rejected at deploy (fail-closed).

## Requirements *(mandatory)*

*All requirements below are **contingent on FR-001** (ratification). None may be implemented until FR-001 is satisfied.*

### Functional Requirements — Governance gate

- **FR-001** (P0, blocking): The feature MUST NOT begin implementation until the operator ratifies, by super-majority, a constitution amendment permitting branded single-purpose non-upgradeable Morpho-wrapper vaults that preserve N1–N5, amending IV.5 / V / VII while keeping the Aave vault as default. Ratification MUST be recorded in `.specify/memory/constitution.md` with a version bump and MUST NOT be implied by merged code (Governance; ObraHaus 2.6).
- **FR-002**: The [plan.md](./plan.md) Constitution Check MUST honestly record IV.5, V, and VII as FAIL/CONFLICT under the current constitution and MUST return **GATE BLOCKED** until FR-001 is satisfied; upon ratification it MUST be re-run to **GATE PASS** citing the new clause.

### Functional Requirements — Non-custody invariants (per instance)

- **FR-003 (N1)**: A deployed wrapper MUST expose no function that transfers user assets to a SparkPoint/admin/treasury address. Only the depositing user may withdraw their assets out. Verified by `contracts/test/refute/RefuteN1Morpho.t.sol`.
- **FR-004 (N2)**: A user MUST be able to withdraw on-chain even when SparkPoint is offline and the wrapper is paused; pause blocks **new deposits only**, never withdrawals. Withdrawable amount is clamped to available Morpho liquidity but is never gated by allowlist membership, admin state, or off-chain services. Verified by `contracts/test/refute/RefuteN2Morpho.t.sol` + a fork test with partial liquidity.
- **FR-005 (N5)**: Each wrapper MUST be a **full-bytecode, non-upgradeable, single-purpose** instance — no proxy, no `delegatecall`-to-implementation, no `upgradeTo`, no `sweep`/`migrate`/`rescue`. The single Morpho vault target and USDC asset MUST be constructor/immutable. Verified by `contracts/test/refute/RefuteN5Morpho.t.sol` + a runtime code-hash assertion.
- **FR-006 (N3/N4)**: The wrapper MUST NOT introduce any new automation, session key, or key-custody surface; deposits/withdrawals are user-signed with user-owned keys (unchanged from the Aave vault).

### Functional Requirements — Template (SparkPointMorphoVault)

- **FR-007**: `totalAssets()` MUST equal `morphoVault.convertToAssets(morphoVault.balanceOf(address(this)))` (non-rebasing accounting), never a raw ERC-20 balance.
- **FR-008**: `_deposit` MUST supply USDC into the single Morpho vault (`morphoVault.deposit`) and mint branded shares; `_withdraw` MUST redeem from the Morpho vault and return assets to the user.
- **FR-009**: `maxWithdraw`/`maxRedeem` MUST be clamped to `morphoVault.maxWithdraw(address(this))` so the ERC-4626 withdrawability assertion holds under partial Morpho liquidity (N2 partial-exit).
- **FR-010**: For Morpho **Vaults V2** underlyings whose `max*` return 0 by design, availability MUST be derived from the underlying market/liquidity state, not treated as zero-withdrawable (documented in [research.md](./research.md) D3).
- **FR-011**: The performance fee MUST be **profit-only, high-water-mark-gated, minted as fee-shares** to `feeRecipient`, default 1000 bps, hard cap 2000 bps (≤20%), and MUST NOT touch principal (mirrors `SparkPointVault.sol`).
- **FR-012**: The guardian MUST be an OZ `TimelockController`; the wrapper MUST reject a non-timelock guardian at construction (fail-closed). Guardian power is **pause-deposits-only**.

### Functional Requirements — Factory

- **FR-013**: `SparkPointVaultFactory` MUST deploy the **full** `SparkPointMorphoVault` bytecode per instance via **CREATE2** (deterministic address), NOT an EIP-1167 minimal-proxy clone — because a clone `delegatecall`s to an implementation, re-introducing an upgrade/behaviour-swap surface that violates N5.
- **FR-014**: The factory MUST be **admin-gated**: only the admin role may deploy wrappers or mutate the curated allowlist.
- **FR-015 (curated-allowlist gating)**: The factory MUST refuse to deploy a wrapper whose target Morpho vault is not on an on-chain **curated allowlist** of vetted vaults — un-vetted vaults MUST be un-wrappable **by construction** (this preserves IV.5's "impossible by construction" spirit after the whitelist is widened by the amendment).
- **FR-016**: The factory MUST hold **no funds** at any time (deploy-only); a balance invariant MUST assert this.
- **FR-017**: The factory MUST register each deployed wrapper so it is discoverable by the **010** registry/reader (`services/agent/src/sparkpoint_agent/chain/vault_reader.py` + `apps/web/src/lib/chain/useVault.ts`) with no per-vault frontend hardcoding.
- **FR-018**: The factory MUST refuse to redeploy to an already-occupied CREATE2 address and MUST register each instance exactly once.

### Functional Requirements — Admin manage surface

- **FR-019**: The unified `/admin/vaults` page MUST provide a create-vault flow (curated target → factory deploy → DB + 010 registry record) and MUST render live state via the **010** read half (010 US3 ↔ 011 US4).
- **FR-020 (guardian-gated actions)**: `pause`/unpause, `setFee`, `setFeeRecipient`, and cap adjustments from the manage UI MUST be routed through the OZ `TimelockController` (queue → wait delay → execute), never as instant admin writes; `setFee` MUST reject > 2000 bps on client and chain.
- **FR-021 (non-custody visible)**: The manage UI MUST NOT present any move-funds/withdraw-to-treasury control (none exists on-chain) and MUST state the N1 non-custody invariant explicitly.

### Functional Requirements — App deposit/withdraw

- **FR-022**: The app MUST let users deposit/withdraw into a branded wrapper **user-signed**, reusing the confirm gate (`apps/web/src/lib/chain/useVaultConfirm.tsx`), execute (`useExecuteVaultTx.ts`), and exit (`exit.ts`) patterns; wrappers are listed via the 010 reader (no hardcoded addresses).
- **FR-023 (double-fee disclosure)**: Every surface showing a wrapper's fee or APY — confirm gate, `/admin/vaults`, `/fees`, and any chat/portfolio card — MUST disclose (a) that SparkPoint's performance fee **stacks on** the Morpho curator's native fee, and (b) that the yield source is the external Morpho vault, **NOT** Aave v3 (Principle III, net-of-everything).

### Functional Requirements — Policy boundary (unchanged)

- **FR-024**: This feature MUST NOT widen the agent's deterministic-policy allowlist, the `Asset` enum, or any `(target,selector)` policy permission beyond what the ratified amendment explicitly authorizes. The `Protocol` enum change (adding a curated-Morpho-wrapper protocol) — if any — MUST be mirrored across `services/agent/.../policy/enums.py` and `packages/shared/src/policy/enums.ts` (T098 parity) and MUST be part of the ratified amendment, not an implementation-time addition (contrast the 007 recorded-scope-note pattern, which did **not** apply here).

### Key Entities

- **Constitution amendment (governance record)**: the super-majority-ratified text in `.specify/memory/constitution.md` widening IV.5/V/VII to curated Morpho wrappers while preserving N1–N5; the gate all code depends on.
- **SparkPointMorphoVault (template)**: single-purpose, non-upgradeable ERC-4626 branded wrapper; immutables `{ morphoVault: IERC4626, asset: USDC, guardian: TimelockController, feeRecipient }`; state `{ highWaterMark, performanceFeeBps }`; non-rebasing `totalAssets`; clamped `maxWithdraw`.
- **SparkPointVaultFactory**: admin-gated, fund-less CREATE2 full-bytecode deployer + registrar; holds the curated Morpho allowlist.
- **Curated Morpho allowlist entry**: `{ chainId, morphoVault address, label, vettedAt, active }` — the on-chain gate for what may be wrapped.
- **Wrapper registry record (010)**: the 010 registry row a new wrapper is written into, consumed by the 010 reader and this feature's manage/app surfaces.
- **Guardian timelock operation**: an OZ `TimelockController` queued op for pause/setFee/setFeeRecipient/caps.
- **Fee disclosure**: the stacked-fee + non-Aave-source statement shown wherever APY/fee appears.

## Success Criteria *(mandatory)*

- **SC-001**: With the current constitution, the Constitution Check returns **GATE BLOCKED** and names IV.5/V/VII as conflicts; **zero** implementation tasks start before FR-001 (auditable in tasks.md — T001 is the only unblocked task).
- **SC-002**: Ratification (FR-001) is recorded in `.specify/memory/constitution.md` with a version bump and a super-majority approval note before any Solidity/TS lands.
- **SC-003**: In a Foundry fork with a seeded Morpho vault at **partial** withdrawable liquidity, **100%** of depositing users can withdraw their available pro-rata balance on-chain with SparkPoint offline and the wrapper paused (N2).
- **SC-004**: The refute suite finds **no** function that moves user funds to a non-user address and **no** upgrade/proxy path; the deployed instance's runtime code hash equals the full-bytecode hash, not a 45-byte minimal proxy (N1/N5).
- **SC-005**: A deploy against a non-allowlisted Morpho address reverts in **100%** of attempts; a non-admin deploy reverts in **100%** of attempts; the factory balance is **zero** across the full test suite.
- **SC-006**: Every fee/APY surface for a wrapper shows the stacked-double-fee + non-Aave-source disclosure (checked by a UI/content test); **zero** surfaces show a wrapper APY without it.
- **SC-007**: A newly deployed wrapper appears in the 010 reader and on `/admin/vaults` with **no** new hardcoded frontend address; all guardian actions execute only via the timelock after its delay.
- **SC-008**: The `Protocol`-enum parity check (T098) stays green; the policy allowlist / `Asset` enum / `(target,selector)` set is unchanged except as the ratified amendment authorizes.

## Assumptions

- The operator can convene governance and reach the super-majority the Governance section requires; if they decline, the feature stays Blocked and the codebase is unchanged (this is an acceptable, honest outcome).
- Morpho Vaults on Base are standard ERC-4626 (+ERC-2612), non-custodial, non-rebasing (shares, not balances). The wrapper reads them purely through the ERC-4626 interface.
- On Base Sepolia (84532, the alpha chain) there are **no** ready curated Morpho vaults/yield/API; US2/US3 test against a **self-created + seeded** test Morpho vault/market/oracle (Morpho Blue `0xBBBB…FFCb` + factories deployed there; verify the real Base-Sepolia VaultV2 factory on-chain — the widely-quoted `0x4501…5857` is the **mainnet** address). Real curated vaults exist on Base mainnet (8453).
- The Morpho GraphQL API (`https://api.morpho.org/graphql`, mainnet-only) is the yield/APY **data** feed for mainnet wrappers (010 half), with DeFiLlama/on-chain-derived fallback; testnet APY is derived on-chain.
- The revenue model's "same performance-fee spine extends to higher-alpha vaults / curator-style cut" is honored: a SparkPoint-owned/curated Morpho vault can additionally route a ≤20% curator fee to a SparkPoint treasury (separate from, and additive to, the wrapper's own HWM fee — hence the double-fee disclosure).
- Adding deps uses **pnpm 9** (not 11) to preserve the lockfile security overrides; any new agent seed dir needs an explicit `COPY` in `services/agent/Dockerfile` (project ops gotchas).
- This spec deliberately writes acceptance/requirements for US2–US5 so the operator can see exactly what ratification authorizes — but authoring the spec is **not** implementation and does not itself satisfy or bypass FR-001.
