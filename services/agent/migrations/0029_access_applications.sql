-- =============================================================================
-- 0029_access_applications.sql  -  Feature 026: alpha access applications
-- =============================================================================
-- Before this, a wallet that wasn't on the beta allowlist hit a DEAD END at /verify. Now it can
-- apply: one application per wallet, reviewed by an admin from /admin/allowlist. Approval is just
-- the existing `wallet_allowlist` add (this table never grants anything by itself) — so nothing
-- here is on the access path at read time, and nothing here is ever on the CUSTODY path: /exit,
-- /trust and the on-chain withdraw are never gated by any of this (N2).
--
-- Conventions mirror 0005_allowlists.sql: addresses stored LOWERCASE with a CHECK, an append-only
-- audit sibling, idempotent DDL. The three applicant fields are the client-decided set (contact
-- handle / name-or-alias / reason) and are length-capped in the DB as well as at the API, because a
-- cap that only exists in application code is a cap that eventually isn't there.
--
-- Additive + idempotent. Apply with PGCLIENTENCODING=UTF8 (the dev DB is SQL_ASCII).
-- =============================================================================

CREATE TABLE IF NOT EXISTS access_applications (
    address     text        PRIMARY KEY CHECK (address = lower(address)),
    -- One free-text contact handle: email, Telegram, X — the applicant picks (client decision).
    contact     text        NOT NULL CHECK (length(contact) BETWEEN 1 AND 200),
    -- Name or alias; an alias is fine, this is an alpha access request, not KYC.
    display_name text       NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    reason      text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
    status      text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    -- Last write of ANY kind (a re-submit by the applicant, or an admin decision).
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- The admin wallet that approved/denied (lowercase), NULL while pending.
    decided_by  text,
    decided_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_access_applications_status
    ON access_applications (status, submitted_at DESC);

-- Append-only audit of every application event. Deliberately a SEPARATE table from
-- `allowlist_audit`: that one's `action` CHECK is ('add','remove','seed') and its rows are about
-- ROLES. Widening it would rewrite the meaning of existing rows; this keeps both readable.
CREATE TABLE IF NOT EXISTS access_application_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('submit', 'approve', 'deny')),
    address text        NOT NULL,
    -- The applicant's own wallet for 'submit'; the deciding admin wallet for 'approve'/'deny'.
    actor   text,
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_application_audit_at
    ON access_application_audit (at DESC);
