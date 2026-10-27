# 059 — Chat streaming + fewer serial LLM calls

**Product rule:** Sparky is English-only.

## Problem

On beta, deterministic chat routes show first content in ~0.3 s, but any LLM prose answer shows
nothing for 6–47 s because the whole block is generated before the first SSE frame. A concept
question or a simple "hi" also pays for two serial LLM calls (planner, then prose), and a
portfolio read pays for a planner call even though the answer is deterministic.

## Goals

- A2 — the final prose responder streams. The browser paints text as it arrives; the final block
  still arrives complete and reconciles with what was painted.
- A3 — obvious read-only turns avoid the second (or only) LLM call: portfolio 0 calls, concept and
  greeting 1 call, without changing any 057 deterministic route.
- Preserve compatibility, persistence, refunds and guardrails exactly.

## Non-goals

- No new signable artifact, no change to the policy gate, no model/config/billing change.
- No change to `/recommendations`, `/build-tx`, execution, or the withdraw/exit path.
- No streaming of recommendation/action cards (only prose deltas).

## Requirements

### R1 — LLM streaming (behind `SPARKY_STREAMING`, default ON)

- `AsyncClaudeClient.stream_complete(...)` yields text deltas and then a terminal `LlmResult` whose
  text equals the concatenation, with stop reason and usage.
- The gateway transport opens `stream=true` (`stream_options.include_usage=true`). A transport
  without streaming, or a pre-first-token stream failure, falls back to the existing whole-message
  call (ONE delta = the full text), so a gateway without SSE still answers.
- A failure AFTER the first delta is never retried at the client layer (that would duplicate text);
  the agent retries its own turn and then falls back honestly.

### R2 — SSE `text-delta` events (additive)

- Event name: `text-delta`; data `{target: "text"|"tip", delta, streamId}`.
- The final `event: block` (`text` / `tip`) is unchanged and still follows.
- Deltas are not counted in `blockCount`, not persisted, not summarized, never a ChatBlock.
- Clients that ignore `text-delta` see exactly the pre-059 stream.

### R3 — Authoritative final block

- All post-processing runs on the complete text: refusal check, `is_unusable`, clamp, retry,
  fallback.
- The opening (~40 chars) is held until it passes the same action/meta guard as the full text, so
  an attempt that is already unusable in its opening is never painted. A body that only becomes
  unusable after the hold may have been painted; the authoritative final block then replaces it.
- A guardrail rewrite/discard, clamp, retry or fallback must cause the final block to REPLACE the
  streamed paint. A new attempt has a new `streamId`; the renderer resets on a new id, and on a
  missing/empty id (it cannot be proven to belong to the current attempt).
- If the turn fails, an `ERROR` block replaces the paint; no partial answer is persisted.

### R4 — Failure/refund semantics (056)

- Mid-stream error: exactly one refund, one inert `UPSTREAM_UNAVAILABLE` error block, terminal
  `done`; no partial answer recorded as a success; a client disconnect is not refunded.
- A stream that succeeds then degrades internally behaves like today (single refund when no answer
  block preceded the error).

### R5 — Single-call fast route (behind `SPARKY_SINGLE_CALL`, default ON)

- Widen the deterministic pre-classifier only for ALLOWLISTED, fully anchored read-only shapes.
  Each candidate is normalised first (case, punctuation, whitespace, polite filler such as
  "please", "can you", "hey sparky") and must then match a complete shape — no extra clause:
  - portfolio snapshots ("what's in my wallet", "show (me) my portfolio/holdings/balance(s)",
    "what do I hold/own/have", "my portfolio", "portfolio", "balance", "how much USDC/ETH/… do I
    have") → PORTFOLIO, 0 calls;
  - concept asks ("what is/what's/what are …", "explain …", "define …", "how does X work") with a
    short topic noun phrase and no extra clause → LEARN, 1 prose call;
  - greeting/identity ("hi", "who are you", …) → OTHER, 1 prose call.
- Anything else goes to the planner: advice ("should I", "how should I", "what happens if",
  "can I", "why"), hypotheticals, extra clauses, conjunctions ("and", "then", "also", "but"), any
  action verb or any number. Consulted only after every 057 route and only when no forced intent
  exists. The blocking guard is a fail-closed SECOND layer: the full command vocabulary and its
  inflections (including fund, lose/lost, contribute, recover, fix, help me, should), **any**
  standalone number/percentage (`100`, `1k`, `2.5m`, `5%`) and written-out amounts ("five hundred",
  "half", "all of my") block the shortcut unless the number is clearly a known token/standard/time
  window (`ERC-4626`, `ERC20`, `L2`, `24h`, `7d APY`, `30-day`). Blocking only means the normal
  planner call runs.
- With prior conversation turns, anaphora/deictic references ("it", "that", "this", "they", "them",
  "those", "these", "the above", "same", "one", "there", "what about") and very short follow-ups
  skip the shortcut; a pronoun/stopword can never become the LEARN topic (fall back to the planner).
- Deterministic 057 routes (guidance, unsafe refusal, unsupported swap, proposals) are unchanged.

### R6 — UI

- Reducer: append same-stream deltas; reset on a new, missing or empty `streamId`, or a target
  switch; clear on the final block, on error, and on turn completion.
- Renderer: provisional text uses the answer typography and `data-streaming="true"`; the final card
  replaces it; the waiting spinner is suppressed once prose is painting. The provisional container
  is `aria-live="off"` + `aria-busy="true"`; only the final block is a polite live region, so a
  screen reader announces the answer once instead of per chunk and again on replacement.

### R7 — Tests

- Agent: SSE `text-delta` framing; deltas not persisted/counted; mid-stream failure refunds once
  and emits an ErrorBlock; guardrail replacement; single-call call counts per intent; 057 routes
  unchanged; LLM stream parsing/failover.
- Web: pure delta reducer unit tests.
- Playwright: mock the agent SSE, assert first token < 2.5 s and final reconciliation. Never hit
  beta.

## Acceptance

- Flags default ON; `SPARKY_STREAMING=0` / `SPARKY_SINGLE_CALL=0` restore the pre-059 path.
- Agent ruff/mypy/pytest green; web lint/typecheck/unit green; mocked chat e2e passes when a test
  server + session secret are available.
- `CHANGELOG.md` [Unreleased] and the in-app changelog seed both describe the change.
