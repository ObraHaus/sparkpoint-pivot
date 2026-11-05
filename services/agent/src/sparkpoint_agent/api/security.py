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
#: 076 — NEAR account ids: named (2-64 chars, dot/dash/underscore separated) or implicit (64 hex).
_NEAR_IMPLICIT_RE = re.compile(r"^[0-9a-f]{64}$")
_NEAR_NAMED_RE = re.compile(r"^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_NEAR_HEX_ONLY_RE = re.compile(r"^[0-9a-f]+$")
AUTH_CHAINS: tuple[str, ...] = ("evm", "near")

# agent-service-api.md §1.2 — Base mainnet | Base Sepolia | Robinhood testnet (§B3). The policy
# layer also knows 31337 for the local Anvil fork; the wire header contract lists the reachable
# chains. 46630 is chat + read-only portfolio ONLY — the vault is Base-only (fail-closed off Base).
API_SUPPORTED_CHAIN_IDS: tuple[int, ...] = (8453, 84532, 46630, 4663)

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

# Paths that still require the s2s bearer but carry NO user identity (045).
#
# The §1.2 scoping headers assert *who the web tier verified*. The public alpha-application form has
# no such person: the visitor never connected a wallet and never signed anything, so the web tier
# has nobody to assert. Demanding the headers anyway would force it to invent an identity — most
# obviously by echoing the address typed into the form — and an invented `X-Owner` is far worse than
# an absent one, because every route downstream treats that header as verified.
#
# So: authentication is UNCHANGED (a caller without the bearer is still rejected — this is not a
# public internet surface), and only the identity parse is skipped. `request.state.account` is then
# absent, so `get_account` raises for anything that needs a user, and a route can only end up here
# deliberately.
NO_ACCOUNT_PATHS: frozenset[str] = frozenset(
    {
        "/access/public-application",
        "/access/mint-whitelist",
        # 076 — NEAR login nonce issuance/consumption: the sign-in has not established an
        # identity yet, so there is no account to scope to. Still S2S-authenticated.
        "/auth/near/nonce",
        "/auth/near/consume",
    }
)

# Routes where a missing/invalid identity is an ANSWER, not an error.
#
# `/brokers/owned` is a read-only gallery lookup. A wallet on an unsupported chain, or a client
# that has not sent a chain header yet, genuinely cannot be scoped — and the honest answer is
# "unavailable", not a 400 that paints the network console red on every broker surface (061 A9).
# Authentication is unchanged: the s2s bearer is still required. Only the identity parse is
# softened, and the route itself reports `{available: false}`.
OPTIONAL_ACCOUNT_PATHS: frozenset[str] = frozenset({"/brokers/owned"})


def requires_account_context(path: str) -> bool:
    """False for s2s-authenticated routes that legitimately have no user to scope to."""
    return path not in NO_ACCOUNT_PATHS


def has_optional_account_context(path: str) -> bool:
    """True when a bad/missing identity should degrade to an unavailable read, not a 400."""
    return path in OPTIONAL_ACCOUNT_PATHS


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
    #: 076 — which chain proved control. "evm" for every pre-076 caller (default keeps tests and
    #: the SIWE path byte-identical). "near" means account/owner are a NEAR account id and the
    #: EVM-chain-dependent reads are not applicable.
    auth_chain: str = "evm"


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


def has_valid_s2s(authorization: str | None) -> bool:
    """Soft, non-raising variant of :func:`authenticate` — True iff a valid web-tier bearer
    is presented. Used to gate *detail* on otherwise-public probes (e.g. /readyz returns a
    bare boolean to anonymous callers but the full dependency breakdown to the web tier).
    Constant-time compare; an unconfigured expected token yields False (fail-closed)."""
    expected = _configured_s2s_token()
    if not expected or not authorization or not authorization.startswith("Bearer "):
        return False
    presented = authorization[len("Bearer ") :].strip()
    return secrets.compare_digest(presented, expected)


def _is_near_account_id(value: str | None) -> bool:
    """True for a well-formed NEAR named or implicit account id (shape only, never ownership)."""
    candidate = (value or "").strip()
    if not candidate:
        return False
    if _NEAR_IMPLICIT_RE.match(candidate):
        return True
    # A hex-only id is an implicit account by intent; only the exact 64-char form is valid.
    if _NEAR_HEX_ONLY_RE.match(candidate):
        return False
    return bool(_NEAR_NAMED_RE.match(candidate))


def parse_account_headers(
    x_account: str | None,
    x_owner: str | None,
    x_chain_id: str | None,
    x_auth_chain: str | None = None,
) -> AccountContext:
    """Parse + validate the §1.2 user-scoping headers into an ``AccountContext``.

    Rejects (ACCOUNT_HEADERS_INVALID, 400) when any header is missing/malformed, the
    chain id is unsupported, or account == owner (a smart account must differ from its
    owner EOA). This is a format/consistency gate; on-chain owner verification is a
    later, deeper check.
    """
    reasons: list[ErrorReason] = []
    auth_chain = (x_auth_chain or "evm").strip().lower()
    if auth_chain not in AUTH_CHAINS:
        reasons.append(
            ErrorReason("ACCOUNT_HEADERS_INVALID", f"X-Auth-Chain {auth_chain!r} unsupported.")
        )

    def _bad(message: str) -> None:
        reasons.append(ErrorReason("ACCOUNT_HEADERS_INVALID", message))

    if auth_chain == "near":
        if not _is_near_account_id(x_account):
            _bad("X-Account is missing or not a NEAR account id.")
        if not _is_near_account_id(x_owner):
            _bad("X-Owner is missing or not a NEAR account id.")
    else:
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

    # NOTE: account == owner is ACCEPTED (EOA-direct mode). Until the ERC-4337 AccountFactory
    # is deployed + the frontend derives each user's counterfactual SparkPointAccount (W6), the
    # connected EOA legitimately IS both the identity anchor and the owner. When AA accounts go
    # live, the account will be the CREATE2-derived address (≠ owner) — no gate change needed
    # then, since a differing account also passes here.

    if reasons:
        raise ApiError(
            ErrorCode.ACCOUNT_HEADERS_INVALID,
            "X-Account/X-Owner/X-Chain-Id are malformed or mismatched.",
            reasons=reasons,
        )

    assert x_account is not None and x_owner is not None  # noqa: S101 — guaranteed by the checks above
    return AccountContext(
        account=x_account, owner=x_owner, chain_id=chain_id, auth_chain=auth_chain
    )
