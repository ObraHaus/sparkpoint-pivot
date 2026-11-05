"""The §3.5/§3.6 execution spine endpoints (feature 019 US2) — the single signing chokepoint.

Four routes that turn an AI-proposed vault action into a user-signed, simulated, policy-approved,
durably-recorded on-chain transaction:

  POST /build-tx              — materialize an unsigned IntentBundle (recipient forced; sig null)
  POST /simulate              — refresh a near-expiry bundle's simulation
  POST /submit-signed-tx      — relay a user-signed payload (byte-match) + record the execution
  GET  /submit-signed-tx/{id} — poll the on-chain status

Auth (S2S bearer) + user-scoping (X-Account/X-Owner/X-Chain-Id) + Idempotency-Key replay come from
the
global ``RequestContextMiddleware`` — no per-endpoint code. The chain-read deps + the dry-runner are
the
018 vault ones. Non-custody: the service signs nothing (N1/N3); the withdraw/exit path is never
gated
(N2); a fail-closed chain outage returns the §1.5 envelope via ``vault_unavailable_handler``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..chain import VaultReader, VaultUnavailable, VaultUnavailableReason
from ..config import AgentConfig
from ..db import ExecutionStore, IntentBundleStore, RecommendationStore, get_database
from ..execution import orchestrate
from ..execution.models import (
    BuildTxRequest,
    BuildTxResponse,
    SimulateRequest,
    SimulateResponse,
    SubmissionStatusResponse,
    SubmitSignedRequest,
    SubmitSignedResponse,
)
from .security import AccountContext
from .vault import (
    DryRunner,
    get_account,
    get_dry_runner,
    get_sim_config,
    get_vault_reader,
    require_evm_account,
    require_verified_chain,
)

router = APIRouter(
    tags=["execution"],
    dependencies=[Depends(require_verified_chain), Depends(require_evm_account)],
)


def get_bundle_store() -> IntentBundleStore:
    """The intent-bundle persistence store (overridable in tests)."""
    return IntentBundleStore(get_database())


def get_exec_store() -> ExecutionStore:
    """The executions persistence store (overridable in tests)."""
    return ExecutionStore(get_database())


def get_rec_store() -> RecommendationStore:
    """The recommendations store (US5 — links an acted rec to its bundle; overridable in tests)."""
    return RecommendationStore(get_database())


def _rpc_url(config: AgentConfig) -> str:
    """The chain's RPC url, or fail CLOSED (UPSTREAM_UNAVAILABLE) — never a fabricated status."""
    if config.rpc_url is None:
        raise VaultUnavailable(
            VaultUnavailableReason.RPC_UNREACHABLE, "no RPC configured for this chain"
        )
    return config.rpc_url


@router.post("/build-tx", response_model=BuildTxResponse)
async def build_transaction(
    body: BuildTxRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    dry_run: Annotated[DryRunner, Depends(get_dry_runner)],
    bundle_store: Annotated[IntentBundleStore, Depends(get_bundle_store)],
    rec_store: Annotated[RecommendationStore, Depends(get_rec_store)],
) -> BuildTxResponse:
    """Materialize an unsigned IntentBundle for a proposed vault action (§3.5), fail-closed.

    Proves the vault is deployed (``asset()`` → VaultUnavailable/NOT_DEPLOYED fails closed) BEFORE
    building any calldata, then runs decode → build → simulate → assemble → pure evaluate → gate →
    persist. On any policy failure it returns the §1.5 envelope with reasons and NO bundle. When the
    action carries a recommendationId, the resolved rec is linked to the bundle (US5/FR-039).
    """
    chain_config = config.for_chain(account.chain_id)
    usdc = await reader.asset()
    # 024/T032 — take the vault from the READER, which already resolved it once for this request
    # (registry when enabled, else SPARKPOINT_VAULT_ADDRESS). Re-reading the config here would be a
    # SECOND resolution: with the registry live, the two could disagree across an operator's
    # edit and we would price a quote against one vault while emitting calldata for another.
    # Still fails closed identically when nothing is deployed on this chain.
    vault = reader.vault_address
    if vault is None:
        # Raises the canonical NOT_DEPLOYED ConfigError.
        vault = chain_config.require_vault_address()
    bundle = await orchestrate.build_tx(
        body,
        account=account,
        reader=reader,
        vault=vault,
        usdc=usdc,
        rpc_url=_rpc_url(chain_config),
        dry_run=dry_run,
        bundle_store=bundle_store,
        rec_store=rec_store,
    )
    return BuildTxResponse(intentBundle=bundle)


@router.post("/simulate", response_model=SimulateResponse)
async def simulate_bundle(
    body: SimulateRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    dry_run: Annotated[DryRunner, Depends(get_dry_runner)],
    bundle_store: Annotated[IntentBundleStore, Depends(get_bundle_store)],
) -> SimulateResponse:
    """Refresh the simulation for a stored bundle whose expiry is near (§3.5)."""
    chain_config = config.for_chain(account.chain_id)
    sim = await orchestrate.re_simulate(
        body, rpc_url=_rpc_url(chain_config), dry_run=dry_run, bundle_store=bundle_store
    )
    return SimulateResponse(simulation=sim)


@router.post("/submit-signed-tx", response_model=SubmitSignedResponse, status_code=202)
async def submit_signed_tx(
    body: SubmitSignedRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    bundle_store: Annotated[IntentBundleStore, Depends(get_bundle_store)],
    exec_store: Annotated[ExecutionStore, Depends(get_exec_store)],
) -> SubmitSignedResponse:
    """Relay a USER-signed payload (§3.6): byte-match vs the issued bundle + record the execution.

    The service never signs or alters the payload; it forwards + correlates only. Never returns
    KILL_SWITCH_PAUSED for a withdraw payload (N2).
    """
    chain_config = config.for_chain(account.chain_id)
    submission = await orchestrate.submit_signed(
        body, rpc_url=_rpc_url(chain_config), bundle_store=bundle_store, exec_store=exec_store
    )
    return SubmitSignedResponse(submission=submission)


@router.get("/submit-signed-tx/{intent_id}", response_model=SubmissionStatusResponse)
async def submission_status(
    intent_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    exec_store: Annotated[ExecutionStore, Depends(get_exec_store)],
) -> SubmissionStatusResponse:
    """Poll the on-chain receipt for a submitted intent (§3.6)."""
    chain_config = config.for_chain(account.chain_id)
    return await orchestrate.submission_status(
        intent_id, rpc_url=_rpc_url(chain_config), exec_store=exec_store
    )
