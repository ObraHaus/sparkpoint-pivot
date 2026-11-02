# Quickstart — 074 consistent comparison answers

All commands run from `/home/aldrickb/project/sparkpoint-pivot-074/services/agent`.

```bash
export PATH=$HOME/.local/bin:$PATH
export TMPDIR=/home/aldrickb/tmp-074
```

## Run the targeted tests

```bash
uv run pytest -q \
  tests/coordinator/test_comparative_questions.py \
  tests/coordinator/test_comparison_facts.py \
  tests/coordinator/test_chat_dead_ends.py \
  tests/evals/test_consistency_offline.py
```

## Run the full agent suite

```bash
uv run pytest -q
```

Expected: everything passes except the pre-existing `tests/chain/test_vault_reader.py`
failures (12), which need a `forge build` artifact (`SparkPointVault.json`) and also fail on
`origin/develop`.

## Run the evals

```bash
# golden product set (72 cases)
uv run python -m evals.run --mode offline

# 074 repeatability suite (9 prompts × 5 repeats, noisy fake)
uv run python -m evals.run --mode offline --suite consistency

# opt-in live consistency (needs LITELLM_*; <= 3 repeats x 4 prompts)
uv run python -m evals.run --mode live --suite consistency
```

## Run the variance probe

```bash
uv run python scripts/comparative_variance_probe.py --runs 10
```

“Structure” excludes the `**Bottom line**` section. After 074 each prompt should report
`structures=1 routes=1 citations=1`; the remaining distinct answers are Bottom-line sentences.

## Lint / typecheck

```bash
uv run ruff check src tests/coordinator scripts evals
uv run ruff format --check src/sparkpoint_agent/coordinator/comparison_facts.py \
  src/sparkpoint_agent/coordinator/comparative.py \
  src/sparkpoint_agent/coordinator/dag.py \
  src/sparkpoint_agent/agents/sparky.py \
  src/sparkpoint_agent/llm/client.py \
  evals/consistency.py evals/run.py scripts/comparative_variance_probe.py \
  tests/coordinator/test_comparison_facts.py \
  tests/coordinator/test_comparative_questions.py \
  tests/evals/test_consistency_offline.py
uv run mypy src
```

## Behaviour to expect

- A comparative prompt returns ONE final `text` block in both `SPARKY_STREAMING` modes, with
  fixed sections: What it is · How the yield is made · Main risks · Fees & structure
  (+ Live figures for curated vaults) · Bottom line.
- Only the Bottom line is model text (1–2 sentences, `temperature=0.2`, `seed=7`). If the model
  returns meta/refusal/empty/a figure/a winner, the Bottom line is the deterministic sentence.
- A curated-vault comparison shows the stored APY/TVL/curator/fee note with its as-of date; the
  model is never asked for a figure.
- A subject SparkPoint has no reviewed material for is named once and not described; a subject
  with facts but no retrieved passage gets an honest “no retrieved source material” note, and the
  answer carries no partial citation set.
- No planner, action, recommendation, tip, or yield/mandate copy on a comparison.
