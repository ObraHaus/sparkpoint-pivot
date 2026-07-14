# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.4 recommendation endpoints (api/recommendations.py).

The vault reader (cap headroom), the mandate store, and the LLM are all MOCKED — no live
vault / RPC / DB / Anthropic. The recommender + the deterministic policy gate are the REAL
code, so these prove the crux (FR-016 / SC-006): ONLY whitelisted + policy-cleared strategies
ever surface. Two independent fail-closed layers are exercised:

  - **Structural whitelist** — an off-whitelist ``actionType`` the "model" emits in its
    ranking is ignored; the candidate set stays the code-fixed whitelist
    (``test_non_whitelisted_actiontype_is_ignored``).
  - **Deterministic gate** — an over-cap headroom rejects EVERY candidate, so nothing
    surfaces (``test_over_cap_headroom_filters_all_out``).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.recommendations import (
    get_agent_config,
    get_llm_client,
    get_mandate_provider,
)
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.chain import VaultReader
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.coordinator import ChainContext, MandateView
from sparkpoint_agent.llm import AsyncClaudeClient, AuthMode
from sparkpoint_agent.policy import CAPS

_WAD = 10**18

TOKEN = "test-web-tier-token"
VAULT = "0x3333333333333333333333333333333333333333"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}

# Module-level singleton default (a call in an arg default trips ruff B008).
_DEFAULT_MANDATE = MandateView(version=1)

# A well-formed ranking of the two code-fixed yield strategies (whitelist only).
RANKING = {
    "recommendations": [
        {"actionType": "vault_deposit", "rank": 1, "title": "Vault", "rationale": "steady yield"},
        {"actionType": "aave_supply", "rank": 2, "title": "Aave", "rationale": "raw yield"},
    ]
}


# ── fakes ────────────────────────────────────────────────────────────────────────


class FakeCapReader:
    """Serves the cap-headroom reads the recommendation gate context needs."""

    def __init__(self, *, balance: int = 0, total_assets: int = 0, rate_bps: int = 1000) -> None:
        self._balance = balance
        self._total_assets = total_assets
        self._rate_bps = rate_bps

    async def balance_of(self, owner: str) -> int:
        return self._balance

    async def convert_to_assets(self, shares: int) -> int:
        return shares  # pps == 1e18 ⇒ underlying == shares

    async def total_assets(self) -> int:
        return self._total_assets

    async def performance_fee_bps(self) -> int:
        return self._rate_bps


class _TextBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _Message:
    def __init__(self, text: str, stop_reason: str) -> None:
        self.stop_reason = stop_reason
        self.stop_details = None
        self.content = [_TextBlock(text)]


class FakeTransport:
    """A canned :class:`MessageTransport` — returns a fixed reply so the REAL client's
    normalize/extract/parse pipeline runs off the network."""

    def __init__(self, text: str, *, stop_reason: str = "end_turn") -> None:
        self._text = text
        self._stop = stop_reason

    async def create(self, **_: Any) -> _Message:
        return _Message(self._text, self._stop)


def _llm(text: str, *, stop_reason: str = "end_turn") -> AsyncClaudeClient:
    return AsyncClaudeClient(
        transport=FakeTransport(text, stop_reason=stop_reason), auth_mode=AuthMode.API_KEY
    )


class FakeMandateProvider:
    """A stand-in :class:`MandateProvider` (mocks the §3.1 store read)."""

    def __init__(self, view: MandateView | None) -> None:
        self._view = view

    async def active(self, chain: ChainContext) -> MandateView | None:
        return self._view


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(
    *,
    reader: object | None = None,
    llm: AsyncClaudeClient | None = None,
    mandate: MandateView | None = _DEFAULT_MANDATE,
    vault_address: str | None = VAULT,
) -> None:
    """Override the four injection seams with deterministic fakes."""
    app.dependency_overrides[get_vault_reader] = lambda: reader or FakeCapReader()
    app.dependency_overrides[get_llm_client] = lambda: llm or _llm(json.dumps(RANKING))
    app.dependency_overrides[get_mandate_provider] = lambda: FakeMandateProvider(mandate)
    app.dependency_overrides[get_agent_config] = lambda: AgentConfig(
        chain_id=8453, rpc_url=None, vault_address=vault_address, database_url=None
    )


# ── GET /recommendations ────────────────────────────────────────────────────────────


