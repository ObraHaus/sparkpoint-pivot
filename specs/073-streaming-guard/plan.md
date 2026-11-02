# Plan 073 — sentence-gated streaming guard

## Changes

| File | Change |
|---|---|
| `services/agent/src/sparkpoint_agent/agents/stream_guard.py` | NEW pure incremental `StreamGuard`: segment boundaries, 280-char cap + 64-char lookbehind, cumulative action/meta checks, clamp-aligned release, sticky trip reason, `HOLD_COMPARATIVE_PROSE`. |
| `services/agent/src/sparkpoint_agent/agents/sparky.py` | Replace the 40-char hold with `StreamGuard`; abort the model iterator on a trip (`aclose` in `finally`); retract when painted; hold comparative prose whole; clamp-aligned `finish`. `SparkyChunk.retract`. |
| `services/agent/src/sparkpoint_agent/agents/literacy.py` | Same guard on the tip path; aborted attempt emits a retract and retries under a new `attempt`; terminal card unchanged. `TipChunk.retract`. |
| `services/agent/src/sparkpoint_agent/agents/guard_text.py` | Remove the now-unused 40-char constant/prefix helper; keep the predicates as the single source of truth. |
| `services/agent/src/sparkpoint_agent/coordinator/dag.py` | Frame a retract as `ProseDelta(target, delta="", stream_id=f"…-r")`. Retry/serve/fallback logic untouched. |
| `apps/web/src/lib/chat/streamText.ts` | Document the retract semantics (implementation already correct: new stream id resets). |
| `apps/web/src/lib/chat/streamText.test.ts` | Pin the empty-delta/new-stream-id retract and a clean retry after it. |
| `services/agent/tests/agents/test_stream_guard.py` | NEW unit suite: boundaries, cap+tail, cross-segment, action, sticky trip, clamp. |
| `services/agent/tests/agents/test_sparky.py` | Streaming guard tests: mid-stream/at-start meta + action, early abort, retract only when painted, clean paint, comparative hold. Updated the old 40-char expectation. |
| `services/agent/tests/agents/test_literacy.py` | NEW tip streaming tests: clean, meta mid-stream retry, action at start, retract, both attempts guarded. |
| `services/agent/tests/api/test_chat_streaming_guard.py` | NEW real uvicorn + `/chat` + SSE e2e: every guard example across general/tip, comparative no deltas + fallback, clean paint/reconcile. |
| `services/agent/tests/coordinator/test_streaming_and_single_call.py`, `test_comparative_questions.py` | Update expectations that encoded the 40-char hold / comparative deltas. |
| `services/agent/tests/api/test_chat_streaming_progressive.py` | Keep the “paint before done” intent; sentence gating is one sentence, not 40 characters. |
| `services/agent/scripts/stream_guard_bench.py` | NEW offline TTFT benchmark (old hold vs sentence gating, incl. comparative). |
| `specs/073-streaming-guard/*`, `CHANGELOG.md`, `content_seed/whats-new.json`, `docs/architecture-as-built.md` | Design, measurements, release notes, wire documentation. |

## Safety

- No model/gateway/billing/LiteLLM change; no new dependency; no env/flag default change.
- Deltas stay transport-only: never counted in `blockCount`, never persisted, never summarized.
- A trip produces exactly the failure reason the non-streaming path would (`meta`/`action`), so
  065/066/067 retry and comparative-fallback behaviour is unchanged.
- The terminal `text`/`tip` block is still authoritative and still runs `is_unusable`, refusal,
  `_clamp` and the serve gate.

## Verification

- `uv run ruff check src tests scripts`; `uv run ruff format --check <touched>`;
  `uv run mypy src`.
- `uv run pytest -q` (full agent suite) and the golden offline suite in all four
  `SPARKY_STREAMING × SPARKY_SINGLE_CALL` modes.
- Web: `node --test src/**/*.test.ts` (streamText), `pnpm --filter web lint`,
  `pnpm --filter web typecheck:test`; mocked Playwright chat-streaming spec if available.
- Benchmark table reproduced with `uv run python scripts/stream_guard_bench.py` (no network).
