# Specification Quality Checklist: Premium Purchase via SRK

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

- Validation passed on first iteration (2026-07-21). The spec keeps HOW out of scope — no
  contract/table names, endpoints, framework names, migration numbers, RPC methods, or the
  specific verifier seam; those are deferred to plan.md / research.md / data-model.md.
- The seven pivotal design decisions were pre-resolved with the operator and recorded in the
  `## Clarifications` (Session 2026-07-21) section, so no `[NEEDS CLARIFICATION]` markers remain:
  the payment token + network (fresh test SRK, Base Sepolia only), the price + no-USD-oracle
  (flat 500 SRK/month compared in base units), buyer-not-trusted-from-body, anti-replay via a
  payments-ledger uniqueness (not the idempotency key), finality-gating (pending is retryable),
  lazy extending-renewal expiry, and the disclosed treasury recipient.
- **Constitution alignment (v1.3.0):**
  - **Principle I / N1–N5 (non-custodial, NON-NEGOTIABLE):** FR-002, FR-017, FR-018, FR-019,
    SC-005, SC-007 and US4 guarantee SRK moves only via a user-signed transfer to a disclosed
    recipient (N1/N3), that no premium/subscription/expiry/price check ever touches a withdraw,
    exit, or vault redeem (N2), and that a multisig treasury gains no fund-movement authority (N5)
    — proven by a custody-untouched test.
  - **Principle III (provable, not promised):** FR-005, FR-020, FR-022 gate every grant on a real
    on-chain receipt (never a client claim), show the real balance/price + disclosed treasury, and
    honest-degrade to "unavailable" rather than fabricating; FR-003 forbids presenting a dollar
    figure as anything but an illustrative peg (there is no SRK USD oracle).
  - **Principle IV (bounded blast radius):** FR-006 (buyer-binding), FR-007 (finality gate),
    FR-011 (anti-replay uniqueness) close the three exploits (claim another's payment, replay a
    hash, reorg a shallow tx); the SRK contract carries unit + fuzz tests before any mainnet use.
  - **Principle V (SRK non-essential):** FR-018 and the Assumptions bind the vault to function
    fully without SRK or premium and forbid SRK/premium from gating any core capability — this is
    the authorized "later increment that flips the 008 engine on," on a test network only.
  - **Principle II (AI proposes; policy + user disposes):** the payment is user-initiated and
    user-signed; granting premium changes only which advisory allowances apply and never moves
    funds or touches the deterministic policy + user-sign path.
- Deferred to plan.md / research.md (the HOW): the SRK contract + deploy script, the address-book
  fields, the verify endpoint + keyless verifier, the payments/subscriptions tables + migration
  number (working — confirm it is still free at apply time (011 already merged its 0016)), the expiry-aware tier-resolve
  change, and the pay-surface + confirm-gate wiring.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. (None.)
