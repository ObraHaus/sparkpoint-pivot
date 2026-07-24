"""The ordered, fail-closed execution orchestration (feature 019 US2).

``build_tx`` runs the §3.5 pipeline: decode (recipient pinned) → build unsigned calldata → simulate
(advisory on exit) → assemble fresh context → PURE ``policy.evaluate`` → gate → persist → serialize.
On any policy failure it returns an error envelope with reasons and NO bundle (VR-X3).
``re_simulate``
refreshes a stored bundle; ``submit_signed`` byte-matches + records a submitted execution;
``submission_status`` resolves the on-chain receipt.

Non-custody: recipient forced to the user (N1); ``signature`` always null (N3); the withdraw/exit
path
is NEVER gated by sim/quote/pause/fee and builds even with no sim (N2). The agent signs nothing.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

from ..api.errors import ApiError, ErrorCode, ErrorReason
from ..api.security import AccountContext
from ..db import (
    BundleInsert,
    ExecutionStore,
    IntentBundleStore,
    RecInsert,
    RecommendationStore,
    SimulationInsert,
)
from ..policy import (
    POLICY_VERSION,
    Action,
    ActionType,
    Direction,
    PolicyVerdict,
    ReasonCode,
    evaluate,
)
from ..policy.constants import ACTION_DIRECTION
from ..sim import SimulationRequest, SimulationResult
from . import rpc
from .assemble import assemble_context
from .builder import build_steps
from .decode import DecodeError, decode_action
from .models import (
    BuildTxRequest,
    IntentBundle,
    IntentStep,
    SimulateRequest,
    Submission,
    SubmissionStatusResponse,
    SubmitSignedRequest,
)
from .serialize import (
    proposed_action_wire,
    reason_message,
    to_guardrail_checklist,
    to_wire_verdict,
)

#: The pre-sign dry-run runner (request, rpc_url) → SimulationResult (viem_eth_call by default).
DryRunner = Callable[[SimulationRequest, str], Awaitable[SimulationResult]]

#: Short bundle TTL — a stale bundle must be re-simulated / rebuilt before signing (VR-S2).
_BUNDLE_TTL_SECONDS = 180


class ExecReads(Protocol):
    """The subset of ``chain.VaultReader`` the orchestrator needs (fakeable in tests)."""

    async def asset(self) -> str: ...
    async def token_allowance(self, token: str, owner: str, spender: str) -> int: ...
    async def preview_deposit(self, assets: int) -> int: ...
    async def preview_redeem(self, shares: int) -> int: ...
    async def paused(self) -> bool: ...
    async def total_assets(self) -> int: ...
    async def balance_of(self, account: str) -> int: ...
    async def convert_to_assets(self, shares: int) -> int: ...


# ReasonCode → the §1.6 wire ErrorCode for a policy/decode rejection.
_REASON_TO_ERROR: dict[ReasonCode, ErrorCode] = {
    ReasonCode.SCHEMA_INVALID: ErrorCode.VALIDATION_ERROR,
    ReasonCode.PROTOCOL_NOT_ALLOWLISTED: ErrorCode.POLICY_REJECTED,
    ReasonCode.SELECTOR_NOT_ALLOWLISTED: ErrorCode.POLICY_REJECTED,
    ReasonCode.ASSET_NOT_ALLOWLISTED: ErrorCode.POLICY_REJECTED,
    ReasonCode.RECIPIENT_NOT_USER: ErrorCode.POLICY_REJECTED,
    ReasonCode.CAP_PER_USER_EXCEEDED: ErrorCode.CAP_EXCEEDED,
    ReasonCode.CAP_TOTAL_EXCEEDED: ErrorCode.CAP_EXCEEDED,
    ReasonCode.CAP_VAULT_EXCEEDED: ErrorCode.CAP_EXCEEDED,
    ReasonCode.CAP_PER_TX_EXCEEDED: ErrorCode.CAP_EXCEEDED,
    ReasonCode.CAP_CUMULATIVE_EXCEEDED: ErrorCode.CAP_EXCEEDED,
    ReasonCode.MANDATE_RISK_EXCEEDED: ErrorCode.POLICY_REJECTED,
    ReasonCode.SLIPPAGE_EXCEEDED: ErrorCode.SLIPPAGE_EXCEEDED,
    ReasonCode.MIN_OUT_BELOW_FLOOR: ErrorCode.SLIPPAGE_EXCEEDED,
    ReasonCode.SIM_REVERT: ErrorCode.SIMULATION_REVERT,
    ReasonCode.SIM_UNAVAILABLE: ErrorCode.SIMULATION_UNAVAILABLE,
    ReasonCode.DATA_STALE: ErrorCode.DATA_STALE,
    ReasonCode.KILL_SWITCH_PAUSED: ErrorCode.KILL_SWITCH_PAUSED,
    ReasonCode.SESSION_EXPIRED: ErrorCode.POLICY_REJECTED,
    ReasonCode.SESSION_REVOKED: ErrorCode.POLICY_REJECTED,
}


def _reason_to_error(code: ReasonCode) -> ErrorCode:
    return _REASON_TO_ERROR.get(code, ErrorCode.POLICY_REJECTED)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _action_kind(atype: ActionType) -> str:
    return "deposit" if atype is ActionType.VAULT_DEPOSIT else "withdraw"


def _rationale(atype: ActionType) -> str:
    if atype is ActionType.VAULT_DEPOSIT:
        return (
            "Supplying USDC into the SparkPoint Aave Yield Vault earns Aave v3 supply yield. "
            "You hold your vault shares and can withdraw anytime — SparkPoint never takes custody."
        )
    return (
        "Redeeming your vault shares returns USDC to your own wallet. Withdrawals are never "
        "gated by caps, the kill-switch, or fees (N2), and you can also exit directly on-chain."
    )


# Human-friendly titles for a MINIMAL rec reconstructed from an acted-on action (US5) — clean, not
# the raw enum. A rich advice snapshot (persist-at-surface, a US5 follow-up) would supersede this.
_ACTED_TITLES: dict[ActionType, str] = {
    ActionType.VAULT_DEPOSIT: "Deposit into the SparkPoint vault",
    ActionType.VAULT_WITHDRAW: "Withdraw from the SparkPoint vault",
    ActionType.VAULT_REDEEM: "Redeem SparkPoint vault shares",
}


def _acted_title(atype: ActionType) -> str:
    return _ACTED_TITLES.get(atype, atype.value.replace("_", " ").capitalize())


def _reasons_json(verdict: PolicyVerdict) -> list[dict[str, Any]]:
    return [{"code": r.value, "message": reason_message(r)} for r in verdict.reasons]


def _bundle_insert(
    account: AccountContext,
    action: Action,
    steps: tuple[IntentStep, ...],
    verdict_status: str,
    verdict: PolicyVerdict,
    expires: datetime,
    recommendation_id: UUID | None = None,
) -> BundleInsert:
    return BundleInsert(
        smart_account_address=account.account,
        chain_id=account.chain_id,
        kind=action.action_type.value,
        steps=[s.model_dump() for s in steps],
        policy_verdict=verdict_status,
        policy_version=verdict.policy_version,
        policy_reasons=_reasons_json(verdict),
        expires_at=expires,
        # US5 (feature 020): the resolved persisted recommendation UUID (was always None) — the
        # FR-039 link. None when the action carried no rec or the rec store is unavailable.
        recommendation_id=recommendation_id,
    )


async def _resolve_rec(
    rec_store: RecommendationStore | None,
    account: AccountContext,
    req: BuildTxRequest,
    action: Action,
    usdc: str,
) -> UUID | None:
    """Resolve the wire recommendationId to a persisted rec UUID (US5 FR-002/FR-003).

    If it is a known persisted rec → use it. Otherwise (a chat ephemeral id / legacy tag / absent
    when the user still acted via a rec) → upsert a MINIMAL rec from the action so the acted-on
    advice is still logged + linked (SC-010). Returns None only with no rec store (fail-open).
    """
    if rec_store is None:
        return None
    wire_id = req.action.recommendationId
    if wire_id:
        try:
            existing = await rec_store.get(UUID(wire_id))
        except ValueError:
            existing = None
        if existing is not None and existing.wallet.lower() == account.account.lower():
            return existing.id
        # a wire id was supplied but does not resolve → fall through to a minimal snapshot
    else:
        # no recommendationId ⇒ a user-initiated action, not acting on advice → unattributed.
        return None
    snapshot = proposed_action_wire(
        action_type=action.action_type.value,
        asset=usdc,
        decimals=action.decimals,
        amount=action.amount,
        recommendation_id=None,
    )
    return await rec_store.upsert(
        RecInsert(
            wallet=account.account,
            strategy_kind=action.action_type.value,
            title=_acted_title(action.action_type),
            proposed_action=snapshot,
            policy_version=POLICY_VERSION,
            rationale=_rationale(action.action_type),
        )
    )


def _expected_out(sim: SimulationResult) -> int | None:
    raw = sim.sharesOut or sim.assetsOut or sim.outAmount
    return int(raw) if raw is not None else None


async def _run_sim(
    *,
    step: IntentStep,
    action: Action,
    sender: str,
    chain_id: int,
    rpc_url: str,
    dry_run: DryRunner,
    is_exit: bool,
) -> SimulationResult | None:
    """Dry-run the unsigned step. On an EXIT a simulator outage returns None — never blocks (N2)."""
    sim_req = SimulationRequest(
        chain_id=chain_id,
        sender=sender,
        to=step.to,
        data=step.data,
        value=0,
        op_type="eoa_call",
        action=action.action_type,
    )
    try:
        return await dry_run(sim_req, rpc_url)
    except ApiError:
        if is_exit:
            return None
        raise


async def _enrich_out(
    sim: SimulationResult | None, *, action: Action, reader: ExecReads
) -> SimulationResult | None:
    """Attach the ERC-4626 preview output (a real on-chain read) for the drawer's expected out."""
    if sim is None:
        return None
    if action.action_type is ActionType.VAULT_DEPOSIT:
        return sim.model_copy(
            update={"sharesOut": str(await reader.preview_deposit(action.amount))}
        )
    if action.action_type is ActionType.VAULT_REDEEM:
        return sim.model_copy(update={"assetsOut": str(await reader.preview_redeem(action.amount))})
    if action.action_type is ActionType.VAULT_WITHDRAW:
        return sim.model_copy(update={"assetsOut": str(action.amount)})
    return sim


