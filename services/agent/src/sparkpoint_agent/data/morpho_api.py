"""Morpho GraphQL client for Vault V2 net APY (feature 024 Phase 4, T050).

ONE question, asked honestly: what is this vault's net APY right now — and if we cannot know, say
so rather than guess.

WHY `avgNetApy` AND NOT A COMPUTED FIGURE. Morpho's `avgNetApy` is already net of the ENTIRE fee
chain — the child's fees, our fee, and rewards — which is exactly what constitution IV.5 requires us
to disclose. Recomputing it from a gross rate minus fees we happen to know about would be less
accurate AND more likely to overstate, so we take theirs verbatim.

SCHEMA NOTE (introspected, not guessed). On `VaultV2` these fields are **top-level, NOT nested under
`state`** — unlike the V1/MetaMorpho shape most examples show. `performanceFee`/`managementFee` come
back as **FRACTIONS** (`0.25` means 25%), not bps and not WAD.

NEVER CALL THIS FROM A REQUEST HANDLER. The API is rate-limited and sustained abuse reportedly
triggers a long (reported: week-scale) cooldown, so a chatty read path would take the whole feed
down for everyone. The only caller is the background poller (`api/vault_apy_poller.py`, T051).

FAIL-OPEN, AND "UNAVAILABLE" IS A FIRST-CLASS ANSWER. Every failure path returns
``MorphoApyResult(source="unavailable", net_apy_bps=None)``. That is not a degraded mode to be
apologised for — on Base Sepolia it is the *correct and only* answer, because Morpho's API covers no
testnet at all and rejects chainId 84532 outright. Returning 0 would fabricate a yield figure
(Principle III, FR-013), and `0026`'s ``vault_apy_unavailable_is_null`` CHECK refuses to store it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Final

import httpx

logger = logging.getLogger("sparkpoint_agent.data.morpho_api")

_ENDPOINT: Final = "https://api.morpho.org/graphql"
_TIMEOUT_S: Final = 15.0

#: Chains Morpho's API actually serves. Base Sepolia (84532) and Robinhood testnet (46630) are
#: DELIBERATELY absent: the API's own chains list is all mainnets, and asking about a testnet gets a
#: hard rejection rather than an empty answer. Checking locally avoids spending rate-limit budget to
#: be told something we already know — which matters when the penalty for abuse is a long cooldown.
_SUPPORTED_CHAIN_IDS: Final[frozenset[int]] = frozenset(
    {1, 8453, 4663, 137, 42161, 10, 130, 747474}
)

#: Only the fields we actually disclose. Kept minimal on purpose — a wider query is a bigger blast
#: radius when Morpho evolves the schema, and every extra field is one more thing to keep honest.
_VAULT_V2_QUERY: Final = """
query VaultV2Apy($address: String!, $chainId: Int!) {
  vaultV2ByAddress(address: $address, chainId: $chainId) {
    address
    avgNetApy
    netApy
    performanceFee
    managementFee
    totalAssetsUsd
    liquidityUsd
  }
}
"""


@dataclass(frozen=True, slots=True)
class MorphoApyResult:
    """One APY reading, shaped for ``VaultRegistryStore.insert_apy_snapshot``.

    ``source`` is either ``"morpho_api"`` (we have a real figure) or ``"unavailable"`` (we do not,
    for any reason). Those are the only two values this module produces, and both are members of the
    ``vault_apy_source`` enum in `0026`. With ``source="unavailable"`` the CHECK in that migration
    requires ``net_apy_bps is None``, so the two fields can never disagree.
    """

    source: str
    net_apy_bps: int | None
    tvl_usd: str | None = None
    liquidity_usd: str | None = None
    #: The child's own fees in bps, for the stacked-fee disclosure (IV.5 / T052). None = unread.
    native_performance_fee_bps: int | None = None
    native_management_fee_bps: int | None = None
    #: Why the answer is unavailable, for logs and the admin surface. ``None`` on success.
    reason: str | None = None

    @property
    def is_available(self) -> bool:
        return self.source != "unavailable"


def unavailable(reason: str) -> MorphoApyResult:
    """The honest no-answer. Always ``net_apy_bps=None`` — never 0."""
    return MorphoApyResult(source="unavailable", net_apy_bps=None, reason=reason)


def chain_is_supported(chain_id: int) -> bool:
    """Whether Morpho's API serves ``chain_id`` at all. False for every testnet."""
    return chain_id in _SUPPORTED_CHAIN_IDS


def _fraction_to_bps(value: Any) -> int | None:
    """A Morpho fee/APY FRACTION (``0.25`` == 25%) → bps, rounded half-up. ``None`` if unusable.

    Morpho returns these as JSON numbers, so a float is unavoidable at the boundary; the rounding
    happens once, here, rather than drifting through the call chain. A negative APY is real (a vault
    CAN lose money) and is preserved rather than clamped — clamping to 0 would flatter the vault.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / inf — never store these
        return None
    # Guard absurd magnitudes rather than storing a number we would not display.
    if abs(f) > 100.0:  # >10000% — a schema change or a bad decode, not a real rate
        return None
    return int(f * 10_000 + (0.5 if f >= 0 else -0.5))


def _usd_str(value: Any) -> str | None:
    """A USD amount → the ``numeric(20,2)`` string the store expects. NEVER pass a float through."""
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")) or f < 0:
        return None
    if f >= 10.0**18:  # would overflow numeric(20,2)
        return None
    return f"{f:.2f}"


async def fetch_vault_v2_apy(*, address: str, chain_id: int) -> MorphoApyResult:
    """Read one Vault V2's net APY from Morpho's API. Never raises; never fabricates.

    Returns ``unavailable(...)`` for: an unsupported chain (every testnet), a transport error, a
    GraphQL error, a null vault (not indexed), or an unparseable rate.
    """
    if not chain_is_supported(chain_id):
        # The default path on Base Sepolia. Not an error, and not worth a request.
        return unavailable(f"morpho api does not serve chain {chain_id}")

    payload = {
        "query": _VAULT_V2_QUERY,
        "variables": {"address": address.lower(), "chainId": chain_id},
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            resp = await client.post(_ENDPOINT, json=payload)
            resp.raise_for_status()
            body = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("morpho_apy_fetch_failed chain=%s err=%s", chain_id, type(exc).__name__)
        return unavailable(f"transport: {type(exc).__name__}")

    if not isinstance(body, dict):
        return unavailable("malformed response")
    if body.get("errors"):
        # Includes the rate-limit rejection. Logged at warning so a cooldown is visible in ops.
        logger.warning("morpho_apy_graphql_errors chain=%s", chain_id)
        return unavailable("graphql errors")

    data = body.get("data")
    vault = data.get("vaultV2ByAddress") if isinstance(data, dict) else None
    if not isinstance(vault, dict):
        return unavailable("vault not indexed by morpho")

    # `avgNetApy` is the disclosure figure; `netApy` is the instantaneous fallback. Both are already
    # net of the whole fee chain, so neither needs adjusting by our own fee.
    net_bps = _fraction_to_bps(vault.get("avgNetApy"))
    if net_bps is None:
        net_bps = _fraction_to_bps(vault.get("netApy"))
    if net_bps is None:
        return unavailable("no usable apy field")

    return MorphoApyResult(
        source="morpho_api",
        net_apy_bps=net_bps,
        tvl_usd=_usd_str(vault.get("totalAssetsUsd")),
        liquidity_usd=_usd_str(vault.get("liquidityUsd")),
        native_performance_fee_bps=_fraction_to_bps(vault.get("performanceFee")),
        native_management_fee_bps=_fraction_to_bps(vault.get("managementFee")),
    )
