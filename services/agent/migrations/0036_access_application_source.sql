-- =============================================================================
-- 0036_access_application_source.sql  -  Feature 045: public (no-wallet) applications
-- =============================================================================
-- 026 gave a wallet that had already CONNECTED a way to apply (0029). That form is only reachable
-- after a SIWE sign-in, so the people it was built for — someone who has heard about the alpha and
-- wants in — could never see it: they have no reason to connect a wallet to a product they cannot
-- use yet, and connecting only to be told "no" is a dead end with extra steps.
--
-- 045 adds a PUBLIC form on the landing page: the applicant types their own address. That address
-- is therefore UNVERIFIED — nobody signed anything — and an admin approving one is granting beta to
-- an address whose owner did not prove control. That difference must be visible at review time, so
-- it is recorded on the row rather than inferred, and the admin panel labels it.
--
-- `source` defaults to 'wallet' so every existing row keeps its true meaning: those WERE
-- session-scoped and signature-backed. New public rows say so explicitly.
--
-- Additive + idempotent + order-insensitive: an old agent never reads the column, and a new agent
-- on the old schema fails only the public-application write (the /verify form and the admin list
-- keep working). Apply with PGCLIENTENCODING=UTF8 (the dev DB is SQL_ASCII).
-- =============================================================================

ALTER TABLE access_applications
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'wallet';

-- Added separately + guarded: ADD COLUMN IF NOT EXISTS is a no-op on re-run, but its inline CHECK
-- would not be, so the constraint is created on its own and only when absent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'access_applications_source_check'
    ) THEN
        ALTER TABLE access_applications
            ADD CONSTRAINT access_applications_source_check
            CHECK (source IN ('wallet', 'public'));
    END IF;
END
$$;

-- The audit sibling records the source of every SUBMIT event, including the ones the table itself
-- never keeps: a public submission for an address that already has a row is deliberately dropped
-- (first application wins — see db/access_applications.py), and the audit is the only place that
-- repeat attempt is visible at all.
ALTER TABLE access_application_audit
    ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_access_applications_source
    ON access_applications (source, submitted_at DESC);
