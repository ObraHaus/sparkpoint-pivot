# 059 — Plan (A2 streaming + A3 single-call)

## Files

### Agent

- `llm/client.py`
  - `StreamChunk` (`delta` XOR `result`), `GatewayStreamPiece`.
  - `OpenAICompatTransport.stream(...)` — `POST /chat/completions` with `stream=true` and
    `stream_options.include_usage`; parses `data:` frames, tolerates malformed keep-alives,
    maps HTTP/network errors to `GatewayError` without leaking the key.
  - `AsyncClaudeClient.stream_complete(...)`: pre-delta retry under the global limiter, then a
    one-shot fallback to `complete`; post-delta errors propagate. Terminal `LlmResult` is built
    from the concatenated text, finish reason and streamed usage.
- `agents/sparky.py` — `SparkyChunk` + `stream_reply(...)`: streams up to `MAX_CHARS`, then applies
  the SAME `is_unusable` / refusal / `_clamp` logic; never raises (fell_back on error).
- `agents/literacy.py` — `TipChunk` + `stream_tip(...)`: mirrors `tip()` including the one retry,
  tagging deltas with the attempt.
- `coordinator/chat_blocks.py` — `ProseDelta` (a transport-only value, NOT a `ChatBlock`).
- `coordinator/dag.py`
  - `streaming` / `single_call` flags (default OFF for direct construction; production wiring ON).
  - `_stream_general_answer`, `_stream_tip` helpers; `OTHER`/`LEARN` branches emit deltas then the
    final block. Non-streaming path unchanged.
  - `_PORTFOLIO_FAST_RE`, `_LEARN_FAST_RE`, `_GREETING_FAST_RE`, `_topic_slug`,
    `_fast_readonly_intent`; consulted after all deterministic routes and forced intents.
- `api/chat.py` — `_EVENT_TEXT_DELTA = "text-delta"`; `ProseDelta` frames emitted between blocks,
  skipped by count/persistence/summary; `Cache-Control: no-cache, no-transform`; production
  wiring reads `SPARKY_STREAMING` / `SPARKY_SINGLE_CALL` (default ON).
- `config.py` — `env_flag`, the two env names added to `ALLOWED_ENV_KEYS`.

### Web

- `lib/agent/client.ts` — `ChatTextDelta`, `ChatStreamFrame`; `stream()`/`streamChat()` yield
  deltas for `event: text-delta`, blocks as JSON strings. `parseTextDelta` fail-closed.
- `lib/agent/useAgent.ts` — onboarding ignores non-string frames.
- `lib/chat/streamText.ts` + `.test.ts` — pure reducer (append/reset/clear).
- `app/(app)/chat/page.tsx` — live turn gains `deltaText/deltaTarget/deltaStreamId`; applies the
  reducer, clears on final block/error/done, passes paint to `LiveBlocks`.
- `components/screens/chat/live-blocks.tsx` — renders provisional prose with
  `data-streaming="true"` (and `data-stream-target`), hides the waiting row while painting, removes
  it when the final block lands.

### Tests / docs / release

- `tests/llm/test_client_streaming.py`
- `tests/coordinator/test_streaming_and_single_call.py`
- `tests/api/test_chat_streaming.py`
- `apps/web/e2e/pw/chat-streaming.spec.ts` (mocked agent; session cookie signed locally)
- `specs/059-chat-streaming/*`, `CHANGELOG.md`, `services/agent/content_seed/whats-new.json`

## Flag matrix

| Flag | Default | Effect of `0`/`false`/`off` |
|---|---|---|
| `SPARKY_STREAMING` | ON | Deltas are never emitted; agents use `complete()`; exact pre-059 wire. |
| `SPARKY_SINGLE_CALL` | ON | Planner always runs; exact pre-059 call counts. |

Direct `CoordinatorDag(...)` construction defaults both to `False` so existing unit tests keep the
whole-block path; `api.chat.get_coordinator_dag` supplies the production values.

## Rollout / rollback

- Both flags are read per DAG construction (per request dependency), so a restart with either set
  to `0` restores the old behaviour without a code revert.
- No DB migration, no model alias/config change, no billing change.

## Verification

Agent (matching `agent.yml`): `ruff check .`, `mypy src/sparkpoint_agent`, full `pytest -q` with
`SPARKPOINT_VAULT_ABI_PATH` set.
Web (matching `web.yml`): `tsc --noEmit`, `typecheck:test`, `node --test`, `eslint`; plus the new
Playwright spec with a local production build and a mocked agent.
