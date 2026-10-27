# Sparky golden evals (spec 058)

A reviewable set of **72 real user prompts** — the 26-prompt beta audit plus NEAR / swap /
knowledge / adversarial / edge coverage — run through the **real `CoordinatorDag`**. The
suite pins what "a good Sparky answer" means after **057 (chat dead-ends)**.

There are two modes:

| Mode | What it does | Network | Blocking? |
|---|---|---|---|
| `offline` (default) | Canned LLM + fixed portfolio/curated/changelog reads. Checks routing, intent, cards, must(-not)-contain and English-only. | none | **Yes** — `tests/evals/test_golden_offline.py` runs in the existing agent CI. |
| `live` | Same cases through the configured LiteLLM gateway, then an LLM judge scores accuracy / grounding / safety / tone (1–5). | gateway | **No** — `agent-evals.yml` runs it nightly/dispatch and is `continue-on-error`. |
| `http` (optional) | Read-only prompts against a deployed `/chat` SSE with a session cookie. | deployed app | No. |

## Run locally

From `services/agent`:

```bash
# deterministic, < 5s, no secrets
uv run python -m evals.run --mode offline

# one case
uv run python -m evals.run --mode offline --case audit-18-injection-dead-address

# live (needs the gateway env; never prints values)
uv run python -m evals.run --mode live

# optional deployed SSE (read-only cases only)
EVAL_BASE_URL=https://beta.example.com EVAL_SESSION_COOKIE='…' \
  uv run python -m evals.run --mode http
```

The offline suite is also a normal pytest test:

```bash
uv run pytest -q tests/evals/test_golden_offline.py
```

### Live mode environment

Live mode uses the **same env vars as the app** and the **same free model group**
(`sparkpoint-chat`). It never prints a key or a base URL.

| Variable | Required | Purpose |
|---|---|---|
| `LITELLM_BASE_URL` | yes | LiteLLM gateway base URL (e.g. the dev/staging gateway). |
| `LITELLM_API_KEY` | yes | Scoped virtual key. Never logged. |
| `LITELLM_MODEL` | no | Model alias; defaults to `sparkpoint-chat` (the free group). |

If the two required vars are unset the command prints a one-line skip and exits 0. This is
why the CI live job can be non-blocking and can never fail a PR for missing secrets.

`--retries` (default 2) retries only **infra** failures with exponential backoff;
`--timeout` (default 30s) bounds each assistant/judge call. A single `--budget-seconds`
(default 2400 = 40 min, below the CI job's 45 min) caps the **whole** live run: once it
expires, the current and remaining cases are marked `infra`/`skipped` and
`results.json` + `summary.md` are still written. A 429 / 5xx / timeout / empty stream /
`UPSTREAM_UNAVAILABLE` is classified `infra`, never `fail`.

### HTTP mode environment

| Variable | Purpose |
|---|---|
| `EVAL_BASE_URL` | Base URL of the deployed app (the runner posts to `/chat`). |
| `EVAL_SESSION_COOKIE` | Session cookie for a read-only evaluation account. |

HTTP mode only runs cases that cannot emit an action card. It never signs or submits
anything.

## Outputs

`evals/out/results.json` and `evals/out/summary.md` (ignored by git) contain:

- pass rate and per-category counts;
- live judge means per rubric dimension;
- p50 / p95 first-content-block and total latency;
- the infra count (kept separate so gateway flakiness never reads as a product failure).

`summary.md` is what CI appends to the job summary. It deliberately contains case ids and
assertion reasons, **not** raw model output.

## Adding a case

Edit `golden.yaml`:

```yaml
- id: unique-id
  category: near
  prompt: "…"
  wallet: empty            # empty | with_position | with_mandate
  history:                 # optional
    - {role: user, content: "…"}
  expected:
    route: unsupported_swap  # or routes: [knowledge, general]
    blocks_present: [text]
    blocks_absent: [action, recommendation]
    must_contain: ["…"]      # case-insensitive substring, or 're:<regex>'
    must_not_contain: ["…"]
    english: true
    action: {type: vault_deposit, amount: "500000000", policy: approved}  # optional
  offline:
    intent: {kind: build_action, actionType: aerodrome_swap, asset: USDC, amount: 100000000}
  offline_check_contains: true
```

- `route`/`routes` are observed from the emitted blocks (`proposal:vault_deposit`,
  `swap_card:USDC->ETH`, `unsafe_refusal`, `knowledge`, `portfolio`, …).
- The `offline.intent` is usually a **misleading** canned intent: deterministic routes must
  fire before the classifier, so a wrong route fails loudly instead of being hidden.
- For prose-only routes (`general`, `knowledge`) set `offline_check_contains: false`; the
  offline run still enforces block shape, must-not-contain and English-only. Live mode checks
  `must_contain` too and adds the judge.
- Keep product copy English-only. A non-English prompt may only assert that the **reply** is
  English; there is no Taglish/Filipino behaviour to test.

`rubric.yaml` holds the judge dimensions and pass thresholds. The judge fences the
transcript as untrusted data, so an injected reply cannot instruct it to score itself well.
