"""The US2 execution spine — the single signing chokepoint (feature 019).

Wires the pure policy engine (``policy/``) + the pre-trade simulator (``sim/``) into the execution
REST endpoints (``api/execution.py``): materialize an unsigned ``IntentBundle`` from a proposed
vault
action (``POST /build-tx``), re-simulate (``POST /simulate``), relay a user-signed payload
(``POST /submit-signed-tx``), and poll status.

Purity boundary (policy-schema.md §0 rule 6): all chain I/O happens here (``assemble``/``builder``);
``policy/`` stays pure. Non-custody (N1–N5): recipient forced to the user, ``signature`` null,
the exit path never gated, nothing signed or key-holding.
"""

from __future__ import annotations
