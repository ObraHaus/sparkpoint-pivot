# ruff: noqa: S101, S105, S106  (pytest asserts; tokens are test fixtures)
"""T022 — the admin MANAGE half of ``/admin/vaults`` (api/admin_vaults.py).

Asserts the feature-011 non-custody contract (contracts/vault-factory-interfaces.md §4, US4):
  * admin-gating — a non-admin gets 404 on every route (invisible-admin posture);
  * ``/admin/vaults/create`` REFUSES a non-allowlisted ``morphoVault`` + ``feeBps > 2000`` and,
    when valid, returns prepared calldata + a predicted address and NEVER signs (``signed: false``);
  * ``/admin/vaults/allowlist`` returns prepared calldata + never signs;
  * ``/admin/vaults/{vault}/guardian-action`` returns prepared Timelock schedule+execute calldata
    for every real action and NEVER signs;
  * the guardian-action enum contains NO fund-moving verb — a fabricated ``withdraw``/``sweep``/
    ``migrate`` is REJECTED (422) — "no move-funds action exists";
  * every mutating endpoint returns calldata, never a signature.

No live chain / DB: the chain client + provenance store are in-memory doubles (the pure calldata
encoders run against the compiled Foundry artifacts, which is the point — real, non-signing bytes).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import admin_vaults
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.chain.vault_factory import (
    GUARDIAN_ACTIONS,
    PER_USER_CEILING,
    TOTAL_CEILING,
    VaultFactoryChain,
)

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"
FACTORY = "0x00000000000000000000000000000000000f0000"
ALLOWED_MORPHO = "0x1111111111111111111111111111111111111111"
UNLISTED_MORPHO = "0x2222222222222222222222222222222222222222"
VAULT = "0x4444444444444444444444444444444444444444"
CAP_REGISTRY = "0x00000000000000000000000000000000000ca9e0"
TIMELOCK = "0x00000000000000000000000000000000000717e1"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    def __init__(self, admins: set[str]) -> None:
        self._admins = {a.lower() for a in admins}

    async def status(self, address: str) -> dict[str, bool]:
        ok = address.lower() in self._admins
        return {"beta": ok, "admin": ok}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self._admins


class _NullTransport:
    async def call(self, method: str, params: Any) -> str:
        raise AssertionError("the encode-only path must never touch the chain")


class _FakeChain:
    """A chain double: stubs the eth_call reads, but makes REAL calldata via the pure encoders."""

    def __init__(self) -> None:
        self.factory_address = FACTORY
        self._enc = VaultFactoryChain(factory_address=FACTORY, transport=_NullTransport())
        self._allow = {ALLOWED_MORPHO.lower()}
        # Vaults the factory attests via isSparkPointVault (drives pending → live promotion).
        self.attested: set[str] = set()

    async def is_allowlisted(self, morpho: str) -> bool:
        return morpho.lower() in self._allow

    async def is_sparkpoint_vault(self, vault: str) -> bool:
        return vault.lower() in self.attested

    async def owner(self) -> str:
        return "0x000000000000000000000000000000000000dead"

    async def vaults(self) -> list[str]:
        return [VAULT]

    async def predict_vault_address(
        self, morpho: str, fee_bps: int, caps: tuple[int, int], label: str
    ) -> str:
        return "0x00000000000000000000000000000000000abcde"

    def create_vault_calldata(
        self, morpho: str, fee_bps: int, caps: tuple[int, int], label: str
    ) -> str:
        return self._enc.create_vault_calldata(morpho, fee_bps, caps, label)

    def allowlist_calldata(self, morpho: str, allowed: bool) -> str:
        return self._enc.allowlist_calldata(morpho, allowed)

    async def wrapper_state(self, vault: str) -> dict[str, Any]:
        return {
            "vault": vault.lower(),
            "paused": False,
            "guardian": TIMELOCK,  # the timelock
            "performanceFeeBps": 1000,
            "feeRecipient": "0x0000000000000000000000000000000000fee000",
            "morphoVault": ALLOWED_MORPHO,
            "capRegistry": CAP_REGISTRY,
            "depositCap": 0,
            "label": "SparkPoint Test",
            "caps": {"perUserCap": 0, "totalCap": 0, "vaultCap": 0},
        }

    async def min_delay(self, timelock: str) -> int:
        return 172800

    def guardian_inner_calls(
        self, vault: str, cap_registry: str, action: str, args: dict[str, Any]
    ) -> list[dict[str, str]]:
        return self._enc.guardian_inner_calls(vault, cap_registry, action, args)

    def timelock_schedule_calldata(
        self, inner: list[dict[str, str]], *, delay: int, salt: bytes, **kw: Any
    ) -> str:
        return self._enc.timelock_schedule_calldata(inner, delay=delay, salt=salt)

    def timelock_execute_calldata(
        self, inner: list[dict[str, str]], *, salt: bytes, **kw: Any
    ) -> str:
        return self._enc.timelock_execute_calldata(inner, salt=salt)


class _FakeStore:
    def __init__(self) -> None:
        self.wrappers: list[dict[str, Any]] = []
        self.allowlist: dict[str, dict[str, Any]] = {}

    async def list_wrappers(self) -> list[dict[str, Any]]:
        return list(self.wrappers)

    async def get_wrapper(self, chain_id: int, vault: str) -> dict[str, Any] | None:
        for w in self.wrappers:
            if w["vault_address"] == vault.lower() and w["chain_id"] == chain_id:
                return w
        return None

    async def insert_pending_wrapper(
        self, *, vault_address: str, chain_id: int, label: str, morpho_vault: str,
        native_fee_bps: int | None, factory_address: str | None,
    ) -> None:
        self.wrappers.append({
            "vault_address": vault_address.lower(), "chain_id": chain_id, "kind": "morpho_wrapper",
            "label": label, "morpho_vault": morpho_vault.lower(), "native_fee_bps": native_fee_bps,
            "factory_address": (factory_address or "").lower() or None, "status": "pending",
        })

    async def mark_wrapper_live(self, vault_address: str, chain_id: int) -> None:
        # Promote-only: mirror the SQL `status = 'pending'` guard — never demote a `live` row.
        for w in self.wrappers:
            if (
                w["vault_address"] == vault_address.lower()
                and w["chain_id"] == chain_id
                and w["status"] == "pending"
            ):
                w["status"] = "live"

    async def get_allowlist_record(self, chain_id: int, morpho: str) -> dict[str, Any] | None:
        return self.allowlist.get(morpho.lower())

    async def upsert_allowlist_record(self, *, morpho_vault: str, chain_id: int, allowed: bool,
                                      **kw: Any) -> None:
        self.allowlist[morpho_vault.lower()] = {
            "morpho_vault": morpho_vault.lower(), "chain_id": chain_id, "allowed": allowed, **kw,
        }


@pytest.fixture
def store() -> _FakeStore:
    return _FakeStore()


@pytest.fixture
def chain() -> _FakeChain:
    return _FakeChain()


@pytest.fixture
def client(
    monkeypatch: pytest.MonkeyPatch, store: _FakeStore, chain: _FakeChain
) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.setenv(admin_vaults.FACTORY_ADDRESS_ENV, FACTORY)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    app.dependency_overrides[admin_vaults.get_vault_factory_store] = lambda: store
    app.dependency_overrides[admin_vaults.get_factory_chain] = lambda: chain
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ── admin-gating (invisible-admin 404) ───────────────────────────────────────


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/vaults"),
        ("GET", f"/admin/vaults/{VAULT}"),
        ("POST", "/admin/vaults/create"),
        ("POST", "/admin/vaults/allowlist"),
        ("POST", f"/admin/vaults/{VAULT}/guardian-action"),
    ],
)
def test_non_admin_gets_404(client: TestClient, method: str, path: str) -> None:
    resp = client.request(method, path, headers=_headers(STRANGER), json={})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_requires_s2s_auth() -> None:
    resp = TestClient(app).get("/admin/vaults")
    assert resp.status_code in (401, 400)


# ── create: refusals + prepared calldata (never signs) ───────────────────────


def test_create_refuses_non_allowlisted_morpho(client: TestClient, store: _FakeStore) -> None:
    resp = client.post(
        "/admin/vaults/create",
        headers=_headers(ADMIN),
        json={"morphoVault": UNLISTED_MORPHO, "feeBps": 1000,
              "caps": {"perAddressCap": 0, "totalCap": 0}, "label": "X", "chainId": 84532},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert store.wrappers == []  # nothing persisted on refusal


def test_create_refuses_fee_over_cap(client: TestClient, store: _FakeStore) -> None:
    resp = client.post(
        "/admin/vaults/create",
        headers=_headers(ADMIN),
        json={"morphoVault": ALLOWED_MORPHO, "feeBps": 2001,
              "caps": {"perAddressCap": 0, "totalCap": 0}, "label": "X", "chainId": 84532},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert store.wrappers == []


def test_create_rejects_chain_id_mismatch(client: TestClient, store: _FakeStore) -> None:
    """Body chainId must equal the X-Chain-Id header (84532) — otherwise validation, calldata
    target, and the provenance row would reference different chains. Rejected BEFORE any persist."""
    resp = client.post(
        "/admin/vaults/create",
        headers=_headers(ADMIN),  # X-Chain-Id: 84532
        json={"morphoVault": ALLOWED_MORPHO, "feeBps": 1000,
              "caps": {"perAddressCap": 0, "totalCap": 0}, "label": "X", "chainId": 8453},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert store.wrappers == []  # nothing persisted on a chain mismatch


def test_create_returns_calldata_and_never_signs(client: TestClient, store: _FakeStore) -> None:
    resp = client.post(
        "/admin/vaults/create",
        headers=_headers(ADMIN),
        json={"morphoVault": ALLOWED_MORPHO, "feeBps": 1000,
              "caps": {"perAddressCap": 0, "totalCap": 0},
              "label": "SparkPoint · Steakhouse USDC", "chainId": 84532},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["signed"] is False
    assert body["calldata"]["to"] == FACTORY
    assert body["calldata"]["data"].startswith("0xd517b096")  # createVault selector
    assert body["predictedAddress"].startswith("0x")
    # A `pending` provenance row was inserted at the predicted address.
    assert len(store.wrappers) == 1
    assert store.wrappers[0]["status"] == "pending"
    # No signature anywhere in the response.
    assert "signature" not in body


# ── allowlist: prepared calldata + vetting upsert (never signs) ──────────────


def test_allowlist_returns_calldata_and_upserts_record(
    client: TestClient, store: _FakeStore
) -> None:
    resp = client.post(
        "/admin/vaults/allowlist",
        headers=_headers(ADMIN),
        json={"morphoVault": ALLOWED_MORPHO, "allowed": True,
              "vettingNotes": "Curated: $40M TVL, dual audit.", "nativeFeeBps": 100},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["signed"] is False
    assert body["calldata"]["to"] == FACTORY
    assert body["calldata"]["data"].startswith("0x88287d58")  # allowlistMorphoVault selector
    assert ALLOWED_MORPHO.lower() in store.allowlist


# ── guardian action: prepared timelock calldata + the no-move-funds invariant ─


@pytest.mark.parametrize(
    ("action", "args"),
    [
        ("pause", {}),
        ("unpause", {}),
        ("setFee", {"feeBps": 500}),
        ("setFeeRecipient", {"recipient": "0x0000000000000000000000000000000000feed01"}),
        ("setCaps", {"perAddressCap": 1000, "totalCap": 5000}),
    ],
)
def test_guardian_action_returns_prepared_calldata_never_signs(
    client: TestClient, action: str, args: dict[str, Any]
) -> None:
    resp = client.post(
        f"/admin/vaults/{VAULT}/guardian-action",
        headers=_headers(ADMIN),
        json={"action": action, "args": args},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["signed"] is False
    assert body["noMoveFundsAction"] is True
    assert body["schedule"]["data"].startswith("0x")
    assert body["execute"]["data"].startswith("0x")
    assert "signature" not in body


@pytest.mark.parametrize("verb", ["withdraw", "sweep", "migrate", "transfer", "rescue"])
def test_guardian_action_rejects_fund_moving_verbs(client: TestClient, verb: str) -> None:
    """No move-funds action EXISTS: a fabricated fund verb is not in the closed enum → 422."""
    resp = client.post(
        f"/admin/vaults/{VAULT}/guardian-action",
        headers=_headers(ADMIN),
        json={"action": verb, "args": {"amount": 1}},
    )
    # The closed Literal enum rejects the fabricated verb at the schema boundary.
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_guardian_action_enum_has_no_fund_moving_verb() -> None:
    forbidden = {"withdraw", "sweep", "migrate", "transfer", "rescue", "skim", "recover"}
    assert forbidden.isdisjoint(set(GUARDIAN_ACTIONS))
    assert set(GUARDIAN_ACTIONS) == {"pause", "unpause", "setFee", "setFeeRecipient", "setCaps"}


def _cap_arg(data: str) -> int:
    """The trailing uint256 word of a single-arg setter's calldata (0x + 4-byte selector + word)."""
    return int(data[-64:], 16)


