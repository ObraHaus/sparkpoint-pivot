-- 0027_idempotency.sql — feature 023 (Hermes mainnet hardening, FR-023-013/014/015): the DURABLE
-- replay cache behind the §1.3 `Idempotency-Key` contract. One row per (account, method, path, key):
-- the cached 2xx response a replay returns verbatim, so a retried build can never double-emit an
-- IntentBundle. Additive, forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- WHY THIS TABLE EXISTS — two defects in the previous process-local store:
--   1. SECURITY (the load-bearing one): the cache was keyed on the raw `Idempotency-Key` ALONE, a
--      value the CLIENT supplies, with no tenant component — so a key collision across wallets
--      could serve one caller's cached IntentBundle to another. The scope below carries the
--      requesting ACCOUNT plus the method and path, so a key is only ever valid for the caller and
--      route that created it. (Open medium from the alpha security audit R1.)
--   2. DURABILITY: an in-process dict loses every record on restart and cannot span workers, so
--      replay protection silently evaporated on every deploy.
--
-- NON-CUSTODY (Constitution N1/N2/N3): this table holds NO key material and NO signature — only a
-- cached HTTP response body for an ADVISORY build (`signature` in an IntentBundle is always null).
-- It is NEVER on the withdraw/exit path (N2): the store fails OPEN, so an outage, a missing table,
-- or a purged row simply admits the request and the caller re-builds. Losing this table degrades
-- double-emit protection, never custody. Nothing here can gate, delay, or block a user's exit.
--
-- ⚠️ FAIL-OPEN HAS A COST, SO ORDERING IS LOAD-BEARING (FR-023-015a): because a MISSING table is
-- indistinguishable from a working store at the request level, an agent deployed BEFORE this
-- migration is applied would run with no replay protection, no error, and no failing check. Apply
-- 0027 BEFORE redeploying the agent. This migration is additive, so the currently-live agent
-- ignores it — the unsafe order is the other one. The store also logs a DISTINCT table-missing
-- warning as the backstop if that is ever got wrong.
--
-- RETENTION: bundles are short-lived (the IntentBundle TTL is 180s), so records are swept on a
-- bounded horizon rather than kept forever — see `idempotency_records_created_at_idx` and the
-- sweep in db/idempotency.py. The table is a cache, not a ledger; `audit_logs` (0001) and
-- `intent_bundles` (0021) remain the durable record of what was decided and issued.
--
--
-- ⚠️ RENUMBERED 0026 -> 0027 (2026-07-30). Feature 024 landed `0026_vault_registry` on develop while
-- this branch was in flight, so both claimed 0026. This file moved to 0027; the schema is unchanged
-- and the SQL is idempotent, so re-applying under the new id is a no-op. See MIGRATIONS.md for the
-- bookkeeping (the interim `0026_idempotency` yoyo row was removed when this was re-applied as 0027).
--
-- FK note: like session_keys (0025) and intent_bundles/executions (0021), this table is standalone
-- (keyed by the request scope, not by a user row), so no FK churn is introduced.

-- ── idempotency_records — the (account, method, path, key) → cached 2xx response cache ────────────
CREATE TABLE IF NOT EXISTS idempotency_records (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The §1.2 scoping headers' account: an idempotency key is only ever valid for the wallet that
    -- issued it. CITEXT so 0xABC… and 0xabc… are the same caller (addresses are checksum-agnostic).
    account        CITEXT      NOT NULL,
    method         TEXT        NOT NULL,               -- HTTP method (POST today; scoped anyway)
    path           TEXT        NOT NULL,               -- request path: a key can't cross routes
    key            TEXT        NOT NULL,               -- the client's Idempotency-Key (a UUID, §1.3)
    -- The cached response. Only successful (2xx) JSON is ever stored: SSE is never cached (a stream
    -- cannot be replayed) and errors are never cached (a retry must be able to succeed).
    status_code    INTEGER     NOT NULL,
    media_type     TEXT        NOT NULL,
    body           BYTEA       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- FIRST WRITE WINS, enforced by the database rather than by an in-process lock — this is what
    -- makes the guarantee hold ACROSS workers. The store inserts with ON CONFLICT DO NOTHING and
    -- then re-reads, which is the exact SQL expression of the previous in-memory `setdefault`.
    CONSTRAINT idempotency_records_scope_uniq UNIQUE (account, method, path, key)
);

-- Drives the retention sweep (oldest-first, bounded horizon).
CREATE INDEX IF NOT EXISTS idempotency_records_created_at_idx ON idempotency_records (created_at);
