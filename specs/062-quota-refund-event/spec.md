# Spec 062 — Quota refund emits a false `quota_refund_failed` (beta logs)

**Status:** implemented · **Owner:** build · **Branch:** `fix/062-quota-refund-event`
**Source:** beta agent logs — 9× `llm_retry_exhausted status=429 …` each immediately followed by
`quota_refund_failed metric=chat` with no traceback.

## Why

A failed turn is supposed to return its pre-charged quota unit and leave an audit breadcrumb. On
beta, every 429-exhausted chat turn logged a `quota_refund_failed` warning even though the refund
itself most likely succeeded. That is a false alarm (the counter was refunded, so the user was
already made whole) **and** it hid any real refund failure behind the same warning. No refund was
being audited.

## Root cause

`services/agent/src/sparkpoint_agent/api/quota.py::refund()` did two writes under one `try`:

1. `store.refund()` — `UPDATE usage_counters … GREATEST(count - 1, 0)` (autocommitted), so the
   counter refund lands first; then
2. `store.record_event("refund", …)` — an `INSERT INTO limits_event (verdict, …)`.

`migrations/0015_limits.sql` defines
`verdict text NOT NULL CHECK (verdict IN ('allow', 'deny', 'throttle'))`, and no later migration
widens it (verified: only `0015_limits.sql` mentions `limits_event`). The `'refund'` verdict is
therefore rejected by the DB with an `asyncpg.exceptions.CheckViolationError`; the bare
`except Exception:` swallowed it and logged `quota_refund_failed`.

Consequences:
- The counter refund most likely **committed before** the event INSERT failed — users were refunded,
  but the log claimed otherwise.
- No `limits_event` row was ever written for a refund (the INSERT always failed).
- A genuine `store.refund()` failure was indistinguishable from this expected CHECK violation
  (same warning, no error class).

Why tests missed it: the `FakeLimitsStore` / `_Limits` / `_FakeLimits` fakes in
`tests/api/test_quota.py`, `tests/api/test_chat_quota_refund.py` and `tests/api/test_chat_streaming.py`
accepted any verdict and never modelled the 0015 CHECK.

## User stories & acceptance criteria

### US1 — A refund is silent and truthful
1. `refund()` still decrements the counter in the window captured at consume time and keeps the
   `consumed` / `window_start` guard.
2. On success it logs `quota_refunded metric=<metric> used=<count>` at INFO and writes **no**
   `limits_event` row (the structured log is the audit trail; the counter table is unchanged).
3. On a store error it logs `quota_refund_failed metric=<metric> err=<ExceptionClassName>` at
   WARNING, never the exception message and never the wallet address, and never raises.
4. `chat.py` `refund_once` still guarantees at most one refund per turn.

### US2 — A future misuse fails loudly in tests, not in prod
1. `db/limits.py` exports `EVENT_VERDICTS = ("allow", "deny", "throttle")`, mirroring the 0015
   CHECK.
2. `LimitsStore.record_event` raises `ValueError` for a verdict outside `EVENT_VERDICTS` **before**
   touching the DB.
3. Test fakes enforce the same set (they import `EVENT_VERDICTS`).

### US3 — The regression is pinned
1. A test asserts the migration's `limits_event` verdict CHECK list equals `EVENT_VERDICTS`.
2. An AST scan asserts every literal verdict passed to `record_event(` under
   `services/agent/src` is in that set.
3. A chat streaming test reproduces the beta path: an upstream 429/exhausted failure mid-turn with
   a consumed quota yields exactly one `store.refund`, one `UPSTREAM_UNAVAILABLE` error block, and
   no `quota_refund_failed` log.
4. Any test that asserted a `"refund"` event was recorded is updated.

## Non-goals

- **No migration.** The counter table and `limits_event` table are unchanged.
- No custody, signing, policy, model, gateway or billing changes.
- No change to refund semantics (fail-safe, same window, at most once) or to any caller
  (`chat.py`, `mandate.py`, `recommendations.py`).

## Follow-up option (not this spec)

If DB-level refund auditing is desired, add an **additive** migration that widens the CHECK to
include `'refund'` (e.g. `DROP CONSTRAINT … ADD CHECK (verdict IN ('allow','deny','throttle','refund'))`)
and restore the `record_event("refund", …)` write under `EVENT_VERDICTS`. Until then the INFO log
is the audit trail and no refund row is written.

## Success signals

- Agent: `ruff check .`, strict `mypy`, full `pytest`, offline golden all green.
- Regression test fails if the `refund` event write or a stray verdict is reintroduced.
- `CHANGELOG.md` and the in-app changelog updated.