async def build_tx(
    req: BuildTxRequest,
    *,
    account: AccountContext,
    reader: ExecReads,
    vault: str,
    usdc: str,
    rpc_url: str,
    dry_run: DryRunner,
    bundle_store: IntentBundleStore,
    rec_store: RecommendationStore | None = None,
) -> IntentBundle:
    """Materialize an unsigned ``IntentBundle`` for a proposed vault action (§3.5), fail-closed."""
    if req.execMode != "per_action":
        # US6: the ERC-4337 session-key stack is deployed + proven live on Base Sepolia
        # (a mode-0x01 UserOp passed the Alchemy bundler's ERC-7562 tracer + executed on-chain) and
        # the bundler client (execution/bundler.py) is ready. The remaining increment is the
        # automated-move userOp builder + a CLIENT session-signer (the service never holds the key,
        # N3); until that lands the spine refuses a session-key move here honestly, never faked.
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Session-key automated moves are not wired into the spine yet (grant/revoke is live).",
            reasons=[ErrorReason("VALIDATION_ERROR", "execMode must be per_action")],
        )

    # 1. Decode (recipient PINNED to the connected user, N1).
    try:
        action = decode_action(
            req.action, account=account.account, chain_id=account.chain_id, vault=vault, usdc=usdc
        )
    except DecodeError as exc:
        raise ApiError(
            _reason_to_error(exc.code),
            exc.message,
            reasons=[ErrorReason(exc.code.value, exc.message)],
        ) from exc

    steps = build_steps(action, chain_id=account.chain_id)
    is_exit = ACTION_DIRECTION[action.action_type] is Direction.EXIT

    # 1b. US5 (feature 020): resolve the acted-on recommendation → its persisted UUID (the FR-039
    # link). None when the action carried no recommendation (a user-initiated action, unattributed).
    rec_id = await _resolve_rec(rec_store, account, req, action, usdc)
    rec_id_str = str(rec_id) if rec_id is not None else req.action.recommendationId

    # 2. Deposit needs sufficient allowance (else the dry-run reverts on transferFrom — approve
    # first).
    if action.action_type is ActionType.VAULT_DEPOSIT:
        allowance = await reader.token_allowance(usdc, account.account, vault)
        if allowance < action.amount:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "Approve USDC to the vault before building this deposit.",
                reasons=[
                    ErrorReason(
                        "APPROVAL_REQUIRED", "USDC allowance to the vault is below the amount"
                    )
                ],
            )

    # 3. Simulate (advisory on exit) + enrich the expected output.
    sim = await _run_sim(
        step=steps[0],
        action=action,
        sender=account.account,
        chain_id=account.chain_id,
        rpc_url=rpc_url,
        dry_run=dry_run,
        is_exit=is_exit,
    )
    sim = await _enrich_out(sim, action=action, reader=reader)

    # 4. Assemble fresh context + PURE evaluate.
    ctx = await assemble_context(
        action,
        reader=reader,
        chain_id=account.chain_id,
        account=account.account,
        owner=account.owner,
        vault=vault,
        sim=sim,
    )
    verdict = evaluate(action, ctx)

    normalized = proposed_action_wire(
        action_type=action.action_type.value,
        asset=usdc,
        decimals=action.decimals,
        amount=action.amount,
        recommendation_id=rec_id_str,
    )
    now = datetime.now(UTC)
    expires = now + timedelta(seconds=_BUNDLE_TTL_SECONDS)

    # 5. Gate — a rejected verdict persists a bundle row (audit) and returns reasons + NO bundle.
    if not verdict.is_signable:
        await bundle_store.persist_bundle(
            _bundle_insert(account, action, steps, "rejected", verdict, expires, rec_id)
        )
        if rec_store is not None and rec_id is not None:
            await rec_store.mark_status(rec_id, "rejected")
        code = verdict.reasons[0]
        raise ApiError(
            _reason_to_error(code),
            reason_message(code),
            reasons=[ErrorReason(r.value, reason_message(r)) for r in verdict.reasons],
            simulation=(
                sim.model_dump(mode="json")
                if (code is ReasonCode.SIM_REVERT and sim is not None)
                else None
            ),
        )

    # 6. Approved — persist sim + bundle (VR-X2), or the bundle alone for an approved exit with no
    # sim (N2).
    bundle_row = _bundle_insert(account, action, steps, "approved", verdict, expires, rec_id)
    if rec_store is not None and rec_id is not None:
        await rec_store.mark_status(rec_id, "acted")
    if sim is None:
        intent_id = await bundle_store.persist_bundle(bundle_row)
    else:
        intent_id = await bundle_store.persist_approved(
            bundle_row,
            SimulationInsert(
                simulator=sim.provider,
                sim_block=sim.asOfBlock,
                will_revert=sim.willRevert,
                passed=not sim.willRevert,
                revert_reason=sim.revertReason,
                expected_out_raw=_expected_out(sim),
                balance_deltas=[d.model_dump() for d in sim.balanceDeltas],
            ),
        )

    return IntentBundle(
        id=str(intent_id),
        userId=account.account,
        kind=action.action_type.value,
        steps=list(steps),
        userOp=None,
        simulation=sim,
        policyVerdict=to_wire_verdict(verdict, normalized_action=normalized, simulation=sim),
        guardrailChecklist=to_guardrail_checklist(verdict),
        rationale=_rationale(action.action_type),
        citations=[],
        recommendationId=rec_id_str,
        policyVersion=verdict.policy_version,
        expiresAt=_iso(expires),
    )


