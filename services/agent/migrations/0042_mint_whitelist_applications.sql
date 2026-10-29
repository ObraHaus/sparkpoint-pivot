-- =============================================================================
-- 0042_mint_whitelist_applications.sql  -  Sparky Broker mint whitelist
-- =============================================================================
-- The Sparky Broker collection (5,555 on Robinhood Chain, minted through OpenSea/SeaDrop) opens
-- with staged allowlists: Treasury, then GTD, then FCFS, then Public. A wallet on the GTD/FCFS
-- allowlists mints earlier and at a capped price, which is the whole reason a public application
-- form exists: collect the wallets, hand the list to the SeaDrop allowlist, and the applicant's
-- spot is guaranteed.
--
-- This is deliberately a SEPARATE table from 0029's `access_applications`:
--
--   * Those rows are about ACCESS to the app, and approving one grants the `beta` role. A mint
--     whitelist request grants an on-chain allowlist spot, not app access, and the two decisions
--     are made by different people with different tooling. Reusing the table would have forced a
--     `program` column and a composite primary key onto rows whose meaning is already fixed.
--   * A wallet may legitimately do BOTH (it is already in the beta and wants a Broker), so the
--     address cannot be a shared primary key.
--
-- The shape mirrors 0029/0036: lowercase-address primary key with a `address = lower(address)`
-- CHECK, the same three client-decided fields (contact / name-or-alias / reason) with DB-level
-- length CHECKs, and an append-only audit sibling. There is NO status column: nothing here is
-- approved in-app — the operator exports the addresses and uploads them to the SeaDrop allowlist,
-- so a `status` flip here would immediately be a lie. First submission per address wins
-- (`ON CONFLICT DO NOTHING`): the endpoint is public and anyone can type anyone's address, so a
-- write that could modify an existing row would let a stranger overwrite a real applicant's
-- contact details.
--
-- A record, never an authority, and never on the access or custody path (N2) — the beta gate and
-- every withdrawal surface are untouched by this table.
--
-- Additive + idempotent. Apply with PGCLIENTENCODING=UTF8 (the dev DB is SQL_ASCII).
-- =============================================================================

CREATE TABLE IF NOT EXISTS mint_whitelist_applications (
    address     text        PRIMARY KEY CHECK (address = lower(address)),
    -- One free-text contact handle: email, Telegram, X — the applicant picks.
    contact     text        NOT NULL CHECK (length(contact) BETWEEN 1 AND 200),
    -- Name or alias; an alias is fine, this is a mint whitelist request, not KYC.
    display_name text       NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    reason      text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
    submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mint_whitelist_applications_submitted
    ON mint_whitelist_applications (submitted_at DESC);

-- Append-only audit of every submission, including the ones the table itself never keeps: a repeat
-- submission for an address that already has a row is deliberately dropped, so this table is the
-- ONLY place that attempt is visible at all.
CREATE TABLE IF NOT EXISTS mint_whitelist_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('submit')),
    address text        NOT NULL,
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mint_whitelist_audit_at
    ON mint_whitelist_audit (at DESC);
