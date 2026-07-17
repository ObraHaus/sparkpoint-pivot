# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Integration tests for the Coordinator DAG (coordinator/dag.py).

The LLM agents are MOCKED (canned StructuredResult/LlmResult) and the read providers are
in-memory, but the policy GATE is the REAL ``policy.evaluate`` — so these assert the
custody-critical control flow end to end:

  - the deterministic stage order understand → gather → propose → policy_gate → assemble;
  - a ROGUE / out-of-policy proposal (an over-cap amount the "model" extracted) is stamped
    ``rejected`` by the deterministic gate and rendered with NO sign path (non-custody);
  - /recommendations surfaces ONLY policy-cleared strategies (FR-016), ranked dense;
  - the surface stays deterministic and its ``tool_step`` labels are code-authored
    (summarized trace, never raw chain-of-thought);
  - refusals and literacy/portfolio routes are handled without ever proposing an action.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender, _Rank
from sparkpoint_agent.coordinator.chat_blocks import PositionLite
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom

VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15

_TOOL_LABELS = {
    "Understanding your request",
    "Explaining that",
    "Reading your portfolio",
    "Checking strategies against your guardrails",
}


# ── fakes ─────────────────────────────────────────────────────────────────────


class _StructuredLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.calls: list[Any] = []

    async def structured(self, *, messages: Any, **_: Any) -> StructuredResult[Any]:
        self.calls.append(messages)
        return self._result


class _CompleteLlm:
    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text=self._text, stop_reason="end_turn")


class _Portfolio:
    def __init__(self, view: PortfolioView) -> None:
        self._view = view
        self.reads = 0

    async def read(self, chain: ChainContext) -> PortfolioView:
        self.reads += 1
        return self._view


class _Mandate:
    def __init__(self, view: MandateView | None) -> None:
        self._view = view

    async def active(self, chain: ChainContext) -> MandateView | None:
        return self._view


def _seq_ids() -> Any:
    counter = {"n": 0}

    def factory() -> str:
        counter["n"] += 1
        return f"rec_{counter['n']}"

    return factory


def _ranking() -> dict[ActionType, _Rank]:
    return {
        ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit into the vault", rationale="steady"),
        ActionType.AAVE_SUPPLY: _Rank(rank=2, title="Supply to Aave", rationale="raw yield"),
    }


def _dag(
    *,
    intent: Intent | None = None,
    planner_refused: bool = False,
    reco: StructuredResult[Any] | None = None,
    portfolio: PortfolioView | None = None,
    mandate: MandateView | None = None,
) -> CoordinatorDag:
    if planner_refused:
        planner_result: StructuredResult[Any] = StructuredResult(ok=False, refused=True)
    else:
        planner_result = StructuredResult(ok=True, value=intent)
    reco_result = reco if reco is not None else StructuredResult(ok=True, value=_ranking())
    return CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(planner_result)),
        recommender=Recommender(llm=_StructuredLlm(reco_result)),
        literacy=Literacy(llm=_CompleteLlm("APY is your yearly yield.")),
        portfolio_provider=_Portfolio(portfolio or PortfolioView()),
        mandate_provider=_Mandate(mandate),
        id_factory=_seq_ids(),
    )


def _chain(*, per_user: int = BIG, market: MarketData | None = None) -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=per_user, total=BIG, vault=BIG),
        market=market or MarketData(gross_apy_bps=421, projected_apy_bps=379),
    )


async def _collect(dag: CoordinatorDag, message: str, chain: ChainContext) -> list[dict[str, Any]]:
    return [block.to_wire() async for block in dag.run_chat(message, chain)]


def _types(wires: list[dict[str, Any]]) -> list[str]:
    return [w["type"] for w in wires]


def _assert_labels_are_code_authored(wires: list[dict[str, Any]]) -> None:
    for wire in wires:
        if wire["type"] == "tool_step":
            assert wire["label"] in _TOOL_LABELS, f"unexpected tool_step label: {wire['label']}"


# ── run_chat: LEARN ───────────────────────────────────────────────────────────


