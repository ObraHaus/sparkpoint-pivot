# ruff: noqa: S101
"""034 — the orchestrator's guarantees, each pinned by the failure it prevents.

Every step can only make a run produce LESS, never something worse. These tests are the proof.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import pytest

from sparkpoint_agent.selfauthor.run import (
    OUTCOME_BLOCKED,
    OUTCOME_ERROR,
    OUTCOME_NO_CHANGE,
    OUTCOME_NO_EVIDENCE,
    OUTCOME_PUBLISHED,
    execute_run,
    materially_changed,
)
from sparkpoint_agent.selfauthor.settings import SelfAuthorSettings

NOW = 1_000_000.0
ALL_SOURCES = ("answer_gaps", "chain", "defillama", "morpho", "own_corpus")
LIVE = SelfAuthorSettings(
    enabled=True, publish_mode="automatic", draft_window_hours=0, allowed_data_sources=ALL_SOURCES
)


class FakeStore:
    def __init__(
        self, findings: list[Any] | None = None, previous: dict[str, Decimal] | None = None
    ):
        self.runs: list[dict[str, Any]] = []
        self.evidence: list[dict[str, Any]] = []
        self.documents: dict[str, Any] = {}
        self._findings = findings or []
        self._previous = previous or {}
        self.closed: dict[str, Any] | None = None

    async def open_run(self, *, trigger: str) -> int:
        self.runs.append({"trigger": trigger})
        return len(self.runs)

    async def close_run(self, run_id: int, *, outcome: str, detail: str = "", stats=None) -> None:
        self.closed = {"runId": run_id, "outcome": outcome, "detail": detail, "stats": stats or {}}

    async def record_evidence(self, run_id: int, **kw: Any) -> None:
        self.evidence.append(kw)

    async def previous_figures(self, _before: int) -> dict[str, Decimal]:
        return self._previous

    async def list_findings(self, limit: int = 50) -> list[Any]:
        return self._findings

    async def list_documents(self) -> list[Any]:
        return list(self.documents.values())

    async def upsert_document(
        self, *, slug: str, title: str, markdown: str, claims, run_id, status=None
    ):
        self.documents[slug] = _Doc(slug, title, markdown, status or "draft", claims)

    async def set_document_fields(self, slug: str, **kw: Any) -> bool:
        doc = self.documents.get(slug)
        if doc and "status" in kw:
            self.documents[slug] = _Doc(doc.slug, doc.title, doc.markdown, kw["status"], doc.claims)
        return True


class _Doc:
    def __init__(self, slug, title, markdown, status, claims):  # type: ignore[no-untyped-def]
        self.slug, self.title, self.markdown = slug, title, markdown
        self.status, self.claims = status, claims
        self.first_written_at = None


class _Finding:
    def __init__(self, topic: str, status: str = "held") -> None:
        self.topic, self.status, self.summary = topic, status, "a comparable vault charges less"


class Publisher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, slug: str, _title: str, markdown: str) -> None:
        self.calls.append((slug, markdown))


class Model:
    def __init__(self, claims: list[dict] | None = None) -> None:
        self.payload = json.dumps({"body": "Rates moved.", "claims": claims or []})
        self.calls = 0

    async def complete(self, **_kw: Any):  # type: ignore[no-untyped-def]
        self.calls += 1
        return type("R", (), {"text": self.payload, "refused": False})()


async def ok_search(_q: str, _k: int) -> list[Any]:
    return [type("H", (), {"source_kind": "knowledge"})()]


async def regressing_search(_q: str, _k: int) -> list[Any]:
    return [type("H", (), {"source_kind": "self_authored"})()] * 5


class Config:
    rpc_url = None
    aave_pool_address = None
    aave_reserve_usdc_address = None


class DB:
    async def fetch(self, *_a: Any, **_k: Any) -> list[Any]:
        return []


async def _run(store, settings=LIVE, *, llm=None, publish=None, search=ok_search):
    return await execute_run(
        store=store, settings=settings, config=Config(), db=DB(),
        llm=llm or Model(), publish=publish or Publisher(), search=search, now_epoch=NOW,
    )


# ── nothing fetched, nothing written ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_evidence_means_no_document_and_it_says_so() -> None:
    """An outage produces NO note rather than a stale one. The previously published documents stay
    exactly as they were, which is the correct outcome.

    Only `chain` is allowed here, and the config has no RPC — so the run genuinely fetches nothing.
    An earlier version of this test allowed every source and quietly reached the LIVE DeFiLlama
    API, which made it pass or fail on someone else's uptime. A test that touches the network is
    not testing what it says it is.
    """
    store = FakeStore()
    publish = Publisher()
    chain_only = SelfAuthorSettings(
        enabled=True, publish_mode="automatic", draft_window_hours=0,
        allowed_data_sources=("chain",),
    )
    result = await _run(store, chain_only, publish=publish)
    assert result.outcome == OUTCOME_NO_EVIDENCE
    assert publish.calls == []
    assert store.documents == {}
    assert "nothing was written" in result.detail


@pytest.mark.asyncio
async def test_a_disabled_source_is_never_CALLED_not_merely_discarded() -> None:
    """That is the difference between a filter and a permission."""
    store = FakeStore()
    off = SelfAuthorSettings(enabled=True, allowed_data_sources=())
    await _run(store, off)
    assert store.evidence == [], "no source was allowed, so nothing was even attempted"


# ── the self-check blocks a publish ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_run_that_would_displace_a_known_good_answer_publishes_NOTHING(monkeypatch) -> None:
    """The failure the whole feature is designed around. The run is discarded WHOLE — not the
    offending document, the run — because a partially published run leaves the corpus in a state
    nobody chose."""
    store = _stocked_store(monkeypatch)
    publish = Publisher()
    result = await _run(store, publish=publish, search=regressing_search)

    assert result.outcome == OUTCOME_BLOCKED
    assert "FAILED" in result.detail
    assert result.stats["selfCheck"]["passed"] is False
    assert result.stats["selfCheck"]["regressed"], "the regressed question is named"
    # every document it published was rolled back out again
    assert [c[0] for c in publish.calls if c[1] == ""], "unpublished documents were pruned"


@pytest.mark.asyncio
async def test_an_inconclusive_self_check_also_blocks(monkeypatch) -> None:
    async def broken_search(_q: str, _k: int) -> list[Any]:
        raise RuntimeError("embedder down")

    result = await _run(_stocked_store(monkeypatch), search=broken_search)
    assert result.outcome == OUTCOME_BLOCKED


# ── held findings ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_held_finding_withholds_the_claim_and_the_run_records_it(monkeypatch) -> None:
    store = _stocked_store(monkeypatch, findings=[_Finding("fee_competitiveness")])
    model = Model(claims=[{"topic": "fee_competitiveness", "text": "We are the cheapest option."}])
    result = await _run(store, llm=model)

    assert result.stats["claimsWithheld"] >= 1
    for doc in store.documents.values():
        assert "cheapest" not in doc.markdown


# ── silence is a normal outcome ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_unchanged_run_writes_no_new_claims_and_is_not_an_error(monkeypatch) -> None:
    """Most days nothing material changes. An enum that called this a failure would train everyone
    to ignore the status line."""
    store = _stocked_store(
        monkeypatch,
        previous={
            "aave_supply_apy_bps_mainnet": Decimal("348"),
            "vault_net_apy_bps_testnet": Decimal("40"),
        },
    )
    model = Model()
    result = await _run(store, llm=model)

    assert result.outcome == OUTCOME_NO_CHANGE
    assert model.calls == 0, "an unchanged run does not pay for a model pass"
    assert "no material change" in result.detail


@pytest.mark.asyncio
async def test_a_changed_run_publishes(monkeypatch) -> None:
    store = _stocked_store(
        monkeypatch,
        previous={
            "aave_supply_apy_bps_mainnet": Decimal("100"),
            "vault_net_apy_bps_testnet": Decimal("40"),
        },
    )
    publish = Publisher()
    result = await _run(store, publish=publish)
    assert result.outcome == OUTCOME_PUBLISHED
    assert publish.calls


def test_material_change_ignores_a_wobble() -> None:
    """Rates wobble. A note saying "the rate changed" every day about a two-basis-point drift is
    noise that dilutes the corpus for nothing."""
    assert materially_changed({"a": Decimal("348")}, {"a": Decimal("346")}) is False
    assert materially_changed({"a": Decimal("348")}, {"a": Decimal("300")}) is True
    assert materially_changed({"a": Decimal("348")}, {}) is True, "the first run always has news"
    new_label = materially_changed({"b": Decimal("1")}, {"a": Decimal("1")})
    assert new_label is True, "a figure we did not have before is news"


# ── it never raises ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_exploding_store_is_recorded_not_propagated() -> None:
    """A background writer must never take anything down."""

    class Exploding(FakeStore):
        async def previous_figures(self, _before: int) -> dict[str, Decimal]:
            raise RuntimeError("db gone")

    store = Exploding()
    store._previous = {}
    import sparkpoint_agent.selfauthor.run as run_module

    async def gather(*_a: Any, **_k: Any):
        from sparkpoint_agent.selfauthor.evidence import Evidence

        return [Evidence(source="chain", label="x", value=Decimal("1"), chain_id=84532)]

    original = run_module.gather_evidence
    run_module.gather_evidence = gather  # type: ignore[assignment]
    try:
        result = await _run(store)
    finally:
        run_module.gather_evidence = original  # type: ignore[assignment]

    assert result.outcome == OUTCOME_ERROR
    assert "db gone" in result.detail


def _stocked_store(monkeypatch, *, findings=None, previous=None) -> FakeStore:
    """A store whose run will find exactly the evidence the yields document needs."""
    import sparkpoint_agent.selfauthor.run as run_module
    from sparkpoint_agent.selfauthor.evidence import Evidence

    async def gather(*_a: Any, **_k: Any):
        return [
            Evidence(
                source="defillama", label="aave_supply_apy_bps_mainnet",
                value=Decimal("348"), chain_id=8453,
            ),
            Evidence(
                source="chain", label="vault_net_apy_bps_testnet",
                value=Decimal("40"), chain_id=84532,
            ),
        ]

    monkeypatch.setattr(run_module, "gather_evidence", gather)
    return FakeStore(findings=findings, previous=previous)
