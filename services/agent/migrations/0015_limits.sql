-- =============================================================================
-- 0015_limits.sql  -  Feature 008: per-wallet tier limits & priority compute
-- =============================================================================
-- A per-wallet limits engine for the AI assistant. Two seeded tiers:
--   * 'free'    - the default; fully capable, generous daily allowances.
--   * 'premium' - higher allowances + priority compute (granted by admin for launch).
--
-- This is an ADVISORY-COMPUTE gate only (chat / recommendations / onboarding). It NEVER
-- touches custody: /exit, /trust, the vault, and the on-chain withdraw path are never gated
-- by it (Constitution N2). Tier resolution fails closed to the DEFAULT (free) tier.
--
-- Addresses are stored LOWERCASE (compare case-insensitively; the app checksum-normalizes for
-- display), matching wallet_allowlist (0005). Every config mutation writes an append-only
-- limits_audit row in the same transaction (like allowlist_audit / gateway_audit).
--
-- Applied via yoyo with the deploy batch (idempotent; PGCLIENTENCODING=UTF8). Apply BEFORE the
-- agent boots (the boot seed is best-effort). Not applied to the live DB here.
-- =============================================================================

-- Admin-editable inclusion values per tier (seed-then-edit, like content_entries / persona_notes).
CREATE TABLE IF NOT EXISTS tier_definitions (
    tier                   text        NOT NULL PRIMARY KEY CHECK (tier = lower(tier)),
    display_name           text        NOT NULL,
    chat_daily_limit       int         NOT NULL,   -- assistant turns per window
    recs_daily_limit       int         NOT NULL,   -- recommendation runs per window
    onboarding_daily_limit int         NOT NULL,   -- onboarding turns per window
    concurrency            int         NOT NULL,   -- this tier's share of in-flight LLM slots
    priority_weight        int         NOT NULL,   -- higher = served first under contention
    model_alias            text        NOT NULL DEFAULT 'sparkpoint-chat',
    is_default             boolean     NOT NULL DEFAULT false,
    updated_by             text,                   -- lowercase admin addr | 'env-seed'
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Exactly one default tier (the fail-closed target).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tier_definitions_default
    ON tier_definitions (is_default) WHERE is_default;

-- Who is on which tier. Absence of a row => the default (free) tier. Mirrors wallet_allowlist.
CREATE TABLE IF NOT EXISTS wallet_tier (
    address     text        NOT NULL PRIMARY KEY CHECK (address = lower(address)),
    tier        text        NOT NULL REFERENCES tier_definitions (tier),
    source      text        NOT NULL CHECK (source IN ('admin', 'env-seed', 'srk')),
    assigned_by text,                                 -- lowercase admin addr | 'env-seed'
    assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tier_tier ON wallet_tier (tier);

-- Per-wallet, per-metric, per-window tally. Enforcement counter AND monitoring rollup source.
-- Carries NO message content. A new window is a new row (old windows age out).
CREATE TABLE IF NOT EXISTS usage_counters (
    address      text        NOT NULL CHECK (address = lower(address)),
    metric       text        NOT NULL CHECK (metric IN ('chat', 'recs', 'onboarding')),
    window_start timestamptz NOT NULL,               -- computed bucket (rolling-24h, Asia/Manila)
    count        int         NOT NULL DEFAULT 0,
    tier_at_use  text,                               -- tier resolved when the window opened
    PRIMARY KEY (address, metric, window_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_window ON usage_counters (window_start DESC);
CREATE INDEX IF NOT EXISTS idx_usage_counters_addr_window ON usage_counters (address, window_start DESC);

-- Append-only admit/deny/throttle decisions - the monitoring throttle/deny-rate feed.
-- subject is a MASKED wallet (6..4); detail carries counts only, NO secrets, NO prompt content.
CREATE TABLE IF NOT EXISTS limits_event (
    id      bigserial   PRIMARY KEY,
    verdict text        NOT NULL CHECK (verdict IN ('allow', 'deny', 'throttle')),
    metric  text        NOT NULL,
    tier    text        NOT NULL,
    subject text,                                     -- MASKED wallet (6..4)
    detail  jsonb       NOT NULL DEFAULT '{}'::jsonb, -- counts/limits only; NO secrets, NO content
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_limits_event_at ON limits_event (at DESC);

-- Append-only config-change + grant/revoke trail (like allowlist_audit / gateway_audit).
CREATE TABLE IF NOT EXISTS limits_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('tier_update', 'grant', 'revoke', 'seed')),
    subject text        NOT NULL,                     -- the tier name or the wallet acted on
    actor   text,                                     -- the admin wallet, or 'env-seed'
    detail  jsonb       NOT NULL DEFAULT '{}'::jsonb, -- old/new values for a tier_update; no secrets
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_limits_audit_at ON limits_audit (at DESC);

-- Seed the two launch tiers (idempotent). Free is the default and stays fully capable.
INSERT INTO tier_definitions
    (tier, display_name, chat_daily_limit, recs_daily_limit, onboarding_daily_limit,
     concurrency, priority_weight, model_alias, is_default, updated_by)
VALUES
    ('free',    'Free',    40,  10, 20, 1, 1, 'sparkpoint-chat', true,  'migration-0015'),
    ('premium', 'Premium', 400, 100, 40, 2, 3, 'sparkpoint-chat', false, 'migration-0015')
ON CONFLICT (tier) DO NOTHING;
