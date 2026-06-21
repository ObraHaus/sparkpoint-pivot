# Migration run history — SparkPoint Pivot

Tracks which migrations have been applied to each environment (**Postgres + pgvector**). Migrations record **no** history of their own, so **this file is the source of truth** — update it whenever you apply a migration.

> **Pre-build status.** No migrations exist yet (build stage ⑤ not started). The tables below are **seeded empty** — fill them in when the first migration lands. The migrations directory is TBD (likely `services/agent/migrations/` or `packages/shared/db/migrations/`; finalized at build time).

> **Note.** Production runs on the **client's infra** (TBD; likely sparkpoint.io); dev/staging runs on **OH Coolify** (Postgres+pgvector single instance). Migration level is tracked per environment regardless of host.

## Current state

| Environment | DB | Migration level | As of |
|---|---|---|---|
| **Production** (client infra — TBD) | Postgres + pgvector (TBD) | **none** | — |
| **Develop** (OH Coolify) | `sparkpoint-postgres-develop` (pgvector) | **none** | — |

## Per-migration status

| Migration | Develop | Production |
|---|---|---|
| _none yet_ | — | — |

_First planned migration (illustrative): `0001_init` — base schema + `CREATE EXTENSION IF NOT EXISTS vector;` for pgvector embeddings. Not written yet._

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

- _No migrations applied yet._
