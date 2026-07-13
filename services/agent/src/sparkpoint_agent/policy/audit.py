"""Policy audit hook (T019) — an append-only ``audit_logs`` row for EVERY verdict.

Grounding: data-model.md §15.2 ``audit_logs`` (append-only provability/forensics
spine; VR-A2: every ``policy_verdict`` on a state-changing action MUST produce a
row) and §16 (``policy_version`` stamped on every verdict, N5).

NON-CUSTODY / PURITY: the audit is a SIDE-CHANNEL, never on the decision path.
``evaluate()`` stays pure — it does NOT write anything. The DB write goes through an
INJECTED ``AuditSink`` so this module (and ``policy/``) imports no DB driver and no
network client. VR-A3: the payload NEVER contains private keys, signatures, or
session private keys — only structured reasons + the per-check trace.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

from .enums import ReasonCode
from .models import Action, PolicyVerdict

# audit_logs.actor_kind / event_type enum values this hook always emits (§15.2).
ACTOR_KIND_POLICY_LAYER = "policy_layer"
EVENT_TYPE_POLICY_VERDICT = "policy_verdict"


@dataclass(frozen=True)
class AuditRecord:
    """One append-only ``audit_logs`` row for a policy verdict (data-model.md §15.2).

    Field names mirror the ``audit_logs`` columns so a sink can insert directly.
    ``payload`` is the JSONB detail (approved flag, reason codes, per-check trace,
    a key-free action summary) — never secrets (VR-A3).
    """

    policy_version: str
    payload: dict[str, Any]
    ts: datetime = field(default_factory=lambda: datetime.now(UTC))
    actor_kind: str = ACTOR_KIND_POLICY_LAYER
    event_type: str = EVENT_TYPE_POLICY_VERDICT
    actor_ref: str | None = None
    subject_table: str | None = None
    subject_id: str | None = None
    onchain_ref: bytes | None = None


@runtime_checkable
class AuditSink(Protocol):
    """The injected write target. Concrete Postgres/JSONL sinks live OUTSIDE policy/.

    Implementations MUST be append-only (no UPDATE/DELETE — VR-A1, trigger-enforced
    at the DB) and MUST NOT raise on the decision path's behalf (callers decide how
    to handle a sink failure; a missing audit row is itself a flagged anomaly, VR-A2).
    """

    def write(self, record: AuditRecord) -> None: ...


class NullAuditSink:
    """A no-op sink (tests / audit disabled). Still satisfies the ``AuditSink`` type."""

    def write(self, record: AuditRecord) -> None:  # noqa: D102
        return None


class InMemoryAuditSink:
    """An append-only in-memory sink for tests and local runs."""

    def __init__(self) -> None:
        self.records: list[AuditRecord] = []

    def write(self, record: AuditRecord) -> None:
        self.records.append(record)


def _action_summary(action: Action | None) -> dict[str, Any] | None:
    """A key-free, JSON-serialisable action summary for the payload (VR-A3)."""
    if action is None:
        return None
    return {
        "action_type": str(action.action_type),
        "target": action.target,
        "selector": action.selector,
        "asset": str(action.asset),
        "amount": str(action.amount),  # base-unit string, never a float (N5)
        "decimals": action.decimals,
        "recipient": action.recipient,
        "risk_class": str(action.risk_class),
        "max_slippage_bps": action.max_slippage_bps,
    }


def build_audit_record(
    verdict: PolicyVerdict,
    *,
    action: Action | None = None,
    actor_ref: str | None = None,
    subject_table: str | None = None,
    subject_id: str | None = None,
) -> AuditRecord:
    """Build (but do NOT write) the ``audit_logs`` row for ``verdict``.

    Captures the approved flag, the ordered reason codes, the full per-check trace,
    and a key-free action summary — everything the Trust Center / forensics need to
    reconstruct why the verdict came out as it did, under the exact ``policy_version``.
    """
    payload: dict[str, Any] = {
        "approved": verdict.approved,
        "reasons": [str(r) for r in verdict.reasons],
        "checks": [
            {
                "step": c.step,
                "passed": c.passed,
                "reason": str(c.reason),
                "skipped": c.skipped,
                "detail": c.detail,
            }
            for c in verdict.trace
        ],
        "action": _action_summary(action),
    }
    return AuditRecord(
        policy_version=verdict.policy_version,
        payload=payload,
        actor_ref=actor_ref,
        subject_table=subject_table,
        subject_id=subject_id,
    )


def record_verdict(
    verdict: PolicyVerdict,
    sink: AuditSink,
    *,
    action: Action | None = None,
    actor_ref: str | None = None,
    subject_table: str | None = None,
    subject_id: str | None = None,
) -> AuditRecord:
    """Build the audit row for ``verdict`` and append it via ``sink`` (side-channel).

    Call this AFTER ``evaluate()`` for EVERY verdict (approved AND rejected) so the
    append-only log carries a row per decision (VR-A2). Returns the written record.
    """
    record = build_audit_record(
        verdict,
        action=action,
        actor_ref=actor_ref,
        subject_table=subject_table,
        subject_id=subject_id,
    )
    sink.write(record)
    return record


def evaluate_and_audit(
    action: Action,
    ctx: Any,  # PolicyContext — annotated Any to keep this import-light / no cycle
    sink: AuditSink,
    *,
    actor_ref: str | None = None,
    subject_table: str | None = None,
    subject_id: str | None = None,
) -> PolicyVerdict:
    """Convenience: run the PURE ``evaluate()`` then write the audit row (side-channel).

    The decision itself is still made by the pure ``evaluate()``; auditing is layered
    on top so the purity boundary (policy-schema.md §0 rule 6) is preserved.
    """
    from .evaluate import evaluate

    verdict = evaluate(action, ctx)
    record_verdict(
        verdict,
        sink,
        action=action,
        actor_ref=actor_ref,
        subject_table=subject_table,
        subject_id=subject_id,
    )
    return verdict


# ``ReasonCode`` re-exported for sinks that want to type payloads without importing enums.
__all__ = [
    "ACTOR_KIND_POLICY_LAYER",
    "EVENT_TYPE_POLICY_VERDICT",
    "AuditRecord",
    "AuditSink",
    "InMemoryAuditSink",
    "NullAuditSink",
    "ReasonCode",
    "build_audit_record",
    "evaluate_and_audit",
    "record_verdict",
]
