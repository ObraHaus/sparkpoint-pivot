"""knowledge/ — retrieval + embedding utilities for the operational-memory and
(future) Obsidian tiers.

NON-CUSTODY NOTE: nothing under knowledge/ is imported by policy/ (the policy
engine is LLM-free and retrieval-free; research.md §7 "Memory never feeds the
policy layer"). The shared pinned embedder lives here so both memory tiers stamp
the SAME embedding_model_version and never silently mix vector spaces.
"""

from __future__ import annotations

from .embeddings import (
    EMBEDDING_DIM,
    EMBEDDING_MODEL_VERSION,
    Embedder,
    Embedding,
    EmbeddingBackend,
    EmbeddingDimensionError,
    assert_backend_matches_pin,
    stub_embedder,
)
from .ingestion import (
    Chunk,
    CorpusReport,
    IngestResult,
    ParsedNote,
    Section,
    chunk_note,
    chunk_uuid,
    default_seed_dir,
    ingest_directory,
    ingest_note,
    parse_note,
    source_uuid,
)
from .retrieval import DEFAULT_K, CitationRetriever, KnowledgeRetriever
from .search import hit_to_citation, knowledge_search
from .store import (
    KNOWLEDGE_SOURCE_KIND,
    ChunkHit,
    ChunkRow,
    ChunkStore,
    PgChunkStore,
    SqlExecutor,
    to_vector_literal,
)

__all__ = [
    "DEFAULT_K",
    "EMBEDDING_DIM",
    "EMBEDDING_MODEL_VERSION",
    "KNOWLEDGE_SOURCE_KIND",
    "Chunk",
    "ChunkHit",
    "ChunkRow",
    "ChunkStore",
    "CitationRetriever",
    "CorpusReport",
    "Embedder",
    "Embedding",
    "EmbeddingBackend",
    "EmbeddingDimensionError",
    "IngestResult",
    "KnowledgeRetriever",
    "ParsedNote",
    "PgChunkStore",
    "Section",
    "SqlExecutor",
    "assert_backend_matches_pin",
    "chunk_note",
    "chunk_uuid",
    "default_seed_dir",
    "hit_to_citation",
    "ingest_directory",
    "ingest_note",
    "knowledge_search",
    "parse_note",
    "source_uuid",
    "stub_embedder",
    "to_vector_literal",
]
