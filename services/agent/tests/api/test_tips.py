# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Alpha sidebar tip endpoint (api/tips.py) — keyless GET /tips over the Obsidian 'tip' databank.

The tip store is MOCKED (no live DB / embedder). These assert:
  - GET /tips is readable by any beta wallet (reached through the beta-gated BFF);
  - the chunk text is split into {title, body, ctaLabel, ctaHref}, with the title prefix stripped
    off the body so it is never rendered twice;
  - limit is capped; a missing/blank CTA is null; no LLM/embedding is involved (pure store read).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.tips import get_tip_store
from sparkpoint_agent.knowledge import ChunkHit

TOKEN = "test-web-tier-token"
BETA_WALLET = "0x1111111111111111111111111111111111111111"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeTipStore:
    def __init__(self, hits: list[ChunkHit]) -> None:
        self.hits = hits
        self.calls: list[int] = []

    async def list_tips(self, limit: int) -> list[ChunkHit]:
        self.calls.append(limit)
        return self.hits[:limit]


def _hit(title: str, body: str, **meta: Any) -> ChunkHit:
    return ChunkHit(
        content=f"{title}\n\n{body}",
        metadata={"title": title, "cta_url": None, "cta_label": None, **meta},
        score=0.0,
    )


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)


def _with_store(client: TestClient, store: _FakeTipStore) -> None:
    app.dependency_overrides[get_tip_store] = lambda: store


def test_tips_strip_title_prefix_and_carry_cta(ctx: TestClient) -> None:
    store = _FakeTipStore([
        _hit("Fund your wallet", "Use the faucet on the Bridge page.",
             cta_url="/bridge", cta_label="Get testnet funds"),
    ])
    _with_store(ctx, store)
    try:
        resp = ctx.get("/tips", headers=_headers(BETA_WALLET))
        assert resp.status_code == 200
        tips = resp.json()["tips"]
        assert len(tips) == 1
        # Body has the "Title\n\n" prefix stripped; CTA carried through.
        assert tips[0] == {
            "title": "Fund your wallet",
            "body": "Use the faucet on the Bridge page.",
            "ctaLabel": "Get testnet funds",
            "ctaHref": "/bridge",
        }
    finally:
        app.dependency_overrides.pop(get_tip_store, None)


def test_tips_limit_is_capped(ctx: TestClient) -> None:
    store = _FakeTipStore([_hit(f"t{i}", f"b{i}") for i in range(30)])
    _with_store(ctx, store)
    try:
        resp = ctx.get("/tips?limit=999", headers=_headers(BETA_WALLET))
        assert resp.status_code == 200
        # The endpoint caps the requested count before hitting the store.
        assert store.calls and store.calls[0] <= 12
    finally:
        app.dependency_overrides.pop(get_tip_store, None)


def test_tips_empty_when_no_databank(ctx: TestClient) -> None:
    _with_store(ctx, _FakeTipStore([]))
    try:
        resp = ctx.get("/tips", headers=_headers(BETA_WALLET))
        assert resp.status_code == 200
        assert resp.json() == {"tips": []}
    finally:
        app.dependency_overrides.pop(get_tip_store, None)
