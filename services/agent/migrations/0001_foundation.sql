-- =============================================================================
-- 0001_foundation.sql  -  SparkPoint agent-service foundation schema (T016)
-- =============================================================================
-- Shared/supporting tables that ALL user stories depend on. Mirrors
-- specs/001-sparkpoint-pivot-mvp/data-model.md:
--   sec.0  conventions      - money is NUMERIC(78,0) raw base units (never float),
--                          timestamps are TIMESTAMPTZ, addresses are CITEXT.
--   sec.3  users            - E1 (OFFCHAIN identity; links to the onchain account).
--   sec.4  smart_accounts   - E2 (ONCHAIN custody identity; Postgres read-only mirror).
--   sec.15.1 beta_whitelist - E15 (OFFCHAIN app-access gate; never the exit gate).
--   sec.15.2 audit_logs     - E16 (OFFCHAIN, APPEND-ONLY provability spine; VR-A1..A3).
--   sec.15a networks        - E17 (multi-network config mirror; seeds 'base' live).
--   sec.16 supporting       - onchain_events / price_snapshots / indexer_cursors /
--                          data_source_health (indexed/derived; reorg-safe).
--   sec.17 memory_chunks    - pgvector RAG store (advisory only; VR-E1..E3).
--
-- R14 (multi-network wave rule): every INDEXED/DERIVED table (the ONCHAIN mirror
-- + the sec.16 indexing/derived tables) carries `network_id TEXT NOT NULL DEFAULT
-- 'base'`, and onchain_events gets a composite UNIQUE(network_id, tx_hash,
-- log_index). Pure OFFCHAIN identity/product tables (users, beta_whitelist,
-- audit_logs, memory_chunks) are NOT network-partitioned per sec.15a's enumerated
-- per-network entity list ("smart accounts, positions, balances, vault state,
-- session keys").
--
-- NON-CUSTODY (N2): this layer is a derived index/accelerator ONLY. It is never
-- on the withdrawal path, holds no keys, and no value here gates a signature -
-- the deterministic policy layer re-reads fresh from RPC at decision time (sec.16
-- VR-DS1). Losing all of Postgres degrades intelligence but cannot trap funds.
-- =============================================================================

-- --- Extensions -------------------------------------------------------------
-- vector  : pgvector ANN store for sec.17 memory_chunks.
-- citext  : case-insensitive addresses (sec.0 convention; EVM addresses/EOAs).
-- pgcrypto: gen_random_uuid() for UUID primary keys.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- Enum types -------------------------------------------------------------
-- data-model.md sec.15a - networks.vm_kind.
CREATE TYPE vm_kind AS ENUM ('evm', 'move');

-- data-model.md sec.3.1 - users.onboarding_state lifecycle.
CREATE TYPE onboarding_state AS ENUM (
    'prospective',
    'wallet_connected',
    'account_ready',
    'mandated',
    'active',
    'suspended'
);

-- data-model.md sec.15.1 - beta_whitelist.status lifecycle.
CREATE TYPE whitelist_status AS ENUM ('invited', 'enabled', 'revoked');

-- data-model.md sec.15.2 - audit_logs.actor_kind.
CREATE TYPE audit_actor_kind AS ENUM (
    'user',
    'agent',
    'coordinator',
    'policy_layer',
    'indexer',
    'governance',
    'system'
);

-- data-model.md sec.15.2 - audit_logs.event_type.
CREATE TYPE audit_event_type AS ENUM (
    'policy_verdict',
    'cap_check',
    'killswitch_read',
    'simulation',
    'signature_requested',
    'signature_recorded',
    'session_key_registered',
    'session_key_revoked',
    'recommendation_emitted',
    'mandate_confirmed',
    'governance_pause',
    'risk_event'
);

-- data-model.md sec.16 - price_snapshots.source (chainlink_base canonical;
-- http_api long-tail display-only, flagged; VR-DS1 authority ordering).
CREATE TYPE price_source AS ENUM ('chainlink_base', 'http_api');

-- data-model.md sec.16 - data_source_health.source (drives is_stale / FR-stale).
CREATE TYPE data_source_kind AS ENUM (
    'rpc',
    'subgraph_aave',
    'subgraph_aero',
    'dune',
    'defillama',
    'chainlink',
    'tenderly'
);

-- data-model.md sec.17 - memory_chunks.source_kind.
CREATE TYPE memory_source AS ENUM (
    'chat_message',
    'mandate',
    'goal',
    'recommendation',
    'outcome_log',
    'context_snapshot',
    'literacy_tip',
    'risk_event'
);

-- --- E17 networks (data-model.md sec.15a) --------------------------------------
-- Small config mirror; the referent for every network_id FK. Seeded below so
-- the DEFAULT 'base' always resolves. Custody-critical balances are always read
-- fresh from each network's RPC - never from this mirror (VR-N1).
CREATE TABLE networks (
    id         TEXT PRIMARY KEY,             -- 'base', 'sui'
    name       TEXT NOT NULL,
    live       BOOLEAN NOT NULL,
    vm_kind    vm_kind NOT NULL,
    chain_ref  TEXT NULL,                    -- EVM chainId (e.g. '8453') or Sui id
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Base is live at launch (chainId 8453, per packages/shared CHAIN_ID.base). Sui
-- is the designated fast-follow (non-EVM/Move), presented but not live (VR-N1).
INSERT INTO networks (id, name, live, vm_kind, chain_ref) VALUES
    ('base', 'Base', true,  'evm',  '8453'),
    ('sui',  'Sui',  false, 'move', NULL);

-- --- E2 smart_accounts (data-model.md sec.4) -----------------------------------
-- Read-only ONCHAIN mirror derived from factory/account events; the chain is
-- authoritative. owner_eoa MUST equal users.eoa_address (VR-U3/SA1) - enforced
-- by the indexer (raises a risk_event on mismatch), NOT by a DB FK, so a
-- counterfactual account may exist before its user row (VR-SA3). There is no
-- SparkPoint co-signer / recovery backdoor / server keystore (N3): no column
-- can express a non-owner asset-movement capability.
CREATE TABLE smart_accounts (
    address                CITEXT PRIMARY KEY,                       -- CREATE2 deterministic
    network_id             TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    owner_eoa              CITEXT NOT NULL,                          -- owner(); == users.eoa_address
    factory_address        CITEXT NOT NULL,
    salt                   NUMERIC(78,0) NOT NULL,                   -- CREATE2 salt
    entrypoint_address     CITEXT NOT NULL,                          -- EntryPoint v0.7 (v0.6 fallback)
    deploy_tx_hash         BYTEA NULL,                               -- null while counterfactual-only
    deploy_block           BIGINT NULL,
    is_deployed            BOOLEAN NOT NULL DEFAULT false,           -- code-at-address check
    implementation_address CITEXT NULL,                             -- UUPS impl; owner-only upgrade (N5)
    installed_validators   JSONB NOT NULL DEFAULT '[]'::jsonb,      -- owner ECDSA + SessionKeyValidator
    last_synced_block      BIGINT NULL,                             -- per-account indexer cursor
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX smart_accounts_owner_idx ON smart_accounts (owner_eoa);
CREATE INDEX smart_accounts_network_idx ON smart_accounts (network_id);

-- --- E1 users (data-model.md sec.3) --------------------------------------------
-- Product/identity metadata only; custody identity is the onchain smart account.
-- SRK fields are advisory (VR-U4): no gate may depend on srk_balance_cached.
-- is_active is a soft app-access disable only; it never blocks onchain withdraw
-- (N2). active_mandate_id has no FK here - `mandates` lands in a later story.
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- UUIDv7 preferred app-side (sec.0)
    eoa_address           CITEXT UNIQUE NOT NULL,                      -- self-custodied signer (N3)
    smart_account_address CITEXT NULL UNIQUE REFERENCES smart_accounts(address),
    display_handle        TEXT NULL,
    onboarding_state      onboarding_state NOT NULL DEFAULT 'prospective',
    active_mandate_id     UUID NULL,                                   -- FK->mandates (later story)
    geo_region            TEXT NULL,                                   -- informational; NOT a custody gate
    srk_balance_cached    NUMERIC(78,0) NULL,                          -- display-only mirror (VR-U4)
    is_active             BOOLEAN NOT NULL DEFAULT true,               -- app access only (N2)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- E15 beta_whitelist (data-model.md sec.15.1) -------------------------------
-- OFFCHAIN app-access gate. The BINDING per-user cap lives onchain (CapRegistry);
-- this is a UX mirror. VR-W2/N2: revoked/geo-blocked users KEEP the onchain
-- withdraw-always escape hatch - no whitelist state may precondition /exit.
CREATE TABLE beta_whitelist (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eoa_address     CITEXT UNIQUE NOT NULL,
    status          whitelist_status NOT NULL DEFAULT 'invited',
    per_user_cap_raw NUMERIC(78,0) NOT NULL,                          -- display/UX cap (binding cap onchain)
    geo_allowed     BOOLEAN NOT NULL DEFAULT true,                    -- FR-044 region eligibility
    invited_by      TEXT NULL,
    enabled_at      TIMESTAMPTZ NULL,
    revoked_at      TIMESTAMPTZ NULL,
    notes           TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- E16 audit_logs (data-model.md sec.15.2) - APPEND-ONLY -----------------------
-- The provability/forensics spine: one row per policy verdict, cap check,
-- kill-switch read, simulation, signature event, session register/revoke, and
-- governance/admin action. payload NEVER contains keys/signatures - only their
-- existence/hashes (VR-A3). Append-only is enforced by the trigger below (VR-A1).
CREATE TABLE audit_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_kind     audit_actor_kind NOT NULL,
    actor_ref      TEXT NULL,                                         -- EOA/account/agent name (no secrets)
    event_type     audit_event_type NOT NULL,
    subject_table  TEXT NULL,
    subject_id     UUID NULL,
    policy_version TEXT NULL,                                         -- ruleset in effect (e.g. policy@2026.06.0)
    payload        JSONB NOT NULL DEFAULT '{}'::jsonb,                -- reasons/caps/blocks/hashes - NO keys (VR-A3)
    onchain_ref    BYTEA NULL,                                        -- tx/userop hash when applicable
    hash_prev      BYTEA NULL,                                        -- optional tamper-evident hash chain
    hash_self      BYTEA NULL
);
CREATE INDEX audit_logs_ts_idx ON audit_logs (ts);
CREATE INDEX audit_logs_subject_idx ON audit_logs (subject_table, subject_id);
CREATE INDEX audit_logs_event_type_idx ON audit_logs (event_type);

-- VR-A1: forbid UPDATE/DELETE so the record is tamper-evident. INSERT-only.
-- (Complementary least-privilege grants are an ops concern; the trigger is the
-- schema-level guarantee that survives even a superuser-owned app role.)
CREATE OR REPLACE FUNCTION audit_logs_forbid_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
AS $forbid$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only (data-model.md sec.15.2 VR-A1): % is forbidden', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$forbid$;

CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_mutation();

CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_mutation();

-- --- sec.16 onchain_events (ONCHAIN-DERIVED raw feed) --------------------------
-- The canonical indexed log substrate every derived value is rebuilt from.
-- Idempotent + reorg-safe: UNIQUE(network_id, tx_hash, log_index) (R14) makes
-- re-indexing a no-op; `removed` marks reorged-out logs (VR-DS3).
CREATE TABLE onchain_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id   TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    tx_hash      BYTEA NOT NULL,
    log_index    INTEGER NOT NULL,
    address      CITEXT NOT NULL,                                      -- emitting contract
    topic0       BYTEA NULL,                                           -- event signature hash
    decoded      JSONB NOT NULL DEFAULT '{}'::jsonb,                   -- decoded args
    block_number BIGINT NOT NULL,
    removed      BOOLEAN NOT NULL DEFAULT false,                       -- reorg flag
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT onchain_events_network_tx_log_uniq UNIQUE (network_id, tx_hash, log_index)  -- R14
);
CREATE INDEX onchain_events_addr_block_idx ON onchain_events (network_id, address, block_number);
CREATE INDEX onchain_events_block_idx ON onchain_events (network_id, block_number);

-- --- sec.16 price_snapshots (ONCHAIN-DERIVED canonical marks) -------------------
-- Block-anchored price marks; every displayed number cites one (VR-P3). source
-- = chainlink_base is canonical; http_api is long-tail display-only + flagged.
CREATE TABLE price_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id      TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    asset           TEXT NOT NULL,
    block_number    BIGINT NOT NULL,
    price_quote_raw NUMERIC(78,0) NOT NULL,                             -- raw base units (sec.0; never float)
    source          price_source NOT NULL,
    confidence      NUMERIC NULL,                                       -- 0..1 quality score
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT price_snapshots_uniq UNIQUE (network_id, asset, block_number, source)
);
CREATE INDEX price_snapshots_asset_block_idx ON price_snapshots (network_id, asset, block_number DESC);

-- --- sec.16 indexer_cursors ----------------------------------------------------
-- Per-stream indexing progress; supports reorg-safe rollback (VR-DS3).
CREATE TABLE indexer_cursors (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id           TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    stream               TEXT NOT NULL,                                -- e.g. 'vault', 'account_factory'
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    confirmation_lag     INTEGER NOT NULL DEFAULT 0,                    -- blocks behind head kept unconfirmed
    reorg_watermark      BIGINT NULL,                                   -- safe replay floor
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT indexer_cursors_uniq UNIQUE (network_id, stream)
);

-- --- sec.16 data_source_health -------------------------------------------------
-- Per-source liveness/staleness; drives is_stale marking and "no execution on
-- stale data" (VR-DS2). Custody/withdrawals are unaffected by staleness (N2).
CREATE TABLE data_source_health (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id        TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    source            data_source_kind NOT NULL,
    is_stale          BOOLEAN NOT NULL DEFAULT false,
    last_ok_at        TIMESTAMPTZ NULL,
    last_checked_at   TIMESTAMPTZ NULL,
    staleness_seconds INTEGER NULL,
    detail            JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT data_source_health_uniq UNIQUE (network_id, source)
);

-- --- E-memory memory_chunks (data-model.md sec.17) - pgvector ------------------
-- The single pgvector RAG store (retrieval-augmented, NOT weight-updating).
-- ADVISORY ONLY: retrieval feeds AI reasoning, which is still wrapped by the
-- deterministic policy layer - nothing retrieved can authorize an out-of-policy
-- action (VR-E2). MUST NOT store secrets/keys/signed payloads (VR-E3).
--
-- EMBEDDING DIMENSION: pinned to 1536 here as the launch default. data-model.md
-- sec.17/sec.20 and research.md sec.7 (OQ-5) defer the exact hosted embedding model to
-- implementation but REQUIRE a single version-pinned model+dimension (VR-E1);
-- `embedding_model` stamps the exact model id per row and mixed-dimension
-- vectors MUST NOT share this ANN index - on a model/dimension change, re-embed
-- via a backfill and alter this column in a NEW migration (never mix in place).
CREATE TABLE memory_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NULL REFERENCES users(id),                   -- null = global/shared corpus
    source_kind     memory_source NOT NULL,
    source_id       UUID NOT NULL,                                    -- row the chunk derives from
    content         TEXT NOT NULL,                                    -- chunked text that was embedded
    embedding       vector(1536) NOT NULL,                            -- pinned dim (see note above; VR-E1)
    embedding_model TEXT NOT NULL,                                    -- exact model id/version
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,               -- risk_tier/action_kind/outcome_label/...
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ANN index (cosine) + metadata/scope pre-filter indexes (sec.17 Index & usage).
CREATE INDEX memory_chunks_embedding_hnsw
    ON memory_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_chunks_user_idx ON memory_chunks (user_id);
CREATE INDEX memory_chunks_source_kind_idx ON memory_chunks (source_kind);
CREATE INDEX memory_chunks_metadata_gin ON memory_chunks USING gin (metadata);
