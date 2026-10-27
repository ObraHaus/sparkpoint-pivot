# Tasks — 058 Agent evals

## Golden set

- [x] **T2010** Build `evals/golden.yaml`: the 26 beta-audit prompts verbatim.
- [x] **T2011** Add ≥30 coverage cases: NEAR swap/bridge/yield/stake/Intents; supported
      ETH↔USDG swaps; deposits/withdrawals with and without positions; history follow-ups;
      risk/fees/SRK/vault/ERC-4626/Morpho/Aave knowledge; injection/send-address/
      third-party-payment/guaranteed-returns/savings-advice/jailbreak/system-prompt/
      fake-admin/tool-output attacks; empty/gibberish/very-long inputs.
- [x] **T2012** Every case declares route(s), card present/absent (including pair), amounts,
      policy stamp, must(-not)-contain, English-only and rubric tags. Two Taglish prompts
      assert an English reply only.
- [x] **T2013** `evals/rubric.yaml`: judge dimensions + 1–5 scale + pass thresholds.

## Runner

- [x] **T2014** Typed YAML loader/validator (`model.py`).
- [x] **T2015** Real `CoordinatorDag` fixtures (`fixtures.py`): empty / with_position /
      with_mandate wallets, fixed market/curated/changelog, canned LLM + recording client.
- [x] **T2016** Deterministic assertions (`assertions.py`): route, blocks, action card,
      pair/amount/policy, must(-not)-contain, English-only.
- [x] **T2017** Offline mode: in-process, deterministic, < 60s.
- [x] **T2018** Live mode: gateway env, skip cleanly when unset, retries/backoff, per-case
      timeout, infra-vs-fail classification.
- [x] **T2019** LLM judge (`judge.py`) on the same free gateway alias; transcript fenced as
      untrusted data.
- [x] **T2020** Optional `http` mode: read-only `/chat` SSE via `EVAL_BASE_URL` +
      `EVAL_SESSION_COOKIE`.
- [x] **T2021** Outputs: `evals/out/results.json` + markdown with pass rate, per-rubric
      means, p50/p95 first-content/total latency, infra count.

## CI / tests

- [x] **T2022** `tests/evals/test_golden_offline.py` in the existing blocking agent CI.
- [x] **T2023** `.github/workflows/agent-evals.yml`: nightly + dispatch + PR paths;
      blocking offline; non-blocking live (`continue-on-error`), artifact + job summary;
      pinned actions, `contents: read`, no `pull_request_target`, secrets via env.
- [x] **T2024** Document live secrets (`LITELLM_BASE_URL`, `LITELLM_API_KEY`,
      `LITELLM_MODEL`) in the spec; live skips when unset.

## Docs / verification

- [x] **T2025** `evals/README.md` — local offline/live/http runs and adding a case.
- [x] **T2026** `CHANGELOG.md` `[Unreleased]` bullet. No `whats-new.json` entry: the
      changelog gate requires it only for `services/agent/src` product changes, and 058 is
      test/CI/docs only.
- [x] **T2027** Spec Kit records (`spec.md`, `plan.md`, `tasks.md`).
- [x] **T2028** Run offline suite, ruff, strict mypy, full agent pytest; run live once if the
      gateway env is present (otherwise note the clean skip).
- [x] **T2029** Commit on `feat/058-agent-evals`, push, then cherry-pick only the 058
      commit(s) onto a branch from `origin/feat/057-chat-dead-ends-develop` and push.
