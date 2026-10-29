# Plan — 065 comparative upstream fix

## Change map

| Area | File | Change |
|---|---|---|
| Guard classification | `agents/guard_text.py` | add `unusable_reason()` (`empty`/`action`/`meta`); `is_unusable` delegates to it. Patterns untouched. |
| Agent outcome | `agents/sparky.py` | `SparkyReply.failure` (`upstream`/`meta`/`action`/`refused`/`empty`, `compare=False`); both paths set it; one anti-scaffolding prompt line. |
| DAG mapping | `coordinator/dag.py` | `_general_answer` / `_stream_general_answer` / `_ProseResult` carry the failure kind; only `upstream` yields `UPSTREAM_UNAVAILABLE`; comparative content rejection yields `_comparative_fallback(message)`; no retry for comparative `meta`/`action`. |
| Logging | `logging_config.py` (new), `api/main.py` | `configure_logging()` in `lifespan`, `LOG_LEVEL` default `INFO`, single handler, `propagate=False`. |
| Address-free logs | `api/admin_self_authoring.py` | drop `admin.owner` from three INFO lines (audit row unchanged). |
| Docs | `MIGRATIONS.md`, `CHANGELOG.md`, `content_seed/whats-new.json`, `specs/065-*` | beta at 0043; release notes; spec artifacts. |

## Data flow after the fix

```
comparative message
  → is_comparative_question && !has_financial_action_verb
  → Intent(OTHER)
  → _ground(..., min_score=0.35)
  → Sparky.reply/stream_reply
      success ...................... body, failure=None
      provider exception ........... failure="upstream"   (retry once)
      meta/action/refused/empty .... failure="meta"|...   (comparative: no retry for meta/action)
  → DAG:
      failure == "upstream" ........ ErrorBlock(UPSTREAM_UNAVAILABLE)
      failure != "upstream" ........ TextBlock(_comparative_fallback(message))
```

`_comparative_fallback` is prose-only by construction (a `text` block cannot carry a
`ProposedAction` or policy stamp), names Morpho/Aave only when both appear in the turn, and
contains no note/prompt vocabulary.

## Tests

- `tests/agents/test_guard_text.py` — classification both ways: the beta deflection is `meta`;
  a legitimate Morpho/Aave risk comparison is `None`; legacy leaks/actions still caught.
- `tests/agents/test_sparky.py` — failure kind for upstream/refused/empty/action/meta/success and
  the streamed meta case.
- `tests/coordinator/test_comparative_questions.py` — beta deflection replayed with
  `streaming=False` and `True`: no `error`, honest text naming both protocols, no `reference
  notes`, exactly one prose call; a true upstream exception still yields
  `UPSTREAM_UNAVAILABLE`.
- `tests/test_logging_config.py` — INFO from `sparkpoint_agent.api.quota` reaches a handler
  after `configure_logging`; `LOG_LEVEL=WARNING` suppresses INFO; idempotent single handler;
  `propagate=False`.

## Verification commands

```bash
cd services/agent
uv run pytest -q
uv run ruff check .
uv run mypy src
uv run pytest -q tests/knowledge tests/test_whats_new_seed.py
```

`tests/chain/test_vault_reader.py` may fail only when forge artifacts are missing (report, do not
"fix" by changing the test).
