# Constitution Amendment Proposal — Curated Morpho-Wrapper Vaults

**Status:** ✅ **RATIFIED 2026-07-21** (super-majority, operator-directed — aldrickb). This was the `011` Phase-0 / `tasks.md` **T001** governance gate. Written here per the constitution's Governance clause (*"Amendments MUST be proposed in writing with rationale and the affected artifacts, reviewed, and approved before they take effect"*). Edits 1–9 below are **applied** to `.specify/memory/constitution.md` (now **v2.0.0**); 011 US2–US5 are unblocked.

**Classification:** `v1.3.0 → v2.0.0` — **MAJOR**, **super-majority re-ratification**.
**Directed by:** operator (aldrickb), 2026-07-21.
**Effect:** unblocks `specs/011-wrapper-vault-factory` (all of US2–US5).

---

## Why MAJOR (not the MINOR first-drafted)

A 3-lens adversarial review (non-custody / whitelist / scope+versioning) unanimously flagged that this **redefines the wording** of the NON-NEGOTIABLE Guardrail IV.5 (*"only Aave v3 + Aerodrome … impossible by construction"*) and the single-vault language in IV.6 / V / VII. The versioning rubric assigns *principle redefinitions* to **MAJOR**. The `v1.2.0` MINOR precedent does **not** apply — it was MINOR *because* it did not touch these clauses. So this is `v2.0.0`, on the **super-majority re-ratification** track (it touches non-upgradeable / single-purpose vault semantics + the IV.5 boundary).

It **expands** permitted scope and **removes/weakens no invariant** — N1–N5, the pause-only kill-switch, and the AI-disposition rule are extended *verbatim* to the new wrapper family (constraints added, none removed).

## What the review hardened (real holes it closed)

| # | Hole in the first draft | Closed by |
|---|---|---|
| 1 | An allowlisted Morpho vault whose curator/guardian is a **SparkPoint address** = back-door admin withdrawal (N1) | **Ineligibility rule** (Edit A/B) |
| 2 | Allowlist was mutable + ungoverned; wrapper could be re-pointed | **Immutable target at CREATE2** + allowlist governed by the **pause multisig+timelock**, future-deploys only (Edit A) |
| 3 | "Same fee" didn't forbid a direct USDC transfer out to a treasury (N1) | **Fee is share-dilution only, never touches principal/withdraw** (Edit B) |
| 4 | "withdraw-always" conflated SparkPoint-gating with Morpho liquidity (N2) | **SparkPoint can never be the cause of a blocked/partial exit** (Edit B) |
| 5 | Morpho could leak into the agent/policy/session-key path | **Curated allowlist is a separate registry, consumed only by the factory at deploy; unreadable by PolicyModule/SessionKeyValidator** (Edit A) |
| 6 | Factory could retain post-deploy authority | **Deploy-only, no privileged authority, no fund path** — stated as an invariant (Edit B) |
| 7 | V's first sentence still said "MUST be a SINGLE vault" | Reworded to **"launch DEFAULT vault"** (Edit 3); IV.6 binds every instance (Edit 2) |
| 8 | VII "within a single vault" opened cross-vault optimizer creep | **Cross-vault optimization / auto-rebalancing / routers explicitly deferred** (Edit 5) |

---

## The exact edits (current → proposed)

### Edit 1 — Principle IV.5 (whitelist)
**Current:** *"5. Only whitelisted protocols are permitted at launch: Aave v3 and Aerodrome. Interaction with any other protocol MUST be impossible by construction."*

**Proposed:**
> 5. Only whitelisted protocols are permitted. **Aave v3 and Aerodrome are fixed and un-addable — interaction with any protocol outside this whitelist MUST be impossible by construction.** In addition — **for branded wrapper vaults ONLY** — Morpho vaults drawn from an on-chain **curated Morpho allowlist** of vetted Morpho vaults are permitted, and their admission is construction-enforced: **(a)** each wrapper's single underlying Morpho vault is an **immutable constructor argument fixed at CREATE2 deployment**, never re-pointable, re-targetable, or upgradeable thereafter; the `SparkPointVaultFactory` MUST verify curated-allowlist membership of that target at deploy time and REVERT otherwise; no wrapper consults a mutable registry at runtime — a deployed wrapper's reachable protocol set is frozen (impossible by construction **at the instance level**). **(b)** Additions to and removals from the curated allowlist are governed by the **same multisig + timelock that governs the PAUSE kill-switch**, with a mandatory timelock delay and guardian veto window (no single key may add an entry); they take effect for **future deployments only** and MUST NOT alter custody or block the withdraw path of any already-deployed wrapper. **(c)** A Morpho vault is **INELIGIBLE** if any SparkPoint-controlled address holds an owner, curator, allocator, guardian, timelock-admin, or withdrawal role over it, or if its curator may reallocate to arbitrary/unbounded markets absent continuous monitoring and an enforced removal path. **(d)** The curated allowlist is a **separate** on-chain registry consumed **only** by the `SparkPointVaultFactory` at deploy time — it MUST NOT be readable or consulted by the `PolicyModule`, the `SessionKeyValidator`, or any agent/session-key strategy-direction path, and Morpho MUST NOT be a target of agent strategy direction or the user-signed swap path. This extends pause-only governance by **exactly one** narrowly-scoped, timelocked, deploy-time-only admission action and nothing else.

