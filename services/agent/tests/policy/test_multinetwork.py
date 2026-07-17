# ruff: noqa: S101
"""§B3 multi-network — Robinhood testnet (46630) is a supported chain whose vault/swap surface is
EMPTY by design (the vault is Base-only; we never target the unofficial Robinhood pilot). These
tests pin that 46630 is accepted by the policy layer yet resolves to a fail-closed empty allowlist.
"""

from __future__ import annotations

from sparkpoint_agent.policy.constants import (
    SUPPORTED_CHAIN_IDS,
    get_addresses,
    get_policy_constants,
)

ROBINHOOD = 46630


def test_robinhood_is_a_supported_chain() -> None:
    assert ROBINHOOD in SUPPORTED_CHAIN_IDS


def test_robinhood_allowlist_is_empty_fail_closed() -> None:
    # An empty allowlist ⇒ every (target, selector) action fails allowlisting on 46630
    # (fail-closed): BUILD_ACTION correctly refuses with "not supported on this network".
    pc = get_policy_constants(ROBINHOOD)
    assert pc.chain_id == ROBINHOOD
    assert pc.allowlist == ()
    # Caps/slippage/governance stay chain-independent (identical objects to the Base chains).
    assert pc.caps is get_policy_constants(84532).caps
    assert pc.governance is get_policy_constants(84532).governance


def test_robinhood_addresses_resolve_with_no_vault() -> None:
    # get_addresses honors the same supported-chain contract; the vault is Base-only ⇒ None here.
    book = get_addresses(ROBINHOOD)
    assert book.chain_id == ROBINHOOD
    assert book.vault is None
