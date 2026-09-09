"""Ingestion runner (P2) — compose the PRODUCTION store + embedder and ingest the Obsidian
corpus into pgvector.

Run once (or after editing the corpus):

    python -m sparkpoint_agent.knowledge.ingest_cli            # ingests the shipped seed corpus
    SPARKPOINT_KNOWLEDGE_CORPUS=/path python -m sparkpoint_agent.knowledge.ingest_cli

Requires ``DATABASE_URL`` + ``EMBEDDING_OPENAI_*`` in the env. Idempotent: each chunk's id is a
deterministic UUID5 and stale chunks are pruned, so re-running re-embeds in place. This is a
one-shot maintenance script, NOT part of request serving — the agent never ingests on a request
path (N2: the data layer is a derived index, never on the withdraw/exit path).
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from ..db import get_database
from .embeddings import openai_embedder
from .ingestion import default_seed_dir, ingest_directory
from .store import PgChunkStore

logger = logging.getLogger("sparkpoint_agent.knowledge.ingest")

# Optional override for the corpus directory (defaults to the shipped seed corpus).
CORPUS_DIR_ENV = "SPARKPOINT_KNOWLEDGE_CORPUS"


async def run_ingestion(corpus_dir: str | os.PathLike[str] | None = None) -> dict[str, int]:
    """Ingest the corpus with the REAL embedder; return {sources, chunks_written, chunks_pruned}.

    Fails loudly if the embedding provider isn't configured — a real ingest must never fall back
    to the non-semantic stub (that would poison the shared pinned space with meaningless vectors).
    """
    embedder = openai_embedder()
    if embedder is None:
        raise RuntimeError(
            "EMBEDDING_OPENAI_* is not configured; refusing to ingest without a real embedder "
            "(the stub is non-semantic and must never reach the shared pinned space)."
        )

    if corpus_dir is not None:
        path: Path = Path(corpus_dir)
    elif os.getenv(CORPUS_DIR_ENV):
        path = Path(os.environ[CORPUS_DIR_ENV])
    else:
        path = default_seed_dir()

    db = get_database()
    await db.connect()
    try:
        store = PgChunkStore(db)
        report = await ingest_directory(path, store=store, embedder=embedder)
    finally:
        await db.disconnect()

    written = sum(r.written for r in report.results)
    pruned = sum(r.pruned for r in report.results)
    for r in report.results:
        logger.info("ingested source=%s written=%d pruned=%d", r.source, r.written, r.pruned)
    return {"sources": len(report.results), "chunks_written": written, "chunks_pruned": pruned}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    summary = asyncio.run(run_ingestion())
    logger.info(
        "ingestion complete: %d sources, %d chunks written, %d pruned",
        summary["sources"],
        summary["chunks_written"],
        summary["chunks_pruned"],
    )


if __name__ == "__main__":
    main()
