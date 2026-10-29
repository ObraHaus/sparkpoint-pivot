# Tasks — 066 grounded comparative answers

## A — root cause

- [x] **T6601** Read the 065 research and the comparative DAG path; capture the three beta cases
  from `chat-sse2.json` (cases 3/4/5) and the grounded LEARN control (case 11).
- [x] **T6602** Recover what retrieval returned by fetching the beta conversation for case 3:
  the citation block under the non-answer was two changelog release notes, not protocol material.
  Record scores/provenance, timings, file:line and corpus coverage in `research.md`.
- [x] **T6603** Confirm the guard gap (`reference information`) and the ASCII-apostrophe
  `_DECLINE_RE` gap that let a non-answer carry citations.

## B — fix

- [x] **T6604** `coordinator/comparative.py`: subject extraction + passage mention helpers.
- [x] **T6605** `_ground_comparative()`: per-subject retrieval (LEARN semantics) + whole-message
  query, dedupe, subject-mention filter, cap, `covered`.
- [x] **T6606** Coverage hint + `_prose_context`; COMPARATIVE_RULE sentence about the ungrounded
  side and no scaffolding narration.
- [x] **T6607** Fallback names actual subjects/missing side; used only after a rejection or a pure
  decline.
- [x] **T6608** META guard 066 patterns (precise, tests both ways).
- [x] **T6609** Citation gate: model-produced + not decline/fallback + names every covered subject;
  curly-apostrophe decline recognition.
- [x] **T6610** `knowledge_seed/protocol-basics.md` for Aave, Compound, Morpho, Lido, Rocket Pool
  (structural, no figures).

## C — tests

- [x] **T6611** Offline regression tests replaying the three beta cases with a fake LLM + fake
  retriever, streaming on and off (fail before, pass after).
- [x] **T6612** Guard both-ways tests; protocol-seed content test.
- [x] **T6613** `uv run pytest -q` / `ruff` / `mypy`; report the forge-artifact vault_reader
  failures.

## D — release

- [x] **T6614** `CHANGELOG.md` top entry + newest-first `content_seed/whats-new.json` entry
  (2026-10-29).
- [x] **T6615** Document the knowledge re-ingest step in `research.md` / `plan.md` / PR body
  (not run against beta).
- [ ] **T6616** Commit, push, PR to `main`; cherry-pick to `~/project/sparkpoint-pivot-066-dev`
  (`origin/develop`), resolve changelog/whats-new keeping both newest-first, PR to `develop`.
