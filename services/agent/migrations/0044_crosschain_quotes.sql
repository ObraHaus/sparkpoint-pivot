-- =============================================================================
-- 0044_crosschain_quotes.sql  -  068: persisted LIVE cross-chain quotes (1Click)
-- =============================================================================
-- One row per live (dry=false) NEAR Intents 1Click quote. The row binds a 1Click deposit
-- address to the caller so /crosschain/deposit/submit and /crosschain/status can prove
-- ownership. It stores the full quote response (including 1Click's ed25519 signature) for
-- audit, plus the last status observed.
--
-- NON-CUSTODY: no key material and no signature by this service. The user sends the origin
-- transaction from their own wallet; this table records what 1Click quoted and where to deposit.
-- Additive + idempotent; no existing table is altered.
-- ROLLBACK: DROP TABLE IF EXISTS crosschain_quotes;
-- =============================================================================

CREATE TABLE IF NOT EXISTS crosschain_quotes (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_eoa         TEXT        NOT NULL CHECK (user_eoa = lower(user_eoa)),
    origin_key       TEXT        NOT NULL,
    destination_key  TEXT        NOT NULL,
    amount_in        TEXT        NOT NULL,
    deposit_address  TEXT        NOT NULL,
    deadline         TIMESTAMPTZ,
    quote_response   JSONB       NOT NULL,
    last_status      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live quote per deposit address. A repeat confirm for the same route gets a new address
-- from 1Click, so this is a safety belt, not a user-facing unique key.
CREATE UNIQUE INDEX IF NOT EXISTS crosschain_quotes_deposit_address_uniq
    ON crosschain_quotes (deposit_address);

CREATE INDEX IF NOT EXISTS crosschain_quotes_owner_created_idx
    ON crosschain_quotes (user_eoa, created_at DESC);