async def re_simulate(
    req: SimulateRequest,
    *,
    rpc_url: str,
    dry_run: DryRunner,
    bundle_store: IntentBundleStore,
) -> SimulationResult | None:
    """Refresh the simulation for a stored bundle (§3.5). Steps-only preview is deferred."""
    if req.intentId is None:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "intentId is required to refresh a bundle.",
            reasons=[ErrorReason("VALIDATION_ERROR", "steps-only preview is not available yet")],
        )
    bundle = await _load_bundle(req.intentId, bundle_store)
    step0 = bundle.steps[0]
    kind = ActionType(bundle.kind)
    is_exit = ACTION_DIRECTION[kind] is Direction.EXIT
    sim_req = SimulationRequest(
        chain_id=bundle.chain_id,
        sender=bundle.smart_account_address,
        to=str(step0.get("to", "")),
        data=str(step0.get("data", "0x")),
        value=0,
        op_type="eoa_call",
        action=kind,
    )
    try:
        return await dry_run(sim_req, rpc_url)
    except ApiError:
        if is_exit:
            return None
        raise


# The relayed tx should be retrievable — the drawer relays only AFTER the wallet confirms the
# receipt. A few short retries absorb RPC propagation lag before we call it not-visible (retryable).
_TX_LOOKUP_ATTEMPTS = 4
_TX_LOOKUP_DELAY_S = 0.75


