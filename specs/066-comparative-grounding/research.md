# Research — 066 comparative answers are grounded on the wrong passages

**Status:** root cause confirmed · **Branch:** `fix/066-comparative-grounding` · **Base:** `origin/main` `46ba84f`
**Symptom (beta, `SPARKY_STREAMING=0` and on):** comparative turns answer (200), but weakly:
a deflection that leaks “reference information” is served **with a citation block**, or the 065
canned fallback says “those options”, or a protocol pair with no corpus coverage gets a plain
“I don’t have current data” non-answer.

## Evidence

### 1. The three beta cases (SSE capture, 2026-10-29)

Source: `~/sparkpoint-audit/run/chat-sse2.json` (runner `chat-sse2.mjs`). Times are the runner’s
`terminalMs`; conversation ids are the beta ids (no secrets).

| # | prompt | terminal | block types | answer / outcome |
|---|---|---|---|---|
| 3 | “Is Morpho safer than Aave? Compare them for a cautious user.” | 6 908 ms | `tool_step`, `text`, `citation`, `done` | *“I’m not able to compare Morpho and Aave because the reference information doesn’t include details on either protocol’s risk, yield, or fees.”* + **citation** |
| 4 | “Compare Compound and Aave for a beginner.” | 19 908 ms | `tool_step`, `text`, `done` | 065 `_COMPARATIVE_FALLBACK`: “I can't verify a safety ranking between **those options**…” (the prompt reported the logged `general_branch_retry`) |
| 5 | “Which is riskier, Lido or Rocket Pool?” | 15 310 ms | `tool_step`, `text`, `done` | *“I don’t have current data on Lido and Rocket Pool, so I can’t compare…”* (no citation) |
| 11 (control) | “Compare Compound and Aave for a beginner.” | 10 429 ms | `tool_step`, `text`, `citation`, `done` | Aave-only answer + honest “I don’t have details on Compound”; **one** Aave citation |

The 12:23:25Z control, “What is the difference between Morpho and Aave?”, took the **LEARN**
route and returned a grounded tip + citation in 23.2 s. The corpus therefore *does* contain
Morpho/Aave material; the comparative route is what fails to retrieve it.

### 2. What retrieval actually returned (the decisive evidence)

Fetched the beta conversation for case 3 (`bc4e2a49-…`) without another chat call. The
`citation` block under the non-answer had exactly **two** sources, both changelog entries:

- `obsidian://changelog-true-streaming-and-comparisons-2026-10` — “Sparky's answers now stream
  as they are written — and comparisons get a real answer” · SparkPoint release note
- `obsidian://changelog-comparative-answers-065-2026-10` — “Comparison questions get a real
  answer instead of a retry error” · SparkPoint release note

Neither mentions a protocol’s risk, yield or fees. They are the top-3 cosine hits for the whole
sentence at the OTHER threshold. Case 11’s conversation (`27f6e95b-…`) cited only
`obsidian://aave-v3-supply`, confirming that the Aave note is retrievable when the query is
about Aave; there was no Compound passage to retrieve.

The beta app does not log cosine scores (the search SQL returns them, but only the citation
sources are persisted), so the provenance list is the reproducible retrieval output. A local
re-run against the beta database was attempted read-only but the DB host is not reachable from
this workstation (connect timeout), and the embedding provider returned 502; no live numbers
were invented. The citation provenance is stronger for this bug: it is exactly what the deployed
retriever returned.

### 3. Code path

1. `coordinator/guidance.py:533` `_COMPARATIVE_RE` (used by `is_comparative_question` at `:550`)
   matches `compare`, `vs`, `safer than`, `riskier than`.
2. `coordinator/dag.py:709` (`comparative = is_comparative_question(...) and not
   has_financial_action_verb(...)`) forces a comparative turn to `Intent(OTHER)` at `:1070`.
3. `coordinator/dag.py:1204` — `passages = await self._ground(ground_query,
   min_score=_OTHER_MIN_SCORE)`; `_OTHER_MIN_SCORE = 0.35` (`:238`), `_GROUND_K = 3` (`:196`).
   **One embedding of the whole message, top-3, thresholded.** That is the retrieval that returned
   the two release notes.
