# Plan 062 — Quota refund audit fix

## Constitution check

- **N1/N3:** no key, signature, signing path or custody surface touched. Quota is advisory-compute.
- **N2:** `/exit`, `/trust`, the vault and withdraw are untouched.
- **III:** logs now say what is true (a refund succeeded, or the failing exception class is named)
  and stop reporting a false failure.
- **VII:** reuse the existing seam — `quota.refund()` and `LimitsStore.record_event()`; no new
  table, no new dependency, **no migration**.

## Approach

1. **`api/quota.py::refund()`** — keep the counter refund in its own `try`. On success log
   `quota_refunded metric=%s used=%s` (no wallet) and do **not** write a `limits_event` row. On
   failure log `quota_refund_failed metric=%s err=%s` with `type(err).__name__` only and return.
   No `raise`. The `consumed` / `window_start` guard and `chat.py` `refund_once` are unchanged.
2. **`db/limits.py`** — add module-level `EVENT_VERDICTS = ("allow", "deny", "throttle")` and make
   `record_event` raise `ValueError` for any other verdict before the INSERT. This reproduces the
   0015 CHECK in code so a misuse fails in CI instead of as a prod CheckViolation.
3. **Tests**
   - `tests/api/test_quota.py`: fakes import/enforce `EVENT_VERDICTS`; refund records no event;
     caplog asserts `quota_refunded` (not `quota_refund_failed`); a store exception logs the class
     name only, does not raise, and leaks neither the message nor the address.
   - `tests/api/test_chat_quota_refund.py`: fakes enforce the verdict set; existing `"refund"`
     event assertions updated; new 429-exhausted regression (one refund, one error block, no
     `quota_refund_failed`).
   - `tests/api/test_chat_streaming.py`: fake enforces the verdict set.
   - `tests/test_limits_store.py`: `record_event` rejects an unknown verdict before any DB call.
   - `tests/test_limits_verdicts.py`: parses `migrations/0015_limits.sql`'s verdict CHECK and
     asserts it equals `EVENT_VERDICTS`; AST-scans `services/agent/src` for literal `record_event(`
     verdicts outside the set.

## Files

| File | Change |
|---|---|
| `services/agent/src/sparkpoint_agent/api/quota.py` | Refund logs, no `limits_event` write. |
| `services/agent/src/sparkpoint_agent/db/limits.py` | `EVENT_VERDICTS` + pre-DB validation. |
| `services/agent/tests/api/test_quota.py` | Refund log/event tests, fake guard. |
| `services/agent/tests/api/test_chat_quota_refund.py` | 429 regression, fake guard, assertions. |
| `services/agent/tests/api/test_chat_streaming.py` | Fake guard. |
| `services/agent/tests/test_limits_store.py` | Store validation test. |
| `services/agent/tests/test_limits_verdicts.py` | Migration/constant/AST regression. |
| `specs/062-quota-refund-event/{spec,plan,tasks}.md` | This design. |
| `CHANGELOG.md`, `services/agent/content_seed/whats-new.json` | Living docs. |

## Risks / mitigations

- **Losing refund auditing.** The refund was *never* audited (the INSERT always failed on the
  CHECK), so nothing is lost; the INFO log is a truthful replacement. A future additive migration
  can add a `'refund'` verdict (documented follow-up).
- **Log volume.** One INFO per refunded failed turn, matching one row before it never worked.
- **Fake drift.** Fakes now import the production constant, so a future verdict-set change is
  enforced everywhere at once.

## Verification

- `services/agent`: `ruff check .`, `ruff format --check` (on changed/new files; the tree has
  pre-existing formatting drift), `mypy src/sparkpoint_agent`, `pytest -q` with
  `SPARKPOINT_VAULT_ABI_PATH` set and all LLM keys unset, plus the offline golden set
  (`python -m evals.run --mode offline`, `pytest tests/evals/test_golden_offline.py`).
- No live eval, no network/mocked only.
