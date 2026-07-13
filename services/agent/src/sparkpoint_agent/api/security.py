"""Service-to-service auth + user-scoping header parsing (agent-service-api.md §1.2).

The browser NEVER calls the agent directly with custody authority: the web tier
authenticates with a service-to-service bearer token and asserts the user's identity
via ``X-Account`` / ``X-Owner`` / ``X-Chain-Id`` (after a SIWE-style proof it performs).
The agent NEVER treats these headers as authority to move funds — they scope
reads/derivations and bind proposals to a user. Authority lives in the user's wallet.

Fail-closed posture: if the s2s token is unconfigured, ALL non-exempt requests are
rejected (a service that cannot authenticate its caller must not serve user-scoped
routes). Token comparison is constant-time.
"""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass

from .errors import ApiError, ErrorCode, ErrorReason

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# agent-service-api.md §1.2 — Base mainnet | Base Sepolia. (The policy layer also
# knows 31337 for the local Anvil fork; the wire header contract lists only these two.)
API_SUPPORTED_CHAIN_IDS: tuple[int, ...] = (8453, 84532)

# Paths served WITHOUT auth/header scoping: liveness/readiness probes + the API docs.
EXEMPT_PATHS: frozenset[str] = frozenset(
    {
        "/healthz",
        "/readyz",
        "/",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/docs/oauth2-redirect",
    }
)


@dataclass(frozen=True)
class AccountContext:
    """The user-scoping identity asserted by the web tier (§1.2). NOT fund authority.

    ``account`` is the user's SparkPointAccount (identity anchor, may be
    counterfactual); ``owner`` is the sole admin signer EOA; ``chain_id`` selects the
    network. These scope reads/derivations only — the RECIPIENT pin in the policy layer
    is what binds any built calldata's recipient to these addresses (N1).
    """

    account: str
    owner: str
    chain_id: int


def is_exempt(path: str) -> bool:
    """True for probe/docs paths that bypass auth + header scoping."""
    return path in EXEMPT_PATHS


def _configured_s2s_token() -> str | None:
    """The expected web-tier bearer token (never hard-coded; read from the env)."""
    return os.getenv("AGENT_S2S_TOKEN") or os.getenv("WEB_TIER_TOKEN")


def authenticate(authorization: str | None) -> None:
    """Assert a valid ``Authorization: Bearer <web-tier-token>`` (§1.2), else raise.

    Fail-closed: an unconfigured expected token rejects every request (401) rather
    than silently allowing them. Comparison is constant-time (no token-length or
    early-mismatch timing leak).
    """
    expected = _configured_s2s_token()
    if not expected:
        raise ApiError(
            ErrorCode.UNAUTHENTICATED,
            "Agent service auth is not configured; refusing all requests (fail-closed).",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(ErrorCode.UNAUTHENTICATED, "Missing or malformed web-tier bearer token.")
    presented = authorization[len("Bearer ") :].strip()
    if not secrets.compare_digest(presented, expected):
        raise ApiError(ErrorCode.UNAUTHENTICATED, "Invalid web-tier bearer token.")


def parse_account_headers(
    x_account: str | None,
    x_owner: str | None,
    x_chain_id: str | None,
) -> AccountContext:
    """Parse + validate the §1.2 user-scoping headers into an ``AccountContext``.

    Rejects (ACCOUNT_HEADERS_INVALID, 400) when any header is missing/malformed, the
    chain id is unsupported, or account == owner (a smart account must differ from its
    owner EOA). This is a format/consistency gate; on-chain owner verification is a
    later, deeper check.
    """
    reasons: list[ErrorReason] = []

    def _bad(message: str) -> None:
        reasons.append(ErrorReason("ACCOUNT_HEADERS_INVALID", message))

    if not x_account or not _ADDRESS_RE.match(x_account):
        _bad("X-Account is missing or not a 20-byte address.")
    if not x_owner or not _ADDRESS_RE.match(x_owner):
        _bad("X-Owner is missing or not a 20-byte address.")

    chain_id = 0
    if not x_chain_id:
        _bad("X-Chain-Id is required.")
    else:
        try:
            chain_id = int(x_chain_id)
        except ValueError:
            _bad(f"X-Chain-Id {x_chain_id!r} is not an integer.")
        else:
            if chain_id not in API_SUPPORTED_CHAIN_IDS:
                _bad(f"X-Chain-Id {chain_id} unsupported (want {list(API_SUPPORTED_CHAIN_IDS)}).")

    if x_account and x_owner and _ADDRESS_RE.match(x_account) and _ADDRESS_RE.match(x_owner):
        if x_account.lower() == x_owner.lower():
            _bad("X-Account must differ from X-Owner (account != owner EOA).")

    if reasons:
        raise ApiError(
            ErrorCode.ACCOUNT_HEADERS_INVALID,
            "X-Account/X-Owner/X-Chain-Id are malformed or mismatched.",
            reasons=reasons,
        )

    assert x_account is not None and x_owner is not None  # noqa: S101 — guaranteed by the checks above
    return AccountContext(account=x_account, owner=x_owner, chain_id=chain_id)
