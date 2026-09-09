"""SparkPoint deterministic policy layer — the fail-closed, LLM-free safety spine.

PURE by construction (policy-schema.md §0 rule 6): this package imports NO llm/,
knowledge/, or memory/ module and performs NO network I/O at decision time. Its
sole inputs are the ``Action``, a ``PolicyContext`` of fresh chain reads + a fresh
simulation, and the mirrored ``constants`` (which themselves MIRROR
packages/shared/src/policy/*). ``evaluate()`` implements the ordered §8 step
machine; a rejected action yields NO signable artifact. The audit hook is a
side-channel (``audit.py``) so ``evaluate()`` stays pure.
"""

from __future__ import annotations

from .audit import (
    AuditRecord,
    AuditSink,
    InMemoryAuditSink,
    NullAuditSink,
    build_audit_record,
    evaluate_and_audit,
    record_verdict,
)
from .constants import (
    CAPS,
    GOVERNANCE,
    POLICY_VERSION,
    SESSION_BOUNDS,
    SLIPPAGE,
    SUPPORTED_CHAIN_IDS,
    AllowlistEntry,
    PolicyConstants,
    get_addresses,
    get_policy_constants,
    resolve_target_ref,
)
from .enums import (
    ActionType,
    Asset,
    Direction,
    Protocol,
    ReasonCode,
    RiskProfile,
)
from .evaluate import evaluate
from .models import (
    Action,
    CapHeadroom,
    CheckResult,
    MandateContext,
    PolicyContext,
    PolicyVerdict,
    SessionState,
    SimulationInput,
)
from .session import (
    SessionGrantVerdict,
    SessionScope,
    SessionScopePair,
    evaluate_session_grant,
)

__all__ = [
    "CAPS",
    "GOVERNANCE",
    "POLICY_VERSION",
    "SESSION_BOUNDS",
    "SLIPPAGE",
    "SUPPORTED_CHAIN_IDS",
    "Action",
    "ActionType",
    "AllowlistEntry",
    "Asset",
    "AuditRecord",
    "AuditSink",
    "CapHeadroom",
    "CheckResult",
    "Direction",
    "InMemoryAuditSink",
    "MandateContext",
    "NullAuditSink",
    "PolicyConstants",
    "PolicyContext",
    "PolicyVerdict",
    "Protocol",
    "ReasonCode",
    "RiskProfile",
    "SessionGrantVerdict",
    "SessionScope",
    "SessionScopePair",
    "SessionState",
    "SimulationInput",
    "build_audit_record",
    "evaluate",
    "evaluate_and_audit",
    "evaluate_session_grant",
    "get_addresses",
    "get_policy_constants",
    "record_verdict",
    "resolve_target_ref",
]
