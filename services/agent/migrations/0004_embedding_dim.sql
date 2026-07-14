-- =============================================================================
-- 0004_embedding_dim.sql  -  reconcile memory_chunks.embedding to EMBEDDING_DIM
-- =============================================================================
-- 0001 pinned `memory_chunks.embedding` to a placeholder `vector(1536)`, but the
-- knowledge embedder (src/sparkpoint_agent/knowledge/embeddings.py) is the single
-- source of truth and pins EMBEDDING_MODEL_VERSION = "sparkpoint-embed-1024@…" with
-- EMBEDDING_DIM = 1024. A live ingest would send a 1024-dim vector into a
-- vector(1536) column and error at insert. Both dims are pre-Gate placeholders
-- (the hosted embedding provider is a deferred decision, research.md §7 OQ-5), so
-- the fix is CONSISTENCY: retype the column to match the embedder constant.
--
-- The table is EMPTY (Obsidian ingestion has not run yet), so this is a clean
-- forward alter — exactly the "alter this column in a NEW migration (never mix in
-- place)" path 0001's own note prescribes on a dimension change. On a future real
-- model change, bump EMBEDDING_MODEL_VERSION + re-embed + a new migration together.
--
-- Applied via yoyo with the 0002/0003 batch at deploy (idempotent; DROP/CREATE
-- INDEX IF (NOT) EXISTS). Not applied to the live DB here.
-- =============================================================================

-- Drop the ANN index (its opclass is bound to the column's current dimension),
-- retype to the pinned 1024-d space, then recreate the identical cosine HNSW index.
DROP INDEX IF EXISTS memory_chunks_embedding_hnsw;

ALTER TABLE memory_chunks
    ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw
    ON memory_chunks USING hnsw (embedding vector_cosine_ops);
