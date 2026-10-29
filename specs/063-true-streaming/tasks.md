# Tasks — 063 true streaming + comparative answers

## A — true streaming

- [x] **T6301** Instrument each layer; confirm `OpenAICompatTransport.stream` /
  `stream_complete` forward frames, the opening hold is the short-answer blocker, and the
  LiteLLM guard proxy buffers `stream=true`.
- [x] **T6302** `services/litellm/guard.py`: stream-detection, `send(stream=True)`,
  `StreamingResponse` relay with `aiter_raw`/`finally aclose`, buffered JSON path unchanged.
- [x] **T6303** `agents/sparky.py` + `agents/literacy.py`: paint the opening as soon as the first
  usable chunk exists; keep final guard/clamp/refusal/retry and `streamId` semantics.
- [x] **T6304** Remove the unused 40-char hold constant and document the new bounded opening.
- [x] **T6305** Regression test: real uvicorn `/chat` + middleware, 5 deltas 150 ms apart,
  first `text-delta` < 40 % of total; tip and deterministic price paths too.
- [x] **T6306** Guard-proxy streaming test (chunk-by-chunk relay; JSON stays buffered) + a real
  localhost SSE transport timing test.
- [x] **T6307** Local end-to-end measurements for general / tip / price; record in
  `measurements.md`.

## B — comparative questions

- [x] **T6308** `guidance.is_comparative_question` for `X vs Y`, `safer/riskier than`,
  `compare`, `which is safer`.
- [x] **T6309** `dag.run_chat`: comparative skips guidance/curated/planner and runs the OTHER
  branch; explicit commands keep the planner; deictic retrieval + recent conversation.
- [x] **T6310** Sparky `comparative` rule + fenced history (prose-only).
- [x] **T6311** Tests: both named prompts, variants, history, command guard, predicate table.
- [x] **T6312** Update old guidance/eval expectations for the comparative route.

## Release / verification

- [x] **T6313** Web e2e: partial paint before the final block; full answer lands later.
- [x] **T6314** `CHANGELOG.md` [Unreleased] + `content_seed/whats-new.json` (newest first).
- [x] **T6315** Agent ruff / mypy / full pytest / offline golden; web tests if toolchain present.
- [x] **T6316** Spec artifacts + measurements.
- [x] **T6317** Commit, push, PRs to develop and main (or develop-resolved counterpart).
