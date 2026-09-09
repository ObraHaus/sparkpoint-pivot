-- 024 T014 — retire the mock-backed demo wrapper in the 0016 tables (Base Sepolia, 84532).
--
-- Companion to `vault-registry-row.sql`. Same rationale for being a committed ops SQL file rather
-- than a yoyo migration: this is DATA in an already-applied schema, and 0016's tables are edited by
-- an operator or the admin API, never by a request handler on its own initiative.
--
-- Run once, by an operator:
--   PGCLIENTENCODING=UTF8 psql "$DATABASE_URL" -f contracts/deployments/84532/retire-mock-wrapper-rows.sql
--
-- Idempotent: re-running is a no-op (the WHERE clauses only match rows not already in the target
-- state, and the note is appended only when it is not already present).
--
-- ── N2: THIS CANNOT BLOCK A WITHDRAWAL, AND THAT WAS VERIFIED BEFORE WRITING IT ──────────────────
-- Checked in the codebase, not assumed:
--   * The ONLY `WHERE ... status` predicate against `sparkpoint_wrappers` anywhere is the
--     promote-only guard `UPDATE ... SET status='live' WHERE ... status='pending'`
--     (db/vault_factory.py). Nothing filters reads on status.
--   * `list_wrappers()` selects every row unfiltered, so `GET /admin/vaults` still shows this one.
--   * The USER-FACING vault picker and the exit path read the STATIC address book
--     (`packages/shared/src/addresses/baseSepolia.ts`), not this table — so no value written here
--     can reach a withdrawal decision.
-- The status is therefore a display/authorization record only. Withdrawals stay permanently open,
-- as they have since the wrapper was retired in Phase 0.

-- ── THE WRAPPER-STATUS HALF IS DELIBERATELY NOT HERE ────────────────────────────────────────────
-- T014 asks for the `sparkpoint_wrappers` row to carry "a retired status". **0016's schema has no
-- such value.** Verified against the live constraint, not assumed:
--
--   sparkpoint_wrappers_status_check => CHECK (status = ANY (ARRAY['pending','live']))
--
-- Attempting it raises CheckViolationError and rolls back — which is the schema behaving correctly,
-- and is why this file no longer tries. Widening that CHECK is a SCHEMA migration against the shared
-- develop database, a materially bigger step than the data writes here, so it is left as an explicit
-- operator decision rather than smuggled into an ops script.
--
-- **The retirement is already durably recorded, in the table that supersedes this one.** Migration
-- 0026 states it outright: "`status = 'redeem_only'` is the durable form of a RETIRED vault", and
-- `vault_registry` already carries this wrapper as `redeem_only`. So the fact is on record; only
-- 0016's older provenance row still says 'live', and nothing reads that field for an authorization
-- decision (the sole status predicate in the codebase is the promote-only `WHERE status='pending'`).

BEGIN;

-- ── the MOCK in the curated allowlist: revoked ──────────────────────────────────────────────────
-- `allowed = false` MUST pair with `status = 'revoked'`: db/vault_factory.py derives exactly that
-- pairing (`status = "allowlisted" if allowed else "revoked"`), so writing one without the other
-- would leave a row the application's own writer could never produce.
--
-- This blocks the mock from being wrapped by a FUTURE deploy. It can never affect the wrapper that
-- already exists — that binding is immutable on-chain (N2), which is precisely why the wrapper had
-- to be retired rather than repaired.
UPDATE morpho_curated_allowlist
   SET allowed       = false,
       status        = 'revoked',
       updated_at    = now(),
       vetting_notes = coalesce(vetting_notes, '') ||
         ' || REVOKED 2026-07-31 (024 T014). This is a TESTNET DEMO MOCK, not a Morpho vault: its ' ||
         'simulation hooks are external with no access control, so any caller can move the share ' ||
         'price or drain withdrawable liquidity. MUST NOT be admitted on any chain. Superseded by ' ||
         'the real Morpho Vault V2 Fee Wrapper 0x756c41dd33481620ebcb0357f759d31c9ee72170, created ' ||
         'by Morpho''s own VaultV2Factory. Revoking blocks FUTURE wrapper deploys over this target ' ||
         'only; the already-deployed wrapper''s binding is a constructor immutable and is unaffected.'
 WHERE chain_id = 84532
   AND morpho_vault = lower('0x7f377fe96DaD2eEa494F0fb095233EF4aB438420')
   AND (allowed IS DISTINCT FROM false OR status IS DISTINCT FROM 'revoked');

COMMIT;
