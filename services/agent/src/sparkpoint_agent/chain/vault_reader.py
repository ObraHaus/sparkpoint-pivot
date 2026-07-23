"""Async, fail-closed chain-read client over the SparkPointVault ABI.

The on-chain vault is truth (agent-service-api.md §3.7). This client reads it and
NEVER re-derives ERC-4626 math in Python: ``previewDeposit``/``previewRedeem``/… are
``eth_call``-ed against the deployed vault so their rounding (round-DOWN in the vault's
favor for deposit/redeem, per EIP-4626) mirrors the contract exactly. The
/vault/quote endpoints + the fee indexer build on these reads.

eth_call approach
-----------------
httpx JSON-RPC (httpx is already a service dependency, async-native, matches the
existing routers) for transport + ``eth-abi`` for ABI encode/decode. Function
SELECTORS are read from the compiled artifact's ``methodIdentifiers`` and the argument
/return TYPES from its ``abi`` — both authoritative from ``forge build`` output, never
hand-written/guessed (per the repo's ABI rule). ``web3.AsyncWeb3`` was rejected: it
bundles ``eth-account`` key/signing machinery, and a surface that must PROVABLY hold no
key should not import signing code — ``eth-abi`` is the pure codec with no key surface.

Non-custody (N1/N2)
-------------------
Read-only and keyless. The method registry is filtered to ``view``/``pure`` functions,
so it is structurally impossible to encode a state-changing (``deposit``/``redeem``/
``approve``/…) call through this client; only ``eth_call`` + ``eth_blockNumber`` are
ever issued — never ``eth_sendTransaction``/``eth_sendRawTransaction``. When the vault
is not deployed (address unset / no code) or the RPC is unreachable, reads raise a typed
:class:`VaultUnavailable` the endpoint maps to a clean §1.6 envelope — never a fabricated
value.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import eth_abi
import httpx

from ..config import AgentConfig

# ─────────────────────────────────────────────────────────────────────────────
# Typed unavailability (fail-closed)
# ─────────────────────────────────────────────────────────────────────────────


class VaultUnavailableReason(Enum):
    """Why a read could not produce a real on-chain value. The endpoint maps each to a
    §1.6 error code (never a fabricated value):

      - NOT_DEPLOYED    → SIMULATION_UNAVAILABLE (no vault address / no code at address).
      - RPC_UNREACHABLE → UPSTREAM_UNAVAILABLE   (transport/JSON-RPC/decoding failure).
    """

    NOT_DEPLOYED = "NOT_DEPLOYED"
    RPC_UNREACHABLE = "RPC_UNREACHABLE"


class VaultUnavailable(Exception):
    """A real on-chain value is unavailable. Carries a :class:`VaultUnavailableReason`
    so the endpoint chooses SIMULATION_UNAVAILABLE vs UPSTREAM_UNAVAILABLE. Never
    carries or implies a fabricated quote."""

    def __init__(self, reason: VaultUnavailableReason, message: str) -> None:
        super().__init__(message)
        self.reason = reason


# ─────────────────────────────────────────────────────────────────────────────
# ABI method registry — selectors + types loaded from the compiled artifact
# ─────────────────────────────────────────────────────────────────────────────

_ABI_PATH_ENV = "SPARKPOINT_VAULT_ABI_PATH"
_ARTIFACT_REL_PARTS = ("contracts", "out", "SparkPointVault.sol", "SparkPointVault.json")

# The read methods this client exposes (view/pure only), SPLIT per specs/010-universal-vaults
# data-model.md §2 so a generic ERC-4626 vault (a curated Morpho vault, QuickNode-Earn) can be
# read with the standard subset while a SparkPoint(-branded wrapper) vault still requires its full
# superset. Every method here is view/pure — it is structurally impossible to encode a
# state-changing (deposit/withdraw/approve/…) call for ANY vault through this client (non-custody).

# The EIP-4626 (+ ERC-20) standard read surface every registered vault must expose.
_ERC4626_CORE_METHODS: frozenset[str] = frozenset(
    {
        "asset",
        "totalAssets",
        "totalSupply",
        "decimals",
        "balanceOf",
        "convertToAssets",
        "convertToShares",
        "maxDeposit",
        "maxMint",
        "maxWithdraw",
        "maxRedeem",
        "previewDeposit",
        "previewMint",
        "previewWithdraw",
        "previewRedeem",
    }
)

# The SparkPoint-only extras (fee/pause/HWM). NOT part of a generic ERC-4626 vault — a
# SparkPointMorphoVault WRAPPER exposes them too (it registers ``abiKind='sparkpoint'``).
_SPARKPOINT_EXTRA_METHODS: frozenset[str] = frozenset(
    {
        "paused",
        "performanceFeeBps",
        "highWaterMark",
        "feeRecipient",
    }
)

# Back-compat: the existing name stays the SparkPoint superset (core | extras). This is the
# drift guard for ``abiKind='sparkpoint'`` — a SparkPoint (launch or branded-wrapper) vault MUST
# expose every method; the load fails CLOSED if the compiled ABI is missing any (a build misconfig).
_REQUIRED_METHODS: frozenset[str] = _ERC4626_CORE_METHODS | _SPARKPOINT_EXTRA_METHODS

# The two supported reader modes (data-model §2). ``sparkpoint`` requires the superset (fail-CLOSED
# on drift, unchanged); ``erc4626`` requires only the core (a missing core method ⇒ that vault is
# "unavailable", fail-OPEN — the app degrades, it does not crash; extras are simply absent).
_ABI_KINDS: frozenset[str] = frozenset({"sparkpoint", "erc4626"})


def _required_methods_for(abi_kind: str) -> frozenset[str]:
    """The method set a given ``abiKind`` mode must find in the compiled ABI (data-model §2).

    ``sparkpoint`` ⇒ the full SparkPoint superset; ``erc4626`` ⇒ the generic-4626 core only.
    """
    if abi_kind not in _ABI_KINDS:
        raise ValueError(f"unknown abiKind {abi_kind!r} (expected one of {sorted(_ABI_KINDS)})")
    return _ERC4626_CORE_METHODS if abi_kind == "erc4626" else _REQUIRED_METHODS


@dataclass(frozen=True, slots=True)
class VaultMethod:
    """One resolved view/pure method: authoritative selector + ABI types from the artifact."""

    selector: str  # "0x" + 8 hex, from methodIdentifiers
    input_types: tuple[str, ...]
    output_types: tuple[str, ...]
    signature: str


def _find_artifact() -> Path:
    """Locate the compiled ``SparkPointVault.json``.

    Honors the ``SPARKPOINT_VAULT_ABI_PATH`` override (for a vendored copy), else walks
    up from this file to the repo's ``contracts/out/…`` artifact. Fails loudly if absent
    (a build/deploy misconfig — ``forge build`` must have run), which is distinct from an
    operational :class:`VaultUnavailable`.
    """
    override = os.getenv(_ABI_PATH_ENV)
    if override:
        path = Path(override)
        if not path.is_file():
            raise RuntimeError(f"{_ABI_PATH_ENV}={override!r} does not point to a file.")
        return path
    for parent in Path(__file__).resolve().parents:
        candidate = parent.joinpath(*_ARTIFACT_REL_PARTS)
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        "SparkPointVault artifact not found — run `forge build` in contracts/, or set "
        f"{_ABI_PATH_ENV} to a vendored SparkPointVault.json."
    )


@lru_cache(maxsize=len(_ABI_KINDS))
def load_vault_methods(abi_kind: str = "sparkpoint") -> dict[str, VaultMethod]:
    """Parse the artifact into a view/pure method registry (selector + types).

    Only ``view``/``pure`` functions are included, so a state-changing selector can never
    be built through this client (non-custody), for a SparkPoint vault OR a generic ERC-4626 one.

    The ``abi_kind`` mode selects the drift-guard method set (data-model §2):

      - ``sparkpoint`` (default) requires the full :data:`_REQUIRED_METHODS` superset and fails
        CLOSED with a :class:`RuntimeError` when the compiled ABI is missing any (a build misconfig,
        distinct from an operational :class:`VaultUnavailable`); the launch-vault posture unchanged.
      - ``erc4626`` requires only :data:`_ERC4626_CORE_METHODS`; a missing CORE method fails OPEN
        with :class:`VaultUnavailable` so a single hostile/degenerate external vault is marked
        "unavailable" rather than crashing the app. The SparkPoint extras are simply absent.
    """
    required = _required_methods_for(abi_kind)
    data = json.loads(_find_artifact().read_text())
    abi = data["abi"]
    method_ids = data.get("methodIdentifiers", {})

    registry: dict[str, VaultMethod] = {}
    for entry in abi:
        if entry.get("type") != "function":
            continue
        if entry.get("stateMutability") not in ("view", "pure"):
            continue  # non-custody: never register a fund-moving/state-changing method
        name = entry["name"]
        input_types = tuple(i["type"] for i in entry["inputs"])
        output_types = tuple(o["type"] for o in entry["outputs"])
        signature = f"{name}({','.join(input_types)})"
        selector = method_ids.get(signature)
        if selector is None:
            continue
        registry[name] = VaultMethod(
            selector=f"0x{selector}",
            input_types=input_types,
            output_types=output_types,
            signature=signature,
        )

    missing = sorted(required - registry.keys())
    if missing:
        if abi_kind == "erc4626":
            # FOLLOW-UP (010): this fail-OPEN core-only branch is groundwork. Today
            # ``_find_artifact`` resolves the SparkPoint SUPERSET artifact for BOTH modes, so the
            # erc4626 core is always a present subset — this branch is effectively unreachable
            # until 010 lands per-external-vault ABI resolution (a real generic ERC-4626 vault's
            # OWN artifact, which may genuinely lack a core method). Then it degrades that one
            # vault to "unavailable" instead of crashing. No behavior change here now.
            #
            # Fail-OPEN, per-vault: a generic ERC-4626 vault missing a core method is "unavailable",
            # never a fabricated value and never a crash (data-model §2).
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED,
                f"vault ABI is missing required ERC-4626 core methods: {missing}",
            )
        # Fail-CLOSED drift guard for the SparkPoint superset (unchanged).
        raise RuntimeError(
            f"compiled SparkPointVault ABI is missing required view methods: {missing}"
        )
    return registry


# ─────────────────────────────────────────────────────────────────────────────
# JSON-RPC transport
# ─────────────────────────────────────────────────────────────────────────────


class JsonRpcTransport(Protocol):
    """Minimal async JSON-RPC transport. Returns the ``result`` string (hex); raises
    :class:`VaultUnavailable` (RPC_UNREACHABLE) on any transport/protocol error."""

    async def call(self, method: str, params: Sequence[Any]) -> str: ...


class HttpxJsonRpcTransport:
    """httpx-backed JSON-RPC transport. Injectable client for connection reuse; when none
    is given, a short-lived client is used per call (fine for low-QPS reads)."""

    def __init__(
        self,
        url: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._url = url
        self._client = client
        self._timeout = timeout

    async def call(self, method: str, params: Sequence[Any]) -> str:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)}
        try:
            if self._client is not None:
                response = await self._client.post(self._url, json=payload, timeout=self._timeout)
            else:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(self._url, json=payload)
        except httpx.HTTPError as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, f"RPC transport error: {exc}"
            ) from exc

        if response.status_code != 200:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, f"RPC HTTP {response.status_code}"
            )
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, "RPC returned non-JSON body"
            ) from exc

        if not isinstance(body, dict):
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, "RPC response is not a JSON object"
            )
        if body.get("error") is not None:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, f"RPC error: {body['error']}"
            )
        result = body.get("result")
        if not isinstance(result, str):
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE, "RPC response missing a string result"
            )
        return result


# ─────────────────────────────────────────────────────────────────────────────
# Vault reader
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_address(value: str) -> str:
    """Lowercase a 0x-address argument (checksum-agnostic; avoids any keccak dependency).

    :raises ValueError: if not a 20-byte 0x address. Callers pass addresses already
        validated upstream (X-Account/X-Owner headers); a bad one is a programmer error.
    """
    candidate = value.lower()
    if not (candidate.startswith("0x") and len(candidate) == 42):
        raise ValueError(f"not a 20-byte 0x address: {value!r}")
    int(candidate, 16)  # reject non-hex
    return candidate


class VaultReader:
    """Async reads over the deployed SparkPointVault. Read-only, keyless, fail-closed.

    All amounts are raw base units as Python ``int`` (EVM parity, never floats). Address
    returns are lowercased 0x strings. Every read raises :class:`VaultUnavailable` (rather
    than returning a fabricated value) when the vault is undeployed or the RPC is
    unreachable — see :class:`VaultUnavailableReason` for the endpoint's error mapping.
    """

    def __init__(
        self,
        *,
        vault_address: str | None,
        transport: JsonRpcTransport,
        abi_kind: str = "sparkpoint",
    ) -> None:
        self._vault = vault_address.lower() if vault_address else None
        self._transport = transport
        # Which method set the reader validates + encodes against (data-model §2). The launch Aave
        # vault AND a SparkPoint-branded Morpho WRAPPER are both ``sparkpoint`` (they expose the
        # superset). A generic external ERC-4626 vault is read with ``erc4626`` (core only).
        self._abi_kind = abi_kind if abi_kind in _ABI_KINDS else "sparkpoint"

    @classmethod
    def from_config(
        cls,
        config: AgentConfig,
        *,
        transport: JsonRpcTransport | None = None,
        abi_kind: str = "sparkpoint",
    ) -> VaultReader:
        """Build a reader from :class:`AgentConfig`.

        The vault address may be ``None`` (undeployed) — the reader still constructs, and
        each read fails closed with NOT_DEPLOYED. If no transport is injected and no RPC
        url is configured, construction fails closed with RPC_UNREACHABLE. ``abi_kind`` defaults
        to ``sparkpoint`` (the launch vault / a branded wrapper); pass ``erc4626`` to read a
        generic external ERC-4626 vault with the standard-subset drift guard.
        """
        if transport is None:
            if not config.rpc_url:
                raise VaultUnavailable(
                    VaultUnavailableReason.RPC_UNREACHABLE,
                    "no RPC url configured for the vault read surface.",
                )
            transport = HttpxJsonRpcTransport(config.rpc_url)
        return cls(
            vault_address=config.vault_address, transport=transport, abi_kind=abi_kind
        )

    async def _read(self, method_name: str, args: Sequence[Any]) -> Any:
        """eth_call one view method against the vault; return its first decoded output."""
        if self._vault is None:
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED,
                "SPARKPOINT_VAULT_ADDRESS is unset — the vault is not deployed on this chain.",
            )
        return await self._read_at(self._vault, method_name, args)

    async def _read_at(self, to: str, method_name: str, args: Sequence[Any]) -> Any:
        """eth_call one loaded view method against an arbitrary ``to`` (the vault, or its
        underlying ERC-20 for idle-balance reads). Same fail-closed decode as :meth:`_read`."""
        method = load_vault_methods(self._abi_kind)[method_name]
        data = method.selector + eth_abi.encode(list(method.input_types), list(args)).hex()
        result = await self._transport.call(
            "eth_call", [{"to": to.lower(), "data": data}, "latest"]
        )

        if result in ("0x", ""):
            # No return data ⇒ typically no code at the address (contract not deployed here).
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED,
                f"{method_name}: empty eth_call result (no code at {to}?).",
            )
        try:
            raw = bytes.fromhex(result[2:] if result.startswith("0x") else result)
            decoded = eth_abi.decode(list(method.output_types), raw)
        except Exception as exc:  # malformed/short hex, ABI mismatch, etc.
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE,
                f"{method_name}: could not decode eth_call result.",
            ) from exc
        return decoded[0]

    # ── ERC-4626 preview/convert (read straight from chain — rounding mirrors the vault) ──

    async def preview_deposit(self, assets: int) -> int:
        """previewDeposit(assets) → shares (rounds DOWN, in the vault's favor)."""
        return int(await self._read("previewDeposit", [assets]))

    async def preview_mint(self, shares: int) -> int:
        """previewMint(shares) → assets (rounds UP, in the vault's favor)."""
        return int(await self._read("previewMint", [shares]))

    async def preview_withdraw(self, assets: int) -> int:
        """previewWithdraw(assets) → shares (rounds UP, in the vault's favor)."""
        return int(await self._read("previewWithdraw", [assets]))

    async def preview_redeem(self, shares: int) -> int:
        """previewRedeem(shares) → assets (rounds DOWN; ALREADY net of fee-share dilution)."""
        return int(await self._read("previewRedeem", [shares]))

    async def convert_to_assets(self, shares: int) -> int:
        """convertToAssets(shares) → assets (ideal, rounds DOWN)."""
        return int(await self._read("convertToAssets", [shares]))

    async def convert_to_shares(self, assets: int) -> int:
        """convertToShares(assets) → shares (ideal, rounds DOWN)."""
        return int(await self._read("convertToShares", [assets]))

    # ── Caps / limits (ERC-4626 max*) ──

    async def max_deposit(self, receiver: str) -> int:
        """maxDeposit(receiver) → assets; 0 when at cap (caps meter for the deposit quote)."""
        return int(await self._read("maxDeposit", [_normalize_address(receiver)]))

    async def max_withdraw(self, owner: str) -> int:
        """maxWithdraw(owner) → assets (withdraw quote; never cap/pause-gated, N2)."""
        return int(await self._read("maxWithdraw", [_normalize_address(owner)]))

    async def max_redeem(self, owner: str) -> int:
        """maxRedeem(owner) → shares (withdraw quote; never cap/pause-gated, N2)."""
        return int(await self._read("maxRedeem", [_normalize_address(owner)]))

    # ── Vault state / fee params (all public-view; provable on-chain, N5) ──

    async def total_assets(self) -> int:
        """totalAssets() → assets under management."""
        return int(await self._read("totalAssets", []))

    async def total_supply(self) -> int:
        """totalSupply() → total vault shares."""
        return int(await self._read("totalSupply", []))

    async def paused(self) -> bool:
        """paused() → deposit kill-switch. PAUSE IS DEPOSIT-ONLY; withdraws never gate (N2)."""
        return bool(await self._read("paused", []))

    async def performance_fee_bps(self) -> int:
        """performanceFeeBps() → current profit-only fee rate (default 1000; hard cap 2000)."""
        return int(await self._read("performanceFeeBps", []))

    async def high_water_mark(self) -> int:
        """highWaterMark() → current share-price HWM; fee accrues only above this."""
        return int(await self._read("highWaterMark", []))

    async def fee_recipient(self) -> str:
        """feeRecipient() → the fee-share recipient (lowercased 0x address)."""
        return str(await self._read("feeRecipient", []))

    async def asset(self) -> str:
        """asset() → the underlying ERC-20 (USDC) address (lowercased 0x)."""
        return str(await self._read("asset", []))

    async def balance_of(self, owner: str) -> int:
        """balanceOf(owner) → the owner's vault-share balance."""
        return int(await self._read("balanceOf", [_normalize_address(owner)]))

    async def token_balance_of(self, token: str, owner: str) -> int:
        """ERC-20 ``balanceOf(owner)`` on an arbitrary ``token`` (e.g. the vault's underlying
        USDC) → raw base units. Used for the "idle cash" line — the spare wallet balance that
        isn't in the vault. Fail-closed (``VaultUnavailable``) like every other read."""
        return int(await self._read_at(token, "balanceOf", [_normalize_address(owner)]))

    async def token_allowance(self, token: str, owner: str, spender: str) -> int:
        """ERC-20 ``allowance(owner, spender)`` on an arbitrary ``token`` (e.g. the vault's
        underlying USDC) → raw base units. Used by the §018/US2 deposit dry-run to tell a
        "just needs approval" state apart from a genuine revert (a deposit ``eth_call`` reverts
        on ``transferFrom`` when allowance < amount — not a real problem). Fail-closed
        (``VaultUnavailable``) like every other read; view-only, never custody."""
        return int(
            await self._read_at(
                token, "allowance", [_normalize_address(owner), _normalize_address(spender)]
            )
        )

    async def native_balance(self, owner: str) -> int:
        """eth_getBalance(owner) → the owner's NATIVE coin balance in wei (ETH on Base / Robinhood
        testnet). Powers the wallet's native holding on chains without a vault. Fail-closed
        (``VaultUnavailable``) like every other read — never a fabricated balance."""
        result = await self._transport.call(
            "eth_getBalance", [_normalize_address(owner), "latest"]
        )
        try:
            return int(result, 16)
        except (ValueError, TypeError) as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE,
                f"eth_getBalance returned a non-hex quantity: {result!r}",
            ) from exc

    # ── Chain head ──

    async def block_number(self) -> int:
        """eth_blockNumber → the current block (stamped as ``asOfBlock`` for reproducibility)."""
        result = await self._transport.call("eth_blockNumber", [])
        try:
            return int(result, 16)
        except ValueError as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE,
                f"eth_blockNumber returned a non-hex quantity: {result!r}",
            ) from exc
