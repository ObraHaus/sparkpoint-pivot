-- 0018_swap_fee_events.sql — feature 013 (real revenue dashboard): the append-only, idempotent
-- ledger of collected 0.20% swap ROUTING fees. One row per fee-recipient `Transfer` FROM the swap
-- router on the output token. The fee is collected on-chain today (`sweepTokenWithFee` on the
-- SwapRouter02) but recorded NOWHERE — this ledger is the swap stream's only source.
--
-- Modeled verbatim on fee_events (0002): `network_id TEXT NOT NULL DEFAULT 'base' REFERENCES
-- networks(id)`, a `UNIQUE(network_id, tx_hash, log_index)` idempotency key, lowercase CHECKs.
-- Additive + idempotent (`CREATE TABLE IF NOT EXISTS`); NO backfill, NO data change to any other
-- table. Apply with PGCLIENTENCODING=UTF8.
--
-- Non-custody (N2): DISPLAY/DERIVED-ONLY — nothing here is ever read on the withdraw/redeem/exit
-- path; a missing or stale row can only make the admin revenue figure momentarily incomplete.

CREATE TABLE IF NOT EXISTS swap_fee_events (
    id              BIGSERIAL PRIMARY KEY,
    network_id      TEXT        NOT NULL DEFAULT 'base' REFERENCES networks (id),
    tx_hash         TEXT        NOT NULL CHECK (tx_hash = lower(tx_hash)),
    log_index       INT         NOT NULL,
    block_number    BIGINT      NOT NULL,
    block_time      TIMESTAMPTZ NOT NULL,
    token_address   TEXT        NOT NULL CHECK (token_address = lower(token_address)),
    token_decimals  SMALLINT    NOT NULL,
    fee_value_raw   NUMERIC(78, 0) NOT NULL CHECK (fee_value_raw >= 0),
    from_address    TEXT        NOT NULL CHECK (from_address = lower(from_address)),
    to_address      TEXT        NOT NULL CHECK (to_address = lower(to_address)),
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT swap_fee_events_idem UNIQUE (network_id, tx_hash, log_index)
);

-- Per-period aggregation (dashboard time series) + backfill/finality sweeps.
CREATE INDEX IF NOT EXISTS swap_fee_events_net_time_idx ON swap_fee_events (network_id, block_time DESC);
CREATE INDEX IF NOT EXISTS swap_fee_events_net_block_idx ON swap_fee_events (network_id, block_number);

-- Seed the swap-fee progress row into the shared indexer_cursors (0001) — one logical row, no
-- schema change. last_processed_block starts at 0; the indexer floors to the configured
-- deploy/inception block on its first run so the backfill is honest (FR-007 / D6).
INSERT INTO indexer_cursors (network_id, stream, last_processed_block)
VALUES ('base', 'swap_fee', 0)
ON CONFLICT (network_id, stream) DO NOTHING;
