-- =============================================================================
-- 0010_conversations.sql  -  B1: per-wallet chat conversation history + turns
-- =============================================================================
-- Persists /chat conversations per user (keyed via the users table by owner EOA, the same
-- self-custodied signer the mandates use). A conversation is a titled thread; turns are the
-- ordered user/assistant messages. History is fed back (bounded) into run_chat for multi-turn
-- context, and the web sidebar reads it as real history nav.
--
-- OWNERSHIP (enforced in the API + FK): a conversation belongs to exactly one user; a session
-- wallet only ever sees/deletes its OWN conversations - admins do NOT get others' chats. ON DELETE
-- CASCADE from users/conversations keeps turns from orphaning. ACCESS/product only - never custody
-- (N2): losing all of this degrades chat memory but can never trap funds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT,                                          -- derived from the first user message
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()             -- bumped on each new turn (recency sort)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_turns (
    id              BIGSERIAL   PRIMARY KEY,
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    -- user: the raw message. assistant: a compact, content-free-of-CoT text summary of the turn
    -- (the streamed cards aren't re-serialized here - this is history/context, not a card store).
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation ON conversation_turns (conversation_id, id);
