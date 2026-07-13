"""FastAPI app entry for the SparkPoint Hermes agent.

W3 wires the real middleware (service-to-service auth, X-Account/X-Owner/
X-Chain-Id parsing, idempotency), the coordinator DAG, the policy engine, and
the endpoints. This skeleton exposes the health surface (R17) so the compose
healthcheck, the Coolify probe, and the W4 barrier have a target from day one.
"""

from __future__ import annotations

import os

from fastapi import FastAPI

app = FastAPI(title="SparkPoint Hermes Agent", version="0.0.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness — the process is up. Deep dependency checks live in /readyz."""
    return {"status": "ok", "service": "sparkpoint-agent", "version": "0.0.0"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    """Readiness — which dependencies are configured/reachable.

    W3 replaces these presence checks with real reachability probes
    (Postgres / Base RPC / the Anvil sim-fork / Anthropic).
    """
    checks = {
        "sim_fork": bool(os.getenv("SIM_FORK_RPC_URL")),
        "base_rpc": bool(os.getenv("BASE_SEPOLIA_RPC_URL") or os.getenv("ALCHEMY_ACCESS_KEY")),
        "anthropic": bool(os.getenv("ANTHROPIC_OAUTH_TOKEN") or os.getenv("ANTHROPIC_API_KEY")),
        "postgres": bool(os.getenv("DATABASE_URL")),
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        "policy_version": os.getenv("POLICY_VERSION", "unset"),
    }
