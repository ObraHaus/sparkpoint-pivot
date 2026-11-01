"""Background refresh for feature 069 — the ONLY runtime path that calls Morpho/1Click.

The request path reads the snapshot; this loop keeps it fresh on the configured cadence and
opportunistically probes receipt liquidity with DRY 1Click quotes. It never signs, submits or
takes custody, and every failure is a warning, never a crash.
"""

from __future__ import annotations

import logging

from .rails import probe_receipts
from .registry import refresh_loop
from .service import EarnService

logger = logging.getLogger("sparkpoint_agent.earn.refresh")


async def run_earn_loop(service: EarnService) -> None:
    async def _probe() -> None:
        if not service.config.rails.oneclick_earn:
            return
        await probe_receipts(
            service.config,
            service.oneclick,
            service.crosschain,
            service.liveness,
        )

    await refresh_loop(service.registry, enabled=True, probe=_probe)
