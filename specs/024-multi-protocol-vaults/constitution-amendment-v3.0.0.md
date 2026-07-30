# Proposed Constitution Amendment — v2.0.0 → v3.0.0 (MAJOR)

**Status: DRAFT — NOT RATIFIED. NOT APPLIED.**

`.specify/memory/constitution.md` is **deliberately unmodified** by this feature. The constitution's own
Governance clause requires that an amendment be made *"explicitly here per Governance — never implicitly
through implementation."* This file is the proposal; ratification is an operator act, and only after it
may `constitution.md` be edited and this file marked applied.

- **Proposed by:** feature `024-multi-protocol-vaults`, 2026-07-30
- **Classification:** **MAJOR** — it redefines the wording of NON-NEGOTIABLE Guardrail **IV.5** and the
  **Chain & scope** constraint. Per Governance this requires **super-majority re-ratification**, the same
  bar taken for v2.0.0.
- **Blocks:** feature 024 Phases 3, 5 and 6. Phases 0, 2 and 4 are advisory/safety-only and proceed
  without it.

---

## Why an amendment is unavoidable

The operator has chosen (D1) **Registry + Morpho Vault V2 Fee Wrapper**, (D3) **ratify Robinhood Chain
mainnet 4663**, and (D2) **list two Base-mainnet children**. Three ratified clauses currently forbid
parts of that, and one is merely out of date.

| # | Clause (v2.0.0) | Conflict | Proposed disposition |
|---|---|---|---|
| 1 | **IV.5** — a wrapper is "ineligible if any **SparkPoint-controlled address holds a role** over the underlying" | A Fee Wrapper is itself a Vault V2 whose owner/curator/allocator/sentinel are SparkPoint's Safe. Read literally, SparkPoint holds roles over *the wrapper* — though **not** over the **child**. | **Narrow the wording** to what it was protecting: no SparkPoint role over the **child/underlying** venue, and no **discretionary** role anywhere in the path. |
| 2 | **Principle VII** — forbids "any meta-vault or router that moves user funds between curated Morpho vaults" | A Fee Wrapper routes into exactly **one** immutably-bound child and has `addAdapter`/`removeAdapter` **abdicated** — it can never move funds *between* vaults. | **No change needed.** Add a clarifying sentence that a single-child, adapter-abdicated Fee Wrapper is not a meta-vault. Full curation remains forbidden. |
| 3 | **Chain & scope** — "networks BEYOND Base + Sui remain out of scope"; on Base, integrations "limited to Aave v3, Aerodrome, and — for branded wrapper vaults only — curated-allowlist Morpho vaults. No other protocols." | Robinhood Chain (4663) is excluded. *(46630 is already a de-facto divergence for swap/chat.)* | **Extend** to Base + Sui + Robinhood Chain, and record the existing 46630 divergence honestly. |
| 4 | **IV.5 / N5** — each wrapper is "a plain, non-upgradeable, single-purpose ERC-4626 (**full-bytecode CREATE2, not a minimal-proxy clone**)… its one underlying Morpho vault is fixed at deploy" | A Morpho Vault V2 is a plain non-upgradeable contract deployed by CREATE2 via Morpho's factory, single-child and immutably bound — it **satisfies the intent**, but the clause names *our* contract shape. | **Generalise**: allow the branded wrapper to be either a `SparkPointMorphoVault` **or** a Morpho Vault V2 Fee Wrapper meeting the enumerated conditions. |

---

## The one genuine weakening — state it plainly

v2.0.0 guarantees the performance fee is "**timelocked, hard-capped ≤20%**". In
`SparkPointMorphoVault` that cap is a **bytecode constant** (`_MAX_PERFORMANCE_FEE_BPS = 2000`) — a fee
above 20% is not merely disallowed, it is *unrepresentable*.

A Morpho Vault V2's ceilings are **50% performance / 5% management**. Adopting Fee Wrappers therefore
**downgrades the ≤20% / 0% guarantee from a bytecode invariant to a policy commitment** enforced by:

1. the **owner being the 2-of-3 Safe**, never an EOA;
2. a **≥3-day timelock** on `setPerformanceFee` / `setManagementFee` / the fee-recipient setters; and
3. a **public Trust Center read** of the live on-chain fee, so any pending change is observable during
   the timelock window.

This is a real reduction in enforcement strength and must be ratified knowingly, not absorbed silently.
The mitigating trade is that Fee Wrappers **strengthen** N1, N2 and N5 (permanently abdicated gate
setters, permanently abdicated adapter list, and `forceDeallocate` in-kind exit) — and are audited,
which our wrapper never was.

