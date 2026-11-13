# Research — 065 comparative questions fail with `UPSTREAM_UNAVAILABLE`

**Status:** root cause confirmed · **Branch:** `fix/065-comparative-upstream` · **Base:** `origin/main` `0d60caf`
**Symptom:** on beta, `"Is Morpho safer than Aave? Compare them for a cautious user."` fails every
time with `SPARKY_STREAMING` on or off: 3–4 `tool_step` blocks, then
`ErrorBlock("UPSTREAM_UNAVAILABLE", _GENERAL_FAILURE)` (~18 s streaming, ~45 s non-streaming).
Plain prompts (identity / knowledge) answer normally.

## Evidence

### 1. The failing turn (beta, captured before any code change)

Audit runner `~/sparkpoint-audit/run/chat-sse2.mjs` → `chat-sse2.json`, record
`startedAt 2026-10-29T12:14:37.965Z`:

| field | value |
|---|---|
| status | `200` (SSE) |
| ttfb | 735 ms (tool-steps arrive promptly) |
| first `text-delta` | 17 728 ms |
| terminal `error` | 18 076 ms |
| block types | `tool_step`, `text-delta`, `error`, `done` |
| error | `UPSTREAM_UNAVAILABLE: I couldn't reach my model just then…` |

The **painted deltas** were (verbatim, curly apostrophe):

> I don’t have details on Morpho or Aave safety in my reference notes, so I can’t compare their
> risk profiles or fee structures directly. I can look at your connected wallet and show the
> SparkPoint options that are currently vetted and available for your risk setting.…

So the model **did answer**. It was an honest "I don't have that" deflection — and it says
*"reference notes"*, which is exactly the scaffolding phrase the shared META guard exists to stop.
The next record in the same run (a non-custody knowledge question, 12:14:19Z) returned a normal
`text` + `citation` in 15.2 s, so the gateway/model were healthy for an ordinary turn.

### 2. Logs (read-only, redacted)

- **litellm-beta** (`<coolify-uuid>`, restarted 12:06Z): the only completion lines were
  `POST /chat/completions HTTP/1.1 200 OK`; **no 429 and no 5xx**.
- **agent-beta** (`<coolify-uuid>`): `POST /chat HTTP/1.1 200 OK` only. No application
  INFO lines exist on the deployed build — the `sparkpoint_agent.*` loggers inherit the root
  `WARNING` level (this is Part C of 065), so **the absence of an app log was not evidence of
  success**. The SSE body is where the failure is visible.
- No reproduction hit a rate limit, so the "stop reproducing on 429" rule did not trigger.

### 3. Diagnostic chat call (1 of the 4 allowed)

`"What is the difference between Morpho and Aave?"` at `2026-10-29T12:23:25.943Z` → `200`,
`tip` + `citation`, 23.1 s, no error. This took the `LEARN` route (grounding has no `min_score`
floor there), which proves the Morpho/Aave material is retrievable. It is only the forced-`OTHER`
comparative route that failed.

## Code path for a comparative turn

1. `coordinator/dag.py:661` — `comparative = is_comparative_question(message) and not
   has_financial_action_verb(message)`. The reported prompt matches
   `guidance._COMPARATIVE_RE` (`safer than`) and has no action verb ⇒ **True**.
2. `coordinator/dag.py:883-886` — a comparative turn is forced to `Intent(kind=OTHER)` so the
   planner and the deterministic guidance/curated routes cannot answer it with canned copy.
3. `coordinator/dag.py:958` — grounding runs with the OTHER threshold (`_OTHER_MIN_SCORE = 0.35`).
4. `coordinator/dag.py:964-1002` — the OTHER prose branch calls `Sparky.stream_reply` (streaming)
   or `_general_answer` (non-streaming), retrying **once** on any `fell_back`.
5. `agents/sparky.py:405-408` (`reply`) / `:340-343` (`stream_reply`) — the complete text is run
   through `is_unusable`. The deflection hits `agents/guard_text.py:40`
   (`re.compile(r"\breference notes?\b", re.IGNORECASE)`) ⇒ `looks_meta_shaped` ⇒ `fell_back=True`.
6. `coordinator/dag.py:496` / `:539` — after the retry, the branch returns `_GENERAL_FAILURE`.
7. `coordinator/dag.py:996-1002` — `failed` becomes
   `ErrorBlock("UPSTREAM_UNAVAILABLE", prose_answer)`. That is the block the user sees.

Streaming only changes *when* the bad opening is painted: `STREAM_HOLD_CHARS = 40`
(`agents/guard_text.py:81`) releases the prefix at 40 characters; the deflection's first 40
characters ("I don’t have details on Morpho or Aave safety in…") are usable, so the paint happens
before "reference notes" arrives. The terminal guard still rejects the whole body (authoritative
final block), which is why first-text precedes the error by only ~350 ms in the capture.

Plain prompts do not hit this because they are not forced onto the comparative/OTHER path (they
take the deterministic, `LEARN`, portfolio or fast routes), and their answers do not narrate the
model's note scaffolding.

## Why this is a code bug, not a provider outage

- The model returned a 200 / a complete streamed answer. No LiteLLM 429, 5xx or timeout appears.
- The trigger is deterministic: the phrase `reference notes` in the model's own output.
- The DAG had a **single failure bit**. `SparkyReply.fell_back` is set for an upstream exception
  *and* for a content-guard rejection, so the call site could not tell "the model was unreachable"
  from "the model answered, but we refused to show that answer". It reported the former.

## Root cause (one paragraph)

The shared META guard correctly rejected a deflection that narrated the model's own reference
notes, but the coordinator collapsed that **content rejection** into the same `_GENERAL_FAILURE`
path as a **provider exception**, emitting `UPSTREAM_UNAVAILABLE` — a false statement about model
reachability. On the comparative branch there was no honest fallback, so every such turn became a
retry and then an error. The guard itself is not the bug: an answer that says "in my reference
notes" is precisely the scaffolding leak it is meant to block.

## Fix shape

- `agents/guard_text.py` — `unusable_reason()` names the rejection (`empty`/`action`/`meta`);
  `is_unusable()` remains the boolean façade. No pattern is weakened.
- `agents/sparky.py` — `SparkyReply.failure` carries `upstream` vs `meta`/`action`/`refused`/
  `empty` (excluded from dataclass equality so existing contracts hold). A prompt line also tells
  the model not to mention notes/background/context at all.
- `coordinator/dag.py` — only `failure == "upstream"` becomes `UPSTREAM_UNAVAILABLE`; a
  comparative content rejection yields a code-authored honest comparison (`text` block, no action,
  no figures, no advice). A deterministic `meta`/`action` rejection on the comparative branch is
  not retried (the second identical call was pure latency).
- The 063/059 opening guard and the 063 action-verb routing are untouched.
