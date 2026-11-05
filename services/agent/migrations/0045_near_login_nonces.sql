-- =============================================================================
-- 0045_near_login_nonces.sql  -  076: single-use NEP-413 login nonces
-- =============================================================================
-- The web tier issues a random nonce for a NEAR NEP-413 sign-in. The nonce is stored HERE
-- (not only in a cookie) so it can be consumed exactly once, across workers, and so an
-- expired nonce cannot be replayed even if its cookie is replayed.
--
-- The row holds NO key material and NO signature -- only the random nonce and its lifetime.
-- It is an access-login record, never custody (N2).
-- Additive + idempotent; no existing table is altered.
-- ROLLBACK: DROP TABLE IF EXISTS near_login_nonces;
-- =============================================================================

CREATE TABLE IF NOT EXISTS near_login_nonces (
    nonce       TEXT        PRIMARY KEY,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS near_login_nonces_expires_at_idx
    ON near_login_nonces (expires_at);
