-- 0019_robinhood_network.sql — feature 014/013 (multi-network revenue): register the Robinhood
-- testnet (chainId 46630) as a distinct `networks` row so its swap-routing fees can be indexed +
-- reported PER-NETWORK, alongside Base. Before this, only 'base' existed, so `swap_fee_events`
-- (0018) could not hold 46630 rows (the `network_id` FK references `networks(id)`).
--
-- Additive + idempotent (`ON CONFLICT DO NOTHING`); NO data change to any existing row. Apply with
-- PGCLIENTENCODING=UTF8.
--
-- Non-custody (N2): DISPLAY/DERIVED-ONLY — this only lets the revenue dashboard attribute swap fees
-- to the right chain; nothing here is on the withdraw/redeem/exit path.

-- The Robinhood testnet network (46630). `live` = true (real swaps execute there); no vault (Base-only).
INSERT INTO networks (id, name, live, vm_kind, chain_ref)
VALUES ('robinhood', 'Robinhood Testnet', true, 'evm', '46630')
ON CONFLICT (id) DO NOTHING;

-- Seed the Robinhood swap-fee indexer cursor (reuses indexer_cursors from 0001). Starts at 0; the
-- indexer floors to the configured inception block on its first run.
INSERT INTO indexer_cursors (network_id, stream, last_processed_block)
VALUES ('robinhood', 'swap_fee', 0)
ON CONFLICT (network_id, stream) DO NOTHING;
