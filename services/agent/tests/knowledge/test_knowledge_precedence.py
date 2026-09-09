# ruff: noqa: S101
"""§R2 precedence: a seed re-ingest must NOT clobber an admin-edited note of the same slug.

The admin console records admin-owned slugs; a re-ingest passes them as ``skip_sources`` so
``ingest_directory`` walks past the shipped seed file and leaves the admin note's chunks intact.
This exercises that seam with the in-memory store + stub embedder (no DB, no embedding API).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from sparkpoint_agent.knowledge import Embedder, ingest_directory, ingest_note, source_uuid


def _write_seed(dir_path: Path, slug: str, body: str) -> None:
    (dir_path / f"{slug}.md").write_text(f"# {slug}\n\n{body}\n", encoding="utf-8")


@pytest.mark.asyncio
async def test_reingest_skips_admin_owned_slug(
    tmp_path: Path, store: Any, embedder: Embedder
) -> None:
    seed_dir = tmp_path / "seed"
    seed_dir.mkdir()
    _write_seed(seed_dir, "aave", "Aave is a lending protocol. Seed copy of the note.")
    _write_seed(seed_dir, "vault", "The vault is an ERC-4626 wrapper. Seed copy.")

    # Admin edits the 'aave' note through the console — its chunks now carry admin content.
    await ingest_note(
        "# aave\n\nAave is a lending protocol. ADMIN-EDITED authoritative copy.",
        source="aave",
        store=store,
        embedder=embedder,
    )
    aave_sid = source_uuid("aave")
    admin_chunk_ids = {rid for rid, row in store.rows.items() if row.source_id == aave_sid}
    assert admin_chunk_ids, "admin edit should have written at least one chunk"

    # Re-ingest the seed corpus, skipping the admin-owned slug (precedence).
    report = await ingest_directory(
        seed_dir, store=store, embedder=embedder, skip_sources={"aave"}
    )

    ingested = {r.source for r in report.results}
    assert ingested == {"vault"}, "the admin-owned 'aave' slug must be skipped"

    # The admin's chunks survive verbatim — the seed never overwrote them.
    surviving = {rid for rid, row in store.rows.items() if row.source_id == aave_sid}
    assert surviving == admin_chunk_ids
    assert any("ADMIN-EDITED" in row.content for row in store.rows.values())
    assert not any("Seed copy of the note" in row.content for row in store.rows.values())


@pytest.mark.asyncio
async def test_reingest_without_skip_does_overwrite(
    tmp_path: Path, store: Any, embedder: Embedder
) -> None:
    # Control: with no skip set, the seed re-ingest DOES replace the same-slug content.
    seed_dir = tmp_path / "seed"
    seed_dir.mkdir()
    _write_seed(seed_dir, "aave", "Aave is a lending protocol. Seed copy of the note.")

    await ingest_note(
        "# aave\n\nADMIN-EDITED authoritative copy.",
        source="aave",
        store=store,
        embedder=embedder,
    )
    await ingest_directory(seed_dir, store=store, embedder=embedder)

    assert any("Seed copy of the note" in row.content for row in store.rows.values())
    assert not any("ADMIN-EDITED" in row.content for row in store.rows.values())
