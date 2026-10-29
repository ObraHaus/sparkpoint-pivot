# Research — 067 why a grounded “which is safer” turn still ends in the code fallback

**Status:** root cause confirmed offline · **Branch:** `fix/067-comparative-followup` ·
**Base:** `origin/main` `1e48e20` (PR #330, includes 066)
**Symptom (beta, `SPARKY_STREAMING=0`):** *“Is Morpho safer than Aave? Compare them for a
cautious user.”* answers 200 in 18.4 s, text only, **no citation**, and the text is the
code-authored `_COMPARATIVE_FALLBACK` — not a comparison:

> I can't rank Morpho and Aave on safety from SparkPoint-verified data, so I won't call one safer
> than the other. SparkPoint has verified material on both, but not enough to rank one above the
> other. The useful comparison is structural: …

No agent log line says why the model answer was replaced (the 066 code logs nothing at the
replacement points). No beta chat call was made for this investigation; the evidence below is the
existing capture plus offline reproduction, and the 067 outcome log now makes the branch explicit
on the next turn.

## Evidence

### 1. The beta turn after 066 (SSE capture)

Source: `~/sparkpoint-audit/run/chat-sse2.json`, entries started 13:54:50Z and 13:55:12Z /
13:55:35Z. Times are the runner's `terminalMs`; conversation ids are omitted (no secrets).

| prompt | terminal | block types | served text |
|---|---|---|---|
| “Is Morpho safer than Aave? Compare them for a cautious user.” | 18 351 ms | `tool_step`, `text`, `done` | **`_COMPARATIVE_FALLBACK`** with gap “verified material on both” · no citation |
| “Compare Compound and Aave for a beginner.” | 20 189 ms | `tool_step`, `text`, `citation`, `done` | real comparison; “SparkPoint has no verified material for Compound…”; cites Aave |
| “Which is riskier, Lido or Rocket Pool?” | 20 435 ms | `tool_step`, `text`, `done` | real structural comparison; no citation (neither side grounded) |

Two facts pin the failure downstream of retrieval:

* The fallback's gap sentence says **“SparkPoint has verified material on both”**, which
  `_comparative_fallback` only emits when both extracted subjects are in `covered`. 066's
  per-subject retrieval therefore worked; this is not a retrieval bug.
* The neighbouring 13:55 answers show the model obeying the “never mention notes/reference
  material” rule and using the coverage wording. So the 13:54 answer was not an upstream
  failure; the model answered and the coordinator replaced it.

Earlier captures show the 066 changes working as intended: 13:04Z is the 065 deflection
(“reference information…” shipped **with** a citation), and 13:08Z is a 065 answer that narrates
“reference material I can draw from”. Neither shape appears in the 13:54 turn.

### 2. The two code paths that emit the fallback

In `coordinator/dag.py` the `IntentKind.OTHER` branch emits `_comparative_fallback` in exactly
two places after the prose turn:

1. **Guard/refusal/empty/upstream path** (`if failed:`): `_general_answer` returned
   `_GENERAL_FAILURE` with a `failure` kind. For a comparative turn a content rejection
   (`meta`/`action`) stops after one attempt, so one ~18 s model call matches this path too.
2. **“Non-answer” path** (`if comparative and _is_comparative_non_answer(prose_answer):`):
   the model produced usable prose, but 066 classified it as a pure decline and replaced it.

The 066 classifier was:

```python
if not _is_decline(answer):
    return False
lowered = f" {answer.lower()} "
if len(answer.strip()) >= 220 and any(
    marker in lowered for marker in _COMPARATIVE_ANSWER_MARKERS
):
    return False
return True
```

with `_COMPARATIVE_ANSWER_MARKERS = (" but ", " however", " while ", " whereas", …)` —
12 literal phrases. `_is_decline` matches a **declining opening**, which a “which is safer”
question invites (“I can't say which is safer…”). The same opening also made
`_answer_can_cite` return `False` (`if … _is_decline(answer): return False`), so even an answer
that survived the non-answer test could never carry the sources.

### 3. Offline reproduction (fake LLM outputs, current 066 code)

Run against `origin/main` (066) with the fake `Sparky`/retriever harness from
`tests/coordinator/test_comparative_questions.py`; both subjects grounded.

| realistic answer | length | `_is_decline` | 066 `_is_comparative_non_answer` | 066 cited? | outcome |
|---|---|---|---|---|---|
| “I can't say which is safer. Both are non-custodial lending protocols and neither is insured. Aave is one shared pool with market-wide risk; Morpho uses isolated markets and adds curator risk.” | 209 | True | **True** | n/a | **replaced by fallback** |
| “I can't say which is safer, but both are non-custodial… Aave… Morpho…” | 173 | True | **True** | n/a | **replaced by fallback** |
| “I can't say which is safer. Structurally, Aave is one shared lending pool …, while Morpho is a framework of isolated markets…” | 297 | True | False | **False** | served, **uncited** |
| “I'm not able to compare Morpho and Aave because the reference information doesn't include…” | 148 | True | True | n/a | fallback (correct) |
| “I can't say which is safer because SparkPoint does not have enough verified data…” | 95 | True | True | n/a | fallback (correct) |

The first two rows are exactly the reported shape: a substantive, 2–4 sentence comparison (the
prose system prompt asks for 2–4 short sentences) is rejected because it is **shorter than 220
characters**, and a concise comparison often uses sentence punctuation rather than one of the 12
literal markers. The third row shows the second half of the bug: a longer substantive answer is
served but **cannot be cited** because its opening is a decline.

### 4. A second, independent false positive worth logging

066's new META patterns are high precision, but one is broad enough for a legitimate grounded
answer: `\bthe information (?:provided|available|given|supplied) (?:to me|here)\b` matches
“Based on the information available to me, Aave is one shared pool…”. Offline,
`unusable_reason()` returns `"meta"` for that answer, so it would also take the code fallback.
The guard is **not** weakened in 067 (it catches genuine scaffolding); the new outcome log makes
this path visible (`reason=guard_meta`) so a future turn can be diagnosed without guessing. The
message text is never logged.

### 5. OH Defender review notes on #330/#331

The 066 PR review raised five follow-ups, all confirmed in the code:

| note | 066 behaviour |
|---|---|
| (a) whole-message hits should count as coverage | `covered` was built **only** from per-subject hits (`dag.py` 066 lines 652–676); a whole-message hit naming the protocol was added to the prompt but not to `covered`, so the hint/fallback could falsely say “no verified material”. |
| (b) deictic “compare them” must still cite | `_answer_can_cite` returned `bool(covered) and …`; with no extracted subjects `covered` is empty ⇒ **no citation**, regressing 065. |
| (c) guard verbs must match curly apostrophes | the new “doesn't/don't” patterns used ASCII `'` only, so “doesn’t / don’t / didn’t” slipped through. |
| (d) proper-noun fallback picks grammar words | `_CAP_TOKEN_RE` is case-sensitive against `_NOT_A_SUBJECT`, so `AND`, `NOT`, `Does`, `Should`, `Would`, `Can`, `Has`, `When`, `Which`, `What`, `Is`, `Are`, `How` became “subjects”. |
| (e) `_is_comparative_non_answer` is blunt | length ≥ 220 plus one of 12 literal markers; see the reproduction table. |

## Root cause (one paragraph)

066 fixed retrieval, but its post-processing still equated a **declining opening** with a
**non-answer**. A “which is safer” question naturally opens “I can't say which is safer…”; the
prose prompt asks for 2–4 short sentences, so a real comparison is often under 220 characters
and/or uses sentence punctuation instead of one of the 12 literal marker phrases. When both
sides are grounded, that substantive answer is replaced by `_COMPARATIVE_FALLBACK` (the observed
13:54 turn). Even when it is long enough to be served, `_answer_can_cite` rejects any decline
opening, so it can never carry a citation — the second half of the symptom. The follow-up also
found whole-message coverage being ignored, deictic turns losing 065's citation, curly
apostrophes evading the new guard verbs, and grammar words entering the subject extractor.

## Fix summary

* `_comparative_has_substance` classifies a declining opening by **clauses about the named
  sides**, not length/markers; `_is_comparative_non_answer(answer, names)` uses it.
* `_answer_can_cite` allows a declining-opening **substantive** comparative answer; it keeps
  the 029 decline rule for non-comparative turns, and gives deictic comparative turns the 065
  behaviour (empty `covered` ⇒ cite a grounded, non-non-answer model answer).
* `_ground_comparative` adds whole-message hits that genuinely name a subject to `covered`,
  preserving subject order.
* `guard_text` verb patterns accept `’` as well as `'`; the META/action precision is otherwise
  unchanged.
* `comparative.py` lowercases before the grammar-word filter and adds the all-caps/interrogative
  forms.
* `comparative_outcome subjects=%d covered=%d reason=%s cited=%s` is logged at every comparative
  replacement/serve point (INFO; never the user message or model text).
* The coverage hint and `COMPARATIVE_RULE` now say explicitly: if the data cannot rank the
  options, say that once and **still compare the risk factors** — do not stop at the refusal.

No model, gateway, billing, quota, `SPARKY_STREAMING`, Coolify env, database or on-chain change.
No beta chat call, no reingest, no deployment.

## Offline before/after

The new regression file was run against a throwaway `git archive origin/main` checkout (066 code)
and against the 067 tree, with the same fake LLM/retriever, streaming **off and on**:

| tree | command | result |
|---|---|---|
| `origin/main` (066) | `PYTHONPATH=src:. .venv/bin/python -m pytest … -k "declining_opening or whole_message_hit or deictic… or logs"` | **14 failed, 2 passed** |
| 067 | `uv run python -m pytest -q tests/coordinator/test_comparative_questions.py tests/agents/test_guard_text.py` | **73 passed** |

The two passers on base are the “pure decline is still replaced” cases, which were already
correct. The base failures are the reported behaviour (replacement/uncited), not import errors.
Full 067 suite: **2150 passed, 12 failed** — all 12 are the pre-existing
`tests/chain/test_vault_reader.py` forge-artifact failures (`SparkPointVault.json` missing),
which are reported, not fixed.
