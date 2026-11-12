# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""Vault/yield chat answers come from the live earn snapshot across every chain.

The /vault board renders ``EarnService.list_vaults`` (Kamino/Solana, Rhea/NEAR, Morpho/Base).
A "best vault / what's paying / which vaults are live" question must answer from that same
snapshot instead of the per-connected-chain curated store, which can be empty in production.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.coordinator.curated import CuratedContext, CuratedPick
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    PortfolioView,
)
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.registry import (
    EarnRegistry,
    EarnSnapshot,
    VaultAsset,
    VaultEntry,
)
from sparkpoint_agent.earn.service import EarnService
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import CapHeadroom

USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15
FETCHED = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)

PICK = CuratedPick(
    address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    label="Gauntlet USDC Prime",
    net_apy_bps=441,
    tvl_usd=420_747_952.0,
    curator="Gauntlet",
    curator_verified=True,
    reason="the stored pick",
    as_of="2026-09-18T00:05:00+00:00",
    wrapped=False,
)


class _CountingStructuredLlm:
    """A classifier whose call count proves the deterministic route fired FIRST."""

    def __init__(self) -> None:
        self.calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.calls += 1
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="prose", stop_reason="end_turn")


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="250.00")


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return MandateView(version=1)


class _NoMandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


def _vault(
    *,
    chain: str,
    chain_id: int,
    address: str,
    name: str,
    protocol: str,
    asset: str,
    apy: str | None,
    tvl: str | None,
) -> VaultEntry:
    return VaultEntry(
        chain=chain,
        chain_id=chain_id,
        address=address,
        version="v1",
        name=name,
        symbol=asset,
        asset=VaultAsset(address=address, symbol=asset, decimals=6),
        listed=True,
        tvl_usd=Decimal(tvl) if tvl is not None else None,
        net_apy=Decimal(apy) if apy is not None else None,
        source="test",
        fetched_at="2026-11-12T12:00:00+00:00",
        protocol=protocol,
    )


def _snapshot(*vaults: VaultEntry) -> EarnSnapshot:
    return EarnSnapshot(fetched_at=FETCHED, source="test", vaults=tuple(vaults))


def _cross_chain_snapshot() -> EarnSnapshot:
    return _snapshot(
        _vault(
            chain="sol",
            chain_id=0,
            address="DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
            name="SOL Balanced",
            protocol="kamino",
            asset="SOL",
            apy="0.0445",
            tvl="2443425.6",
        ),
        _vault(
            chain="near",
            chain_id=0,
            address="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
            name="Rhea Lending USDC",
            protocol="rhea",
            asset="USDC",
            apy="0.1405",
            tvl="12733763.455236751",
        ),
        _vault(
            chain="base",
            chain_id=8453,
            address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
            name="Gauntlet USDC Prime",
            protocol="morpho",
            asset="USDC",
            apy="0.0441",
            tvl="420000000",
        ),
    )


def _service(snapshot: EarnSnapshot | None = None) -> EarnService:
    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(snapshot if snapshot is not None else _cross_chain_snapshot())
    client = OneClickClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
        clock=lambda: 1000.0,
    )
    return EarnService(config, registry, oneclick=client)


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
    )


def _dag(
    earn: EarnService | None,
    curated: Any = None,
    planner: _CountingStructuredLlm | None = None,
    mandate: Any = None,
) -> tuple[CoordinatorDag, _CountingStructuredLlm]:
    classifier = planner or _CountingStructuredLlm()
    dag = CoordinatorDag(
        planner=Planner(llm=classifier),
        recommender=Recommender(llm=classifier),
        literacy=Literacy(llm=_CompleteLlm()),
        portfolio_provider=_Portfolio(),
        mandate_provider=mandate if mandate is not None else _Mandate(),
        curated=curated,
        earn=earn,
    )
    return dag, classifier


async def _run(dag: CoordinatorDag, message: str) -> list[dict[str, Any]]:
    return [block.to_wire() async for block in dag.run_chat(message, _chain())]


def _text(wires: list[dict[str, Any]]) -> str:
    return "\n".join(wire["markdown"] for wire in wires if wire["type"] == "text")


async def _empty_curated(_chain_id: int) -> CuratedContext:
    return CuratedContext(vault_count=0)


