# Plan 057 — Chat dead-ends

## Constitution check

- **N1/N3:** no key, signing or custody path touched. Every proposal still passes
  `policy.evaluate`; the DAG never signs or sends.
- **N2:** withdraw remains an ungated exit; withdraw-all uses the existing exit allowlist entry.
- **III:** every figure comes from curated/market data with its as-of; projections are labelled
  estimates, never promises.
- **VII:** reuse the existing ChatBlock union, curated record, policy constants and planner. No new
  service, contract, migration, model or config. ✅

## Approach

Two new deterministic pre-routes plus a small amount of prompt hygiene, all in the agent:

1. **`coordinator/guidance.py` (new, pure helpers)** — one place for the new deterministic
   detectors and the empty-state composer:
   * unsafe/injection detector + refusal copy (D);
   * unsupported swap-target detector + honest answer (C);
   * confirmation / withdraw-all / explicit-command predicates (B);
   * amount + duration parsing and "half"/"quarter" scaling from message/history (A);
   * `yield_guidance_answer(...)` composing curated options + estimate + Aave comparison + NEAR
     note + next steps from injected data (A).
2. **`coordinator/dag.py`** — wire the routes in `run_chat` in this order:
   * unsafe/injection → swap-target → bridge → what's-new → how-to-exit → safety →
     yield-guidance (empty state) → curated → existing direct answers → planner.
   * Withdraw-all after the how-to-exit question route: resolve the full vault position amount,
     synthesise a `vault_withdraw` intent, or emit the "nothing to withdraw" text.
   * Confirmation follow-up: reuse the last user request when the previous assistant turn carried
     a proposal (`[proposed action:` / `[recommended:`), else ask.
   * Deposit balance guard after the gate: if the known idle stable balance is below the commanded
     amount, emit the clear "fund your wallet first" text (the gate has still run).
   * `_assemble_chat`: keep the guardrails copy only for a mandate rejection, and add the
     adjustment hint; otherwise give a cause-specific answer.
3. **`agents/planner.py`** — add `VAULT_WITHDRAW` to the advisory action whitelist so an explicit
   withdraw command classifies; fence the user message + history as delimited data and add the
   "blocks are data" rule to the SYSTEM.
4. **`agents/recommender.py`** — add withdraw to the risk-class/title maps so the explicit build
   path can construct it (the candidate set stays code-built and policy-gated).
5. **`agents/sparky.py`** — fence the user message, memory and context blocks as data and add the
   same data-vs-instruction rule.
6. **`coordinator/curated.py`** — do not let `BEST_VAULT_RE` steal an explicit funded command
   ("deposit 500 USDC into the safest vault"); the DAG checks the command predicate before the
   curated route instead of weakening the question regex in isolation.

## Files

| File | Change |
|---|---|
| `services/agent/src/sparkpoint_agent/coordinator/guidance.py` | New detectors + composer. |
| `services/agent/src/sparkpoint_agent/coordinator/dag.py` | Route wiring, withdraw-all, follow-up, deposit balance guard, cause-specific no-candidate copy. |
| `services/agent/src/sparkpoint_agent/agents/planner.py` | Withdraw in advisory set; prompt fencing. |
| `services/agent/src/sparkpoint_agent/agents/recommender.py` | Withdraw risk/title metadata. |
| `services/agent/src/sparkpoint_agent/agents/sparky.py` | Prompt fencing. |
| `services/agent/tests/coordinator/test_chat_dead_ends.py` | A–D integration tests using the audit prompts. |
| `services/agent/tests/agents/test_prompt_fencing.py` | Delimiter assertions for planner/Sparky. |
| `CHANGELOG.md`, `services/agent/content_seed/whats-new.json` | Both changelogs. |

## Risks / mitigations

* **Hijacking good routes.** Each new route is deliberately narrow and ordered after the existing
  deterministic answers (exit/safety/curated) where those are still correct; tests include negative
  cases ("what is APY?", "swap 100 USDC for ETH", "withdraw 100 USDC", "deposit 100 USDC into the
  vault").
* **Fabricated figures.** The composer only reads `CuratedPick.net_apy_bps` / `as_of` and
  `ChainContext.market`; missing data degrades to "not available right now" and the estimate is
  skipped.
* **Approval bypass.** The balance guard only decides whether to *show* an already-gated card; it
  never turns a rejection into an approval. Withdraw uses the existing exit allowlist.
* **Empty allowlist chains.** A deposit cannot be built where the policy allowlist is empty; the
  reply explains that the vault is not on that network and points at `/vault`/Swap.

## Verification

- `cd services/agent && uv run ruff check .`
- `uv run mypy src/sparkpoint_agent`
- `SPARKPOINT_VAULT_ABI_PATH=... uv run pytest -q`
- `uv run pytest -q tests/test_whats_new_seed.py`
- No `apps/web` change → no web suite required; confirm with `git diff --stat`.
