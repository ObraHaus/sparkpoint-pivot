# Specification Quality Checklist: Limits & Priority Compute (free & premium tiers)

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
  table names, endpoints, framework names, migration numbers, or the specific enforcement seam;
  those are deferred to plan.md.
- The five pivotal design decisions were pre-resolved with the operator and recorded in the
  `## Clarifications` (Session 2026-07-21) section, so no `[NEEDS CLARIFICATION]` markers remain:
  admin-grant entitlement, dual-layer enforcement, single-replica alpha, gateway-hardening in
  scope, and the rolling-24h / PH quota window (a documented, tunable default).
- **Constitution alignment (v1.3.0):**
  - **Principle I / N2 (withdraw-always, NON-NEGOTIABLE):** FR-013, FR-014, SC-003, and the
    "Custody path" edge case guarantee no limit/throttle/ceiling ever touches a withdrawal,
    exit, or vault redeem — those stay available even when the assistant is fully throttled.
  - **Principle V (SRK non-essential):** FR-005, FR-028, and the Assumptions bind premium to an
    operator grant for launch and forbid SRK/premium from gating any core capability.
  - **Principle II (AI proposes; policy + user disposes):** limits meter/refuse *advisory
    compute* only; they do not touch the deterministic policy layer or the user-signing path.
  - **Principle IV (bounded blast radius):** US5 / FR-023–FR-025 add a system-level inference
    ceiling + network isolation + TLS — directly reducing the shared-inference blast radius.
- Deferred to plan.md (the HOW): the enforcement seam, the data model (new tables + migration),
  the admin config/monitoring surfaces, the priority mechanism, and the gateway-hardening
  mechanics (ingress isolation, TLS, credential ceiling).
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. (None.)
