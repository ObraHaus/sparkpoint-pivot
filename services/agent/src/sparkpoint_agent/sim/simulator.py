"""The pre-trade Simulator (research.md §8; SimulationResult mirrors
packages/shared/src/schemas/simulation.ts EXACTLY).

Three providers, ``anvil_fork`` PRIMARY (research.md §8, rev 3.2 self-hosted):

  anvil_fork           — the supervised Anvil Base-mainnet fork (SIM_FORK_RPC_URL):
                         eth_call for the revert/return check, before/after
                         ``balanceOf`` diffs for asset deltas via
                         evm_snapshot → impersonate+send → evm_revert, and
                         eth_estimateGas. The ONLY engine that covers the
                         fork-only Aerodrome swap.
  bundler_gas_estimate — the ERC-4337 UserOp path: eth_estimateUserOperationGas +
                         EntryPoint.simulateHandleOp (seam; needs a bundler RPC).
  viem_eth_call        — a lightweight live-chain eth_call revert/return check
                         (the oracle-free-path outage fallback, research.md §8).

NON-CUSTODY (N1/N3): this module only READS/TRACES a fork. It never signs, holds
no key, and produces no signable artifact. The preview is advisory — the
authoritative protection is the on-chain ``amountOutMin``/caps/allowlist
(research.md §8 "Invariant preservation").

FAIL-CLOSED (research.md §8 "Tenderly-outage fallback", re-homed to the self-hosted
Simulator): if the primary fork is unavailable, a SWAP (``aerodrome_swap`` —
slippage cannot be locally guaranteed) fail-closes with
``SimulatorUnavailableError``; only deterministic, oracle-free actions may fall
back to the ``viem_eth_call`` dry-run. Simulation is NEVER on the withdraw path
(N2), so a Simulator outage cannot block a user's on-chain exit.

Money: amounts are base-unit integer strings; USD are decimal strings; never
floats (agent-service-api.md §1.4). USD legs are ``"0"`` here — USD enrichment is
layered on later by the pricing module (research.md §9, Chainlink-on-Base); the
base-unit deltas produced here are exact.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict

from ..policy.enums import ActionType

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# The tracked-asset sentinel for the chain's NATIVE coin (ETH), which has no
# ERC-20 address. Read via ``eth_getBalance`` rather than ``balanceOf``.
NATIVE_TOKEN_SENTINEL = "0x0000000000000000000000000000000000000000"  # noqa: S105 (zero-address sentinel, not a secret)

# Function selectors (verified via `cast sig`).
_BALANCE_OF_SELECTOR = "0x70a08231"  # balanceOf(address)
_DECIMALS_SELECTOR = "0x313ce567"  # decimals()

# Solidity ``Error(string)`` selector — the prefix of a revert-with-reason payload.
_ERROR_STRING_SELECTOR = "0x08c379a0"

# A canonical fork/live default RPC timeout (seconds).
_RPC_TIMEOUT_S = 15.0
# Receipt-poll bounds (anvil automines, so this is usually one iteration).
_RECEIPT_MAX_ATTEMPTS = 40
_RECEIPT_DELAY_S = 0.1

SimulationProvider = Literal["anvil_fork", "bundler_gas_estimate", "viem_eth_call"]


# ─────────────────────────────────────────────────────────────────────────────
# Mirrored wire schema — packages/shared/src/schemas/simulation.ts (`.strict()`).
# camelCase field names + extra="forbid" so a dumped model is byte-identical to
# the zod wire. (ruff N-rules are not enabled; camelCase is intentional here.)
# ─────────────────────────────────────────────────────────────────────────────


class BalanceDelta(BaseModel):
    """§2.3 — one asset balance delta of the simulated tx."""

    model_config = ConfigDict(extra="forbid")

    asset: str
    decimals: int
    delta: str  # signed base-unit integer string
    deltaUsd: str  # decimal USD string ("0" until priced)


class GasEstimate(BaseModel):
    """§2.3 — gas estimate (hex quantity) + its USD projection."""

    model_config = ConfigDict(extra="forbid")

    estimate: str  # 0x-prefixed hex quantity
    gasUsd: str


class CapHeadroom(BaseModel):
    """§2.3 — remaining deposit-side cap headroom (base units). Null for exits."""

    model_config = ConfigDict(extra="forbid")

    perUser: str
    total: str
    vault: str


class SimulationResult(BaseModel):
    """§2.3 — the Simulator preview attached to every build/simulate response.

    Mutually-exclusive output legs by op kind (null when N/A):
      ``sharesOut`` → deposits · ``assetsOut`` → withdraws/redeems ·
      ``outAmount``/``minOut`` → swaps. ``capHeadroom`` is deposit-side only.
    """

    model_config = ConfigDict(extra="forbid")

    provider: SimulationProvider
    willRevert: bool
    revertReason: str | None
    balanceDeltas: list[BalanceDelta]
    sharesOut: str | None
    assetsOut: str | None
    outAmount: str | None
    minOut: str | None
    priceImpactBps: int
    slippageBps: int
    feesUsd: str
    gas: GasEstimate
    capHeadroom: CapHeadroom | None
    asOfBlock: int
    asOf: str  # ISO-8601 UTC


# ─────────────────────────────────────────────────────────────────────────────
# Request types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TrackedAsset:
    """An asset whose ``sender`` balance the simulation diffs before/after.

    ``address`` is an ERC-20 address, or ``NATIVE_TOKEN_SENTINEL`` for native ETH.
    ``decimals`` is carried onto the resulting ``BalanceDelta`` (§4 numeric policy).
    """

    address: str
    decimals: int


@dataclass(frozen=True)
class PackedUserOp:
    """The unsigned ERC-4337 v0.7 PackedUserOperation for the bundler path.

    Mirrors packages/shared PackedUserOperationSchema; ``signature`` is ALWAYS
    absent here — the Simulator never signs (N1/N3). Kept loose (a raw mapping)
    because the bundler eth_estimateUserOperationGas path serialises it verbatim.
    """

    fields: dict[str, Any]


@dataclass(frozen=True)
class SimulationRequest:
    """One thing to simulate.

    ``op_type == "eoa_call"`` → a direct unsigned call (``sender``/``to``/``data``/
    ``value``) simulated on the fork. ``op_type == "userop"`` → an ERC-4337 op for
    the bundler path (``user_op`` + ``entry_point``).

    ``track_assets`` lists the assets to diff for ``balanceDeltas``. ``action`` (an
    ``ActionType``) selects which output leg to populate and drives the fail-closed
    swap rule. ``out_asset`` names the tracked asset that is the op's output leg
    (the received token for a swap, the share token for a deposit, the underlying
    for a withdraw); when omitted, a swap's ``outAmount`` is inferred from the
    largest positive delta. ``min_out`` is the caller's slippage floor (base units).
    """

    chain_id: int
    sender: str
    to: str = ""
    data: str = "0x"
    value: int = 0
    op_type: Literal["eoa_call", "userop"] = "eoa_call"
    track_assets: tuple[TrackedAsset, ...] = ()
    action: ActionType | None = None
    out_asset: str | None = None
    min_out: int | None = None
    user_op: PackedUserOp | None = None
    entry_point: str | None = None


@dataclass
class SmokeResult:
    """Outcome of the fork smoke test (eth_blockNumber + a trivial eth_call)."""

    ok: bool
    chain_id: int | None = None
    block_number: int | None = None
    probe_call_ok: bool = False
    probe_value: int | None = None
    detail: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────────────


class JsonRpcError(RuntimeError):
    """A JSON-RPC endpoint returned an ``error`` object (or a malformed reply)."""

    def __init__(self, method: str, code: int | None, message: str, data: Any = None) -> None:
        self.method = method
        self.code = code
        self.rpc_message = message
        self.data = data
        super().__init__(f"{method}: [{code}] {message}")


class SimulatorUnavailableError(RuntimeError):
    """The Simulator backend is unreachable/misconfigured.

    Raised fail-closed. A swap MUST NOT proceed to signing on this error
    (research.md §8); the caller surfaces ``ReasonCode.SIM_UNAVAILABLE``.
    """


# ─────────────────────────────────────────────────────────────────────────────
# Low-level JSON-RPC over httpx
# ─────────────────────────────────────────────────────────────────────────────


def _to_hex_qty(value: int) -> str:
    """Encode a non-negative int as a 0x hex quantity (≥ 1 nibble; ``0`` → ``0x0``)."""
    if value < 0:
        raise ValueError("hex quantity must be non-negative")
    return hex(value)


def _from_hex(value: str) -> int:
    return int(value, 16)


def _pad_address(addr: str) -> str:
    """Left-pad a 20-byte address to a 32-byte ABI word (no 0x prefix)."""
    return addr.lower().removeprefix("0x").rjust(64, "0")


def _decode_revert_reason(data: Any) -> str | None:
    """Best-effort decode of a Solidity ``Error(string)`` revert payload."""
    if not isinstance(data, str) or not data.startswith(_ERROR_STRING_SELECTOR):
        return None
    body = data[len(_ERROR_STRING_SELECTOR) :]
    try:
        # [offset(32)][length(32)][utf8 bytes...]
        length = int(body[64:128], 16)
        raw = bytes.fromhex(body[128 : 128 + length * 2])
        return raw.decode("utf-8", errors="replace")
    except (ValueError, IndexError):
        return None


class _JsonRpcClient:
    """A minimal async JSON-RPC 2.0 client over a shared ``httpx.AsyncClient``."""

    def __init__(self, url: str, client: httpx.AsyncClient) -> None:
        self._url = url
        self._client = client
        self._id = 0

    async def call(self, method: str, params: list[Any]) -> Any:
        """Invoke ``method``; return ``result`` or raise ``JsonRpcError``.

        A transport failure is surfaced as ``SimulatorUnavailableError`` (the
        backend is down → fail-closed), distinct from a JSON-RPC ``error`` (the
        backend answered, e.g. an execution revert).
        """
        self._id += 1
        payload = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}
        try:
            response = await self._client.post(self._url, json=payload, timeout=_RPC_TIMEOUT_S)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SimulatorUnavailableError(f"{method}: transport failure: {exc}") from exc
        if not isinstance(body, dict):
            raise JsonRpcError(method, None, f"non-object reply: {body!r}")
        if "error" in body and body["error"] is not None:
            err = body["error"]
            code = err.get("code") if isinstance(err, dict) else None
            message = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            data = err.get("data") if isinstance(err, dict) else None
            raise JsonRpcError(method, code, message, data)
        return body.get("result")


# ─────────────────────────────────────────────────────────────────────────────
# anvil_fork — PRIMARY provider
# ─────────────────────────────────────────────────────────────────────────────


class AnvilForkSimulator:
    """The supervised Anvil Base-mainnet fork Simulator (SIM_FORK_RPC_URL).

    Owns its ``httpx.AsyncClient``; use as an async context manager or call
    ``aclose()``. All methods are fail-closed on a transport failure.
    """

    provider: SimulationProvider = "anvil_fork"

    def __init__(self, rpc_url: str, *, client: httpx.AsyncClient | None = None) -> None:
        self._rpc_url = rpc_url
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=_RPC_TIMEOUT_S)
        self._rpc = _JsonRpcClient(rpc_url, self._client)

    async def __aenter__(self) -> AnvilForkSimulator:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # -- probes ---------------------------------------------------------------

    async def smoke_test(self) -> SmokeResult:
        """Prove the backend works: eth_chainId + eth_blockNumber + a trivial eth_call.

        The trivial call reads Base-USDC ``decimals()`` (expected 6) to confirm the
        fork actually has Base-mainnet state, not just an empty chain.
        """
        try:
            chain_id = _from_hex(await self._rpc.call("eth_chainId", []))
            block_number = _from_hex(await self._rpc.call("eth_blockNumber", []))
        except (SimulatorUnavailableError, JsonRpcError) as exc:
            return SmokeResult(ok=False, detail=f"fork unreachable: {exc}")

        # Base-mainnet USDC — a stable target present on the fork (addresses/base.ts).
        usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        probe_ok = False
        probe_value: int | None = None
        detail = "eth_blockNumber + eth_call OK"
        try:
            raw = await self._rpc.call(
                "eth_call", [{"to": usdc, "data": _DECIMALS_SELECTOR}, "latest"]
            )
            probe_value = _from_hex(raw)
            probe_ok = True
        except (SimulatorUnavailableError, JsonRpcError) as exc:
            detail = f"eth_call probe failed: {exc}"

        return SmokeResult(
            ok=probe_ok,
            chain_id=chain_id,
            block_number=block_number,
            probe_call_ok=probe_ok,
            probe_value=probe_value,
            detail=detail,
        )

    # -- reads ----------------------------------------------------------------

    async def _balance_of(self, asset: TrackedAsset, holder: str) -> int:
        if asset.address == NATIVE_TOKEN_SENTINEL:
            return _from_hex(await self._rpc.call("eth_getBalance", [holder, "latest"]))
        data = _BALANCE_OF_SELECTOR + _pad_address(holder)
        raw = await self._rpc.call("eth_call", [{"to": asset.address, "data": data}, "latest"])
        return _from_hex(raw) if raw and raw != "0x" else 0

    async def _read_balances(self, assets: Sequence[TrackedAsset], holder: str) -> dict[str, int]:
        return {a.address: await self._balance_of(a, holder) for a in assets}

    async def _block_meta(self) -> tuple[int, str]:
        block_number = _from_hex(await self._rpc.call("eth_blockNumber", []))
        block = await self._rpc.call("eth_getBlockByNumber", ["latest", False])
        ts = _from_hex(block["timestamp"]) if isinstance(block, dict) else 0
        as_of = datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")
        return block_number, as_of

    async def _await_receipt(self, tx_hash: str) -> dict[str, Any]:
        for _ in range(_RECEIPT_MAX_ATTEMPTS):
            receipt = await self._rpc.call("eth_getTransactionReceipt", [tx_hash])
            if isinstance(receipt, dict):
                return receipt
            await asyncio.sleep(_RECEIPT_DELAY_S)
        raise SimulatorUnavailableError(f"no receipt for {tx_hash} after fork execution")

    # -- simulate -------------------------------------------------------------

    async def simulate(self, request: SimulationRequest) -> SimulationResult:
        """Produce a fork preview for an ``eoa_call`` (unsigned direct call).

        Sequence (research.md §8): eth_call revert/return check → eth_estimateGas
        → (if it will not revert AND assets are tracked) evm_snapshot →
        fund+impersonate+send → before/after ``balanceOf`` diffs → evm_revert.
        A transport failure raises ``SimulatorUnavailableError`` (fail-closed).
        """
        if request.op_type != "eoa_call":
            raise ValueError("AnvilForkSimulator.simulate handles eoa_call; use the bundler path")

        call_obj = {
            "from": request.sender,
            "to": request.to,
            "value": _to_hex_qty(request.value),
            "data": request.data,
        }
        block_number, as_of = await self._block_meta()

        # 1) revert/return check via eth_call.
        will_revert = False
        revert_reason: str | None = None
        try:
            await self._rpc.call("eth_call", [call_obj, "latest"])
        except JsonRpcError as exc:
            will_revert = True
            revert_reason = _decode_revert_reason(exc.data) or exc.rpc_message

        # 2) gas estimate (best-effort; a reverting call has no meaningful estimate).
        gas_hex = "0x0"
        if not will_revert:
            try:
                gas_hex = await self._rpc.call("eth_estimateGas", [call_obj])
            except JsonRpcError as exc:
                logger.debug("eth_estimateGas failed: %s", exc)

        # 3) before/after asset deltas (only when it will not revert).
        deltas: list[BalanceDelta] = []
        if not will_revert and request.track_assets:
            deltas, gas_used = await self._diff_balances(request, call_obj)
            if gas_used is not None:
                gas_hex = _to_hex_qty(gas_used)

        out_amount, shares_out, assets_out = self._output_legs(request, deltas)

        return SimulationResult(
            provider=self.provider,
            willRevert=will_revert,
            revertReason=revert_reason,
            balanceDeltas=deltas,
            sharesOut=shares_out,
            assetsOut=assets_out,
            outAmount=out_amount,
            minOut=str(request.min_out) if request.min_out is not None else None,
            priceImpactBps=0,  # requires a quote vs execution price (pricing module, §9)
            slippageBps=0,  # realized slippage requires a quote; on-chain minOut backstops
            feesUsd="0",  # USD enrichment deferred to the pricing module (§9)
            gas=GasEstimate(estimate=gas_hex, gasUsd="0"),
            capHeadroom=None,  # deposit-side; requires on-chain vault-cap reads (not deployed)
            asOfBlock=block_number,
            asOf=as_of,
        )

    async def _diff_balances(
        self, request: SimulationRequest, call_obj: dict[str, str]
    ) -> tuple[list[BalanceDelta], int | None]:
        """Snapshot → fund+impersonate+send → read post → revert. Returns deltas + gasUsed."""
        assets = request.track_assets
        snapshot = await self._rpc.call("evm_snapshot", [])
        gas_used: int | None = None
        try:
            # Fund the sender so gas never fails inside the snapshot (reverted after).
            await self._rpc.call("anvil_setBalance", [request.sender, _to_hex_qty(10**19)])
            pre = await self._read_balances(assets, request.sender)
            await self._rpc.call("anvil_impersonateAccount", [request.sender])
            try:
                tx_hash = await self._rpc.call("eth_sendTransaction", [call_obj])
                receipt = await self._await_receipt(tx_hash)
                gas_used = _from_hex(receipt["gasUsed"]) if "gasUsed" in receipt else None
            finally:
                # best-effort un-impersonate; a failure here must not mask the result
                try:
                    await self._rpc.call("anvil_stopImpersonatingAccount", [request.sender])
                except (SimulatorUnavailableError, JsonRpcError) as exc:
                    logger.debug("stopImpersonating failed: %s", exc)
            post = await self._read_balances(assets, request.sender)
        finally:
            await self._rpc.call("evm_revert", [snapshot])

        deltas = [
            BalanceDelta(
                asset=a.address,
                decimals=a.decimals,
                delta=str(post[a.address] - pre[a.address]),
                deltaUsd="0",
            )
            for a in assets
        ]
        return deltas, gas_used

    @staticmethod
    def _output_legs(
        request: SimulationRequest, deltas: Sequence[BalanceDelta]
    ) -> tuple[str | None, str | None, str | None]:
        """Select (outAmount, sharesOut, assetsOut) from deltas per the action kind.

        These are mutually exclusive per the schema. When ``out_asset`` is set we
        use its positive delta; otherwise a swap infers ``outAmount`` from the
        largest positive delta. Deposits→sharesOut, exits→assetsOut, swaps→outAmount.
        """
        action = request.action
        if action is None or not deltas:
            return None, None, None

        chosen: int | None = None
        if request.out_asset is not None:
            for d in deltas:
                if d.asset == request.out_asset:
                    chosen = int(d.delta)
                    break
        if chosen is None:
            positives = [int(d.delta) for d in deltas if int(d.delta) > 0]
            chosen = max(positives) if positives else None
        if chosen is None or chosen <= 0:
            return None, None, None

        value = str(chosen)
        if action is ActionType.AERODROME_SWAP:
            return value, None, None
        if action is ActionType.VAULT_DEPOSIT:
            return None, value, None
        if action in (ActionType.VAULT_WITHDRAW, ActionType.VAULT_REDEEM, ActionType.AAVE_WITHDRAW):
            return None, None, value
        return None, None, None


# ─────────────────────────────────────────────────────────────────────────────
# viem_eth_call — lightweight live-chain check (oracle-free-path fallback)
# ─────────────────────────────────────────────────────────────────────────────


class ViemEthCallChecker:
    """A live-chain ``eth_call`` revert/return check (research.md §8 fallback).

    No state execution → no balance deltas; it only proves the call would not
    revert and returns a gas estimate. Used ONLY as the oracle-free-path fallback
    for deterministic actions when the primary fork is unavailable; a swap must
    NEVER fall back here (slippage cannot be locally guaranteed).
    """

    provider: SimulationProvider = "viem_eth_call"

    def __init__(self, rpc_url: str, *, client: httpx.AsyncClient | None = None) -> None:
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=_RPC_TIMEOUT_S)
        self._rpc = _JsonRpcClient(rpc_url, self._client)

    async def __aenter__(self) -> ViemEthCallChecker:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def check(self, request: SimulationRequest) -> SimulationResult:
        if request.action is ActionType.AERODROME_SWAP:
            raise SimulatorUnavailableError(
                "viem_eth_call is not a valid fallback for a swap (slippage unguaranteed)"
            )
        call_obj = {
            "from": request.sender,
            "to": request.to,
            "value": _to_hex_qty(request.value),
            "data": request.data,
        }
        block_number = _from_hex(await self._rpc.call("eth_blockNumber", []))
        as_of = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")

        will_revert = False
        revert_reason: str | None = None
        try:
            await self._rpc.call("eth_call", [call_obj, "latest"])
        except JsonRpcError as exc:
            will_revert = True
            revert_reason = _decode_revert_reason(exc.data) or exc.rpc_message

        gas_hex = "0x0"
        if not will_revert:
            try:
                gas_hex = await self._rpc.call("eth_estimateGas", [call_obj])
            except JsonRpcError as exc:
                logger.debug("eth_estimateGas failed: %s", exc)

        return SimulationResult(
            provider=self.provider,
            willRevert=will_revert,
            revertReason=revert_reason,
            balanceDeltas=[],
            sharesOut=None,
            assetsOut=None,
            outAmount=None,
            minOut=str(request.min_out) if request.min_out is not None else None,
            priceImpactBps=0,
            slippageBps=0,
            feesUsd="0",
            gas=GasEstimate(estimate=gas_hex, gasUsd="0"),
            capHeadroom=None,
            asOfBlock=block_number,
            asOf=as_of,
        )


# ─────────────────────────────────────────────────────────────────────────────
# bundler_gas_estimate — ERC-4337 UserOp path (seam)
# ─────────────────────────────────────────────────────────────────────────────


class BundlerGasEstimator:
    """The ERC-4337 UserOp gas path: eth_estimateUserOperationGas +
    EntryPoint.simulateHandleOp.

    A seam: it needs a bundler RPC (not in the launch env), so ``estimate`` raises
    ``SimulatorUnavailableError`` until one is wired. The interface is fixed so the
    executor/vault_manager can target it without change.
    """

    provider: SimulationProvider = "bundler_gas_estimate"

    def __init__(self, bundler_url: str | None, *, client: httpx.AsyncClient | None = None) -> None:
        self._bundler_url = bundler_url
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=_RPC_TIMEOUT_S)
        self._rpc = _JsonRpcClient(bundler_url, self._client) if bundler_url else None

    async def __aenter__(self) -> BundlerGasEstimator:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def estimate(self, request: SimulationRequest) -> SimulationResult:
        if self._rpc is None:
            raise SimulatorUnavailableError("no bundler RPC configured (bundler_gas_estimate)")
        if request.user_op is None or request.entry_point is None:
            raise ValueError("bundler path requires user_op + entry_point")
        block_number = _from_hex(await self._rpc.call("eth_blockNumber", []))
        as_of = datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
        gas = await self._rpc.call(
            "eth_estimateUserOperationGas", [request.user_op.fields, request.entry_point]
        )
        # Sum the returned userop gas legs into a single estimate.
        total = 0
        if isinstance(gas, dict):
            for key in ("preVerificationGas", "verificationGasLimit", "callGasLimit"):
                raw = gas.get(key)
                if isinstance(raw, str):
                    total += _from_hex(raw)
        return SimulationResult(
            provider=self.provider,
            willRevert=False,
            revertReason=None,
            balanceDeltas=[],
            sharesOut=None,
            assetsOut=None,
            outAmount=None,
            minOut=str(request.min_out) if request.min_out is not None else None,
            priceImpactBps=0,
            slippageBps=0,
            feesUsd="0",
            gas=GasEstimate(estimate=_to_hex_qty(total), gasUsd="0"),
            capHeadroom=None,
            asOfBlock=block_number,
            asOf=as_of,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Simulator facade — dispatch + fail-closed policy
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Simulator:
    """The seam the executor/vault_manager call: ``simulate(request) -> SimulationResult``.

    ``anvil_fork`` is PRIMARY. For a userop with a configured bundler, the bundler
    gas path is used. On a primary-fork outage, a SWAP fail-closes
    (``SimulatorUnavailableError``); a deterministic, oracle-free action may fall
    back to ``viem_eth_call`` when one is configured (research.md §8).
    """

    anvil: AnvilForkSimulator
    viem: ViemEthCallChecker | None = None
    bundler: BundlerGasEstimator | None = None
    _swap_actions: frozenset[ActionType] = field(
        default=frozenset({ActionType.AERODROME_SWAP}), init=False, repr=False
    )

    async def simulate(self, request: SimulationRequest) -> SimulationResult:
        if request.op_type == "userop" and self.bundler is not None:
            return await self.bundler.estimate(request)

        try:
            return await self.anvil.simulate(request)
        except SimulatorUnavailableError:
            is_swap = request.action in self._swap_actions
            if is_swap or self.viem is None:
                # Swaps fail-closed; with no oracle-free fallback, everything does.
                raise
            logger.warning(
                "anvil_fork unavailable; falling back to viem_eth_call for %s", request.action
            )
            return await self.viem.check(request)


def anvil_fork_from_env(
    env_var: str = "SIM_FORK_RPC_URL", *, client: httpx.AsyncClient | None = None
) -> AnvilForkSimulator:
    """Build the primary fork Simulator from ``SIM_FORK_RPC_URL`` (fail-closed if unset)."""
    url = os.getenv(env_var)
    if not url:
        raise SimulatorUnavailableError(f"{env_var} is not set")
    return AnvilForkSimulator(url, client=client)
