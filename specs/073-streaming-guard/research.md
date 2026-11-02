# Research 073 — why text the guard rejects was visible, and what it costs to fix

## Root cause

The 059/063 stream loop in `agents/sparky.py` / `agents/literacy.py` held the opening until
`STREAM_HOLD_CHARS = 40` characters of accumulated text, ran `prefix_is_usable` once on that
window, then forwarded **every later model chunk unchecked** (`chunk.delta[:room]`). All
whole-answer checks ran only after the terminal `LlmResult` arrived:

1. refusal / empty,
2. `guard_text.is_unusable` (action-shaped then meta-shaped),
3. comparative servability/decline (065/066/067),
4. `_clamp`.

So the safety contract was “the final block replaces whatever was painted”. That works for a
*rewrite* (clamp, retry) but not for a *rejection*: the 2026-10-30 beta turn streamed ~500
characters, `looks_meta_shaped` then matched the complete answer (`"reference notes"` narration),
and the code fallback replaced it — but the rejected prose had already been on screen. The first
40 characters were clean (`"Morpho and Aave…"`), which is why the opening window passed.

A second gap was cross-segment matching: even if each chunk had been checked, a guard phrase can
span two chunks/segments. Checking only the candidate segment would miss it; the fix must check the
cumulative text.

Comparative turns made this worse: `_is_comparative_servable` requires every named subject to be
mentioned and rejects whole-answer refusals, which is unknowable until the answer is complete. The
incident path is exactly that turn shape.

## Chosen design

`StreamGuard` is a pure state machine (no I/O, no clock) shared by both prose agents:

- **Segments, not characters.** Release at `. ! ?` followed by whitespace/end (excluding decimals
  and `e.g.`/`i.e.`/`vs.`-style abbreviations) or at a newline.
- **Forced release is bounded and tailed.** With no boundary in 280 chars, release through the
  last whitespace but keep 64 trailing characters. Since 64 ≥ the longest guard phrase, a complete
  phrase cannot start in released text and end in unreleased text.
- **Cumulative checks.** Every feed checks `released + buffer` with the same predicates the
  terminal answer uses, so a phrase completed by the current delta trips before anything from that
  delta is painted.
- **Clamp alignment.** The next release is capped by `_clamp`'s prefix length; `finish()` only
  releases the remainder that is still a prefix of the authoritative body. A final block therefore
  never shrinks below what was painted. If a pathological clamp does cut earlier, the caller emits
  a retract before the final block.
- **Early abort + retract.** A trip stops consumption, `aclose()`s the model iterator in a
  `finally`, returns the same `meta`/`action` fallback, and emits one empty-delta/new-`streamId`
  retract if anything was already painted.
- **Comparative = hold all.** `HOLD_COMPARATIVE_PROSE = True` is the one policy constant; no new
  env flag. This removes the unguarded comparative window entirely.

## Time-to-first-delta (offline benchmark)

`scripts/stream_guard_bench.py` drives the REAL `Sparky.stream_reply` with a fake model that emits
4-character tokens every 25 ms. The OLD column reconstructs the 059/063 40-char hold (its constant
was removed in 073) over the same stream, so the comparison is like-for-like. No network.

```
tokens: 4 chars every 25 ms

scenario                             old TTFT  old total     new TTFT  new total
--------------------------------------------------------------------------------
3 sentences (~450 chars)                0.25s      1.97s        0.51s      1.99s
1 sentence (~85 chars)                  0.25s      0.58s        0.58s      0.58s
long first sentence (~320 chars)        0.25s      2.13s        1.79s      2.14s
comparative (held whole)                0.25s      1.97s  none (held)      1.99s
```

Reading the table:

- Normal prose pays **one sentence** of latency: 0.51 s vs 0.25 s for a 79-character opening
  sentence. The old hold painted partial, unchecked prose; that is the trade this spec makes.
- A short one-sentence answer is painted at its terminator (0.58 s), before the terminal result
  has been consumed; the old window painted 40 characters earlier but the answer still completed
  at the same time.
- A long first sentence costs the 280-char cap (1.79 s). That is the worst case, and it is the
  reason the cap exists: without a boundary the guard must not guess.
- A comparative turn paints nothing by design; its first prose is the authoritative block.

## Why not other options

- **Check every chunk, ignore segments.** Would still paint the prefix of a phrase completed by
  the next chunk, and cannot align to the clamp sentence cut.
- **Hold a fixed 60-character tail only.** A long sentence would paint unchecked text after the
  window; a phrase could start before the tail.
- **Buffer the whole non-comparative answer.** Safe but defeats streaming for normal prose;
  the sentence gate keeps TTFT to one sentence.
- **New SSE event / client change.** Unnecessary: a fresh `streamId` already resets the reducer,
  and `_event_stream` forwards `ProseDelta` regardless of delta length.
