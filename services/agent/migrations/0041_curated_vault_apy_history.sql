-- =============================================================================
-- 0041_curated_vault_apy_history.sql  -  Feature 050: per-scan APY history
-- =============================================================================
-- The redesigned /vault cards draw a 30-day net-APY sparkline. The curated row stores only the
-- LATEST observation (`curated_vaults.net_apy_bps`), so the chart needs a small append-only
-- history: one row per vault per curator scan (observed_at + net_apy_bps).
--
-- ⚠️ Display-only, additive: the public read returns the last ~30 points per vault as
-- `apyHistory`; nothing gates deposits, fees or exits on it (N1/N2), and a missing table is
-- fail-open (cards render without a chart).
--
-- Additive, idempotent. Apply with PGCLIENTENCODING=UTF8 before the agent redeploy that serves
-- the redesigned board.
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated_vault_apy_history (
    id             bigserial PRIMARY KEY,
    chain_id       integer NOT NULL,
    -- Lowercase, mirrors curated_vaults.vault_address.
    vault_address  text    NOT NULL,
    observed_at    timestamptz NOT NULL DEFAULT now(),
    net_apy_bps    integer NOT NULL
);

-- The public read: last N points per vault for a set of addresses.
CREATE INDEX IF NOT EXISTS curated_vault_apy_history_idx
    ON curated_vault_apy_history (chain_id, vault_address, observed_at DESC);
