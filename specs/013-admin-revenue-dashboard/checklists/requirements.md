# Specification Quality Checklist: Admin Revenue Dashboard (real data)

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
  table names, endpoints, framework names, migration numbers, or the specific indexer seam;
  those are deferred to plan.md (which names `0017_swap_fee_events.sql`, `api/admin_revenue.py`,
  `data/swap_fee_indexer.py`, and the `charts.tsx` reuse).
- The seven pivotal design decisions were pre-resolved with the operator and recorded in the
  `## Clarifications` (Session 2026-07-21) section, so no `[NEEDS CLARIFICATION]` markers remain:
  provable-only display, the `Transfer(from = router, to = recipient)` swap-fee capture, reuse
  of the existing perf aggregator, membership from feature 012's `payments`, per-stream removal
  of the "Sample data" pill, shared-treasury disambiguation, and live-read-only multisig balances.
- **Constitution alignment (v1.3.0):**
  - **Principle III (Provable, Not Promised) — the star principle:** FR-001–FR-005, FR-009,
    FR-021 and SC-001, SC-002, SC-005 make every figure ledger- or live-read-derived, honest-degrade
    per stream to `configured:false`, distinguish a real `$0` from an un-configured stream, disclose
    the native-ETH-out under-count, and forbid any projection — mirroring the 008 FR-022/SC-004 pattern.
  - **Principle I / N1–N5 (NON-NEGOTIABLE):** FR-020 and the Constitution Check guarantee the feature
    is read-only instrumentation that adds no fund-movement path and never gates a deposit/withdraw/
    redeem/exit; the multisig card (FR-018/FR-019) *displays* the Safe's actual (nil) custody power,
    proving N5 rather than weakening it.
  - **Principle IV (bounded blast radius):** FR-016 (admin 404-posture, server-verified owner) and
    FR-006–FR-008 (idempotent + finality-bounded indexing) mean a reorg or re-run cannot corrupt the
    ledger and the surface stays invisible to non-admins.
  - **Principle V (SRK non-essential):** the membership *revenue* is merely reported, gating nothing;
    the stream honest-degrades when feature 012 is absent, so nothing here binds a core capability to SRK.
  - **Principle VII (Simplicity/YAGNI):** the recorded scope note keeps logs-only swap capture with a
    disclosed native-ETH-out gap (no `debug_traceTransaction` dependency) and live balance reads (no
    snapshot table); one new table, one cursor row, one endpoint; networks stay 8453 / 84532 / 46630.
- **Cross-feature reads (recorded):** the membership stream reads feature 012's `payments` and the
  multisig card reads feature 014's Safe address; 013 owns neither and honest-degrades when either is
  absent, so it ships independently to `develop`. The migration `0017_swap_fee_events.sql` **number is
  provisional — reconcile with the parallel 010/011 work before applying; use the next free sequential
  number.**
- Deferred to plan.md (the HOW): the swap-fee indexer + `0017` ledger + cursor, the aggregation
  endpoint, the perf/membership wiring, the rebuilt page's fetch/state, and the live-read balances card.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. (None.)
