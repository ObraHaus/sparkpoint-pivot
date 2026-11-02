# Research — 074 why comparative answers vary, ranked, and what 074 changed

**Status:** implemented and verified offline · **Branch:** `feat/074-consistent-comparisons` ·
**Base:** `origin/develop` `f27bee8` (PR #333 / 067)
**Evidence:** code reading, the existing 063/065/066/067 specs, `services/litellm/config.yaml`
(read-only), the offline harness, and `scripts/comparative_variance_probe.py`.

No model, beta chat, DB or network call was made for this investigation.

## Ranked sources of variance

Rank is by how much of the observed difference each source explains, highest first.

### 1. The whole answer was model prose, and the serve gate could replace it (`dag.py`)

Before 074 the comparative branch asked `Sparky` for the entire reply (`agents/sparky.py`
`SYSTEM` + `COMPARATIVE_RULE`) and then ran a serve gate: if the answer opened with a refusal,
omitted a subject, or tripped the meta/action guard, the coordinator swapped in the code-authored
`_comparative_fallback` — a completely different answer shape. So the same prompt alternated
between (a) a model comparison, (b) a 2–4 sentence model answer that missed one side, and (c)
`“I can't rank Morpho and Aave…”` from code. This is the dominant variance: it is not just
wording, it is a different answer. (066/067 history: `_is_comparative_servable`,
`_comparative_citable_passages`, `_comparative_fallback`.)

**074:** the skeleton is code, and only the 1–2 sentence Bottom line is model text. A bad Bottom
line degrades to a deterministic sentence; the structure never changes.

### 2. Sampling: no `temperature`/`seed` was sent (`llm/client.py`)

`OpenAICompatTransport._payload` sent only `model`, `messages`, `max_tokens`, `user` and stream
flags. Provider defaults therefore applied, and they differ by provider. There was no way for a
caller to ask for a low-variance turn.

**074:** optional `temperature`/`seed` are plumbed end-to-end; only the comparative Bottom-line
call sets them (`0.2` / `7`). Every other call is byte-identical to before (the parameters are
omitted when `None`).

### 3. Prompt shape + the 700-character clamp (`agents/sparky.py`)

`SYSTEM` asks for “2-4 short sentences, no markdown, no lists”, while `COMPARATIVE_RULE` asks for
risk, yield and fees for **each** side. Those instructions pull in different directions: the model
could satisfy either and fail the other. `MAX_CHARS = 700` (`_clamp`) then cut the answer at a
sentence boundary, which depends on the model's phrasing — so even two semantically similar answers
could end at different points, and one could lose the second subject entirely.

**074:** the model is asked for one thing only (a closing trade-off), capped at 320 characters.
The structured content is never model prose and is never clamped.

### 4. Route/gate flip-flop and content-guard meta rejections

Related to #1, but separately observable: a meta phrase (“based on the reference notes…”), a
refusal opener, or an omitted side sent some runs to `_comparative_fallback` and others to the
model answer. 067 narrowed this with a serve gate, but the gate still had two possible outcomes.

**074:** the turn has one outcome class. The only content-guarded text is the Bottom line, and
its failure has a same-shaped deterministic replacement. `_is_comparative_servable` and
`_comparative_fallback` remain only for the zero-known-subject case.

### 5. Guidance-composer vs 063 route differences by wallet/empty state

The empty-wallet composer owns `_COMPARE_AAVE_RE` (`coordinator/guidance.py` L519/L582) and its
canned `_comparison_block`. Before 063 it answered “Compare that with keeping it in Aave” with
“there's nothing for a mandate to apply to”. 063 made `is_yield_guidance_question` return `False`
for a comparative question and the DAG computes `comparative = is_comparative_question(message)
and not has_financial_action_verb(message)` before `gather`, so the composer is already
unreachable for a comparative turn. The remaining risk was the wallet-dependent routes *after*
`gather`; the comparative branch returns before them.

**074:** the branch is still before `gather`, and it is independent of `streaming`/`single_call`.
A position holder and an empty wallet get the same answer for the same message. The composer's
`_COMPARE_AAVE_RE` path is retained only for a non-comparative “just keep it in Aave” turn, which
is a different question.

### 6. Retrieval order, ties and exception → `()`

`_ground_comparative` preserved the retriever's per-subject order inside each bucket. Two
equal-score chunks could arrive in either order across runs, changing the citation block (and,
before 074, the prompt). A retrieval exception still fails open to `()`.

**074:** each bucket and the whole-message hits are sorted by an explicit stable key
(`provider`, `endpoint`, `field`, `value`, `content`). `Passage` has no relevance score, so there
is no score field to sort on; the retriever's top-k already encodes relevance. Retrieval still
never changes the skeleton — it only decides citations/coverage.

### 7. Curated-vault figures were left to the model (or a different route)

A vault-vs-vault question (“Gauntlet USDC Prime vs Steakhouse USDC”) did not match the protocol
alias table, so the proper-noun fallback produced stray tokens and the model was free to describe
figures it could not know. The curated board already has the reviewed APY/TVL/curator/as-of.

**074:** curated labels are matched from the message against the SAME `CuratedContext` the
curated route reads. A “Live figures” section is rendered from that record, with its stored
as-of, and the model is never asked for a number.

### Residual variance left for Aldrick (out of scope, documented only)

`services/litellm/config.yaml` maps `sparkpoint-chat` to a `simple-shuffle` group of **three
different free models** (Nemotron 3 Ultra, Cohere North Mini Code, Poolside Laguna S 2.1) with
different reasoning budgets and providers. Even with a fixed skeleton and a sampled Bottom line,
the *Bottom-line sentence* can differ per request because a different model may serve it. That is
a model-lineup/routing decision, not a code defect, so this spec leaves it unchanged. If Aldrick
wants the closing sentence to be bit-stable too, the options are a single deterministic alias, a
provider-side seed that is actually honoured, or rendering the Bottom line from code for all
turns.

## Ranked summary

| # | Source | Before | 074 |
|---|---|---|---|
| 1 | Whole answer model prose + serve-gate replacement | answer shape could flip | skeleton always code; only Bottom line model |
| 2 | No `temperature`/`seed` | provider defaults | `0.2`/`7` on the Bottom-line call only |
| 3 | Conflicting prompt + 700-char clamp | answer length/cut varied | one short dedicated prompt, 320-char cap |
| 4 | Meta/refusal/omission → fallback | two answer classes | one class; deterministic Bottom-line fallback |
| 5 | Composer vs comparative route | already fixed by 063; pin it | unchanged, now flag/wallet-independent |
| 6 | Retrieval order/ties | citation order could vary | stable explicit tie-breakers |
| 7 | Curated-vault figures | model could supply them | stored board figures + as-of |
| — | Gateway `simple-shuffle` over 3 free models | residual | unchanged; recommendation only |

## Offline variance probe — before and after

`services/agent/scripts/comparative_variance_probe.py` runs six prompts 10× each through the
REAL `CoordinatorDag` with a seeded noisy fake (varied phrasing, ordering, occasional omitted
subject, occasional meta phrase, occasional refusal) and a deterministic corpus whose tie order
is shuffled. “Structure” is the answer with the `**Bottom line**` section removed.

Before 074 (`origin/develop` code, same script):

```text
comparative variance probe — 10 runs per prompt
- 'Compare Morpho vs Aave.': distinct answers=4 structures=4 routes=1 citations=2
- 'Is Morpho safer than Aave?': distinct answers=4 structures=4 routes=1 citations=2
- 'Aave vs Compound for USDC': distinct answers=4 structures=4 routes=1 citations=2
- 'Lido vs Rocket Pool': distinct answers=4 structures=4 routes=1 citations=2
- 'Compare that with keeping it in Aave.': distinct answers=5 structures=5 routes=1 citations=2
- 'Compare Gauntlet USDC Prime and Steakhouse USDC.': distinct answers=4 structures=4 routes=1 citations=1
TOTAL distinct: answers=25 structures=25 routes=6 citations=11
```

After 074:

```text
comparative variance probe — 10 runs per prompt
- 'Compare Morpho vs Aave.': distinct answers=3 structures=1 routes=1 citations=1
- 'Is Morpho safer than Aave?': distinct answers=3 structures=1 routes=1 citations=1
- 'Aave vs Compound for USDC': distinct answers=3 structures=1 routes=1 citations=1
- 'Lido vs Rocket Pool': distinct answers=3 structures=1 routes=1 citations=1
- 'Compare that with keeping it in Aave.': distinct answers=3 structures=1 routes=1 citations=1
- 'Compare Gauntlet USDC Prime and Steakhouse USDC.': distinct answers=3 structures=1 routes=1 citations=1
TOTAL distinct: answers=18 structures=6 routes=6 citations=6
```

Reading the numbers: the structural answer is now **1 per prompt** (6 total for 6 prompts), routes
and citation sets are **1 per prompt**, and the remaining distinct “answers” (3 per prompt) differ
**only in the model-authored Bottom line** — the seeded noise has three shapes: two acceptable
trade-off sentences and one rejected case that falls back to the deterministic sentence. That is
the intended split: code owns the structure, the model owns one closing sentence.

## Latency impact

Before 074 a comparative turn made up to **two** long prose calls (`_general_answer` retries once)
with `MAX_TOKENS = 640` and then clamped; a content rejection could stop after one call, but an
upstream/empty failure could cost ~15–20 s twice. After 074 the turn makes **one short call**
(`max_tokens = 200`, 1–2 sentences), and a failure is replaced in code with no retry. Net effect:
fewer/cheaper model calls, and the turn no longer pays for a second identical attempt.

## Routing consistency

`comparative = is_comparative_question(message) and not has_financial_action_verb(message)`
(`dag.py` ~L1283) is computed before `gather` and before every wallet-dependent route. The
comparative branch now builds the answer without reading the portfolio/mandate and without the
streaming path, so `SPARKY_STREAMING`, `SPARKY_SINGLE_CALL` and wallet state cannot change the
route or the structure. Deictic follow-ups still get the recent user turns for subject resolution
and retrieval (`_history_comparative_subjects`).

## Test results (this branch)

| Command | Result |
|---|---|
| `uv run pytest -q` | **2452 passed, 12 failed** — all 12 are the pre-existing `tests/chain/test_vault_reader.py` forge-artifact failures (`SparkPointVault.json` missing), which also fail on `origin/develop` |
| golden offline (`python -m evals.run --mode offline`) | **72/72 pass** |
| consistency offline (`python -m evals.run --mode offline --suite consistency`) | **9/9 cases, 45 runs, 100% structural agreement** |
| `uv run ruff check src tests/coordinator scripts evals` | clean |
| `uv run mypy src` | clean (178 files) |

The pre-existing vault-reader failures were verified before any change (same 12 names, same
`RuntimeError: SparkPointVault artifact not found`).
