-- =============================================================================
-- 0012_tip_source_kind.sql  -  Alpha: dedicated 'tip' member for the sidebar tip databank
-- =============================================================================
-- The sidebar tip widget's databank lives in the Obsidian corpus (memory_chunks) under a NEW
-- source_kind='tip', kept SEPARATE from 'knowledge' so a curated UI tip can NEVER surface in an
-- assistant RAG citation (the advisory retrieval SQL is scoped to source_kind='knowledge').
--
-- ADD VALUE commits in its OWN migration/transaction (PG12+: a new enum value cannot be USED in
-- the same transaction that adds it -- mirrors 0006_knowledge_enum.sql). Idempotent.
-- =============================================================================

ALTER TYPE memory_source ADD VALUE IF NOT EXISTS 'tip';
