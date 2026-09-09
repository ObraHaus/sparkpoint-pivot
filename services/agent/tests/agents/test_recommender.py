# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Recommender (agents/recommender.py) — LLM MOCKED.

Asserts the non-custody design of the ``propose`` stage:
  - the candidate SET is code — ``build_action`` only ever produces an allowlisted
    ``(action_type, asset)`` and pins the recipient to the user; an undeployed target or
    off-whitelist pair yields ``None`` (never surfaced);
  - the ranker's JSON is validated fail-closed (a bogus actionType is ignored; empty
    ranking raises); a refusal returns no candidates; malformed output degrades to a
    deterministic ranking with a non-fabricated template rationale.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.agents.planner import Intent, IntentKind
from sparkpoint_agent.agents.recommender import (
    ProposalContext,
    Recommender,
    _parse_ranking,
    _Rank,
    build_action,
)
from sparkpoint_agent.llm import StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, RiskProfile

CHAIN = 8453
VAULT = "0x1111111111111111111111111111111111111111"
AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
AERO_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"
AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"
USER = "0x2222222222222222222222222222222222222222"

DEP_SEL = "0x6e553f65"
AAVE_SUPPLY_SEL = "0x617ba037"
SWAP_SEL = "0xcac88ea9"

_RESOLVED = {"sparkpoint_vault": VAULT}


class _FakeLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.calls: list[Any] = []

    async def structured(self, *, messages: Any, **_: Any) -> StructuredResult[Any]:
        self.calls.append(messages)
        return self._result


def _ctx(**over: Any) -> ProposalContext:
    base: dict[str, Any] = dict(
        chain_id=CHAIN,
        user_account=USER,
        resolved_targets=dict(_RESOLVED),
        risk_profile=RiskProfile.CONSERVATIVE,
        gross_apy_bps=421,
        projected_apy_bps=379,
    )
    base.update(over)
    return ProposalContext(**base)


# ── build_action — the whitelist-bound, recipient-pinned builder ─────────────


def test_build_action_vault_deposit_resolves_and_pins_recipient() -> None:
    action = build_action(
        chain_id=CHAIN, action_type=ActionType.VAULT_DEPOSIT, asset=Asset.USDC,
        amount=1_000_000_000, user_account=USER, resolved_targets=dict(_RESOLVED),
        risk_profile=RiskProfile.CONSERVATIVE,
    )
    assert action is not None
    assert action.target == VAULT
    assert action.selector == DEP_SEL
    assert action.recipient == USER  # pinned in code — a rogue LLM can never redirect (N1)
    assert action.max_slippage_bps is None  # custody op, no slippage
    assert action.route_factory is None


def test_build_action_undeployed_vault_is_none() -> None:
    # No resolved vault override on Base mainnet (vault is None in the address book).
    action = build_action(
        chain_id=CHAIN, action_type=ActionType.VAULT_DEPOSIT, asset=Asset.USDC,
        amount=1_000_000_000, user_account=USER, resolved_targets={},
        risk_profile=RiskProfile.CONSERVATIVE,
    )
    assert action is None


def test_build_action_aave_supply_resolves_from_book() -> None:
    action = build_action(
        chain_id=CHAIN, action_type=ActionType.AAVE_SUPPLY, asset=Asset.USDC,
        amount=500_000_000, user_account=USER, resolved_targets={},
        risk_profile=RiskProfile.CONSERVATIVE,
    )
    assert action is not None
    assert action.target == AAVE_POOL
    assert action.selector == AAVE_SUPPLY_SEL
    assert action.recipient == USER


def test_build_action_swap_carries_slippage_and_route_factory() -> None:
    action = build_action(
        chain_id=CHAIN, action_type=ActionType.AERODROME_SWAP, asset=Asset.USDC,
        amount=100_000_000, user_account=USER, resolved_targets=dict(_RESOLVED),
        risk_profile=RiskProfile.CONSERVATIVE, max_slippage_bps=50,
    )
    assert action is not None
    assert action.target == AERO_ROUTER
    assert action.selector == SWAP_SEL
    assert action.max_slippage_bps == 50
    assert action.route_factory == AERO_FACTORY


