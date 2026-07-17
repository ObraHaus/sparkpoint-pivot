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
from sparkpoint_agent.api.tips import get_tip_admin_store, get_tip_store
from sparkpoint_agent.knowledge import ChunkHit

TOKEN = "test-web-tier-token"
BETA_WALLET = "0x1111111111111111111111111111111111111111"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"


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


# ── admin tip manager (list / upsert / delete) ────────────────────────────────


class _FakeAllowlist:
    def __init__(self, admins: set[str] | None = None) -> None:
        self.admins = admins or set()

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admins

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower() in self.admins
        return {"beta": a, "admin": a}


class _FakeTipAdminStore:
    def __init__(self, hits: list[ChunkHit]) -> None:
        self.hits = hits
        self.pruned: list[Any] = []

    async def list_all_tips(self) -> list[ChunkHit]:
        return self.hits

    async def prune_source(self, source_id: Any, keep_ids: Any) -> int:
        self.pruned.append(source_id)
        return 1


def _admin_headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


@pytest.fixture
def admin_ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from sparkpoint_agent.api.allowlist import get_allowlist_store

    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    # No EMBEDDING_OPENAI_* → openai_embedder() returns None (503 on write, as designed).
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN_WALLET.lower()})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)
        app.dependency_overrides.pop(get_tip_admin_store, None)


def test_admin_tips_denied_to_non_admin_is_404(admin_ctx: TestClient) -> None:
    h = _admin_headers(STRANGER)
    assert admin_ctx.get("/admin/tips", headers=h).status_code == 404
    up = admin_ctx.post("/admin/tips", headers=h, json={"title": "x", "body": "y"})
    assert up.status_code == 404
    dl = admin_ctx.post("/admin/tips/delete", headers=h, json={"source": "x"})
    assert dl.status_code == 404


def test_admin_list_tips_reconstructs_editable_fields(admin_ctx: TestClient) -> None:
    store = _FakeTipAdminStore([
        ChunkHit(
            content="Fund your wallet\n\nUse the faucet.",
            metadata={"source": "fund", "title": "Fund your wallet",
                      "cta_url": "/bridge", "cta_label": "Faucet", "active": "true"},
            score=0.0,
        ),
        ChunkHit(
            content="Hidden tip\n\nNot shown.",
            metadata={"source": "hidden", "title": "Hidden tip", "active": "false"},
            score=0.0,
        ),
    ])
    app.dependency_overrides[get_tip_admin_store] = lambda: store
    r = admin_ctx.get("/admin/tips", headers=_admin_headers(ADMIN_WALLET))
    assert r.status_code == 200
    tips = r.json()["tips"]
    assert tips[0] == {"source": "fund", "title": "Fund your wallet", "body": "Use the faucet.",
                       "ctaLabel": "Faucet", "ctaHref": "/bridge", "active": True}
    assert tips[1]["active"] is False and tips[1]["ctaHref"] is None


def test_admin_upsert_tip_503_without_embedder(admin_ctx: TestClient) -> None:
    # PII scan passes, but no real embedder is configured → 503 (never a stub vector).
    app.dependency_overrides[get_tip_admin_store] = lambda: _FakeTipAdminStore([])
    r = admin_ctx.post(
        "/admin/tips",
        headers=_admin_headers(ADMIN_WALLET),
        json={"title": "New tip", "body": "Body here.", "active": True},
    )
    assert r.status_code == 503


def test_admin_upsert_tip_rejects_pii(admin_ctx: TestClient) -> None:
    app.dependency_overrides[get_tip_admin_store] = lambda: _FakeTipAdminStore([])
    r = admin_ctx.post(
        "/admin/tips",
        headers=_admin_headers(ADMIN_WALLET),
        json={"title": "Contact", "body": "email me at a@b.com", "active": True},
    )
    assert r.status_code == 422  # PII scan fires before the embedder check


def test_admin_upsert_tip_rejects_unsafe_cta(admin_ctx: TestClient) -> None:
    app.dependency_overrides[get_tip_admin_store] = lambda: _FakeTipAdminStore([])
    r = admin_ctx.post(
        "/admin/tips",
        headers=_admin_headers(ADMIN_WALLET),
        json={"title": "x", "body": "y", "cta_label": "go", "cta_href": "javascript:1"},
    )
    assert r.status_code == 400


def test_admin_delete_tip_prunes(admin_ctx: TestClient) -> None:
    store = _FakeTipAdminStore([])
    app.dependency_overrides[get_tip_admin_store] = lambda: store
    r = admin_ctx.post(
        "/admin/tips/delete", headers=_admin_headers(ADMIN_WALLET), json={"source": "fund"}
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert len(store.pruned) == 1
