# Quickstart 073 — verify the streaming guard locally

No network, no real model, no beta.

## Agent

```bash
cd services/agent
export PATH=$HOME/.local/bin:$PATH
uv run pytest -q tests/agents/test_stream_guard.py \
  tests/agents/test_sparky.py tests/agents/test_literacy.py \
  tests/api/test_chat_streaming_guard.py \
  tests/api/test_chat_streaming_progressive.py \
  tests/coordinator/test_streaming_and_single_call.py \
  tests/coordinator/test_comparative_questions.py
uv run ruff check src tests scripts
uv run mypy src
```

## TTFT benchmark (offline)

```bash
cd services/agent
uv run python scripts/stream_guard_bench.py
```

Prints old 40-char-hold vs new sentence-gated time-to-first-delta and total, including a held
comparative turn. The numbers in `research.md` were produced by this script.

## What to look at

- `agents/stream_guard.py` — the release rules and `HOLD_COMPARATIVE_PROSE`.
- `agents/sparky.py::stream_reply` / `agents/literacy.py::stream_tip` — abort + retract.
- `coordinator/dag.py::_stream_general_answer` — `general-<attempt>-r` retract framing.
- `apps/web/src/lib/chat/streamText.ts` — a new `streamId` resets the paint (the retract).

## Why beta was streaming `0`

The guard could not stop already-painted text. With this change, guarded prose is never released,
a trip aborts the model stream, and anything already painted is retracted before the terminal
block. Re-enabling beta is an operator decision; see the handoff recommendation in the final task
message.
