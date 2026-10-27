# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""058 — the English-only check is meaningful in both directions."""

from __future__ import annotations

import pytest
from evals.assertions import is_english, visible_text
from evals.model import load_cases
from evals.runner import _execute, _fake_client

_ENGLISH = (
    "I'm Sparky, SparkPoint's non-custodial assistant. I can explain DeFi, read your "
    "portfolio, and prepare moves for you to sign, but I never move your funds.",
    "Here's a plain-language explanation of the concept. It is informational only, returns "
    "can vary, and nothing here is financial advice.",
    "The vault is showing a 4.41% net APY as of 2026-09-18. Your funds never sit with us.",
    "There's no SparkPoint vault on this network yet, so there's nothing deposited here "
    "to withdraw.",
)

_NOT_ENGLISH = (
    "Magkano na yung kita ko sa vault this week?",
    "Ano ang pinakamagandang paraan para kumita gamit ang USDC ko?",
    "¿Cuánto dinero he ganado en la bóveda esta semana?",
    "¿Cuál es la mejor forma de ganar dinero con mi USDC?",
)


@pytest.mark.parametrize("text", _ENGLISH)
def test_english_prose_passes(text: str) -> None:
    assert is_english(text)


@pytest.mark.parametrize("text", _NOT_ENGLISH)
def test_tagalog_and_spanish_prose_fails(text: str) -> None:
    assert not is_english(text)


async def test_every_golden_expected_english_reply_passes() -> None:
    for case in load_cases():
        if not case.expected.english:
            continue
        wires = await _execute(case, _fake_client(case), live=False)
        assert is_english(visible_text(wires)), case.id
