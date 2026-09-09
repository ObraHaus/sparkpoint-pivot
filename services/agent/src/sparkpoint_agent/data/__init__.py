"""Derived-index / DISPLAY-ONLY data layer for the SparkPoint vault surface.

Everything here is an ONCHAIN-DERIVED accelerator (data-model.md sec.16, sec.18; N2):
it indexes facts the chain already proves, is fully reconstructable from chain, and is
NEVER on a withdraw/redeem path. Nothing in this package may be imported by ``policy/``
(the deterministic decision path stays LLM/knowledge/index-free), and no value here ever
gates a signature or a redemption.

Exports the T110 performance-fee event indexer — see :mod:`.fee_indexer`.
"""

from __future__ import annotations

from .fee_indexer import (
    EVENT_SIGNATURES,
    MAX_PERFORMANCE_FEE_BPS,
    FeeEventRow,
    FeeEventStore,
    FeeIndexer,
    FeeRevenueSummary,
    HighWaterMarkUpdated,
    IndexResult,
    LogMeta,
    PerformanceFeeAccrued,
    PeriodBucket,
    PgFeeEventStore,
    RiskEvent,
    VaultFeeLog,
    decode_fee_rate_updated,
    decode_high_water_mark_updated,
    decode_performance_fee_accrued,
)

__all__ = [
    "EVENT_SIGNATURES",
    "MAX_PERFORMANCE_FEE_BPS",
    "FeeEventRow",
    "FeeEventStore",
    "FeeIndexer",
    "FeeRevenueSummary",
    "HighWaterMarkUpdated",
    "IndexResult",
    "LogMeta",
    "PerformanceFeeAccrued",
    "PeriodBucket",
    "PgFeeEventStore",
    "RiskEvent",
    "VaultFeeLog",
    "decode_fee_rate_updated",
    "decode_high_water_mark_updated",
    "decode_performance_fee_accrued",
]
