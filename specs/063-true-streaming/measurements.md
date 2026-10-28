# 063 — Measurements (local, mock-only)

No real paid model calls were made. Every number below comes from a local OpenAI-compatible SSE
server / fake transport. The end-to-end harness is
`services/agent/tests/api/test_chat_streaming_progressive.py`: a **real uvicorn** server on a
free localhost port, the real `/chat` route + `RequestContextMiddleware`, and a fake model that
emits **5 deltas 150 ms apart** (≈0.75 s generation). Timestamps are measured at the HTTP client
(`httpx` SSE lines): first `event: text-delta` vs the terminal `event: done`.

## A — Agent layer (5 deltas, 200 ms apart)

| Layer | First delta | Last / done | First ÷ total |
|---|---:|---:|---:|
| `Sparky.stream_reply` BEFORE 063 (40-char opening hold; answer < 40 chars) | 1.002 s | 1.002 s | **100 %** |
| `Sparky.stream_reply` AFTER 063 (paint the first usable chunk) | 0.200 s | 1.002 s | **20 %** |
| `OpenAICompatTransport.stream` (already correct) | 0.089 s | 1.092 s | 8 % |

The first row is the short-answer/slow-first-token failure: `pending_len < 40` never released,
so the whole answer was painted from the terminal path.

## B — Gateway guard proxy (`services/litellm/guard.py`, 5 chunks, 100 ms apart)

| Guard behaviour | First relayed chunk | Last chunk | First ÷ total |
|---|---:|---:|---:|
| BEFORE 063 — `httpx.request(...)` + `Response(content=upstream.content)` | 0.501 s | 0.501 s | **100 %** |
| AFTER 063 — `send(stream=True)` + `StreamingResponse(aiter_raw)` | 0.100 s | 0.501 s | **20 %** |

This is the production root cause: the agent was streaming correctly *into* the guard, but the
guard accumulated the entire `stream=true` completion before forwarding it. Tool-step events are
produced by the agent itself, which is why they still arrived on time while model text did not.

## C — End-to-end `/chat` SSE after the fix (five deltas, 150 ms apart)

| Prompt | Route | First `text-delta` | First content block | `done` | First delta ÷ done |
|---|---|---:|---:|---:|---:|
| “How does Aave lending work?” | general → Sparky | **188.8 ms** | 792.8 ms | 792.9 ms | **23.8 %** |
| “What is APY?” | tip → Literacy | **171.8 ms** | 775.9 ms | 775.9 ms | **22.1 %** |
| “What is the price of ETH today?” | price / deterministic fast path | — (no deltas by design) | **19.7 ms** | 20.0 ms | content at **98.5 %** of a 20 ms turn |

The deterministic price path answers in code, so it emits a complete `text` block and no
`text-delta`; both the first content and `done` are ~20 ms. The final authoritative `text` / `tip`
block still arrives after the paint and reconciles with it (asserted in the test).

Reproduce (from `services/agent`, with `SPARKPOINT_VAULT_ABI_PATH` set as in CI):

```bash
.venv/bin/pytest -q tests/api/test_chat_streaming_progressive.py
.venv/bin/pytest -q tests/api/test_gateway_guard_streaming.py
```

## D — Comparative questions

Mocked routing tests (`tests/coordinator/test_comparative_questions.py`) pin the behavioural fix:

| Prompt | Before 063 | After 063 |
|---|---|---|
| “Is Morpho safer than Aave?” | planner-dependent (tip/generic) | **Sparky + grounding, 0 planner calls** |
| “Compare that with just keeping it in Aave.” | yield composer (“nothing for a mandate to apply to”) | **Sparky + grounding + recent conversation** |
| “Morpho vs Aave — which is safer?” | planner-dependent | **Sparky + grounding** |
| “Which is safer, Morpho or Aave?” | curated/planner could steal it | **Sparky + grounding** |
| “Compare Aave and Morpho, then deposit 500 USDC…” | planner/action | **unchanged (planner runs; action preserved)** |
