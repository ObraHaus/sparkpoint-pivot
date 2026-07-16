-- =============================================================================
-- 0005_allowlists.sql  -  Phase B: DB-backed beta + admin wallet allowlists
-- =============================================================================
-- Server-enforced access control (Phase B, items 7-9). Two roles:
--   * 'beta'  — may enter the (app) shell routes.
--   * 'admin' — may open /admin + call admin APIs.
-- Seeded on agent boot from BETA_ALLOWLIST / ADMIN_ALLOWLIST (comma-separated addresses),
-- then managed via the admin panel (audit-logged writes through the agent service).
--
-- Addresses are stored LOWERCASE (compare case-insensitively; the app checksum-normalizes for
-- display). This is an ACCESS gate only — it never touches custody: /exit, /trust, and the
-- on-chain withdraw path are never gated by it (N2).
--
-- Applied via yoyo with the deploy batch (idempotent). Not applied to the live DB here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wallet_allowlist (
    address    text        NOT NULL CHECK (address = lower(address)),  -- lowercase 0x + 40 hex
    role       text        NOT NULL CHECK (role IN ('beta', 'admin')),
    added_by   text,                                                   -- lowercase admin addr | 'env-seed'
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (address, role)
);

CREATE INDEX IF NOT EXISTS idx_wallet_allowlist_role ON wallet_allowlist (role);

-- Append-only audit of every allowlist change (add/remove/seed) for provability.
CREATE TABLE IF NOT EXISTS allowlist_audit (
    id       bigserial   PRIMARY KEY,
    action   text        NOT NULL CHECK (action IN ('add', 'remove', 'seed')),
    address  text        NOT NULL,
    role     text        NOT NULL,
    actor    text,        -- the admin wallet that made the change, or 'env-seed'
    at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allowlist_audit_at ON allowlist_audit (at DESC);
