# Plan 054 — Restore free chat and refund failed turns

## Constitution check

- **N1/N3:** no custody or key path touched; gateway models only.
- **N2:** no new gate on withdraw/exit. The quota refund is advisory-compute only.
- **III:** no invented figures; failed turns return an honest error and cost no quota.
- **VII:** reuse the existing LiteLLM config, `LimitsStore`, and quota dependency; no new service,
  no contract, no migration. ✅

## Changes

### Gateway (`services/litellm/config.yaml`)

| Change | Why |
|---|---|
| Replace the two dead `sparkpoint-chat` deployments with Nemotron 3 Ultra / Cohere North Mini Code / Poolside Laguna S 2.1 (4 / 3 / 1) | Three different free providers; every one probed live. |
| `router_settings.enable_weighted_failover: true` | Pinned LiteLLM 1.92.0 does not retry another in-group deployment on `NotFoundError`; this async-only knob does, excluding the failed deployment. |
| Header comments dated 2026-10-27 + retired-model rationale | House style. |
| No premium/selfauthor edits | They work; out of scope. |
| No free → paid fallback | Cost change needs operator approval (documented as an option). |

### Agent (`services/agent/src/sparkpoint_agent/`)

| File | Change |
|---|---|
| `agents/sparky.py` | `MAX_TOKENS` 320 → 640 for reasoning-token headroom; `MAX_CHARS` unchanged. |
| `db/limits.py` | `refund()`: `UPDATE usage_counters SET count = GREATEST(count - 1, 0) ... RETURNING count`. No migration. |
| `api/quota.py` | `LimitDecision` carries `window_start` + `consumed`; fail-safe `refund()` records a masked `refund` event. |
| `api/chat.py` | Inject the decision/store, pass them to `_event_stream`, refund in the `UPSTREAM_UNAVAILABLE` except path. |
| `api/recommendations.py` | Refund only when `_compute` raises `UPSTREAM_UNAVAILABLE`; NOT_FOUND/REFUSAL keep their charge. |
| `api/mandate.py` | Refund an onboarding stream that raises before completing. |
| Tests | `tests/api/test_quota.py`, `tests/api/test_chat_quota_refund.py`, `tests/test_limits_store.py`, `tests/api/test_custody_untouched.py` dependency-tree walk. |

## Verification

- `cd services/agent && .venv/bin/ruff check .` → four **pre-existing** E501s in
  `tests/api/test_mint_whitelist.py` (reproduced on `origin/main`); everything else clean.
- `.venv/bin/mypy src/sparkpoint_agent` → success.
- `SPARKPOINT_VAULT_ABI_PATH=... .venv/bin/pytest -q` → 1723 passed.
- Live probes: `candidates.md` (≤4 calls per candidate, deployed key, no secrets written).

## Rollback

Revert the two changed services (litellm config + agent quota/Sparky). No schema change to undo;
the previous gateway image is the last deployed digest. A rollback restores the old (broken) free
pair, so it should be paired with a paid backstop or a newer free lineup.
