# Plan 063 — True token streaming + comparative answers

## Root-cause evidence

Instrumented the layers in order (timestamps per delta): `OpenAICompatTransport.stream` and
`AsyncClaudeClient.stream_complete` forward every SSE frame immediately; `Sparky.stream_reply`
painted nothing for a 5-chunk short answer because of the 40-char hold; and the deployed
LiteLLM guard proxy (`services/litellm/guard.py`) buffered the whole upstream completion. The
guard is the primary cause; the hold is the second “held to the end” path. See
`measurements.md` for the before/after table.

## Changes

| File | Change |
|---|---|
| `services/litellm/guard.py` | Detect `"stream": true`; `client.send(..., stream=True)` + `StreamingResponse(_relay(...))`; `aiter_raw`, `finally aclose`; buffered path stays for JSON. |
| `services/agent/src/sparkpoint_agent/agents/sparky.py` | Opening paints on the first usable chunk; `comparative` + `history` support (COMPARATIVE_RULE, fenced RECENT_CONVERSATION). |
| `services/agent/src/sparkpoint_agent/agents/literacy.py` | Opening paints on the first usable chunk (same guard/final-card semantics). |
| `services/agent/src/sparkpoint_agent/agents/guard_text.py` | Document the bounded-opening change; drop the unused 40-char constant. |
| `services/agent/src/sparkpoint_agent/coordinator/guidance.py` | `is_comparative_question` + export. |
| `services/agent/src/sparkpoint_agent/coordinator/dag.py` | Comparative detection; skip guidance/curated; force OTHER (unless explicit command); deictic-aware grounding query; pass history/comparative to Sparky; prose-history plumbing. |
| `services/agent/tests/api/test_chat_streaming_progressive.py` | Real uvicorn + real `/chat`/middleware; first text-delta < 40 % of total (general + tip); deterministic price path checked separately. |
| `services/agent/tests/api/test_gateway_guard_streaming.py` | Guard relays an SSE upstream chunk-by-chunk; JSON path stays buffered. |
| `services/agent/tests/llm/test_client_streaming_timing.py` | Real localhost SSE server → `OpenAICompatTransport`/`stream_complete`; frames arrive spread out. |
| `services/agent/tests/coordinator/test_comparative_questions.py` | Predicate table + routing/grounding/history/command tests. |
| `services/agent/tests/coordinator/test_streaming_and_single_call.py` | The first usable chunk now paints; retry still resets with a new `streamId`. |
| `services/agent/tests/coordinator/test_chat_dead_ends.py` | The old Aave-comparison guidance assertion becomes a Sparky-routing assertion. |
| `services/agent/tests/coordinator/test_price_route.py`, `services/agent/evals/golden.yaml` | Comparative prompts now expect the general route. |
| `apps/web/e2e/pw/chat-streaming.spec.ts` | Assert a PARTIAL paint before the final block and `done` after the first paint. |
| `specs/063-true-streaming/*`, `CHANGELOG.md`, `services/agent/content_seed/whats-new.json` | Design/measurements/release notes. |

## Safety

- Streaming is prose-only: deltas are a transport event, never a ChatBlock, never persisted. The
  final guarded block is authoritative; a comparison is a `text` block with no action/policy.
- Comparative routing is knowledge-only and cannot reach propose/build/policy; an explicit
  command comparative keeps the existing planner/action path.
- The guard change only affects transport; LiteLLM auth, budgets and the 404 UI blocklist are
  unchanged.

## Verification

- `services/agent`: `ruff check .`, `mypy src/sparkpoint_agent`, `pytest -q` with
  `SPARKPOINT_VAULT_ABI_PATH`; offline golden suite.
- Web: lint/tsc/typecheck:test/unit (CI) and the mocked Playwright chat-streaming spec.
- Local measurement: mock OpenAI-compatible SSE server + real `/chat` + middleware; no paid calls.