def test_guardian_setcaps_maps_total_onto_vault_cap(client: TestClient) -> None:
    """setCaps encodes THREE CapRegistry writes — setPerUserCap/setTotalCap/setVaultCap — all
    targeting the wrapper's CapRegistry, with vaultCap pinned to totalCap (mirrors _capParams)."""
    per_addr, total = 1_000_000, 500_000
    resp = client.post(
        f"/admin/vaults/{VAULT}/guardian-action",
        headers=_headers(ADMIN),
        json={"action": "setCaps", "args": {"perAddressCap": per_addr, "totalCap": total}},
    )
    assert resp.status_code == 200, resp.text
    inner = resp.json()["inner"]
    assert len(inner) == 3
    # Every cap write targets the wrapper's CapRegistry (never the vault, never a fund path).
    assert [c["target"] for c in inner] == [CAP_REGISTRY, CAP_REGISTRY, CAP_REGISTRY]
    # Three DISTINCT setters (setPerUserCap / setTotalCap / setVaultCap).
    selectors = [c["data"][:10] for c in inner]
    assert len(set(selectors)) == 3
    # Args: perUser<-perAddressCap, total<-totalCap, vault<-totalCap (vaultCap == totalCap).
    assert _cap_arg(inner[0]["data"]) == per_addr
    assert _cap_arg(inner[1]["data"]) == total
    assert _cap_arg(inner[2]["data"]) == total  # vaultCap tracks totalCap


