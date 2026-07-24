# Specification Quality Checklist: US5 — Per-Advice Attribution

**Purpose**: Validate specification completeness and quality before planning
**Created**: 2026-07-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)  *(the linkage substrate is described in user terms; tables/endpoints deferred to plan.md)*
- [x] Focused on user value and business needs  *(the credibility loop — "did the advice pay off?")*
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain  *(honesty scope, intent-log-only attribution, persist-on-act resolved in Assumptions)*
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified  *(unreconcilable history, pending, declined/rejected, blended, legacy, outage)*
- [x] Scope is clearly bounded  *(vault path, intent-log attribution only; heuristic + swaps/direct-Aave deferred)*
- [x] Dependencies and assumptions identified  *(019 spine, 017/018 replay, wallet identity)*

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows  *(view outcome, capture+link, honest attribution, stay-current)*
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The load-bearing risk is **honesty under blended positions** (US3 / FR-007 / SC-005): average-cost
  pooling means a single withdrawal's realized PnL cannot always cleanly split across the recommendations
  that funded the position. The spec resolves this by (a) attributing per-recommendation via the deposit
  lot the recommendation caused, and (b) honestly labeling a share of a shared position rather than
  fabricating an exact split — never a fake clean number (Principle III).
- Attribution is **intent-log (explicit acted-on link) only** for the MVP; the heuristic-match path and
  non-vault actions are explicitly deferred. All items pass — ready for `/speckit-plan`.
