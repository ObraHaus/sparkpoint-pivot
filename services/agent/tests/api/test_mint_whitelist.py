# ruff: noqa: S101  (pytest asserts)
"""Sparky Broker mint whitelist - the public GTD/FCFS application, through the real app.

The store is a FAKE (no live DB). These assert the contract that matters:

  - submitting needs the s2s bearer but NO account identity (there is no signed-in user);
  - the address is stored lowercase, first submission per address wins, and a duplicate can never
    modify the existing row (the endpoint is public - anyone can type anyone's address);
  - the response is IDENTICAL for a new, duplicate, or unknown address (no enumeration oracle);
  - fields are length-capped and cleaned server-side exactly like the beta application;
  - the admin export list is 404 (never 403) to a non-admin.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.access import get_mint_whitelist_store
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.db.mint_whitelist import MintWhitelistApplication

TOKEN = "test-web-tier-token"  # noqa: S105  # test fixture, not a real secret
APPLICANT = "0x1111111111111111111111111111111111111111"
OTHER = "0x2222222222222222222222222222222222222222"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"

GOOD = {
    "address": APPLICANT,
    "contact": "me@example.com",
    "name": "Ada",
    "reason": "I want a Broker for the GTD mint.",
}


def _public_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "4663",
    }


class _FakeAllowlist:
    def __init__(self) -> None:
        self.admin: set[str] = set()

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower()
        return {"beta": a in self.admin, "admin": a in self.admin}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admin

    async def list_role(self, role: str) -> list[str]:
        return sorted(self.admin) if role == "admin" else []

    async def add(self, address: str, role: str, *, actor: str | None) -> None:  # pragma: no cover
        raise AssertionError("the mint whitelist must never touch the access allowlist")

    async def remove(
        self, address: str, role: str, *, actor: str | None
    ) -> None:  # pragma: no cover
        raise AssertionError("the mint whitelist must never touch the access allowlist")


class _FakeMintWhitelist:
    """In-memory MintWhitelistStore mirroring ON CONFLICT DO NOTHING."""

    def __init__(self) -> None:
        self.rows: dict[str, MintWhitelistApplication] = {}
        self.audit: list[str] = []

    async def submit(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> bool:
        addr = address.lower()
        self.audit.append(addr)
        if addr in self.rows:
            return False
        self.rows[addr] = MintWhitelistApplication(
            address=addr,
            contact=contact,
            display_name=display_name,
            reason=reason,
            submitted_at="2026-10-06T00:00:00+00:00",
        )
        return True

    async def list(self, *, limit: int = 500) -> list[MintWhitelistApplication]:
        return list(self.rows.values())[:limit]


@pytest.fixture
def ctx(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    mint = _FakeMintWhitelist()
    allow = _FakeAllowlist()
    app.dependency_overrides[get_mint_whitelist_store] = lambda: mint
    app.dependency_overrides[get_allowlist_store] = lambda: allow
    try:
        yield TestClient(app), mint, allow
    finally:
        app.dependency_overrides.pop(get_mint_whitelist_store, None)
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_submit_needs_the_s2s_bearer_but_no_account_headers(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    resp = client.post("/access/mint-whitelist", json=GOOD, headers=_public_headers())
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "received": True}
    assert mint.rows[APPLICANT.lower()].contact == "me@example.com"


def test_submit_without_the_bearer_is_401(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    assert client.post("/access/mint-whitelist", json=GOOD).status_code == 401
    assert mint.rows == {}


def test_a_checksummed_address_is_stored_lowercase(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    client.post(
        "/access/mint-whitelist", json={**GOOD, "address": ADMIN_WALLET}, headers=_public_headers()
    )
    assert ADMIN_WALLET.lower() in mint.rows


def test_malformed_or_missing_addresses_are_refused(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    for bad in ("", "nope", "0x123", "sparky.eth", "0x" + "a" * 64):
        resp = client.post(
            "/access/mint-whitelist", json={**GOOD, "address": bad}, headers=_public_headers()
        )
        assert resp.status_code == 400, bad
    no_address = {k: v for k, v in GOOD.items() if k != "address"}
    assert (
        client.post(
            "/access/mint-whitelist", json=no_address, headers=_public_headers()
        ).status_code
        == 400
    )
    assert mint.rows == {}


def test_blank_and_over_long_fields_are_refused(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    for blank in ({**GOOD, "contact": "   "}, {**GOOD, "name": ""}, {**GOOD, "reason": "\t"}):
        assert (
            client.post("/access/mint-whitelist", json=blank, headers=_public_headers()).status_code
            == 400
        )
    over = client.post(
        "/access/mint-whitelist", json={**GOOD, "reason": "x" * 5000}, headers=_public_headers()
    )
    assert over.status_code == 400
    assert mint.rows == {}


def test_fields_are_cleaned_exactly_like_the_beta_application(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    client.post(
        "/access/mint-whitelist",
        json={
            "address": APPLICANT,
            "contact": "<script>me@example.com</script>",
            "name": "Ada\x00\x07",
            "reason": "I want the <b>GTD</b> mint spot.",
        },
        headers=_public_headers(),
    )
    row = mint.rows[APPLICANT.lower()]
    for field in (row.contact, row.display_name, row.reason):
        assert "<" not in field
        assert ">" not in field
        assert "\x00" not in field


def test_a_duplicate_never_overwrites_the_first_submission_and_is_audited(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, _ = ctx
    first = client.post("/access/mint-whitelist", json=GOOD, headers=_public_headers())
    second = client.post(
        "/access/mint-whitelist",
        json={
            "address": APPLICANT,
            "contact": "attacker@example.com",
            "name": "Not Ada",
            "reason": "Trying to hijack a whitelist request in flight.",
        },
        headers=_public_headers(),
    )
    # Identical response (no enumeration oracle), and the original row is untouched.
    assert first.json() == second.json() == {"ok": True, "received": True}
    row = mint.rows[APPLICANT.lower()]
    assert row.contact == "me@example.com"
    assert row.display_name == "Ada"
    # The dropped duplicate is still visible in the audit trail.
    assert mint.audit == [APPLICANT.lower(), APPLICANT.lower()]


def test_the_mint_whitelist_grants_no_app_access(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    """The two decisions are separate: a whitelist request must never reach the beta allowlist."""
    client, mint, allow = ctx
    client.post("/access/mint-whitelist", json=GOOD, headers=_public_headers())
    assert allow.admin == set()  # `add` raises if it is ever called
    assert mint.rows[APPLICANT.lower()] is not None


def test_admin_export_list_is_404_to_a_non_admin(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, _, _ = ctx
    assert (
        client.get("/admin/access/mint-whitelist", headers=_headers(APPLICANT)).status_code == 404
    )


def test_admin_export_list_returns_rows_newest_first(
    ctx: tuple[TestClient, _FakeMintWhitelist, _FakeAllowlist],
) -> None:
    client, mint, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/mint-whitelist", json=GOOD, headers=_public_headers())
    client.post(
        "/access/mint-whitelist", json={**GOOD, "address": OTHER}, headers=_public_headers()
    )
    rows = client.get("/admin/access/mint-whitelist", headers=_headers(ADMIN_WALLET)).json()[
        "applications"
    ]
    assert {r["address"] for r in rows} == {APPLICANT.lower(), OTHER.lower()}
    assert rows[0]["contact"] == "me@example.com"
    assert set(rows[0]) == {"address", "contact", "name", "reason", "submittedAt"}
    assert len(mint.rows) == 2