async def _await_relayed_tx(rpc_url: str, tx_hash: str) -> dict[str, Any] | None:
    """Fetch the relayed tx, briefly retrying to absorb RPC propagation lag.

    Returns the tx object, or None if it never appears within the budget. An RPC read failure
    propagates (the caller maps it to a retryable UPSTREAM_UNAVAILABLE) rather than being mistaken
    for a missing tx.
    """
    for attempt in range(_TX_LOOKUP_ATTEMPTS):
        tx = await rpc.get_transaction(rpc_url, tx_hash)
        if tx is not None:
            return tx
        if attempt < _TX_LOOKUP_ATTEMPTS - 1:
            await asyncio.sleep(_TX_LOOKUP_DELAY_S)
    return None


async def submit_signed(
    req: SubmitSignedRequest,
    *,
    rpc_url: str,
    bundle_store: IntentBundleStore,
    exec_store: ExecutionStore,
) -> Submission:
    """Relay a user-signed payload (§3.6): VERIFY vs on-chain truth, then record a submitted row.

    The service NEVER signs or alters the payload. For the eoa_call direct-submit path a broadcast
    ``txHash`` is the signature event (VR-X1). We record an execution ONLY for a txHash we can
    retrieve on-chain AND whose ``to``/``input`` byte-match the issued step (SC-005) — never for an
    unverifiable hash, which would let a bogus/mismatched tx create a phantom execution and
    mis-attribute a US5 outcome. N2: rejecting this correlation relay never gates the user's funds
    (the tx is on-chain regardless); a not-yet-visible tx is a retryable degrade to re-relay.
    """
    bundle = await _load_bundle(req.intentId, bundle_store)
    signed = req.signed
    step0 = bundle.steps[0]

    if signed.opType == "userop":
        # US6 path: submission via the bundler (execution/bundler.py — proven live on Base Sepolia)
        # will land here once build_tx emits a session-key userOp bundle + a client session-signer
        # exists. Today's bundles are all eoa_call (no userOp to match), so a userOp submission is
        # refused honestly rather than mis-recorded against an eoa bundle.
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Session-key userOp submission is not wired into the spine yet (grant/revoke is live).",
            reasons=[ErrorReason("VALIDATION_ERROR", "bundle is an eoa_call bundle")],
        )

    tx_hash = signed.txHash
    if not tx_hash:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "A broadcast txHash is required to correlate the signed transaction.",
            reasons=[ErrorReason("VALIDATION_ERROR", "no signature event (txHash) supplied")],
        )

    # Verify the relayed tx EXISTS on-chain and byte-matches the issued bundle BEFORE recording it.
    try:
        tx = await _await_relayed_tx(rpc_url, tx_hash)
    except Exception as exc:  # RPC unreachable — transient/retryable, nothing stored
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Couldn't reach the chain to verify the transaction — nothing recorded; retry shortly.",
            reasons=[ErrorReason("UPSTREAM_UNAVAILABLE", "tx verification RPC unreachable")],
        ) from exc
    if tx is None:
        raise ApiError(
            ErrorCode.DATA_STALE,
            "That transaction isn't visible on-chain yet — it may be propagating. Retry soon.",
            reasons=[ErrorReason("DATA_STALE", "relayed txHash not retrievable on-chain")],
        )
    _assert_byte_match(tx, step0)

    await exec_store.insert_submitted(
        intent_bundle_id=UUID(bundle.id_str),
        smart_account_address=bundle.smart_account_address,
        action_kind=_action_kind(ActionType(bundle.kind)),
        tx_hash=tx_hash,
    )
    return Submission(
        intentId=req.intentId, status="pending", userOpHash=None, txHash=tx_hash, bundler=None
    )


