# 059 — Tasks

## A2 — streaming end to end

- [x] T1 `llm/client.py`: gateway SSE `stream()`, `stream_complete()` with pre-delta retry +
      whole-message failover, post-delta propagation, usage/stop-reason preserved.
- [x] T2 `agents/sparky.py`: `stream_reply` (guard/clamp/fallback on the full text).
- [x] T3 `agents/literacy.py`: `stream_tip` (one retry, attempt-tagged deltas, default fallback).
- [x] T4 `coordinator/chat_blocks.py`: transport-only `ProseDelta`; not a ChatBlock.
- [x] T5 `coordinator/dag.py`: `streaming` flag; `OTHER`/`LEARN` stream deltas then the final
      block; retry uses a new `stream_id`.
- [x] T6 `api/chat.py`: `event: text-delta` framing, excluded from count/persistence/summary;
      headers; production flag wiring.
- [x] T7 `config.py`: `env_flag` + allowlisted env names.
- [x] T8 BFF review: existing passthrough headers already correct (`no-transform`, identity, no
      buffering) — documented, no change.
- [x] T9 Web client: parse `text-delta`; typed `ChatStreamFrame`; onboarding unaffected.
- [x] T10 Web UI: reducer, reset on retry, clear on final/error/done, provisional renderer with
      `data-streaming`.

## A3 — fewer serial LLM calls

- [x] T11 Narrow portfolio / concept / greeting pre-classifier, consulted AFTER every 057 route
      and only when there is no forced intent.
- [x] T12 Behind `SPARKY_SINGLE_CALL` (default ON in production wiring, OFF for direct DAG tests).
- [x] T13 Call-count tests: portfolio 0, concept 1, greeting 1; 057 routes still 0 / unchanged.
- [ ] T14 Classification cache for repeated identical messages — deliberately NOT implemented:
      the DAG has no conversation identity, and the deterministic fast route already removes the
      planner for the repeat-heavy read-only shapes. Revisit if beta traces show repeated prose
      questions in one thread. (Documented in research.md.)

## Tests

- [x] T15 `tests/llm/test_client_streaming.py` — SSE parse, fallback, mid-stream propagation.
- [x] T16 `tests/coordinator/test_streaming_and_single_call.py` — deltas + final reconciliation,
      guardrail retry reset, mid-stream retry/failure, flag off path, call counts.
- [x] T17 `tests/api/test_chat_streaming.py` — text-delta framing, not counted/persisted, refund
      once + ErrorBlock on mid-stream failure, no partial persistence.
- [x] T18 `apps/web/src/lib/chat/streamText.test.ts` — append/reset/clear reducer.
- [x] T19 `apps/web/e2e/pw/chat-streaming.spec.ts` — mocked SSE; first token < 2.5 s; final
      reconciliation; no beta calls.

## Release / docs

- [x] T20 `CHANGELOG.md` [Unreleased] (agent + web + flags).
- [x] T21 In-app `whats-new.json` entry; `tests/test_whats_new_seed.py`.
- [x] T22 `specs/059-chat-streaming/{research,spec,plan,tasks}.md` with measured before/after.

## Verification gate

- [x] T23 Agent: ruff / mypy / full pytest (with `SPARKPOINT_VAULT_ABI_PATH`) — 1843 passed.
- [x] T24 Web: lint / tsc / typecheck:test / unit tests (782 passed) + production build.
- [x] T25 Playwright mocked chat streaming spec — passed against `mock-agent-sse.mjs` (first token < 2.5 s, final reconciled).
- [ ] T26 Commit + push `feat/059-chat-streaming`; cherry-pick to develop counterpart; push.
