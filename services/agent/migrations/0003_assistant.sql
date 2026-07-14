-- =============================================================================
-- 0003_assistant.sql  -  SparkPoint assistant onboarding + mandate schema (W6 US3)
-- =============================================================================
-- The OFFCHAIN product tables the §3.1 onboarding/mandate endpoints persist to:
--   * mandates            - E3 (data-model.md sec.5): the user's VERSIONED, immutable-
--                           per-version Risk Profile / Mandate, confirmed during chat
--                           onboarding and used to rank recommendations + constrain
--                           suggested actions (FR-002/003/004).
--   * onboarding_sessions - the chat-driven onboarding step-machine state (§3.1); a
--                           pre-confirmation scratchpad. The MANDATE ITSELF is never
--                           written here — it lands in `mandates` only when the user
--                           explicitly confirms via POST /mandate (FR-002).
--
-- Also finalizes the deferred `users.active_mandate_id` FK (0001 left it FK-less because
-- `mandates` did not yet exist) so the active-version pointer is now referentially sound.
--
-- NON-CUSTODY (N1/N2): this is OFFCHAIN product/UX data. Nothing here holds a key, gates
-- a signature, or sits on the withdrawal path. A mandate only NARROWS what the onchain
-- allowlist already permits (VR-M5) — it can never authorize a non-whitelisted
-- protocol/asset, and the deterministic policy layer re-checks every action regardless.
-- Losing all of Postgres degrades personalization but cannot move or trap funds.
--
-- R14 (multi-network wave rule, per the W6 task): the new tables carry
-- `network_id TEXT NOT NULL DEFAULT 'base'` (FK -> networks) so a mandate/onboarding
-- session is network-scoped as SparkPoint adds networks (Base live, Sui fast-follow).
--
-- Applied via yoyo (0001/0002 style); additive + idempotent-friendly, all-or-nothing in
-- one transaction. AUTHORED + SYNTAX-CHECKED ONLY — not applied to the live DB here.
-- =============================================================================

-- --- Enum types -------------------------------------------------------------
-- data-model.md sec.5 / sec.5.1 — mandate lifecycle + risk taxonomy. `risk_tier` uses
-- data-model's `moderate` middle tier (policy-schema §2.5 calls the policy-layer middle
-- tier `balanced`; the two are reconciled at the API boundary — see api/mandate.py). A
-- mandate risk_tier only ever NARROWS the onchain allowlist (VR-M5).
CREATE TYPE mandate_status AS ENUM ('draft', 'confirmed', 'superseded', 'archived');
CREATE TYPE risk_tier AS ENUM ('conservative', 'moderate', 'growth');
CREATE TYPE time_horizon AS ENUM ('short', 'medium', 'long');
CREATE TYPE liquidity_pref AS ENUM ('instant', 'flexible');