@pytest.mark.parametrize(
    "args",
    [
        {"perAddressCap": PER_USER_CEILING + 1, "totalCap": 0},
        {"perAddressCap": 0, "totalCap": TOTAL_CEILING + 1},
    ],
)
def test_guardian_setcaps_rejects_out_of_range(
    client: TestClient, args: dict[str, int]
) -> None:
    """A cap above the CapRegistry ceiling is refused with VALIDATION_ERROR before any calldata is
    returned (the on-chain setter would revert with CapAboveCeiling)."""
    resp = client.post(
        f"/admin/vaults/{VAULT}/guardian-action",
        headers=_headers(ADMIN),
        json={"action": "setCaps", "args": args},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ── list ─────────────────────────────────────────────────────────────────────


def test_list_vaults_read_only(client: TestClient) -> None:
    resp = client.get("/admin/vaults", headers=_headers(ADMIN))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["noMoveFundsAction"] is True
    assert set(body["guardianActions"]) == set(GUARDIAN_ACTIONS)
    assert body["factory"]["address"] == FACTORY


# ── pending → live provenance promotion (isSparkPointVault attestation) ──────


def _pending_row() -> dict[str, Any]:
    return {
        "vault_address": VAULT.lower(), "chain_id": 84532, "kind": "morpho_wrapper",
        "label": "SparkPoint Test", "morpho_vault": ALLOWED_MORPHO.lower(),
        "native_fee_bps": 50, "factory_address": FACTORY, "status": "pending",
    }


def test_list_promotes_pending_row_once_attested(
    client: TestClient, store: _FakeStore, chain: _FakeChain
) -> None:
    """A `pending` row on the current chain is promoted to `live` once factory.isSparkPointVault
    attests it — and the promotion is persisted to the store."""
    store.wrappers.append(_pending_row())
    chain.attested.add(VAULT.lower())
    resp = client.get("/admin/vaults", headers=_headers(ADMIN))
    assert resp.status_code == 200, resp.text
    assert resp.json()["vaults"][0]["status"] == "live"
    assert store.wrappers[0]["status"] == "live"  # persisted, not just the response view


def test_list_leaves_pending_when_not_attested(
    client: TestClient, store: _FakeStore
) -> None:
    """Fail-safe: no attestation (or RPC down) → the row STAYS pending (never fabricate one)."""
    store.wrappers.append(_pending_row())
    # chain.attested is empty → isSparkPointVault false → no promotion.
    resp = client.get("/admin/vaults", headers=_headers(ADMIN))
    assert resp.status_code == 200, resp.text
    assert resp.json()["vaults"][0]["status"] == "pending"
    assert store.wrappers[0]["status"] == "pending"


def test_get_vault_promotes_pending_row_once_attested(
    client: TestClient, store: _FakeStore, chain: _FakeChain
) -> None:
    """The single-vault handler promotes a `pending` provenance row to `live` on attestation too."""
    store.wrappers.append(_pending_row())
    chain.attested.add(VAULT.lower())
    resp = client.get(f"/admin/vaults/{VAULT}", headers=_headers(ADMIN))
    assert resp.status_code == 200, resp.text
    assert resp.json()["provenance"]["status"] == "live"
    assert store.wrappers[0]["status"] == "live"
