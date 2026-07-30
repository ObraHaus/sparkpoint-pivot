"""023 — assert the RPC actually serves the chain we think it does (FR-023-002/003).

The deterministic policy layer is correct, but it decides on a ``PolicyContext`` that THIS layer
gathers. Nothing previously compared the RPC's reported ``eth_chainId`` to the configured
``CHAIN_ID`` — the only ``eth_chainId`` read in the service was inside the simulator's own
healthcheck. Combined with the old cross-chain RPC fallback (closed in ``config.py``), a mainnet
deployment could read fork or Sepolia state while the built calldata targeted the mainnet vault:
a bundle approved against one chain's state and signed on another. ``evaluate()`` behaves perfectly
and still returns the wrong answer, which is exactly the class of bug no amount of gate-hardening
catches — so it is caught here instead, before any chain-dependent surface is served.

THREE states, not two — the distinction is load-bearing:

  - ``VERIFIED``  — the RPC reported exactly ``CHAIN_ID``. Serve normally.
  - ``MISMATCH``  — the RPC reported a DIFFERENT chain. A configuration error: it will not fix
                    itself, so the verdict LATCHES (no re-probe) and the surface fails closed until
                    the deployment is corrected and the process restarts.
  - ``UNKNOWN``   — the chain id could not be read (RPC down, timeout, garbled reply). A transient
                    condition: the surface still fails closed (we will not serve an unverified
                    chain), but the verdict is NOT latched and the next call past the TTL re-probes.

Conflating those two would be a defect in either direction: latching on a blip would take a healthy
deployment down until someone noticed, and re-probing a real mismatch forever would spam a
misconfigured RPC while quietly staying broken.

WHAT THIS DOES NOT DO (stated because an overstated guarantee is its own defect, Principle III):
this catches **misconfiguration**, not a hostile RPC. A provider that lies about ``eth_chainId``
defeats it entirely. The operator's choice of RPC provider is trusted here exactly as it already is
for every other read in this service; the threat being closed is "the wrong url was pasted into the
wrong environment", which is the realistic mainnet incident.

NON-CUSTODY (N1/N2/N3): read-only and keyless — one ``eth_chainId`` call, no key, no signature, no
state change. It gates only the advisory/derive surface: the frontend's direct-RPC exit path is
untouched, and ``/healthz`` keeps answering, so a mismatch can never trap funds (N2).

The RPC **url is never logged or interpolated into a message** (it can carry a provider key); only
chain ids, which are public facts, appear in logs and in the S2S ``/readyz`` breakdown.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from enum import Enum

from .vault_reader import JsonRpcTransport, VaultUnavailable, VaultUnavailableReason

logger = logging.getLogger(__name__)

#: How long a VERIFIED / UNKNOWN verdict is reused before re-probing. Mirrors the LLM-gateway probe
#: in ``api/main.py`` (~60s): long enough that this adds no meaningful per-request cost, short
#: enough that a recovered RPC is picked up promptly. MISMATCH ignores this — it latches.
PROBE_TTL_S = 60.0

#: Bound the probe so a hanging RPC cannot stall a request that would otherwise fail closed anyway.
PROBE_TIMEOUT_S = 5.0


class ChainIdentity(Enum):
    """The three outcomes of comparing the RPC's ``eth_chainId`` with the configured chain."""

    VERIFIED = "verified"
    MISMATCH = "mismatch"
    UNKNOWN = "unknown"

    @property
    def can_serve(self) -> bool:
        """True only when the chain is proven. UNKNOWN fails closed too: an unverified chain is not
        a safe basis for a policy decision, even though it may recover."""
        return self is ChainIdentity.VERIFIED


@dataclass
class ChainIdentityProbe:
    """A TTL-cached ``eth_chainId`` assertion for ONE (chain_id, transport) pair.

    Constructed per resolved config and cached by the caller, so a request costs at most one extra
    RPC round-trip per TTL window. Stateful by design — the latch is the point.
    """

    chain_id: int
    transport: JsonRpcTransport
    ttl_s: float = PROBE_TTL_S

    _verdict: ChainIdentity = ChainIdentity.UNKNOWN
    _checked_at: float = -1e9
    _observed: int | None = None

    @property
    def observed_chain_id(self) -> int | None:
        """The last chain id the RPC reported, or ``None`` if it has never been read."""
        return self._observed

    def _fresh(self, now: float) -> bool:
        return now - self._checked_at < self.ttl_s

    async def verdict(self) -> ChainIdentity:
        """The current verdict, re-probing only when it is neither latched nor fresh."""
        # A MISMATCH is a configuration error, not a transient one — never re-probe it.
        if self._verdict is ChainIdentity.MISMATCH:
            return self._verdict
        now = time.monotonic()
        # The sentinel ``_checked_at`` is far enough in the past that a never-probed instance is
        # never "fresh", so this one branch covers both first use and TTL expiry.
        if self._fresh(now):
            return self._verdict
        return await self._probe(now)

    async def _probe(self, now: float) -> ChainIdentity:
        self._checked_at = now
        try:
            raw = await self.transport.call("eth_chainId", [])
            observed = int(raw, 16)
        except (VaultUnavailable, ValueError, TypeError):
            # Transport failure or an unparseable reply — unverified, but recoverable.
            self._verdict = ChainIdentity.UNKNOWN
            logger.warning(
                "chain_identity_unknown configured=%s (rpc unreachable or unparseable reply)",
                self.chain_id,
            )
            return self._verdict
        self._observed = observed
        if observed == self.chain_id:
            self._verdict = ChainIdentity.VERIFIED
            return self._verdict
        self._verdict = ChainIdentity.MISMATCH
        # Chain ids only — the url may carry a provider key and must never reach a log line.
        logger.error(
            "chain_identity_mismatch configured=%s rpc_reports=%s — chain-dependent surface is "
            "failing closed; fix the RPC configuration and restart",
            self.chain_id,
            observed,
        )
        return self._verdict

    async def require_verified(self) -> None:
        """Raise :class:`VaultUnavailable` unless the chain is proven (the gate call site).

        Reuses the established fail-closed envelope carrier so every gated route already renders a
        canonical §1.5 response — no new exception type, no new handler.
        """
        verdict = await self.verdict()
        if verdict.can_serve:
            return
        if verdict is ChainIdentity.MISMATCH:
            raise VaultUnavailable(
                VaultUnavailableReason.CHAIN_MISMATCH,
                f"the configured RPC serves chain {self._observed}, not chain {self.chain_id} — "
                "refusing to read or build against the wrong chain",
            )
        raise VaultUnavailable(
            VaultUnavailableReason.RPC_UNREACHABLE,
            f"could not verify the RPC serves chain {self.chain_id}",
        )
