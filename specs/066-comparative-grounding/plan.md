# Plan — 066 grounded comparative answers

## Change map

| Area | File | Change |
|---|---|---|
| Subject extraction | `coordinator/comparative.py` (new) | Deterministic alias table (Aave, Morpho, Compound, Lido, Rocket Pool, SparkPoint Vault, …), word-boundary matching, narrow proper-noun fallback, passage/answer mention helpers. |
| Comparative grounding | `coordinator/dag.py` | `_ground_comparative()` retrieves top-`k` per subject (unthresholded, LEARN semantics), keeps only passages that name the subject, excludes release-note/changelog chunks (they name the protocols but are product news), merges the whole-message hits that name a subject, dedupes, caps at 8. Returns `covered`. |
| Coverage prompt | `coordinator/dag.py` | `_comparative_coverage_hint()` tells the prose turn which subjects are grounded and which are not; it is an instruction, not corpus text, and never a citation source. `_prose_context()` appends it outside the passage fence. |
| Fallback | `coordinator/dag.py` | `_comparative_fallback(message, subjects, covered)` names the real subjects and the missing side; only used for a content rejection/upstreamless failure or a pure decline. |
| Non-answer handling | `coordinator/dag.py` | `_is_comparative_non_answer()` replaces a pure decline with the fallback before the terminal text block. `_is_decline` now accepts curly apostrophes. |
| Citation gate | `coordinator/dag.py` | `_answer_can_cite()` = non-empty, not a decline, and (comparative) names every **covered** subject. |
| Guard | `agents/guard_text.py` | 066 scaffolding patterns; no pattern weakened. |
| Prompt | `agents/sparky.py` | `COMPARATIVE_RULE`: name the ungrounded side plainly, never mention notes/context/documents, no figures for that side. |
| Corpus | `knowledge_seed/protocol-basics.md` (new) | One structural, non-numeric, “not insured” H2 per protocol. |
| Tests | `tests/coordinator/test_comparative_questions.py`, `tests/agents/test_guard_text.py`, `tests/knowledge/test_knowledge_seed_content.py` | Per-entity retrieval, one-sided/zero coverage, fallback naming, curly-apostrophe decline, guard both ways, seed coverage. |
| Docs | `CHANGELOG.md`, `content_seed/whats-new.json`, `specs/066-*` | Release notes and spec artifacts. |

## Data flow after the fix

```
comparative message
  → is_comparative_question && !has_financial_action_verb
  → Intent(OTHER)
  → extract_comparison_subjects(message)         # ("Morpho", "Aave")
  → for each subject: _ground(subject, k=3, min_score=0) → keep passages naming it
  → _ground(whole message, k=3, min_score=0.35) → keep passages naming any subject
  → merge/dedupe/cap 8, covered = grounded subjects
  → _prose_context(passages, coverage_hint)
  → Sparky.reply / stream_reply (COMPARATIVE_RULE)
      success, names covered subjects .... text + CitationBlock
      pure decline ....................... TextBlock(_comparative_fallback(subjects, covered))
      meta/action rejection .............. TextBlock(_comparative_fallback(...)) (no citation)
      provider exception ................. ErrorBlock(UPSTREAM_UNAVAILABLE)  (065)
```

## Retrieval semantics

- Per subject: `k=3`, `min_score=0.0` — the LEARN route's unthresholded top-k. An explicit
  protocol name is a precise query; a cosine floor is what dropped the note that was about it.
- Whole message: `k=3`, `min_score=0.35` (unchanged 065 threshold), then filtered to hits that
  name a subject, and release-note/changelog chunks are excluded: their user-facing copy names
  the protocols, so a mention filter alone is not enough.
- Deictic follow-ups keep the 063 history-aware query (`earlier + message`).
- `covered` comes only from per-subject hits. A semantic hit that never names the protocol is not
  coverage.

## Corpus ingest (documented, NOT run)

`knowledge_seed/protocol-basics.md` is shipped by `services/agent/Dockerfile` (`COPY
knowledge_seed ./knowledge_seed`), but the seed corpus is **not** ingested at boot — only the
changelog is indexed (`api/main.py` `_seed_changelog` / `_index_changelog`). After deploy, an
operator must run either:

```bash
# inside the agent container, with DATABASE_URL + EMBEDDING_OPENAI_* present
python -m sparkpoint_agent.knowledge.ingest_cli
# or, as an admin:
curl -X POST .../admin/knowledge/reingest
```

Until that runs, beta behaves as “Compound/Lido/Rocket Pool not covered” and uses the honest
partial-coverage answer; Aave/Morpho still retrieve from the existing notes. No command was run
against beta in this branch.

## Tests

- `tests/coordinator/test_comparative_questions.py`
  - per-subject retrieval reaches both Aave and Morpho (streaming on/off), citations from both;
  - one-sided coverage names the missing side, cites only the grounded subject;
  - zero coverage is useful, uncited, and the prompt says both sides are unverified;
  - the 066 beta deflection falls back to text naming Compound and Aave, never “those options”;
  - a pure curly-apostrophe decline is not cited;
  - extraction is word-bounded (`auto-compound` ≠ Compound) and ordered.
- `tests/agents/test_guard_text.py` — the new scaffolding phrases are caught; “reference rate”
  and “documentation on the Vault page” pass.
- `tests/knowledge/test_knowledge_seed_content.py` — protocol note exists, covers all five, has no
  percentage figures.

## Verification

```bash
cd services/agent
uv run pytest -q
uv run ruff check src tests
uv run mypy src
```

Expected: `2127 passed` plus the 12 pre-existing `tests/chain/test_vault_reader.py` failures when
`contracts/out/SparkPointVault.json` is absent (forge artifacts not built in a fresh worktree).
Reported, not “fixed” by changing the test. Web untouched.
