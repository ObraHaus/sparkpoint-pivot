# ruff: noqa: S101
"""065 — the agent's own loggers must emit INFO in production (and stay address-free).

Before this, ``sparkpoint_agent.*`` had no handler and inherited the root WARNING level, so the
retry/refund/indexer INFO lines the service already emitted never reached the operator. These
tests configure the tree exactly as app startup does and assert an ``sparkpoint_agent.api.quota``
INFO record is actually emitted, while ``LOG_LEVEL`` can still quiet it down.
"""

from __future__ import annotations

import logging

import pytest

from sparkpoint_agent.logging_config import (
    LOG_LEVEL_ENV,
    LOGGER_NAME,
    configure_logging,
)

QUOTA_LOGGER = "sparkpoint_agent.api.quota"


@pytest.fixture(autouse=True)
def _restore_agent_logger():
    logger = logging.getLogger(LOGGER_NAME)
    previous_handlers = list(logger.handlers)
    previous_level = logger.level
    previous_propagate = logger.propagate
    yield
    logger.handlers[:] = previous_handlers
    logger.setLevel(previous_level)
    logger.propagate = previous_propagate


def _capture(logger: logging.Logger) -> list[logging.LogRecord]:
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append  # type: ignore[method-assign]
    logger.addHandler(handler)
    return records


def test_configured_app_emits_quota_info(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(LOG_LEVEL_ENV, raising=False)
    logger = configure_logging()
    records = _capture(logger)

    logging.getLogger(QUOTA_LOGGER).info("quota_refunded metric=%s used=%s", "chat", 3)

    assert [r.getMessage() for r in records] == ["quota_refunded metric=chat used=3"]
    assert records[0].levelno == logging.INFO
    assert records[0].name == QUOTA_LOGGER


def test_log_level_env_can_quiet_the_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(LOG_LEVEL_ENV, "WARNING")
    logger = configure_logging()
    records = _capture(logger)

    logging.getLogger(QUOTA_LOGGER).info("should not be emitted")
    logging.getLogger(QUOTA_LOGGER).warning("still emitted")

    assert [r.getMessage() for r in records] == ["still emitted"]
    assert logger.level == logging.WARNING


def test_an_unknown_log_level_falls_back_to_info(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(LOG_LEVEL_ENV, "not-a-level")
    assert configure_logging().level == logging.INFO


def test_configuring_twice_never_duplicates_the_handler() -> None:
    configure_logging("INFO")
    configure_logging("INFO")
    handlers = [
        h
        for h in logging.getLogger(LOGGER_NAME).handlers
        if getattr(h, "_sparkpoint_agent_handler", False)
    ]
    assert len(handlers) == 1


def test_agent_records_do_not_propagate_to_the_root_or_uvicorn_handlers() -> None:
    logger = configure_logging("INFO")
    assert logger.propagate is False
