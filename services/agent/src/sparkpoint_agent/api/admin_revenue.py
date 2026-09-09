"""Admin-gated REAL revenue by stream (feature 013, US1) — replaces the mock ``/admin/revenue``.

Three real streams, each resolved in its OWN ``try/except`` so one dead source degrades ONLY its
own stream to ``configured:false`` and never blanks the others (FR-002 / D1):

  * **swap**    — the 0.20% routing fee, from the ``swap_fee_events`` ledger (0018) the background
                  indexer fills (``from == router`` fees only; native-ETH gap disclosed).
  * **perf**    — the 10% performance fee, folded VERBATIM from ``FeeIndexer.revenue_summary`` over
                  the existing ``fee_events`` (no divergent re-derivation — SC-006).
  * **premium** — SRK membership, ``SUM(payments.amount_raw)`` over feature 012's ``payments``
                  (a row exists iff verified — 012's ``UNIQUE(network_id, tx_hash)``).

Provable-Not-Promised (Constitution III): every figure is base units sourced from a real ledger — no
USD is fabricated, no projection is emitted, and a live-but-empty stream returns a REAL ``0``
(``configured:true``) distinct from ``configured:false`` (FR-005 / D2). Admin-gated (404 to a
non-admin — SC-010). DISPLAY-ONLY; never the withdraw/exit path (N2, FR-020).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from ..data.fee_indexer import FeeIndexer, PgFeeEventStore
from ..db.pool import get_database
from ..db.swap_fees import PgSwapFeeEventStore
from .allowlist import require_admin
from .security import AccountContext

router = APIRouter(tags=["admin-revenue"])


@dataclass(frozen=True)
class _Net:
    """A revenue network: which streams apply. Base has the vault + Premium; 46630 = swap only."""

    network_id: str
    chain_id: int
    label: str
    has_vault: bool
    has_membership: bool


#: The networks revenue is reported for, in order. `base` = Base Sepolia on develop (84532);
#: `robinhood` (46630) has NO vault + NO Premium, so only its swap-routing fee is a revenue stream —
#: its perf/premium honest-degrade to `configured:false` (not-applicable), never a fabricated zero.
_NETWORKS: tuple[_Net, ...] = (
    _Net("base", 84532, "Base Sepolia", has_vault=True, has_membership=True),
    _Net("robinhood", 46630, "Robinhood Testnet", has_vault=False, has_membership=False),
)

_SWAP_NATIVE_ETH_DISCLOSURE = (
    "Native-ETH-out swaps take the fee via unwrapWETH9WithFee, which emits no ERC-20 Transfer "
    "log — those fees are not yet indexed, so this figure is a lower bound."
)
_SWAP_MIXED_DENOM_DISCLOSURE = (
    "Fees were collected in output tokens of differing precision; the base-unit total mixes "
    "denominations — read each period with its token decimals."
)
_PERF_UNIT_DISCLOSURE = (
    "Performance-fee revenue is the fee shares minted to the fee recipient (spkUSDC, 6-dp) — "
    "the fee is taken as share dilution, never on principal; ≈ its USDC value at/above the HWM."
)


def _stream(
    configured: bool,
    *,
    cumulative_raw: int = 0,
    token_decimals: int | None = None,
    periods: list[dict[str, Any]] | None = None,
    disclosures: list[str] | None = None,
) -> dict[str, Any]:
    """One stream's wire shape. Raw amounts are STRINGS (uint256-safe; JS BigInt-parses them)."""
    return {
        "configured": configured,
        "cumulativeRaw": str(cumulative_raw),
        "tokenDecimals": token_decimals,
        "periods": periods or [],
        "disclosures": disclosures or [],
    }


