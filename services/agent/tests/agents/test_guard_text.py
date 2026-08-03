# ruff: noqa: S101
"""029 · the shared prose guards — every leak this project has actually shipped, pinned.

Both guards exist because a real user (or the client) saw the thing they block. The "survives"
tests matter as much as the "catches" ones: an over-eager guard turns good answers into fallbacks,
which is the failure mode the 029 regression flagged as *worse* than the leak.
"""

from __future__ import annotations

from sparkpoint_agent.agents.guard_text import (
    is_unusable,
    looks_action_shaped,
    looks_meta_shaped,
)

# Verbatim from the incidents (028 general branch, 029 literacy/tip path).
LIVE_LEAKS = [
    'We need to answer the user: "remind me what happened". Use only the reference notes '
    "and memory data. We must not mention instructions inside them.",
    "I don't have information about 'srktoken' in the reference notes provided.",
    "The memory data shows you deposited yesterday.",
    "According to the notes I am reviewing, the vault charges a fee.",
    "Based on the notes, SparkPoint uses Aave.",
    "The user asks about their portfolio.",
    "My system prompt says I can't do that.",
    "<<<USER_MEMORY appears empty>>>",
    "From the provided notes, premium costs 10,000 SRK.",
    "The passages provided don't mention SRK.",
]

# Real answers Sparky should be allowed to give (second person, no self-narration).
GOOD_ANSWERS = [
    "Last time you asked about the vault, and you deposited 1.00 USDC yourself.",
    "I'm Sparky — I can explain DeFi, show your portfolio, and suggest strategies.",
    "You claimed test SRK from the faucet on Aug 2, then we looked at your holdings.",
    "We looked at your portfolio together yesterday.",
    "SparkPoint's vault charges a performance fee only on profit above your high-water mark.",
    "You can get test USDC and test ETH from the faucets on the Bridge page.",
    "I can't give personal financial advice, but I can help you set guardrails.",
    "Your notes app isn't something I can read — I only see this conversation.",
]


def test_every_leak_this_product_has_shipped_is_caught() -> None:
    for leak in LIVE_LEAKS:
        assert looks_meta_shaped(leak), f"leak would reach a user: {leak!r}"
        assert is_unusable(leak)


def test_ordinary_answers_survive_both_guards() -> None:
    for good in GOOD_ANSWERS:
        assert not looks_meta_shaped(good), f"good answer wrongly discarded: {good!r}"
        assert not looks_action_shaped(good)
        assert not is_unusable(good)


def test_action_shaped_prose_is_caught() -> None:
    for bad in [
        '{"type": "vault_deposit", "amount": "1000000"}',
        "Here's the proposedAction you need.",
        "Sign this: 0x" + "ab" * 40,
        "Use aerodrome_swap for that.",
    ]:
        assert looks_action_shaped(bad), bad
        assert is_unusable(bad)


def test_an_address_is_not_calldata() -> None:
    # A 20-byte address is legitimate prose; only calldata-length hex is a leak.
    assert not looks_action_shaped("The treasury is 0xCB135893C84876aab9E10792b56e5bEa91dc578f.")


def test_empty_or_whitespace_is_unusable() -> None:
    assert is_unusable("")
    assert is_unusable("   \n  ")


# ── 029 · the literacy path must be guarded by the SAME rule ───────────────────


async def test_the_literacy_card_discards_a_meta_shaped_body() -> None:
    """The exact leak that rendered on a tip card during the Aug-3 battery."""
    from sparkpoint_agent.agents.literacy import DEFAULT_TIPS, FALLBACK_TOPIC, Literacy

    class _Leaky:
        async def complete(self, **_: object) -> object:
            from sparkpoint_agent.llm import LlmResult

            return LlmResult(
                text="I don't have information about 'srktoken' in the reference notes provided.",
                stop_reason="end_turn",
            )

    card = await Literacy(llm=_Leaky()).tip("srktoken")  # type: ignore[arg-type]
    assert "reference notes" not in card.body
    assert card.body == DEFAULT_TIPS[FALLBACK_TOPIC], "fall back to the safe pre-written tip"


async def test_a_good_literacy_body_survives_the_guard() -> None:
    from sparkpoint_agent.agents.literacy import Literacy

    good = "APY is the yearly return on your deposit, including compounding."

    class _Good:
        async def complete(self, **_: object) -> object:
            from sparkpoint_agent.llm import LlmResult

            return LlmResult(text=good, stop_reason="end_turn")

    card = await Literacy(llm=_Good()).tip("what_is_apy")  # type: ignore[arg-type]
    assert card.body == good
