"""Feature 012 - SRK Premium subscriptions: record a verified payment + grant a time-boxed premium.

One transaction, idempotent on the payment tx hash (``payments.UNIQUE(network_id, tx_hash)`` is the
anti-replay control -- NOT the BFF idempotency cache). The grant REUSES the 008 tier engine
(``wallet_tier``, ``source='srk'``) and the 008 audit spine, so a purchased wallet
resolves ``premium`` via the existing ``LimitsStore.resolve_tier`` until ``expires_at``.

NON-CUSTODY (Constitution N1/N2): a subscription is an ADVISORY-COMPUTE entitlement only; it never
gates the vault or the withdraw/exit path, and this module holds no key and signs nothing.

Schema: ``migrations/0017_subscriptions.sql`` (payments, subscriptions, wallet_tier.expires_at).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from .limits import _ASSIGN_SQL, _AUDIT_SQL, _norm
from .pool import Database

#: Default Premium period, a Postgres calendar interval. Renewal EXTENDS: a second payment sets
#: ``expires_at = GREATEST(now(), current expiry) + DEFAULT_PERIOD`` (extend, not reset).
DEFAULT_PERIOD = "1 month"

_INSERT_PAYMENT_SQL = (
    "INSERT INTO payments (network_id, tx_hash, buyer, token, amount_raw, block_number) "
    "VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (network_id, tx_hash) DO NOTHING RETURNING id"
)

# Renewal math in SQL (DB clock): from the later of now() and the wallet's current
# *active* (future) expiry, then add the period. A lapsed/new wallet starts fresh from now().
#
# ⚠️ ``($2::text)::interval``, NOT ``$2::interval`` — with the bare cast Postgres types the
# PARAMETER itself as interval, and asyncpg then refuses to bind a Python str ("'str' object
# has no attribute 'days'"), raising DataError → the endpoint's 500. The double cast keeps the
# parameter text (asyncpg binds the str) and converts inside SQL, preserving CALENDAR-month
# semantics ('1 month' ≠ a fixed timedelta). This bug shipped with 012 Phase 0 and was caught
# by the FIRST real purchase ever made on alpha — the unit fakes accepted the str happily; the
# real driver did not (the mandate-key lesson, again: fakes must not be more permissive than
# the wire).
_NEW_EXPIRY_SQL = (
    "SELECT GREATEST(now(), COALESCE("
    "(SELECT expires_at FROM wallet_tier WHERE address = $1 "
    "AND expires_at IS NOT NULL AND expires_at > now()), now())) + ($2::text)::interval"
    " AS new_expiry"
)

_INSERT_SUB_SQL = (
    "INSERT INTO subscriptions (wallet, tier, expires_at, payment_tx_hash, amount_raw) "
    "VALUES ($1, 'premium', $2, $3, $4)"
)


class PaymentAlreadyRecorded(Exception):
    """The ``(network_id, tx_hash)`` was already banked -- a replay; no second grant is made."""

    def __init__(self, network_id: str, tx_hash: str) -> None:
        super().__init__(f"payment already recorded: {network_id}:{tx_hash}")
        self.network_id = network_id
        self.tx_hash = tx_hash


@dataclass
class SubscriptionStore:
    """Records a verified SRK payment and grants a time-boxed Premium in ONE transaction."""

    db: Database

    async def record_and_grant(
        self,
        *,
        buyer: str,
        tx_hash: str,
        network_id: str,
        token: str,
        amount_raw: int,
        block_number: int,
        period: str = DEFAULT_PERIOD,
    ) -> datetime:
        """Bank the payment, extend/open the sub, and grant premium. Returns the new expiry.

        Raises :class:`PaymentAlreadyRecorded` if the tx hash was already banked -- the unique
        payment row is the anti-replay control, so a replayed hash grants Premium zero more times.
        The payment insert, the ``subscriptions`` row, the ``wallet_tier`` grant, and the audit
        row all land in the SAME transaction (all-or-nothing).
        """
        b, th, tok = _norm(buyer), _norm(tx_hash), _norm(token)
        async with self.db.acquire() as conn, conn.transaction():
            payment_id = await conn.fetchval(
                _INSERT_PAYMENT_SQL, network_id, th, b, tok, amount_raw, block_number
            )
            if payment_id is None:  # ON CONFLICT DO NOTHING => no row => a replay
                raise PaymentAlreadyRecorded(network_id, th)

            new_expiry: datetime = await conn.fetchval(_NEW_EXPIRY_SQL, b, period)
            await conn.execute(_INSERT_SUB_SQL, b, new_expiry, th, amount_raw)
            # Grant via the 008 tier engine (source='srk', already allowed by the 0015 CHECK).
            await conn.execute(_ASSIGN_SQL, b, "premium", "srk", None, new_expiry)
            await conn.execute(
                _AUDIT_SQL,
                "grant",
                b,
                None,
                json.dumps(
                    {
                        "tier": "premium",
                        "source": "srk",
                        "tx_hash": th,
                        "expires_at": new_expiry.isoformat(),
                    }
                , ensure_ascii=False),
            )
            return new_expiry
