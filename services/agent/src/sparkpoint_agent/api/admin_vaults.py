"""Admin MANAGE half of ``/admin/vaults`` (feature 011) — READ + PREPARE-CALLDATA only.

Every mutating route here returns PREPARED CALLDATA the operator signs OFF-APP (from the
owner/timelock wallet) — it mirrors the read-only kill-switch page. The BFF holds NO key and has
NO fund path (N1): ``signed`` is always ``false`` and no response ever carries a signature. Reads
are keyless ``eth_call``s via :class:`VaultFactoryChain`.

The four surfaces (contracts/vault-factory-interfaces.md §4):
  * ``GET  /admin/vaults``                    — list ``sparkpoint_wrappers`` rows + live per-vault
                                                on-chain state (010 reader posture).
  * ``POST /admin/vaults/create``             — validate against the ON-CHAIN curated allowlist
                                                (``factory.isAllowlisted``) + refuse feeBps>2000;
                                                return prepared ``createVault`` calldata +
                                                ``predictVaultAddress``; insert a ``pending`` row.
  * ``POST /admin/vaults/allowlist``          — return prepared ``allowlistMorphoVault`` calldata;
                                                upsert the off-chain vetting record.
  * ``POST /admin/vaults/{vault}/guardian-action`` — return prepared OZ-Timelock ``schedule`` +
                                                ``execute`` calldata. The action enum contains NO
                                                fund-moving verb (US4 invariant): a fabricated
                                                ``withdraw``/``sweep``/``migrate`` is not in the
                                                fixed :data:`GUARDIAN_ACTIONS` enum, so Pydantic
                                                rejects it (422) — no move-funds action EXISTS.
  * ``GET  /admin/vaults/{vault}``            — live single-instance state.

Admin-gated exactly like the other admin routers (``require_admin`` → a non-admin gets 404).
NON-CUSTODY (N1/N2): access + provenance + calldata only; never a signable artifact, never on the
withdraw/exit path.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator

from ..chain import HttpxJsonRpcTransport, VaultUnavailable, VaultUnavailableReason
from ..chain.vault_factory import GUARDIAN_ACTIONS, GuardianActionError, VaultFactoryChain
from ..chain.vault_resolution import registry_enabled
from ..config import AgentConfig
from ..db import get_database
from ..db.vault_factory import VaultFactoryStore
from ..db.vault_registry import VaultRegistryStore
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .security import AccountContext

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-vaults"])

# Env var carrying the deployed SparkPointVaultFactory address (undefined until deploy — the
# create/allowlist calldata's `to` is then unknown and those routes fail closed with a clear
# message, never a fabricated target). Read directly (not via the keyless AgentConfig allowlist,
# which must stay confined to the read surface's fixed key set).
FACTORY_ADDRESS_ENV = "SPARKPOINT_VAULT_FACTORY_ADDRESS"

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# The fixed guardian-action enum, re-exported here for the request model. It is the SAME closed set
# as chain.vault_factory.GUARDIAN_ACTIONS and contains NO fund-moving verb.
GuardianAction = Literal["pause", "unpause", "setFee", "setFeeRecipient", "setCaps"]


def _factory_address() -> str | None:
    raw = os.getenv(FACTORY_ADDRESS_ENV)
    return raw.lower() if raw and _ADDRESS_RE.match(raw) else None


def _require_factory_address() -> str:
    addr = _factory_address()
    if addr is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            f"{FACTORY_ADDRESS_ENV} is unset — the factory is not deployed on this chain; "
            "refusing to prepare calldata against an unknown target (fail-closed).",
        )
    return addr


def _get_account(request: Request) -> AccountContext:
    account = getattr(request.state, "account", None)
    if not isinstance(account, AccountContext):  # pragma: no cover — middleware guarantees it
        raise ApiError(ErrorCode.ACCOUNT_HEADERS_INVALID, "Missing user-scoping account context.")
    return account


def get_vault_factory_store() -> VaultFactoryStore:
    """The asyncpg-backed provenance store (production). Overridden with a fake in tests."""
    return VaultFactoryStore(get_database())


def get_vault_registry_store() -> VaultRegistryStore:
    """The 024 registry store (migration 0026). Overridden with a fake in tests."""
    return VaultRegistryStore(get_database())


def get_factory_chain(request: Request) -> VaultFactoryChain | None:
    """Keyless factory read/calldata client SCOPED to the request's chain, or ``None`` when no RPC
    is configured (GET degrades to DB-only; chain-requiring routes fail closed). Test-overridden."""
    account = _get_account(request)
    try:
        config = AgentConfig.from_env().for_chain(account.chain_id)
    except Exception:
        return None
    if not config.rpc_url:
        return None
    return VaultFactoryChain(
        factory_address=_factory_address(),
        transport=HttpxJsonRpcTransport(config.rpc_url),
    )


def _require_chain(chain: VaultFactoryChain | None) -> VaultFactoryChain:
    if chain is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "No RPC configured for this chain — live vault reads are unavailable (fail-closed).",
        )
    return chain


async def _maybe_promote(
    store: VaultFactoryStore,
    chain: VaultFactoryChain | None,
    row: dict[str, Any],
    admin_chain_id: int,
) -> dict[str, Any]:
    """Promote a ``pending`` provenance row to ``live`` once the on-chain factory ATTESTS the
    wrapper (``factory.isSparkPointVault``). Acts only on a ``pending`` row on the CURRENT chain.

    Fail-SAFE: any RPC / undeployed-factory error leaves the row ``pending`` (we NEVER fabricate a
    promotion), and the store update is promote-only, so a ``live`` row is never demoted. Read-only
    from the caller's view — pure provenance, never a fund path (N1/N2)."""
    if (
        chain is None
        or row.get("status") != "pending"
        or row.get("chain_id") != admin_chain_id
    ):
        return row
    vault_address = str(row["vault_address"])
    try:
        attested = await chain.is_sparkpoint_vault(vault_address)
    except Exception:  # RPC down / factory undeployed / ABI issue → stay pending (never fabricate).
        return row
    if not attested:
        return row
    await store.mark_wrapper_live(vault_address, admin_chain_id)
    return {**row, "status": "live"}