def test_build_action_off_whitelist_pair_is_none() -> None:
    # The vault only accepts USDC — an ETH vault deposit is unrepresentable.
    action = build_action(
        chain_id=CHAIN, action_type=ActionType.VAULT_DEPOSIT, asset=Asset.ETH,
        amount=1, user_account=USER, resolved_targets=dict(_RESOLVED),
        risk_profile=RiskProfile.CONSERVATIVE,
    )
    assert action is None


# ── _parse_ranking — fail-closed validation ──────────────────────────────────


def test_parse_ranking_valid() -> None:
    ranking = _parse_ranking(
        {"recommendations": [
            {"actionType": "vault_deposit", "rank": 1, "title": "T", "rationale": "R"}
        ]}
    )
    assert ranking[ActionType.VAULT_DEPOSIT].rank == 1


def test_parse_ranking_ignores_unknown_action() -> None:
    ranking = _parse_ranking(
        {"recommendations": [
            {"actionType": "banana", "rank": 1, "title": "T", "rationale": "R"},
            {"actionType": "vault_deposit", "rank": 2, "title": "T2", "rationale": "R2"},
        ]}
    )
    assert set(ranking) == {ActionType.VAULT_DEPOSIT}


def test_parse_ranking_empty_raises() -> None:
    with pytest.raises(ValueError, match="no usable ranking"):
        _parse_ranking({"recommendations": []})


# ── Recommender.propose ──────────────────────────────────────────────────────


async def test_propose_ranks_and_normalizes() -> None:
    ranking = {
        ActionType.VAULT_DEPOSIT: _Rank(rank=2, title="Vault", rationale="steady"),
        ActionType.AAVE_SUPPLY: _Rank(rank=1, title="Aave", rationale="raw"),
    }
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=True, value=ranking)))
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx())
    assert not result.refused and not result.degraded
    # AAVE ranked 1 by the model → first; ranks re-normalized dense 1..n.
    assert [c.action_type for c in result.candidates] == [
        ActionType.AAVE_SUPPLY, ActionType.VAULT_DEPOSIT
    ]
    assert [c.rank for c in result.candidates] == [1, 2]
    assert result.candidates[0].title == "Aave"


async def test_propose_degraded_uses_template_rationale() -> None:
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=False, error="no json")))
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx())
    assert result.degraded is True
    assert result.candidates  # still surfaces the deterministic set
    # Rationale is grounded in the injected APY, never fabricated.
    assert "4.21%" in result.candidates[0].rationale


async def test_propose_refusal_returns_no_candidates() -> None:
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=False, refused=True)))
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx())
    assert result.refused is True
    assert result.candidates == ()


async def test_propose_explicit_build_action() -> None:
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=False)))  # not consulted for explicit
    intent = Intent(
        kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
        asset=Asset.USDC, amount=250_000_000,
    )
    result = await rec.propose(intent, _ctx())
    assert len(result.candidates) == 1
    cand = result.candidates[0]
    assert cand.explicit is True
    assert cand.action.amount == 250_000_000
    assert cand.action.recipient == USER
    assert not rec.llm.calls  # explicit build makes NO ranking LLM call


async def test_propose_explicit_underspecified_yields_nothing() -> None:
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=False)))
    intent = Intent(kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
                    asset=Asset.USDC, amount=None)
    result = await rec.propose(intent, _ctx())
    assert result.candidates == ()


async def test_propose_drops_undeployed_from_set() -> None:
    rec = Recommender(llm=_FakeLlm(StructuredResult(ok=False)))
    # No vault override → vault_deposit is undeployed and dropped; only aave_supply remains.
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx(resolved_targets={}))
    assert [c.action_type for c in result.candidates] == [ActionType.AAVE_SUPPLY]