4. `coordinator/dag.py:1252` / `:1265` — a content-guard rejection or a pure decline gets
   `_comparative_fallback`; before 066 it only named the subjects when the pair was exactly
   Morpho+Aave and otherwise said “those options” (`:178-193` of the base commit).
5. `coordinator/dag.py:1276` (base `:1063`) — citation gate is only
   `passages and grounded and not _is_decline(prose_answer)`. `grounded` means “the model produced
   a usable answer”, **not** “the answer used a passage”, so case 3’s deflection and its
   changelog citations both shipped.
6. `coordinator/dag.py:1892` `_DECLINE_RE` matched only ASCII apostrophes. The beta text used a
   curly **I’m**, so the deflection was not classified as a decline and the citation was attached.

### 4. Guard gap

`agents/guard_text.py:39-59` caught `\breference notes?\b` but not the beta phrases
“the **reference information** doesn’t include…”, “the **reference material** I can draw from”,
“the information provided/available to me”, “the context/documents/passages/my sources don’t
include…”. Case 3 therefore passed the META guard and was served.

### 5. Corpus coverage (grep of the shipped seed)

`services/agent/knowledge_seed/*.md`:

| protocol | coverage before 066 |
|---|---|
| Aave | `aave-v3-supply.md`, `beta-questions.md`, `usdc-yield-strategies.md`, `risk-profiles.md`, `profit-only-vault.md` |
| Morpho | `aave-v3-supply.md` (Morpho section), `beta-questions.md`, `usdc-yield-strategies.md`, `profit-only-vault.md` |
| Compound | incidental only (“auto-compounds” in `profit-only-vault.md` / `beta-questions.md`) — **no protocol note** |
| Lido | **none** |
| Rocket Pool | **none** |

066 adds `knowledge_seed/protocol-basics.md` with one H2 section per protocol (structural,
non-numeric, “not insured”, no yield/TVL figures). **Ingest step:** the Dockerfile copies
`knowledge_seed` into `/app/knowledge_seed`, but boot only seeds/indexes the changelog
(`api/main.py:745` / `_index_changelog` at `:309`); the knowledge seed is ingested by
`python -m sparkpoint_agent.knowledge.ingest_cli` or admin `POST /admin/knowledge/reingest`
(`api/admin_knowledge.py:154`). Nothing was run against beta. Exact step in the PR body and
`plan.md`.

## Root cause (one paragraph)

066 followed 065 but left comparative grounding as a single whole-message cosine query at
`min_score=0.35` with `k=3`. For “Is Morpho safer than Aave? Compare them for a cautious user.”
those three slots were taken by release-note changelog entries, so the model never saw the
protocol notes and deflected with “reference information”; that phrase was not in the META
guard, the ASCII-only `_DECLINE_RE` missed the curly apostrophe, and the citation gate treated
“the model produced text” as “the answer used the passages”, so the non-answer shipped with
release-note citations. Compound had no protocol note at all, Lido/Rocket Pool had none, and the
065 fallback could only name Morpho/Aave (everything else became “those options”). The fix is
per-named-subject retrieval (LEARN semantics) merged with the whole-message query, an explicit
coverage signal for partial/zero coverage, a precise scaffolding guard, a decline-aware citation
gate, and a fallback that names the actual subjects — plus one structural corpus note for the
five compared protocols.

## Offline before/after check

The 11 new beta-case tests (`test_comparative_retrieves_each_named_subject_separately[off/on]`,
`test_one_sided_coverage_names_the_missing_side_and_cites_only_the_grounded_one[off/on]`,
`test_neither_side_grounded_is_useful_and_uncited[off/on]`,
`test_fallback_names_the_actual_subjects_not_those_options[off/on]`,
`test_a_pure_decline_with_a_curly_apostrophe_is_not_cited[off/on]`,
`test_release_notes_that_name_the_protocols_are_not_protocol_grounding`) were run against the
**065/base code** (`4367009`) and against **066**:

| tree | command | result |
|---|---|---|
| 065 base | `uv run pytest -q /tmp/opencode/test_066_on_base.py -o asyncio_mode=auto -k "…"` | **11 failed** |
| 066 | `uv run pytest -q tests/coordinator/test_comparative_questions.py -k "…"` | **11 passed** |

The base failures are the reported behaviour, not an import error: the whole-message retriever
returns one release-note passage and no per-subject coverage, a curly-apostrophe decline is cited,
and the fallback says “those options”.
