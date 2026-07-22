"""Read + PREPARE-CALLDATA client for the feature-011 branded-wrapper factory (admin MANAGE half).

This backs the ``/admin/vaults`` MANAGE endpoints (``api/admin_vaults.py``). Like
:mod:`.vault_reader` it is **keyless**: the transport only ever issues ``eth_call`` (view reads) —
it NEVER issues ``eth_sendTransaction``/``eth_sendRawTransaction`` and holds no key. The mutating
admin flows do NOT sign here; they call the pure ``*_calldata`` builders below, which return a hex
calldata STRING the operator signs off-app from the owner/timelock wallet. Encoding a
``createVault``/``schedule`` selector produces text — it moves nothing (N1).

Selectors + ABI arg types are read from the compiled Foundry artifacts' ``methodIdentifiers`` +
``abi`` (authoritative — never hand-written), exactly per the repo's ABI rule.

NON-CUSTODY invariants this surface preserves:
  * N1  no key, no fund path: reads are ``eth_call``-only; the "calldata" it emits is a string the
        operator signs elsewhere. There is NO move-funds verb — the guardian-action builder only
        emits pause/unpause/fee/recipient/caps calls (never withdraw/sweep/migrate/transfer).
  * N2  nothing here is on the withdraw/exit path; a wrapper's redeem escape hatch never depends on
        this module being reachable.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import eth_abi

from .vault_reader import JsonRpcTransport, VaultUnavailable, VaultUnavailableReason

# ── Compiled-artifact locations (walked up to from this file, like vault_reader) ──
_FACTORY_ARTIFACT = (
    "contracts", "out", "SparkPointVaultFactory.sol", "SparkPointVaultFactory.json",
)
_WRAPPER_ARTIFACT = ("contracts", "out", "SparkPointMorphoVault.sol", "SparkPointMorphoVault.json")
_CAP_ARTIFACT = ("contracts", "out", "CapRegistry.sol", "CapRegistry.json")
_TIMELOCK_ARTIFACT = ("contracts", "out", "TimelockController.sol", "TimelockController.json")

_ZERO_BYTES32 = b"\x00" * 32


# ── Method registry (selector + canonical arg types from the artifact) ───────────


@dataclass(frozen=True, slots=True)
class AbiMethod:
    """One resolved contract method: authoritative selector + canonical ABI types."""

    selector: str  # "0x" + 8 hex, from methodIdentifiers
    input_types: tuple[str, ...]
    output_types: tuple[str, ...]


def _canonical_type(entry: Mapping[str, Any]) -> str:
    """Collapse an ABI input/output entry to its canonical type string (recursing into tuples).

    ``eth_abi`` needs ``(uint256,uint256)`` for a struct arg, not the ABI's ``"tuple"`` — this is
    what makes ``createVault(address,uint16,(uint256,uint256),string)`` encodable.
    """
    typ = str(entry["type"])
    if typ.startswith("tuple"):
        inner = ",".join(_canonical_type(c) for c in entry.get("components", ()))
        suffix = typ[len("tuple"):]  # keeps any [] / [k] array marker
        return f"({inner}){suffix}"
    return typ


def _find_artifact(rel_parts: tuple[str, ...]) -> Path:
    """Resolve a contract artifact. Resolution order (first hit wins):

    1. ``SPARKPOINT_ARTIFACTS_DIR`` override (a forge ``out/`` dir), if set.
    2. the repo's freshly-built ``contracts/out/…`` (after ``forge build`` — local dev).
    3. the VENDORED export inside the agent image: ``chain/abi/<Contract>.abi.json`` (a sibling
       dir of this module the Dockerfile ``COPY src`` bakes in — the RUNTIME source of truth, since
       the image has no ``contracts/out`` or ``packages/shared``).
    4. the repo committed export ``packages/shared/src/abis/<Contract>.abi.json`` (CI / local).

    Steps 3-4 let the agent (image or CI) need no ``forge build`` — mirroring ``vault_reader``'s
    ``SPARKPOINT_VAULT_ABI_PATH`` export. Only ``abi`` + ``methodIdentifiers`` are read (no bytecode
    — ``predictVaultAddress`` is an ``eth_call``), so a slim export fully substitutes. Loud if none.
    """
    override = os.getenv("SPARKPOINT_ARTIFACTS_DIR")
    if override:
        candidate = Path(override).joinpath(*rel_parts[1:])  # drop the leading "contracts"
        if candidate.is_file():
            return candidate
    for parent in Path(__file__).resolve().parents:
        candidate = parent.joinpath(*rel_parts)
        if candidate.is_file():
            return candidate
    contract_abi = rel_parts[-1].removesuffix(".json") + ".abi.json"
    # Vendored copy shipped inside the agent image (sibling `abi/` dir next to this module).
    vendored = Path(__file__).resolve().parent / "abi" / contract_abi
    if vendored.is_file():
        return vendored
    # Repo committed slim export (CI / local without a build).
    for parent in Path(__file__).resolve().parents:
        candidate = parent.joinpath("packages", "shared", "src", "abis", contract_abi)
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        f"artifact {'/'.join(rel_parts)} not found — run `forge build` in contracts/, set "
        f"SPARKPOINT_ARTIFACTS_DIR, or vendor packages/shared/src/abis/{contract_abi}."
    )


@lru_cache(maxsize=8)
def _load_registry(rel_parts: tuple[str, ...]) -> dict[str, AbiMethod]:
    """Parse an artifact into ``{name: AbiMethod}`` (selector + canonical in/out types).

    Includes state-changing functions on purpose: this surface PREPARES calldata (a string) the
    operator signs off-app. It still cannot send — the transport is ``eth_call``-only and keyless.
    """
    data = json.loads(_find_artifact(rel_parts).read_text())
    abi = data["abi"]
    method_ids: dict[str, str] = data.get("methodIdentifiers", {})
    registry: dict[str, AbiMethod] = {}
    for item in abi:
        if item.get("type") != "function":
            continue
        name = str(item["name"])
        input_types = tuple(_canonical_type(i) for i in item.get("inputs", ()))
        output_types = tuple(_canonical_type(o) for o in item.get("outputs", ()))
        signature = f"{name}({','.join(input_types)})"
        selector = method_ids.get(signature)
        if selector is None:
            continue
        registry[name] = AbiMethod(
            selector=f"0x{selector}",
            input_types=input_types,
            output_types=output_types,
        )
    return registry


def _encode_call(registry: Mapping[str, AbiMethod], name: str, args: Sequence[Any]) -> str:
    """selector + ABI-encoded args → a ``0x`` calldata STRING. Pure; sends nothing (N1)."""
    method = registry[name]
    encoded = eth_abi.encode(list(method.input_types), list(args))
    return method.selector + encoded.hex()


# ── The fixed, closed set of guardian actions (NO fund-moving verb — US4 invariant) ──
# Each maps to a governance/param call the guardian (== the OZ TimelockController) may schedule.
# There is DELIBERATELY no withdraw / sweep / migrate / transfer / rescue verb here or anywhere in
# this module: the wrapper exposes none, and a fabricated one is rejected before it reaches here.
GUARDIAN_ACTIONS: tuple[str, ...] = ("pause", "unpause", "setFee", "setFeeRecipient", "setCaps")

# CapRegistry immutable ceilings (contracts/src/governance/CapRegistry.sol): governance can NEVER
# set a cap above these — the CapRegistry reverts (`CapAboveCeiling`) — so a setCaps guardian action
# is refused up-front rather than handed back as calldata that cannot land. Base-unit (USDC 6-dp).
PER_USER_CEILING = 10_000 * 10**6  # CapRegistry.PER_USER_CEILING = 10_000e6
TOTAL_CEILING = 5_000_000 * 10**6  # CapRegistry.TOTAL_CEILING = 5_000_000e6
VAULT_CEILING = 5_000_000 * 10**6  # CapRegistry.VAULT_CEILING = 5_000_000e6 (== TOTAL_CEILING)


class GuardianActionError(ValueError):
    """A guardian-action request is malformed (unknown action / bad args). Never a custody error."""


# ── The read + calldata client ───────────────────────────────────────────────


class VaultFactoryChain:
    """Keyless reads over the factory + wrappers, plus pure prepare-calldata builders.

    ``factory_address`` may be ``None`` (factory not deployed on this chain) — reads that need it
    raise :class:`VaultUnavailable` (NOT_DEPLOYED); the pure calldata builders still work (they only
    encode). The transport issues ``eth_call`` only.
    """

    def __init__(self, *, factory_address: str | None, transport: JsonRpcTransport) -> None:
        self._factory = factory_address.lower() if factory_address else None
        self._transport = transport

    @property
    def factory_address(self) -> str | None:
        return self._factory

    # ── low-level eth_call ──
    async def _call(self, to: str, registry: Mapping[str, AbiMethod], name: str,
                    args: Sequence[Any]) -> Any:
        data = _encode_call(registry, name, args)
        params = [{"to": to.lower(), "data": data}, "latest"]
        result = await self._transport.call("eth_call", params)
        if result in ("0x", ""):
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED,
                f"{name}: empty eth_call result (no code at {to}?).",
            )
        method = registry[name]
        try:
            raw = bytes.fromhex(result[2:] if result.startswith("0x") else result)
            decoded = eth_abi.decode(list(method.output_types), raw)
        except Exception as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE,
                f"{name}: could not decode eth_call result.",
            ) from exc
        return decoded[0] if len(method.output_types) == 1 else decoded

    def _require_factory(self) -> str:
        if self._factory is None:
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED,
                "SPARKPOINT_VAULT_FACTORY_ADDRESS is unset — the factory is not deployed here.",
            )
        return self._factory

    # ── factory reads ──
    async def is_allowlisted(self, morpho_vault: str) -> bool:
        reg = _load_registry(_FACTORY_ARTIFACT)
        return bool(await self._call(self._require_factory(), reg, "isAllowlisted", [morpho_vault]))

    async def owner(self) -> str:
        reg = _load_registry(_FACTORY_ARTIFACT)
        return str(await self._call(self._require_factory(), reg, "owner", []))

    async def vaults(self) -> list[str]:
        reg = _load_registry(_FACTORY_ARTIFACT)
        raw = await self._call(self._require_factory(), reg, "vaults", [])
        return [str(v).lower() for v in raw]

    async def is_sparkpoint_vault(self, vault: str) -> bool:
        reg = _load_registry(_FACTORY_ARTIFACT)
        return bool(await self._call(self._require_factory(), reg, "isSparkPointVault", [vault]))

    async def predict_vault_address(
        self, morpho_vault: str, fee_bps: int, caps: tuple[int, int], label: str
    ) -> str:
        reg = _load_registry(_FACTORY_ARTIFACT)
        addr = await self._call(
            self._require_factory(), reg, "predictVaultAddress",
            [morpho_vault, fee_bps, caps, label],
        )
        return str(addr).lower()

    # ── per-wrapper reads (live single-instance state) ──
    async def wrapper_state(self, vault: str) -> dict[str, Any]:
        reg = _load_registry(_WRAPPER_ARTIFACT)

        async def read(name: str) -> Any:
            return await self._call(vault, reg, name, [])

        cap_registry = str(await read("capRegistry")).lower()
        caps = await self._cap_state(cap_registry)
        return {
            "vault": vault.lower(),
            "paused": bool(await read("paused")),
            "guardian": str(await read("guardian")).lower(),
            "performanceFeeBps": int(await read("performanceFeeBps")),
            "feeRecipient": str(await read("feeRecipient")).lower(),
            "morphoVault": str(await read("morphoVault")).lower(),
            "capRegistry": cap_registry,
            "depositCap": int(await read("depositCap")),
            "label": str(await read("label")),
            "caps": caps,
        }

    async def _cap_state(self, cap_registry: str) -> dict[str, int]:
        reg = _load_registry(_CAP_ARTIFACT)
        return {
            "perUserCap": int(await self._call(cap_registry, reg, "perUserCap", [])),
            "totalCap": int(await self._call(cap_registry, reg, "totalCap", [])),
            "vaultCap": int(await self._call(cap_registry, reg, "vaultCap", [])),
        }

    async def min_delay(self, timelock: str) -> int:
        reg = _load_registry(_TIMELOCK_ARTIFACT)
        return int(await self._call(timelock, reg, "getMinDelay", []))

    # ── pure calldata builders (no transport; return a hex string, sign nothing) ──
    def create_vault_calldata(
        self, morpho_vault: str, fee_bps: int, caps: tuple[int, int], label: str
    ) -> str:
        reg = _load_registry(_FACTORY_ARTIFACT)
        return _encode_call(reg, "createVault", [morpho_vault, fee_bps, caps, label])

    def allowlist_calldata(self, morpho_vault: str, allowed: bool) -> str:
        reg = _load_registry(_FACTORY_ARTIFACT)
        return _encode_call(reg, "allowlistMorphoVault", [morpho_vault, allowed])

    def guardian_inner_calls(
        self, vault: str, cap_registry: str, action: str, args: Mapping[str, Any]
    ) -> list[dict[str, str]]:
        """The inner (target, calldata) call(s) a guardian action schedules through the timelock.

        The action MUST be one of :data:`GUARDIAN_ACTIONS` — a fabricated fund-moving verb
        (withdraw/sweep/migrate/…) is not in the enum and never reaches an encoder here.
        """
        wrapper = _load_registry(_WRAPPER_ARTIFACT)
        caps = _load_registry(_CAP_ARTIFACT)
        if action == "pause":
            return [{"target": vault.lower(), "data": _encode_call(wrapper, "pauseDeposits", [])}]
        if action == "unpause":
            return [{"target": vault.lower(), "data": _encode_call(wrapper, "unpauseDeposits", [])}]
        if action == "setFee":
            fee = int(args["feeBps"])
            if not 0 <= fee <= 2000:
                raise GuardianActionError("feeBps must be within [0, 2000] (the 20% hard cap).")
            return [{"target": vault.lower(),
                     "data": _encode_call(wrapper, "setPerformanceFeeBps", [fee])}]
        if action == "setFeeRecipient":
            recipient = str(args["recipient"])
            return [{"target": vault.lower(),
                     "data": _encode_call(wrapper, "setFeeRecipient", [recipient])}]
        if action == "setCaps":
            per_user = int(args["perAddressCap"])
            total = int(args["totalCap"])
            # Refuse out-of-range caps BEFORE returning calldata (mirrors the setFee [0,2000] rule).
            # The CapRegistry reverts above its immutable ceilings, so calldata that cannot land
            # is never handed back. >= 0 is enforced too (a negative cap makes no sense).
            if not 0 <= per_user <= PER_USER_CEILING:
                raise GuardianActionError(
                    f"perAddressCap {per_user} out of range [0, {PER_USER_CEILING}] "
                    "(CapRegistry.PER_USER_CEILING)."
                )
            if not 0 <= total <= TOTAL_CEILING:
                raise GuardianActionError(
                    f"totalCap {total} out of range [0, {TOTAL_CEILING}] "
                    "(CapRegistry.TOTAL_CEILING)."
                )
            # vaultCap := totalCap is INTENTIONAL: it mirrors SparkPointVaultFactory._capParams,
            # which maps the 2-field Caps{perAddressCap,totalCap} onto CapRegistry's 3 caps by
            # setting vault = totalCap. The Caps model deliberately has NO separate vaultCap, so the
            # totalCap governs BOTH the aggregate and vault ceilings and vaultCap tracks totalCap.
            # (total <= TOTAL_CEILING == VAULT_CEILING, so the vaultCap write is in-range by build.)
            return [
                {"target": cap_registry.lower(),
                 "data": _encode_call(caps, "setPerUserCap", [per_user])},
                {"target": cap_registry.lower(),
                 "data": _encode_call(caps, "setTotalCap", [total])},
                {"target": cap_registry.lower(),
                 "data": _encode_call(caps, "setVaultCap", [total])},
            ]
        raise GuardianActionError(f"unknown guardian action {action!r}")

    def timelock_schedule_calldata(
        self, inner: list[dict[str, str]], *, delay: int, salt: bytes,
        predecessor: bytes = _ZERO_BYTES32,
    ) -> str:
        """schedule/scheduleBatch calldata for the timelock to queue the inner call(s)."""
        reg = _load_registry(_TIMELOCK_ARTIFACT)
        if len(inner) == 1:
            call = inner[0]
            return _encode_call(reg, "schedule", [
                call["target"], 0, _hexbytes(call["data"]), predecessor, salt, delay,
            ])
        targets = [c["target"] for c in inner]
        values = [0] * len(inner)
        payloads = [_hexbytes(c["data"]) for c in inner]
        return _encode_call(
            reg, "scheduleBatch", [targets, values, payloads, predecessor, salt, delay]
        )

    def timelock_execute_calldata(
        self, inner: list[dict[str, str]], *, salt: bytes, predecessor: bytes = _ZERO_BYTES32,
    ) -> str:
        """execute/executeBatch calldata for the timelock to run the queued call(s) post-delay."""
        reg = _load_registry(_TIMELOCK_ARTIFACT)
        if len(inner) == 1:
            call = inner[0]
            return _encode_call(reg, "execute", [
                call["target"], 0, _hexbytes(call["data"]), predecessor, salt,
            ])
        targets = [c["target"] for c in inner]
        values = [0] * len(inner)
        payloads = [_hexbytes(c["data"]) for c in inner]
        return _encode_call(reg, "executeBatch", [targets, values, payloads, predecessor, salt])


def _hexbytes(data: str) -> bytes:
    return bytes.fromhex(data[2:] if data.startswith("0x") else data)