async def test_chat_learn_emits_tip_and_never_reads_portfolio() -> None:
    portfolio = _Portfolio(PortfolioView())
    dag = CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(
            StructuredResult(ok=True, value=Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
        )),
        recommender=Recommender(llm=_StructuredLlm(StructuredResult(ok=False))),
        literacy=Literacy(llm=_CompleteLlm("APY is your yearly yield.")),
        portfolio_provider=portfolio,
        mandate_provider=_Mandate(None),
        id_factory=_seq_ids(),
    )
    wires = [b.to_wire() async for b in dag.run_chat("what is APY?", _chain())]
    assert "tip" in _types(wires)
    tip = next(w for w in wires if w["type"] == "tip")
    assert tip["topic"] == "what_is_apy"
    assert tip["body"] == "APY is your yearly yield."
    assert portfolio.reads == 0  # a literacy turn never proposes or reads positions
    _assert_labels_are_code_authored(wires)


# ── run_chat: PORTFOLIO ───────────────────────────────────────────────────────


async def test_chat_portfolio_emits_snapshot_and_summary() -> None:
    view = PortfolioView(
        positions=(PositionLite(venue="vault", asset="0xUSDC", value_usd="100.25"),),
        net_worth_usd="100.25",
    )
    dag = _dag(intent=Intent(kind=IntentKind.PORTFOLIO), portfolio=view)
    wires = await _collect(dag, "show my portfolio", _chain())
    assert "portfolio_snapshot" in _types(wires)
    snap = next(w for w in wires if w["type"] == "portfolio_snapshot")
    assert snap["positions"][0]["valueUsd"] == "100.25"
    assert any(w["type"] == "text" and "100.25" in w["markdown"] for w in wires)


# ── run_chat: RECOMMEND (happy) ───────────────────────────────────────────────


async def test_chat_recommend_surfaces_approved_ranked_recommendations() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))
    wires = await _collect(dag, "where can I earn yield?", _chain(market=MarketData()))
    recs = [w for w in wires if w["type"] == "recommendation"]
    assert len(recs) == 2
    assert [r["rank"] for r in recs] == [1, 2]
    assert all(r["policy"]["status"] == "approved" for r in recs)
    assert all(r["proposedAction"]["type"] in {"vault_deposit", "aave_supply"} for r in recs)
    # rec ids are the injected deterministic sequence
    assert [r["recId"] for r in recs] == ["rec_1", "rec_2"]
    _assert_labels_are_code_authored(wires)


async def test_chat_recommend_all_rejected_yields_safe_text() -> None:
    # Tiny caps → the notional deposit exceeds headroom → every candidate is rejected.
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))
    wires = await _collect(dag, "earn yield", _chain(per_user=1))
    assert not [w for w in wires if w["type"] == "recommendation"]
    assert any(w["type"] == "text" for w in wires)


# ── run_chat: BUILD_ACTION rogue (the fail-closed showcase) ───────────────────


async def test_chat_build_action_over_cap_is_rejected_and_non_signable() -> None:
    # The "model" extracted an over-cap deposit (10,000 USDC vs a 5,000 USDC headroom).
    rogue = Intent(
        kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
        asset=Asset.USDC, amount=10_000_000_000,
    )
    dag = _dag(intent=rogue, mandate=MandateView(version=1))
    wires = await _collect(dag, "deposit 10000 USDC", _chain(per_user=5_000_000_000))
    actions = [w for w in wires if w["type"] == "action"]
    assert len(actions) == 1
    stamp = actions[0]["policy"]
    # The DETERMINISTIC gate rejected it → rejected stamp, no checks, no sign path.
    assert stamp["status"] == "rejected"
    assert "checks" not in stamp
    assert "reason" in stamp
    # No recommendation/approved block anywhere — a rogue proposal never becomes signable.
    assert not any(w["type"] == "recommendation" for w in wires)


async def test_chat_build_action_underspecified_asks_for_amount() -> None:
    intent = Intent(kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
                    asset=Asset.USDC, amount=None)
    dag = _dag(intent=intent, mandate=MandateView(version=1))
    wires = await _collect(dag, "deposit some USDC", _chain())
    assert _types(wires)[-1] == "text"
    assert not any(w["type"] == "action" for w in wires)


