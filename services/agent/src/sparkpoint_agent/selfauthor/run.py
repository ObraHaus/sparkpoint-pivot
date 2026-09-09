"""034 — the orchestrator: lock, fetch, write, verify, publish. Never raises.

THE ORDER IS THE DESIGN. Every step can only make the run produce *less*, never something worse:

    lock ─ settings ─ fetch ─ (nothing fetched? stop) ─ write ─ filter claims ─ SELF-CHECK ─ publish

The self-check sits between writing and publishing on purpose. A run stages its documents, re-asks
the five questions whose right answers we already know, and only then decides. If its own output
displaced one of them, the whole run is rolled back — not the offending document, the run. A
partially-published run is a corpus in a state nobody chose.

EVERY FAILURE ENDS IN "NO DOCUMENT WRITTEN", NEVER IN "A DEGRADED DOCUMENT WRITTEN". An unreachable
RPC, a dead model, a rate-limited feed, an unparseable response: all of them leave the previously
published documents exactly as they were, which is the correct outcome of an outage.

SILENCE IS THE COMMON OUTCOME. Most days nothing material changes, and a run that finds nothing new
refreshes its figures and writes no new claims. `no_change` and `no_evidence` are recorded as
successes; an enum that called them errors would train everyone to ignore the status line.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from ..db.self_authoring import SelfAuthoringStore
from .claims import Claim, Finding, filter_claims
from .documents import DOCUMENTS, has_what_it_needs, is_publishable_now, render_document
from .evidence import (
    SOURCE_ANSWER_GAPS,
    SOURCE_CHAIN,
    SOURCE_DEFILLAMA,
    SOURCE_MORPHO,
    SOURCE_OWN_CORPUS,
    Evidence,
)
from .selfcheck import CheckResult, run_check
from .settings import SelfAuthorSettings

logger = logging.getLogger(__name__)

#: Distinct from the notification poller's and the APY poller's keys.
RUN_LOCK_KEY = 0x5E1F_0034

OUTCOME_PUBLISHED = "published"
OUTCOME_NO_CHANGE = "no_change"
OUTCOME_NO_EVIDENCE = "no_evidence"
OUTCOME_BLOCKED = "blocked_selfcheck"
OUTCOME_LOCKED = "skipped_locked"
OUTCOME_DISABLED = "skipped_disabled"
OUTCOME_ERROR = "error"

#: A figure has to move by this much before it counts as news. Below it, the numbers are refreshed
#: and no new claim is written — rates wobble, and a note that says "the rate changed" every day
#: about a two-basis-point drift is noise that dilutes the corpus for nothing.
MATERIAL_CHANGE_BPS = Decimal("10")


@dataclass
class RunResult:
    outcome: str
    detail: str = ""
    stats: dict[str, Any] | None = None


def materially_changed(now: dict[str, Decimal], before: dict[str, Decimal]) -> bool:
    """Whether anything moved enough to be worth saying.

    Compared against the previous run's EVIDENCE, not against the previous document text: the text
    is a rendering of the evidence, so comparing evidence is the honest comparison and it cannot
    mistake a reworded sentence for a changed rate.
    """
    if not before:
        return True  # nothing to compare against — the first run always has something to say
    for label, value in now.items():
        prior = before.get(label)
        if prior is None:
            return True
        if abs(value - prior) >= MATERIAL_CHANGE_BPS:
            return True
    return False


async def gather_evidence(
    settings: SelfAuthorSettings, *, config: Any, db: Any, prose_urls: list[str] | None = None
) -> list[Evidence]:
    """Everything this run is allowed to read, in the order that costs least.

    A source not on the admin's list is not called at all. That is the difference between a filter
    and a permission: an unlisted source produces no request, not a discarded response.
    """
    from . import sources

    found: list[Evidence] = []
    if settings.allows(SOURCE_CHAIN):
        found += await sources.fetch_chain(config)
    if settings.allows(SOURCE_DEFILLAMA):
        found += await sources.fetch_defillama()
    if settings.allows(SOURCE_MORPHO):
        found += await sources.fetch_morpho()
    if settings.allows(SOURCE_OWN_CORPUS):
        found += await sources.fetch_own_corpus(db)
    if settings.allows(SOURCE_ANSWER_GAPS):
        found += await sources.fetch_answer_gaps(db)

    # Prose is governed by the DOMAIN list alone. An empty list fetches nothing — and the refusal
    # is still recorded, so an admin can see that a URL was asked for and declined.
    for url in prose_urls or []:
        found.append(await sources.fetch_prose(url, settings.allowed_prose_domains))
    return found


async def execute_run(
    *,
    store: SelfAuthoringStore,
    settings: SelfAuthorSettings,
    config: Any,
    db: Any,
    llm: Any,
    publish: Any,
    search: Any,
    trigger: str = "schedule",
    prose_urls: list[str] | None = None,
    now_epoch: float,
) -> RunResult:
    """One complete run. The caller holds the lock; this function never raises."""
    run_id = await store.open_run(trigger=trigger)
    stats: dict[str, Any] = {
        "evidenceOk": 0, "evidenceRefused": 0, "documentsWritten": 0, "claimsWithheld": 0,
    }

    try:
        evidence = await gather_evidence(settings, config=config, db=db, prose_urls=prose_urls)
        for item in evidence:
            await store.record_evidence(
                run_id,
                source=item.source,
                label=item.label,
                value=item.value,
                quote=item.quote,
                chain_id=item.chain_id,
                url=item.url,
                attribution=item.attribution,
                status=item.status,
                payload=item.payload,
            )
        usable = [e for e in evidence if e.publishable]
        stats["evidenceOk"] = len(usable)
        stats["evidenceRefused"] = sum(1 for e in evidence if e.status == "refused")

        if not usable:
            # Nothing fetched ⇒ nothing written. An outage produces no note rather than a stale one.
            result = RunResult(
                OUTCOME_NO_EVIDENCE, "no source could be read; nothing was written", stats
            )
            await store.close_run(run_id, outcome=result.outcome, detail=result.detail, stats=stats)
            return result

        figures = {e.label: e.value for e in usable if e.value is not None}
        previous = await store.previous_figures(run_id)

        # A document written while the model was unavailable carries its figures and no prose. On
        # its own, "nothing material changed" would then leave it degraded FOREVER — no future run
        # rewrites it until a rate happens to move. Observed exactly that: the free-model runs left
        # every document prose-less, and the next healthy run reported `no_change` and walked past
        # them. So a run also has news when it can repair something it previously failed to write.
        previous_docs = {d.slug: d for d in await store.list_documents()}
        degraded = [
            slug for slug, doc in previous_docs.items()
            if doc.status != "retired" and not _has_prose(doc.markdown)
        ]
        news = materially_changed(figures, previous) or bool(degraded)
        if degraded and not materially_changed(figures, previous):
            logger.info(
                "selfauthor_repairing_degraded count=%d — these documents have figures but no "
                "prose, so this run rewrites them even though the numbers have not moved",
                len(degraded),
            )

        findings = [
            Finding(topic=row.topic, summary=row.summary, status=row.status)
            for row in await store.list_findings(limit=200)
        ]
        permitted_labels = {e.label for e in usable}

        staged: list[tuple[str, str, str, list[dict[str, Any]]]] = []
        withheld_total = 0
        # A model that is unreachable or misconfigured degrades each document to figures-only —
        # which is a reasonable outcome but an INVISIBLE one: it looks exactly like a quiet day.
        # Counting it means a wrong alias or a dead provider shows up in the console as a number
        # rather than as documents that mysteriously stopped saying anything.
        without_prose = 0

        for spec in DOCUMENTS:
            if not has_what_it_needs(spec, usable):
                continue
            relevant = [e for e in usable if e.label in spec.needs or e.is_prose]
            body, proposed = ("", []) if not news else await _write(llm, spec, relevant)
            if news and not body:
                without_prose += 1
            filtered = filter_claims(proposed, findings, permitted_evidence=permitted_labels)
            withheld_total += len(filtered.withheld)
            for withholding in filtered.withheld:
                logger.info(
                    "selfauthor_claim_withheld slug=%s topic=%s reason=%s",
                    spec.slug, withholding.claim.topic, withholding.reason,
                )
            markdown = render_document(spec, evidence=relevant, claims=filtered.kept, body=body)
            staged.append(
                (
                    spec.slug,
                    spec.title,
                    markdown,
                    [{"topic": c.topic, "text": c.text} for c in filtered.kept],
                )
            )

        stats["claimsWithheld"] = withheld_total
        stats["documentsWithoutProse"] = without_prose
        if without_prose:
            logger.warning(
                "selfauthor_prose_missing count=%d — the writer returned nothing for these; the "
                "documents still carry their figures, but check the model alias and the gateway",
                without_prose,
            )

        if not staged:
            result = RunResult(OUTCOME_NO_EVIDENCE, "no document had the evidence it needs", stats)
            await store.close_run(run_id, outcome=result.outcome, detail=result.detail, stats=stats)
            return result

        # `previous_docs` above doubles as the pre-write snapshot, so a failed self-check can be
        # undone exactly — one read, used for both.
        for slug, title, markdown, claims in staged:
            await store.upsert_document(
                slug=slug, title=title, markdown=markdown, claims=claims, run_id=run_id
            )

        published: list[str] = []
        for slug, title, markdown, _claims in staged:
            existing = previous_docs.get(slug)
            first_written = _epoch(existing.first_written_at) if existing else now_epoch
            status = existing.status if existing else "draft"
            if status == "published" or is_publishable_now(
                status=status,
                publish_mode=settings.publish_mode,
                first_written_at_epoch=first_written,
                draft_window_hours=settings.draft_window_hours,
                now_epoch=now_epoch,
            ):
                await publish(slug, title, markdown)
                await store.set_document_fields(slug, status="published")
                published.append(slug)

        check: CheckResult = await run_check(search) if published else CheckResult(passed=True)

        if not check.passed:
            # Roll the whole run back — not the offending document, the run. A partially published
            # run leaves the corpus in a state nobody chose.
            for slug in published:
                previous_doc = previous_docs.get(slug)
                if previous_doc and previous_doc.status == "published":
                    await publish(slug, previous_doc.title, previous_doc.markdown)
                    await store.upsert_document(
                        slug=slug,
                        title=previous_doc.title,
                        markdown=previous_doc.markdown,
                        claims=previous_doc.claims,
                        run_id=run_id,
                        status="published",
                    )
                else:
                    await publish(slug, "", "")  # never published before ⇒ prune it back out
                    await store.set_document_fields(slug, status="draft")
            detail = check.summary()
            stats["selfCheck"] = {
                "passed": False,
                "regressed": [r.question for r in check.regressed],
            }
            await store.close_run(run_id, outcome=OUTCOME_BLOCKED, detail=detail, stats=stats)
            return RunResult(OUTCOME_BLOCKED, detail, stats)

        stats["selfCheck"] = {"passed": True, "regressed": []}
        stats["documentsWritten"] = len(staged)
        stats["documentsPublished"] = len(published)

        outcome = OUTCOME_PUBLISHED if news else OUTCOME_NO_CHANGE
        detail = (
            f"{len(staged)} documents written, {len(published)} published"
            if news
            else "no material change since the previous run; figures refreshed, no new claims"
        )
        await store.close_run(run_id, outcome=outcome, detail=detail, stats=stats)
        return RunResult(outcome, detail, stats)

    except Exception as exc:  # noqa: BLE001 — a background writer must never take anything down
        logger.warning("selfauthor_run_failed (%s: %s)", type(exc).__name__, exc)
        detail = f"{type(exc).__name__}: {exc}"
        try:
            await store.close_run(run_id, outcome=OUTCOME_ERROR, detail=detail, stats=stats)
        except Exception:  # noqa: BLE001
            logger.warning("selfauthor_run_close_failed run=%s", run_id)
        return RunResult(OUTCOME_ERROR, detail, stats)


async def _write(llm: Any, spec: Any, evidence: list[Evidence]) -> tuple[str, list[Claim]]:
    from .writer import write_document

    return await write_document(llm, spec, evidence)


#: The heading the renderer always emits first. Prose, when there is any, sits between the standard
#: preamble and this — so its absence is detectable without storing a flag that could go stale.
_FIRST_SECTION = "**Our own terms**", "**In the live market**", "**On the testnet"


def _has_prose(markdown: str) -> bool:
    """Whether a rendered document contains the writer's prose, as opposed to figures alone.

    Derived from the text rather than recorded as a flag: a flag would have to be kept in step with
    every rewrite, and the one place it went stale would be the place it mattered.
    """
    text = markdown or ""
    cut = min((text.index(h) for h in _FIRST_SECTION if h in text), default=len(text))
    head = text[:cut]
    # Everything above the first figures section is: title, the source line, the purpose line, and
    # then the writer's prose if it produced any.
    lines = [ln.strip() for ln in head.split("\n") if ln.strip() and not ln.startswith("#")]
    return len(lines) > 2


def _epoch(value: Any) -> float:
    try:
        return float(value.timestamp())
    except Exception:  # noqa: BLE001
        return 0.0