async def test_highest_yield_answers_from_the_live_snapshot_across_every_chain() -> None:
    dag, classifier = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "what is the vault that offers the highest yield?")
    text = _text(wires)

    assert classifier.calls == 0, "a live-snapshot vault question must not need the classifier"
    assert "Rhea Lending USDC" in text
    assert "SOL Balanced" in text and "Gauntlet USDC Prime" in text
    assert "NEAR" in text and "Solana" in text and "Base" in text
    assert "14.05% net APY" in text
    assert "/vault" in text
    assert "I suggest; you choose and sign." in text
    assert "no curated vaults" not in text.lower()
    assert text.index("Rhea Lending USDC") < text.index("SOL Balanced")
    assert text.index("Rhea Lending USDC") < text.index("Gauntlet USDC Prime")
    assert "earn_vaults" in {wire["type"] for wire in wires}


async def test_rate_question_names_the_top_vault_and_keeps_the_caveat() -> None:
    dag, classifier = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "what's the vault paying now?")
    text = _text(wires)

    assert classifier.calls == 0
    assert "Rhea Lending USDC" in text
    assert "14.05% net APY" in text
    assert "estimate, not a promise" in text
    assert "/vault" in text
    assert "no curated vaults" not in text.lower()


async def test_list_question_counts_every_chain_and_links_the_board() -> None:
    dag, classifier = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "which vaults are available right now?")
    text = _text(wires)

    assert classifier.calls == 0
    assert "3 live vaults across every chain" in text
    assert "Kamino" in text and "Rhea" in text and "Morpho" in text
    assert "/vault" in text
    assert "no curated vaults" not in text.lower()


async def test_a_named_chain_filters_to_that_chain() -> None:
    dag, _ = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "what's the highest yield vault on Solana?")
    text = _text(wires)

    assert "SOL Balanced" in text
    assert "Kamino" in text and "Solana" in text
    assert "Rhea Lending USDC" not in text
    assert "Gauntlet USDC Prime" not in text
    assert "14.05% net APY" not in text
    assert "/vault" in text


async def test_an_empty_live_snapshot_falls_back_to_the_curated_store() -> None:
    async def curated(_chain_id: int) -> CuratedContext:
        return CuratedContext(vault_count=1, pick=PICK)

    dag, classifier = _dag(_service(_snapshot()), curated=curated)
    wires = await _run(dag, "what's the best vault right now?")
    text = _text(wires)

    assert "Gauntlet USDC Prime" in text
    assert "4.41%" in text
    assert "earn_vaults" not in {wire["type"] for wire in wires}
    assert classifier.calls == 0


async def test_a_command_with_an_amount_is_not_hijacked_by_the_live_snapshot() -> None:
    dag, classifier = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "deposit 100 USDC into the safest vault")

    assert "earn_vaults" not in {wire["type"] for wire in wires}
    assert "SOL Balanced" not in _text(wires)
    assert classifier.calls >= 1, "a command must reach the normal intent path"


async def test_highest_yield_without_the_word_vault_still_uses_the_snapshot() -> None:
    dag, classifier = _dag(_service(), curated=_empty_curated)
    wires = await _run(dag, "highest yield on Solana?")
    text = _text(wires)

    assert classifier.calls == 0
    assert "SOL Balanced" in text
    assert "Rhea Lending USDC" not in text


async def test_yield_guidance_options_come_from_the_live_snapshot_not_the_empty_store() -> None:
    dag, _ = _dag(_service(), curated=_empty_curated, mandate=_NoMandate())
    wires = await _run(dag, "How can I earn yield on my USDC?")
    text = _text(wires)

    assert "Live vault options across every chain" in text
    assert "Rhea Lending USDC" in text
    assert "/vault" in text
    assert "no curated vaults" not in text.lower()


def test_apy_text_is_truncated_to_two_decimals_like_the_card() -> None:
    from sparkpoint_agent.coordinator.earn_vaults import format_apy_percent

    assert format_apy_percent("10.027866896025435") == "10.02%"
    assert format_apy_percent("8.999578476047444") == "8.99%"
    assert format_apy_percent("4.4") == "4.40%"
    assert format_apy_percent(None) is None
    assert format_apy_percent("n/a") is None


def test_vault_rows_are_separate_paragraphs_for_the_chat_renderer() -> None:
    from sparkpoint_agent.coordinator import earn_vaults

    class _Cfg:
        def chain(self, key: str) -> None:
            return None

    rows = [
        {"name": "A", "protocol": "rhea", "chain": "near", "netApy": "10.1", "tvlUsd": 1000},
        {"name": "B", "protocol": "morpho", "chain": "base", "netApy": "9.1", "tvlUsd": 1000},
    ]
    lines = earn_vaults._bullets(_Cfg(), rows)  # type: ignore[arg-type]
    text = "\n".join(lines)
    assert "\n\n- " in text
    assert len([line for line in lines if line.startswith("- ")]) == 2