async def test_chat_swap_emits_functional_inline_swap_action_block() -> None:
    # A swap isn't built by the agent (Aerodrome fork-only) — it surfaces the web's functional
    # swap card via an `action` block (executed on the web's own Uniswap path, user-signed), with no
    # "how much?" dead-end (chain 8453 ∈ the swap-page chains).
    intent = Intent(kind=IntentKind.BUILD_ACTION, action_type=ActionType.AERODROME_SWAP)
    dag = _dag(intent=intent)
    wires = await _collect(dag, "swap ETH to USDC", _chain())
    actions = [w for w in wires if w["type"] == "action"]
    assert len(actions) == 1
    pa = actions[0]["proposedAction"]
    assert pa["type"] == "aerodrome_swap"
    assert pa["params"]["maxSlippageBps"] == 50  # default slippage preset
    # Honest stamp — the agent never policy-approves swaps; the web renders "Review swap" anyway.
    assert actions[0]["policy"]["status"] == "rejected"
    assert all("how much" not in w.get("markdown", "").lower() for w in wires)


async def test_chat_bridge_request_is_honest_no_amount_prompt() -> None:
    # Bridging isn't an advisory action — answered honestly and deterministically (the guard fires
    # before classification, so the planner intent is irrelevant), never "how much?".
    dag = _dag(intent=Intent(kind=IntentKind.OTHER))
    wires = await _collect(dag, "Bridge my USDC to Sui", _chain())
    assert _types(wires)[-1] == "text"
    body = wires[-1]["markdown"].lower()
    assert "bridg" in body and "available" in body
    assert not any(w["type"] in {"action", "recommendation"} for w in wires)


# ── run_chat: refusal + other ────────────────────────────────────────────────


async def test_chat_planner_refusal_emits_error_block() -> None:
    dag = _dag(planner_refused=True)
    wires = await _collect(dag, "do something disallowed", _chain())
    assert wires[-1]["type"] == "error"
    assert wires[-1]["code"] == "REFUSAL"
    assert not any(w["type"] in {"recommendation", "action"} for w in wires)


async def test_chat_recommender_refusal_emits_error_block() -> None:
    dag = _dag(
        intent=Intent(kind=IntentKind.RECOMMEND),
        reco=StructuredResult(ok=False, refused=True),
        mandate=MandateView(version=1),
    )
    wires = await _collect(dag, "recommend something", _chain())
    assert any(w["type"] == "error" and w["code"] == "REFUSAL" for w in wires)
    assert not any(w["type"] == "recommendation" for w in wires)


async def test_chat_other_intent_returns_general_help() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.OTHER))
    wires = await _collect(dag, "hello there", _chain())
    assert _types(wires)[-1] == "text"
    assert not any(w["type"] in {"recommendation", "action"} for w in wires)


# ── determinism ───────────────────────────────────────────────────────────────


async def test_chat_recommend_is_deterministic() -> None:
    def build() -> CoordinatorDag:
        return _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))

    chain = _chain()
    first = await _collect(build(), "earn yield", chain)
    second = await _collect(build(), "earn yield", chain)
    assert first == second


# ── run_recommendations (/recommendations endpoint contract) ──────────────────


async def test_run_recommendations_surfaces_only_cleared_ranked() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))
    result = await dag.run_recommendations(_chain(), limit=5)
    assert result.mandate_version == 1
    assert len(result.recommendations) == 2
    assert [r.rank for r in result.recommendations] == [1, 2]
    assert all(r.policy.status == "approved" for r in result.recommendations)


async def test_run_recommendations_filters_rejected() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))
    result = await dag.run_recommendations(_chain(per_user=1))
    assert result.recommendations == ()  # nothing clears → nothing surfaced (FR-016)


async def test_run_recommendations_no_mandate_reports_none() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=None)
    result = await dag.run_recommendations(_chain())
    assert result.mandate_version is None


async def test_run_recommendations_refusal_is_flagged() -> None:
    dag = _dag(
        intent=Intent(kind=IntentKind.RECOMMEND),
        reco=StructuredResult(ok=False, refused=True),
        mandate=MandateView(version=1),
    )
    result = await dag.run_recommendations(_chain())
    assert result.refused is True
    assert result.recommendations == ()


# ── stage order ───────────────────────────────────────────────────────────────


async def test_recommend_stage_order() -> None:
    dag = _dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1))
    wires = await _collect(dag, "earn", _chain())
    labels = [w["label"] for w in wires if w["type"] == "tool_step"]
    # understand → gather (portfolio) → propose/gate, each announced in order.
    assert labels == [
        "Understanding your request",
        "Understanding your request",
        "Reading your portfolio",
        "Reading your portfolio",
        "Checking strategies against your guardrails",
        "Checking strategies against your guardrails",
    ]