# ── request models ───────────────────────────────────────────────────────────


class CapsModel(BaseModel):
    """Absolute base-unit caps (mirrors the factory's ``Caps`` struct; 0 == fully capped)."""

    perAddressCap: int = Field(ge=0)
    totalCap: int = Field(ge=0)


class CreateVaultBody(BaseModel):
    morphoVault: str
    feeBps: int = Field(ge=0)
    caps: CapsModel
    label: str = Field(min_length=1, max_length=200)
    chainId: int

    @field_validator("morphoVault")
    @classmethod
    def _addr(cls, v: str) -> str:
        if not _ADDRESS_RE.match(v.strip()):
            raise ValueError("morphoVault must be a 20-byte 0x address")
        return v.strip().lower()


class AllowlistBody(BaseModel):
    morphoVault: str
    allowed: bool
    vettingNotes: str | None = None
    curator: str | None = None
    label: str | None = None
    nativeFeeBps: int | None = Field(default=None, ge=0)
    oracleNotes: str | None = None
    gatesNotes: str | None = None
    timelockNotes: str | None = None

    @field_validator("morphoVault")
    @classmethod
    def _addr(cls, v: str) -> str:
        if not _ADDRESS_RE.match(v.strip()):
            raise ValueError("morphoVault must be a 20-byte 0x address")
        return v.strip().lower()


class GuardianActionBody(BaseModel):
    """``action`` is the CLOSED enum — an unknown / fund-moving verb is rejected by Pydantic (422).
    There is deliberately NO withdraw/sweep/migrate/transfer member: no move-funds action exists."""

    action: GuardianAction
    args: dict[str, Any] = Field(default_factory=dict)


