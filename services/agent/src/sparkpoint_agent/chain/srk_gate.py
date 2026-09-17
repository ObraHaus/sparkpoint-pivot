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

FAST, ALWAYS - this call sits on the INTERACTIVE LOGIN PATH. Fail-open is only honest if it fails
*quickly*: a gate that cannot answer must cost the user a moment, not a minute. Two things enforce
that (added after alpha sign-ins were measured stalling ~20s):

  * :data:`GATE_BUDGET_SECONDS` is a HARD ceiling on ``check()`` as a whole, applied with
    ``asyncio.wait_for`` so it holds for ANY injected transport - not just the default one.
  * Within that ceiling we make :data:`GATE_MAX_ATTEMPTS` tries. The mainnet lane was measured at
    ~4% per-call failure even while nominally healthy, so a single attempt would wrongly bounce
    ~1 in 25 qualifying holders to the application form; a second try makes that ~1 in 625.

Why this was needed: the gate previously borrowed the INDEXER's transport (``HttpxLogsRpc``,
``timeout=20.0``) - a budget sized for a background ``eth_getLogs`` sweep, not a login. Upstream of
that, the eRPC proxy's own failsafe is ``timeout: 15s`` x ``retry: 3``, so a single wedged call can
legitimately run ~45s. Nothing in that chain is wrong on its own; it just must never be what a user
waits on. See ``faucet_probe.PROBE_BUDGET_SECONDS`` for the same discipline on the chat path.
"""

from __future__ import annotations

import asyncio
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

#: HARD ceiling for the whole gate check, retries included. The login blocks on this, so it is a
#: user-experience budget, not a network one: past this we fail open and show the form.
GATE_BUDGET_SECONDS = 3.0

#: Tries allowed inside the budget. The happy path was measured at ~0.78s, so two fit comfortably.
GATE_MAX_ATTEMPTS = 2

#: Per-try slice. Deliberately < BUDGET / ATTEMPTS so a first-try hang still leaves room for a
#: second try rather than eating the whole budget alone.
GATE_ATTEMPT_SECONDS = 1.4


class EthCallRpc(Protocol):
    """The raw-result JSON-RPC surface needed here (``log_source.HttpxLogsRpc`` satisfies it)."""

    async def call(self, method: str, params: list[Any]) -> Any: ...


@dataclass(frozen=True)
class GateResult:
    """The outcome of one gate check. ``qualified`` is the ONLY thing callers may act on."""

    qualified: bool
    #: Machine-readable why: 'ok' | 'below_threshold' | 'not_configured' | 'rpc_error' |
    #: 'bad_address' | 'timed_out'.
    #:
    #: 'timed_out' vs 'rpc_error' is a REAL distinction, not cosmetic: 'rpc_error' means the chain
    #: answered and we could not use the answer, whereas 'timed_out' means we never heard back
    #: inside the login's budget. Only the latter says "the balance is still unknown — asking again
    #: may well succeed", which is exactly what the retry hint on the form offers.
    reason: str
    #: The balance actually read, or None when it could not be read.
    balance: int | None = None
    threshold: int | None = None
    #: How many transport attempts were spent (0 when we never got as far as calling).
    attempts: int = 0


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
    budget_seconds: float = GATE_BUDGET_SECONDS
    max_attempts: int = GATE_MAX_ATTEMPTS
    attempt_seconds: float = GATE_ATTEMPT_SECONDS

    async def check(self, address: str) -> GateResult:
        """Read the balance and compare it to the threshold, within a hard time budget.

        Retries only the two failures that a second try can actually fix — a transport error and a
        timeout. A *decoded* answer is final: ``below_threshold`` is the chain's verdict, and asking
        the same question again would only burn the user's remaining budget to hear it repeated.
        """
        threshold = self.min_balance
        if not _is_address(address) or not _is_address(self.token):
            return GateResult(False, "bad_address", None, threshold)

        params = [{"to": self.token.lower(), "data": encode_balance_of(address)}, "latest"]
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.budget_seconds
        # Sticky across attempts so the caller learns the LAST thing that went wrong. Seeded with
        # the timeout reason: if the budget is already spent we never enter the loop at all.
        reason = "timed_out"
        attempts = 0

        for _ in range(self.max_attempts):
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            attempts += 1
            try:
                result = await asyncio.wait_for(
                    self.rpc.call("eth_call", params),
                    timeout=min(self.attempt_seconds, remaining),
                )
            except TimeoutError:  # asyncio.TimeoutError is an alias of this on 3.11+
                reason = "timed_out"
                continue
            except asyncio.CancelledError:
                # The REQUEST was cancelled (client hung up / shutdown), not our timeout. Never
                # swallow this — fail-open must not mean "keep a dead login alive".
                raise
            except Exception:  # noqa: BLE001 - fail-open by contract; a login must never 500 here
                reason = "rpc_error"
                continue

            balance = decode_uint256(result)
            if balance is None:
                # A 200 we cannot parse. Not retried: the transport worked, so a repeat call would
                # almost certainly return the same unparseable body.
                return GateResult(False, "rpc_error", None, threshold, attempts)
            if balance >= threshold:
                return GateResult(True, "ok", balance, threshold, attempts)
            return GateResult(False, "below_threshold", balance, threshold, attempts)

        return GateResult(False, reason, None, threshold, attempts)


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
