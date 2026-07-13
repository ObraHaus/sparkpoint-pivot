"""SparkPoint agent data layer: thin async Postgres access.

A derived index/accelerator only -- never on the withdrawal path, holds no keys
(data-model.md sec.16, sec.18; N2). Schema lives in ../../../migrations
(0001_foundation.sql, applied via yoyo).
"""

from __future__ import annotations

from .config import DATABASE_URL_ENV, DatabaseConfig
from .pool import Database, get_database

__all__ = [
    "DATABASE_URL_ENV",
    "Database",
    "DatabaseConfig",
    "get_database",
]