# ── routes ───────────────────────────────────────────────────────────────────


@router.get("/admin/vaults")
async def list_vaults(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[VaultFactoryStore, Depends(get_vault_factory_store)],
    chain: Annotated[VaultFactoryChain | None, Depends(get_factory_chain)],
) -> dict[str, Any]:
    """List the ``sparkpoint_wrappers`` provenance rows + (when RPC is up) live per-instance state.

    Read-only. A per-vault chain read that fails closed (undeployed / RPC blip) attaches
    ``chainState: null`` for that row rather than failing the whole list (never a fabricated value).
    """
    rows = await store.list_wrappers()
    factory_addr = _factory_address()
    on_chain_registry: list[str] | None = None
    owner: str | None = None
    if chain is not None and factory_addr is not None:
        try:
            on_chain_registry = await chain.vaults()
            owner = await chain.owner()
        except Exception:  # RPC/ABI/decode hiccup — degrade to DB-only, never 500 the whole list.
            logger.warning("admin/vaults: factory read failed; degrading to DB-only", exc_info=True)
            on_chain_registry = None

    enriched: list[dict[str, Any]] = []
    for row in rows:
        # Promote a `pending` row on this chain to `live` once the factory attests it (fail-safe).
        row = await _maybe_promote(store, chain, row, admin.chain_id)
        state: dict[str, Any] | None = None
        if chain is not None and row.get("chain_id") == admin.chain_id:
            try:
                state = await chain.wrapper_state(str(row["vault_address"]))
            except Exception:  # fail closed → chainState: null (never a fabricated value).
                logger.warning(
                    "admin/vaults: wrapper_state read failed for %s",
                    row.get("vault_address"),
                    exc_info=True,
                )
                state = None
        enriched.append({**row, "chainState": state})

    return {
        "vaults": enriched,
        "factory": {
            "address": factory_addr,
            "owner": owner,
            "onChainRegistry": on_chain_registry,
        },
        "chainConfigured": chain is not None,
        # The invariant this page renders + enforces: no fund-moving admin verb exists.
        "guardianActions": list(GUARDIAN_ACTIONS),
        "noMoveFundsAction": True,
    }


@router.get("/admin/vault-registry")
async def list_vault_registry(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[VaultRegistryStore, Depends(get_vault_registry_store)],
) -> dict[str, Any]:
    """The 024 vault REGISTRY (migration 0026) — read-only/advisory, all chains.

    Deliberately NOT mounted at ``/admin/vaults/registry``: ``GET /admin/vaults/{vault}`` is a
    catch-all path param declared below, and FastAPI matches in registration order, so that path
    would be shadowed into a lookup for a vault literally named "registry". This is also a genuinely
    different resource — 0026's ``vault_registry`` (which vaults exist, on every chain) versus
    0016's ``sparkpoint_wrappers`` (branded-wrapper provenance on one chain).

    FAIL-OPEN, and that is the point. Migration 0026 may not be applied yet, so an unmigrated or
    unreachable database returns ``available: false`` with empty rows and an honest reason — never a
    500, and never invented rows. This endpoint is advisory only: nothing here authorizes a
    signature, and per IV.5(d) the registry must not reach the deterministic policy path.
    """
    registry_flag = registry_enabled()
    try:
        vaults = await store.list_vaults()
        allowlist = await store.list_allowlist(admin.chain_id)
        apy = await store.latest_apy(admin.chain_id)
    except Exception as exc:  # noqa: BLE001 - advisory surface; an unapplied 0026 is expected
        logger.warning("admin/vault-registry: read failed (is 0026 applied?)", exc_info=True)
        return {
            "available": False,
            "reason": f"{type(exc).__name__} — migration 0026 may not be applied on this database.",
            "resolutionEnabled": registry_flag,
            "vaults": [],
            "allowlist": [],
            "apySnapshots": [],
        }
    return {
        "available": True,
        # Whether the service is actually RESOLVING from these rows, or still using the env var.
        # Surfaced so the operator can see that rows exist but are not yet load-bearing.
        "resolutionEnabled": registry_flag,
        "vaults": vaults,
        "allowlist": allowlist,
        "apySnapshots": apy,
    }


