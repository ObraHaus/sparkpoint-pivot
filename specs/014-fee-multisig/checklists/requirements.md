# Specification Quality Checklist: Fee Treasury Multisig Migration

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validation passed on first iteration (2026-07-21). The spec keeps HOW out of scope — no contract
  addresses, selector encodings, address-book field names, or the specific `schedule`/`execute` mechanics
  leak into the WHAT/WHY; those are deferred to plan.md / research.md / the contracts doc.
- The six pivotal decisions were pre-resolved with the operator and recorded in the `## Clarifications`
  (Session 2026-07-21) section, so no `[NEEDS CLARIFICATION]` markers remain: one shared Safe treasury; the
  Safe gets **no** on-chain governance role; created via `app.safe.global` (no Safe SDK); 2-of-3 with keys
  held outside the repo; **no** vault redeploy (Timelock ceremony); and **no** database migration.
- **The crux is the two independent surfaces.** The spec is explicit that (A) the vault `_feeRecipient`
  moves **only** through the Timelock ceremony — which auto-moves the Base / Base-Sepolia swap fee via the
  live `feeRecipient()` fallback — while (B) the Robinhood 46630 `swapFeeRecipient` is a hardcoded constant
  that does **not** follow the Timelock and needs a separate constant edit + web redeploy. Conflating them
  is called out as the primary migration hazard (Edge Cases + FR-009/FR-010).
- **Constitution alignment (v1.3.0):**
  - **Principle I / N1, N2, N5 (NON-NEGOTIABLE):** FR-011, FR-013, SC-004, and the "Guardian unchanged"
    edge case guarantee the Safe gains **zero** fund-movement authority over user funds — it is never the
    vault guardian, is granted no Timelock role, has no withdraw/redeem path, and the withdraw-always exit
    is untouched. **N5 is the star** ("any multisig or timelock MUST govern PAUSE ONLY, never fund
    movement"): the fee Safe governs *nothing*, and the plan records this does **not** touch N1–N5, so no
    re-ratification is required.
  - **Principle III (Provable, Not Promised):** FR-008, FR-012, FR-014, SC-003, SC-005 bind the fee
    recipient, the Safe's (nil) powers, and the admin-revenue balances to **live on-chain reads** that
    honest-degrade — no asserted or fabricated figures; the ceremony (tx hashes + `FeeRecipientUpdated`) is
    recorded (FR-016).
  - **Principle IV (bounded blast radius):** replacing a single hot EOA with a 2-of-3 multisig adds signer
    redundancy and routes the change through the existing delayed, public Timelock — no new privileged path.
  - **Principle V (fee model unchanged):** the fee recipient stays a **non-privileged share holder** (now a
    multisig instead of an EOA); no new fee, strategy, or token incentive; SRK untouched.
  - **Principle VII (Simplicity / YAGNI):** no new dependency (explicitly no Safe SDK), no migration, no
    contract change, no vault redeploy.
- Deferred to plan.md / research.md (the HOW): the exact Timelock `schedule`→wait→`execute` encoding + salt
  + operation-id verification, the address-book `feeTreasury` field, the non-key `FEE_WALLET_ADDRESS` agent
  constant, the swap-fee fallback mechanics, and the Foundry fork test locking the ceremony semantics.
- **No new migration** — the latest on disk remains `0015_limits.sql`; 014 adds none (the parallel 012/013
  work is claiming provisional `0016`/`0017`, to be reconciled with the 010/011 work before applying).
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. (None.)
