"""Feature 072 — the read-only multi-chain portfolio service.

Assembles five independent sources concurrently, each behind its own timeout and a short
per-owner cache. A section that fails becomes ``unavailable`` (or ``not_linked``) with a human
reason; the others still render. Nothing here signs, submits, holds a key, or writes to a database.

The session wallet is the only identity: callers pass the owner asserted by the middleware, and no
source accepts a client-supplied address. Kamino uses owner-bound Solana recipients only.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import replace
from datetime import UTC, datetime
from typing import Protocol

from ..config import AgentConfig
from ..crosschain.config import CrossChainConfig
from ..crosschain.config import default_config as crosschain_config
from ..crosschain.oneclick import OneClickClient
from ..db import CrossChainQuoteStore, get_database
from ..earn.config import EarnConfig
from ..earn.config import default_config as earn_default_config
from ..earn.service import EarnService, build_registry_from_env
from ..earn.service import build_service_from_env as build_earn_service_from_env
from .balances import BalanceSource
from .config import PortfolioConfig, config_from_env
from .kamino import KaminoPositionsSource
from .models import PortfolioFocus, PortfolioOverview, PortfolioSection
from .morpho import MorphoPositionsSource
from .pricing import PriceSource
from .rhea import RheaPositionsSource
from .swaps import QuoteStore, SwapHistorySource, linked_solana_addresses

logger = logging.getLogger("sparkpoint_agent.portfolio")


class SectionSource(Protocol):
    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection: ...


#: Truthful reason for the EVM-only sections when the signed-in owner is a NEAR account.
NEAR_NO_EVM_WALLET = "No EVM wallet is linked to this NEAR sign-in."
#: There is no NEAR wallet-token balance reader yet; say so rather than inventing a figure.
NEAR_BALANCES_NOT_READ = (
    "No EVM wallet is linked to this NEAR sign-in, and NEAR wallet balances are not read yet."
)


_SECTIONS: tuple[tuple[str, str, str], ...] = (
    ("balances", "Wallet balances", "rpc"),
    ("morpho", "Morpho", "morpho_api"),
    ("kamino", "Kamino", "solana_rpc"),
    ("rhea", "Rhea", "rhea_rpc"),
    ("swaps", "Cross-chain swaps", "db"),
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class MultichainPortfolioService:
    """The five-source portfolio read (no method signs or writes)."""

    def __init__(
        self,
        config: PortfolioConfig,
        *,
        balances: SectionSource,
        morpho: SectionSource,
        kamino: SectionSource,
        rhea: SectionSource,
        swaps: SectionSource,
    ) -> None:
        self.config = config
        self._sources: dict[str, SectionSource] = {
            "balances": balances,
            "morpho": morpho,
            "kamino": kamino,
            "rhea": rhea,
            "swaps": swaps,
        }
        self._cache: dict[str, tuple[float, PortfolioSection]] = {}
        self._monotonic = time.monotonic

    # -- cache -------------------------------------------------------------

    def _cached(self, key: str, wallet: str) -> PortfolioSection | None:
        ttl = self.config.cache_ttl_s
        if ttl <= 0:
            return None
        entry = self._cache.get(f"{key}:{wallet}")
        if entry is None:
            return None
        expires, section = entry
        if self._monotonic() >= expires:
            self._cache.pop(f"{key}:{wallet}", None)
            return None
        return section

    def _store(self, key: str, wallet: str, section: PortfolioSection) -> None:
        ttl = self.config.cache_ttl_s
        if ttl <= 0 or section.status == "unavailable":
            return
        self._cache[f"{key}:{wallet}"] = (self._monotonic() + ttl, section)

    # -- collection --------------------------------------------------------

    async def _collect(
        self, key: str, source: SectionSource, wallet: str, *, auth_chain: str = "evm"
    ) -> PortfolioSection:
        cached = self._cached(key, wallet)
        if cached is not None:
            return cached
        try:
            section = await asyncio.wait_for(
                source.collect(wallet)
                if auth_chain == "evm"
                else source.collect(wallet, auth_chain=auth_chain),
                timeout=self.config.timeout_s,
            )
        except TimeoutError:
            section = PortfolioSection(
                key=key,  # type: ignore[arg-type]
                label=next((label for name, label, _ in _SECTIONS if name == key), key.title()),
                status="unavailable",
                reason="The read timed out.",
                source=next((src for name, _, src in _SECTIONS if name == key), None),
            )
        except Exception as exc:  # noqa: BLE001 - one bad source never fails the response
            logger.warning("portfolio_section_failed section=%s err=%s", key, type(exc).__name__)
            section = PortfolioSection(
                key=key,  # type: ignore[arg-type]
                label=next((label for name, label, _ in _SECTIONS if name == key), key.title()),
                status="unavailable",
                reason="This section could not be read right now.",
                source=next((src for name, _, src in _SECTIONS if name == key), None),
            )
        section = replace(section, as_of=section.as_of or _now_iso())
        self._store(key, wallet, section)
        return section

    async def _read_near(self, owner: str, *, focus: PortfolioFocus) -> PortfolioOverview:
        """A NEAR sign-in has no EVM address: never hand its account id to an EVM reader.

        Balances/Morpho are EVM-only and become ``not_linked`` with an explicit reason. Kamino is
        Solana (linked-address bound, no EVM read) and swaps are an owner-scoped DB read, so both
        still run. Rhea uses the existing NEAR ``get_account_all_positions`` reader with the NEAR
        account id — the same view the EVM path uses after resolving an MCA.
        """
        keys = ("balances", "morpho", "kamino", "rhea", "swaps")
        balances = PortfolioSection(
            key="balances",
            label="Wallet balances",
            status="not_linked",
            reason=NEAR_BALANCES_NOT_READ,
            source="rpc",
        )
        morpho = PortfolioSection(
            key="morpho",
            label="Morpho",
            status="not_linked",
            reason=NEAR_NO_EVM_WALLET,
            source="morpho_api",
        )
        kamino, rhea, swaps = await asyncio.gather(
            self._collect("kamino", self._sources["kamino"], owner, auth_chain="near"),
            self._collect("rhea", self._sources["rhea"], owner, auth_chain="near"),
            self._collect("swaps", self._sources["swaps"], owner, auth_chain="near"),
        )
        by_key = {
            "balances": balances,
            "morpho": morpho,
            "kamino": kamino,
            "rhea": rhea,
            "swaps": swaps,
        }
        sections = tuple(
            replace(by_key[key], as_of=by_key[key].as_of or _now_iso()) for key in keys
        )
        return PortfolioOverview(
            wallet=owner,
            focus=focus,
            as_of=_now_iso(),
            sections=sections,
        )

    async def read(
        self,
        wallet: str,
        *,
        focus: PortfolioFocus = "all",
        auth_chain: str = "evm",
    ) -> PortfolioOverview:
        """Read every section concurrently and return one honest overview."""
        owner = wallet.strip()
        if auth_chain != "evm":
            return await self._read_near(owner, focus=focus)
        keys = [name for name, _, _ in _SECTIONS]
        results = await asyncio.gather(
            *(self._collect(key, self._sources[key], owner) for key in keys)
        )
        return PortfolioOverview(
            wallet=owner,
            focus=focus,
            as_of=_now_iso(),
            sections=tuple(results),
        )


def _quote_store() -> CrossChainQuoteStore | None:
    try:
        AgentConfig.from_env().require_database_url()
        return CrossChainQuoteStore(get_database())
    except Exception:  # noqa: BLE001 - no DB is a normal degraded state for this surface
        return None


def _earn_service(earn_config: EarnConfig) -> EarnService | None:
    service = build_earn_service_from_env()
    if service is not None:
        return service
    if earn_config.rhea.enabled:
        return EarnService(earn_config, build_registry_from_env(earn_config))
    return None


def build_service_from_env(
    *,
    config: PortfolioConfig | None = None,
    earn_config: EarnConfig | None = None,
    crosschain: CrossChainConfig | None = None,
    pricer: PriceSource | None = None,
    store: QuoteStore | None = None,
) -> MultichainPortfolioService:
    """Build the production service from the process environment (all sources fail-open)."""
    portfolio_config = config or config_from_env()
    earn_cfg = earn_config or earn_default_config()
    crosschain_cfg = crosschain or crosschain_config()
    quote_store = store if store is not None else _quote_store()

    if pricer is None:
        from ..data.prices import PriceService

        pricer = PriceService()

    earn_service = _earn_service(earn_cfg)
    registry = (
        earn_service.registry if earn_service is not None else build_registry_from_env(earn_cfg)
    )

    async def linked(owner: str) -> tuple[str, ...]:
        if quote_store is None:
            return ()
        try:
            rows = await quote_store.list_for_owner(owner, limit=200)
        except Exception:  # noqa: BLE001 - no linked address is an honest answer
            return ()
        return linked_solana_addresses(rows)

    return MultichainPortfolioService(
        portfolio_config,
        balances=BalanceSource(portfolio_config, pricer),
        morpho=MorphoPositionsSource(
            portfolio_config,
            registry=registry,
            earn_config=earn_cfg,
            pricer=pricer,
        ),
        kamino=KaminoPositionsSource(
            portfolio_config,
            earn_config=earn_cfg,
            registry=registry,
            linked=linked,
            pricer=pricer,
        ),
        rhea=RheaPositionsSource(earn_service),
        swaps=SwapHistorySource(
            quote_store,
            crosschain_cfg,
            oneclick=OneClickClient.from_env(),
            max_rows=portfolio_config.max_swaps,
            max_refresh=portfolio_config.max_status_refresh,
            refresh_status=portfolio_config.refresh_swap_status,
        ),
    )


__all__ = [
    "MultichainPortfolioService",
    "SectionSource",
    "build_service_from_env",
]
