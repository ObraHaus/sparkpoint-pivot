# Specification Quality Checklist: Strategies & a mandate that mean something

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-03
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

Two validation passes were run.

**Pass 1 findings, all corrected in the spec:**

1. *Implementation detail leaked into the requirements.* FR-001 originally named the specific
   resolution map that drops the second strategy, and several FRs named file paths from the review.
   The defect analysis belongs in the plan, not the spec — the requirements now state the user-facing
   obligation ("MUST present every strategy that is permitted and available") and leave the mechanism
   to planning.
2. *Two success criteria were not user-verifiable.* An earlier SC-001 asserted "the Aave pool target
   resolves", which cannot be checked without reading code. It now asserts what a user sees.
3. *An edge case was missing.* Two strategies with identical displayed figures still need an
   explainable ranking; added.
4. *The scope boundary around curation needed to be explicit,* not implied. The constitution forbids
   the product selecting or curating markets, and surfacing a second *already-permitted* strategy is
   easy to misread as doing so. Both the Assumptions and Out of Scope sections now state the
   distinction directly.

**Pass 2**: all items pass.

**Deliberate judgement calls, recorded rather than raised as clarifications:**

- The exposure limit constrains what may be *proposed*, not a new on-chain cap. Making it an on-chain
  limit would change the safety model, which is explicitly out of scope; the spec says so.
- Contribution rhythm is stated as an intent with an explicit prohibition on implying automation
  (FR-013), because the client decision named "auto-top-up intent" and the product deliberately holds
  no standing authority. This is the highest-risk phrase in the feature for user misunderstanding, so
  it is a requirement rather than an assumption.
- Legacy plans are treated as "not stated" rather than defaulted to zero (FR-021, Assumptions). A
  zero exposure limit would silently forbid every proposal for existing users.
