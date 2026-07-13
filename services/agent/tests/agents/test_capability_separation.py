# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""T022 — physical capability separation (research.md §6; N1/N3).

Capability is enforced by WHICH tools exist in an agent's registry, not by prompting
the model. These tests assert the load-bearing non-custody invariant:

  - portfolio_reader (and strategy_recommender) physically hold NO build/sim tool —
    no ``build_unsigned_tx`` / ``simulate`` is reachable from their registry;
  - only executor / vault_manager hold the BUILD/SIM tools;
  - the guardrail is deterministic (LLM-free) and toolless;
  - per-agent effort tiers match research.md §6.

These MUST pass — they are the structural half of "the service cannot move funds".
"""

from __future__ import annotations

from sparkpoint_agent.agents import (
    AGENTS,
    Effort,
    executor,
    guardrail,
    portfolio_reader,
    strategy_recommender,
    vault_manager,
)
from sparkpoint_agent.tools import Capability

_BUILD_SIM_TOOL_NAMES = {"build_unsigned_tx", "simulate"}


def test_portfolio_reader_has_no_build_sim_tool() -> None:
    reg = portfolio_reader.SPEC.registry()
    assert not reg.has_capability(Capability.BUILD_SIM)
    assert reg.names().isdisjoint(_BUILD_SIM_TOOL_NAMES)
    # It does hold the READ tools (it is not empty — it can read/derive).
    assert reg.has_capability(Capability.READ)
    assert "get_positions" in reg.names()


def test_strategy_recommender_has_no_build_sim_tool() -> None:
    reg = strategy_recommender.SPEC.registry()
    assert not reg.has_capability(Capability.BUILD_SIM)
    assert reg.names().isdisjoint(_BUILD_SIM_TOOL_NAMES)


def test_only_builders_can_build_and_simulate() -> None:
    for mod in (executor, vault_manager):
        reg = mod.SPEC.registry()
        assert reg.has_capability(Capability.BUILD_SIM)
        assert _BUILD_SIM_TOOL_NAMES <= reg.names()
        # Builders still read for context.
        assert reg.has_capability(Capability.READ)


def test_read_agents_never_carry_the_build_capability() -> None:
    """No read-only agent may declare BUILD_SIM (the wiring itself, not just the tools)."""
    for spec in (portfolio_reader.SPEC, strategy_recommender.SPEC):
        assert Capability.BUILD_SIM not in spec.capabilities


def test_guardrail_is_llm_free_and_toolless() -> None:
    spec = guardrail.SPEC
    assert spec.effort is None  # deterministic — never a Claude call
    assert not spec.is_llm_agent
    assert spec.capabilities == frozenset()
    assert spec.registry().names() == frozenset()


def test_effort_tiers_match_research_section_6() -> None:
    assert portfolio_reader.SPEC.effort is Effort.LOW
    assert strategy_recommender.SPEC.effort is Effort.HIGH
    assert executor.SPEC.effort is Effort.MEDIUM
    assert vault_manager.SPEC.effort is Effort.MEDIUM


def test_all_five_agents_registered() -> None:
    assert set(AGENTS) == {
        "portfolio_reader",
        "strategy_recommender",
        "executor",
        "vault_manager",
        "guardrail",
    }
