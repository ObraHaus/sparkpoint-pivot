# ruff: noqa: S101  (pytest asserts)
"""§B — the verified wallet (X-Owner) is forwarded as the LiteLLM ``user`` (per-user budget key).

Locks in that planner.classify / literacy.tip / recommender.propose thread ``user=`` down to the
LLM client, so the gateway can meter/attribute spend per wallet. Identity ONLY — the deterministic
policy gate (not this value) decides signability; here we just prove the attribution key is plumbed.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import ProposalContext, Recommender
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import RiskProfile

WALLET = "0xa71e24359a6cb7a939aae2d62dd12b6256365c30"
_UNSET = "__unset__"


class _RecordingStructured:
    """Records the ``user`` kwarg passed to ``structured`` and returns a canned result."""

    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.user: str | None = _UNSET

    async def structured(self, *, user: str | None = None, **_: Any) -> StructuredResult[Any]:
        self.user = user
        return self._result


class _RecordingComplete:
    """Records the ``user`` kwarg passed to ``complete`` and returns a canned tip."""

    def __init__(self) -> None:
        self.user: str | None = _UNSET

    async def complete(self, *, user: str | None = None, **_: Any) -> LlmResult:
        self.user = user
        return LlmResult(text="A tip.", stop_reason="end_turn")


async def test_planner_threads_user() -> None:
    llm = _RecordingStructured(StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER)))
    await Planner(llm=llm).classify("hi", user=WALLET)  # type: ignore[arg-type]
    assert llm.user == WALLET


async def test_literacy_threads_user() -> None:
    llm = _RecordingComplete()
    await Literacy(llm=llm).tip("what_is_apy", user=WALLET)  # type: ignore[arg-type]
    assert llm.user == WALLET


async def test_recommender_threads_user() -> None:
    # A RECOMMEND turn with a resolved vault target builds candidates → the ranking LLM call fires
    # (user recorded). ok=False just degrades to the deterministic ranking; the call still happened.
    llm = _RecordingStructured(StructuredResult(ok=False))
    ctx = ProposalContext(
        chain_id=8453,
        user_account="0x2222222222222222222222222222222222222222",
        resolved_targets={"sparkpoint_vault": "0x1111111111111111111111111111111111111111"},
        risk_profile=RiskProfile.CONSERVATIVE,
        gross_apy_bps=421,
        projected_apy_bps=379,
    )
    await Recommender(llm=llm).propose(Intent(kind=IntentKind.RECOMMEND), ctx, user=WALLET)  # type: ignore[arg-type]
    assert llm.user == WALLET


async def test_user_defaults_to_none_when_absent() -> None:
    # Backwards-compatible: callers that don't pass a user forward None (no attribution).
    llm = _RecordingStructured(StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER)))
    await Planner(llm=llm).classify("hi")  # type: ignore[arg-type]
    assert llm.user is None
