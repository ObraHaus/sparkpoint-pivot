-- =============================================================================
-- 0013_persona_notes.sql  -  Sparky persona: admin overrides for the persona sections + audit
-- =============================================================================
-- The git-versioned persona_seed/*.md are the shipped CANON of Sparky's character (IDENTITY /
-- SOUL / VOICE / BOUNDARIES / EXAMPLES). This table holds LIVE ADMIN OVERRIDES authored via the
-- admin console — a row for a slug wins over the same-slug seed file when the persona is composed
-- into the literacy agent's SYSTEM prompt. Deleting the row reverts that section to the seed.
--
-- ISOLATION (deliberate): this is SEPARATE from knowledge_notes / memory_chunks. Persona is TRUSTED
-- system-prompt content, NOT the RAG corpus — it is never embedded, never vector-searched, and never
-- reaches the policy/action path. Keeping it in its own table (no memory_source enum, no vector
-- column) guarantees a persona edit can't pollute DeFi-concept grounding or the embedding space.
--
-- Audit: persona_audit is append-only; every mutating console call writes one row in the SAME
-- transaction as the change (mirrors knowledge_audit / allowlist_audit). ACCESS only — never custody.
-- =============================================================================

CREATE TABLE IF NOT EXISTS persona_notes (
    source     text        PRIMARY KEY,                                  -- persona slug (identity/soul/...)
    title      text        NOT NULL,
    markdown   text        NOT NULL,                                     -- full override markdown
    author     text,                                                     -- admin wallet
    git_sha    text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS persona_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('put', 'delete', 'reload')),
    source  text        NOT NULL,
    actor   text,        -- the admin wallet
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_audit_at ON persona_audit (at DESC);
