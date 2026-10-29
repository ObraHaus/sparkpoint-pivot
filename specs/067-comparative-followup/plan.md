# Plan — 067 comparative follow-up

**Base:** `origin/main` `1e48e20` · **Worktree:** `~/project/sparkpoint-pivot-067`
(branch `fix/067-comparative-followup`) · **Develop worktree:** `~/project/sparkpoint-pivot-067-dev`.

## Design

### 1. Substance, not length (`coordinator/dag.py`)

Replace `_COMPARATIVE_ANSWER_MARKERS` + the 220-character floor with a clause-based test:

* Split the answer on sentence punctuation and the contrast connectives
  (`but / however / whereas / while / although / though`).
* A clause is **substantive** when it is not itself a decline and not a “no data/material”
  clause, mentions a named side when names exist, and has at least four words.
* A declining opening has substance when at least one such clause exists and both extracted
  subjects are represented somewhere in the answer (`min(2, len(names))`).
* Deictic turns (no names) require two substantive clauses, because there is no name anchor.

`_is_comparative_non_answer(answer, names)` → `_is_decline(answer) and not substance`.
The DAG passes `subjects or covered`. Classification is reported, not guessed.

### 2. Citation gate (`_answer_can_cite`)

* Non-comparative: unchanged 029 rule (`not _is_decline`).
* Comparative: reject only when `_is_comparative_non_answer(...)`; if `covered` is empty
  (deictic), allow a grounded non-non-answer (065 behaviour); otherwise require every covered
  subject to be named.
* Compute `cited` once and reuse it for the log and the `CitationBlock`.

### 3. Coverage from whole-message hits (`_ground_comparative`)

After the whole-message hits are added, add any subject they genuinely name to `covered`
(release notes already excluded), then rebuild `covered` in message order. This keeps the
coverage hint and fallback honest without changing retrieval.

### 4. Prompt wording

`COMPARATIVE_RULE` and the all-covered branch of `_comparative_coverage_hint` now say: if the
grounded material cannot establish a ranking, say so once and still compare the specific risk
factors — do not stop at the refusal. Still no winner, no allocation advice, no figures.

### 5. Observability (`comparative_outcome`)

One INFO line per comparative prose outcome at the `IntentKind.OTHER` exit points:

```
comparative_outcome subjects=%d covered=%d reason=%s cited=%s
```

Failure mapping: `meta→guard_meta`, `action→guard_action`, `refused`, `empty`,
`upstream`; the non-answer path reports `decline` (no subject named) or `non_answer`
(subject-aware deflection). Served answers report `served` with `cited=true|false`. The logger
format string contains only counts and enums — never the message, model text, wallet or endpoint.

### 6. Guard + extractor (`agents/guard_text.py`, `coordinator/comparative.py`)

* Add `['’]` to the `doesn’t/does not/didn’t/did not` and
  `doesn’t/does not/don’t/do not/…` verb groups. No pattern is removed.
* Lowercase the token before the `_NOT_A_SUBJECT` comparison and expand that set with the
  interrogatives/all-caps forms listed in the review. Two-character tokens (`OR`, `VS`) are
  already below `_CAP_TOKEN_RE`'s 3-character floor.

## Tests

New cases in `tests/coordinator/test_comparative_questions.py` (parametrized `streaming=False/
True` where the turn runs end to end):

* declining-opening substantive answer (long and short variants) → served + cited with both
  providers;
* pure decline naming both sides → still replaced, uncited;
* whole-message-only grounder → coverage hint says both are available, citation ships;
* deictic “compare them” → citation ships with no extracted subjects;
* substance unit tests both ways (named and deictic);
* `comparative_outcome` for a replacement (`reason=decline`, `cited=false`) and for served/cited
  and served/uncited, asserting the logged line contains neither the prompt nor the model text;
* proper-noun fallback drops `AND/NOT/Does/Should/…` but keeps `Yearn`.

New cases in `tests/agents/test_guard_text.py`: curly-apostrophe verb forms are caught;
ordinary “reference rate” / “documentation on the Vault page” answers survive.

## Release

`CHANGELOG.md` top entry and the newest-first `content_seed/whats-new.json` entry (2026-10-29).
Main PR from `fix/067-comparative-followup`; cherry-pick to `fix/067-comparative-followup-develop`
(`origin/develop`), resolving the two release-note files keeping both newest-first, then a
develop PR. No merge, deploy, env change or beta re-ingest.
