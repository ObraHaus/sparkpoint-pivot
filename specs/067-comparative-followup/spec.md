# Spec 067 — a “which is safer” comparison must serve the real grounded answer

**Status:** implemented · **Owner:** build · **Branch:** `fix/067-comparative-followup`
**Base:** `origin/main` `1e48e20` (PR #330, spec 066) · **Sources:**
`specs/066-comparative-grounding/research.md`, beta SSE capture `chat-sse2.json` 2026-10-29
(13:54/13:55Z), OH Defender review notes on #330/#331.

## Problem

066 grounded both sides of *“Is Morpho safer than Aave? Compare them for a cautious user.”* —
the beta fallback says *“SparkPoint has verified material on both”* — but the turn still ends in
the code-authored `_COMPARATIVE_FALLBACK`, uncited. The model's answer is replaced because 066
treats a **declining opening** (“I can't say which is safer…”) as a non-answer: the classifier
requires ≥220 characters plus one of 12 literal markers, and the citation gate rejects any
decline opening outright. A concise 2–4 sentence comparison therefore cannot be both served and
cited. The same review found five narrower defects (coverage from whole-message hits, deictic
citations, curly apostrophes, grammar words in the subject fallback, and the blunt classifier).

## Requirements

- **R1 — Serve a substantive comparison.** A “which is safer” comparative turn with grounded
  material on both sides must produce a real grounded comparison. Declining to **rank** is fine;
  the answer must then compare the passages' risk factors. A partial/declining-opening answer
  that goes on to compare substantively must be **served, not replaced**, and must carry a
  citation when it names every covered subject. A pure decline/deflection may still be replaced
  by the honest code fallback. The META/action guard is **not** weakened.
- **R2 — Outcome observability.** Every comparative prose outcome that is replaced or uncited
  (and, for completeness, served) emits one address-free, content-free INFO line:
  `comparative_outcome subjects=%d covered=%d reason=%s cited=%s`, with `reason` in
  `{served, guard_meta, guard_action, refused, empty, non_answer, decline, upstream}`. Never log
  the user message, model text, wallet or citation endpoint.
- **R3 — OH Defender notes.**
  - (a) Coverage also counts whole-message hits that genuinely name a subject, so the coverage
    hint/fallback never falsely says “no verified material”.
  - (b) Deictic comparative turns (“compare them”) with no extracted subjects still allow
    citations for a genuinely grounded answer (065 behaviour).
  - (c) The new guard verb patterns accept curly apostrophes (`doesn’t`, `don’t`, `didn’t`).
  - (d) The proper-noun fallback drops all-caps grammar words (`AND/OR/NOT/VS`) and question
    words (`Does/Should/Would/Can/Has/When/Which/What/Is/Are/How`).
  - (e) `_is_comparative_non_answer` classifies by substance, not length plus literal markers,
    with tests in both directions.
- **R4 — Tests.** Offline regression tests for streaming on and off that fail on 066 and pass on
  067; guard/classifier/extractor unit tests; an outcome-log test that proves no content leaks.
- **R5 — Preserve 063/065/066.** Action-verb comparative turns still reach the planner; non-
  comparative prose keeps the 029 decline/citation rule; the streaming hold, retry policy,
  `UPSTREAM_UNAVAILABLE`, retrieval and corpus are unchanged.
- **R6 — Release notes.** `CHANGELOG.md` top entry and the newest-first
  `services/agent/content_seed/whats-new.json` entry, dated 2026-10-29.

## Non-goals

- No model/gateway/billing/quota change; no `SPARKY_STREAMING` or Coolify env change.
- No deployment, merge, on-chain action, database migration or beta knowledge re-ingest.
- No weakening of the META/action guard for genuine scaffolding or action shapes.
- No live LLM call in unit tests; all regression tests use fakes.

## Acceptance

1. Replaying the beta prompts offline (streaming on/off): a declining-opening substantive
   comparison is served and cited; a pure decline is still replaced and uncited.
2. Whole-message-only grounding covers both subjects; a deictic turn cites a grounded answer.
3. Curly-apostrophe scaffolding is caught; the grammar-word extractor returns no fake subjects.
4. `comparative_outcome` appears with the correct reason/cited flags and contains no message or
   model text.
5. `uv run python -m pytest -q`, `ruff check`, `mypy` pass (the pre-existing
   `test_vault_reader` forge-artifact failures are reported, not fixed).
6. `CHANGELOG.md` + `content_seed/whats-new.json` top entries dated 2026-10-29.