@router.get("/admin/vaults/{vault}")
async def get_vault(
    vault: str,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[VaultFactoryStore, Depends(get_vault_factory_store)],
    chain: Annotated[VaultFactoryChain | None, Depends(get_factory_chain)],
) -> dict[str, Any]:
    """Live single-instance state (paused, guardian, fee, recipient, caps, morphoVault) + the
    off-chain ``nativeFeeBps`` provenance for the honest double-fee disclosure. Read-only."""
    if not _ADDRESS_RE.match(vault):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "vault must be a 20-byte 0x address")
    live = _require_chain(chain)
    state = await live.wrapper_state(vault)
    row = await store.get_wrapper(admin.chain_id, vault)
    if row is not None:
        # Promote a `pending` provenance row to `live` once the factory attests it (fail-safe).
        row = await _maybe_promote(store, live, row, admin.chain_id)
    state["nativeFeeBps"] = (row or {}).get("native_fee_bps")
    state["provenance"] = row
    return state


@router.post("/admin/vaults/create")
async def create_vault(
    body: CreateVaultBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[VaultFactoryStore, Depends(get_vault_factory_store)],
    chain: Annotated[VaultFactoryChain | None, Depends(get_factory_chain)],
) -> dict[str, Any]:
    """Validate + PREPARE ``createVault`` calldata (never signs). Refuses a non-allowlisted
    ``morphoVault`` and ``feeBps > 2000`` BEFORE returning any calldata."""
    # The on-chain reads (allowlist check, predict, createVault calldata) run against the X-Chain-Id
    # header chain, while the store ops (allowlist record, pending row) key off body.chainId. Reject
    # a mismatch up-front so validation, the calldata target, and the provenance row all reference
    # ONE chain (the body field is kept — only equality is enforced).
    if body.chainId != admin.chain_id:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"chainId {body.chainId} does not match the X-Chain-Id header ({admin.chain_id}); "
            "validation, calldata target, and the provenance row must reference one chain.",
        )
    if body.feeBps > 2000:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"feeBps {body.feeBps} exceeds the 2000 (20%) hard cap.",
        )
    live = _require_chain(chain)
    factory_addr = _require_factory_address()

    # Validate against the ON-CHAIN curated allowlist — the factory would revert otherwise, so we
    # refuse up-front rather than hand back calldata that cannot land.
    if not await live.is_allowlisted(body.morphoVault):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"{body.morphoVault} is not on the curated Morpho allowlist; allowlist it first.",
        )

    caps = (body.caps.perAddressCap, body.caps.totalCap)
    predicted = await live.predict_vault_address(body.morphoVault, body.feeBps, caps, body.label)
    calldata = live.create_vault_calldata(body.morphoVault, body.feeBps, caps, body.label)

    # Off-chain native fee for the double-fee disclosure, if the vetting record carries it.
    record = await store.get_allowlist_record(body.chainId, body.morphoVault)
    native_fee = (record or {}).get("native_fee_bps")

    # Insert a `pending` provenance row (promoted to `live` once the operator's signed tx confirms).
    await store.insert_pending_wrapper(
        vault_address=predicted,
        chain_id=body.chainId,
        label=body.label,
        morpho_vault=body.morphoVault,
        native_fee_bps=native_fee,
        factory_address=factory_addr,
    )

    return {
        "ok": True,
        "signed": False,  # this BFF holds no key — the operator signs off-app.
        "predictedAddress": predicted,
        "calldata": {"to": factory_addr, "data": calldata, "value": "0"},
        "feeBps": body.feeBps,
        "caps": {"perAddressCap": str(caps[0]), "totalCap": str(caps[1])},
        "label": body.label,
        "morphoVault": body.morphoVault,
        "nativeFeeBps": native_fee,
    }


