-- 0022_recommendations.sql — feature 020 US5 per-advice attribution: persist a durable recommendation
-- snapshot so an acted-on recommendation can be linked to its realized on-chain outcome (FR-039/040/041,
-- SC-010). Mirrors data-model.md §7 (E7), simplified to the MVP snapshot + lifecycle. Additive,
-- forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY (Constitution N1/N2/N3/N5): this is an OFF-CHAIN advice index, never a signing input,
-- never a fund path, never on the withdraw/exit path (N2). It holds NO key and NO signature — only the
-- advice snapshot, the lifecycle status, and (via the reused 0021 columns) the public link ids. Losing
-- this table degrades attribution, never custody. The attribution CHAIN reuses columns already created
-- by 0021 (intent_bundles.recommendation_id, executions.attribution_method) — this migration adds only
-- the recommendations table. Outcomes are computed LIVE from chain (no outcome_logs table).

-- ── Enum (guarded: CREATE TYPE has no IF NOT EXISTS) ─────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE recommendation_status AS ENUM ('surfaced', 'acted', 'executed', 'declined', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── recommendations — the durable advice snapshot (OFFCHAIN attribution anchor) ──────────────────
CREATE TABLE IF NOT EXISTS recommendations (
    id              UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),  -- = the wire recId
    wallet          CITEXT                 NOT NULL,                               -- surfaced to / acted on
    dedupe_key      TEXT                   NOT NULL,                               -- sha256(wallet|kind|action|policy_ver)
    strategy_kind   TEXT                   NOT NULL,                               -- e.g. vault_deposit
    title           TEXT                   NOT NULL,
    rationale       TEXT                   NOT NULL DEFAULT '',                    -- '' for a build-time minimal rec
    proposed_action JSONB                  NOT NULL,                              -- the ProposedAction snapshot
    rank            SMALLINT,                                                      -- null for a minimal rec
    mandate_version TEXT,                                                          -- the scored-against mandate version
    policy_version  TEXT                   NOT NULL,
    status          recommendation_status  NOT NULL DEFAULT 'surfaced',
    created_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
    -- One durable record per distinct piece of advice (FR-002): re-surfacing upserts by content.
    CONSTRAINT recommendations_dedupe_uniq UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS recommendations_wallet_idx ON recommendations (wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendations_status_idx ON recommendations (wallet, status);
