# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Feature 026 - alpha access applications + the 1M-SRK mainnet auto-gate, through the real app.

Stores are FAKES (no live DB). These assert the contract that matters:

  - a wallet applies for ITSELF: the owner comes from the request scope, never the body;
  - one application per wallet (re-submit overwrites; an APPROVED one is never un-approved);
  - fields are length-capped and control characters / angle brackets are stripped server-side;
  - the admin review surface is 404 (never 403) to a non-admin - it must not be discoverable;
  - APPROVING is exactly the existing beta allowlist add (audit-logged the same way); DENYING
    grants nothing and revokes nothing;
  - the SRK gate auto-grants at/above the threshold, is a NO-OP below it, and FAILS OPEN (never
    raising, never blocking) when unset / when the RPC dies / when the allowlist write fails.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.access import get_application_store
from sparkpoint_agent.api.allowlist import SRK_GATE_ACTOR, get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.chain.srk_gate import ENV_MIN_BALANCE, ENV_RPC_URL, ENV_TOKEN
from sparkpoint_agent.db.access_applications import Application

TOKEN = "test-web-tier-token"
APPLICANT = "0x1111111111111111111111111111111111111111"
OTHER = "0x2222222222222222222222222222222222222222"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
SRK_TOKEN = "0x0488401c3F535193Fa8Df029d9fFe615A06E74E6"
ONE_MILLION = 1_000_000 * 10**18

GOOD = {"contact": "me@example.com", "name": "Ada", "reason": "I want to test the vault flow."}


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    def __init__(self) -> None:
        self.beta: set[str] = set()
        self.admin: set[str] = set()
        self.audit: list[tuple[str, str, str, str | None]] = []
        self.add_raises: Exception | None = None

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower()
        is_admin = a in self.admin
        return {"beta": is_admin or a in self.beta, "admin": is_admin}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admin

    async def list_role(self, role: str) -> list[str]:
        return sorted(self.admin if role == "admin" else self.beta)

    async def add(self, address: str, role: str, *, actor: str | None) -> None:
        if self.add_raises is not None:
            raise self.add_raises
        (self.admin if role == "admin" else self.beta).add(address.lower())
        self.audit.append(("add", address.lower(), role, (actor or "").lower() or None))

    async def remove(self, address: str, role: str, *, actor: str | None) -> None:
        (self.admin if role == "admin" else self.beta).discard(address.lower())
        self.audit.append(("remove", address.lower(), role, (actor or "").lower() or None))


