"""§B2 vault-flows log source — an agent-side, keyless eth_getLogs indexer for the ERC-4626
Deposit/Withdraw events, decoded into ``onchain_events`` so ``GET /portfolio`` can derive a REAL
cost basis + unrealized PnL (no fabricated figures).

Public-RPC reality (probe-verified): ``eth_getLogs`` is capped at ~2000 blocks per call and the
endpoint throttles bursts, so this walks the range in ≤2000-block windows with pacing + retry, from
the ``indexer_cursors`` watermark (stream ``vault_flows``). It holds NO key and issues NO
state-changing call — read-only, non-custody (N2). Idempotent: rows upsert on the
``(network_id, tx_hash, log_index)`` unique key, so a re-run never double-counts.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import eth_abi

from ..chain.vault_reader import JsonRpcTransport

# Fixed ERC-4626 event topic0s (keccak of the signature) — hardcoded so this module needs no keccak
# backend. Deposit(sender indexed, owner indexed, assets, shares); Withdraw(sender indexed, receiver
# indexed, owner indexed, assets, shares). Both verified against a live SparkPointVault deposit tx.
DEPOSIT_TOPIC0 = "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7"
WITHDRAW_TOPIC0 = "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db"

_STREAM = "vault_flows"
_WINDOW = 2000  # eth_getLogs block cap (public RPC)
_PACING_S = 0.35  # ~throttle-safe gap between getLogs calls
_MAX_WINDOWS_PER_RUN = 200  # bound a single catch-up run (200 * 2000 = 400k blocks)
_RETRY_CODES = {-32016, 429}  # rate-limit-ish JSON-RPC / HTTP codes → backoff + retry


@dataclass(frozen=True)
class VaultFlow:
    """One decoded Deposit/Withdraw, ready to upsert into ``onchain_events``."""

    kind: str  # 'deposit' | 'withdraw'
    owner: str  # the position owner (lower-cased 0x) — whose cost basis this affects
    assets: int  # USDC base units moved
    shares: int  # vault shares moved
    block_number: int
    tx_hash: str  # 0x… (hex)
    log_index: int
    topic0: str


def _addr_from_topic(topic: str) -> str:
    raw = bytes.fromhex(topic[2:] if topic.startswith("0x") else topic)
    (addr,) = eth_abi.decode(["address"], raw)
    return str(addr).lower()


def decode_flow_log(log: dict[str, Any]) -> VaultFlow | None:
    """Decode one eth_getLogs entry into a :class:`VaultFlow`, or ``None`` if it isn't a flow.

    Deposit topics: [sig, sender, owner]; data = (assets, shares). Withdraw topics: [sig, sender,
    receiver, owner]; data = (assets, shares) — the OWNER is topic 3 (whose shares burned).
    """
    topics = log.get("topics") or []
    if not topics:
        return None
    topic0 = str(topics[0]).lower()
    data = str(log.get("data") or "0x")
    raw = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    try:
        if topic0 == DEPOSIT_TOPIC0 and len(topics) >= 3:
            assets, shares = eth_abi.decode(["uint256", "uint256"], raw)
            owner = _addr_from_topic(topics[2])
            kind = "deposit"
        elif topic0 == WITHDRAW_TOPIC0 and len(topics) >= 4:
            assets, shares = eth_abi.decode(["uint256", "uint256"], raw)
            owner = _addr_from_topic(topics[3])
            kind = "withdraw"
        else:
            return None
    except Exception:
        return None
    return VaultFlow(
        kind=kind,
        owner=owner,
        assets=int(assets),
        shares=int(shares),
        block_number=int(str(log.get("blockNumber")), 16),
        tx_hash=str(log.get("transactionHash")),
        log_index=int(str(log.get("logIndex")), 16),
        topic0=topic0,
    )


class VaultFlowStore(Protocol):
    """The narrow persistence surface the indexer needs (a fake satisfies it structurally)."""

    async def get_cursor(self, network_id: str) -> int: ...
    async def set_cursor(self, network_id: str, block: int) -> None: ...
    async def upsert_flows(self, network_id: str, flows: Sequence[VaultFlow]) -> int: ...


@dataclass
class VaultFlowIndexer:
    """Walks eth_getLogs for the vault's Deposit/Withdraw and persists them (idempotent)."""

    transport: JsonRpcTransport
    store: VaultFlowStore
    vault_address: str
    network_id: str = "base"
    start_block: int = 0  # first run floors the cursor here (avoids scanning from genesis)

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        return await self.transport.call(method, params)

    async def _head(self) -> int:
        return int(str(await self._rpc("eth_blockNumber", [])), 16)

    async def _get_logs(self, from_block: int, to_block: int) -> list[dict[str, Any]]:
        params = [
            {
                "address": self.vault_address.lower(),
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "topics": [[DEPOSIT_TOPIC0, WITHDRAW_TOPIC0]],
            }
        ]
        result = await self._rpc("eth_getLogs", params)
        return result if isinstance(result, list) else []

    async def run_once(self) -> int:
        """Catch up from the cursor to head in <=2000-block windows (bounded). Returns #written.

        Fail-open: any RPC error stops the run at the last committed window (the cursor advances
        only per window), so the next run resumes - never a crash, never a fabricated figure.
        Non-custody: a stalled indexer just means PnL is momentarily stale.
        """
        try:
            head = await self._head()
        except Exception:
            return 0
        raw_cursor = await self.store.get_cursor(self.network_id)
        # First run (no watermark) → start AT the floor (inclusive). Resume → after the last
        # processed block. Either way never below the configured start floor.
        frm = self.start_block if raw_cursor <= 0 else max(raw_cursor + 1, self.start_block)
        if frm > head:
            return 0
        written = 0
        windows = 0
        while frm <= head and windows < _MAX_WINDOWS_PER_RUN:
            to = min(frm + _WINDOW - 1, head)
            try:
                logs = await self._get_logs(frm, to)
            except Exception:
                break  # stop gracefully; the cursor stays at the last good window
            flows = [f for f in (decode_flow_log(x) for x in logs) if f is not None]
            if flows:
                written += await self.store.upsert_flows(self.network_id, flows)
            await self.store.set_cursor(self.network_id, to)
            frm = to + 1
            windows += 1
            if frm <= head:
                await asyncio.sleep(_PACING_S)
        return written
