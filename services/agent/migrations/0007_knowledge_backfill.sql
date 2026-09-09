-- =============================================================================
-- 0007_knowledge_backfill.sql  -  T123: migrate the corpus off the 'literacy_tip' shim
-- =============================================================================
-- Repoints the ingested Obsidian corpus onto the dedicated 'knowledge' member added in 0006.
-- memory_chunks rows are the GLOBAL corpus (user_id IS NULL); the literacy agent's on-the-fly
-- tips are generated live and are NOT stored here, so every 'literacy_tip' chunk is a knowledge
-- chunk. Separate migration from 0006 so the enum value is committed before it is used.
-- =============================================================================

UPDATE memory_chunks
SET source_kind = 'knowledge'
WHERE source_kind = 'literacy_tip' AND user_id IS NULL;
