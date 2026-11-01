# Plan — 074 consistent comparison answers

**Branch:** `feat/074-consistent-comparisons` · **Base:** `origin/develop` `f27bee8`

## Architecture

```text
run_chat(message, chain)
  comparative = is_comparative_question(message) and not has_financial_action_verb(message)
        │
        ├── false → existing paths (planner / curated / yield composer / prose) UNCHANGED
        │
        └── true → OTHER branch, before gather:
              1. read the curated board (fail-open)                    [same snapshot as /vault]
              2. subjects = message-known + curated labels + history   [canonical order, dedupe]
              3. _ground_comparative(...)                              [per-subject, stable sort]
              4. render_comparison(...)                                [CODE: skeleton]
              5. Sparky.comparison_bottom_line(...)                    [1 short model call, 0.2/7]
              6. deterministic Bottom line if the model text is unusable
              7. one final text block + optional complete citation set
```

## Modules touched

| File | Change |
|---|---|
| `coordinator/comparison_facts.py` (new) | Reviewed `SUBJECT_FACTS` table (protocols), `CURATED_VAULT_FACTS`, `render_comparison`, `deterministic_bottom_line`, `format_vault_figures`, curated-label matching. Pure, no network/DB. |
| `coordinator/comparative.py` | Added `KNOWN_SUBJECTS`, `extract_known_subjects`; generic fallback tokens now keep their message position. |
| `coordinator/dag.py` | `_build_comparative_answer`; deterministic `_passage_sort_key`; subject resolution (curated labels + history); Bottom-line validation; comparative branch returns one text block; kept the zero-known `_comparative_fallback` and the outcome log. |
| `agents/sparky.py` | Added `BOTTOM_LINE_SYSTEM`, `comparison_bottom_line` and `_clamp_to`; **did not touch** `stream_reply` (073 rebases cleanly). |
| `llm/client.py` | Optional `temperature`/`seed` in the transport protocol, OpenAI-compatible payload, Anthropic temperature, `complete` and `stream_complete`. Default `None` = unchanged. |
| `evals/consistency.py` (new) | Offline noisy-repeatability suite + opt-in live mode. |
| `evals/run.py` | `--suite {golden,consistency}`. |
| `scripts/comparative_variance_probe.py` (new) | Before/after variance measurement (no network). |
| tests | Rewrote comparative expectations to the 074 behaviour; new facts/temperature/curated tests; consistency suite in CI. |

## Key decisions

- **Structure in code, one sentence from the model.** The model is good at a nuanced trade-off
  sentence and bad at staying byte-stable over a whole answer. The split keeps the nuance but
  makes the answer shape deterministic.
- **Facts are structural only.** No APY/TVL/rankings in the table; a live rate must come from a
  read with an as-of date. Curated vaults use the board record directly.
- **`temperature=0.2`, not 0.** Several free models in the gateway pool degrade at 0 (repetition,
  degenerate short replies). The gateway sets `drop_params: true`, so an unsupported parameter is
  ignored rather than failing. A fixed seed is best-effort.
- **No `seed` on the Anthropic path.** The Anthropic Messages API has no `seed` parameter;
  `temperature` is forwarded there.
- **No prose deltas on comparative turns.** One final text block in both `SPARKY_STREAMING`
  modes. Deltas would add a second rendering path for no user benefit; the Bottom line is short.
- **Citations keep 067's complete-set rule.** The skeleton always names every subject; citations
  still require every subject to have a capped passage. Curated vaults are described from the
  board, so they are excluded from the “no retrieved source material” note and do not manufacture
  citations.
- **Routing stays where 063 put it.** Before `gather`, independent of wallet state and flags. The
  composer's `_COMPARE_AAVE_RE` block remains for non-comparative “just keep it in Aave” turns.

## Determinism contract

For identical `(message, subjects, corpus, curated snapshot)`:

1. `extract_*` order is message order (history extras appended only when the message names < 2).
2. `_ground_comparative` buckets are stable-sorted by `(provider, endpoint, field, value, content)`.
3. `render_comparison` iterates the canonical subject list and a fixed section tuple.
4. The intro/coverage notes are pure functions of `subjects`, `covered` and `vault_subjects`.
5. The only non-deterministic text is between `**Bottom line**` and the end; it is replaced when
   it is empty, meta/action-shaped, a refusal/decline, contains a digit, or declares a winner /
   gives advice.

## Rollout

No migration, no env change, no re-index. Deploy the agent normally. `SPARKY_STREAMING` and
`SPARKY_SINGLE_CALL` keep their defaults and behaviour; comparative turns simply emit one block.

## Verification

See `quickstart.md`. Full agent suite, golden offline, consistency offline, ruff, format, mypy.
The 12 `test_vault_reader` failures are pre-existing (missing forge artifact) and are reported,
not fixed.
