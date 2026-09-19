-- =============================================================================
-- 0040_wrapper_whitelist.sql  -  Feature 049 v4.1.0: the admission mirror
-- =============================================================================
-- Spec 049 / constitution v4.1.0. Admission to the V3 factory is RBAC: the AI deployer admits a
-- curated child that becomes deployable after the on-chain cooldown (default 24h, admin-bounded
-- 1h–7d), the operator admin admits/deploys instantly and may release or cancel an entry, and the
-- factory enforces one wrapper per child. This table MIRRORS that lifecycle off-chain so the admin
-- panel can show a queue with a countdown and the runner can be offered unwrapped candidates.
--
-- ⚠️ This table is a RECORD, never an authority:
--   * No row grants any on-chain power. `by_address` and `ready_at` are what the chain says
--     (`whitelistOf(child).by` / `.readyAt`), reported after the fact; the factory remains the only
--     admission gate (and `wrapperOf` the only one-wrapper-per-child gate).
--   * `status` is the agent's bookkeeping: pending (admitted, not deployed) | deployed | cancelled |
--     failed. A candidate is offered because the CURATED row is approved and unwrapped — never
--     because a row here says so.
--
-- Additive, idempotent. Apply with PGCLIENTENCODING=UTF8. Reading the store fail-opens on an
-- unapplied DB (empty queue / no candidates), so an agent deployed ahead of this migration degrades
-- to "nothing to show" rather than 500-ing the admin panel.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wrapper_whitelist (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id       integer NOT NULL,
    -- The curated child vault (lowercase, mirrors curated_vaults.vault_address).
    child_address  text    NOT NULL,

    -- What the chain says after the whitelist tx: `whitelistOf(child).by` (lowercase).
    by_address     text,
    -- 0 = deployable immediately (every admin admission, and any AI entry after releaseNow);
    -- otherwise seconds since epoch at which the AI cooling-off window unlocks.
    ready_at       bigint  NOT NULL DEFAULT 0,

    -- Wrapper params (the factory's CreateVaultParams minus the child/salt), prefilled when the
    -- candidate is offered so the runner and the panel deploy with the same values.
    fee_bps        smallint NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 2000),
    per_user_cap   numeric(78, 0) NOT NULL,
    total_cap      numeric(78, 0) NOT NULL,
    vault_cap      numeric(78, 0) NOT NULL,
    name           text NOT NULL,
    symbol         text NOT NULL,
    label          text NOT NULL,

    -- Lifecycle: pending (admitted, not deployed) -> deployed | cancelled | failed.
    status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'deployed', 'cancelled', 'failed')),

    -- What happened: the whitelist tx, the deploy tx / proxy / CapRegistry, or the error. NULL
    -- until recorded; the agent never fabricates on-chain facts.
    tx_hash        text,
    proxy_address  text,
    cap_registry   text,
    error          text,
    runner_commit  text,
    recorded_by    text,
    reported_at    timestamptz,
    deployed_at    timestamptz,
    cancelled_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT wrapper_whitelist_child_lower CHECK (child_address = lower(child_address))
);

-- The panel's list (newest activity first, per chain).
CREATE INDEX IF NOT EXISTS wrapper_whitelist_chain_idx
    ON wrapper_whitelist (chain_id, status, updated_at DESC);

-- The latest-state-per-child lookups (candidate joins + report resolution).
CREATE INDEX IF NOT EXISTS wrapper_whitelist_child_idx
    ON wrapper_whitelist (chain_id, child_address, created_at DESC);
