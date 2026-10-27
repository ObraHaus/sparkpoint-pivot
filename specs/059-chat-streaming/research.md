# 059 — Chat latency research (A2 streaming + A3 serial-call reduction)

Branch: `feat/059-chat-streaming` (from `origin/main` @ `7857526`, which contains 057).
Scope: `services/agent` (LLM client, agents, coordinator, SSE) + `apps/web` (client, chat renderer, BFF docs).

## 1. Where the time goes today

A `/chat` turn is a deterministic Python DAG (`coordinator/dag.py`). The model is consulted only
for NL understanding and prose; the policy gate is LLM-free.

Per-intent serial LLM calls BEFORE 059 (measured with the fake LLM, 250 ms/call model):

| Intent (route) | Serial calls | Who | First-content model |
|---|---|---|---|
| Portfolio ("show my portfolio") | 1 | planner | ~0.3 s, then deterministic snapshot |
| Concept / knowledge ("what is APY?") | 2 | planner → literacy | full tip at ~2×call |
| General / identity ("hi") | 2 | planner → Sparky | full prose at ~2×call |
| Live APY / fees / what's new | 0 | deterministic 029/031 routes | ~0.3 s |
| Guidance / refusal / unsupported swap / proposal | 0–2 | 057 deterministic guards, then planner(+recommender) | unchanged |

Real beta p50 observed by the operator: deterministic routes return first content in ~0.3 s;
LLM prose routes take **6–47 s to first content** because the whole block lands at once (the UI
has nothing to paint until `Sparky.reply` / `Literacy.tip` returns). That is the user-visible
problem: a single static "Working…" row, then the entire answer.

### Measured AFTER 059 (same fake LLM, `SPARKY_STREAMING=1`, `SPARKY_SINGLE_CALL=1`)

| Message | Before calls / wall | After calls / wall |
|---|---|---|
| "show my portfolio" | 1 / 251 ms | **0 / 0 ms** |
| "what is APY?" | 2 / 501 ms | **1 / 251 ms** |
| "hi" | 2 / 501 ms | **1 / 251 ms** |
| "what's new?" | 0 / 0 ms | 0 / 0 ms |

Streaming first-content, with a fake stream (200 ms per chunk + 1 s tail to a 2 s answer):
**first = 200 ms, full = 2003 ms**. On the real free gateway this moves first content from
"when the whole answer is done" to "the first streamed token", which is the A2 win.

## 2. LLM boundary (`services/agent/src/sparkpoint_agent/llm/client.py`)

- DEFAULT production path is the OpenAI-compatible LiteLLM gateway (`OpenAICompatTransport`).
  `create()` posts `/chat/completions`; there was no streaming support.
- The Anthropic transport is a fallback when the gateway env is absent; it stays non-streaming.
- Existing resilience (`call_with_resilience`) retries 429/502/503/504/529 with jitter and a
  global limiter. It wraps a whole-message call, so a retry can never duplicate SSE text.
- `normalize_message` is refusal-first and drops thinking blocks. Usage is read from the reply.

**Design consequence:** streaming must be an ADDITIVE method that still returns a complete
`LlmResult`, so the agents can run the same refusal/guard/clamp logic on the final text.

## 3. SSE wire (`services/agent/src/sparkpoint_agent/api/chat.py`)

- `streamChat` = `event: block` records (`json.dumps` one-line data) + one terminal `event: done`
  with `{conversationId, blockCount}`.
- `TextBlock` is `{"type":"text","markdown": ...}`; `TipBlock` is `{"type":"tip", ...}`. The web
  validates every block with a strict zod union (`cards.ts`), so an unknown block type would
  render inert. A new SSE **event name** (not a new block type) is therefore the compatible move.
- Persistence (`sink.record`) and `blockCount` only see ChatBlocks; `tool_step` and `error` are
  already excluded/handled specially. Deltas must not enter either path.
- Refund semantics (054/056): a mid-stream raise or an emitted `UPSTREAM_UNAVAILABLE` error
  refunds exactly once; a client disconnect is a `BaseException` and is never refunded.

## 4. BFF (`apps/web/src/app/api/agent/[...path]/route.ts`)

Already streams SSE verbatim and sets `Content-Type: text/event-stream`, `Cache-Control:
no-cache, no-transform`, `X-Accel-Buffering: no`, and (036) `Content-Encoding: identity` — the
last one is what actually stops Next/compression from buffering the whole response. No BFF change
was needed; 059 documents it and relies on it.

## 5. UI (`apps/web/src/app/(app)/chat/page.tsx`, `components/screens/chat/live-blocks.tsx`)

- `sendLive` iterates `streamChat`, parses each block fail-closed (`parseCard`) and appends cards.
- `LiveBlocks` plans tool-step rows, collapses them when the turn ends, and renders each block's
  card. While `streaming`, `ThinkingIndicator` shows a clock.
- There is no notion of provisional prose. Adding an optional `deltaText` slot means the answer can
  paint while the stream is open; when the final `text`/`tip` block arrives the card list is
  authoritative and the provisional slot is cleared.

## 6. Safety analysis for streaming prose

The prose branches (`OTHER` → Sparky, `LEARN` → literacy) are structurally non-signable: their
output is a `text` / `tip` block with no `proposedAction` and no policy stamp. Streaming therefore
cannot create a sign path, even if a delta momentarily contains action-shaped text — it is rendered
as plain text, never as a card.

Post-processing still runs on the COMPLETE text:
- `guard_text.is_unusable` discards meta-shaped / action-shaped generations;
- `Sparky._clamp` enforces the 700-char budget at a sentence boundary;
- refusal (`stop_reason=refusal`) and empty generations fall back;
- retries (Sparky once in the coordinator, literacy once internally) can produce a DIFFERENT text.

Therefore deltas are provisional paint only. The final block:
1. is the only prose that is persisted and summarized;
2. replaces the paint in the renderer (guardrail rewrite / clamp / retry / fallback);
3. becomes an `error` block if both attempts fail — the client drops the paint and shows the error.

A retry uses a new `streamId` (`general-<attempt>` / `tip-<attempt>`), so the client RESETS rather
than appending attempt 2 to attempt 1. Deltas are capped at `MAX_CHARS` for Sparky so the paint
never exceeds the clamp; the final block may still be shorter (sentence-boundary cut), which is why
replacement is mandatory.

## 7. A3 safety analysis

The only routing change is a narrow pre-classifier consulted AFTER every 057 deterministic guard
and only when no forced intent exists. It can return PORTFOLIO, LEARN (concept) or OTHER
(greeting/identity). It refuses any message carrying an action signal — the full command vocabulary
and inflections, any standalone number/percentage or written-out amount (bar known standards/time
windows such as `ERC-4626`, `L2`, `7d APY`), pasted addresses, injection markers and NEAR/cross-chain
mentions. With conversation history it also refuses anaphora/deictic follow-ups ("how does it work?",
"what about fees?") and very short turns, and a pronoun/stopword can never be a LEARN topic. A false
negative only costs the normal planner call. It never sees an action, amount, swap, withdraw or
proposal path, and the planner still runs for every command-shaped turn. The existing deterministic
routes are byte-for-byte untouched (tests pin zero LLM calls for safety, unsupported swap,
injection/refusal and what's-new).

## 8. Test baseline

058's offline golden set is not on `main` (it lives on `feat/058-agent-evals`, a separate
worktree). 059 therefore uses `services/agent/tests/coordinator/*` plus the full agent suite as the
regression baseline, and adds streaming/single-call tests.
