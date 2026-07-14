# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.1 Onboarding / Mandate endpoints (api/mandate.py).

The mandate store + the onboarding machine's LLMs are MOCKED (no live DB, no Anthropic
call). These assert the §3.1 contract end to end through the app + middleware:

  - POST /mandate persists a confirmed mandate (201, version 1, active, confirmedAt);
  - GET /mandate returns the active mandate (or ``null`` when none);
  - PUT /mandate forks a NEW version (bumps 1 → 2), the new row active (FR-004);
  - POST /onboarding/turn streams SSE ChatBlocks ending in a ``mandate_draft``;
  - NO response here ever carries a signable artifact (no signature/proposedAction/bundle).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.mandate import get_mandate_store, get_onboarding_machine
from sparkpoint_agent.coordinator.onboarding import InMemoryOnboardingStore, OnboardingMachine
from sparkpoint_agent.db.mandates import MandateRecord, MandateWrite
from sparkpoint_agent.llm import LlmResult, StructuredResult

TOKEN = "test-web-tier-token"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}

MANDATE_BODY: dict[str, Any] = {
    "mandate": {
        "goals": [{"kind": "grow_savings", "label": "Grow my savings safely"}],
        "riskProfile": "conservative",
        "riskParams": {"maxSlippageBps": 50, "drawdownTolerance": "low", "horizonMonths": 12},
        "summaryText": "Conservative, capital-preservation focus.",
        "version": 1,
    }
}


# ── fakes ─────────────────────────────────────────────────────────────────────


class _FakeMandateStore:
    """In-memory MandateStore that models per-user version bumping + active tracking."""

    def __init__(self) -> None:
        self._version: dict[str, int] = {}
        self.active: dict[str, MandateRecord] = {}

    async def persist(
        self, *, owner_eoa: str, network_id: str, write: MandateWrite
    ) -> MandateRecord:
        version = self._version.get(owner_eoa, 0) + 1
        self._version[owner_eoa] = version
        record = MandateRecord(
            id=uuid4(),
            version=version,
            status="confirmed",
            confirmed_at=datetime.now(UTC),
            risk_tier=write.risk_tier,
            max_slippage_bps=write.max_slippage_bps,
            horizon_months=write.horizon_months,
            drawdown_tolerance=write.drawdown_tolerance,
            goals=write.goals,
            risk_params=write.risk_params,
            summary_text=write.summary_text,
        )
        self.active[owner_eoa] = record
        return record

    async def get_active(
        self, *, owner_eoa: str, network_id: str
    ) -> MandateRecord | None:
        return self.active.get(owner_eoa)


class _StructuredLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return self._result


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="A tip.", stop_reason="end_turn")


def _fake_machine() -> OnboardingMachine:
    return OnboardingMachine(
        planner=Planner(
            llm=_StructuredLlm(StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER)))
        ),
        literacy=Literacy(llm=_CompleteLlm()),
        store=InMemoryOnboardingStore(),
    )


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, _FakeMandateStore]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    store = _FakeMandateStore()
    machine = _fake_machine()
    app.dependency_overrides[get_mandate_store] = lambda: store
    app.dependency_overrides[get_onboarding_machine] = lambda: machine
    try:
        yield TestClient(app), store
    finally:
        app.dependency_overrides.pop(get_mandate_store, None)
        app.dependency_overrides.pop(get_onboarding_machine, None)


def _sse_blocks(text: str) -> list[dict[str, Any]]:
    """Parse the ``data:`` payloads out of an SSE stream body."""
    return [
        json.loads(line[len("data:") :].strip())
        for line in text.splitlines()
        if line.startswith("data:")
    ]


def _assert_not_signable(payload: Any) -> None:
    blob = json.dumps(payload)
    assert "signature" not in blob
    assert "proposedAction" not in blob
    assert "intentBundle" not in blob


# ── POST /mandate ─────────────────────────────────────────────────────────────


