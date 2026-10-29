"""Process-wide logging for the agent service (065).

Before this module the ``sparkpoint_agent.*`` loggers had no handler and no level, so they
inherited the root logger (``WARNING``) and every ``logger.info(...)`` the service emits was
silently dropped in production. Warnings reached stderr through logging's last-resort handler;
INFO did not reach anyone. That made an incident like 065 ("which branch rejected the answer?")
unreadable even though the code already logged the retry, refund and quota events.

:func:`configure_logging` is called once at app startup (``api.main.lifespan``) and:

* honours ``LOG_LEVEL`` (default ``INFO``), so an operator can quiet the service back down;
* attaches ONE stream handler to the ``sparkpoint_agent`` logger, idempotently;
* sets ``propagate = False`` so the same record can never be printed twice by the root logger or
  by uvicorn's own handlers (uvicorn configures ``uvicorn.*`` separately and is untouched).

Address-free by contract: every existing ``logger.info`` call in the agent is reviewed to avoid
wallet addresses, tokens and DSNs (see ``specs/065-comparative-upstream/research.md``). This
module itself logs nothing.
"""

from __future__ import annotations

import logging
import os

LOGGER_NAME = "sparkpoint_agent"
LOG_LEVEL_ENV = "LOG_LEVEL"
DEFAULT_LOG_LEVEL = "INFO"

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"
_HANDLER_MARKER = "_sparkpoint_agent_handler"


def _resolve_level(raw: str | None) -> int:
    """Map ``LOG_LEVEL`` to a logging level, falling back to INFO for unknown values."""
    name = (raw or DEFAULT_LOG_LEVEL).strip().upper()
    level = logging.getLevelName(name)
    return level if isinstance(level, int) else logging.INFO


def configure_logging(level: str | None = None) -> logging.Logger:
    """Configure the agent logger tree once; safe to call repeatedly.

    ``level`` overrides ``LOG_LEVEL`` when supplied (tests/ops). Returns the configured logger.
    """
    logger = logging.getLogger(LOGGER_NAME)
    resolved = _resolve_level(level if level is not None else os.getenv(LOG_LEVEL_ENV))
    logger.setLevel(resolved)

    if not any(getattr(handler, _HANDLER_MARKER, False) for handler in logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(_FORMAT))
        setattr(handler, _HANDLER_MARKER, True)
        logger.addHandler(handler)

    # Never duplicate uvicorn's (or the root logger's) output for the same record.
    logger.propagate = False
    return logger


__all__ = [
    "DEFAULT_LOG_LEVEL",
    "LOG_LEVEL_ENV",
    "LOGGER_NAME",
    "configure_logging",
]
