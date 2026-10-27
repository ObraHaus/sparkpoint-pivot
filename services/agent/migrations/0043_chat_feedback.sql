-- =============================================================================
-- 0043_chat_feedback.sql  -  061 A9: persist thumbs up/down on chat answers
-- =============================================================================
-- The chat already had a POST /chat/feedback seam, but its default sink dropped the signal and
-- no client ever called it. This is the durable store: one row per (wallet, message), so repeated
-- taps update the same row instead of inflating the record.
--
-- NON-CUSTODY (N1/N2/N3): advisory product telemetry ONLY. It carries a rating and an optional
-- free-text reason, never a key, signature, amount, or prompt. Nothing reads this table to decide
-- access, a proposal, a policy verdict, or anything on the withdraw/exit path. Losing it costs
-- product feedback, nothing else.
--
-- Order-insensitive both directions: an old agent never names the table; a new agent on an
-- unapplied DB fails only the feedback write, which the sink logs and swallows (fail-open).
-- ROLLBACK: DROP TABLE IF EXISTS chat_feedback;
-- Apply with PGCLIENTENCODING=UTF8.
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_feedback (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_eoa        CITEXT       NOT NULL,                 -- the verified X-Owner (session-derived)
    conversation_id TEXT         NOT NULL,                 -- wire conversation id (may be ephemeral on a failed turn)
    message_id      TEXT         NOT NULL,                 -- stable per-answer id chosen by the client
    rating          TEXT         NOT NULL CHECK (rating IN ('up', 'down')),
    reason          TEXT         CHECK (reason IS NULL OR length(reason) <= 1000),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Idempotent per user+message: a second tap, or a retry of the same request, updates this row.
    CONSTRAINT chat_feedback_user_message_uniq UNIQUE (user_eoa, message_id)
);

CREATE INDEX IF NOT EXISTS chat_feedback_user_idx ON chat_feedback (user_eoa, updated_at DESC);
