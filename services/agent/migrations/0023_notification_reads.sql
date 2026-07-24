-- 0023_notification_reads.sql — feature 021 in-app notifications: a per-user READ CURSOR for the
-- derived notification feed. The notifications themselves are NOT stored — they are computed LIVE
-- from already-indexed real data (vault Deposit/Withdraw flows, executions, recommendations), so
-- every notification is provable from chain/DB and never fabricated (Principle III). The only
-- net-new state a real unread badge needs is this one-row-per-wallet cursor. Additive, forward-only.
-- Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY (Constitution N1/N2/N3/N5): this holds NO key, NO signature, and NO fund authority —
-- only a per-wallet "last read" timestamp for an advisory read-only feed. It is never on the
-- withdraw/exit path (N2); losing it only resets the unread badge, never traps funds.

-- ── notification_reads — the per-wallet unread cursor (one row per wallet) ────────────────────────
-- Two-part cursor so unread is STABLE across re-reads: on-chain (flow/outcome) notifications are keyed
-- by BLOCK HEIGHT (an event at block <= last_read_block is read — height never changes for an event, so
-- a re-read can't re-flag it), while execution rows (which carry a real wall-clock time) key off
-- last_read_at. Advancing the cursor never regresses last_read_block (mark-read uses GREATEST).
CREATE TABLE IF NOT EXISTS notification_reads (
    wallet          CITEXT       PRIMARY KEY,               -- the connected EOA (lowercased on write)
    last_read_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),    -- execution rows at/after this are "unread"
    last_read_block BIGINT       NOT NULL DEFAULT 0,        -- on-chain events after this block are "unread"
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
