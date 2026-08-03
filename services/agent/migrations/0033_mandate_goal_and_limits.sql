-- 0033_mandate_goal_and_limits.sql — feature 030: the mandate finally holds the things the
-- product asks users for. Additive, forward-only, reversible. Apply with PGCLIENTENCODING=UTF8.
--
-- WHY THESE COLUMNS EXIST. The mandate was collected in detail and read by almost nothing. Of
-- everything it captured, only `max_slippage_bps` genuinely functioned; `horizon_months` and
-- `drawdown_tolerance` were stored, displayed, and consulted by no decision the product makes.
-- Two gaps were worse than unused fields:
--
--   1. There was NO exposure limit anywhere in the schema — yet feature 029's advice boundary
--      tells users, in the assistant's own words, "set a mandate — how much you're willing to put
--      at risk". A user who followed that advice found four questions, none of which was the one
--      they had just been promised. The assistant was directing people at something that did not
--      exist.
--   2. "Reach a target — hit a specific amount" was offered as a goal, chosen, and stored as the
--      bare label 'Reach a target'. No amount, no date. Nothing in the product could ever tell
--      that user whether they were on track, because nothing knew what the target was.
--
-- EVERY COLUMN IS NULLABLE, AND THAT IS LOAD-BEARING. NULL means "the user never said", which is
-- a different fact from zero. A zero exposure limit would silently forbid every proposal for
-- every pre-030 user; a zero goal target would render "0% of $0.00". Callers MUST treat absence
-- as not-stated and fall back to pre-030 behaviour (FR-021).
--
-- NON-CUSTODY (Constitution N1/N3, Principle IV). Nothing here authorises anything. A mandate may
-- only NARROW what may be proposed; the deterministic policy layer re-checks every action
-- regardless, and the on-chain caps are untouched and continue to apply independently. In
-- particular `exposure_limit_*` is a PROPOSAL-TIME bound on what the user is shown — deliberately
-- NOT a second on-chain cap, because putting an advisory preference on the custody-critical path
-- would change the safety model for a preference.
--
-- `contribution` is an INTENT ONLY. It feeds projection and reminders. It creates no standing
-- authority, no recurring transfer, and no scheduled anything — the product holds no such power
-- and this migration does not create one. Copy that implies otherwise is a defect (FR-013).
--
-- `risk_tier_display` is the 1..5 tier the user actually chose. The existing `risk_tier` enum
-- (conservative|moderate|growth) stays the ONLY value the policy layer reads; this column exists
-- because three different scales were in play — onboarding showed 1..5, the server stored three
-- profiles, and the web mapped growth back to 4, so a user who deliberately picked 5 saw "5/5" in
-- their summary and "4/5" in Settings. Display-only, never consulted by the gate.
--
-- SQL_ASCII (standing constraint since 025/#125): every write to the two JSONB columns must
-- serialize with json.dumps(..., ensure_ascii=False). A goal label or protocol name containing a
-- curly quote or an em-dash is exactly the payload that breaks otherwise.
--
-- ORDERING — order-INSENSITIVE vs the 030 agent redeploy:
--   * pre-030 agent + these columns: never named by old code — a no-op.
--   * 030 agent + pre-0033 schema: reads catch UndefinedColumnError, warn once per process, and
--     degrade to pre-030 behaviour (no exposure limit, no goal target) rather than 500.
-- House default remains apply-before-redeploy. Standing yoyo gotcha: `yoyo apply --batch` applies
-- EVERY pending migration — check what else is queued before running it.
--
-- ROLLBACK:
--   ALTER TABLE mandates
--     DROP COLUMN IF EXISTS exposure_limit_usdc,
--     DROP COLUMN IF EXISTS exposure_limit_pct_bps,
--     DROP COLUMN IF EXISTS goal_target_usdc,
--     DROP COLUMN IF EXISTS goal_target_date,
--     DROP COLUMN IF EXISTS allowed_protocols,
--     DROP COLUMN IF EXISTS contribution,
--     DROP COLUMN IF EXISTS risk_tier_display;

ALTER TABLE mandates
    -- The most the user is willing to have at risk, in USDC base units (6 dp). Advisory:
    -- constrains what may be PROPOSED, never what the chain permits.
    ADD COLUMN IF NOT EXISTS exposure_limit_usdc    NUMERIC(38, 0) NULL
        CHECK (exposure_limit_usdc IS NULL OR exposure_limit_usdc > 0),
    -- The same limit as a share of wallet value, in basis points (2500 = 25%). Mutually
    -- exclusive with the absolute form; the API accepts one or the other, never both.
    ADD COLUMN IF NOT EXISTS exposure_limit_pct_bps INT NULL
        CHECK (exposure_limit_pct_bps IS NULL OR exposure_limit_pct_bps BETWEEN 1 AND 10000),
    -- Goal target amount, USDC base units. A target-seeking goal requires BOTH this and the date;
    -- the API refuses a half-specified goal rather than storing an unusable one.
    ADD COLUMN IF NOT EXISTS goal_target_usdc       NUMERIC(38, 0) NULL
        CHECK (goal_target_usdc IS NULL OR goal_target_usdc > 0),
    ADD COLUMN IF NOT EXISTS goal_target_date       DATE NULL,
    -- Protocols/assets the user is comfortable with, e.g. ["aave_v3"]. NULL = no preference
    -- stated = today's behaviour. Only ever NARROWS the allowlist (VR-M5).
    ADD COLUMN IF NOT EXISTS allowed_protocols      JSONB NULL,
    -- Stated contribution intent, e.g. {"amountUsdc": "200000000", "cadence": "monthly"}.
    -- Projection and reminders ONLY — see the note above.
    ADD COLUMN IF NOT EXISTS contribution           JSONB NULL,
    -- The 1..5 tier the user chose. Display-only; `risk_tier` remains the policy vocabulary.
    ADD COLUMN IF NOT EXISTS risk_tier_display      SMALLINT NULL
        CHECK (risk_tier_display IS NULL OR risk_tier_display BETWEEN 1 AND 5);
