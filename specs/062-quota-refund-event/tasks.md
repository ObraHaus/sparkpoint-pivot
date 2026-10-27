# Tasks — 062 quota refund audit

- [x] **T6201** Confirm root cause: `refund()` writes `record_event("refund", …)` after the counter
  UPDATE; 0015's `limits_event` CHECK admits only `allow`/`deny`/`throttle`, so the INSERT raises
  `CheckViolationError` and the bare `except` logs `quota_refund_failed`.
- [x] **T6202** `api/quota.py::refund()`: own `try` around `store.refund`; log `quota_refunded
  metric=%s used=%s` at INFO; log `quota_refund_failed metric=%s err=%s` (class name only) at
  WARNING; drop the `limits_event` write; keep fail-safe + guard.
- [x] **T6203** `db/limits.py`: add `EVENT_VERDICTS`; `record_event` raises `ValueError` before the
  DB for an out-of-set verdict.
- [x] **T6204** Update fakes (`test_quota.py`, `test_chat_quota_refund.py`, `test_chat_streaming.py`)
  to enforce `EVENT_VERDICTS`.
- [x] **T6205** Refund unit tests: same window, no event, `quota_refunded` logged, failure logs class
  name only, swallows (no raise), no address in logs.
- [x] **T6206** Chat streaming regression: mid-turn 429/exhausted with a consumed quota → exactly one
  refund, `UPSTREAM_UNAVAILABLE` error block, no `quota_refund_failed`.
- [x] **T6207** `test_limits_verdicts.py`: migration CHECK == `EVENT_VERDICTS`; every literal
  `record_event(` verdict in `src` is allowed. Store-level validation test in `test_limits_store.py`.
- [x] **T6208** Update any test asserting a `"refund"` event.
- [x] **T6209** Spec artifacts (`spec.md`, `plan.md`, `tasks.md`).
- [x] **T6210** `CHANGELOG.md` Fixed section + in-app `whats-new.json` entry (changelog gate).
- [x] **T6211** Verify like CI (ruff, mypy, full pytest, offline golden); commit + push `main` branch.
- [x] **T6212** Cherry-pick to `fix/062-quota-refund-event-develop`; resolve CHANGELOG (develop's
  entries + 062 newest-first); verify; push.
