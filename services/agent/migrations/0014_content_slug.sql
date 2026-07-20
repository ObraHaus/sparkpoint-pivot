-- =============================================================================
-- 0014_content_slug.sql  -  Feature 006: a stable slug for repo-seeded changelog entries
-- =============================================================================
-- The in-app changelog gains a committed source (content_seed/whats-new.json) ingested at boot, so
-- one repo edit feeds the What's-New feed and travels in the PR diff. That needs a stable natural key
-- to UPSERT on (the bigserial id would duplicate on every redeploy). We add a nullable `slug` with a
-- PARTIAL unique index so admin-authored rows (slug IS NULL) coexist unaffected. No backfill, no
-- delete: existing rows keep slug NULL and render unchanged; the loader adopts a same-title legacy
-- row rather than duplicating it. ACCESS/content only -- never custody (N2).
-- =============================================================================

ALTER TABLE content_entries ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_entries_slug
    ON content_entries (slug) WHERE slug IS NOT NULL;
