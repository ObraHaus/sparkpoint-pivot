# Spec 065 — comparative questions must not fail as an upstream outage

**Status:** implemented · **Owner:** build · **Branch:** `fix/065-comparative-upstream`
**Sources:** beta SSE capture `chat-sse2.json` 2026-10-29T12:14:37Z; agent/litellm logs;
`specs/063-true-streaming/`; `specs/061-ux-quick-fixes/`.

## Problem

A comparative question (`"Is Morpho safer than Aave? Compare them for a cautious user."`) is
forced onto the grounded Sparky prose branch (063). On beta the model answered with an honest
deflection that mentioned its own *reference notes*. The shared META guard rejected the text
(correctly), but the coordinator treated **any** `fell_back` as a provider failure and emitted
`UPSTREAM_UNAVAILABLE` after one retry. The user was told the model was unreachable although it
had just replied. Streaming only painted the rejected opening first.

## Requirements

- **R1 — Distinguish content rejection from upstream failure.** A prose turn that the model
  produced but the action/meta guard rejected must never surface as `UPSTREAM_UNAVAILABLE`.
  Only an LLM/provider exception (after the existing retry) may become that error block.
- **R2 — Comparative questions always answer.** A comparative turn whose answer was
  content-rejected returns a `text` block with a code-authored, honest comparison: risk
  dimensions, curator/liquidity, how yield and fees are produced, no invented figures, no
  allocation advice, no action/recommendation, no internal prompt/notes vocabulary. When the two
  named subjects are Morpho and Aave they are named.
- **R3 — Do not weaken the guard.** `is_unusable` / `looks_action_shaped` / `looks_meta_shaped`
  keep their exact patterns. A genuine leak (`reference notes`, `The user asks…`, `"type":`, raw
  calldata) is still discarded; an ordinary comparison is still served.
- **R4 — Keep the opening guard.** `STREAM_HOLD_CHARS`, `prefix_is_usable`, the authoritative
  final block and the streaming `streamId` reset remain unchanged.
- **R5 — Do not retry a deterministic content rejection on the comparative branch.** `meta` /
  `action` rejections skip the second identical prose call; upstream/refused/empty keep the
  existing one-retry behaviour. This removes the ~45 s double-call the beta user paid.
- **R6 — Keep action-verb turns on the planner.** `has_financial_action_verb` still wins over
  `is_comparative_question`; nothing is moved off the action path.
- **R7 — Verify offline, both flags.** Fake LLM/knowledge tests replay the beta deflection with
  streaming on and off (no error, honest text, one call) and assert a true provider exception
  still yields `UPSTREAM_UNAVAILABLE`.

## Non-goals

- No model, gateway, alias, billing, quota or `SPARKY_STREAMING` change.
- No new retrieval/re-ingest, no migration, no on-chain or Coolify change.
- No change to the 063 comparison prompt besides one anti-scaffolding sentence.

## Companion ops items (same branch)

- **C1 — agent INFO logging.** Configure `sparkpoint_agent.*` at startup (`LOG_LEVEL`, default
  `INFO`), one handler, no propagation to uvicorn/root, address-free. Test that
  `sparkpoint_agent.api.quota` INFO records are emitted.
- **C2 — MIGRATIONS.md.** Current state: beta is at `0043` (`0043_chat_feedback`, applied
  2026-10-28).
- **C3 — changelogs.** Top `CHANGELOG.md` entry and a newest-first
  `content_seed/whats-new.json` entry, both dated 2026-10-29.