def test_post_mandate_persists_confirmed_version_1(
    ctx: tuple[TestClient, _FakeMandateStore],
) -> None:
    client, _ = ctx
    resp = client.post("/mandate", json=MANDATE_BODY, headers=GOOD_HEADERS)
    assert resp.status_code == 201
    mandate = resp.json()["mandate"]
    assert mandate["version"] == 1
    assert mandate["active"] is True
    assert mandate["confirmedAt"].endswith("Z")
    assert mandate["id"].startswith("mnd_")
    assert mandate["riskProfile"] == "conservative"
    assert mandate["riskParams"]["maxSlippageBps"] == 50
    assert mandate["goals"][0]["kind"] == "grow_savings"
    # FR-002 persists a mandate — never a signable artifact.
    _assert_not_signable(resp.json())


def test_post_mandate_invalid_risk_profile_is_validation_error(
    ctx: tuple[TestClient, _FakeMandateStore],
) -> None:
    client, _ = ctx
    bad = {"mandate": {**MANDATE_BODY["mandate"], "riskProfile": "reckless"}}
    resp = client.post("/mandate", json=bad, headers=GOOD_HEADERS)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_mandate_requires_auth() -> None:
    # No monkeypatched token → fail-closed UNAUTHENTICATED before the handler runs.
    client = TestClient(app)
    resp = client.post("/mandate", json=MANDATE_BODY)
    assert resp.status_code in (401, 400)


# ── GET /mandate ──────────────────────────────────────────────────────────────


def test_get_mandate_null_when_none(ctx: tuple[TestClient, _FakeMandateStore]) -> None:
    client, _ = ctx
    resp = client.get("/mandate", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"mandate": None}


def test_get_mandate_returns_active_after_post(
    ctx: tuple[TestClient, _FakeMandateStore],
) -> None:
    client, _ = ctx
    client.post("/mandate", json=MANDATE_BODY, headers=GOOD_HEADERS)
    resp = client.get("/mandate", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    mandate = resp.json()["mandate"]
    assert mandate is not None
    assert mandate["version"] == 1
    assert mandate["active"] is True


# ── PUT /mandate (FR-004 — versioned edit) ────────────────────────────────────


def test_put_mandate_bumps_version(ctx: tuple[TestClient, _FakeMandateStore]) -> None:
    client, _ = ctx
    created = client.post("/mandate", json=MANDATE_BODY, headers=GOOD_HEADERS)
    assert created.json()["mandate"]["version"] == 1

    edited_body = {
        "mandate": {
            **MANDATE_BODY["mandate"],
            "riskProfile": "moderate",
            "riskParams": {
                "maxSlippageBps": 100,
                "drawdownTolerance": "medium",
                "horizonMonths": 24,
            },
        }
    }
    resp = client.put("/mandate", json=edited_body, headers=GOOD_HEADERS)
    assert resp.status_code == 200
    mandate = resp.json()["mandate"]
    assert mandate["version"] == 2  # a NEW versioned row (FR-004)
    assert mandate["active"] is True
    assert mandate["riskProfile"] == "moderate"
    _assert_not_signable(resp.json())

    # The active mandate is now the new version.
    latest = client.get("/mandate", headers=GOOD_HEADERS).json()["mandate"]
    assert latest["version"] == 2


# ── POST /onboarding/turn (SSE → mandate_draft) ───────────────────────────────


def test_onboarding_turn_streams_mandate_draft(
    ctx: tuple[TestClient, _FakeMandateStore],
) -> None:
    client, _ = ctx
    resp = client.post(
        "/onboarding/turn",
        headers=GOOD_HEADERS,
        json={
            "step": "risk_scenario",
            "selections": {"scenario": "hold", "timeline": "medium", "goals": ["grow_savings"]},
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    blocks = _sse_blocks(resp.text)
    draft = next((b for b in blocks if b.get("type") == "mandate_draft"), None)
    assert draft is not None
    assert draft["mandate"]["riskProfile"] == "conservative"
    assert draft["mandate"]["version"] == 1
    # The final SSE frame carries the session id + a block count.
    assert any("sessionId" in b and "blockCount" in b for b in blocks)
    # §3.1: the onboarding stream NEVER carries a signable artifact.
    _assert_not_signable(blocks)


def test_onboarding_turn_issues_session_id(
    ctx: tuple[TestClient, _FakeMandateStore],
) -> None:
    client, _ = ctx
    resp = client.post(
        "/onboarding/turn", headers=GOOD_HEADERS, json={"step": "welcome"}
    )
    assert resp.status_code == 200
    done = next(b for b in _sse_blocks(resp.text) if "sessionId" in b)
    assert done["sessionId"].startswith("onb_")
