-- =============================================================================
-- 0039_wrapper_deployments.sql  -  Feature 049: wrapper deploy requests + results
-- =============================================================================
-- Spec 049 / constitution v4.0.0. The universal wrapper family deploys one BeaconProxy per
-- curated vault. Deployment is a deliberate, operator-visible act: an admin REQUESTS a wrapper
-- here, the keyless agent serves the request to a deterministic deploy runner (which holds the
-- scoped, deploy-only hot key), and the runner REPORTS the result back. The agent itself holds
-- no key and can never deploy anything — same posture as the curator's Run-now marker.
--
-- ⚠️ This table is a WORK QUEUE + RECORD, never an authority:
--   * No row grants any on-chain power. The on-chain gates are the factory's curated allowlist,
--     the deployer role, the fee cap and the caps bounds — all enforced in Solidity.
--   * A `requested` row is a request; the runner may fail it, and an admin may cancel it.
--   * `salt` is derived by the runner from the row id so a retried deploy is idempotent at the
--     CREATE2 level (the second attempt lands on the same predicted address).
--
-- Additive, idempotent. Apply with PGCLIENTENCODING=UTF8. Reading the store fail-opens on an
-- unapplied DB (empty queue / no rows), so an agent deployed ahead of this migration degrades
-- to "nothing to deploy" rather than 500-ing the admin panel.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wrapper_deployments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id       integer NOT NULL,
    -- The curated child vault this wrapper will be bound to (lowercase, mirrors curated_vaults).
    child_address  text    NOT NULL,

    -- Deployment parameters, exactly as the factory's CreateVaultParams expects.
    fee_bps        smallint NOT NULL CHECK (fee_bps BETWEEN 0 AND 2000),
    per_user_cap   numeric(78, 0) NOT NULL,
    total_cap      numeric(78, 0) NOT NULL,
    vault_cap      numeric(78, 0) NOT NULL,
    name           text NOT NULL,
    symbol         text NOT NULL,
    label          text NOT NULL,

    -- Lifecycle: requested -> deployed | failed | cancelled. A failed row keeps the error so the
    -- panel can explain it; a retry is a NEW request (the old row stays as history).
    status         text NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested', 'deployed', 'failed', 'cancelled')),
    requested_by   text,
    requested_at   timestamptz NOT NULL DEFAULT now(),

    -- What the runner reported (never fabricated by the agent: NULL until the runner says so).
    tx_hash        text,
    proxy_address  text,
    cap_registry   text,
    error          text,
    reported_at    timestamptz,
    runner_commit  text,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT wrapper_deployments_child_lower CHECK (child_address = lower(child_address))
);

-- The runner's poll: oldest pending first, per chain.
CREATE INDEX IF NOT EXISTS wrapper_deployments_pending_idx
    ON wrapper_deployments (chain_id, status, requested_at);

-- The panel's list.
CREATE INDEX IF NOT EXISTS wrapper_deployments_child_idx
    ON wrapper_deployments (chain_id, child_address, requested_at DESC);
