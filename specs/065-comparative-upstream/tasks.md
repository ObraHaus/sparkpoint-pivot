# Tasks — 065 comparative upstream fix

## A — root cause

- [x] **T6501** Capture the failing beta turn (`chat-sse2.json`, 12:14:37Z); read agent /
  litellm logs read-only (no 429/5xx; no app INFO on the deployed build).
- [x] **T6502** Trace the forced-OTHER comparative path to the META guard
  (`\breference notes?\b`) and the `fell_back → _GENERAL_FAILURE → UPSTREAM_UNAVAILABLE`
  collapse. Record in `research.md`.

## B — fix

- [x] **T6503** `guard_text.unusable_reason()`; keep every pattern and `is_unusable`.
- [x] **T6504** `SparkyReply.failure` on `reply` + `stream_reply`; anti-scaffolding prompt line.
- [x] **T6505** DAG `_ProseResult.failure`; only `upstream` maps to `UPSTREAM_UNAVAILABLE`.
- [x] **T6506** Comparative honest fallback (prose-only, no figures/advice) + no retry for
  comparative `meta`/`action`.
- [x] **T6507** Regression tests replaying the beta deflection, streaming on and off, plus a
  true upstream control.

## C — ops

- [x] **T6508** `logging_config.configure_logging()` called at startup; `LOG_LEVEL` default
  `INFO`; one handler; `propagate=False`; address-free admin logs.
- [x] **T6509** Logging test: `sparkpoint_agent.api.quota` INFO is emitted.
- [x] **T6510** `MIGRATIONS.md` current state → beta `0043` (2026-10-28).

## D — release

- [x] **T6511** `CHANGELOG.md` top entry + newest-first `content_seed/whats-new.json`.
- [x] **T6512** Agent pytest / ruff / mypy / seed tests; web untouched.
- [ ] **T6513** Commit, push, PR to `main`; cherry-pick to a `-065-dev` worktree, PR to
  `develop`.
