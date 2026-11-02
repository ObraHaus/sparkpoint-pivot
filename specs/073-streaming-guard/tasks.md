# Tasks 073 — sentence-gated streaming guard

- [x] T1 `agents/stream_guard.py`: pure incremental `StreamGuard` (segment boundaries, 280-char
  cap + 64-char lookbehind, cumulative action/meta checks, clamp-aligned release, sticky trip).
- [x] T2 `agents/sparky.py`: replace the 40-char hold; abort + `aclose` on trip; one retract when
  painted; hold comparative prose whole; clamp-aligned `finish`.
- [x] T3 `agents/literacy.py`: same guard on the tip path, with the existing retry semantics and a
  retract per painted-then-tripped attempt.
- [x] T4 `agents/guard_text.py`: remove the dead 40-char hold constant/helper.
- [x] T5 `coordinator/dag.py`: frame retracts as empty `ProseDelta` under a fresh stream id; keep
  retry/serve/fallback logic untouched.
- [x] T6 `api/chat.py`: verified empty-delta `ProseDelta` is forwarded unchanged (no code change).
- [x] T7 Web `streamText.ts` doc + `streamText.test.ts` retract test.
- [x] T8 Guard unit tests (`tests/agents/test_stream_guard.py`).
- [x] T9 Sparky + Literacy streaming tests (mid-stream/at-start, early abort, retract, clean,
  comparative hold).
- [x] T10 Real `/chat` SSE e2e (`tests/api/test_chat_streaming_guard.py`) for general/tip/
  comparative/clean, iterating every guard example.
- [x] T11 Update 059/063 tests that encoded the 40-char hold / comparative deltas.
- [x] T12 `scripts/stream_guard_bench.py` + TTFT table in `research.md`.
- [x] T13 `CHANGELOG.md`, `content_seed/whats-new.json`, `docs/architecture-as-built.md`.
- [x] T14 ruff check/format, mypy, full pytest, golden four-mode evals, web lint/typecheck/unit,
  mocked e2e; commit (no push).
