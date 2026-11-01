# Spec 074 — consistent comparison answers

**Status:** implemented · **Owner:** build · **Branch:** `feat/074-consistent-comparisons`
**Base:** `origin/develop` `f27bee8` (PR #333, spec 067) · **Sources:**
`specs/063-true-streaming/` (part B), `specs/065-comparative-upstream/`,
`specs/066-comparative-grounding/`, `specs/067-comparative-followup/`,
`coordinator/dag.py`, `coordinator/comparative.py`, `coordinator/guidance.py`,
`agents/sparky.py`, `llm/client.py`, `services/litellm/config.yaml` (read-only).

## Problem

The same comparative prompt (“Compare Morpho vs Aave”, “Is Morpho safer than Aave?”, “Aave vs
Compound for USDC”, a vault-vs-vault question) gives materially different answers across runs.
The model wrote the whole reply, so wording, subject order, omitted sides and, worse, a
guard/gate rejection (model answer vs `_comparative_fallback`) all changed the shape. The
gateway also `simple-shuffle`s across three heterogeneous free models, and no
`temperature`/`seed` was sent, so provider defaults and routing added further variance.

## Requirements

- **R1 — Deterministic data gathering.** Comparative grounding is a pure function of
  `(message, subjects, corpus)`: stable sort with explicit tie-breakers (source/provider,
  endpoint, field, value, content; `Passage` carries no score), canonical subject order (order
  named in the message), dedupe, and a reviewed per-subject FACTS record.
- **R2 — Reviewed facts table.** A small, figure-free, ranking-free structural table for every
  subject in `coordinator/comparative.py` (Aave, Morpho, Compound, Lido, Rocket Pool, SparkPoint
  Vault, Aerodrome, Uniswap, Curve, Balancer, EigenLayer, Pendle, Sky, MakerDAO): category, how
  yield is produced, main risks, fees/structure, custody. Wording follows `knowledge_seed/`.
- **R3 — Curated vaults use the board.** For curated-vault comparisons, APY/TVL/curator/fees
  come from the SAME stored snapshot the curated route reads, with its as-of timestamp. The
  model is never asked for a figure.
- **R4 — Structured template.** The comparative answer is a code-authored skeleton, byte-identical
  for identical inputs: a one-line intro naming the subjects, then fixed sections in fixed order
  (“What it is”, “How the yield is made”, “Main risks”, “Fees & structure”, plus “Live figures”
  for curated vaults), one line per described subject, then “Bottom line”.
- **R5 — Only the Bottom line is model text.** One short dedicated prompt, 1–2 sentences, no
  winner, no advice, no figures. It goes through the shared content guard (`is_unusable`), the
  067 refusal/decline check, and a figure/verdict check. On meta/refusal/empty/verdict/upstream,
  the Bottom line is a deterministic code-authored sentence, so the turn ALWAYS has the same
  structure. Zero known subjects keeps the 066 `_comparative_fallback`.
- **R6 — Honest missing subjects.** A subject with no reviewed facts is named once and plainly
  marked as having no verified material; the subjects that do have facts are still listed. A
  subject with facts but no retrieved passage gets an honest “no retrieved source material”
  note. Citations still require the complete per-subject set (067), and the
  `_log_comparative_outcome` semantics are unchanged.
- **R7 — Sampling plumbing (not a model/billing change).** Optional `temperature`/`seed` flow
  end-to-end through `AsyncClaudeClient.complete` / `stream_complete`, the OpenAI-compatible
  payload and the Anthropic path (temperature only; the Anthropic Messages API has no `seed`).
  Default `None` leaves every other call byte-identical. Comparative Bottom-line calls use
  `temperature=0.2`, `seed=7` (some free models degrade at 0; the gateway sets `drop_params`).
- **R8 — Routing consistency.** The same comparative message takes the same route regardless of
  `SPARKY_STREAMING`, `SPARKY_SINGLE_CALL` or wallet/empty state. The comparative branch runs
  before `gather` and before the yield composer; the composer's `_COMPARE_AAVE_RE` copy remains
  only for non-comparative “keeping it in Aave” turns. Deictic follow-ups keep history resolution.
- **R9 — Preserve 063/065/066/067.** No planner, action, tip or yield/mandate copy on a comparison;
  a comparative turn that also commands an action still reaches the planner; a comparative answer
  is ONE final text block in both streaming modes (no deltas); non-comparative prose is unchanged.

## Non-goals

- No model lineup, routing strategy (`simple-shuffle`), LiteLLM config, billing, quota or
  `SPARKY_*` env default change.
- No Defender/CI/secrets change, no knowledge re-index / seed ingest, no DB writes.
- No new dependencies; no live model/beta calls in tests. Sparky stays English-only.
- No change to `stream_reply`, `stream_tip` or `guard_text.py` (branch `feat/073-streaming-guard`
  is editing those; this branch adds a new Bottom-line method instead).

## Acceptance

1. Replaying ≥8 comparative prompts 5× each with a seeded noisy fake (wording, ordering,
   omission, meta, refusal) yields **identical route, skeleton, subject order and citations**;
   a Bottom line is always present; no meta/action text; English only. Passes in all four
   `SPARKY_STREAMING × SPARKY_SINGLE_CALL` combinations.
2. The pre-074 vs 074 variance probe shows structures collapsing to 1 per prompt (see
   `research.md`).
3. Unit tests pin facts coverage, deterministic tie ordering, byte-identical rendering, every
   Bottom-line fallback path, temperature reaching only comparative calls, and curated figures
   coming from the record.
4. Full agent suite passes except the pre-existing `tests/chain/test_vault_reader.py`
   forge-artifact failures (12, identical on `origin/develop`); golden offline 72/72; ruff,
   ruff format and mypy clean.
5. `CHANGELOG.md` and `services/agent/content_seed/whats-new.json` get 074 entries.