def test_recommendations_surfaces_ranked_whitelisted_cleared(client: TestClient) -> None:
    _wire()
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["mandateVersion"] == 1
    assert body["stale"] is False
    recs = body["recommendations"]
    assert len(recs) == 2
    assert [r["rank"] for r in recs] == [1, 2]
    # Every surfaced rec is BOTH whitelisted AND policy-approved (FR-016).
    assert all(r["policy"]["status"] == "approved" for r in recs)
    assert all(r["protocol"] in {"aave_v3", "aerodrome"} for r in recs)
    assert {r["strategyKind"] for r in recs} == {"vault_deposit", "aave_supply"}
    # Strategy-keyed, deterministic recIds round-trip into proposedAction.recommendationId.
    assert [r["recId"] for r in recs] == ["rec_vault_deposit", "rec_aave_supply"]
    assert recs[0]["proposedAction"]["recommendationId"] == "rec_vault_deposit"
    # APY figures are READ data (no live feed → null, never fabricated); fee is the vault's.
    assert recs[0]["grossApyBps"] is None
    assert recs[0]["projectedApyBps"] is None
    assert recs[0]["performanceFeeBps"] == 1000


def test_over_cap_headroom_filters_all_out(client: TestClient) -> None:
    """The deterministic gate rejects EVERY candidate (per-user headroom exhausted) → nothing
    surfaces. The renderer shows nothing the policy layer has not cleared (FR-016)."""
    at_cap = CAPS.per_user_tvl.amount  # balance == cap ⇒ 0 headroom < the notional deposit
    _wire(reader=FakeCapReader(balance=at_cap))
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["recommendations"] == []


def test_non_whitelisted_actiontype_is_ignored(client: TestClient) -> None:
    """An off-whitelist ``actionType`` the model emits in its ranking is structurally
    dropped; the surfaced set stays the code-fixed whitelist."""
    rogue = {
        "recommendations": [
            {"actionType": "uniswap_v3", "rank": 1, "title": "rogue", "rationale": "off-list"},
            {"actionType": "vault_deposit", "rank": 1, "title": "Vault", "rationale": "steady"},
            {"actionType": "aave_supply", "rank": 2, "title": "Aave", "rationale": "raw"},
        ]
    }
    _wire(llm=_llm(json.dumps(rogue)))
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    recs = resp.json()["recommendations"]
    assert {r["strategyKind"] for r in recs} == {"vault_deposit", "aave_supply"}
    assert all(r["strategyKind"] != "uniswap_v3" for r in recs)
    assert all(r["protocol"] in {"aave_v3", "aerodrome"} for r in recs)


def test_no_mandate_prompts_onboarding_not_found(client: TestClient) -> None:
    _wire(mandate=None)
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_recommender_refusal_is_refusal(client: TestClient) -> None:
    _wire(llm=_llm("", stop_reason="refusal"))
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "REFUSAL"


def test_recommendations_degrade_stale_when_vault_unavailable(client: TestClient) -> None:
    """An undeployed/unreachable vault marks the gate inputs stale → the freshness step
    rejects inflows → nothing surfaces, reported as 200 + stale:true (never a fabricated rec)."""
    _wire(reader=VaultReader(vault_address=None, transport=_ExplodingTransport()))
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["recommendations"] == []


def test_recommendations_requires_auth(client: TestClient) -> None:
    _wire()
    resp = client.get("/recommendations")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


def test_only_aave_when_vault_undeployed(client: TestClient) -> None:
    """With no deploy-time vault address, the vault_deposit candidate is unrepresentable
    (target resolves to None) and drops; only the statically-targeted Aave supply can surface."""
    _wire(vault_address=None)
    resp = client.get("/recommendations", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    recs = resp.json()["recommendations"]
    assert {r["strategyKind"] for r in recs} == {"aave_supply"}


# ── GET /recommendations/{recId} ────────────────────────────────────────────────────


def test_recommendation_detail_why_this_and_compare(client: TestClient) -> None:
    _wire()
    resp = client.get("/recommendations/rec_vault_deposit", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["recommendation"]["recId"] == "rec_vault_deposit"
    assert body["whyThis"] == body["recommendation"]["rationale"]
    # Comparison lists the neighboring cleared strategy (aave_supply), not the subject itself.
    kinds = {c["strategyKind"] for c in body["comparison"]}
    assert kinds == {"aave_supply"}
    assert all(c["recId"] != "rec_vault_deposit" for c in body["comparison"])


def test_recommendation_detail_unknown_is_not_found(client: TestClient) -> None:
    _wire()
    resp = client.get("/recommendations/rec_bogus", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


class _ExplodingTransport:
    """Fails the test if any RPC is issued — proves the stale-degrade path touches no network."""

    async def call(self, method: str, params: Any) -> str:
        raise AssertionError(f"no RPC should be issued for an undeployed vault; got {method!r}")
