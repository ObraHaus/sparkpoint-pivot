-- 0032_swap_fee_swapper.sql — feature 028 (US3): per-user attribution for swap-fee events.
-- Additive, forward-only, reversible. Apply with PGCLIENTENCODING=UTF8.
--
-- WHY — swap_fee_events (0018) records the fee Transfer ROUTER → fee recipient, so its
-- from_address is the ROUTER (asserted at ingest), and the table carries NO per-user identity.
-- Feature 028 folds "you made a swap" into Sparky's memory, which needs exactly that identity.
-- The honest, bounded place to resolve it is INGEST: the indexer already touches each event
-- once and already holds an RPC transport, so one cached eth_getTransactionByHash per event
-- yields the tx SENDER — the wallet that signed the swap. Resolving at fold time instead would
-- be an RPC call per network event per user turn (unbounded, on the chat path). NULL = the
-- sender was not resolvable at ingest (RPC hiccup) or the row predates 0032 — those swaps are
-- simply never attributed (honest degrade; Constitution III: no guessed attribution).
--
-- ORDERING — order-insensitive vs the 028 agent redeploy, both directions:
--   * pre-028 indexer + this column: column never named — a no-op.
--   * 028 indexer + pre-0032 schema: the insert catches UndefinedColumnError, warns once
--     (swap_fee_swapper_column_missing), and falls back to the pre-0032 INSERT — fee ingestion
--     (the revenue dashboard's source) keeps working; only attribution is missing. The fold's
--     swap read likewise degrades to "source skipped". Pinned by tests.
--
-- NON-CUSTODY: an attribution label on an already-recorded fee event. No key material, no
-- authority; read by the memory fold only (prose/classifier boundary), never policy/build-tx.
--
-- ROLLBACK: ALTER TABLE swap_fee_events DROP COLUMN IF EXISTS swapper_address;
-- (attribution disappears; ingestion and the revenue dashboard are untouched)

-- One statement (yoyo step count 1). Lowercase enforced like every address column here.
ALTER TABLE swap_fee_events
    ADD COLUMN IF NOT EXISTS swapper_address TEXT
        CHECK (swapper_address IS NULL OR swapper_address = lower(swapper_address));
