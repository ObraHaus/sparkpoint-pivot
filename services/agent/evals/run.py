"""CLI entry point: ``uv run python -m evals.run [--mode offline|live|http]``."""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Sequence
from pathlib import Path

from .model import OUT_DIR, load_cases
from .runner import (
    HttpNotConfigured,
    LiveNotConfigured,
    exit_code,
    render_summary,
    run_http,
    run_live,
    run_offline,
    write_outputs,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Sparky's golden eval set.")
    parser.add_argument(
        "--mode",
        choices=("offline", "live", "http"),
        default="offline",
        help=("offline = deterministic in-process (default); live = gateway + judge; "
              "http = deployed SSE"),
    )
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output directory")
    parser.add_argument(
        "--case",
        action="append",
        default=[],
        help="only run this case id (repeatable)",
    )
    parser.add_argument("--retries", type=int, default=2, help="live retries for infra failures")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-call timeout (seconds)")
    parser.add_argument(
        "--budget-seconds",
        type=float,
        default=2400.0,
        help="global wall-clock budget for the live run (default 2400s = 40 min)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    cases = load_cases()
    if args.case:
        wanted = set(args.case)
        cases = tuple(case for case in cases if case.id in wanted)
        if not cases:
            print(f"No cases matched: {', '.join(sorted(wanted))}")
            return 1

    try:
        if args.mode == "live":
            report = asyncio.run(
                run_live(
                    cases,
                    retries=args.retries,
                    timeout_s=args.timeout,
                    budget_s=args.budget_seconds,
                )
            )
        elif args.mode == "http":
            report = asyncio.run(run_http(cases, request_timeout=args.timeout))
        else:
            report = asyncio.run(run_offline(cases))
    except LiveNotConfigured as exc:
        print(f"Live mode skipped: {exc}")
        return 0
    except HttpNotConfigured as exc:
        print(f"HTTP mode skipped: {exc}")
        return 0

    results_path, summary_path = write_outputs(report, args.out)
    print(render_summary(report))
    print(f"Results: {results_path}")
    print(f"Summary: {summary_path}")
    return exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
