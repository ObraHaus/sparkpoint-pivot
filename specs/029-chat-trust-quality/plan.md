# Implementation Plan: Pre-Alpha Chat Trust & Answer Quality

**Branch**: `feature/029-chat-trust-quality` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

## Summary

Close the Aug-3 regression findings with the smallest change that makes each failure impossible rather than unlikely: a finite/supported guard on the client's network identity plus an error state that can't be mistaken for prose; a retry-then-honest-error fallback on the general branch; four answer-shape fixes routed through the existing intent taxonomy; an advice boundary; the meta/slug leak closed on the literacy path (it was only closed on the general path in the 028 hotfix); three new knowledge documents so the assistant stops denying shipped features; and four transcript-hygiene fixes. No migration, no new endpoint, no policy-path change.

## Technical Context

**Language/Version**: Python 3.12 (services/agent, strict mypy) · TypeScript/React (apps/web)

**Primary Dependencies**: existing only — no new packages.

**Storage**: none added. Knowledge documents are markdown files ingested by the existing loader at boot (`knowledge_seed/`, re-ingestable via `POST /admin/knowledge/reingest`).

**Testing**: pytest + ruff + `mypy src/sparkpoint_agent` (CI scope); web `node:test` + `typecheck:test` + `tsc` + eslint. End verification = the unchanged Aug-3 browser battery + knowledge quiz.

**Target Platform**: alpha (Coolify develop). Deploy = agent + web; the new knowledge files ship inside the agent image and ingest on boot.

**Performance Goals**: the retry adds at most one model round-trip to a failing turn; no added latency on the success path.

**Constraints**: fail-open everywhere; prose/classifier-only knowledge boundary; policy gate, signability and `/build-tx` untouched (SC-008 pins the verdict); no jsonb writes added (SQL_ASCII rule therefore not triggered, but any that appear must use `ensure_ascii=False`).

**Scale/Scope**: alpha traffic; ~10 focused edits across agent + web + 3 content files.

## Constitution Check

*Gate against v3.0.0 — PASS (pre-research, re-checked post-design).*

- **I. Non-custodial (N1–N5)**: nothing here touches custody, signing, or the exit path. The automation answer (FR-007) makes the non-custody model MORE explicit to users. PASS.
- **II. AI proposes, policy disposes**: no change to `policy.evaluate`, to what is signable, or to `/build-tx`. The advice boundary REMOVES cards from a turn (strictly less surface). Recommendation rationales get a consistency check against the deterministic risk stamp — presentation only, the stamp itself is authoritative and unchanged. PASS.
- **III. Provable, not promised**: the whole feature is honesty work — real fee/APY figures or an explicit "unavailable"; an error state that admits failure instead of faking an answer; knowledge documents that describe what the product actually does. PASS.
- **IV. Bounded blast radius**: one retry (not a loop), bounded knowledge documents, fail-open on every new path, once-per-process warnings. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/029-chat-trust-quality/
├── spec.md · plan.md · research.md · quickstart.md · tasks.md
└── checklists/requirements.md
```

*(No `contracts/`: no new or changed endpoint, no wire-shape change.)*

### Source Code

```text
apps/web/src/
├── lib/agent/useAgent.ts            # FR-001 finite+supported chain guard
├── lib/agent/chatError.ts           # NEW — pure: is this an internal envelope? user-facing copy
├── components/screens/chat/live-blocks.tsx   # FR-002 error state ≠ prose; FR-012 collapse steps
└── app/(app)/chat/page.tsx          # FR-013 restore last conversation on refresh

services/agent/src/sparkpoint_agent/
├── agents/planner.py                # FR-005/006/007/008 intent hints (fees/apy/automation/advice)
├── agents/literacy.py               # FR-010 meta-discard + no topic slug in the wire
├── agents/sparky.py                 # shares the meta guard (extracted)
├── agents/guard_text.py             # NEW — the shared meta/slug guard (pure, testable)
├── agents/recommender.py            # FR-009 rationale ↔ risk-stamp consistency
├── coordinator/dag.py               # FR-003 retry+honest error; FR-004/005/006/007/008 routing
└── api/chat.py                      # FR-004 wallet answer: native + token balances

services/agent/knowledge_seed/       # FR-011 (content, ingested at boot)
├── sparky-capabilities.md           # what Sparky can/can't do, memory, non-custody, automation
├── srk-and-premium.md               # SRK, the faucet, premium price + what it changes
└── platform-surfaces.md             # Trust Center / Outcome Log / Fees / Learn / Changelog
```

## Phase 0 → [research.md](./research.md)

Key resolutions: the wallet answer needs `native_balance` + a token read the chat provider does not currently make (the reader already exposes both); the advice boundary belongs in the DAG *before* propose (so no cards can be produced), not in the recommender; the meta guard must be shared by both prose agents rather than duplicated; conversation restore uses the existing conversation list rather than new persistence.

## Phase 1 → [quickstart.md](./quickstart.md)

The verification guide: unit/CI gates, then the unchanged 20-prompt battery + knowledge quiz with the SC-001…SC-008 pass criteria, then the deploy note (agent + web; knowledge re-ingest on boot).
