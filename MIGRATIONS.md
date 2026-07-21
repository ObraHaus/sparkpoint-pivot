# Migration run history — SparkPoint Pivot

Tracks which migrations have been applied to each environment (**Postgres + pgvector**). Migrations record **no** history of their own, so **this file is the source of truth** — update it whenever you apply a migration.

> **Status (2026-07-16).** The Hermes agent backend is live; migrations live in **`services/agent/migrations/`** (raw SQL, applied via **yoyo**, out-of-band at deploy — not on the app hot path). Develop (`spark-postgres`) is at **`0005`**. Apply with:
> `uv run --group migrations yoyo apply --batch --database "$DATABASE_URL" ./migrations` (from `services/agent`).

> **Note.** Production runs on the **client's infra** (TBD; likely sparkpoint.io); dev/staging runs on **OH Coolify** (Postgres+pgvector single instance). Migration level is tracked per environment regardless of host.

## Current state

| Environment | DB | Migration level | As of |
|---|---|---|---|
| **Production** (client infra — TBD) | Postgres + pgvector (TBD) | **none** | — |
| **Develop** (OH Coolify) | `spark-postgres` (pgvector) | **0014** | 2026-07-20 |

## Per-migration status

| Migration | Develop | Production | What it adds |
|---|---|---|---|
| `0001_foundation` | ✅ | — | users, smart_accounts, networks, beta_whitelist (E15), audit_logs, pgvector `memory_chunks` |
| `0002_vault` | ✅ | — | vault/position mirror |
| `0003_assistant` | ✅ | — | mandates + assistant state |
| `0004_embedding_dim` | ✅ | — | embedding dimension pin (1024) |
| `0005_allowlists` | ✅ | — | Phase B: `wallet_allowlist` + `allowlist_audit` (beta/admin access gate, seeded from env) |
| `0006_knowledge_enum` | ✅ | — | knowledge tier: extend `memory_chunks.source_kind` (`memory_source`) enum with `'knowledge'` |
| `0007_knowledge_backfill` | ✅ | — | knowledge tier: backfill/index for the knowledge source_kind |
| `0008_knowledge_notes` | ✅ | — | R2: `knowledge_notes` (admin-owned corpus notes) + append-only `knowledge_audit` |
| `0009_gateway_audit` | ✅ | — | R3: append-only `gateway_audit` of admin LLM-gateway config changes (no secrets) |
| `0010_conversations` | ✅ | — | B1: per-wallet chat conversation history |
| `0011_content_entries` | ✅ | — | Alpha changelog/announcement: `content_entries` + append-only `content_audit` (+ seed rows) |
| `0012_tip_source_kind` | ✅ | — | adds a `'tip'` label to the `memory_source` enum (sidebar tip databank) |
| `0013_persona_notes` | ✅ | — | Sparky persona: `persona_notes` (admin voice overrides) + `persona_audit` — **isolated** from the RAG corpus (no `memory_source` enum, no vector column, never embedded) |
| `0014_content_slug` | ✅ | — | Feature 006: add `content_entries.slug` + a **partial**-unique index (`WHERE slug IS NOT NULL`) so the committed `content_seed/whats-new.json` upserts changelog entries by slug. No backfill/delete — existing rows keep `slug NULL` and render unchanged |
| `0015_vault_factory` | ⬜ *(new — not yet applied)* | — | Feature 011 Phase 3: two 011-owned tables — `morpho_curated_allowlist` (off-chain curated-vault vetting record) + `sparkpoint_wrappers` (deploy provenance the 010 reader merges: `vault_address`, `chain_id`, `kind`, `label`, `morpho_vault`, `native_fee_bps`, `deploy_tx`, `factory_address`, `status` pending→live, `created_at`). Additive + idempotent (`IF NOT EXISTS`), no backfill. Apply with `PGCLIENTENCODING=UTF8`. Inert until the agent reads it (the `/admin/vaults` manage BFF) |

