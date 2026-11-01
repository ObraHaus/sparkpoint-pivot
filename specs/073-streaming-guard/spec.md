# Spec 073 — Sentence-gated streaming guard (guarded text never reaches the client)

**Status:** implemented · **Owner:** build · **Branch:** `feat/073-streaming-guard`
**Sources:** beta incident 2026-10-30 00:31 PHT (`SPARKY_STREAMING=1`; beta is now `0`). With
streaming on, `"Morpho vs Aave"` painted ~500 characters of model text, then the terminal
`guard_meta` rejected the COMPLETE answer and the code fallback replaced it. The user saw text the
guard had already rejected. The 059/063 opening hold checked only the first 40 characters; every
character after that streamed unchecked, and all whole-answer checks (`is_unusable`, refusal,
comparative servability/decline, `_clamp`) ran only at the end.

## Problem

The stream contract is “the terminal block is authoritative and replaces the paint”. That is safe
against *rewrites*, and catastrophic against *rejections*: replacing a rejected answer with a
fallback does not un-show it. Guarded content must never be painted in the first place.

## Requirements

- **R1 — Incremental shared guard.** A pure `agents/stream_guard.py` (`StreamGuard`) is used by
  BOTH `Sparky.stream_reply` and `Literacy.stream_tip`, replacing the 40-char hold.
  - Buffer deltas; release only COMPLETE SEGMENTS. A segment ends at a sentence terminator
    (`. ! ?` followed by whitespace/end, excluding decimals like `4.45` and the common
    `e.g.`/`i.e.`/`vs.` abbreviations) or a newline.
  - If no boundary appears within `SEGMENT_CAP_CHARS` (280), release up to the last whitespace but
    keep a lookbehind tail of `LOOKBEHIND_CHARS` (64, at least the longest guard phrase) so a
    multi-word guard phrase can never straddle released/unreleased text.
  - Before a release, check the CUMULATIVE text (already released + candidate) with the SAME
    `looks_action_shaped` / `looks_meta_shaped` predicates the terminal block uses. Cross-segment
    matches (`"…based on the reference"` + `" notes…"`) trip on the feed that completes them.
  - Keep the forwarded total within `Sparky.MAX_CHARS` and align it to `_clamp`'s sentence cut, so
    a served final block never shrinks below the paint. `finish()` releases only the part that is
    still a prefix of the authoritative body.
  - On a trip: set a sticky reason (`action`/`meta`, action first), release nothing more, close the
    model iterator in a `finally`, and return the SAME `fell_back` failure the non-streaming path
    would. The 065/066/067 fallback/retry logic is unchanged.
  - **Retraction:** if anything had already been painted for that attempt, emit ONE retract so the
    client clears the partial immediately. Implemented on the existing wire as a `text-delta` with
    `delta: ""` and a fresh `streamId` (`general-<attempt>-r` / `tip-<attempt>-r`). The web reducer
    already treats a new `streamId` as a new attempt (buffer replaced), so no new event type and no
    client logic change are needed. Pinned by `streamText.test.ts`.
- **R2 — Comparative turns hold the whole answer.** Acceptance uses WHOLE-answer checks
  (`_is_comparative_servable`: every subject named; not a whole-answer refusal; `_is_decline`) that
  cannot be known mid-stream, and the incident was exactly this path. Policy constant
  `HOLD_COMPARATIVE_PROSE = True` in `stream_guard.py`: no prose delta for `comparative=True`; the
  terminal text block is the first prose served. Tool-step progress still streams. This is NOT an
  env flag.
- **R3 — Everything else unchanged.** Terminal `is_unusable`/refusal/`_clamp`, 065 failure reasons,
  067 serve gate, citation rules, quota/persistence (deltas are transport-only), and the
  `SPARKY_STREAMING` default/deploy env.
- **R4 — Latency budget.** Reasonable time-to-first-token: first paint after the first complete
  sentence in normal prose; the 280-char cap bounds a long first sentence. Measured below.

## Wire behaviour

`event: text-delta` `data: {target, delta, streamId}` (unchanged shape):

- deltas paint provisional prose; the final `text`/`tip` block remains authoritative;
- a NEW `streamId` resets the provisional buffer (retry, and now also retract);
- `delta: ""` + a fresh `streamId` is a **retract**: clear the partial now. It is forwarded by
  `api/chat.py::_event_stream` because `ProseDelta` is framed regardless of `delta` length.

## Acceptance

- Guarded text never appears in any `text-delta` for general, tip, and comparative turns, under
  fake models only (no network), including every `_META_SHAPED` / `_ACTION_SHAPED` example.
- A clean answer paints before `done` and reconciles with the final block.
- Agent `ruff check`, strict `mypy`, full `pytest -q` green (pre-existing environment failures
  listed separately), golden evals green in all four `SPARKY_STREAMING × SPARKY_SINGLE_CALL` modes.
- Web `streamText` unit test, lint, and typecheck green.
- TTFT table in `research.md`; `CHANGELOG.md` and `content_seed/whats-new.json` updated.
