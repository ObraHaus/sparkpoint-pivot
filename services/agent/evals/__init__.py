"""Sparky's golden eval harness (spec 058).

Run ``uv run python -m evals.run`` from ``services/agent``. The offline set is also wired
into the blocking agent CI via ``tests/evals/test_golden_offline.py``; live/HTTP modes are
operator-run and non-blocking.
"""

from .model import Case, Rubric, load_cases, load_rubric
from .runner import Report, run_http, run_live, run_offline

__all__ = [
    "Case",
    "Report",
    "Rubric",
    "load_cases",
    "load_rubric",
    "run_http",
    "run_live",
    "run_offline",
]