@router.post("/admin/vaults/allowlist")
async def allowlist_vault(
    body: AllowlistBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[VaultFactoryStore, Depends(get_vault_factory_store)],
) -> dict[str, Any]:
    """PREPARE ``allowlistMorphoVault`` calldata (never signs) + upsert the off-chain vetting
    record. Encoding needs no RPC — only the factory address for the calldata's ``to``."""
    factory_addr = _require_factory_address()
    # Pure encoding — no transport, no key. A tiny stateless client suffices.
    encoder = VaultFactoryChain(factory_address=factory_addr, transport=_NULL_TRANSPORT)
    calldata = encoder.allowlist_calldata(body.morphoVault, body.allowed)

    await store.upsert_allowlist_record(
        morpho_vault=body.morphoVault,
        chain_id=admin.chain_id,
        allowed=body.allowed,
        curator=body.curator,
        label=body.label,
        native_fee_bps=body.nativeFeeBps,
        vetting_notes=body.vettingNotes,
        oracle_notes=body.oracleNotes,
        gates_notes=body.gatesNotes,
        timelock_notes=body.timelockNotes,
        author=admin.owner,
    )

    return {
        "ok": True,
        "signed": False,
        "calldata": {"to": factory_addr, "data": calldata, "value": "0"},
        "morphoVault": body.morphoVault,
        "allowed": body.allowed,
    }


@router.post("/admin/vaults/{vault}/guardian-action")
async def guardian_action(
    vault: str,
    body: GuardianActionBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    chain: Annotated[VaultFactoryChain | None, Depends(get_factory_chain)],
) -> dict[str, Any]:
    """PREPARE OZ-Timelock ``schedule`` + ``execute`` calldata for a guardian action (never signs).

    ``action`` is the CLOSED :data:`GUARDIAN_ACTIONS` enum — pause/unpause/setFee/setFeeRecipient/
    setCaps. There is NO fund-moving verb: a fabricated withdraw/sweep/migrate is not a member, so
    Pydantic 422s it before this body runs. Timelock-delayed; calldata only; no server key (US4)."""
    if not _ADDRESS_RE.match(vault):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "vault must be a 20-byte 0x address")
    live = _require_chain(chain)

    # The guardian IS the OZ TimelockController; the per-wrapper CapRegistry backs setCaps.
    state = await live.wrapper_state(vault)
    timelock = str(state["guardian"])
    cap_registry = str(state["capRegistry"])
    delay = await live.min_delay(timelock)

    try:
        inner = live.guardian_inner_calls(vault, cap_registry, body.action, body.args)
    except (GuardianActionError, KeyError, ValueError) as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"invalid guardian action args: {exc}") from exc

    salt = secrets.token_bytes(32)
    schedule = live.timelock_schedule_calldata(inner, delay=delay, salt=salt)
    execute = live.timelock_execute_calldata(inner, salt=salt)

    return {
        "ok": True,
        "signed": False,  # calldata only; the timelock (guardian) is signed off-app.
        "action": body.action,
        "vault": vault.lower(),
        "timelock": timelock,
        "delaySeconds": delay,
        "salt": "0x" + salt.hex(),
        "predecessor": "0x" + "00" * 32,
        "inner": inner,
        "schedule": {"to": timelock, "data": schedule, "value": "0"},
        "execute": {"to": timelock, "data": execute, "value": "0"},
        # Explicit, provable: none of the offered actions moves funds.
        "noMoveFundsAction": True,
    }


class _NullTransport:
    """A transport that refuses to talk to the chain — used where only PURE calldata encoding is
    needed (allowlist). Guarantees that path issues zero RPC and can never send."""

    async def call(self, method: str, params: Any) -> str:
        raise VaultUnavailable(
            VaultUnavailableReason.RPC_UNREACHABLE,
            "null transport: no RPC available (encode-only path).",
        )


_NULL_TRANSPORT = _NullTransport()
