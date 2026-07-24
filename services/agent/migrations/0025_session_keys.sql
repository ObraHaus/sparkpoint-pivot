-- 0024_session_keys.sql — feature 022 US6 session-key automation: the owner-scoped MIRROR of an
-- on-chain scoped session grant (data-model.md §10 E10). One row per authorized session key: its
-- public key, the scope it was granted (allowlisted targets/selectors, per-tx + cumulative caps, max
-- slippage, hard expiry), the monotonic spend synced from chain, and the register/revoke tx hashes.
-- Additive, forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY (Constitution N1/N2/N3/N4/N5): this table holds the session PUBLIC key ONLY — the service
-- NEVER generates or stores a session private key or signature (N3). The CHAIN is the source of truth;
-- every column here is re-derivable from the deployed SparkPointAccount's own storage (the on-chain
-- Policy + allowlist snapshot + monotonic spent), so nothing is fabricated (Principle III / N5). Revoke
-- is a SACRED EXIT (N2): `revoked_tx_hash` records that the owner unilaterally killed the key — the
-- authoritative revoke lives on-chain and needs no SparkPoint cooperation, and no row here can gate it.
-- Losing this table degrades the automation UI/notifications, never custody (funds are governed only by
-- the on-chain account + PolicyModule).
--
-- FK note: intent_bundles/executions (0021) left recommendation_id/user_id as plain nullable UUIDs; this
-- table is likewise standalone (keyed by account + pubkey), so no FK churn is introduced.

-- ── session_key_status — the grant lifecycle (data-model.md §10) ──────────────────────────────────
-- (absent row) -> active -> { exhausted (spent_raw >= cumulative_cap_raw)
--                           | expired   (now() >= valid_until)
--                           | revoked   (owner-only revokeSessionKey) }.
-- A re-authorization mints a NEW session key (a new pubkey => a new row).
DO $$ BEGIN
    CREATE TYPE session_key_status AS ENUM ('active', 'expired', 'revoked', 'exhausted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS session_keys (
    id                    UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    smart_account_address CITEXT             NOT NULL,               -- the user's ERC-4337 account
    owner_address         CITEXT             NOT NULL,               -- the account's sole owner EOA (N3)
    chain_id              BIGINT             NOT NULL,
    session_pubkey        CITEXT             NOT NULL,               -- PUBLIC key only; no private key ever (N3)
    status                session_key_status NOT NULL DEFAULT 'active',
    allowlisted_targets   CITEXT[]           NOT NULL DEFAULT '{}',  -- the session scope's targets
    allowlisted_selectors TEXT[]             NOT NULL DEFAULT '{}',  -- parallel 4-byte selectors (0x-hex)
    per_tx_cap_raw        NUMERIC(78, 0)     NOT NULL,               -- USDC base units (6dp)
    cumulative_cap_raw    NUMERIC(78, 0)     NOT NULL,               -- lifetime ceiling for this key
    spent_raw             NUMERIC(78, 0)     NOT NULL DEFAULT 0,     -- mirror of on-chain monotonic spent
    max_slippage_bps      INTEGER            NOT NULL DEFAULT 0,     -- swap floor; 0 = n/a (vault/Aave only)
    valid_after           TIMESTAMPTZ,                               -- activation (nullable => now)
    valid_until           TIMESTAMPTZ        NOT NULL,               -- HARD expiry (N4, required)
    registered_tx_hash    BYTEA,                                     -- grant tx/userop EVENT (never a signature)
    revoked_tx_hash       BYTEA,                                     -- revoke tx EVENT (sacred exit, N2)
    created_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    -- One live row per (account, pubkey): a re-grant of the same pubkey upserts (idempotent) and
    -- NEVER resets spent (the on-chain ledger is monotonic; the mirror follows it).
    CONSTRAINT session_keys_account_pubkey_uniq UNIQUE (smart_account_address, session_pubkey)
);

CREATE INDEX IF NOT EXISTS session_keys_account_idx ON session_keys (smart_account_address, status);
-- Drives the derive-on-read `sessionKeyExpiry` notification (feature 021): active keys, by expiry.
CREATE INDEX IF NOT EXISTS session_keys_expiry_idx
    ON session_keys (valid_until) WHERE status = 'active';
