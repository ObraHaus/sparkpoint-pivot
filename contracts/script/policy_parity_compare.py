#!/usr/bin/env python3
"""ITEM 3 / T098 — three-way policy-parity comparator (the drift brain).

Asserts, PER chainId, that the LIVE on-chain reads == packages/shared
``getPolicyConstants(chainId)`` == the services/agent Python policy constants,
for the six drift-critical policy values:

    performanceFeeBps      (vault, mutable rate)      == governance.default_bps
    maxPerformanceFeeBps   (vault, immutable cap)     == governance.ceiling_bps
    perUserCap             (CapRegistry)              == caps.per_user_tvl.amount
    totalCap               (CapRegistry)              == caps.total_protocol.amount
    vaultCap               (CapRegistry)              == caps.vault_deposit.amount
    asset()                (vault, ERC-4626)          == addresses[chainId].usdc

The on-chain reads (JSON) and the shared/TS view (JSON) are supplied by the
caller (contracts/script/policy-parity-check.sh, via cast + the .mjs dumper);
the Python view is imported here. On ANY drift this prints one ``::error::`` per
field plus a summary and exits 1; when all three sources agree it prints a parity
table and exits 0.

The Python constants module is pure-stdlib, so it is imported BY FILE with
lightweight stub parent packages — no venv / third-party deps and, critically,
without executing the heavy ``sparkpoint_agent/policy/__init__.py`` graph.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import types
from pathlib import Path
from typing import Any

FIELDS = (
    "performanceFeeBps",
    "maxPerformanceFeeBps",
    "perUserCap",
    "totalCap",
    "vaultCap",
    "asset",
)

CHAIN_LABEL = {8453: "base", 84532: "base-sepolia", 31337: "local-fork"}


def load_py_constants(agent_src: Path) -> Any:
    """Import ``sparkpoint_agent.policy.constants`` by file (stdlib only).

    Registers empty stub parent packages so the module's ``from .enums import ...``
    resolves WITHOUT running the package ``__init__`` (which pulls third-party deps).
    """
    pkg_root = agent_src / "sparkpoint_agent"
    for name, path in (
        ("sparkpoint_agent", pkg_root),
        ("sparkpoint_agent.policy", pkg_root / "policy"),
    ):
        if name not in sys.modules:
            stub = types.ModuleType(name)
            stub.__path__ = [str(path)]  # type: ignore[attr-defined]
            stub.__package__ = name
            sys.modules[name] = stub

    def _load(modname: str, filename: str) -> Any:
        spec = importlib.util.spec_from_file_location(modname, pkg_root / "policy" / filename)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load {modname} from {filename}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[modname] = module
        spec.loader.exec_module(module)
        return module

    _load("sparkpoint_agent.policy.enums", "enums.py")
    return _load("sparkpoint_agent.policy.constants", "constants.py")


def py_view(constants: Any, chain_id: int) -> dict[str, str]:
    """The Python-constants view of the six fields, as normalized strings."""
    pc = constants.get_policy_constants(chain_id)
    book = constants.get_addresses(chain_id)
    usdc = book.usdc
    if not isinstance(usdc, str) or not usdc:
        raise RuntimeError(f"agent policy constants: no usdc address for chainId {chain_id}")
    return {
        "performanceFeeBps": str(pc.governance.performance_fee.default_bps),
        "maxPerformanceFeeBps": str(pc.governance.performance_fee.ceiling_bps),
        "perUserCap": str(pc.caps.per_user_tvl.amount),
        "totalCap": str(pc.caps.total_protocol.amount),
        "vaultCap": str(pc.caps.vault_deposit.amount),
        "asset": usdc.lower(),
    }


def normalize(field: str, value: Any) -> str:
    """Canonicalize a field value for comparison (addresses lower-cased, ints exact)."""
    if field == "asset":
        return str(value).lower()
    # Integer fields: parse exactly (never via float) so 1e12-scale caps can't drift silently.
    return str(int(str(value), 10))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="three-way policy-parity comparator")
    ap.add_argument("--chain-id", type=int, required=True)
    ap.add_argument("--agent-src", type=Path, required=True, help="path to services/agent/src")
    ap.add_argument("--onchain", required=True, help="JSON: live cast reads")
    ap.add_argument("--ts", required=True, help="JSON: packages/shared getPolicyConstants view")
    args = ap.parse_args(argv)

    onchain_raw = json.loads(args.onchain)
    ts_raw = json.loads(args.ts)
    constants = load_py_constants(args.agent_src.resolve())
    py_raw = py_view(constants, args.chain_id)

    rows: list[tuple[str, str, str, str, bool]] = []
    drift: list[tuple[str, str, str, str]] = []
    for field in FIELDS:
        try:
            onchain = normalize(field, onchain_raw[field])
            shared = normalize(field, ts_raw[field])
            python = normalize(field, py_raw[field])
        except (KeyError, ValueError) as exc:
            print(
                f"::error::policy-parity: field '{field}' missing/malformed on chainId "
                f"{args.chain_id}: {exc}",
                file=sys.stderr,
            )
            return 1
        ok = onchain == shared == python
        rows.append((field, onchain, shared, python, ok))
        if not ok:
            drift.append((field, onchain, shared, python))

    label = CHAIN_LABEL.get(args.chain_id, str(args.chain_id))
    width = max(len(f) for f in FIELDS)

    def _row(field: str, onchain: str, shared: str, python: str, status: str) -> str:
        return f"  {field.ljust(width)}  {onchain:>24}  {shared:>24}  {python:>24}  {status}"

    print(f"policy-parity chainId {args.chain_id} ({label}): on-chain vs shared(TS) vs agent(py)")
    print(_row("field", "on-chain", "shared(TS)", "agent(py)", "status"))
    for field, onchain, shared, python, ok in rows:
        print(_row(field, onchain, shared, python, "OK" if ok else "DRIFT"))

    if drift:
        for field, onchain, shared, python in drift:
            print(
                f"::error::policy-parity DRIFT [chainId {args.chain_id}] {field}: "
                f"on-chain={onchain} shared(TS)={shared} agent(py)={python}",
                file=sys.stderr,
            )
        print(
            f"::error::policy-parity: {len(drift)} field(s) drifted on chainId {args.chain_id} "
            f"— live on-chain == shared(TS) == agent(py) is REQUIRED (T098). Failing.",
            file=sys.stderr,
        )
        return 1

    print(
        f"policy-parity: OK — all {len(FIELDS)} fields agree "
        f"(on-chain == shared(TS) == agent(py)) for chainId {args.chain_id}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
