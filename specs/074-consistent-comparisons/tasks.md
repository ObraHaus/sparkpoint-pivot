# Tasks — 074 consistent comparison answers

## Investigation

- [x] Read 063 (part B), 065, 066, 067; `guidance.py`, `comparative.py`, `dag.py`,
  `curated.py`, `sparky.py`, `llm/client.py`, LiteLLM config, knowledge seed, evals.
- [x] Enumerate and rank every variance source in `research.md` (whole-answer prose + gate,
  sampling, prompt/clamp, gate flip-flop, routing, retrieval ties, curated figures,
  gateway `simple-shuffle`).
- [x] Add `scripts/comparative_variance_probe.py` (no network) and capture before/after output.

## Fix

- [x] `coordinator/comparison_facts.py`: reviewed, figure-free facts table for every known
  subject; curated-vault structure; pure `render_comparison`; deterministic Bottom line.
- [x] Curated-vault figures from the existing board record, with stored as-of.
- [x] `coordinator/comparative.py`: `KNOWN_SUBJECTS`, `extract_known_subjects`, message-order
  fallback tokens.
- [x] `coordinator/dag.py`: deterministic passage sort; subject resolution (message + curated
  labels + history); `_build_comparative_answer`; one final text block; keep zero-known
  `_comparative_fallback`, the complete-set citation rule and `_log_comparative_outcome`.
- [x] `agents/sparky.py`: `BOTTOM_LINE_SYSTEM` + `comparison_bottom_line` + `_clamp_to`; do not
  touch `stream_reply`.
- [x] `llm/client.py`: optional `temperature`/`seed` through `complete`, `stream_complete`,
  OpenAI-compatible payload and Anthropic temperature; defaults unchanged.
- [x] Comparative Bottom-line calls use `temperature=0.2`, `seed=7`.
- [x] Routing consistency: comparative branch before `gather`; composer path retained only for
  non-comparative turns; history resolution preserved.

## Evals and tests

- [x] `evals/consistency.py`: 9 prompts × 5 repeats, noisy seeded fake, checks route, skeleton,
  subject order, citations, Bottom line presence, meta/action text, English; all four
  `SPARKY_STREAMING × SPARKY_SINGLE_CALL` combos.
- [x] Live consistency mode (opt-in, ≤3 repeats × 4 prompts, 429/5xx = infra, skips cleanly).
- [x] `evals/run.py --suite consistency`.
- [x] `tests/evals/test_consistency_offline.py` in CI.
- [x] `tests/coordinator/test_comparison_facts.py`: facts coverage, tie ordering, byte-identical
  rendering, curated figures, temperature plumbing, Bottom-line fallbacks.
- [x] Update 063/065/066/067 comparative expectations (intent kept: no planner, action, tip,
  yield copy or meta; honest missing subjects; complete citations).

## Verification

- [x] `uv run pytest -q` — 2452 passed; 12 pre-existing `test_vault_reader` failures.
- [x] Golden offline: 72/72.
- [x] Consistency offline: 9/9 cases, 100% structural agreement.
- [x] `uv run ruff check src tests/coordinator scripts evals`.
- [x] `uv run ruff format --check` on touched files.
- [x] `uv run mypy src`.
- [x] Variance probe before/after pasted in `research.md`.

## Docs and release

- [x] `specs/074-consistent-comparisons/{spec,plan,research,tasks,quickstart}.md`.
- [ ] `CHANGELOG.md` [Unreleased] 074 entry.
- [ ] `services/agent/content_seed/whats-new.json` 074 entry.
- [ ] Commit, gitleaks, rebase if needed, push once, open one PR (do not merge).