async def submission_status(
    intent_id: str,
    *,
    rpc_url: str,
    exec_store: ExecutionStore,
) -> SubmissionStatusResponse:
    """Resolve the on-chain receipt for a submitted intent (§3.6)."""
    try:
        intent_uuid = UUID(intent_id)
    except ValueError as exc:
        raise ApiError(ErrorCode.NOT_FOUND, "Unknown intent.") from exc
    execu = await exec_store.get_by_intent(intent_uuid)
    if execu is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No submission recorded for this intent.")
    tx_hash = execu.tx_hash
    if not tx_hash:
        return SubmissionStatusResponse(
            status="pending", txHash=None, blockNumber=None, receipt=None
        )

    receipt = await rpc.get_receipt(rpc_url, tx_hash)
    if receipt is None:
        return SubmissionStatusResponse(
            status="pending", txHash=tx_hash, blockNumber=None, receipt=None
        )

    status_hex = receipt.get("status")
    block_hex = receipt.get("blockNumber")
    block = int(block_hex, 16) if isinstance(block_hex, str) else None
    confirmed = status_hex == "0x1"
    await exec_store.update_status(
        intent_bundle_id=intent_uuid,
        status="confirmed" if confirmed else "reverted",
        tx_hash=tx_hash,
        block_number=block,
        reverted_reason=None if confirmed else "reverted on-chain",
    )
    lite = {"status": status_hex, "blockNumber": block_hex, "gasUsed": receipt.get("gasUsed")}
    return SubmissionStatusResponse(
        status="confirmed" if confirmed else "failed",
        txHash=tx_hash,
        blockNumber=block,
        receipt=lite,
    )


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────


