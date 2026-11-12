# ruff: noqa: S101
"""071 — Rhea (Burrow) on NEAR: RPC views, unit math, messages, previews, positions, chat."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest

from sparkpoint_agent.agents.planner import Intent
from sparkpoint_agent.coordinator.dag import ChainContext, CoordinatorDag
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.parse import parse_earn_request
from sparkpoint_agent.earn.rails import ReceiptLivenessCache
from sparkpoint_agent.earn.registry import EarnRegistry, EarnSnapshot
from sparkpoint_agent.earn.rhea import (
    DRY_PLACEHOLDER_SIGNATURE,
    McaLookup,
    NearRpcClient,
    RheaRpcError,
    RheaViews,
    custom_recipient_msg,
    dapp_registration_fee_amount,
    evm_wallet_string,
    inner_units_to_decimal,
    mca_fee_amount,
    message_to_sign,
    register_message,
    strip_0x,
    supply_message,
    token_units_to_decimal,
)
from sparkpoint_agent.earn.service import EarnService
from sparkpoint_agent.policy import CapHeadroom

from .helpers import RHEA_TOKEN_ID, make_rhea_vault, make_snapshot

WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
WALLET_NO_0X = "d8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
MCA = "abc.multica.near"
USDC_DETAIL = {
    "supplied": {"balance": "12733763455236751230092183"},
    "config": {"extra_decimals": 12},
    "supply_apr": "0.140459036159116681312316847",
}


def _payload(*, out: str = "99.9808", eta: int = 35) -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "100000000",
            "amountInFormatted": "100",
            "amountInUsd": "100.0",
            "amountOut": str(int(Decimal(out) * 10**6)),
            "amountOutFormatted": out,
            "amountOutUsd": out,
            "minAmountOut": "98980992",
            "timeEstimate": eta,
        },
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


class FakeRheaViews:
    """A duck-typed ``RheaViews`` for preview/positions tests (no RPC)."""

    def __init__(
        self,
        *,
        mca: str | None = None,
        fees: dict[str, str] | None = None,
        detail: dict[str, Any] | None = None,
        portfolio: dict[str, Any] | None = None,
        wallet_form: str | None = None,
        fail_mca: bool = False,
        fail_fee: bool = False,
        fail_positions: bool = False,
    ) -> None:
        self.mca = mca
        self.fees = fees if fees is not None else {RHEA_TOKEN_ID: "300000"}
        self.detail = detail if detail is not None else USDC_DETAIL
        self.portfolio = portfolio
        self.wallet_form = wallet_form
        self.fail_mca = fail_mca
        self.fail_fee = fail_fee
        self.fail_positions = fail_positions
        self.wallets: list[str] = []

    async def mca_for_wallet(self, wallet: str) -> McaLookup:
        self.wallets.append(wallet)
        if self.fail_mca:
            raise RheaRpcError("offline")
        form = self.wallet_form if self.wallet_form is not None else evm_wallet_string(wallet)
        return McaLookup(mca=self.mca, wallet_form=form)

    async def create_mca_fee(self) -> dict[str, str]:
        if self.fail_fee:
            raise RheaRpcError("offline")
        return self.fees

    async def asset(self, token_id: str) -> dict[str, Any] | None:
        return self.detail

    async def positions(self, account_id: str) -> dict[str, Any] | None:
        if self.fail_positions:
            raise RheaRpcError("offline")
        return self.portfolio


def _service(
    views: FakeRheaViews,
    *,
    handler: Any = None,
    snapshot: EarnSnapshot | None = None,
) -> tuple[EarnService, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        if handler is not None:
            return handler(request)
        return httpx.Response(201, json=_payload())

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(snapshot or make_snapshot(make_rhea_vault()))
    service = EarnService(
        config,
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(wrapped), clock=lambda: 1000.0),
        liveness=ReceiptLivenessCache(clock=lambda: 1000.0),
        rhea_views=views,  # type: ignore[arg-type]
    )
    return service, calls


# ── RPC client ────────────────────────────────────────────────────────────────


async def test_near_rpc_view_decodes_the_byte_array_result() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["params"]["method_name"] == "get_asset"
        assert (
            body["params"]["args_base64"]
            == base64.b64encode(json.dumps({"token_id": RHEA_TOKEN_ID}).encode()).decode()
        )
        data = json.dumps({"supply_apr": "0.14"}).encode()
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "result": {"result": list(data), "logs": []}}
        )

    client = NearRpcClient(
        ["https://free.rpc.fastnear.com"], transport=httpx.MockTransport(handler)
    )
    value = await client.view("contract.main.burrow.near", "get_asset", {"token_id": RHEA_TOKEN_ID})
    assert value == {"supply_apr": "0.14"}


async def test_near_rpc_falls_back_to_the_next_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "free" in (request.url.host or ""):
            return httpx.Response(503, text="busy")
        data = json.dumps("rhea000.multica.near").encode()
        return httpx.Response(200, json={"result": {"result": list(data)}})

    client = NearRpcClient(
        ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
        transport=httpx.MockTransport(handler),
    )
    assert await client.view("multica.near", "get_mca_by_wallet", {}) == ("rhea000.multica.near")


async def test_near_rpc_raises_when_every_url_fails() -> None:
    client = NearRpcClient(
        ["https://free.rpc.fastnear.com"],
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
    )
    with pytest.raises(RheaRpcError):
        await client.view("multica.near", "get_mca_by_wallet", {})


# ── unit math + messages ──────────────────────────────────────────────────────


def test_extra_decimals_math_is_unit_safe() -> None:
    assert inner_units_to_decimal("12733763455236751230092183", 6, 12) == Decimal(
        "12733763.455236751230092183"
    )
    assert inner_units_to_decimal("100000000000000000000", 6, 12) == Decimal("100")
    assert token_units_to_decimal("300000", 6) == Decimal("0.3")
    assert mca_fee_amount({RHEA_TOKEN_ID: "300000"}, default_config().rhea.assets[0], {}) == (
        Decimal("0.3")
    )
    assert mca_fee_amount({}, default_config().rhea.assets[0], {"USDC": "0.30"}) == Decimal("0.30")
    asset = default_config().rhea.assets[0]
    assert dapp_registration_fee_amount(asset, {"USDC": "0.30"}) == Decimal("0.30")
    assert dapp_registration_fee_amount(asset, {}) == Decimal(0)
    assert dapp_registration_fee_amount(asset, {"USDC": "not a number"}) == Decimal(0)


def test_custom_recipient_messages_match_the_rhea_sdk_wire() -> None:
    assert strip_0x("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045") == WALLET_NO_0X
    assert supply_message(WALLET) == {
        "w": [{"EVM": WALLET_NO_0X}],
        "b": {"r": "BurrowSupply"},
    }
    signed = register_message(WALLET, "0x" + "ab" * 65)
    assert signed["b"] == {"r": "BurrowRegisterAndSupply"}
    assert signed["s"] == ["ab" * 65]
    assert message_to_sign(WALLET) == f'[{{"EVM":"{WALLET_NO_0X}"}}]'
    assert custom_recipient_msg(supply_message(WALLET)) == (
        f'{{"w":[{{"EVM":"{WALLET_NO_0X}"}}],"b":{{"r":"BurrowSupply"}}}}'
    )


def test_messages_checksum_a_lowercased_session_wallet() -> None:
    """The web session lowercases the owner; the wire must carry the EIP-55 form."""
    lower = WALLET.lower()
    assert supply_message(lower)["w"][0]["EVM"] == WALLET_NO_0X
    assert message_to_sign(lower) == f'[{{"EVM":"{WALLET_NO_0X}"}}]'
    assert register_message(lower, "ab" * 65)["w"][0]["EVM"] == WALLET_NO_0X


def test_messages_reuse_a_wallet_form_matched_by_the_lookup() -> None:
    """A legacy lowercase registration must be addressed by its exact registered string."""
    lower = WALLET_NO_0X.lower()
    assert supply_message(WALLET, wallet_form=lower)["w"][0]["EVM"] == lower
    assert message_to_sign(WALLET, wallet_form=lower) == f'[{{"EVM":"{lower}"}}]'
    assert register_message(WALLET, "ab" * 65, wallet_form=lower)["w"][0]["EVM"] == lower


async def test_mca_lookup_uses_checksummed_address_for_a_lowercased_owner() -> None:
    """A checksummed hit must be the FIRST lookup, even when the session owner is lowercase."""
    seen: list[str] = []

    class Rpc:
        async def view(self, contract: str, method: str, args: dict[str, Any]) -> Any:
            seen.append(args["wallet"]["EVM"])
            return MCA if args["wallet"]["EVM"] == WALLET_NO_0X else None

    views = RheaViews(default_config().rhea, rpc=Rpc())  # type: ignore[arg-type]
    lookup = await views.mca_for_wallet(WALLET.lower())
    assert lookup.mca == MCA
    assert lookup.wallet_form == WALLET_NO_0X
    assert seen == [WALLET_NO_0X]


async def test_mca_lookup_falls_back_to_lowercase_registered_wallet() -> None:
    """A legacy lowercase-registered MCA is still an existing MCA (never a first deposit)."""
    seen: list[str] = []

    class Rpc:
        async def view(self, contract: str, method: str, args: dict[str, Any]) -> Any:
            seen.append(args["wallet"]["EVM"])
            return MCA if args["wallet"]["EVM"] == WALLET_NO_0X.lower() else None

    views = RheaViews(default_config().rhea, rpc=Rpc())  # type: ignore[arg-type]
    lookup = await views.mca_for_wallet(WALLET)
    assert lookup.mca == MCA
    assert lookup.wallet_form == WALLET_NO_0X.lower()
    assert seen == [WALLET_NO_0X, WALLET_NO_0X.lower()]


async def test_mca_lookup_miss_is_a_first_deposit() -> None:
    seen: list[str] = []

    class Rpc:
        async def view(self, contract: str, method: str, args: dict[str, Any]) -> Any:
            seen.append(args["wallet"]["EVM"])
            return None

    views = RheaViews(default_config().rhea, rpc=Rpc())  # type: ignore[arg-type]
    lookup = await views.mca_for_wallet(WALLET.lower())
    assert lookup.mca is None
    assert lookup.wallet_form == WALLET_NO_0X
    assert seen == [WALLET_NO_0X, WALLET_NO_0X.lower()]


async def test_mca_lookup_rpc_failure_raises_instead_of_assuming_first_deposit() -> None:
    class Rpc:
        async def view(self, contract: str, method: str, args: dict[str, Any]) -> Any:
            raise RheaRpcError("offline")

    views = RheaViews(default_config().rhea, rpc=Rpc())  # type: ignore[arg-type]
    with pytest.raises(RheaRpcError):
        await views.mca_for_wallet(WALLET.lower())


# ── previews ──────────────────────────────────────────────────────────────────


async def test_first_deposit_preview_shows_the_one_time_fee_and_message() -> None:
    service, calls = _service(FakeRheaViews(mca=None))
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
    )
    wire = outcome.block.to_wire()
    assert wire["type"] == "earn_quote"
    assert wire["rail"] == "oneclick_rhea"
    assert wire["protocol"] == "rhea"
    assert wire["firstDeposit"] is True
    assert wire["mca"] is None
    assert wire["recipient"] == "multica.near"
    # Both one-off Multica fees are disclosed and subtracted: create-MCA 0.30 + DApp 0.30.
    assert wire["oneTimeFee"]["amount"] == "0.60"
    assert wire["oneTimeFee"]["symbol"] == "USDC"
    assert "DApp registration" in wire["oneTimeFee"]["reason"]
    assert wire["netSupplied"] == "99.3808"
    assert wire["messageToSign"] == f'[{{"EVM":"{WALLET_NO_0X}"}}]'
    assert "BurrowRegisterAndSupply" in wire["customRecipientMsg"]
    assert wire["supplyApy"] == "14.05%"
    assert wire["source"]["contract"] == "contract.main.burrow.near"
    assert wire["source"]["field"] == "supply_apr"
    assert wire["withdraw"]["url"] == "https://app.rhea.finance/lending"
    assert calls and calls[0]["dry"] is True
    assert calls[0]["customRecipientMsg"] == wire["customRecipientMsg"]
    assert "0.60 USDC" in outcome.text
    assert "DApp registration fee" in outcome.text
    assert "99.3808" in outcome.text


async def test_existing_mca_preview_omits_the_fee_and_signs_nothing() -> None:
    service, calls = _service(FakeRheaViews(mca=MCA))
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
    )
    wire = outcome.block.to_wire()
    assert wire["firstDeposit"] is False
    assert wire["mca"] == MCA
    assert wire["recipient"] == MCA
    assert "oneTimeFee" not in wire
    assert "messageToSign" not in wire
    assert wire["netSupplied"] == "99.9808"
    assert "BurrowSupply" in wire["customRecipientMsg"]
    assert WALLET_NO_0X in wire["customRecipientMsg"]
    assert calls[0]["customRecipientMsg"] == wire["customRecipientMsg"]
    assert calls[0]["recipient"] == MCA
    assert calls[0]["refundTo"] == WALLET


async def test_existing_lowercase_mca_preview_reuses_the_matched_wallet_form() -> None:
    """A legacy lowercase registration must keep the lowercase string in every outgoing message."""
    lower = WALLET_NO_0X.lower()
    service, calls = _service(FakeRheaViews(mca=MCA, wallet_form=lower))
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET.lower(),
    )
    wire = outcome.block.to_wire()
    assert wire["firstDeposit"] is False
    assert wire["mca"] == MCA
    assert f'{{"EVM":"{lower}"}}' in wire["customRecipientMsg"]
    assert WALLET_NO_0X not in wire["customRecipientMsg"]
    assert calls[0]["customRecipientMsg"] == wire["customRecipientMsg"]


async def test_fee_read_failure_uses_the_configured_fallback() -> None:
    service, _ = _service(FakeRheaViews(mca=None, fail_fee=True))
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
    )
    assert outcome.block.to_wire()["oneTimeFee"]["amount"] == "0.60"


async def test_no_liquidity_is_an_unavailable_card_with_a_smaller_amount_hint() -> None:
    service, _ = _service(
        FakeRheaViews(),
        handler=lambda request: httpx.Response(400, json={"message": "No liquidity available"}),
    )
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("5000"),
        amount_raw=5_000_000_000,
        wallet=WALLET,
    )
    assert outcome.block.state == "unavailable"
    assert "smaller amount" in (outcome.block.unavailable_reason or "")


async def test_rpc_down_fails_closed_instead_of_assuming_a_first_deposit() -> None:
    stale = EarnSnapshot(
        fetched_at=datetime.now(UTC) - timedelta(hours=24),
        source="registry",
        vaults=(make_rhea_vault(),),
    )
    service, calls = _service(
        FakeRheaViews(mca=None, fail_mca=True, fail_fee=True), snapshot=stale
    )
    outcome = await service.preview_for(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
    )
    wire = outcome.block.to_wire()
    assert wire["state"] == "unavailable"
    assert "couldn't read your Rhea account" in (wire["unavailableReason"] or "")
    assert "firstDeposit" not in wire
    assert "messageToSign" not in wire
    assert calls == []  # never quote / prepare a first-deposit plan


# ── positions ─────────────────────────────────────────────────────────────────


def _portfolio(balance: str = "100000000000000000000", apr: str = "0.14") -> dict[str, Any]:
    return {
        "account_id": MCA,
        "supplied": [{"token_id": RHEA_TOKEN_ID, "balance": balance, "shares": "1", "apr": apr}],
        "positions": {},
    }


async def test_positions_without_an_mca_are_an_empty_explainer() -> None:
    service, _ = _service(FakeRheaViews(mca=None))
    outcome = await service.rhea_positions(wallet=WALLET)
    wire = outcome.block.to_wire()
    assert wire["type"] == "earn_positions"
    assert wire["state"] == "empty"
    assert wire["mca"] is None
    assert "first deposit" in wire["explainer"]
    assert wire["appUrl"] == "https://app.rhea.finance/lending"


async def test_positions_parse_inner_units_and_apy() -> None:
    service, _ = _service(FakeRheaViews(mca=MCA, portfolio=_portfolio()))
    outcome = await service.rhea_positions(wallet=WALLET)
    wire = outcome.block.to_wire()
    assert wire["state"] == "ready"
    assert wire["mca"] == MCA
    assert wire["supplied"] == [{"symbol": "USDC", "amount": "100", "apy": "14.00"}]
    assert wire["totalUsd"] == "100"
    assert wire["source"]["method"] == "get_account_all_positions"


async def test_unknown_mca_positions_are_an_honest_empty() -> None:
    service, _ = _service(FakeRheaViews(mca=MCA, portfolio=None))
    outcome = await service.rhea_positions(wallet=WALLET)
    wire = outcome.block.to_wire()
    assert wire["state"] == "empty"
    assert wire["mca"] == MCA
    assert "No supplied positions" in wire["explainer"]


async def test_positions_rpc_failure_is_unavailable_not_an_error() -> None:
    service, _ = _service(FakeRheaViews(fail_mca=True))
    outcome = await service.rhea_positions(wallet=WALLET)
    wire = outcome.block.to_wire()
    assert wire["state"] == "unavailable"
    assert "unavailable" in wire["unavailableReason"].lower()


# ── parser ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("prompt", "kind", "asset"),
    [
        ("Deposit 100 USDC into Rhea", "deposit", "USDC"),
        ("Supply 500 USDC on Rhea Finance lending", "deposit", "USDC"),
        ("Rhea APY for USDC", "list", "USDC"),
        ("What is the Rhea USDC supply APY?", "list", "USDC"),
        ("Show Rhea vaults", "list", None),
        ("Show my Rhea position", "positions", None),
        ("How do I withdraw from Rhea?", "withdraw", None),
        ("earn on Rhea", "list", None),
    ],
)
def test_rhea_parser_positives(prompt: str, kind: str, asset: str | None) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.protocol == "rhea"
    assert request.kind == kind
    assert request.chain == "near"
    assert request.asset == asset


@pytest.mark.parametrize(
    ("prompt", "kind", "asset"),
    [
        ("earn yield on NEAR", "list", None),
        ("where can I get yield on near?", "list", None),
        ("stake my USDC on NEAR", "list", "USDC"),
        ("NEAR lending", "list", None),
        ("best stablecoin yield on NEAR", "list", None),
        ("my NEAR yield", "positions", None),
        ("withdraw my NEAR yield", "withdraw", None),
    ],
)
def test_vague_near_yield_routes_to_rhea(prompt: str, kind: str, asset: str | None) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.protocol == "rhea"
    assert request.kind == kind
    assert request.chain == "near"
    assert request.asset == asset


def test_vague_near_yield_with_an_amount_is_a_rhea_deposit_preview() -> None:
    request = parse_earn_request("put 100 USDC to work on NEAR", default_config())
    assert request is not None
    assert request.protocol == "rhea"
    assert request.kind == "deposit"
    assert request.amount == Decimal("100")
    assert request.asset == "USDC"
    assert request.origin_chain is None


def test_disabled_rhea_asset_stays_a_usdc_only_list() -> None:
    request = parse_earn_request("Lend 50 USDT into Burrow", default_config())
    assert request is not None
    assert request.protocol == "rhea"
    assert request.kind == "list"
    assert request.asset == "USDT"


@pytest.mark.parametrize(
    "prompt",
    [
        "Compare Aave and Rhea, then deposit 500 USDC into the safer one.",
        "Is Rhea safer than Aave?",
        "Swap 100 USDC to Rhea",
        "Bridge 100 USDC to NEAR then deposit into Rhea",
        "deposit 100 USDC into the vault",
        "Deposit 100 USDC into Kamino",
        # Native NEAR-token staking is not Rhea lending and must not become a preview.
        "stake NEAR tokens",
        "liquid staking NEAR",
        "stake NEAR",
        # English "near" is not the chain.
        "What's the near-term yield on 2000 USDC?",
        "is ETH near the top for yield?",
    ],
)
def test_rhea_parser_negatives(prompt: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is None or request.protocol != "rhea"


@pytest.mark.parametrize(
    "prompt",
    [
        "stake NEAR tokens",
        "liquid staking NEAR",
        "stake NEAR",
    ],
)
def test_native_near_staking_is_detected(prompt: str) -> None:
    from sparkpoint_agent.earn.parse import is_near_native_staking_request

    assert is_near_native_staking_request(prompt) is True
    assert is_near_native_staking_request("stake my USDC on NEAR") is False


@pytest.mark.parametrize(
    ("prompt", "protocol"),
    [
        ("Deposit 100 USDC into Morpho", "morpho"),
        ("Show Kamino vaults", "kamino"),
        ("Deposit 100 USDC into Kamino SOL vault", "kamino"),
    ],
)
def test_other_protocol_phrasing_is_unchanged(prompt: str, protocol: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.protocol == protocol


@pytest.mark.parametrize(
    "prompt",
    [
        "Swap 100 USDC to SOL on Solana",
        "Bridge 100 USDC to NEAR then deposit into Rhea",
        "Compare Aave and Morpho, then deposit 500 USDC into the safer one.",
    ],
)
def test_swap_and_comparative_phrasing_is_unchanged(prompt: str) -> None:
    assert parse_earn_request(prompt, default_config()) is None


# ── chat (zero LLM) ───────────────────────────────────────────────────────────


class _ExplodingPlanner:
    calls = 0

    async def classify(self, *_: Any, **__: Any) -> Intent:
        type(self).calls += 1
        raise AssertionError("the Rhea path must not call the LLM planner")


class _Noop:
    async def propose(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")

    async def tip(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")

    async def read(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")

    async def active(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


def _dag(service: EarnService) -> CoordinatorDag:
    noop = _Noop()
    return CoordinatorDag(
        planner=_ExplodingPlanner(),
        recommender=noop,
        literacy=noop,
        portfolio_provider=noop,
        mandate_provider=noop,
        earn=service,
    )


def _chain() -> ChainContext:
    big = 10**15
    return ChainContext(
        chain_id=8453,
        user_account=WALLET,
        owner=WALLET,
        resolved_targets={},
        caps=CapHeadroom(per_user=big, total=big, vault=big),
    )


async def _collect(dag: CoordinatorDag, prompt: str) -> list[dict[str, Any]]:
    return [block.to_wire() async for block in dag.run_chat(prompt, _chain())]


async def test_deposit_into_rhea_emits_a_preview_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews(mca=None))
    wires = await _collect(_dag(service), "Deposit 100 USDC into Rhea")
    types = [wire["type"] for wire in wires]
    assert "text" in types and types[-1] == "earn_quote"
    assert wires[-1]["rail"] == "oneclick_rhea"
    assert wires[-1]["firstDeposit"] is True
    assert wires[-1]["mca"] is None
    assert _ExplodingPlanner.calls == 0


async def test_show_my_rhea_positions_emits_the_positions_block_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews(mca=MCA, portfolio=_portfolio()))
    wires = await _collect(_dag(service), "Show my Rhea positions")
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_positions"
    assert wires[-1]["state"] == "ready"
    assert wires[-1]["supplied"][0]["symbol"] == "USDC"


async def test_vague_near_yield_emits_the_rhea_list_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews())
    wires = await _collect(_dag(service), "earn yield on NEAR")
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_vaults"
    assert wires[-1]["state"] == "ready"
    assert wires[-1]["vaults"][0]["name"] == "Rhea Lending USDC"
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    lower = text.lower()
    assert "rhea lending is the supported near yield" in lower
    assert "usdc only for now" in lower
    assert "deposit preview" in lower
    assert "isn't supported yet" not in lower
    assert _ExplodingPlanner.calls == 0


async def test_vague_near_yield_with_an_amount_is_the_rhea_preview() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews(mca=None))
    wires = await _collect(_dag(service), "put 100 USDC to work on NEAR")
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_quote"
    assert wires[-1]["rail"] == "oneclick_rhea"
    assert wires[-1]["protocol"] == "rhea"
    assert wires[-1]["amountIn"] == "100"
    assert _ExplodingPlanner.calls == 0


async def test_my_near_yield_is_a_positions_turn() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews(mca=MCA, portfolio=_portfolio()))
    wires = await _collect(_dag(service), "my NEAR yield")
    assert wires[-1]["type"] == "earn_positions"
    assert wires[-1]["state"] == "ready"
    assert _ExplodingPlanner.calls == 0


async def test_native_near_staking_is_not_a_rhea_preview() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews())
    wires = await _collect(_dag(service), "stake NEAR tokens")
    types = [wire["type"] for wire in wires]
    assert "earn_quote" not in types and "earn_vaults" not in types
    text = "\n".join(wire.get("markdown", "") for wire in wires).lower()
    assert "near-token staking isn't supported" in text
    assert "rhea lending" in text
    assert "usdc only" in text
    assert _ExplodingPlanner.calls == 0


async def test_usdt_on_near_stays_disabled() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews())
    wires = await _collect(_dag(service), "best USDT yield on NEAR")
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_vaults"
    assert wires[-1]["state"] == "unavailable"
    text = "\n".join(wire.get("markdown", "") for wire in wires).lower()
    assert "usdc only for now" in text
    assert "usdt isn't enabled" in text
    assert _ExplodingPlanner.calls == 0
    assert _ExplodingPlanner.calls == 0


async def test_rhea_withdraw_question_links_out_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    service, _ = _service(FakeRheaViews())
    wires = await _collect(_dag(service), "How do I withdraw from Rhea?")
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert "app.rhea.finance/lending" in text
    assert "nothing was signed or sent" in text
    assert _ExplodingPlanner.calls == 0


async def test_dry_placeholder_signature_is_hex_without_0x() -> None:
    assert len(DRY_PLACEHOLDER_SIGNATURE) == 130
    assert not DRY_PLACEHOLDER_SIGNATURE.startswith("0x")


# ── HTTP surface ──────────────────────────────────────────────────────────────

from fastapi import FastAPI  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from sparkpoint_agent.api.earn import (  # noqa: E402
    get_earn_limiter,
    get_earn_service,
    get_rhea_wallet,
    router,
)
from sparkpoint_agent.api.errors import (  # noqa: E402
    ApiError,
    api_error_handler,
    validation_error_handler,
)
from sparkpoint_agent.api.security import AccountContext  # noqa: E402
from sparkpoint_agent.api.vault import get_account  # noqa: E402


class _AllowAll:
    def allow(self, key: Any) -> bool:
        return True


@pytest.fixture
def rhea_api() -> tuple[TestClient, FakeRheaViews]:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)
    views = FakeRheaViews(mca=MCA, portfolio=_portfolio())
    service, _ = _service(views)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=WALLET, owner=WALLET, chain_id=8453
    )
    app.dependency_overrides[get_earn_service] = lambda: service
    app.dependency_overrides[get_earn_limiter] = lambda: _AllowAll()
    app.dependency_overrides[get_rhea_wallet] = lambda: WALLET
    return TestClient(app), views


def test_api_positions_uses_the_session_wallet_not_a_query_param(
    rhea_api: tuple[TestClient, FakeRheaViews],
) -> None:
    client, views = rhea_api
    response = client.get(f"/earn/rhea/positions?wallet=0x{'9' * 40}")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "earn_positions"
    assert body["state"] == "ready"
    assert body["mca"] == MCA
    assert views.wallets == [WALLET]


def test_api_positions_rejects_an_empty_session_wallet(
    rhea_api: tuple[TestClient, FakeRheaViews],
) -> None:
    client, _ = rhea_api
    client.app.dependency_overrides[get_rhea_wallet] = lambda: ""
    response = client.get("/earn/rhea/positions")
    assert response.status_code == 400


def test_api_vaults_filters_rhea_rows(
    rhea_api: tuple[TestClient, FakeRheaViews],
) -> None:
    client, _ = rhea_api
    response = client.get("/earn/vaults?chain=near&protocol=rhea")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    vault = body["vaults"][0]
    assert vault["protocol"] == "rhea"
    assert vault["address"] == RHEA_TOKEN_ID
    assert vault["rails"]["available"] == ["oneclick_rhea"]
    by_rail = client.get("/earn/vaults?rail=oneclick_rhea")
    assert by_rail.status_code == 200 and by_rail.json()["count"] == 1
    assert client.get("/earn/vaults?protocol=bogus").status_code == 400


def test_api_preview_rhea_is_dry_only(
    rhea_api: tuple[TestClient, FakeRheaViews],
) -> None:
    client, _ = rhea_api
    first_deposit_service, _ = _service(FakeRheaViews(mca=None))
    client.app.dependency_overrides[get_earn_service] = lambda: first_deposit_service
    body = {
        "chain": "near",
        "vaultAddress": RHEA_TOKEN_ID,
        "originKey": "base:USDC",
        "amount": "100",
    }
    response = client.post("/earn/preview", json=body)
    assert response.status_code == 200
    wire = response.json()
    assert wire["rail"] == "oneclick_rhea"
    assert wire["firstDeposit"] is True
    assert wire["mca"] is None
    assert wire["oneTimeFee"]["amount"] == "0.60"
    assert wire["messageToSign"]

    live = client.post("/earn/preview", json={**body, "dry": False})
    assert live.status_code == 400


async def test_a_near_account_id_reads_burrow_without_an_mca_lookup() -> None:
    near = "sparkpoint2026.near"
    views = FakeRheaViews(mca=None, portfolio=_portfolio())
    service, _ = _service(views)

    outcome = await service.rhea_positions(wallet=near, account_id=near)

    wire = outcome.block.to_wire()
    assert wire["state"] == "ready"
    assert wire["mca"] == near
    assert views.wallets == []  # no EVM-keyed MCA lookup for a NEAR sign-in
