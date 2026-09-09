"""US3 (028) — the keyless SRK-faucet claim probe.

The SrkFaucet (026) emits ``Claimed`` events but nothing indexes them, and standing up an
indexer stream for a testnet convenience is disproportionate. Instead: the contract's own
per-address state IS the record — ``nextClaimAt(owner) − cooldown()`` is the wallet's most
recent claim time. Two keyless ``eth_call``s at fold time, under one HARD total time budget
(a deliberate improvement over the 026 srk-gate, whose missing timeout was a review finding:
this probe sits on the chat path, so a hung RPC may cost at most :data:`PROBE_BUDGET_SECONDS`).

Only the MOST RECENT claim is derivable — multiple claims between two chats fold as one line,
which the 028 spec accepts (memory is a digest, not an audit log).

NON-CUSTODY: read-only ``eth_call``, no key material anywhere (the agent stays provably
keyless), never on the withdraw path; every failure returns ``None`` (source skipped, cursor
untouched — the claim is picked up next turn).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

#: cast sig "nextClaimAt(address)" / "cooldown()" — pinned so no keccak dependency is needed.
_NEXT_CLAIM_AT_SELECTOR = "0x11a163e9"
_COOLDOWN_SELECTOR = "0x787a08a6"

#: HARD total budget for BOTH calls — the probe runs on the chat path.
PROBE_BUDGET_SECONDS = 3.0

_UA = "Mozilla/5.0 (compatible; SparkPointAgent/1.0)"


def _pad_address(addr: str) -> str:
    return addr.lower().removeprefix("0x").rjust(64, "0")


@dataclass(frozen=True)
class FaucetProbe:
    """Reads the wallet's last faucet-claim time. ``None`` faucet/rpc config disables it."""

    rpc_url: str
    faucet_address: str
    budget_seconds: float = PROBE_BUDGET_SECONDS

    async def _eth_call(self, client: httpx.AsyncClient, data: str) -> int | None:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": self.faucet_address, "data": data}, "latest"],
        }
        response = await client.post(self.rpc_url, json=payload, headers={"User-Agent": _UA})
        if response.status_code != 200:
            return None
        result = response.json().get("result")
        if not isinstance(result, str) or not result.startswith("0x") or result == "0x":
            return None
        try:
            return int(result, 16)
        except ValueError:
            return None

    async def last_claim_at(self, owner: str) -> datetime | None:
        """The wallet's most recent claim time, or ``None`` (= never claimed, or any failure —
        the two are indistinguishable here and both correctly fold nothing)."""
        try:
            async with asyncio.timeout(self.budget_seconds):
                async with httpx.AsyncClient(timeout=self.budget_seconds) as client:
                    next_at = await self._eth_call(
                        client, _NEXT_CLAIM_AT_SELECTOR + _pad_address(owner)
                    )
                    if not next_at:  # 0 = never claimed
                        return None
                    cooldown = await self._eth_call(client, _COOLDOWN_SELECTOR)
                    if cooldown is None:
                        return None
            return datetime.fromtimestamp(next_at - cooldown, tz=UTC)
        except Exception:  # noqa: BLE001 — timeout/transport/decode: skip the source this fold
            return None
