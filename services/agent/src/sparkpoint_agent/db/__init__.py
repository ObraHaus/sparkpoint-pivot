"""SparkPoint agent data layer: thin async Postgres access.

A derived index/accelerator only -- never on the withdrawal path, holds no keys
(data-model.md sec.16, sec.18; N2). Schema lives in ../../../migrations
(0001_foundation.sql, applied via yoyo).
"""

from __future__ import annotations

from .allowlist import (
    ADMIN_ROLE,
    BETA_ROLE,
    AllowlistStore,
    parse_allowlist_env,
)
from .config import DATABASE_URL_ENV, DatabaseConfig
from .content_entries import ContentEntryStore
from .limits import DEFAULT_TIER, LimitsStore
from .mandates import (
    MandateRecord,
    MandateStore,
    MandateWrite,
    PgMandateStore,
    row_to_record,
)
from .pool import Database, get_database
from .subscriptions import PaymentAlreadyRecorded, SubscriptionStore
from .swap_fees import (
    PgSwapFeeEventStore,
    SwapFeeEvent,
    SwapFeeEventStore,
    SwapFeePeriodBucket,
    SwapFeeRevenueSummary,
    summarize_swap_fees,
)

__all__ = [
    "ADMIN_ROLE",
    "BETA_ROLE",
    "DATABASE_URL_ENV",
    "DEFAULT_TIER",
    "AllowlistStore",
    "ContentEntryStore",
    "Database",
    "LimitsStore",
    "DatabaseConfig",
    "MandateRecord",
    "MandateStore",
    "MandateWrite",
    "PaymentAlreadyRecorded",
    "PgMandateStore",
    "PgSwapFeeEventStore",
    "SubscriptionStore",
    "SwapFeeEvent",
    "SwapFeeEventStore",
    "SwapFeePeriodBucket",
    "SwapFeeRevenueSummary",
    "get_database",
    "summarize_swap_fees",
    "parse_allowlist_env",
    "row_to_record",
]
