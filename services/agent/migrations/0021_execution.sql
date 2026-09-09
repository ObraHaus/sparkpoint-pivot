-- 0021_execution.sql — feature 019 US2 execution spine: persist the unsigned proposal
-- (intent_bundles), its mandatory pre-trade preview (simulation_results), and the submitted/confirmed
-- result over on-chain-derived truth (executions). Mirrors data-model.md §11 (E11) + §12 (E12) and
-- specs/019-us2-execution-spine/data-model.md. Additive, forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY (Constitution N1/N2/N3/N5): this is a DERIVED INDEX, never a signing input, never a fund
-- path, and never on the withdraw/exit path. It holds NO private key, NO signature, and NO signed
-- payload — only the *event* of having signed (tx_hash / userop_hash), which is authoritative on-chain
-- and re-derivable (VR-X1/VR-X6). intent_bundles.steps carry UNSIGNED calldata only; every recipient is
-- forced to the user (N1). A withdraw/redeem bundle is persisted even when paused/at-cap/stale/no-sim,
-- and no row here can gate a redemption (N2). Losing this table degrades attribution, never custody.
--
-- FK notes (data-model.md §11, research R5): recommendations/session_keys/users tables do NOT exist yet,
-- so recommendation_id/user_id are plain nullable UUID (no FK). intent_bundles <-> simulation_results is
-- a circular reference — both tables are created first, then the cross-FK is added via ALTER.

-- ── Enums (guarded: CREATE TYPE has no IF NOT EXISTS) ────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE policy_verdict AS ENUM (
        'approved', 'rejected', 'blocked_simulation', 'blocked_cap', 'blocked_slippage', 'blocked_allowlist'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE execution_status AS ENUM (
        'built', 'policy_rejected', 'declined', 'submitted', 'confirmed', 'indexed', 'reverted', 'dropped'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE action_kind AS ENUM ('deposit', 'withdraw', 'swap', 'rebalance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE signing_mode AS ENUM ('per_action_user_signature', 'session_key');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE attribution_method AS ENUM ('intent_log', 'heuristic_match');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── intent_bundles — the unsigned proposal (OFFCHAIN). id == the intent_action_id (US5 anchor). ──
CREATE TABLE IF NOT EXISTS intent_bundles (
    id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id     UUID,                                    -- plain (no FK): recommendations absent
    user_id               UUID,                                    -- plain (no FK)
    smart_account_address CITEXT         NOT NULL,                 -- connected owner (== account today)
    chain_id              BIGINT         NOT NULL,
    kind                  TEXT           NOT NULL,                 -- ActionType wire string
    steps                 JSONB          NOT NULL,                 -- ordered UNSIGNED steps; no signature ever
    policy_verdict        policy_verdict NOT NULL,
    policy_version        TEXT           NOT NULL,
    policy_reasons        JSONB          NOT NULL DEFAULT '[]'::jsonb,  -- [{code, message}]
    simulation_result_id  UUID,                                    -- cross-FK added below; required for approved (VR-X2, app-enforced)
    exec_mode             signing_mode   NOT NULL DEFAULT 'per_action_user_signature',
    expires_at            TIMESTAMPTZ    NOT NULL,
    is_session_key_path   BOOLEAN        NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intent_bundles_account_idx ON intent_bundles (smart_account_address, created_at DESC);
CREATE INDEX IF NOT EXISTS intent_bundles_rec_idx     ON intent_bundles (recommendation_id) WHERE recommendation_id IS NOT NULL;

-- ── simulation_results — the mandatory pre-trade preview (OFFCHAIN). ─────────────────────────────
CREATE TABLE IF NOT EXISTS simulation_results (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_bundle_id       UUID          NOT NULL REFERENCES intent_bundles(id) ON DELETE CASCADE,
    simulator              TEXT          NOT NULL,                 -- provider: viem_eth_call | anvil_fork
    sim_block              BIGINT        NOT NULL,                 -- freshness anchor (asOfBlock)
    will_revert            BOOLEAN       NOT NULL,
    revert_reason          TEXT,
    expected_out_raw       NUMERIC(78,0),                          -- sharesOut (deposit) / assetsOut (withdraw)
    expected_fees_raw      NUMERIC(78,0),
    price_impact_bps       INT,                                    -- swaps only
    estimated_slippage_bps INT,                                    -- swaps only
    balance_deltas         JSONB         NOT NULL DEFAULT '[]'::jsonb,
    passed                 BOOLEAN       NOT NULL,                 -- NOT will_revert (AND slippage ok)
    raw_sim_ref            TEXT,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS simulation_results_bundle_idx ON simulation_results (intent_bundle_id);

-- Resolve the circular reference now that both tables exist (guarded — ADD CONSTRAINT is not idempotent).
DO $$ BEGIN
    ALTER TABLE intent_bundles
        ADD CONSTRAINT intent_bundles_sim_fk
        FOREIGN KEY (simulation_result_id) REFERENCES simulation_results(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── executions — the result over ONCHAIN-DERIVED truth (append-mostly). ──────────────────────────
CREATE TABLE IF NOT EXISTS executions (
    id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_bundle_id     UUID             NOT NULL REFERENCES intent_bundles(id) ON DELETE CASCADE,
    smart_account_address CITEXT          NOT NULL,
    action_kind          action_kind      NOT NULL,
    signing_mode         signing_mode     NOT NULL DEFAULT 'per_action_user_signature',
    status               execution_status NOT NULL DEFAULT 'submitted',
    userop_hash          BYTEA,                                    -- null on eoa_call
    tx_hash              BYTEA,                                    -- the *event* of having signed (VR-X1)
    block_number         BIGINT,
    gas_used             NUMERIC(78,0),
    realized_amounts     JSONB,
    reverted_reason      TEXT,
    intent_log_action_id BYTEA,
    attribution_method   attribution_method,
    created_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
    -- Durable submit de-dup: one submitted execution per intent (research R6). A replayed submit
    -- returns the existing row rather than double-recording.
    CONSTRAINT executions_intent_uniq UNIQUE (intent_bundle_id)
);

CREATE INDEX IF NOT EXISTS executions_account_idx ON executions (smart_account_address, created_at DESC);
CREATE INDEX IF NOT EXISTS executions_tx_idx      ON executions (tx_hash) WHERE tx_hash IS NOT NULL;
