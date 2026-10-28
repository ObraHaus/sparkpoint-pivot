# Spec 063 — True token streaming + comparative-question answers

**Status:** implemented · **Owner:** build · **Branch:** `fix/063-true-streaming`
**Sources:** beta chat traces — `SPARKY_STREAMING=1` emitted `text-delta` events, but the first
`text-delta` arrived at the same time as `done` (tool-step events arrived on time); and two
comparative prompts returned the empty-wallet guidance copy (“nothing for a mandate to apply
to”) instead of an answer.

## A — True streaming

### Problem

With streaming on, the agent frames `event: text-delta` records, but the browser paints nothing
until the model call completes: `first-text ≈ done`. The web BFF passes SSE through (tool-step
events prove it), so the delay is between the agent process and the model gateway.

### Root causes (measured, see `measurements.md`)

1. **The deployed gateway guard proxy buffered every completion.** The request path is
   `agent → Traefik → guard(:4000) → LiteLLM(:4001)`. `services/litellm/guard.py` proxied every
   method with `httpx.request(...)` and rebuilt the reply from `upstream.content`, so an SSE
   `stream=true` completion was fully accumulated in the guard before a single byte reached the
   agent. The agent then received the whole answer as one burst: its deltas were emitted
   together, right before the final block. (Tool-step events are emitted by the agent itself,
   not the model, which is why those stayed timely.)
2. **The opening hold released only at 40 characters.** `Sparky.stream_reply` /
   `Literacy.stream_tip` buffered the opening until `STREAM_HOLD_CHARS = 40`; a short answer, or a
   slow first token, therefore painted nothing until the terminal result. That is a second,
   independent “held until the end” path once the guard is fixed.
3. **No regression test measured time.** The 059 tests asserted delta order/content, not that a
   delta reaches the HTTP client while the model is still generating.

### Requirements

- **R1 — Gateway guard relays SSE.** A `POST /chat/completions` whose JSON body has
  `"stream": true` is proxied with `send(stream=True)` and returned as `StreamingResponse`;
  chunks are relayed with `aiter_raw()` as they arrive and the upstream connection is closed in
  a `finally`. Non-streaming JSON keeps the simple buffered path. No hop-by-hop / content-length
  header is forwarded.
- **R2 — Bounded opening hold.** The prose agents check the opening as soon as the first chunk
  exists and paint it if `prefix_is_usable`; no character-count wait. The terminal reply remains
  authoritative: `is_unusable`, refusal, `MAX_CHARS` clamp, one retry and the static fallback all
  run on the COMPLETE text, and the final `text`/`tip` block replaces whatever was painted.
  A retry keeps a new `streamId` (`general-<attempt>` / `tip-<attempt>`); an attempt whose FIRST
  chunk is already action/meta-shaped is not painted.
- **R3 — No buffering wrappers.** `AsyncClaudeClient.stream_complete` and
  `OpenAICompatTransport.stream` already yield per SSE frame; the DAG and `_event_stream` yield
  each delta immediately. R1 is the only missing relay.
- **R4 — Tests.** A real uvicorn / real `/chat` + middleware test with a fake model that yields
  5 deltas 150 ms apart asserts the first `text-delta` is < 40 % of the turn. A guard-proxy test
  with a slow upstream asserts chunk-by-chunk relay. A direct layer repro records first-delta
  timestamps.

### Non-goals

- No model/provider/config or billing change; no real paid calls are required for the tests.
- No change to persistence, quota/refund semantics, the policy gate, `/build-tx`, or signing.
- Deltas remain transport-only (never counted, persisted or summarized).

## B — Comparative questions

### Problem

`"Is Morpho safer than Aave?"` and (after an Aave/USDC discussion) `"Compare that with just
keeping it in Aave"` did not get a comparison. The second matches
`guidance._COMPARE_AAVE_RE`, so the empty-wallet composer answered it and prepended
“You don't have a position yet, so there's nothing for a mandate to apply to.” The first went to
the planner and could land on a tip/generic branch. Both should be grounded knowledge answers.

### Requirements

- **R5 — Comparative detection.** A narrow predicate recognises comparison shapes: `X vs Y`,
  `X versus Y`, `compare/comparison`, `safer/riskier than`, `more/less safe|risky than`,
  `better/worse than`, and `which is safer|better|riskier`.
- **R6 — Route to grounded Sparky.** A comparative turn that is not an explicit financial command
  skips the planner, the yield/mandate composer and the curated-board route, and runs the OTHER
  prose branch: real retrieval + Sparky + citations. It can never emit an action/recommendation.
  A comparative that also commands an action (`"compare them, then deposit 500 USDC"`) keeps the
  normal planner path so the action half is never dropped.
- **R7 — Actually compare.** The comparative prompt receives the retrieved protocol passages and
  a code-authored COMPARISON rule (risk, yield mechanics, fees/structure; no invented figures, no
  advice, no winner, no transaction). A deictic follow-up (`"compare that with…"`) also receives
  the recent conversation (fenced as untrusted data) and retrieval is run over those turns too, so
  “that” resolves.
- **R8 — Tests.** Both named prompts plus variants route to Sparky with grounding, zero planner
  calls, no tips/actions and no yield/mandate copy; an explicit command comparative still reaches
  the planner; existing guidance/eval routing expectations are updated where they encoded the old
  canned route.

## Acceptance

- Agent `ruff check .`, strict `mypy`, full `pytest -q` green.
- Web e2e chat-streaming spec asserts a PARTIAL paint appears before the final `text` block and
  that the full answer lands later (mocked SSE only; never beta).
- `CHANGELOG.md` [Unreleased] and `services/agent/content_seed/whats-new.json` updated.
