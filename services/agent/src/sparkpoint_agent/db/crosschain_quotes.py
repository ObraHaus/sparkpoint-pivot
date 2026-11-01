"""Durable live cross-chain quotes (migration 0044).

A row is written ONLY for a ``dry=false`` quote — the one that returns a 1Click deposit address.
It binds that address to the caller (``user_eoa``) so ``deposit/submit`` and ``status`` can prove
ownership without trusting a client-supplied address alone.

Non-custody: the row holds no key and no signature. ``quote_response`` is the 1Click response
(including its ed25519 quote signature) so the quote is auditable; nothing here can move funds.
The user still sends the origin transaction from their own wallet.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from .pool import Database

logger = logging.getLogger(__name__)

_INSERT = """
INSERT INTO crosschain_quotes (
    user_eoa, origin_key, destination_key, amount_in, deposit_address, deadline,
    quote_response, last_status
) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
RETURNING id, created_at
"""

_SELECT_OWNED = """
SELECT id, user_eoa, origin_key, destination_key, amount_in, deposit_address, deadline,
       quote_response, last_status, created_at
FROM crosschain_quotes
WHERE user_eoa = $1 AND deposit_address = $2
"""

_UPDATE_STATUS = """
UPDATE crosschain_quotes
SET last_status = $2
WHERE deposit_address = $1
RETURNING id
"""


def _row_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    raw = row["quote_response"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    return {
        "id": str(row["id"]),
        "owner": str(row["user_eoa"]),
        "originKey": str(row["origin_key"]),
        "destinationKey": str(row["destination_key"]),
        "amountIn": str(row["amount_in"]),
        "depositAddress": str(row["deposit_address"]),
        "deadline": row["deadline"].isoformat() if row["deadline"] is not None else None,
        "quoteResponse": raw,
        "lastStatus": row["last_status"],
        "createdAt": (row["created_at"].isoformat() if row["created_at"] is not None else None),
    }


class CrossChainQuoteStore:
    """asyncpg-backed store for live quotes (overridable in tests)."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def record(
        self,
        *,
        owner_eoa: str,
        origin_key: str,
        destination_key: str,
        amount_in: str,
        deposit_address: str,
        deadline: str | None,
        quote_response: Mapping[str, Any],
        last_status: str | None = None,
    ) -> dict[str, Any]:
        row = await self.db.fetchrow(
            _INSERT,
            owner_eoa.lower(),
            origin_key,
            destination_key,
            amount_in,
            deposit_address,
            deadline,
            json.dumps(quote_response, ensure_ascii=False, default=str),
            last_status,
        )
        return {
            "id": str(row["id"]) if row else None,
            "createdAt": (row["created_at"].isoformat() if row and row["created_at"] else None),
        }

    async def get_owned(self, owner_eoa: str, deposit_address: str) -> dict[str, Any] | None:
        """The caller's row for this deposit address, or ``None`` (ownership is the query)."""
        row = await self.db.fetchrow(_SELECT_OWNED, owner_eoa.lower(), deposit_address)
        return _row_to_dict(row) if row is not None else None

    async def update_status(self, deposit_address: str, status: str) -> None:
        await self.db.execute(_UPDATE_STATUS, deposit_address, status[:40])
