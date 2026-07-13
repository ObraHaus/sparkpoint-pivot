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

__all__ = [
    "EMBEDDING_DIM",
    "EMBEDDING_MODEL_VERSION",
    "Embedder",
    "Embedding",
    "EmbeddingBackend",
    "EmbeddingDimensionError",
    "assert_backend_matches_pin",
    "stub_embedder",
]