class _BundleWithId:
    """A loaded bundle row with its id as a string (avoids leaking the UUID type outward)."""

    def __init__(self, row: Any) -> None:
        self.id_str = str(row.id)
        self.chain_id = row.chain_id
        self.kind = row.kind
        self.steps = row.steps
        self.smart_account_address = row.smart_account_address


async def _load_bundle(intent_id: str, bundle_store: IntentBundleStore) -> _BundleWithId:
    try:
        intent_uuid = UUID(intent_id)
    except ValueError as exc:
        raise ApiError(ErrorCode.NOT_FOUND, "Unknown intent.") from exc
    row = await bundle_store.get(intent_uuid)
    if row is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Unknown intent.")
    return _BundleWithId(row)


def _assert_byte_match(tx: dict[str, Any], step: dict[str, Any]) -> None:
    """Assert a fetched tx's ``to``/``input`` byte-match the issued step (else VALIDATION_ERROR)."""
    tx_to = str(tx.get("to") or "").lower()
    tx_input = str(tx.get("input") or "").lower()
    want_to = str(step.get("to", "")).lower()
    want_data = str(step.get("data", "")).lower()
    if tx_to != want_to or tx_input != want_data:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "The signed transaction does not match the issued bundle (byte-match failed).",
            reasons=[ErrorReason("VALIDATION_ERROR", "signed to/data != issued step")],
        )