### Edit 2 — Principle IV.6 (single-purpose, non-upgradeable)
**Current:** *"6. The vault MUST be bounded, single-purpose, and non-upgradeable."*
**Proposed:**
> 6. **Every vault — the launch Aave Yield Vault and each factory-deployed wrapper instance — MUST be bounded, single-purpose, and non-upgradeable.**

### Edit 3 — Principle V (opening sentence)
**Current:** *"The vault product at launch MUST be a SINGLE conservative Aave Yield Vault (ERC-4626) with a 0 management fee, …"*
**Proposed:** *"The **launch DEFAULT vault** MUST be a single conservative Aave Yield Vault (ERC-4626) with a 0 management fee, …"* (remainder of the sentence unchanged).

### Edit 4 — Principle V (append after "New strategies MUST NOT be added under the banner of the launch vault.")
**Proposed addition:**
> **Curated Morpho-wrapper vaults.** In addition to that conservative Aave Yield Vault — which **remains the launch default, single-purpose and unchanged** — SparkPoint MAY operate a **deploy-only factory** (`SparkPointVaultFactory`) that deploys branded, single-purpose, **non-upgradeable** ERC-4626 **wrapper vaults**, each supplying pooled USDC into **exactly one curated-allowlist Morpho vault bound immutably at construction** (per IV.5). No new strategy is bolted onto the launch Aave vault; each wrapper is a *separate* single-purpose vault. **Every wrapper MUST preserve N1–N5 by construction, mirroring the launch vault:**
> - **N1 (no admin withdrawal):** no sweep/migrate/rescue/re-target path. The performance fee accrues **only** to a non-privileged share holder, is realized by **minting shares** against yield above the high-water mark, and **never** touches principal or the withdraw path; no wrapper may transfer USDC out of the pooled position to a fee, treasury, or recipient address directly. 0 management fee, 0 on principal; `feeRate` is the only mutable per-wrapper param (timelocked, hard-capped ≤20%, default 10%), never altering custody.
> - **N2 (withdraw-always):** wrapper redemption is permissionless and MUST NOT be gated, delayed, or blocked by any SparkPoint-held key, role, or pause (the guardian pauses **deposits only**, never withdrawals), with no lock-up. Exit is best-effort against the underlying vault's available liquidity; **insufficient underlying Morpho liquidity is the *sole* permissible cause of a partial or delayed exit — SparkPoint can never be that cause.**
> - **N3 / N4 (user keys; scoped automation):** deposits and withdrawals are user-signed; any session-key access to a wrapper is bounded by the on-chain `PolicyModule` exactly as for the launch vault — no session key gains implicit authority over a wrapper by virtue of the factory deployment.
> - **N5 (non-upgradeable, single-purpose):** each wrapper is a plain, non-upgradeable, single-purpose ERC-4626 (**full-bytecode CREATE2, not a minimal-proxy clone**); its one underlying Morpho vault is fixed at deploy and can never be redirected, rebalanced, or migrated — a change of underlying is only expressible as a **new** wrapper the user chooses to enter.
>
> The **factory is deploy-only**: it holds no user funds, exposes no deposit/withdraw/sweep/rescue/migrate function, and retains **no** privileged post-deployment authority (owner, pauser, guardian, or upgrader) over any wrapper it deploys — each deployed wrapper is self-governing under the same pause-only multisig/timelock. Because a wrapper's underlying Morpho vault charges its own fee, the **stacked fee MUST be disclosed net** to the user.

### Edit 5 — Principle VII (deferred list)
**Current:** *"The launch vault remains single-vault. The following are explicitly deferred … : multi-strategy vaults (…), ZK trade proofs, … additional protocols, … a general-purpose financial assistant."*
**Proposed:**
> The launch Aave vault remains single-purpose and single-vault, and each curated Morpho-wrapper vault is likewise single-purpose (exactly one curated vault each, bound for its entire lifetime) — these wrappers are **ratified scope under Principle V**, not the deferred "multi-strategy vault" pattern. The following remain explicitly deferred and MUST NOT be built: multi-strategy vaults (market-neutral, volatility harvesting, yield optimization *within a single vault*); **cross-vault yield optimization, auto-rebalancing or automated fund-routing between wrappers, and any meta-vault or router that moves user funds between curated Morpho vaults** (the factory is deploy-only and each wrapper is bound to exactly one Morpho vault for its entire lifetime); ZK trade proofs; SRK v2 utility and governance; KYC/compliance gating; **protocols beyond Aave v3 / Aerodrome / curated-allowlist Morpho**; stocks/TradFi; and a general-purpose financial assistant.

