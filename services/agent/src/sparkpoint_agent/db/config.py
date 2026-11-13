"""Database connection configuration for the SparkPoint agent data layer.

Reads ``DATABASE_URL`` from the environment (see the repo ``.env.example``).
Holds NO secrets in source; the DSN is supplied by the environment only.

NON-CUSTODY: the data layer is a derived index/accelerator only. It is never on
the withdrawal path and stores no keys (data-model.md sec.16, sec.18; N2).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DATABASE_URL_ENV = "DATABASE_URL"


@dataclass(frozen=True, slots=True)
class DatabaseConfig:
    """Immutable pool configuration.

    ``dsn`` is a libpq/asyncpg-compatible ``postgresql://`` URL. The pool is
    small by default (this service does read-mostly derived-index work; the
    custody-critical safety reads happen fresh over RPC in the policy layer,
    never through this pool).
    """

    dsn: str
    min_size: int = 1
    max_size: int = 10
    command_timeout: float = 30.0

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> DatabaseConfig:
        """Build config from the process environment.

        Raises ``RuntimeError`` (fail-closed) if ``DATABASE_URL`` is absent so a
        misconfigured deploy fails loudly rather than silently running keyless.
        """
        source = env if env is not None else dict(os.environ)
        dsn = source.get(DATABASE_URL_ENV)
        if not dsn:
            raise RuntimeError(
                f"{DATABASE_URL_ENV} is not set; the data layer needs a Postgres DSN "
                "(see .env.example)."
            )
        return cls(dsn=dsn)
