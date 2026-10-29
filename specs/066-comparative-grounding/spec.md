# Spec 066 — grounded comparative answers (per-entity retrieval, precise guard, no citation on non-answers)

**Status:** implemented · **Owner:** build · **Branch:** `fix/066-comparative-grounding`
**Base:** `origin/main` `46ba84f` (PR #328 / spec 065) · **Sources:** `specs/065-comparative-upstream/research.md`,
beta SSE capture `chat-sse2.json` 2026-10-29 (cases 3/4/5/11), `specs/063-true-streaming/`.

## Problem

065 stopped comparative turns from faking `UPSTREAM_UNAVAILABLE`, but on beta (`SPARKY_STREAMING=0`
and on) they still do not answer well:

- **Morpho vs Aave** — the retrieval top-3 for the whole message are two *release-note* changelog
  entries, so the model says it has no protocol details (“the reference information doesn’t
  include…”), the META guard misses that phrasing, and the deflection ships **with citations**.
- **Compound vs Aave** — the 065 fallback says “those options”; the turn takes ~19.9 s because it
  first retries a rejected prose answer.
- **Lido vs Rocket Pool** — no corpus coverage at all; the model returns a plain “I don’t have
  current data” non-answer.
- **LEARN control** (“What is the difference between Morpho and Aave?”) is grounded and cited.
  The corpus is there; comparative routing is not reaching it.

## Requirements

- **R1 — Ground both sides.** Extract the named protocols from a comparative message and retrieve
  passages for **each named subject** (LEARN-route semantics: unthresholded top-k) plus the
  whole-message query; merge and dedupe. A passage only counts as coverage for a subject when it
  actually names that subject, so a release note cannot stand in for protocol material.
- **R2 — Honest and useful when coverage is partial or absent.** Say plainly which side lacks
  SparkPoint-verified data; compare on what is grounded; give general well-known structural
  differences for the missing side with **no invented figures** (no APY/TVL/rate numbers), no
  allocation advice and no action. The 065 `_COMPARATIVE_FALLBACK` is a **last resort**, names the
  actual extracted subjects (never “those options”), and is used only after the model produced no
  usable answer.
- **R3 — Extend the META guard precisely.** Catch “reference information”, “the information
  provided/available to me”, “the context/documents/passages/material (don’t) include/cover/
  mention”, “my sources”, “reference material I can draw from”. Legitimate answers that mention
  “reference rate” or “documentation on the Vault page” must pass. Tests pin both directions.
- **R4 — No citation on a non-answer.** Emit a citation block only when the final answer is
  model-produced, passed the guard, is not a deflection/fallback, **and** actually engaged the
  grounded passages (for a comparative turn: it names every subject that was grounded). A
  curly-apostrophe “I’m not able…” is a decline too.
- **R5 — Preserve 063/065.** Action-verb comparative turns still go to the planner; streaming
  hold, retry policy, `UPSTREAM_UNAVAILABLE` for true provider failures, and every non-comparative
  route are unchanged.
- **R6 — Coverage (optional but done).** Add one conservative, non-numeric structural note for
  Aave, Compound, Morpho, Lido and Rocket Pool in the shipped knowledge format. Document the exact
  re-ingest step; do not run anything against beta.

## Non-goals

- No model/gateway/billing/quota change; no `SPARKY_STREAMING` or Coolify env change.
- No deployment, no merge, no on-chain action, no database migration.
- No live LLM call in unit tests; retrieval/citation tests use fakes.
- No change to the citation wire shape or to non-comparative prompts beyond the comparative rule.

## Acceptance

1. The three beta prompts, replayed offline with fake LLM + fake retriever, streaming **on and
   off**: no error block, both named subjects present in the prompt when grounded, the missing
   side named when not, and a citation **only** on a grounded model answer.
2. The beta deflection (“reference information…”) is rejected by the guard; a legitimate answer
   mentioning “reference rate” / “documentation on the Vault page” is not.
3. `uv run pytest -q`, `ruff`, `mypy` pass (the pre-existing forge-artifact `test_vault_reader`
   failures are reported, not fixed).
4. `CHANGELOG.md` + `content_seed/whats-new.json` top entries dated 2026-10-29.