async def _swap_stream(db: Any, network_id: str) -> dict[str, Any]:
    try:
        summary = await PgSwapFeeEventStore(db).revenue_summary(network_id, period="month")
        disclosures = [_SWAP_NATIVE_ETH_DISCLOSURE]
        if summary.distinct_token_decimals > 1:
            disclosures.append(_SWAP_MIXED_DENOM_DISCLOSURE)
        return _stream(
            True,
            cumulative_raw=summary.cumulative_fee_raw,
            token_decimals=summary.token_decimals,
            periods=[
                {"periodStart": b.period_start.date().isoformat(), "valueRaw": str(b.fee_value_raw)}
                for b in summary.periods
            ],
            disclosures=disclosures,
        )
    except Exception:  # noqa: BLE001 — a dead source degrades ONLY this stream (D1)
        return _stream(False)


async def _perf_stream(db: Any, vault: str | None, network_id: str) -> dict[str, Any]:
    try:
        if not vault:
            return _stream(False)
        summary = await FeeIndexer(PgFeeEventStore(db)).revenue_summary(
            network_id, vault, period="month"
        )
        return _stream(
            True,
            cumulative_raw=summary.cumulative_fee_shares_minted_raw,
            token_decimals=6,  # spkUSDC shares == asset (USDC) decimals (OZ ERC4626, no offset)
            periods=[
                {
                    "periodStart": b.period_start.date().isoformat(),
                    "valueRaw": str(b.fee_shares_minted_raw),
                }
                for b in summary.periods
            ],
            disclosures=[_PERF_UNIT_DISCLOSURE],
        )
    except Exception:  # noqa: BLE001
        return _stream(False)


async def _premium_stream(db: Any, network_id: str) -> dict[str, Any]:
    try:
        rows = await db.fetch(
            """
            SELECT date_trunc('month', verified_at) AS period_start,
                   SUM(amount_raw)::text          AS total,
                   COUNT(*)                        AS n
            FROM payments
            WHERE network_id = $1
            GROUP BY 1
            ORDER BY 1
            """,
            network_id,
        )
        periods = [
            {"periodStart": r["period_start"].date().isoformat(), "valueRaw": str(int(r["total"]))}
            for r in rows
        ]
        cumulative = sum(int(r["total"]) for r in rows)
        return _stream(
            True,
            cumulative_raw=cumulative,
            token_decimals=18,  # SRK
            periods=periods,
            disclosures=[],
        )
    except Exception:  # noqa: BLE001 — 012 not landed / table absent → configured:false (D9)
        return _stream(False)


def get_revenue_database() -> Any:
    """The DB handle for the revenue reads — injectable so tests can drive it with a fake."""
    return get_database()


def get_perf_vault_address() -> str | None:
    """The vault whose fee_events feed perf — injectable; fail-closed to None on error."""
    try:
        from ..config import AgentConfig

        return AgentConfig.from_env().vault_address
    except Exception:  # noqa: BLE001 — no vault configured → perf stream honest-degrades
        return None


@router.get("/admin/revenue/summary")
async def revenue_summary(
    admin: Annotated[AccountContext, Depends(require_admin)],
    db: Annotated[Any, Depends(get_revenue_database)],
    vault: Annotated[str | None, Depends(get_perf_vault_address)],
) -> dict[str, Any]:
    """Real revenue by NETWORK, then by stream — each honest about its own state (admin-gated).

    A stream that does not apply to a network (perf/premium on 46630) is `configured:false`, NOT a
    fabricated zero; swap fees are attributed by `network_id` so a Base fee is never counted on
    Robinhood or vice-versa. No cross-network total is emitted (streams are in different tokens).
    """
    networks: list[dict[str, Any]] = []
    for net in _NETWORKS:
        networks.append(
            {
                "networkId": net.network_id,
                "chainId": net.chain_id,
                "label": net.label,
                "swap": await _swap_stream(db, net.network_id),
                "perf": (
                    await _perf_stream(db, vault, net.network_id)
                    if net.has_vault
                    else _stream(False)
                ),
                "premium": (
                    await _premium_stream(db, net.network_id)
                    if net.has_membership
                    else _stream(False)
                ),
            }
        )
    return {"networks": networks}
