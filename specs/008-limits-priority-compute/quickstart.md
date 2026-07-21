# Quickstart: Limits & Priority Compute

How to run and verify the feature locally + on the dev/staging (alpha) environment.

## Prerequisites

- Node 20 (`.nvmrc`), **pnpm 9 (NOT 11 — see the pnpm-version trap)** for any web dep change.
- Python 3.12 + `uv` for `services/agent`.
- Postgres reachable (dev: the develop DB via the LAN IP + published port — see `MIGRATIONS.md`/`COOLIFY.md`; internal container URLs do NOT resolve across Coolify resources).
- `pnpm install --frozen-lockfile` at the repo root.

## Apply the migration (before starting the agent)

```bash
cd services/agent
PGCLIENTENCODING=UTF8 uv run --group migrations yoyo apply --batch --database "$DATABASE_URL" ./migrations
```

`0015_limits.sql` seeds `free` + `premium` `tier_definitions`. Update `MIGRATIONS.md` (Develop → 0015) in the same change. **Apply before the agent boots** (the boot seed is best-effort; a missing table degrades silently to "no limits"). Optional: set `PREMIUM_ALLOWLIST` (comma-separated wallets) to seed premium on boot.

## Run

```bash
# agent (authoritative enforcement + admin/usage APIs)
cd services/agent && uv run uvicorn sparkpoint_agent.api.main:app --reload --port 8000
# web (admin config/usage UI + BFF pre-check + user self-usage)
pnpm --filter @sparkpoint/web dev
```

For a fast local demo, set the free tier's `chat_daily_limit` low (e.g. 3) via **Admin → Config** so the cap is easy to hit.

## Verify by user story

**US1 — free fair-use, funds untouched (🎯 MVP).** As a free wallet, send assistant turns up to the cap — each answers normally and the remaining allowance decrements. The next turn returns the clear "you've reached today's free limit" message (a single dismissible upgrade note, no partial/garbled answer, delivered before any streaming). Throughout, request a vault quote and start a deposit/withdraw — confirm they are **unaffected** (no limit ever touches the vault/withdraw path).

**US2 — live admin config.** In **Admin → Config**, change the free `chat_daily_limit` and save; confirm the very next free request is judged against the new value (no redeploy) and a `limits_audit` row records the change. Try to set the default tier's chat cap to `0` — confirm it is **refused** with a clear reason. As a non-admin, confirm the config surface + its API are invisible (404).

**US3 — admin monitoring.** After generating mixed free/premium traffic (including some over-cap denials), open **Admin → Usage**: confirm per-tier consumption, a top-consumers table (wallets **masked** `6…4`), and a throttle/deny rate — all from real records, no "sample data" badge, no prompt content. Stop the data source and confirm it degrades honestly ("can't load") rather than showing numbers.

**US4 — premium higher limits + priority.** Grant a wallet premium (Admin → Config → assign). Confirm it now has the premium allowances on its **next** request (no re-login). Under simulated saturation (drive concurrent load), confirm a premium turn is served before a contending free turn and free hits the busy path first. Revoke premium → confirm it reverts to free next request. Confirm grant/revoke are audited.

**US5 — gateway abuse ceiling (🛡️).** Re-run the non-destructive probe: `/`,`/ui`,`/openapi.json` → 404; unauthenticated `/chat/completions` → 401; `http://` → redirects to `https://`; the gateway is unreachable from outside the backend network. In **Admin → Gateway**, confirm the virtual key now shows an `rpm/tpm/max_budget` ceiling; confirm exceeding it refuses further calls (bounded) rather than serving unbounded.

**US6 — user self-usage + honest upsell.** As a wallet near its cap, open the premium/manage surface → confirm the `CapsMeter` shows real used/remaining for the period. On hitting a premium-only limit, confirm a single dismissible "what premium adds" note appears without blocking the action, and does **not** re-nag for that limit after dismissal (no modal-on-open, no countdown).

## Tests

```bash
# agent (authoritative logic)
cd services/agent && uv run pytest tests/api/test_quota.py tests/api/test_admin_limits.py \
  tests/api/test_admin_usage.py tests/llm/test_priority_limiter.py tests/db/test_limits_store.py
# web helpers + e2e
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/limits.spec.ts   # domcontentloaded + long hydration budget (CPU-starved box)
```

Cover: pre-stream admit/deny, turn-level + idempotency-aware counting, fail-closed-to-free, custody-path-untouched, zero-cap refusal, non-admin 404, masked-wallet/no-content monitoring, tier-weighted priority under contention.

## Living docs to update (same change)

- `CHANGELOG.md` — `## [Unreleased]` bullets (new tables/migration, quota dependency, admin surfaces, gateway ceiling).
- `services/agent/content_seed/whats-new.json` — client-facing entries per shipped phase (free limits, premium, usage transparency).
- `MIGRATIONS.md` — record `0015` applied per environment.
- `DEVELOPMENT.md` — the `PREMIUM_ALLOWLIST` env + the tier-config model.
- `COOLIFY.md` — the gateway ingress isolation + TLS + credential-ceiling config.
