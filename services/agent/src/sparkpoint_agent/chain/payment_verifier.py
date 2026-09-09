"""Feature 012 - keyless, keccak-free on-chain verification of an SRK Premium payment.

Reuses ``data/log_source.py``'s raw-result :class:`HttpxLogsRpc` (a receipt is a JSON object the
string-only vault transport rejects) + ``_addr_from_topic``. Proves, from CHAIN ALONE, that a
*settled* ERC-20 ``Transfer`` moved at least the Premium price of SRK **from the buyer to the
disclosed treasury**. The buyer is the server-scoped owner (never a body field), so wallet A can
never claim wallet B's payment. Holds no key and signs nothing (Constitution N1).

Fail modes:
  * not-yet-mined / under-confirmation -> :class:`Pending` (retryable; NOT a grant, NOT a failure);
  * reverted / wrong-token / wrong-recipient / under-price / sender-not-buyer -> refuse
    (:class:`PaymentInvalid`; do not grant);
  * RPC outage -> the underlying ``RuntimeError`` propagates (mapped to UPSTREAM_UNAVAILABLE),
    never swallowed into a false "invalid".
"""

from __future__ import annotations

from dataclasses import dataclass

import eth_abi

from ..data.log_source import LogsRpc, _addr_from_topic

#: topic0 of ERC-20 Transfer = keccak256("Transfer(address,address,uint256)") (a fixed constant).
ERC20_TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


class PaymentInvalid(Exception):
    """The tx settled but does not satisfy the payment requirement -- refuse, do NOT grant."""


@dataclass(frozen=True)
class VerifiedPayment:
    """A settled, buyer-bound, at-least-full-price SRK Transfer to the treasury."""

    tx_hash: str  # lowercased 0x
    buyer: str  # lowercased (== the Transfer `from`, == the scoped owner)
    token: str  # lowercased SRK address
    amount_raw: int  # SRK base units transferred (>= price)
    block_number: int


@dataclass(frozen=True)
class Pending:
    """Not yet mined / not yet final -- the client should retry (NOT a grant, NOT a failure)."""

    reason: str
    tx_hash: str


def _to_int(hexish: str | int) -> int:
    return hexish if isinstance(hexish, int) else int(hexish, 16)


def _decode_uint256(data: str) -> int:
    raw = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    (value,) = eth_abi.decode(["uint256"], raw)
    return int(value)


@dataclass
class PaymentVerifier:
    """Verifies a settled SRK ``Transfer`` to the treasury for the scoped buyer, from chain alone.

    ``rpc`` is a raw-result transport (``HttpxLogsRpc``). Addresses/amount come from config
    (``SRK_ADDRESS_84532`` / ``PREMIUM_TREASURY_ADDRESS`` / ``PREMIUM_PRICE_SRK`` in base units /
    ``PREMIUM_MIN_CONFIRMATIONS``) -- read directly, kept out of the keyless ``AgentConfig``.
    """

    rpc: LogsRpc
    srk_address: str
    treasury: str
    price_raw: int
    min_confirmations: int = 3

    async def verify(self, *, tx_hash: str, buyer: str) -> VerifiedPayment | Pending:
        th = tx_hash.lower()
        buyer_l = buyer.lower()
        srk = self.srk_address.lower()
        treasury = self.treasury.lower()

        receipt = await self.rpc.call("eth_getTransactionReceipt", [th])
        if receipt is None:
            return Pending("transaction not yet mined", th)
        if str(receipt.get("status", "")).lower() != "0x1":
            raise PaymentInvalid("payment transaction reverted")

        block_number = _to_int(receipt["blockNumber"])
        head = _to_int(await self.rpc.call("eth_blockNumber", []))
        confirmations = head - block_number
        if confirmations < self.min_confirmations:
            return Pending(
                f"awaiting confirmations ({confirmations}/{self.min_confirmations})", th
            )

        # Every SRK Transfer TO the treasury in this tx (there is normally exactly one).
        to_treasury: list[tuple[str, int]] = []  # (from_lowercased, value_raw)
        for log in receipt.get("logs", []):
            if str(log.get("address", "")).lower() != srk:
                continue  # a different token (wrong-token) -> never counts
            topics = log.get("topics", [])
            if len(topics) < 3 or str(topics[0]).lower() != ERC20_TRANSFER_TOPIC0:
                continue
            if _addr_from_topic(topics[2]) != treasury:
                continue  # a Transfer to someone else (wrong-recipient) -> keep scanning
            to_treasury.append((_addr_from_topic(topics[1]), _decode_uint256(log["data"])))

        from_buyer = [value for (frm, value) in to_treasury if frm == buyer_l]
        if from_buyer:
            paid = max(from_buyer)
            if paid < self.price_raw:
                raise PaymentInvalid(
                    f"payment below the Premium price ({paid} < {self.price_raw})"
                )
            return VerifiedPayment(
                tx_hash=th, buyer=buyer_l, token=srk, amount_raw=paid, block_number=block_number
            )
        if to_treasury:
            # SRK reached the treasury, but not from this buyer -- the buyer-binding guard.
            raise PaymentInvalid("payment sender is not the buyer")
        raise PaymentInvalid("no SRK transfer to the treasury in this transaction")