### Edit 6 — Additional Constraints · Chain & scope
**Current:** *"…On Base, DeFi integrations are limited to Aave v3 (deposit/withdraw USDC and ETH) and Aerodrome (swaps from chat). No other protocols at launch."*
**Proposed:** *"…On Base, DeFi integrations are limited to Aave v3 (deposit/withdraw USDC and ETH), Aerodrome (swaps from chat), and — **for branded wrapper vaults only** — curated-allowlist Morpho vaults (deposit/withdraw USDC via a single-purpose, non-upgradeable ERC-4626 wrapper, per IV.5/V). No other protocols."*

### Edit 7 — Additional Constraints · On-chain contracts (named)
**Proposed addition** (before "Contracts MUST be built with Foundry…"): *"; and (ratified 2026-07-21, v2.0.0) the `SparkPointVaultFactory` (deploy-only, CREATE2 full-bytecode, no fund path, no post-deploy authority) + the `SparkPointMorphoVault` wrapper family (single-purpose, non-upgradeable ERC-4626, curated-Morpho-allowlist-gated, same 0-management / profit-only ≤20% HWM fee)"*.

### Edit 8 — Amendment log (new entry, after the v1.3.0 entry)
> - **2026-07-21 — v1.3.0 → v2.0.0 (MAJOR; super-majority re-ratification).** Operator-directed (aldrickb) amendment permitting **curated Morpho-wrapper vaults**. Classified **MAJOR** because it **redefines** the wording of NON-NEGOTIABLE Guardrail IV.5 ("impossible by construction" whitelist) and the single-vault constraint in IV.6/V/VII — it **expands** permitted scope and removes/weakens no invariant. IV.5 now admits, **for branded wrapper vaults only**, Morpho vaults from an on-chain **curated allowlist** governed by the same multisig+timelock as the pause kill-switch (timelocked, guardian-veto, deploy-time-only, future-deployments-only, custody-neutral); every other protocol and every un-allowlisted Morpho vault stays impossible by construction, and each deployed wrapper's single underlying is fixed immutably at CREATE2. IV.6 binds "single-purpose, non-upgradeable" to **every** vault instance; V permits a **deploy-only factory** of branded, single-purpose, non-upgradeable ERC-4626 wrappers (the Aave vault remains the launch default, unchanged); VII keeps cross-vault optimization / auto-rebalancing / fund-routing / meta-vaults explicitly deferred. **This amendment extends N1–N5 verbatim to the new wrapper family — adding constraints, weakening none:** N1 (no admin withdrawal / sweep / migrate / direct-USDC fee-outflow; fee is share-dilution to a non-privileged holder, never on principal; ineligible if any SparkPoint-controlled address holds a role over the underlying), N2 (withdraw-always — only underlying Morpho liquidity may cause a partial/delayed exit, never SparkPoint), N3/N4 (user-signed; PolicyModule-scoped session keys; the curated allowlist is unreadable by the policy/agent path — Principle II unchanged), N5 (each wrapper plain/non-upgradeable/single-purpose; underlying fixed at deploy). The pause-only kill-switch is unchanged. **Super-majority re-ratification is taken** because the change touches the non-upgradeable/single-purpose vault semantics and the IV.5 boundary, made explicitly here per Governance — never implicitly through implementation. Unblocks `specs/011-wrapper-vault-factory`.

### Edit 9 — Version line
**Current:** *"**Version**: 1.3.0 | **Ratified**: 2026-06-15 | **Last Amended**: 2026-07-16"*
**Proposed:** *"**Version**: 2.0.0 | **Ratified**: 2026-06-15 | **Last Amended**: 2026-07-21"*

---

## On ratification (what happens next)

1. Apply Edits 1–9 to `.specify/memory/constitution.md` (version → `2.0.0`).
2. Re-run `011`'s Constitution Check → **GATE PASS**, citing the new IV.5/V/VII clauses.
3. Check off `tasks.md` **T001**; US2–US5 unblock.
4. This file is stamped **RATIFIED (date)**.

**Operator decision:** ✅ **Approved as MAJOR v2.0.0 (super-majority) on 2026-07-21.** Applied to `.specify/memory/constitution.md`; 011 `plan.md` → GATE PASS; `tasks.md` T001–T003 → done.
