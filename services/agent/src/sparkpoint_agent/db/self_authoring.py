"""034 — persistence for Sparky's daily self-authoring (migration 0035).

Five tables behind one store: settings (+ its audit trail), runs, evidence, documents and findings.

FAIL-OPEN, INCLUDING AGAINST ITS OWN MIGRATION. Every read degrades to "the feature is off" when
migration 0035 has not been applied, logging once per process so a systematic failure is visible in
the logs rather than looking like an idle feature. That pattern is the lesson from the 025 hotfix,
where a fail-open sink hid a 100%-reproducible write failure for days.

WRITES ARE NOT FAIL-OPEN IN THE SAME WAY. A settings write that silently did nothing would leave an
admin believing they had restricted what Sparky reads when they had not — so writes raise, and the
API turns that into an error the admin can see.

SQL_ASCII: every jsonb parameter goes through `_json()`, which passes `ensure_ascii=False`. The
develop database rejects `\\uXXXX` escapes above ASCII, and this project has found that bug five
times; `tests/db/test_jsonb_encoding_guard.py` now enforces the rule across the whole data layer.

NON-CUSTODY (N1/N2/N3): text and configuration only. No key, no signature, no amount, no address.
Nothing here is read by the policy gate or by anything on the withdraw/exit path.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from asyncpg.exceptions import UndefinedColumnError, UndefinedTableError

from ..selfauthor.settings import SelfAuthorSettings, from_row
from .pool import Database

logger = logging.getLogger(__name__)

_warned_missing = False


def _json(value: Any) -> str:
    """jsonb parameter encoding. `ensure_ascii=False` is MANDATORY on this database."""
    return json.dumps(value, ensure_ascii=False)


def _warn_missing_once(where: str) -> None:
    global _warned_missing
    if not _warned_missing:
        _warned_missing = True
        logger.warning(
            "self_authoring_schema_missing at %s — migration 0035 is not applied; the feature is "
            "disabled and everything else is unaffected",
            where,
        )


@dataclass(frozen=True)
class RunRow:
    id: int
    trigger: str
    started_at: Any
    finished_at: Any
    outcome: str | None
    detail: str | None
    stats: dict[str, Any]


@dataclass(frozen=True)
class DocumentRow:
    slug: str
    title: str
    markdown: str
    status: str
    claims: list[dict[str, Any]]
    first_written_at: Any
    updated_at: Any
    published_at: Any
    edited_by_admin: bool


@dataclass(frozen=True)
class FindingRow:
    id: int
    topic: str
    summary: str
    status: str
    created_at: Any


def _as_obj(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


class SelfAuthoringStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    # ── settings ────────────────────────────────────────────────────────────

    async def get_settings(self) -> SelfAuthorSettings:
        """Current settings, or the cautious defaults if anything is wrong.

        Read at the start of every run and never cached in the process, which is what makes FR-022
        true: an admin's change takes effect on the next run without a redeploy.
        """
        try:
            row = await self._db.fetchrow(
                "SELECT enabled, publish_mode, draft_window_hours, allowed_data_sources, "
                "allowed_prose_domains FROM self_authoring_settings WHERE id = 1"
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("get_settings")
            return from_row(None)
        except Exception:  # noqa: BLE001 — a degraded database must not enable anything
            logger.warning("self_authoring_settings_read_failed; using the disabled defaults")
            return from_row(None)
        return from_row(row)

    async def put_settings(self, settings: SelfAuthorSettings, *, actor: str | None) -> None:
        """Persist settings and record the change.

        The before/after snapshots are stored whole rather than as a diff: "which sources was Sparky
        reading in March" has to be answerable, and a diff of a two-element array is harder to read
        a year later than the two arrays.
        """
        before = await self.get_settings()
        async with self._db.acquire() as conn, conn.transaction():
            await conn.execute(
                "UPDATE self_authoring_settings SET enabled = $1, publish_mode = $2, "
                "draft_window_hours = $3, allowed_data_sources = $4, allowed_prose_domains = $5, "
                "updated_at = now(), updated_by = $6 WHERE id = 1",
                settings.enabled,
                settings.publish_mode,
                settings.draft_window_hours,
                list(settings.allowed_data_sources),
                list(settings.allowed_prose_domains),
                actor,
            )
            await conn.execute(
                "INSERT INTO self_authoring_settings_audit (changed_by, before, after) "
                "VALUES ($1, $2::jsonb, $3::jsonb)",
                actor,
                _json(_wire(before)),
                _json(_wire(settings)),
            )

    async def settings_updated(self) -> tuple[Any, str | None]:
        try:
            row = await self._db.fetchrow(
                "SELECT updated_at, updated_by FROM self_authoring_settings WHERE id = 1"
            )
        except Exception:  # noqa: BLE001
            return None, None
        return (row["updated_at"], row["updated_by"]) if row else (None, None)

    # ── runs ────────────────────────────────────────────────────────────────

    async def open_run(self, *, trigger: str) -> int:
        row = await self._db.fetchrow(
            "INSERT INTO self_authoring_runs (trigger) VALUES ($1) RETURNING id", trigger
        )
        if row is None:  # pragma: no cover — an INSERT ... RETURNING that yields nothing
            raise RuntimeError("could not open a self-authoring run")
        return int(row["id"])

    async def close_run(
        self, run_id: int, *, outcome: str, detail: str = "", stats: dict[str, Any] | None = None
    ) -> None:
        await self._db.execute(
            "UPDATE self_authoring_runs SET finished_at = now(), outcome = $2, detail = $3, "
            "stats = $4::jsonb WHERE id = $1",
            run_id,
            outcome,
            detail[:2000],
            _json(stats or {}),
        )

    async def close_orphaned_runs(self, *, older_than_minutes: int = 30) -> int:
        """Close out runs whose process died mid-flight.

        A run that is interrupted — a deploy's container swap, a crash, a kill — leaves
        `finished_at` NULL forever, and the console renders that as "Running…". So a DEAD run is
        indistinguishable from a live one, permanently. Observed on run 5: the container was
        replaced mid-run, the row stayed open, and the next run took the lock immediately and
        finished in under a minute while the console still showed the first one in progress.

        Only rows older than `older_than_minutes` are touched. A genuinely in-flight run is bounded
        by the LLM retry budget (~60s per document, six documents), so half an hour is far outside
        it — and the margin means a second process booting can never close a live run.
        """
        try:
            result = await self._db.execute(
                "UPDATE self_authoring_runs SET finished_at = now(), outcome = 'error', "
                "detail = 'interrupted — the process ended before this run finished' "
                "WHERE finished_at IS NULL "
                "AND started_at < now() - ($1 || ' minutes')::interval",
                str(older_than_minutes),
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("close_orphaned_runs")
            return 0
        except Exception:  # noqa: BLE001 — housekeeping must never block a boot
            logger.warning("self_authoring_orphan_sweep_failed")
            return 0
        try:
            closed = int(str(result).rsplit(" ", 1)[-1])
        except ValueError:
            closed = 0
        if closed:
            logger.warning(
                "self_authoring_orphaned_runs_closed count=%d — a previous run was interrupted "
                "(deploy, restart or crash) and had been showing as still running",
                closed,
            )
        return closed

    async def last_successful_start(self) -> Any:
        """When a run last STARTED successfully — the schedule's clock.

        Started, not finished: a run that crashed halfway still consumed its budget and its rate
        limits, so retrying it immediately would be worse than waiting for tomorrow.
        """
        try:
            row = await self._db.fetchrow(
                "SELECT started_at FROM self_authoring_runs "
                "WHERE outcome IS NOT NULL "
                "AND outcome NOT IN ('skipped_locked', 'skipped_disabled') "
                "ORDER BY started_at DESC LIMIT 1"
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("last_successful_start")
            return None
        return row["started_at"] if row else None

    async def list_runs(self, limit: int = 20) -> list[RunRow]:
        try:
            rows = await self._db.fetch(
                "SELECT id, trigger, started_at, finished_at, outcome, detail, stats "
                "FROM self_authoring_runs ORDER BY started_at DESC LIMIT $1",
                limit,
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("list_runs")
            return []
        return [
            RunRow(
                id=int(r["id"]),
                trigger=str(r["trigger"]),
                started_at=r["started_at"],
                finished_at=r["finished_at"],
                outcome=r["outcome"],
                detail=r["detail"],
                stats=_as_obj(r["stats"], {}),
            )
            for r in rows
        ]

    # ── evidence ────────────────────────────────────────────────────────────

    async def record_evidence(
        self,
        run_id: int,
        *,
        source: str,
        label: str,
        value: Decimal | None = None,
        quote: str | None = None,
        chain_id: int | None = None,
        url: str | None = None,
        attribution: str | None = None,
        status: str = "ok",
        payload: dict[str, Any] | None = None,
    ) -> None:
        """One fetched fact — INCLUDING a refusal.

        A refused fetch is recorded rather than silently absent: that is the difference between
        "we didn't look" and "we were not allowed to look", and only one of those is a
        configuration problem an admin needs to see.
        """
        await self._db.execute(
            "INSERT INTO self_authoring_evidence "
            "(run_id, source, label, value, quote, chain_id, url, attribution, status, payload) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
            run_id,
            source,
            label,
            value,
            quote,
            chain_id,
            url,
            attribution,
            status,
            _json(payload or {}),
        )

    async def evidence_labels_since(self, run_id: int) -> set[str]:
        try:
            rows = await self._db.fetch(
                "SELECT DISTINCT label FROM self_authoring_evidence "
                "WHERE run_id = $1 AND status = 'ok'",
                run_id,
            )
        except Exception:  # noqa: BLE001
            return set()
        return {str(r["label"]) for r in rows}

    async def previous_figures(self, before_run_id: int) -> dict[str, Decimal]:
        """The last run's figures, for deciding whether anything materially changed.

        Compared against EVIDENCE rather than against the previous document text: the text is a
        rendering of the evidence, so comparing evidence is the honest comparison and it does not
        mistake a reworded sentence for a changed rate.
        """
        try:
            rows = await self._db.fetch(
                "SELECT DISTINCT ON (label) label, value FROM self_authoring_evidence "
                "WHERE run_id < $1 AND status = 'ok' AND value IS NOT NULL "
                "ORDER BY label, run_id DESC",
                before_run_id,
            )
        except Exception:  # noqa: BLE001
            return {}
        return {str(r["label"]): Decimal(str(r["value"])) for r in rows}

    async def run_evidence(self, run_id: int, limit: int = 100) -> list[dict[str, Any]]:
        try:
            rows = await self._db.fetch(
                "SELECT source, label, value, quote, chain_id, url, attribution, status, "
                "fetched_at FROM self_authoring_evidence WHERE run_id = $1 ORDER BY id LIMIT $2",
                run_id,
                limit,
            )
        except Exception:  # noqa: BLE001
            return []
        return [
            {
                "source": r["source"],
                "label": r["label"],
                "value": None if r["value"] is None else str(r["value"]),
                "quote": r["quote"],
                "chainId": r["chain_id"],
                "url": r["url"],
                "attribution": r["attribution"],
                "status": r["status"],
                "fetchedAt": r["fetched_at"].isoformat() if r["fetched_at"] else None,
            }
            for r in rows
        ]

    # ── documents ───────────────────────────────────────────────────────────

    async def upsert_document(
        self,
        *,
        slug: str,
        title: str,
        markdown: str,
        claims: list[dict[str, Any]],
        run_id: int | None,
        status: str | None = None,
    ) -> None:
        """Write a document in place.

        `first_written_at` is preserved on conflict — the draft window is measured from the first
        write, so a document rewritten daily still leaves draft on schedule. `edited_by_admin` is
        cleared, because the run has now replaced whatever the admin wrote and the flag exists to
        report that, not to persist forever.
        """
        await self._db.execute(
            "INSERT INTO self_authoring_documents "
            "(slug, title, markdown, claims, last_run_id, status) "
            "VALUES ($1,$2,$3,$4::jsonb,$5,COALESCE($6,'draft')) "
            "ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, "
            "markdown = EXCLUDED.markdown, "
            "claims = EXCLUDED.claims, last_run_id = EXCLUDED.last_run_id, updated_at = now(), "
            "status = COALESCE($6, self_authoring_documents.status), edited_by_admin = false",
            slug,
            title,
            markdown,
            _json(claims),
            run_id,
            status,
        )

    async def set_document_fields(
        self,
        slug: str,
        *,
        title: str | None = None,
        markdown: str | None = None,
        status: str | None = None,
        by_admin: bool = False,
    ) -> bool:
        sets: list[str] = ["updated_at = now()"]
        args: list[Any] = [slug]
        if title is not None:
            args.append(title)
            sets.append(f"title = ${len(args)}")
        if markdown is not None:
            args.append(markdown)
            sets.append(f"markdown = ${len(args)}")
            if by_admin:
                sets.append("edited_by_admin = true")
        if status is not None:
            args.append(status)
            sets.append(f"status = ${len(args)}")
            if status == "published":
                sets.append("published_at = now()")
        # noqa justification: every fragment in `sets` is a literal written above — a column name
        # this module chose, never a caller's string. Values travel as $n parameters.
        query = f"UPDATE self_authoring_documents SET {', '.join(sets)} WHERE slug = $1"  # noqa: S608
        result = await self._db.execute(query, *args)
        return "UPDATE 1" in str(result)

    async def get_document(self, slug: str) -> DocumentRow | None:
        try:
            row = await self._db.fetchrow(
                "SELECT slug, title, markdown, status, claims, first_written_at, updated_at, "
                "published_at, edited_by_admin FROM self_authoring_documents WHERE slug = $1",
                slug,
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("get_document")
            return None
        return _document(row) if row else None

    async def list_documents(self) -> list[DocumentRow]:
        try:
            rows = await self._db.fetch(
                "SELECT slug, title, markdown, status, claims, first_written_at, updated_at, "
                "published_at, edited_by_admin FROM self_authoring_documents ORDER BY slug"
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("list_documents")
            return []
        return [_document(r) for r in rows]

    async def delete_document(self, slug: str) -> bool:
        result = await self._db.execute(
            "DELETE FROM self_authoring_documents WHERE slug = $1", slug
        )
        return "DELETE 1" in str(result)

    # ── findings ────────────────────────────────────────────────────────────

    async def record_finding(
        self, run_id: int | None, *, topic: str, summary: str, evidence: list[str]
    ) -> None:
        """Held by default. An unflattering finding is written, never dropped."""
        await self._db.execute(
            "INSERT INTO self_authoring_findings (run_id, topic, summary, evidence) "
            "VALUES ($1,$2,$3,$4::jsonb)",
            run_id,
            topic,
            summary[:2000],
            _json(evidence),
        )

    async def list_findings(self, limit: int = 50) -> list[FindingRow]:
        try:
            rows = await self._db.fetch(
                "SELECT id, topic, summary, status, created_at FROM self_authoring_findings "
                "ORDER BY (status = 'held') DESC, created_at DESC LIMIT $1",
                limit,
            )
        except (UndefinedTableError, UndefinedColumnError):
            _warn_missing_once("list_findings")
            return []
        return [
            FindingRow(
                id=int(r["id"]),
                topic=str(r["topic"]),
                summary=str(r["summary"]),
                status=str(r["status"]),
                created_at=r["created_at"],
            )
            for r in rows
        ]

    async def resolve_finding(self, finding_id: int, *, status: str, actor: str | None) -> bool:
        result = await self._db.execute(
            "UPDATE self_authoring_findings SET status = $2, "
            "resolved_at = CASE WHEN $2 = 'held' THEN NULL ELSE now() END, "
            "resolved_by = CASE WHEN $2 = 'held' THEN NULL ELSE $3 END WHERE id = $1",
            finding_id,
            status,
            actor,
        )
        return "UPDATE 1" in str(result)


def _document(row: Any) -> DocumentRow:
    return DocumentRow(
        slug=str(row["slug"]),
        title=str(row["title"]),
        markdown=str(row["markdown"]),
        status=str(row["status"]),
        claims=_as_obj(row["claims"], []),
        first_written_at=row["first_written_at"],
        updated_at=row["updated_at"],
        published_at=row["published_at"],
        edited_by_admin=bool(row["edited_by_admin"]),
    )


def _wire(settings: SelfAuthorSettings) -> dict[str, Any]:
    return {
        "enabled": settings.enabled,
        "publish_mode": settings.publish_mode,
        "draft_window_hours": settings.draft_window_hours,
        "allowed_data_sources": list(settings.allowed_data_sources),
        "allowed_prose_domains": list(settings.allowed_prose_domains),
    }
