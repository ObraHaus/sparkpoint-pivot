"""Which Sparky Brokers a wallet holds (feature 044).

`SparkyBroker` is solady ERC-721 and **not enumerable**, so a wallet's brokers cannot be read from
the contract. The web app currently checks ownership of ids `1..totalMinted` one by one — fine at
single digits, impossible at 10,000. This endpoint answers the same question from `Transfer` logs
instead, so the gallery stops scaling with the size of the collection.

**Read-only, advisory, and off every value path.** Nothing here gates a withdraw or an exit
(constitution N2), nothing it returns is signable, and it writes nothing. A wrong answer shows the
wrong gallery; it cannot move money.

⚠️ **"Could not read the chain" and "you own nothing" are different answers and must stay
different.** An empty gallery rendered for an unreadable RPC tells a holder their brokers are gone.
The ledger returns ``None`` for the first case and this route turns that into an explicit
``available: false``, never an empty list.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from ..chain.broker_ledger import BrokerLedger, build_broker_ledger_from_env
from .security import AccountContext

logger = logging.getLogger(__name__)

router = APIRouter(tags=["brokers"])

#: Built once. ``None`` when unconfigured, which the route reports honestly rather than hiding.
_ledger: BrokerLedger | None = None
_built = False


def get_ledger() -> BrokerLedger | None:
    global _ledger, _built
    if not _built:
        _ledger = build_broker_ledger_from_env()
        _built = True
        if _ledger is None:
            logger.info("broker ledger unconfigured; /brokers/owned will report unavailable")
    return _ledger


def get_optional_account(request: Request) -> AccountContext | None:
    """The caller's scoping identity, or ``None`` when it could not be parsed.

    `/brokers/owned` is an advisory gallery read. Auth is still enforced by the middleware; this
    only lets an unsupported chain or a missing chain header answer ``available: false`` instead
    of a 400 that every broker surface would then log as a broken network call (061 A9).
    """
    account = getattr(request.state, "account", None)
    return account if isinstance(account, AccountContext) else None


@router.get("/brokers/owned")
async def owned(
    account: Annotated[AccountContext | None, Depends(get_optional_account)],
) -> dict[str, Any]:
    """Token ids the CALLER holds. Scoped to the authenticated wallet — never a query parameter.

    Taking the address from the session rather than the URL keeps this from becoming a free
    ownership-lookup surface for arbitrary wallets, which is not something the gallery needs.

    ⚠️ Keys on ``account.owner`` — the signer EOA — because that is the wallet ``resolve_tier`` and
    ``broker_gate`` already key on. Using a different one here would let the gallery and the Premium
    badge disagree about the same holder.
    """
    if account is None:
        # No identity to scope by: never an empty list (that would read as "you own nothing").
        return {"available": False, "reason": "no-account", "tokenIds": []}

    ledger = get_ledger()
    if ledger is None:
        return {"available": False, "reason": "unconfigured", "tokenIds": []}

    try:
        ids = await ledger.tokens_owned_by(account.owner)
    except Exception:  # noqa: BLE001 - the gallery degrades; it never 500s over a read
        logger.warning("broker ledger raised despite its no-raise contract", exc_info=True)
        ids = None

    if ids is None:
        # NOT an empty list. See the module docstring: an unreadable chain rendered as "you own
        # nothing" is the one failure this endpoint must not produce.
        return {"available": False, "reason": "chain-unreadable", "tokenIds": []}

    return {"available": True, "tokenIds": ids}
