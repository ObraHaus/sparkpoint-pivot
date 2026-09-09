"""Feature 026 - the 1M-SRK Ethereum-mainnet auto-gate.

A wallet holding at least ``SRK_GATE_MIN_BALANCE`` of the mainnet SRK token is auto-admitted to the
alpha at login, instead of being sent to the application form. This module does ONE thing: a single
keyless ``eth_call`` of ``balanceOf(owner)`` against an Ethereum-mainnet RPC.

Scope is deliberately tiny. Chain 1 is NOT added to ``API_SUPPORTED_CHAIN_IDS``, the wagmi
registries or ``packages/shared`` chain metadata: mainnet is not a chain this product operates on,
it is a place we read one balance. Keeping it out of those registries keeps every other surface
honestly testnet-only.

FAIL-OPEN, ALWAYS. Unset env, an unreachable RPC, a malformed response - every one of them returns
:class:`GateResult` ``qualified=False`` with a reason, never an exception that could 500 a login.
The worst outcome of a failure is that a qualifying holder sees the application form, which is the
same experience everyone else gets. Holds no key and signs nothing (N1).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

#: `balanceOf(address)` - the 4-byte selector, hardcoded so this module needs no keccak backend.
BALANCE_OF_SELECTOR = "0x70a08231"

#: Ethereum mainnet. Read-only, and deliberately not registered as a supported app chain.
ETH_MAINNET_CHAIN_ID = 1

#: Default threshold: 1,000,000 SRK at 18 decimals (client-decided).
DEFAULT_MIN_BALANCE = 1_000_000 * 10**18

ENV_RPC_URL = "ETH_MAINNET_RPC_URL"
ENV_TOKEN = "SRK_MAINNET_ADDRESS"  # noqa: S105 - an env var NAME for a token ADDRESS, not a secret
ENV_MIN_BALANCE = "SRK_GATE_MIN_BALANCE"


class EthCallRpc(Protocol):
    """The raw-result JSON-RPC surface needed here (``log_source.HttpxLogsRpc`` satisfies it)."""

    async def call(self, method: str, params: list[Any]) -> Any: ...


@dataclass(frozen=True)
class GateResult:
    """The outcome of one gate check. ``qualified`` is the ONLY thing callers may act on."""

    qualified: bool
    #: Machine-readable why: 'ok' | 'below_threshold' | 'not_configured' | 'rpc_error' |
    #: 'bad_address'.
    reason: str
    #: The balance actually read, or None when it could not be read.
    balance: int | None = None
    threshold: int | None = None


def _env_int(name: str) -> int | None:
    raw = os.getenv(name)
    if not raw or not raw.strip():
        return None
    try:
        return int(raw.strip())
    except ValueError:
        return None


def gate_threshold() -> int:
    """The configured minimum balance in SRK base units (18 dp), or the 1,000,000 default."""
    value = _env_int(ENV_MIN_BALANCE)
    return value if value is not None and value > 0 else DEFAULT_MIN_BALANCE


def gate_configured() -> bool:
    """True when BOTH the mainnet RPC and the token address are set. Unset ⇒ the gate is skipped."""
    return bool((os.getenv(ENV_RPC_URL) or "").strip() and (os.getenv(ENV_TOKEN) or "").strip())


def _is_address(value: str) -> bool:
    candidate = value.strip()
    if not candidate.startswith("0x") or len(candidate) != 42:
        return False
    try:
        int(candidate, 16)
    except ValueError:
        return False
    return True


def encode_balance_of(owner: str) -> str:
    """`balanceOf(owner)` calldata - the selector plus the left-padded 20-byte address."""
    return BALANCE_OF_SELECTOR + owner.strip().lower().removeprefix("0x").rjust(64, "0")


def decode_uint256(result: Any) -> int | None:
    """Decode an ``eth_call`` hex result to an int. Anything unexpected ⇒ ``None`` (never 0)."""
    if not isinstance(result, str):
        return None
    raw = result.strip()
    if not raw.startswith("0x") or len(raw) < 3:
        return None
    try:
        return int(raw, 16)
    except ValueError:
        return None


@dataclass
class SrkMainnetGate:
    """Reads an address's mainnet SRK balance and compares it to the threshold.

    Every failure path returns a non-qualifying :class:`GateResult`; this class never raises.
    """

    rpc: EthCallRpc
    token: str
    min_balance: int = DEFAULT_MIN_BALANCE

    async def check(self, address: str) -> GateResult:
        threshold = self.min_balance
        if not _is_address(address) or not _is_address(self.token):
            return GateResult(False, "bad_address", None, threshold)
        try:
            result = await self.rpc.call(
                "eth_call",
                [{"to": self.token.lower(), "data": encode_balance_of(address)}, "latest"],
            )
        except Exception:  # noqa: BLE001 - fail-open by contract; a login must never 500 here
            return GateResult(False, "rpc_error", None, threshold)

        balance = decode_uint256(result)
        if balance is None:
            return GateResult(False, "rpc_error", None, threshold)
        if balance >= threshold:
            return GateResult(True, "ok", balance, threshold)
        return GateResult(False, "below_threshold", balance, threshold)


def build_gate_from_env(rpc_factory: Any = None) -> SrkMainnetGate | None:
    """Construct the gate from env, or ``None`` when it isn't configured (⇒ skip to the form).

    ``rpc_factory`` is injected in tests; production uses ``HttpxLogsRpc`` (imported lazily so this
    module stays cheap to import and free of transport coupling).
    """
    rpc_url = (os.getenv(ENV_RPC_URL) or "").strip()
    token = (os.getenv(ENV_TOKEN) or "").strip()
    if not rpc_url or not token:
        return None
    if rpc_factory is None:
        from ..data.log_source import HttpxLogsRpc  # local import: keeps the transport optional

        rpc_factory = HttpxLogsRpc
    return SrkMainnetGate(rpc=rpc_factory(rpc_url), token=token, min_balance=gate_threshold())
