# Plan 058 — Agent evals

## Constitution check

- **N1/N3 (non-custody):** the harness only reads `CoordinatorDag` output. It never signs,
  sends, builds an IntentBundle, or bypasses `policy.evaluate`. The DAG under test still
  stamps every candidate through the deterministic gate.
- **N2 (withdraw-is-sacred):** no product code changed; withdraw cases assert the existing
  ungated exit behaviour.
- **III (honest figures):** live/offline expectations check stored APY/as-of figures and
  forbid invented prices; the live judge scores grounding.
- **VII (no new services):** tests live inside `services/agent`; no new service, contract,
  migration, model, provider or paid dependency. The live job reuses the existing gateway
  and its free alias.
- **English-only:** no Taglish behaviour is added; only two prompts assert an English reply.

## Approach

### 1. Case data (`services/agent/evals/golden.yaml`)

72 cases, each with:

- `id`, `category`, `prompt`, optional `history`, `wallet` (`empty` | `with_position` |
  `with_mandate`) and `chain_id` (default Base 8453; 4663 for USDG/Swap-page cases);
- `expected.routes`, `expected.blocks_present/absent`, `expected.action`
  (`type`/`amount`/`token_in`/`token_out`/`policy`), `must_contain` /
  `must_not_contain` (substring or `re:` regex), `english`, `rubric`;
- `offline.intent`/`prose` canned answers. Deterministic cases carry a deliberately
  **misleading** intent (usually a swap build) so the pre-route must win.

### 2. Runner (`services/agent/evals/`)

- `model.py` — typed YAML loader/validator (unique ids, routes required).
- `fixtures.py` — fixed portfolio/mandate/curated/changelog/market; builds the REAL
  `CoordinatorDag`. Offline uses `_FakeLlm`; live injects the real gateway client wrapped
  in `RecordingClient` so swallowed upstream errors still classify as infra.
- `assertions.py` — route inference from emitted blocks, block/action/must(-not)-contain
  checks, and a conservative English-only heuristic (strong Tagalog markers + English
  stopword floor).
- `judge.py` — fenced LLM judge; four 1–5 dimensions; JSON only; fail-closed on non-JSON.
- `runner.py` — `run_offline`, `run_live` (retries/backoff/timeout/infra classification),
  `run_http` (read-only SSE), JSON + markdown outputs, p50/p95 latency.
- `run.py` / `__main__.py` — `uv run python -m evals.run --mode offline|live|http`.

### 3. Deterministic offline gate

`tests/evals/test_golden_offline.py` runs the whole set and asserts: 26 audit cases present,
≥56 total, unique ids, all pass, <60s, zero infra. `[tool.pytest].pythonpath` gains `.` so
the `evals` package is importable from `services/agent`.

Offline route checks use the same observable the user sees (blocks), so a changed route,
card type, pair, amount or policy stamp fails. Prose-only routes (`general`, `knowledge`)
skip must-contain offline but still enforce block shape, must-not-contain and English.

### 4. Live mode

- Env: `LITELLM_BASE_URL` + `LITELLM_API_KEY` (required), `LITELLM_MODEL` (default
  `sparkpoint-chat`). Values are never printed.
- Up to 3 attempts (`--retries 2`) with exponential backoff for infra only.
- Per-case timeout (`--timeout 60s`).
- Judge uses the same client/alias (free group), 2 judge attempts, then `infra`.
- Results include pass/fail/infra separately; rubric means and latency percentiles.
- Missing config raises `LiveNotConfigured` → CLI prints a skip and exits 0.

### 5. CI (`.github/workflows/agent-evals.yml`)

- `offline` job: blocking, self-hosted `oh-ci`, checkout/setup-uv pinned, `uv sync --frozen`,
  runs the CLI + the pytest test, appends summary, uploads artifact.
- `live` job: schedule/dispatch only, `continue-on-error: true`, `needs: offline`;
  gateway-configured check skips cleanly, appends summary, uploads artifact.
- `permissions: contents: read`; no `pull_request_target`; no untrusted interpolation in
  `run:` blocks (secrets arrive via `env`).

### 6. Docs / changelog

`evals/README.md` documents local runs, modes, env, outputs and how to add a case.
`CHANGELOG.md` gets an `[Unreleased]` test-infra bullet. The changelog gate only requires
`whats-new.json` for `services/agent/src` product changes; this feature is test/CI/docs only
(no `src` change), so no client-facing entry is required and none is added.

## Files

| File | Change |
|---|---|
| `services/agent/evals/golden.yaml` | 72 cases (26 audit + 46 coverage). |
| `services/agent/evals/rubric.yaml` | Judge dimensions + thresholds. |
| `services/agent/evals/model.py` | Typed loader/validator. |
| `services/agent/evals/fixtures.py` | Fixed reads + real DAG builder + fake/recording clients. |
| `services/agent/evals/assertions.py` | Route/block/card/text/English assertions. |
| `services/agent/evals/judge.py` | Fenced LLM judge. |
| `services/agent/evals/runner.py` | Offline/live/HTTP runners + outputs. |
| `services/agent/evals/run.py`, `__main__.py`, `__init__.py` | CLI + exports. |
| `services/agent/evals/README.md` | Operator/developer guide. |
| `services/agent/tests/evals/test_golden_offline.py` | Blocking offline gate. |
| `services/agent/pyproject.toml` | `pythonpath = ["src", "."]`. |
| `.github/workflows/agent-evals.yml` | Nightly/live + PR offline gate. |
| `.gitignore` | Ignore `evals/out/`. |
| `CHANGELOG.md` | Unreleased test-infra bullet. |
| `specs/058-agent-evals/*` | Spec Kit records. |

## Risks / mitigations

* **Free-model flakiness** → live job is `continue-on-error`; infra is counted separately;
  retries/backoff; judge failures are infra, not product failures.
* **Judge prompt injection** → transcript fenced as untrusted data; deterministic safety
  assertions run independently of the judge.
* **Fixture drift** → the DAG, policy gate and block assembly are the real production
  classes; only LLM/read edges are replaced.
* **Offline hiding prose regressions** → live mode checks must-contain + judge; offline
  still enforces routing, cards, safety text and English.
* **Secrets** → live skips when unset; no secret is echoed; required names documented in
  the spec.

## Verification

```bash
cd services/agent
uv run python -m evals.run --mode offline        # 72/72, < 60s
uv run pytest -q tests/evals/test_golden_offline.py
uv run ruff check .
uv run mypy src/sparkpoint_agent
uv run pytest -q                                  # full agent suite
```

Live (only when gateway env is present, once):

```bash
uv run python -m evals.run --mode live
```
