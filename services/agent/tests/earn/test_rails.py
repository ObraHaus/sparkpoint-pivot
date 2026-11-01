# ruff: noqa: S101
"""069 — rail resolution: receipt match by underlying, liveness, and Intents Connect gating."""

from __future__ import annotations

from dataclasses import replace

from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.rails import (
    LIVE,
    NO_LIQUIDITY,
    ReceiptLivenessCache,
    resolve_rails,
)

from .helpers import make_vault


def test_direct_and_receipt_rails_point_at_the_same_underlying_vault() -> None:
    config = default_config()
    vault = make_vault()
    receipt = config.receipt_for_vault(vault.address)
    assert receipt is not None and receipt.symbol == "gtUSDCp"
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    liveness.set(receipt.asset_id, LIVE)

    rails = resolve_rails(config, vault, liveness=liveness, aurora_key="")
    assert "direct" in rails.available
    assert "oneclick_earn" in rails.available
    detail = rails.wire()
    assert detail["oneclickEarn"]["receipt"]["underlyingVault"] == vault.address.lower()
    assert "not the native Morpho vault share" in detail["oneclickEarn"]["note"]
    assert "0.25%" in detail["oneclickEarn"]["feeNote"]


def test_no_liquidity_is_unavailable_with_a_receipt_match_still_reported() -> None:
    config = default_config()
    vault = make_vault()
    receipt = config.receipt_for_vault(vault.address)
    assert receipt is not None
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    liveness.set(receipt.asset_id, NO_LIQUIDITY)

    rails = resolve_rails(config, vault, liveness=liveness, aurora_key="")
    assert "oneclick_earn" not in rails.available
    assert rails.detail["oneclickEarn"]["liveness"] == NO_LIQUIDITY
    assert "no liquidity" in rails.detail["oneclickEarn"]["reason"].lower()


def test_a_vault_without_a_receipt_has_no_oneclick_rail() -> None:
    config = default_config()
    vault = make_vault(address="0x0000000000000000000000000000000000000001")
    rails = resolve_rails(config, vault, liveness=ReceiptLivenessCache(), aurora_key="")
    assert "oneclick_earn" not in rails.available
    assert "No 1Click receipt" in rails.detail["oneclickEarn"]["reason"]


def test_intents_connect_is_gated_by_flag_key_and_asset() -> None:
    vault = make_vault()
    disabled = default_config()
    assert "intents_connect" not in resolve_rails(
        disabled, vault, liveness=ReceiptLivenessCache(), aurora_key="key"
    ).available

    enabled = replace(
        default_config(),
        rails=replace(default_config().rails, intents_connect=True),
    )
    missing_key = resolve_rails(enabled, vault, liveness=ReceiptLivenessCache(), aurora_key="")
    assert "intents_connect" not in missing_key.available
    assert "requires Aurora" in missing_key.detail["intentsConnect"]["reason"]

    with_key = resolve_rails(enabled, vault, liveness=ReceiptLivenessCache(), aurora_key="key")
    assert "intents_connect" in with_key.available
    steps = with_key.detail["intentsConnect"]["steps"]
    assert [step["functionSignature"] for step in steps] == [
        "approve(address,uint256)",
        "deposit(uint256,address)",
    ]
    assert steps[1]["parameters"] == ["{MIN_AMOUNT_OUT}", "{USER_ADDRESS}"]

    wrong_asset = make_vault(address="0x0000000000000000000000000000000000000002", asset="DAI")
    assert "intents_connect" not in resolve_rails(
        enabled, wrong_asset, liveness=ReceiptLivenessCache(), aurora_key="key"
    ).available