-- --- E3 mandates (data-model.md sec.5) — OFFCHAIN, VERSIONED, immutable-per-version ---
-- One row per mandate VERSION. Editing goals/risk forks a new `version` (never mutates a
-- confirmed row) so the exact ruleset that scored any historical recommendation is
-- preserved for provability (VR-M4). At most one `confirmed` row per user is the active
-- mandate (VR-M1), enforced by the partial unique index below and mirrored by
-- users.active_mandate_id.
--
-- Column mapping to the §3.1 wire mandate:
--   risk_tier          <- mandate.riskProfile            (conservative|moderate|growth)
--   max_slippage_bps   <- mandate.riskParams.maxSlippageBps  (policy takes min(this, hard ceiling) — VR-M3)
--   horizon_months     <- mandate.riskParams.horizonMonths
--   drawdown_tolerance <- mandate.riskParams.drawdownTolerance
--   goals              <- mandate.goals[]  (denormalized JSONB [{kind,label}] for the MVP
--                          wire round-trip; the normalized data-model sec.5 `goals` child
--                          table can be added later for RAG/analytics without a wire change)
--   risk_params        <- mandate.riskParams  (verbatim, so egress round-trips exactly)
--   summary_text       <- mandate.summaryText (rendered back for confirmation, FR-002)
CREATE TABLE mandates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),          -- UUIDv7 preferred app-side (sec.0); wire id is 'mnd_'||hex
    user_id            UUID NOT NULL REFERENCES users(id),
    network_id         TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    version            INT NOT NULL CHECK (version >= 1),                    -- monotonic per user
    status             mandate_status NOT NULL DEFAULT 'confirmed',
    risk_tier          risk_tier NOT NULL DEFAULT 'conservative',           -- launch defaults conservative (vault is conservative-only)
    risk_score         SMALLINT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),  -- 0..100 normalized from onboarding
    max_slippage_bps   INT NOT NULL CHECK (max_slippage_bps BETWEEN 0 AND 10000),         -- policy takes min(this, hard ceiling) (VR-M3)
    time_horizon       time_horizon NULL,                                   -- derived bucket of horizon_months
    horizon_months     INT NULL CHECK (horizon_months IS NULL OR horizon_months > 0),
    drawdown_tolerance TEXT NULL,                                           -- low | medium | high
    allowed_assets     TEXT[] NOT NULL DEFAULT ARRAY['USDC']::text[],       -- subset of {USDC,ETH}; never widens the onchain allowlist (VR-M5)
    liquidity_pref     liquidity_pref NULL,                                 -- withdraw-always honored regardless (N2)
    goals              JSONB NOT NULL DEFAULT '[]'::jsonb,                  -- [{kind,label}] (see mapping note)
    risk_params        JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- verbatim §3.1 riskParams for exact round-trip
    summary_text       TEXT NOT NULL,                                       -- human-readable mandate shown back for confirmation (FR-002)
    confirmed_at       TIMESTAMPTZ NULL,                                    -- set when the user confirms; required to be effective (VR-M2)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- (user_id, version) is unique — the monotonic version series per user (sec.5).
    CONSTRAINT mandates_user_version_uniq UNIQUE (user_id, version),
    -- VR-M2: a confirmed mandate MUST carry a confirmation timestamp to be effective.
    CONSTRAINT mandates_confirmed_has_ts CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);
CREATE INDEX mandates_user_idx ON mandates (user_id);
-- VR-M1: at most ONE confirmed (active) mandate per user; superseding is atomic with the
-- new insert inside one transaction (api/db/mandates.py updates old -> superseded first).
CREATE UNIQUE INDEX mandates_one_confirmed_per_user ON mandates (user_id) WHERE status = 'confirmed';

-- Finalize the deferred pointer from 0001: users.active_mandate_id -> the active version.
-- ON DELETE SET NULL keeps the user row if a mandate is ever hard-deleted (mandates are
-- normally superseded, never deleted).
ALTER TABLE users
    ADD CONSTRAINT users_active_mandate_fk
    FOREIGN KEY (active_mandate_id) REFERENCES mandates(id) ON DELETE SET NULL;

-- --- onboarding_sessions (§3.1 step machine) — pre-confirmation scratchpad ------
-- The chat-driven onboarding conversation state: the current step + the accumulated
-- selections the draft is derived from. This is NOT the mandate — no value here is
-- effective until the user confirms via POST /mandate (FR-002). `user_eoa` binds the
-- session to the owner EOA once known but carries NO FK (a session may precede any user
-- row, and it never gates custody). Ephemeral by nature; safe to prune.
CREATE TABLE onboarding_sessions (
    id           TEXT PRIMARY KEY,                                    -- server-issued 'onb_'||hex
    user_eoa     CITEXT NULL,                                         -- owner EOA once connected (no FK — see note)
    network_id   TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id),  -- R14
    current_step TEXT NOT NULL DEFAULT 'welcome',                     -- welcome|connect|experience|goals|timeline|risk_scenario|review
    selections   JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- accumulated answers the draft is derived from
    completed    BOOLEAN NOT NULL DEFAULT false,                      -- true once a mandate_draft was produced
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_sessions_user_idx ON onboarding_sessions (user_eoa);
