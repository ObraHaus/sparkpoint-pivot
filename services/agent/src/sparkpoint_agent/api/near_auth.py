"""076 — NEAR NEP-413 login nonce issuance/consumption (web-tier S2S only).

The web tier asks for a nonce before the wallet signs, then consumes it after the signature and
key checks succeed. Both routes are service-to-service (the middleware still requires the bearer)
but carry NO user identity yet — that is exactly what the signature establishes.

No transaction is built or sent here. This module only mints/consumes a random nonce.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db import get_database
from ..db.near_nonces import NearNonceStore

router = APIRouter(tags=["auth"])


def get_nonce_store() -> NearNonceStore:
    """The DB-backed nonce store. Overridden in tests."""
    return NearNonceStore(get_database())


class NonceResponse(BaseModel):
    nonce: str
    issuedAt: str
    expiresAt: str


class ConsumeRequest(BaseModel):
    nonce: str = Field(min_length=16, max_length=128)


class ConsumeResponse(BaseModel):
    ok: bool
    issuedAt: str | None = None
    expiresAt: str | None = None


@router.post("/auth/near/nonce", response_model=NonceResponse)
async def create_nonce(
    store: Annotated[NearNonceStore, Depends(get_nonce_store)],
) -> NonceResponse:
    """Issue a fresh single-use nonce for a NEAR login."""
    issued = await store.create()
    return NonceResponse(
        nonce=issued.nonce,
        issuedAt=issued.issued_at.isoformat(),
        expiresAt=issued.expires_at.isoformat(),
    )


@router.post("/auth/near/consume", response_model=ConsumeResponse)
async def consume_nonce(
    body: ConsumeRequest,
    store: Annotated[NearNonceStore, Depends(get_nonce_store)],
) -> ConsumeResponse:
    """Atomically consume a nonce. A second use, or an expired one, returns ``ok:false``."""
    issued = await store.consume(body.nonce)
    if issued is None:
        return ConsumeResponse(ok=False)
    return ConsumeResponse(
        ok=True, issuedAt=issued.issued_at.isoformat(), expiresAt=issued.expires_at.isoformat()
    )
