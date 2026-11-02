"""SparkPoint agent data layer: thin async Postgres access.

A derived index/accelerator only -- never on the withdrawal path, holds no keys
(data-model.md sec.16, sec.18; N2). Schema lives in ../../../migrations
(0001_foundation.sql, applied via yoyo).
"""

from __future__ import annotations

from .access_applications import AccessApplicationStore, Application
from .allowlist import (
    ADMIN_ROLE,
    BETA_ROLE,
    AllowlistStore,
    parse_allowlist_env,
)
from .analytics import AnalyticsStore, build_funnel, pseudonymize
from .chat_feedback import ChatFeedbackStore
from .config import DATABASE_URL_ENV, DatabaseConfig
from .content_entries import ContentEntryStore
from .crosschain_quotes import CrossChainQuoteStore
from .executions import ExecutionRow, ExecutionStore
from .intent_bundles import BundleInsert, BundleRow, IntentBundleStore
from .limits import DEFAULT_TIER, LimitsStore
from .mandates import (
    MandateRecord,
    MandateStore,
    MandateWrite,
    PgMandateStore,
    row_to_record,
)
from .notification_events import NotificationEventRow, NotificationEventStore, PollerState
from .notification_reads import NotificationReadStore, ReadCursor
from .pool import Database, get_database
from .recommendations import RecInsert, RecommendationStore, RecRow
from .session_keys import SessionKeyRow, SessionKeyStore
from .simulations import SimulationInsert, SimulationRow, SimulationStore
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
    "AccessApplicationStore",
    "AllowlistStore",
    "Application",
    "AnalyticsStore",
    "BundleInsert",
    "BundleRow",
    "ChatFeedbackStore",
    "ContentEntryStore",
    "CrossChainQuoteStore",
    "Database",
    "ExecutionRow",
    "ExecutionStore",
    "SessionKeyRow",
    "SessionKeyStore",
    "IntentBundleStore",
    "LimitsStore",
    "DatabaseConfig",
    "MandateRecord",
    "MandateStore",
    "MandateWrite",
    "NotificationEventRow",
    "NotificationEventStore",
    "NotificationReadStore",
    "PaymentAlreadyRecorded",
    "PollerState",
    "PgMandateStore",
    "PgSwapFeeEventStore",
    "ReadCursor",
    "RecInsert",
    "RecRow",
    "RecommendationStore",
    "SimulationInsert",
    "SimulationRow",
    "SimulationStore",
    "SubscriptionStore",
    "SwapFeeEvent",
    "SwapFeeEventStore",
    "SwapFeePeriodBucket",
    "SwapFeeRevenueSummary",
    "build_funnel",
    "get_database",
    "pseudonymize",
    "summarize_swap_fees",
    "parse_allowlist_env",
    "row_to_record",
]
