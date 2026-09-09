-- =============================================================================
-- 0008_knowledge_notes.sql  -  R2: authoritative store for console-authored notes + audit
-- =============================================================================
-- The git-versioned knowledge_seed/*.md remain the shipped canon. This table is the AUTHORITATIVE
-- store for notes managed via the admin Obsidian console (the container FS is ephemeral and the
-- memory_chunks are lossy snippets — the full markdown lives here).
--
-- PRECEDENCE: `origin` records who owns a slug. A SEED re-ingest must NOT clobber a note whose row
-- here has origin='admin' (the console edit wins) — the ingest path checks this table first.
--
-- Audit: knowledge_audit is append-only; every mutating console call writes one row in the SAME
-- transaction as the change (mirrors allowlist_audit). ACCESS/knowledge only — never custody (N2).
-- =============================================================================

CREATE TABLE IF NOT EXISTS knowledge_notes (
    source     text        PRIMARY KEY,                                  -- note slug (== chunk source)
    title      text        NOT NULL,
    markdown   text        NOT NULL,                                     -- full authoritative markdown
    origin     text        NOT NULL CHECK (origin IN ('seed', 'admin')),
    author     text,                                                     -- admin wallet | 'seed'
    git_sha    text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('put', 'delete', 'reingest', 'seed')),
    source  text        NOT NULL,
    actor   text,        -- the admin wallet, or 'seed'
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_audit_at ON knowledge_audit (at DESC);
