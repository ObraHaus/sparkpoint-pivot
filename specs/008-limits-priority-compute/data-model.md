# Data Model: Limits & Priority Compute (Phase 1)

Four new Postgres tables (agent-owned) added by `services/agent/migrations/0015_limits.sql`, plus the in-app shapes the enforcement + admin surfaces exchange. Field notes call out invariants tests must enforce. Shapes copy the live `wallet_allowlist` / `content_entries` conventions (lowercased-wallet TEXT keys, append-only `*_audit` written in the same transaction).

## tier_definitions (new — `services/agent/migrations/0015_limits.sql`)

The admin-editable inclusion values for each tier. Seed-then-edit, like `content_entries` / `persona_notes`.

| Column | Type | Notes |
|---|---|---|
| `tier` | TEXT PRIMARY KEY | `'free'` \| `'premium'` (extensible). Lowercase. |
| `display_name` | TEXT NOT NULL | Human label for the admin UI + upsell copy. |
| `chat_daily_limit` | INT NOT NULL | Assistant turns per window. `0` disallowed on the default tier (FR-008). |
| `recs_daily_limit` | INT NOT NULL | Recommendation runs per window. |
| `onboarding_daily_limit` | INT NOT NULL | Onboarding turns per window (bounded already; metered for completeness). |
| `concurrency` | INT NOT NULL | This tier's share of in-flight LLM slots. |
| `priority_weight` | INT NOT NULL | Higher = served first under contention. Free `1`, premium `≥ 3`. |
| `model_alias` | TEXT NOT NULL | Which gateway alias/deployment the tier reaches (default `sparkpoint-chat`). |
| `is_default` | BOOLEAN NOT NULL DEFAULT false | Exactly one row is the default (free). |
| `updated_by` | TEXT | Lowercased admin wallet, or `'env-seed'`. |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**Invariants**: exactly one `is_default = true` row (partial unique index); the default tier's
`chat_daily_limit`/`recs_daily_limit` MUST be `> 0` (a zero on the default tier is refused — FR-008); a
tier referenced by any `wallet_tier` row cannot be deleted (FK). Seeded on migrate + best-effort on boot.

## wallet_tier (new — `0015_limits.sql`)

Who is on which tier. Absence of a row ⇒ the default (free) tier. Mirrors `wallet_allowlist`.

| Column | Type | Notes |
|---|---|---|
| `address` | TEXT PRIMARY KEY CHECK (`address = lower(address)`) | The owner EOA. |
| `tier` | TEXT NOT NULL REFERENCES `tier_definitions(tier)` | The assigned tier. |
| `source` | TEXT NOT NULL | `'admin'` \| `'env-seed'` (future: `'srk'`). |
| `assigned_by` | TEXT | Lowercased admin wallet, or `'env-seed'`. |
| `assigned_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**Invariants**: `address` lowercased (CHECK); a revoke deletes the row (⇒ reverts to default on next
request); keyed by owner EOA, never the counterfactual ERC-4337 account. Optional boot seed from a
`PREMIUM_ALLOWLIST` env, idempotent (mirrors `BETA_ALLOWLIST`).

## usage_counters (new — `0015_limits.sql`)

Per-wallet, per-metric, per-window tally. The enforcement counter AND the monitoring rollup source. Carries **no** message content.

| Column | Type | Notes |
|---|---|---|
| `address` | TEXT NOT NULL CHECK (`= lower(address)`) | Owner EOA. |
| `metric` | TEXT NOT NULL | `'chat'` \| `'recs'` \| `'onboarding'`. |
| `window_start` | TIMESTAMPTZ NOT NULL | Computed bucket (rolling-24h, Asia/Manila) — a new window is a new row. |
| `count` | INT NOT NULL DEFAULT 0 | Incremented atomically. |
| `tier_at_use` | TEXT | The tier resolved when the window opened (for per-tier monitoring). |
| PRIMARY KEY | (`address`, `metric`, `window_start`) | Enables `ON CONFLICT DO UPDATE SET count = count + 1`. |

Indexes: `(window_start DESC)` for monitoring; `(address, window_start DESC)`. **Invariants**: increment is
atomic (single upsert, race-safe within a replica); never stores prompt/response content (FR-021); old
windows age out (a retention sweep MAY prune, out of scope for MVP).

## limits_event (new — `0015_limits.sql`)

Append-only admit/deny/throttle decisions — the monitoring throttle/deny-rate feed. Modeled on `gateway_audit`.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | |
| `verdict` | TEXT NOT NULL CHECK (`verdict IN ('allow','deny','throttle')`) | `deny` = over-cap 429; `throttle` = limiter saturation (busy). |
| `metric` | TEXT NOT NULL | Which allowance/endpoint. |
| `tier` | TEXT NOT NULL | Resolved tier at decision time. |
| `subject` | TEXT | **Masked** wallet (`6…4`) — never the full address in this feed. |
| `detail` | JSONB NOT NULL DEFAULT '{}' | Counts/limits only; NO secrets, NO prompt content. |
| `at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index `(at DESC)`. Append-only by convention (like `gateway_audit`). **Invariants**: `subject` is masked at
write time; `detail` carries no key material or content.

## limits_audit (new — `0015_limits.sql`)

Append-only config-change + grant/revoke trail. Same shape as `allowlist_audit`.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | |
| `action` | TEXT NOT NULL CHECK (`action IN ('tier_update','grant','revoke','seed')`) | |
| `subject` | TEXT NOT NULL | The tier name or the wallet acted on (full, admin-scope audit). |
| `actor` | TEXT | Lowercased admin wallet, or `'env-seed'`. |
| `detail` | JSONB NOT NULL DEFAULT '{}' | Old/new values for a `tier_update`; no secrets. |
| `at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Written in the **same transaction** as the mutation (FR-009).

## LimitDecision (in-app — `services/agent/src/sparkpoint_agent/api/quota.py`)

The result of the `require_within_quota` dependency (not persisted).

```python
@dataclass(frozen=True)
class LimitDecision:
    allowed: bool
    tier: str                 # resolved tier (fail-closed to the default on error)
    metric: str               # 'chat' | 'recs' | 'onboarding'
    used: int                 # count this window (post-increment when allowed)
    limit: int                # the tier's cap for this metric
    remaining: int            # max(0, limit - used)
```

**Invariants**: on `allowed == False` the dependency raises `ApiError(ErrorCode.RATE_LIMITED)` **before**
the route body runs; `tier` resolves to the default on any resolution error (D4); the counter is incremented
only on `allowed == True` and only once per idempotency key (D13).

## Tier resolution + wire (in-app)

- **Agent authority**: `resolve_tier(owner: str) -> str` reads `wallet_tier` (default if absent), used by the
  dependency and by `GET /allowlist/status` (extended to also return `tier`).
- **BFF → agent**: the BFF resolves tier live and forwards `X-Tier: <tier>` alongside the existing
  `X-Owner`/`X-Account`/`X-Chain-Id`. **The agent treats `X-Tier` as a hint only** and re-resolves from its
  own store as the authority (adversarial note in research.md).
- **User self-usage** (`apps/web`): `GET /api/agent/usage/self` (owner-scoped) → `{ tier, metrics: [{ metric,
  used, limit, remaining, resetAt }] }` drives the `CapsMeter` "usage this period" view (US6). Never exposes
  another wallet's usage.
