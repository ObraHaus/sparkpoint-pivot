# Migration run history — SparkPoint Pivot

Tracks which migrations have been applied to each environment (**Postgres + pgvector**). Migrations record **no** history of their own, so **this file is the source of truth** — update it whenever you apply a migration.

> **Status (2026-07-16).** The Hermes agent backend is live; migrations live in **`services/agent/migrations/`** (raw SQL, applied via **yoyo**, out-of-band at deploy — not on the app hot path). Develop (`spark-postgres`) is at **`0005`**. Apply with:
> `uv run --group migrations yoyo apply --batch --database "$DATABASE_URL" ./migrations` (from `services/agent`).

> **Note.** Production runs on the **client's infra** (TBD; likely sparkpoint.io); dev/staging runs on **OH Coolify** (Postgres+pgvector single instance). Migration level is tracked per environment regardless of host.

## Current state

| Environment | DB | Migration level | As of |
|---|---|---|---|
| **Production** (client infra — TBD) | Postgres + pgvector (TBD) | **none** | — |
| **Develop** (OH Coolify) | `spark-postgres` (pgvector) | **0005** | 2026-07-16 |

## Per-migration status

| Migration | Develop | Production | What it adds |
|---|---|---|---|
| `0001_foundation` | ✅ | — | users, smart_accounts, networks, beta_whitelist (E15), audit_logs, pgvector `memory_chunks` |
| `0002_vault` | ✅ | — | vault/position mirror |
| `0003_assistant` | ✅ | — | mandates + assistant state |
| `0004_embedding_dim` | ✅ | — | embedding dimension pin (1024) |
| `0005_allowlists` | ✅ | — | Phase B: `wallet_allowlist` + `allowlist_audit` (beta/admin access gate, seeded from env) |

## How migrations are applied

```bash
# TBD at build time — e.g. a migrate script run against DATABASE_URL:
#   pnpm db:migrate          (or)   tsx scripts/apply-sql.ts <dir>/<file>.sql
```

- ⚠️ Apply migrations to **PROD before merging to `main`** (main is intended to trigger production).
- **pgvector:** an early migration must `CREATE EXTENSION IF NOT EXISTS vector;` before any `vector`-typed columns / indexes.
- **Reaching the Coolify DB:** the internal container URL does **not** resolve across resources — connect via the coolify-master LAN IP `192.168.31.240` + the published host port (see COOLIFY.md), e.g. `postgres://user:pass@192.168.31.240:31203/sparkpoint`.
- **Client prod DB:** connection + migrate mechanism TBD once the client handoff is scoped.

## Verifying the applied level

Probe for an object each migration introduces (SQL/REST), e.g. a table, an index, or a seed row:
- `0001_init` → `SELECT 1 FROM pg_extension WHERE extname='vector';` + the base tables exist (once written).

## Changelog

- **2026-07-16** — `0005_allowlists` applied to develop (`spark-postgres`) via yoyo (Phase B beta/admin allowlist). `0001`–`0004` were already applied. Verify: `SELECT to_regclass('wallet_allowlist');` is non-null.
