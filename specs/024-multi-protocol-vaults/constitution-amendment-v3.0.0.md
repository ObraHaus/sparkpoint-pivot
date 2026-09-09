# Proposed Constitution Amendment — v2.0.0 → v3.0.0 (MAJOR)

**Status: ✅ RATIFIED AND APPLIED — 2026-07-30.**

`.specify/memory/constitution.md` is now at **v3.0.0** with the amendment-log entry appended. Ratification
was authorized explicitly by the operator (aldrickb) after the findings report and the D1/D2/D3 decisions.
This file remains the proposal of record and the evidence trail.

**Applied with one substantive change to the draft:** the "open question" about Vault V2's fee accrual was
CLOSED by reading the source, and the answer changed the amendment. V2 keeps **no high-water-mark state**,
so the ratified text carries an explicit **disclosure** obligation rather than only a wording change — see
"The SECOND genuine weakening" below. Ratification therefore also **commits us to restating the
user-facing fee copy before any Fee Wrapper accepts a deposit.**

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

## The SECOND genuine weakening — resolved, and it is a disclosure change

This was an open question; it is now closed by reading `morpho-org/vault-v2` `src/VaultV2.sol`
`accrueInterestView()`. **V2's performance fee is profit-only per accrual, but it is NOT
high-water-mark.**

```solidity
uint256 interest = newTotalAssets.zeroFloorSub(_totalAssets);   // max(0, new - last)
uint256 performanceFeeAssets = interest > 0 && performanceFee > 0 && ...
    ? interest.mulDivDown(performanceFee, WAD) : 0;
```

- **What holds:** no fee in a flat or down period (`zeroFloorSub` floors at 0), and the fee is share
  **dilution** to the recipient (`createShares`), never a transfer out of principal — same as ours.
- **What does NOT hold:** there is **no high-water-mark state anywhere in the contract**. The fee is
  charged on *each positive increment since the last accrual*, with no memory of a prior peak. So a
  depositor who suffers a loss and then recovers **pays a performance fee on the recovery**, even while
  still below their own previous peak. `SparkPointMorphoVault` prevents exactly that with an explicit
  `_highWaterMark`.
- **Management fee:** V2's own NatSpec warns it "is not bound to the interest, so it can make the share
  price go down" and "is taken even if the vault incurs some losses." We set it to **0**, so this is
  moot — but the 0 is **load-bearing, not cosmetic**, and must stay 0.

**Therefore this is a disclosure amendment, not only a wording one.** The current user-facing promise —
*"a PERFORMANCE FEE … on REALIZED YIELD ONLY, above a share-price high-water mark — never on principal,
never in flat/down periods"* — is **not accurate for a Fee Wrapper** and MUST be restated before any Fee
Wrapper takes a deposit. Honest wording: *"charged only when the vault gains value over a period, never
on your principal and never while it is flat or falling — note that a gain following an earlier loss is
charged, even if you are still below your previous high."*

Options, for the record: (a) accept V2's semantics and restate the disclosure (recommended — simple,
audited, and the fee is still never on principal); (b) keep HWM by keeping our own Solidity, and pay for
the audit; (c) set the Fee Wrapper's performance fee to **0** and monetise elsewhere, which makes the
question disappear entirely.

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

- [x] Operator confirms the **fee-cap enforcement downgrade** (bytecode constant → policy + timelock).
      *Authorized 2026-07-30; recorded verbatim in the amendment log as weakening (a).*
- [x] Operator confirms **real user funds on chain 4663**, a chain with no Aave fallback and a non-USDC
      unit of account. *Decision D3, taken explicitly.*
- [x] V2 performance-fee accrual checked — **profit-only per accrual, but NOT high-water-mark**. The
      disclosure obligation is now ratified text, and the fee copy MUST be restated before a Fee Wrapper
      takes a deposit (tracked as T024 in `tasks.md`).
- [ ] **STILL OPEN — securities counsel sign-off** that a Fee Wrapper distributor is not a discretionary
      manager. Explicitly **out of build scope** per the constitution's own scope clause, so it does not
      block engineering — but it is *not* satisfied, and it is the one item a reader should not mistake for
      done. Flagged, not assumed.
- [x] Version bumped to **3.0.0**, `Last Amended` 2026-07-30, amendment log entry appended.
- [x] This file marked **APPLIED**.
