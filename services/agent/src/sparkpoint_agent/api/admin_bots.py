"""Feature 047 — the admin view of the testnet activity bots (READ-ONLY, admin-gated).

Two routes, and the split between them is the whole design:

  * ``POST /admin/bots/runs``   — the RUNNER reports what it just did. S2S-authenticated.
  * ``GET  /admin/bots/status`` — the PANEL reads the fleet's health. Admin-gated.

⚠️⚠️ **This is not a control plane, and it must never become one.** There is no start, no stop, no
cadence setter, and no path by which a browser or this service can cause a bot to act. The agent is
**provably keyless** — that is a load-bearing property of the non-custody story (N2), audited on
that basis — and running the bots here would end it. The runner holds its own keys, owns its own
schedule, and reports here afterwards; everything this module knows is a claim about the past.

The temptation to add "run now" is exactly the refactor that would pass every test in this file
while destroying the property the file exists to protect. If a run has to be triggered from a UI,
it belongs on the runner's own control endpoint, reached server-side, with its own token — the
shape the simulation stack's operator console already uses.

Honest degradation, not silence: with migration 0037 unapplied, or with nothing ever reported, the
status route answers ``configured: false`` / ``never-run`` rather than an empty success. A fleet
that has never run and a fleet that is healthy must never render the same way.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db import get_database
from ..db.bot_runs import BotRun, PgBotRunStore, derive_state
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(prefix="/admin/bots", tags=["admin-bots"])

#: Streams the panel expects to exist, i.e. **what the scheduled cycle actually runs**. Listing
#: them is what lets the view say "never-run" for a job that should be running and is not — an
#: absent row is otherwise indistinguishable from a stream nobody configured.
#:
#: ⚠️ It must match `ops/testnet-bots/run-cycle.sh`, and `tests/api/test_expected_streams.py`
#: asserts that it does. This list carried `("base", "vault")` for a day while the cycle ran only
#: swap and accrue, so the panel showed a permanent **"never run"** for a job nothing schedules —
#: and the bots were at their per-wallet deposit cap anyway, so it could not have done anything if
#: it had run. A warning that can never clear is one people learn to scroll past, which is worse
#: than no warning at all.
#:
#: Same drift class as the Dockerfile's hand-written dependency list: a second copy of a fact,
#: maintained by memory. Assert it instead.
#:
#: `vault` is deliberately absent — it is an on-demand setup command (fill TVL once), not a
#: recurring job. If it is ever run it still appears, because any stream that reports is appended.
EXPECTED_STREAMS: tuple[tuple[str, str], ...] = (
    ("base", "accrue"),
    ("robinhood", "swap"),
)


class BotRunReport(BaseModel):
    """What the runner posts after a run. Every field is a statement about work already done."""

    runKey: str = Field(min_length=8, max_length=200)
    networkId: str = Field(min_length=1, max_length=32)
    command: str = Field(min_length=1, max_length=32)
    startedAt: datetime
    finishedAt: datetime
    ok: bool
    attempted: int = Field(ge=0, le=100_000)
    succeeded: int = Field(ge=0, le=100_000)
    schedule: str | None = Field(default=None, max_length=120)
    nextRunAt: datetime | None = None
    runnerCommit: str | None = Field(default=None, max_length=80)
    detail: dict[str, Any] = Field(default_factory=dict)


@router.post("/runs")
async def report_run(
    body: BotRunReport,
    _: Annotated[AccountContext, Depends(get_account)],
) -> dict[str, Any]:
    """Record one bot run. Idempotent on ``runKey``.

    S2S-authenticated rather than admin-gated: the caller is a machine with no wallet, and the
    report is an *observation*, not an administrative act. It grants nothing — the worst a forged
    report can do is make an operator view wrong, which is why it is worth authenticating at all
    but not worth a signature.

    ⚠️ The dependency is ``get_account``, NOT ``security.authenticate``. The latter is a plain
    helper taking a bare ``authorization: str | None`` — used as a FastAPI dependency it has no
    ``Header(...)`` annotation, so FastAPI resolves it as a **query parameter** and every call
    fails ``query.authorization: Field required`` with a 400 that reads like a bad body. The S2S
    bearer is already verified by the middleware before any route runs; ``get_account`` reads the
    identity the middleware attached, which is what every other authenticated route does.

    ⚠️ And it is ``mandate.get_account``, not ``vault.get_account`` — there are TWO, they behave
    identically, and `require_admin` (which gates the sibling route) uses mandate's. Importing the
    other one means the two routes on this router have DIFFERENT dependency objects, so overriding
    one in a test silently leaves the other unpatched.
    """
    if body.succeeded > body.attempted:
        # Nonsense in, nonsense out otherwise — and this particular nonsense would paint a failing
        # fleet as healthy, which is the one direction that matters.
        raise ApiError(ErrorCode.VALIDATION_ERROR, "succeeded cannot exceed attempted.")

    store = PgBotRunStore(get_database())
    created = await store.record(
        BotRun(
            run_key=body.runKey,
            network_id=body.networkId,
            command=body.command,
            started_at=body.startedAt,
            finished_at=body.finishedAt,
            ok=body.ok,
            attempted=body.attempted,
            succeeded=body.succeeded,
            schedule=body.schedule,
            next_run_at=body.nextRunAt,
            runner_commit=body.runnerCommit,
            detail=body.detail,
        )
    )
    return {"ok": True, "created": created}


def _stream_view(
    run: BotRun | None, network_id: str, command: str, now: datetime
) -> dict[str, Any]:
    state = derive_state(run, now=now)
    view: dict[str, Any] = {
        "networkId": network_id,
        "command": command,
        "state": state,
        "schedule": run.schedule if run else None,
        "lastRunAt": run.finished_at.isoformat() if run else None,
        "nextRunAt": run.next_run_at.isoformat() if run and run.next_run_at else None,
        "attempted": run.attempted if run else 0,
        "succeeded": run.succeeded if run else 0,
        "runnerCommit": run.runner_commit if run else None,
        "detail": run.detail if run else {},
    }
    # How late, in seconds, so the UI can say "overdue by 25 minutes" instead of showing a
    # timestamp in the past and leaving the reader to do the subtraction.
    if state == "overdue" and run is not None:
        due = run.next_run_at or run.finished_at
        view["overdueSeconds"] = int((now - due).total_seconds())
    return view


@router.get("/status")
async def bots_status(
    _: Annotated[AccountContext, Depends(require_admin)],
) -> dict[str, Any]:
    """Fleet health for the admin panel. Read-only; never triggers anything."""
    store = PgBotRunStore(get_database())
    try:
        latest = await store.latest_per_stream()
        recent = await store.recent(limit=20)
    except Exception:  # noqa: BLE001 — a dead store degrades the VIEW, never the panel
        return {"configured": False, "streams": [], "recent": []}

    now = datetime.now(UTC)
    by_key = {(r.network_id, r.command): r for r in latest}

    # Expected streams first (so a silent one is visible as never-run), then anything else that has
    # actually reported — a stream added to the runner should show up here without a code change.
    keys = list(EXPECTED_STREAMS) + [k for k in by_key if k not in EXPECTED_STREAMS]
    streams = [_stream_view(by_key.get(k), k[0], k[1], now) for k in keys]

    return {
        # `configured` means "this deployment has ever heard from a runner". False is the honest
        # answer when the migration is unapplied OR nothing has reported, and the panel renders a
        # setup hint rather than a healthy-looking empty table.
        "configured": bool(latest),
        "generatedAt": now.isoformat(),
        "streams": streams,
        "recent": [
            {
                "networkId": r.network_id,
                "command": r.command,
                "startedAt": r.started_at.isoformat(),
                "finishedAt": r.finished_at.isoformat(),
                "ok": r.ok,
                "attempted": r.attempted,
                "succeeded": r.succeeded,
            }
            for r in recent
        ],
    }