> **`0013` and `0014` are now APPLIED to develop** (see the Changelog below). Both are additive/idempotent — `0013` is an isolated persona table; `0014` is a nullable column + a partial-unique index (safe to re-run). **Production** (client infra, TBD) is still at **none**: apply the full `0001`–`0014` chain there at the prod handoff.

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

- **2026-07-20** — `0014_content_slug` **APPLIED to develop** (`spark-postgres` @ `192.168.31.26:5432/sparkpoint`) via yoyo (feature 006 — repo-file changelog seed). Adds `content_entries.slug text` + a partial-unique `idx_content_entries_slug` (`WHERE slug IS NOT NULL`); no backfill/delete, so existing rows keep `slug NULL`. Develop now at **0014**. Verified: the `slug` column + `idx_content_entries_slug` exist; `content_seed/whats-new.json` ingested (5 slugged rows — 4 active client entries + the `active:false` 006 entry, later flipped active via PR #44), no duplicates (25 active changelog rows). **⚠️ Order matters** — apply `0014` **before** the agent boots, else its changelog boot-loader logs `whats_new_upsert_failed ×N` (missing column, fail-open) and you must **restart the agent** (Coolify `POST /api/v1/applications/{uuid}/restart`) to re-ingest (I hit this on this deploy). GOTCHA: run yoyo with `PGCLIENTENCODING=UTF8`. `0013_persona_notes` was already applied in a prior session (the `0012` ledger row below was stale).
- **2026-07-17** — `0011_content_entries` + `0012_tip_source_kind` **APPLIED to develop** (`spark-postgres` @ `192.168.31.26:5432/sparkpoint`) via yoyo (Alpha changelog/announcement + sidebar tip databank). `0011` created `content_entries` + append-only `content_audit` and seeded 5 changelog + 1 announcement rows; `0012` added a `'tip'` label to `memory_source`. Develop now at **0012**. Verified: `to_regclass('content_entries')` + `('content_audit')` non-null, 6 seed rows (5 changelog + 1 active announcement "Welcome to the SparkPoint Alpha"), `'tip'` ∈ `memory_source`. Tip databank then seeded via `POST /api/agent/admin/tips/reingest` (6 notes → `GET /api/agent/tips` returns 6). GOTCHA: run yoyo with `PGCLIENTENCODING=UTF8` (the seed content has em-dashes; psycopg2 defaults to ASCII and errors). NB `services/agent/Dockerfile` was fixed (PR #30) to `COPY knowledge_seed` + `knowledge_seed_tips` into the image — the reingest endpoints resolve seed dirs under `/app` and previously found none (both had been CLI-seeded out-of-band).
- **2026-07-17** — `0009_gateway_audit` applied to develop (`spark-postgres`) via yoyo (R3 configurable LLM gateway). Verified: `SELECT to_regclass('gateway_audit');` non-null (+ `gateway_audit_action_check`). Develop now at **0009**. Provisioned same day: a SCOPED proxy-admin LiteLLM key on the agent (`LITELLM_ADMIN_KEY`, minted from the master via `/user/new`, verified ≠ master + admin scope) and `STORE_MODEL_IN_DB=True` on the gateway (was 'False') so model-config writes persist.
- **2026-07-17** — `0008_knowledge_notes` applied to develop (`spark-postgres` @ `192.168.31.26:5432/sparkpoint`) via yoyo (R2 admin knowledge console). `0006_knowledge_enum` + `0007_knowledge_backfill` were **already applied** in a prior session (the ledger row was stale; `yoyo list` confirmed A). Develop is now at **0008**. Verify: `SELECT to_regclass('knowledge_notes');` non-null (8 cols + `knowledge_notes_origin_check`), `to_regclass('knowledge_audit')` non-null, and `'knowledge'` is a label of the `memory_source` enum on `memory_chunks.source_kind`.
- **2026-07-16** — `0005_allowlists` applied to develop (`spark-postgres`) via yoyo (Phase B beta/admin allowlist). `0001`–`0004` were already applied. Verify: `SELECT to_regclass('wallet_allowlist');` is non-null.
