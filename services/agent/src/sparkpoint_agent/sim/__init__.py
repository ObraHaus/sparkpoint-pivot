"""sim/ — the pre-trade Simulator seam (research.md §8, SC-002).

A MANDATORY, fail-closed preview between a policy-approved candidate tx and any
signature request. The service NEVER signs; the Simulator only reads/traces
(N1/N3). The Simulator is NEVER on the withdrawal path (N2): if it is down, the
bundle is simply not built, and the user's on-chain withdraw is unaffected.
"""

from __future__ import annotations

from .simulator import (
    NATIVE_TOKEN_SENTINEL,
    AnvilForkSimulator,
    BalanceDelta,
    BundlerGasEstimator,
    CapHeadroom,
    GasEstimate,
    JsonRpcError,
    PackedUserOp,
    SimulationProvider,
    SimulationRequest,
    SimulationResult,
    Simulator,
    SimulatorUnavailableError,
    TrackedAsset,
    ViemEthCallChecker,
    anvil_fork_from_env,
)

__all__ = [
    "NATIVE_TOKEN_SENTINEL",
    "AnvilForkSimulator",
    "BalanceDelta",
    "BundlerGasEstimator",
    "CapHeadroom",
    "GasEstimate",
    "JsonRpcError",
    "PackedUserOp",
    "Simulator",
    "SimulatorUnavailableError",
    "SimulationProvider",
    "SimulationRequest",
    "SimulationResult",
    "TrackedAsset",
    "ViemEthCallChecker",
    "anvil_fork_from_env",
]
