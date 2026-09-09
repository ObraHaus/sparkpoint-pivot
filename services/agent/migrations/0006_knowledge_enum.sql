-- =============================================================================
-- 0006_knowledge_enum.sql  -  T123: dedicated 'knowledge' member for the Obsidian corpus
-- =============================================================================
-- Replaces the 'literacy_tip' shim (knowledge/store.py KNOWLEDGE_SOURCE_KIND) with a proper
-- source_kind. ADD VALUE commits in its OWN migration/transaction (PG12+ requirement: the new
-- enum value cannot be USED in the same transaction that adds it) -- the backfill that uses it is
-- the separate 0007 migration. Idempotent.
-- =============================================================================

ALTER TYPE memory_source ADD VALUE IF NOT EXISTS 'knowledge';
