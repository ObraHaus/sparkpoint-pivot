# Spec 058 — Agent evals (A6)

**Status:** implemented · **Owner:** build · **Branch:** `feat/058-agent-evals`
**Depends on:** 057 (chat dead-ends) · **Contracts:** none.

## Why

057 fixed four beta chat dead-ends with prompt-shaped, deterministic routes. Those fixes
are only as durable as the tests around them: the original regression was found by a
26-prompt human audit, and a classifier or prompt edit can silently re-open it. We need a
repeatable harness that replays real questions through the **real CoordinatorDag** on every
change, plus a measured (not vibes-based) live quality signal from the actual free gateway.

The product is **English-only**. The suite therefore contains no Taglish/Filipino
behaviour, few-shots or expected non-English replies. Two Taglish prompts are kept solely
to assert that Sparky answers sensibly **in English**.

## User stories

### US1 — Every chat-affecting PR is checked against real questions (blocking)

As a reviewer, I want the exact beta-audit prompts plus NEAR/swap/knowledge/adversarial/
edge cases replayed deterministically, so a routing or card regression fails CI before it
reaches testers.

**Acceptance criteria**

1. `golden.yaml` contains the 26 beta-audit prompts **and** at least 30 more cases
   (NEAR swap/bridge/yield/stake/what-is-Intents, supported ETH↔USDG swaps, deposits and
   withdrawals with/without positions, history follow-ups, risk/fees/SRK/vault/ERC-4626/
   Morpho/Aave knowledge, injection/unsafe-transfer/personal-advice/jailbreak/system-prompt/
   fake-admin/tool-output attacks, empty/gibberish/very-long inputs).
2. Every case declares its expected route/intent, expected block types (card present/absent,
   card pair), must(-not)-contain rules, English-only assertion and rubric tags.
3. `--mode offline` runs the full set in-process through the real `CoordinatorDag`, with a
   canned LLM and fixed portfolio/curated/changelog reads. It is deterministic and finishes
   in under 60 seconds.
4. The offline run is a normal pytest test (`tests/evals/test_golden_offline.py`) and runs
   in the existing blocking `agent` CI.
5. Deterministic paths (yield guidance, curated, withdraw-all, unsupported swaps,
   injection, safety, fees, APY, automation, what's-new) are proven to fire **before** a
   deliberately misleading canned classifier, so a route regression is loud.
6. The expectations reflect CURRENT intended behaviour after 057, including no swap card
   for unsupported targets, "nothing to withdraw" on an empty wallet, "fund your wallet
   first" for an unaffordable deposit, and the explicit unsafe-request refusal.

### US2 — A nightly live signal, without ever blocking a PR

As an operator, I want the same set replayed through the configured LiteLLM gateway and
scored by an LLM judge, so prompt/model drift is visible without free-model flakiness
breaking the build.

**Acceptance criteria**

1. `--mode live` uses the app's own gateway env (`LITELLM_BASE_URL`, `LITELLM_API_KEY`,
   optional `LITELLM_MODEL`), never prints values, and skips cleanly with a clear message
   when unconfigured.
2. The judge uses the **same free gateway model group** (`sparkpoint-chat`); no paid model,
   new provider or config change.
3. The judge scores accuracy, grounding, safety and tone 1–5 against `rubric.yaml`; the
   transcript is fenced as untrusted data so injection cannot steer the score.
4. Retries use backoff; each case has a timeout. Failures are classified `fail` vs `infra`
   (429/5xx/timeout/empty/`UPSTREAM_UNAVAILABLE` = infra, not a product failure).
5. Outputs are `evals/out/results.json` plus a markdown summary with pass rate,
   per-rubric means, p50/p95 first-content and total latency, and the infra count.
6. CI `agent-evals.yml` runs nightly + `workflow_dispatch`, and on PRs when chat-affecting
   paths change. The live job is `continue-on-error`, uploads the artifact and writes the
   job summary; missing secrets ⇒ skip/neutral, never a failure.

### US3 — Optional deployed check (read-only)

As an operator, I can point `--target http` at a deployed `/chat` SSE with
`EVAL_BASE_URL` + `EVAL_SESSION_COOKIE`. Only cases that cannot emit an action card run;
the runner never signs or submits anything.

### US4 — The set stays maintainable

Adding a case is a YAML edit: id, prompt, optional history/wallet fixture, expected
route/blocks/action/must(-not)-contain/rubric tags, and an optional canned offline intent.
`README.md` documents both modes and the required secrets.

## Non-goals

* No product behaviour change; 058 only observes 057's behaviour.
* No model, gateway, billing, custody or policy change.
* No new paid provider/model; live uses the existing free gateway group.
* No Taglish/Filipino support or eval cases expecting non-English replies.
* No web contract change; no new block type.

## Required secrets (live only)

The live job is optional. To enable it, add these repository Actions secrets (the same
names the app already reads; no new vendor):

| Secret | Required | Notes |
|---|---|---|
| `LITELLM_BASE_URL` | yes | The reachable LiteLLM gateway. |
| `LITELLM_API_KEY` | yes | A scoped virtual key; never logged. |
| `LITELLM_MODEL` | no | Defaults to `sparkpoint-chat` (free group). |

Until they exist, the live job logs a notice, skips, and stays neutral.

## Success signals

* 72 cases: 26 audit + 46 coverage cases, all passing offline.
* Offline suite < 60s and green in agent CI.
* Live mode runs one pass of the set locally when gateway env is present, or documents a
  clean skip.
* `ruff`, strict `mypy` and the full agent pytest suite stay green.
* No changes under `apps/web`; no custody/model/config changes.
