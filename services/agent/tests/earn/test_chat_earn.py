# ruff: noqa: S101
"""069 — the chat hook answers Morpho list/deposit requests before the planner (zero LLM)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

import httpx

from sparkpoint_agent.agents.planner import Intent, IntentKind
from sparkpoint_agent.coordinator.dag import ChainContext, CoordinatorDag
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.registry import EarnRegistry
from sparkpoint_agent.earn.service import EarnService
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.portfolio.models import PortfolioRow, PortfolioSection

from .helpers import make_snapshot, make_vault

USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15
VAULT = make_vault()


class _ExplodingPlanner:
    calls = 0

    async def classify(self, *_: Any, **__: Any) -> Intent:
        type(self).calls += 1
        raise AssertionError("the earn path must not call the LLM planner")


class _CountingPlanner:
    def __init__(self) -> None:
        self.calls = 0

    async def classify(self, *_: Any, **__: Any) -> Intent:
        self.calls += 1
        return Intent(kind=IntentKind.OTHER)


class _NoopRecommender:
    async def propose(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopLiteracy:
    async def tip(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopPortfolio:
    async def read(self, chain: ChainContext) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopMandate:
    async def active(self, chain: ChainContext) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _ExplodingPositions:
    """Fails loudly if a non-EVM session ever reaches the EVM Morpho position read."""

    async def collect(self, wallet: str) -> PortfolioSection:
        raise AssertionError(f"Morpho positions must not be read for a NEAR session: {wallet!r}")


class _HeldMorpho:
    """A stand-in for the 072 Morpho position reader (no network)."""

    def __init__(self, rows: tuple[PortfolioRow, ...] = ()) -> None:
        self.rows = rows
        self.status = "ok"
        self.reason: str | None = None

    async def collect(self, wallet: str) -> PortfolioSection:
        return PortfolioSection(
            key="morpho",
            label="Morpho",
            status=self.status,  # type: ignore[arg-type]
            rows=self.rows if self.status == "ok" else (),
            reason=self.reason,
            source="morpho_api",
        )


def held_row(
    vault: Any = VAULT,
    *,
    asset: str = "USDC",
    amount: str = "100",
    chain: str = "base",
    name: str | None = None,
) -> PortfolioRow:
    return PortfolioRow(
        chain=chain,
        chain_label=chain,
        protocol="morpho",
        kind="vault_position",
        symbol=vault.symbol,
        amount=amount,
        extra={
            "vaultAddress": vault.address,
            "vaultName": name or vault.name,
            "assetSymbol": asset,
            "decimals": vault.asset.decimals,
        },
    )


def _service(
    handler: Any = None,
    *,
    held: tuple[PortfolioRow, ...] | None = None,
    positions: _HeldMorpho | None = None,
) -> EarnService:
    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(VAULT))
    client = OneClickClient(
        transport=httpx.MockTransport(handler or (lambda request: httpx.Response(500))),
        clock=lambda: 1000.0,
    )
    reader = positions if positions is not None else _HeldMorpho(
        held if held is not None else (held_row(),)
    )
    return EarnService(config, registry, oneclick=client, morpho_positions=reader)


def _dag(service: EarnService | None, planner: Any) -> CoordinatorDag:
    return CoordinatorDag(
        planner=planner,
        recommender=_NoopRecommender(),
        literacy=_NoopLiteracy(),
        portfolio_provider=_NoopPortfolio(),
        mandate_provider=_NoopMandate(),
        earn=service,
    )


def _chain(chain_id: int = 8453, *, auth_chain: str = "evm") -> ChainContext:
    return ChainContext(
        chain_id=chain_id,
        user_account=USER,
        owner=USER,
        auth_chain=auth_chain,
        resolved_targets={},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
    )


async def _collect(
    dag: CoordinatorDag,
    prompt: str,
    *,
    chain_id: int = 8453,
    auth_chain: str = "evm",
) -> list[dict[str, Any]]:
    return [
        block.to_wire()
        async for block in dag.run_chat(prompt, _chain(chain_id, auth_chain=auth_chain))
    ]


async def test_show_morpho_vaults_emits_a_list_block_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(_dag(_service(), _ExplodingPlanner()), "Show Morpho vaults on Base")
    types = [wire["type"] for wire in wires]
    assert "text" in types and types[-1] == "earn_vaults"
    assert wires[-1]["state"] == "ready"
    assert wires[-1]["vaults"][0]["name"] == "Gauntlet USDC Prime"
    assert _ExplodingPlanner.calls == 0


async def test_deposit_into_a_named_morpho_vault_emits_a_direct_preview() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_service(), _ExplodingPlanner()),
        "Deposit 100 USDC into Morpho Gauntlet USDC Prime",
    )
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_quote"
    assert wires[-1]["state"] == "preview"
    assert wires[-1]["rail"] == "direct"
    assert _ExplodingPlanner.calls == 0


async def test_a_generic_vault_deposit_is_not_stolen() -> None:
    planner = _CountingPlanner()
    wires = await _collect(_dag(_service(), planner), "deposit 100 USDC into the vault")
    assert "earn_quote" not in {wire["type"] for wire in wires}
    assert "earn_vaults" not in {wire["type"] for wire in wires}
    assert planner.calls == 1


async def test_a_comparative_command_is_not_stolen() -> None:
    planner = _CountingPlanner()
    wires = await _collect(
        _dag(_service(), planner),
        "Compare Aave and Morpho, then deposit 500 USDC into the safer one.",
    )
    assert "earn_quote" not in {wire["type"] for wire in wires}
    assert planner.calls == 1


async def test_feature_flag_off_and_no_service_fall_through() -> None:
    disabled = replace(default_config(), feature_enabled=False)
    registry = EarnRegistry(disabled, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(VAULT))
    service = EarnService(
        disabled,
        registry,
        oneclick=OneClickClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(500))
        ),
    )
    planner = _CountingPlanner()
    wires = await _collect(_dag(service, planner), "Show Morpho vaults on Base")
    assert "earn_vaults" not in {wire["type"] for wire in wires}
    assert planner.calls == 1

    planner2 = _CountingPlanner()
    wires = await _collect(_dag(None, planner2), "Show Morpho vaults on Base")
    assert "earn_vaults" not in {wire["type"] for wire in wires}
    assert planner2.calls == 1


async def test_a_transport_error_in_a_cross_chain_deposit_is_friendly_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    wires = await _collect(
        _dag(_service(handler), _ExplodingPlanner()),
        "Deposit 100 USDC from Ethereum into Morpho Gauntlet USDC Prime",
    )
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert "couldn't reach" in text
    assert "Traceback" not in text


def _quote_payload() -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "100000000",
            "amountInFormatted": "100",
            "amountInUsd": "100.0",
            "amountOut": "983500000",
            "amountOutFormatted": "0.9835",
            "amountOutUsd": "99.2",
            "minAmountOut": "970000000",
            "timeEstimate": 47,
        },
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


def _kamino_service() -> EarnService:
    from .helpers import make_kamino_vault

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(make_kamino_vault(), VAULT))
    client = OneClickClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(201, json=_quote_payload())
        ),
        clock=lambda: 1000.0,
    )
    return EarnService(config, registry, oneclick=client)


async def test_show_kamino_vaults_emits_a_list_block_without_the_llm() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(_dag(_kamino_service(), _ExplodingPlanner()), "Show Kamino vaults")
    types = [wire["type"] for wire in wires]
    assert "text" in types and types[-1] == "earn_vaults"
    assert wires[-1]["state"] == "ready"
    assert wires[-1]["vaults"][0]["name"] == "SOL Balanced"
    assert wires[-1]["vaults"][0]["protocol"] == "kamino"
    assert _ExplodingPlanner.calls == 0


async def test_deposit_into_kamino_sol_vault_emits_a_native_shares_preview() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_kamino_service(), _ExplodingPlanner()),
        "Deposit 100 USDC into Kamino SOL vault",
    )
    types = [wire["type"] for wire in wires]
    assert types[-1] == "earn_quote"
    assert wires[-1]["state"] == "preview"
    assert wires[-1]["rail"] == "oneclick_earn"
    assert wires[-1]["receiptKind"] == "native_shares"
    assert wires[-1]["walletSupport"]["recipient"] == "paste_solana_address"
    assert _ExplodingPlanner.calls == 0


async def test_withdraw_from_morpho_on_base_routes_to_the_live_withdraw_card() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_service(), _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_quote"
    assert wires[-1]["protocol"] == "morpho"
    url = wires[-1]["withdraw"]["url"]
    assert url.startswith("/vault/live?")
    assert "protocol=morpho" in url
    assert "chain=base" in url
    assert "asset=USDC" in url
    assert "mode=withdraw" in url
    assert "amount=0.5" in url
    assert _ExplodingPlanner.calls == 0


async def test_withdraw_from_kamino_on_solana_routes_to_the_live_withdraw_card() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_kamino_service(), _ExplodingPlanner()),
        "withdraw 0.01 SOL from Kamino on Solana",
    )
    assert wires[-1]["type"] == "earn_quote"
    assert wires[-1]["protocol"] == "kamino"
    url = wires[-1]["withdraw"]["url"]
    assert "protocol=kamino" in url
    assert "chain=sol" in url
    assert "asset=SOL" in url
    assert "mode=withdraw" in url
    assert "amount=0.01" in url
    assert _ExplodingPlanner.calls == 0


async def test_withdraw_a_named_non_matching_asset_does_not_link_the_usdc_vault() -> None:
    # The snapshot only has the USDC default; naming CBBTC must NOT deep-link to that USDC vault
    # with "5" misread as 5 USDC. It degrades to the honest "no such vault" outcome.
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_service(), _ExplodingPlanner()),
        "withdraw 5 CBBTC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_vaults"
    assert wires[-1]["state"] == "unavailable"
    assert "withdraw" not in wires[-1]
    assert _ExplodingPlanner.calls == 0


async def test_withdraw_a_named_asset_resolves_that_vault_not_the_default() -> None:
    from .helpers import make_vault

    cbbtc = make_vault(
        address="0x0000000000000000000000000000000000000cbb",
        name="Moonwell Flagship cbBTC",
        symbol="MWCBBTC",
        asset="cbBTC",
        tvl=1,
    )
    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(VAULT, cbbtc))  # USDC default has the far larger TVL
    client = OneClickClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
        clock=lambda: 1000.0,
    )
    service = EarnService(
        config,
        registry,
        oneclick=client,
        morpho_positions=_HeldMorpho((held_row(cbbtc, asset="cbBTC", amount="5"),)),
    )
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 5 cbBTC from Morpho on Base",
    )
    url = wires[-1]["withdraw"]["url"]
    assert f"vault={cbbtc.address}" in url
    assert "asset=cbBTC" in url
    assert "amount=5" in url


async def test_withdraw_without_a_named_asset_uses_the_default_without_a_prefilled_amount() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_service(), _ExplodingPlanner()),
        "withdraw everything from Morpho on Base",
    )
    url = wires[-1]["withdraw"]["url"]
    assert f"vault={VAULT.address}" in url
    assert "mode=withdraw" in url
    assert "amount=" not in url
    assert _ExplodingPlanner.calls == 0


def _two_usdc_service(*held_rows: PortfolioRow, positions: Any = None) -> EarnService:
    bigger = make_vault(
        address="0x0000000000000000000000000000000000000b16",
        name="Grove x Steakhouse USDC",
        symbol="grove-steakUSDC",
        asset="USDC",
        tvl=Decimal("999000000"),
    )
    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(VAULT, bigger))  # the larger-TVL vault is NOT held
    client = OneClickClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
        clock=lambda: 1000.0,
    )
    return EarnService(
        config,
        registry,
        oneclick=client,
        morpho_positions=positions if positions is not None else _HeldMorpho(held_rows),
    )


async def test_withdraw_picks_the_held_vault_not_the_larger_tvl_vault() -> None:
    # 1111 regression: prod linked Grove (0xbeef…, larger TVL) although the wallet only held the
    # smaller Gauntlet USDC Prime (0xeE8F…). Selection must follow the ACTUAL held position.
    _ExplodingPlanner.calls = 0
    service = _two_usdc_service(held_row(VAULT))
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_quote"
    url = wires[-1]["withdraw"]["url"]
    assert f"vault={VAULT.address}" in url
    assert "0x0000000000000000000000000000000000000b16" not in url
    assert "amount=0.5" in url
    assert _ExplodingPlanner.calls == 0


async def test_multiple_held_matching_vaults_are_not_auto_picked() -> None:
    second = make_vault(
        address="0x0000000000000000000000000000000000000b16",
        name="Grove x Steakhouse USDC",
        symbol="grove-steakUSDC",
        asset="USDC",
        tvl=Decimal("999000000"),
    )
    service = _two_usdc_service(
        held_row(VAULT), held_row(second, name="Grove x Steakhouse USDC")
    )
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_vaults"
    assert wires[-1]["state"] == "ready"
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert VAULT.address in text
    assert second.address in text
    assert "won't guess" in text
    assert "earn_quote" not in {wire["type"] for wire in wires}


async def test_no_held_matching_vault_is_honest_and_links_nothing() -> None:
    service = _two_usdc_service()
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_vaults"
    assert wires[-1]["state"] == "unavailable"
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert "don't see a USDC Morpho position on Base" in text
    assert "Nothing was signed or sent" in text
    assert "earn_quote" not in {wire["type"] for wire in wires}


async def test_unreadable_positions_fail_closed_without_a_vault() -> None:
    reader = _HeldMorpho()
    reader.status = "unavailable"
    reader.reason = "Morpho API is unreachable"
    service = _two_usdc_service(positions=reader)
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
    )
    assert wires[-1]["type"] == "earn_vaults"
    assert wires[-1]["state"] == "unavailable"
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert "Morpho API is unreachable" in text
    assert "won't guess" in text
    assert "earn_quote" not in {wire["type"] for wire in wires}


async def test_near_session_morpho_withdraw_fails_closed_without_an_evm_read() -> None:
    service = _two_usdc_service(positions=_ExplodingPositions())
    wires = await _collect(
        _dag(service, _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
        auth_chain="near",
    )
    assert wires[-1]["type"] == "earn_vaults"
    assert wires[-1]["state"] == "unavailable"
    text = "\n".join(wire.get("markdown", "") for wire in wires).lower()
    assert "near" in text and "evm" in text
    assert "earn_quote" not in {wire["type"] for wire in wires}


async def test_kamino_deposit_in_sol_is_not_misparsed_as_a_usd_stable() -> None:
    _ExplodingPlanner.calls = 0
    wires = await _collect(
        _dag(_kamino_service(), _ExplodingPlanner()),
        "deposit 0.015 SOL into Kamino",
    )
    assert wires[-1]["type"] == "earn_quote"
    assert wires[-1]["vault"]["chain"] == "sol"
    assert wires[-1]["vault"]["asset"]["symbol"] == "SOL"
    assert wires[-1]["amountIn"] == "0.015"
    assert _ExplodingPlanner.calls == 0


async def test_explicit_chain_overrides_the_request_header_chain() -> None:
    # The prod session header was 4663 (Robinhood) while the user said "on Base"; the parser must
    # honour the explicit chain, not the header, or the withdraw dead-ends on the wrong network.
    wires = await _collect(
        _dag(_service(), _ExplodingPlanner()),
        "withdraw 0.5 USDC from Morpho on Base",
        chain_id=4663,
    )
    assert wires[-1]["type"] == "earn_quote"
    assert wires[-1]["protocol"] == "morpho"
    assert "chain=base" in wires[-1]["withdraw"]["url"]