class _FakeApplications:
    """In-memory AccessApplicationStore mirroring the real upsert/decide semantics."""

    def __init__(self) -> None:
        self.rows: dict[str, Application] = {}
        self.audit: list[tuple[str, str, str | None]] = []

    async def submit(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> Application:
        addr = address.lower()
        previous = self.rows.get(addr)
        status = "approved" if previous is not None and previous.status == "approved" else "pending"
        row = Application(
            address=addr,
            contact=contact,
            display_name=display_name,
            reason=reason,
            status=status,
            submitted_at=previous.submitted_at if previous else "2026-08-02T00:00:00+00:00",
            updated_at="2026-08-02T01:00:00+00:00",
            decided_by=previous.decided_by if previous else None,
            decided_at=previous.decided_at if previous else None,
        )
        self.rows[addr] = row
        self.audit.append(("submit", addr, addr))
        return row

    async def submit_public(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> bool:
        """Mirrors the real ON CONFLICT DO NOTHING: the first application for an address wins."""
        addr = address.lower()
        self.audit.append(("submit", addr, None))
        if addr in self.rows:
            return False
        self.rows[addr] = Application(
            address=addr,
            contact=contact,
            display_name=display_name,
            reason=reason,
            status="pending",
            submitted_at="2026-08-17T00:00:00+00:00",
            updated_at="2026-08-17T00:00:00+00:00",
            decided_by=None,
            decided_at=None,
            source="public",
        )
        return True

    async def get(self, address: str) -> Application | None:
        return self.rows.get(address.lower())

    async def list(self, *, status: str | None = None, limit: int = 100) -> list[Application]:
        rows = [r for r in self.rows.values() if status is None or r.status == status]
        return rows[:limit]

    async def decide(self, *, address: str, approve: bool, actor: str | None) -> None:
        addr = address.lower()
        row = self.rows.get(addr)
        if row is None:
            return
        self.rows[addr] = Application(
            address=row.address,
            contact=row.contact,
            display_name=row.display_name,
            reason=row.reason,
            status="approved" if approve else "denied",
            submitted_at=row.submitted_at,
            updated_at="2026-08-02T02:00:00+00:00",
            decided_by=(actor or "").lower() or None,
            decided_at="2026-08-02T02:00:00+00:00",
        )
        self.audit.append(("approve" if approve else "deny", addr, (actor or "").lower() or None))


@pytest.fixture
def ctx(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[TestClient, _FakeApplications, _FakeAllowlist]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    for key in (ENV_RPC_URL, ENV_TOKEN, ENV_MIN_BALANCE):
        monkeypatch.delenv(key, raising=False)
    apps = _FakeApplications()
    allow = _FakeAllowlist()
    app.dependency_overrides[get_application_store] = lambda: apps
    app.dependency_overrides[get_allowlist_store] = lambda: allow
    try:
        yield TestClient(app), apps, allow
    finally:
        app.dependency_overrides.pop(get_application_store, None)
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── submitting (the ONE write a non-beta wallet gets) ─────────────────────────


def test_submit_files_the_application_against_the_scoped_owner(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    resp = client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    assert resp.status_code == 201
    body = resp.json()["application"]
    assert body["address"] == APPLICANT.lower()
    assert body["status"] == "pending"
    assert apps.rows[APPLICANT.lower()].contact == "me@example.com"


def test_the_wallet_can_never_be_supplied_in_the_body(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """A body 'address' is IGNORED - the row is filed against X-Owner, so nobody applies for
    someone else (and nobody plants an application on a wallet they don't control)."""
    client, apps, _ = ctx
    resp = client.post(
        "/access/application", json={**GOOD, "address": OTHER}, headers=_headers(APPLICANT)
    )
    assert resp.status_code == 201
    assert set(apps.rows) == {APPLICANT.lower()}


def test_missing_or_blank_fields_are_refused(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    # The app maps a pydantic RequestValidationError to a 400 §1.5 envelope (see api/main.py).
    assert client.post("/access/application", json={}, headers=_headers(APPLICANT)).status_code == (
        400
    )
    for blank in ({**GOOD, "contact": "   "}, {**GOOD, "name": ""}, {**GOOD, "reason": "\t"}):
        resp = client.post("/access/application", json=blank, headers=_headers(APPLICANT))
        assert resp.status_code == 400
    assert apps.rows == {}


def test_over_long_fields_are_capped_server_side(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    resp = client.post(
        "/access/application", json={**GOOD, "reason": "x" * 5000}, headers=_headers(APPLICANT)
    )
    # Either the pydantic max_length or the explicit cap - both surface as 400; never a stored row.
    assert resp.status_code == 400
    assert apps.rows == {}


def test_control_characters_and_angle_brackets_are_stripped(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    client.post(
        "/access/application",
        json={
            "contact": "<script>me@example.com</script>",
            "name": "Ada\x00\x07",
            "reason": "Testing the <b>vault</b> deposit flow end to end.",
        },
        headers=_headers(APPLICANT),
    )
    row = apps.rows[APPLICANT.lower()]
    for field in (row.contact, row.display_name, row.reason):
        assert "<" not in field
        assert ">" not in field
        assert "\x00" not in field


def test_re_submitting_overwrites_the_same_single_row(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    client.post(
        "/access/application",
        json={**GOOD, "reason": "Actually I want to test the swap page."},
        headers=_headers(APPLICANT),
    )
    assert len(apps.rows) == 1
    assert apps.rows[APPLICANT.lower()].reason == "Actually I want to test the swap page."


def test_a_re_submit_never_un_approves_an_approved_application(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    client.post(
        "/admin/access/applications/approve",
        json={"address": APPLICANT},
        headers=_headers(ADMIN_WALLET),
    )
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    assert apps.rows[APPLICANT.lower()].status == "approved"


def test_reading_your_own_status(ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist]) -> None:
    client, _, _ = ctx
    assert client.get("/access/application", headers=_headers(APPLICANT)).json() == {
        "application": None
    }
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    mine = client.get("/access/application", headers=_headers(APPLICANT)).json()["application"]
    assert mine["address"] == APPLICANT.lower()
    # Another wallet sees its OWN (absent) application, never this one.
    assert client.get("/access/application", headers=_headers(OTHER)).json() == {
        "application": None
    }


# ── the PUBLIC form (045): no session, no signature, address typed by hand ────


def _public_headers() -> dict[str, str]:
    """045: the s2s bearer ONLY. No X-Account/X-Owner/X-Chain-Id — there is no signed-in user, and
    the web tier must not invent one."""
    return {"Authorization": f"Bearer {TOKEN}"}


PUBLIC_GOOD = {**GOOD, "address": APPLICANT}


def test_public_submit_needs_no_account_headers_at_all(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """The whole point: an applicant with no wallet connected. The §1.2 scoping headers assert a
    verified identity, and there is none — demanding them would force the web tier to fabricate an
    owner, which every route downstream would then treat as proven."""
    client, apps, _ = ctx
    resp = client.post("/access/public-application", json=PUBLIC_GOOD, headers=_public_headers())
    assert resp.status_code == 200
    assert apps.rows[APPLICANT.lower()].contact == "me@example.com"


def test_public_submit_still_requires_the_s2s_bearer(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """Skipping the identity parse must not have skipped AUTH. This is not an internet surface."""
    client, apps, _ = ctx
    assert client.post("/access/public-application", json=PUBLIC_GOOD).status_code == 401
    resp = client.post(
        "/access/public-application",
        json=PUBLIC_GOOD,
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401
    assert apps.rows == {}


def test_a_public_application_is_recorded_as_unverified(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """Nobody signed for this address, and the admin panel needs to be able to say so."""
    client, apps, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/public-application", json=PUBLIC_GOOD, headers=_public_headers())

    assert apps.rows[APPLICANT.lower()].source == "public"
    rows = client.get("/admin/access/applications", headers=_headers(ADMIN_WALLET)).json()[
        "applications"
    ]
    assert rows[0]["source"] == "public"


def test_the_signed_in_form_is_still_recorded_as_wallet_signed(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    assert apps.rows[APPLICANT.lower()].source == "wallet"


def test_a_public_submit_never_touches_an_existing_application(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """Anyone can type anyone's address here. If this could modify an existing row, a stranger
    could overwrite a real applicant's contact details — so the first application wins."""
    client, apps, _ = ctx
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))

    resp = client.post(
        "/access/public-application",
        json={
            "address": APPLICANT,
            "contact": "attacker@example.com",
            "name": "Not Ada",
            "reason": "Trying to hijack an application in flight.",
        },
        headers=_public_headers(),
    )
    assert resp.status_code == 200  # …and yet
    row = apps.rows[APPLICANT.lower()]
    assert row.contact == "me@example.com"
    assert row.display_name == "Ada"
    assert row.source == "wallet"


def test_the_response_is_identical_whether_or_not_anything_was_stored(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """No enumeration oracle. An anonymous caller must not be able to learn from the response
    whether an address has already applied, been approved, or is unknown."""
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())

    first = client.post("/access/public-application", json=PUBLIC_GOOD, headers=_public_headers())
    duplicate = client.post(
        "/access/public-application", json=PUBLIC_GOOD, headers=_public_headers()
    )
    client.post(
        "/admin/access/applications/approve",
        json={"address": APPLICANT},
        headers=_headers(ADMIN_WALLET),
    )
    after_approval = client.post(
        "/access/public-application", json=PUBLIC_GOOD, headers=_public_headers()
    )

    bodies = [first.json(), duplicate.json(), after_approval.json()]
    assert bodies[0] == bodies[1] == bodies[2]
    assert {first.status_code, duplicate.status_code, after_approval.status_code} == {200}
    # And nothing about the stored application leaks back.
    for body in bodies:
        assert "application" not in body
        assert "status" not in body


def test_a_public_submit_grants_nothing(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, allow = ctx
    client.post("/access/public-application", json=PUBLIC_GOOD, headers=_public_headers())
    assert allow.beta == set()
    assert apps.rows[APPLICANT.lower()].status == "pending"


def test_a_malformed_address_is_refused_before_anything_is_stored(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    for bad in ("", "nope", "0x123", "sparky.eth", "0x" + "a" * 64, " 0x" + "z" * 40):
        resp = client.post(
            "/access/public-application",
            json={**PUBLIC_GOOD, "address": bad},
            headers=_public_headers(),
        )
        assert resp.status_code == 400, bad
    assert apps.rows == {}


def test_a_missing_address_is_refused(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, _ = ctx
    assert (
        client.post("/access/public-application", json=GOOD, headers=_public_headers()).status_code
        == 400
    )
    assert apps.rows == {}


def test_public_fields_are_cleaned_and_capped_exactly_like_the_signed_in_form(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """The public form is the one an attacker can reach without a wallet, so the edge cleaning that
    protects the admin panel's rendering matters MORE here, not less."""
    client, apps, _ = ctx
    client.post(
        "/access/public-application",
        json={
            "address": APPLICANT,
            "contact": "<script>me@example.com</script>",
            "name": "Ada\x00\x07",
            "reason": "Testing the <b>vault</b> deposit flow end to end.",
        },
        headers=_public_headers(),
    )
    row = apps.rows[APPLICANT.lower()]
    for field in (row.contact, row.display_name, row.reason):
        assert "<" not in field
        assert ">" not in field
        assert "\x00" not in field

    over = client.post(
        "/access/public-application",
        json={**PUBLIC_GOOD, "address": OTHER, "reason": "x" * 5000},
        headers=_public_headers(),
    )
    assert over.status_code == 400
    assert OTHER.lower() not in apps.rows


def test_a_checksummed_address_is_accepted_and_stored_lowercase(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """Pasting from a block explorer must not be a validation error."""
    client, apps, _ = ctx
    client.post(
        "/access/public-application",
        json={**PUBLIC_GOOD, "address": ADMIN_WALLET},
        headers=_public_headers(),
    )
    assert ADMIN_WALLET.lower() in apps.rows


def test_an_approved_public_application_grants_beta_the_same_single_way(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """045 adds a door, not a second lock: approval is still exactly the allowlist add."""
    client, apps, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/public-application", json=PUBLIC_GOOD, headers=_public_headers())

    client.post(
        "/admin/access/applications/approve",
        json={"address": APPLICANT},
        headers=_headers(ADMIN_WALLET),
    )
    assert APPLICANT.lower() in allow.beta
    assert ("add", APPLICANT.lower(), "beta", ADMIN_WALLET.lower()) in allow.audit
    assert apps.rows[APPLICANT.lower()].status == "approved"


def test_the_scoped_routes_are_unaffected_by_the_header_exemption(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """The exemption is one path. Everything else still demands the §1.2 scoping headers, so it
    cannot become a way to reach a user-scoped route without an identity."""
    client, _, _ = ctx
    for path in ("/access/application", "/allowlist/status"):
        assert client.get(path, headers=_public_headers()).status_code == 400, path
    assert (
        client.post("/access/application", json=GOOD, headers=_public_headers()).status_code == 400
    )


# ── admin review ──────────────────────────────────────────────────────────────


def test_admin_routes_are_404_not_403_to_a_non_admin(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, _, _ = ctx
    for method, path in (
        ("get", "/admin/access/applications"),
        ("post", "/admin/access/applications/approve"),
        ("post", "/admin/access/applications/deny"),
    ):
        resp = (
            client.get(path, headers=_headers(APPLICANT))
            if method == "get"
            else client.post(path, json={"address": APPLICANT}, headers=_headers(APPLICANT))
        )
        assert resp.status_code == 404, path


def test_admin_lists_pending_applications(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    rows = client.get(
        "/admin/access/applications?status=pending", headers=_headers(ADMIN_WALLET)
    ).json()["applications"]
    assert [r["address"] for r in rows] == [APPLICANT.lower()]
    assert rows[0]["contact"] == "me@example.com"
    assert rows[0]["name"] == "Ada"


def test_approve_grants_beta_via_the_existing_allowlist_and_audits_it(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))

    resp = client.post(
        "/admin/access/applications/approve",
        json={"address": APPLICANT},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 200
    assert APPLICANT.lower() in allow.beta
    assert ("add", APPLICANT.lower(), "beta", ADMIN_WALLET.lower()) in allow.audit
    assert apps.rows[APPLICANT.lower()].status == "approved"
    # And the wallet now reads as beta through the same status endpoint login uses.
    assert client.get("/allowlist/status", headers=_headers(APPLICANT)).json()["beta"] is True


def test_deny_grants_nothing_and_revokes_nothing(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, apps, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    client.post("/access/application", json=GOOD, headers=_headers(APPLICANT))
    before = set(allow.beta)

    resp = client.post(
        "/admin/access/applications/deny",
        json={"address": APPLICANT},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 200
    assert allow.beta == before
    assert apps.rows[APPLICANT.lower()].status == "denied"


def test_admin_decision_rejects_a_malformed_address(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/access/applications/approve",
        json={"address": "nope"},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 400


# ── the 1M-SRK mainnet auto-gate ──────────────────────────────────────────────


class _FakeRpc:
    def __init__(self, result: Any = None, raises: Exception | None = None) -> None:
        self.result = result
        self.raises = raises

    async def call(self, method: str, params: list[Any]) -> Any:
        if self.raises is not None:
            raise self.raises
        return self.result


def _configure_gate(monkeypatch: pytest.MonkeyPatch, balance: int | None, *, boom: bool = False):
    monkeypatch.setenv(ENV_RPC_URL, "https://eth.example/rpc")
    monkeypatch.setenv(ENV_TOKEN, SRK_TOKEN)
    rpc = (
        _FakeRpc(raises=RuntimeError("mainnet RPC down"))
        if boom
        else _FakeRpc("0x" + format(balance or 0, "064x"))
    )
    monkeypatch.setattr(
        "sparkpoint_agent.chain.srk_gate.build_gate_from_env",
        lambda rpc_factory=None: __import__(
            "sparkpoint_agent.chain.srk_gate", fromlist=["SrkMainnetGate"]
        ).SrkMainnetGate(rpc=rpc, token=SRK_TOKEN),
    )
    monkeypatch.setattr(
        "sparkpoint_agent.api.allowlist.build_gate_from_env",
        lambda: __import__(
            "sparkpoint_agent.chain.srk_gate", fromlist=["SrkMainnetGate"]
        ).SrkMainnetGate(rpc=rpc, token=SRK_TOKEN),
    )


def test_gate_unconfigured_is_a_silent_skip(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist],
) -> None:
    """Unset env ⇒ the wallet goes to the form. NEVER a 500, never a blocked login."""
    client, _, allow = ctx
    resp = client.post("/allowlist/srk-gate-check", headers=_headers(APPLICANT))
    assert resp.status_code == 200
    assert resp.json() == {"qualified": False, "reason": "not_configured", "granted": False}
    assert allow.beta == set()


def test_gate_auto_grants_a_holder_at_the_threshold(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _, allow = ctx
    _configure_gate(monkeypatch, ONE_MILLION)

    resp = client.post("/allowlist/srk-gate-check", headers=_headers(APPLICANT))
    assert resp.json() == {"qualified": True, "reason": "ok", "granted": True}
    assert APPLICANT.lower() in allow.beta
    # Audited as the GATE, distinguishable from a human admin add.
    assert ("add", APPLICANT.lower(), "beta", SRK_GATE_ACTOR) in allow.audit
    # …and the very next status read - which is what login re-resolves - now says beta.
    assert client.get("/allowlist/status", headers=_headers(APPLICANT)).json()["beta"] is True


def test_gate_is_a_no_op_one_wei_below_the_threshold(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _, allow = ctx
    _configure_gate(monkeypatch, ONE_MILLION - 1)

    resp = client.post("/allowlist/srk-gate-check", headers=_headers(APPLICANT))
    assert resp.json() == {"qualified": False, "reason": "below_threshold", "granted": False}
    assert allow.beta == set()


def test_gate_fails_open_when_the_mainnet_rpc_is_down(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist], monkeypatch: pytest.MonkeyPatch
) -> None:
    """RPC down ⇒ 200 + not qualified, so the login continues and the form is offered."""
    client, _, allow = ctx
    _configure_gate(monkeypatch, None, boom=True)

    resp = client.post("/allowlist/srk-gate-check", headers=_headers(APPLICANT))
    assert resp.status_code == 200
    assert resp.json() == {"qualified": False, "reason": "rpc_error", "granted": False}
    assert allow.beta == set()


def test_a_qualifying_wallet_whose_allowlist_write_fails_reports_granted_false(
    ctx: tuple[TestClient, _FakeApplications, _FakeAllowlist], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The DB can fail after a good balance read - that must not 500, and must not CLAIM access."""
    client, _, allow = ctx
    allow.add_raises = RuntimeError("db down")
    _configure_gate(monkeypatch, ONE_MILLION)

    resp = client.post("/allowlist/srk-gate-check", headers=_headers(APPLICANT))
    assert resp.status_code == 200
    assert resp.json() == {"qualified": True, "reason": "ok", "granted": False}
    assert allow.beta == set()
