-- =============================================================================
-- 0002_vault.sql  -  SparkPoint performance-fee event ledger (T110)
-- =============================================================================
-- The ONCHAIN-DERIVED performance-fee accrual ledger the T110 indexer replays the
-- vault's PerformanceFeeAccrued + HighWaterMarkUpdated events into. Mirrors
-- specs/001-sparkpoint-pivot-mvp/data-model.md sec.8a (E8a fee_events).
--
-- DISPLAY/DERIVED-ONLY (VR-FE3 / N2): this ledger is an accelerator for the admin
-- revenue dashboard + the Trust Center. It is NEVER on a withdraw/redeem path and no
-- row here may block, delay, or revert a redemption. The performance fee is realized
-- ON CHAIN as share DILUTION (fee shares minted to a non-privileged `feeRecipient`);
-- this table only INDEXES that fact. The full fee history is reconstructable from the
-- chain (fee-accrual / HWM-advance events) alone (VR-FE5), so losing this table costs
-- intelligence, never funds.
--
-- Fee model (data-model.md sec.8 / sec.8a): 0% management, 0% entry/exit, 0% on
-- principal; a performance fee on REALIZED YIELD ABOVE A HIGH-WATER MARK only
-- (default 1000 bps, HARD CAP 2000 bps). No fee at/below the HWM (flat/down periods).
--
-- R14 (multi-network wave rule): fee_events is ONCHAIN-DERIVED, so it carries
-- `network_id TEXT NOT NULL DEFAULT 'base'` (FK -> networks) and its idempotency key is
-- the composite UNIQUE(network_id, tx_hash, log_index) — re-indexing the same log is a
-- no-op (VR-FE4). Reorg-safety mirrors sec.16 onchain_events: rows below the
-- confirmation lag may be rolled back on a reorg, so (like onchain_events, and unlike
-- the audit_logs provability spine) fee_events carries NO mutation-forbidding trigger.
--
-- Applied via yoyo (0001 style); additive + idempotent (all-or-nothing in one tx).
-- =============================================================================

-- --- Enum types -------------------------------------------------------------
-- data-model.md sec.8a - fee_events.trigger_kind: the lazy-accrual trigger. Fee
-- accrual is lazy (settled on deposit/withdraw/harvest). The indexer sets this from
-- the co-located ERC-4626 event in the same tx when available, else 'harvest'
-- (a bare accrueFee()/harvest() call) — never load-bearing for custody.
CREATE TYPE fee_trigger AS ENUM ('deposit', 'withdraw', 'harvest');

-- --- E8a fee_events (data-model.md sec.8a) - ONCHAIN-DERIVED, append-only ------
-- One row per lazy performance-fee accrual that actually minted fee shares (the
-- vault emits PerformanceFeeAccrued only when feeShares > 0; flat/down periods mint
-- nothing and produce no row). Each row is fully reconstructable on-chain (VR-FE5):
--   PerformanceFeeAccrued(feeRecipient, feeShares, yieldAssets, newHighWaterMark)
--     -> fee_recipient, fee_shares_minted_raw, yield_realized_raw, hwm_after_ray
--   paired HighWaterMarkUpdated(oldHWM, newHWM) at the next log_index in the same tx
--     -> hwm_before_ray (the mark this accrual advanced FROM)
CREATE TABLE fee_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- UUIDv7 preferred app-side (sec.0)
    network_id            TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    vault_address         CITEXT NOT NULL,                              -- SparkPointVault (mirrors vaults.address)
    fee_recipient         CITEXT NOT NULL,                              -- non-privileged holder the fee shares minted to
    trigger_kind          fee_trigger NOT NULL DEFAULT 'harvest',       -- deposit | withdraw | harvest (lazy trigger)
    block_number          BIGINT NOT NULL,                              -- accrual block
    block_time            TIMESTAMPTZ NOT NULL,                         -- accrual block timestamp
    as_of_block           BIGINT NOT NULL,                              -- chain head the indexer had reached (reproducibility)
    tx_hash               BYTEA NOT NULL,                               -- 32-byte tx hash
    log_index             INTEGER NOT NULL,                             -- PerformanceFeeAccrued log index
    -- performanceFeeBps in effect at accrual. VR-FE2 / VR-V1a: HARD CAP 2000 bps — a
    -- value above the cap is impossible on-chain (setPerformanceFeeBps reverts), so it
    -- is a critical integrity breach; the indexer raises a risk_event and never writes
    -- such a row (this CHECK is the schema-level backstop).
    fee_rate_bps_at_event INT NOT NULL CHECK (fee_rate_bps_at_event BETWEEN 0 AND 2000),
    -- VR-FE1 (N1): the assets gained ABOVE hwm_before_ray only — never principal.
    -- 0 would mean no fee (no row emitted); always > 0 in practice. Never negative.
    yield_realized_raw    NUMERIC(78,0) NOT NULL CHECK (yield_realized_raw >= 0),
    -- Fee shares minted to fee_recipient; their claim reconciles to
    -- fee_rate_bps_at_event x yield_realized_raw at the event share price (VR-FE2).
    fee_shares_minted_raw NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (fee_shares_minted_raw >= 0),
    hwm_before_ray        NUMERIC(78,0) NOT NULL,                       -- share-price HWM before this accrual
    hwm_after_ray         NUMERIC(78,0) NOT NULL,                       -- HWM after the advance (post-mint pps)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- VR-FE4: the HWM only advances, never retreats.
    CONSTRAINT fee_events_hwm_monotonic CHECK (hwm_after_ray >= hwm_before_ray),
    -- Idempotent replay / reorg-safe re-index: the same log inserts once (R14 key).
    CONSTRAINT fee_events_network_tx_log_uniq UNIQUE (network_id, tx_hash, log_index)
);
-- Dashboard/reconstruction access paths: per-vault time series, per-recipient revenue,
-- and period bucketing all pre-filter on network_id (R14).
CREATE INDEX fee_events_vault_block_idx ON fee_events (network_id, vault_address, block_number);
CREATE INDEX fee_events_recipient_idx   ON fee_events (network_id, fee_recipient);
CREATE INDEX fee_events_block_time_idx  ON fee_events (network_id, block_time);

-- --- Indexer cursor (reuse sec.16 indexer_cursors from 0001) -------------------
-- The fee indexer tracks its replay progress in the existing indexer_cursors table
-- (no new cursor table needed). Seed the 'vault_fee' stream for the live 'base'
-- network so the first run resumes from a known floor; the indexer upserts it
-- thereafter. ON CONFLICT keeps this migration idempotent and never clobbers a live
-- cursor if 0002 is re-run.
INSERT INTO indexer_cursors (network_id, stream, last_processed_block)
VALUES ('base', 'vault_fee', 0)
ON CONFLICT (network_id, stream) DO NOTHING;
