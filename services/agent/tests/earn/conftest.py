# ruff: noqa: S101
"""Shared fixtures for the 069 earn tests. No test touches the network."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from sparkpoint_agent.earn.config import EarnConfig, default_config


@pytest.fixture
def config() -> EarnConfig:
    return default_config()


def patched_config(**changes: Any) -> EarnConfig:
    base = default_config()
    return replace(base, **changes)
