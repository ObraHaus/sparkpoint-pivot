"""Assemble the deterministic ``PolicyContext`` from FRESH chain reads (feature 019 US2).

This is the I/O boundary: all chain reads happen here, then the PURE ``policy.evaluate()`` is called
(policy-schema.md §0 rule 6). Non-custody (N2): for an EXIT action the assembler NEVER even gathers
a
cap/pause read — the withdraw path cannot be gated by anything this layer reads.
"""

from __future__ import annotations

from typing import Protocol

from ..policy import (
    CAPS,
    Action,
    CapHeadroom,
    Direction,
    MandateContext,
    PolicyContext,
    SimulationInput,
)
from ..policy.constants import ACTION_DIRECTION
from ..sim import SimulationResult


class VaultReads(Protocol):
    """The narrow subset of ``chain.VaultReader`` the assembler needs (fakeable in tests)."""

    async def paused(self) -> bool: ...
    async def total_assets(self) -> int: ...
    async def balance_of(self, account: str) -> int: ...
    async def convert_to_assets(self, shares: int) -> int: ...


def to_sim_input(sim: SimulationResult | None) -> SimulationInput | None:
    """Fold a fresh :class:`SimulationResult` into the policy ``SimulationInput`` (or None)."""
    if sim is None:
        return None
    return SimulationInput(
        provider=sim.provider,
        will_revert=sim.willRevert,
        revert_reason=sim.revertReason,
        # Vault custody ops have no slippage/min-out dependency (swaps only); leave None.
        slippage_bps=None,
        min_out=None,
        quote_out=None,
        as_of_block=sim.asOfBlock,
    )


async def assemble_context(
    action: Action,
    *,
    reader: VaultReads,
    chain_id: int,
    account: str,
    owner: str,
    vault: str,
    sim: SimulationResult | None,
) -> PolicyContext:
    """Build the ``PolicyContext`` for ``policy.evaluate`` from fresh reads + the fresh sim.

    EXIT actions (N2): no cap/pause read is gathered — empty caps, not paused, not stale — so the
    orchestrator cannot gate an exit on anything read here. INFLOW actions read fresh cap headroom
    (cap − current) + the kill-switch. The deployed vault is passed as ``resolved_targets`` so the
    allowlist matches the address the static address book leaves ``None``.
    """
    resolved = {"sparkpoint_vault": vault}
    sim_input = to_sim_input(sim)

    if ACTION_DIRECTION[action.action_type] is Direction.EXIT:
        return PolicyContext(
            chain_id=chain_id,
            user_account=account,
            owner=owner,
            resolved_targets=resolved,
            caps=CapHeadroom(),
            mandate=MandateContext(),
            simulation=sim_input,
            data_stale=False,
            kill_switch_paused=False,
        )

    # INFLOW (deposit): fresh cap headroom + kill-switch (deposit is pausable).
    paused = await reader.paused()
    total_assets = await reader.total_assets()
    user_shares = await reader.balance_of(account)
    user_assets = await reader.convert_to_assets(user_shares) if user_shares else 0
    caps = CapHeadroom(
        per_user=max(0, CAPS.per_user_tvl.amount - user_assets),
        total=max(0, CAPS.total_protocol.amount - total_assets),
        vault=max(0, CAPS.vault_deposit.amount - total_assets),
    )
    return PolicyContext(
        chain_id=chain_id,
        user_account=account,
        owner=owner,
        resolved_targets=resolved,
        caps=caps,
        mandate=MandateContext(),
        simulation=sim_input,
        data_stale=False,
        kill_switch_paused=paused,
    )