**Open question that must be closed before Phase 6:** confirm from `vault-v2` source whether V2's
performance fee is **high-water-mark and profit-only**. Our wrapper guarantees both. If V2's is not, the
"never on principal, never in flat/down periods" promise changes substance and this becomes a
**disclosure** amendment as well as a wording one.

---

## Proposed text changes

### 1. Guardrail IV.5 — replace the ineligibility sentence

> **From:** "…ineligible if any SparkPoint-controlled address holds a role over the underlying."
>
> **To:** "…**ineligible if any SparkPoint-controlled address holds any role over the CHILD/underlying
> venue, or holds any DISCRETIONARY role (market selection, cap-setting, or allocation) anywhere in the
> deposit path.** SparkPoint MAY hold non-discretionary governance of its own branded wrapper — owner,
> and a curator/allocator/sentinel whose risk-management powers are irreversibly **abdicated** at
> deployment — provided the wrapper is bound to exactly one child for its lifetime and the three
> critical gate setters are permanently abdicated."

### 2. Guardrail IV.5 / N5 — generalise the permitted wrapper shape

Add:

> "A branded wrapper MAY be either (a) a `SparkPointMorphoVault` (full-bytecode CREATE2), or (b) a
> **Morpho Vault V2 Fee Wrapper**, provided that at deployment: `addAdapter` and `removeAdapter` are
> **abdicated** (one child, forever); `setReceiveSharesGate`, `setSendSharesGate` and
> `setReceiveAssetsGate` are **abdicated** (`abdicateNonCriticalGates: true`) so no gate can ever block a
> user; the **dead deposit** is the first transaction on the empty vault; the owner is the multisig;
> curator selectors carry a **≥3-day timelock**; the management fee is **0** and the performance fee
> **≤20%**; and the child passes the on-chain eligibility check (`isVaultV2`, gate setters abdicated,
> `asset()` match, liquidity floor). New `SparkPointMorphoVault` deployments are **superseded**; existing
> instances remain redeemable forever."

### 3. Principle VII — clarify, do not weaken

Add after the meta-vault prohibition:

> "A single-child, adapter-abdicated **Fee Wrapper** is **not** a meta-vault: it cannot move funds
> between vaults, because its adapter list is irreversibly fixed to one child at deployment.
> **Discretionary curation by SparkPoint — market selection, cap-setting, or allocation — remains
> forbidden.**"

### 4. Chain & scope — extend to Robinhood Chain

> **From:** "Multi-network: Base (launch) + Sui (fast-follow)… networks beyond Base + Sui remain out of
> scope."
>
> **To:** "Multi-network: Base (launch) + Sui (fast-follow) + **Robinhood Chain (mainnet 4663)**…
> networks beyond these remain out of scope. On Robinhood Chain the permitted integrations are
> **Morpho** (deposit/withdraw **USDG** via a branded Fee Wrapper over an allowlisted Vault V2) and the
> existing user-signed Synthra V3 swap. **Aave v3 is not deployed on Robinhood Chain**, so the vault
> there has no Aave fallback and the UI MUST say so. **Robinhood testnet (46630) has no Morpho
> deployment of any kind**; it remains swap-only with the vault path fail-closed, and MUST NOT be given
> a mock substitute."

### 5. On-chain contracts — record supersession

Append to the authoritative contract list:

> "(2026-07-30, v3.0.0) The `SparkPointMorphoVault` wrapper family is **superseded** for new deployments
> by Morpho Vault V2 Fee Wrappers. The Base-Sepolia demo wrapper `0xff0a…E9BB` is **retired** — deposits
> closed, withdrawals permanently open (N2) — because its immutable underlying was a mock with
> unpermissioned simulation hooks."

---

## What this amendment does NOT do

- It does **not** permit SparkPoint to curate a Morpho vault, select markets, set caps or allocate.
- It does **not** weaken N1, N2, N3, N4 or N5 — on the Fee Wrapper path it strengthens N1/N2/N5.
- It does **not** change the pause-only kill switch, the AI-disposition rule, or the user-signs-everything
  rule (Principle II).
- It does **not** permit a mock to stand in for a real protocol on any network.

---

## Ratification checklist

- [ ] Operator confirms the **fee-cap enforcement downgrade** (bytecode constant → policy + timelock).
- [ ] Operator confirms **real user funds on chain 4663**, a chain with no Aave fallback and a non-USDC
      unit of account.
- [ ] V2 performance-fee accrual confirmed **HWM + profit-only**, or the disclosure updated.
- [ ] Securities counsel sign-off that a Fee Wrapper distributor is not a discretionary manager
      *(out of build scope per the constitution; flagged, not assumed)*.
- [ ] Version bumped to **3.0.0**, `Last Amended` set, amendment log entry appended.
- [ ] This file marked **APPLIED** with the ratification date.
