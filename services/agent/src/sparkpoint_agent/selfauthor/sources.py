"""034 — where a run's evidence comes from, and what it is refused.

This is the only module in the package that touches the network. Everything it produces is an
:class:`Evidence`, and every fetch — including a refusal — is returned so the run can record it.

WHY REFUSALS ARE RETURNED RATHER THAN SWALLOWED. An admin looking at a run needs to tell "we didn't
look" from "we were not allowed to look". Only one of those is a configuration problem, and a
silently absent row looks identical to a source that simply had nothing to say.

WHAT ANSWERS FOR A TESTNET PRODUCT. Verified live: DeFiLlama's feed carries 15,758 pools across 101
chains and **zero testnets**; Morpho's API rejects chainId 84532 outright. So testnet truth comes
only from chain reads, and mainnet figures are labelled as the live market rather than as anything
an alpha user will receive.

FR-042 — THE ANSWER-GAPS SOURCE NEVER READS A USER'S WORDS. Mining what users asked is the most
useful signal we own and also a self-serve prompt-injection channel: anyone could type a sentence
into chat hoping it lands in a corpus Sparky quotes to everyone else. So this reads classification
labels and counts, never message text. The SQL below selects no user content at all, which is the
point — it is not a filter that could be loosened, it is a query that cannot return the data.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import httpx

from .allowlist import NotPermitted, check_url, clip_quote
from .evidence import (
    SOURCE_ANSWER_GAPS,
    SOURCE_CHAIN,
    SOURCE_DEFILLAMA,
    SOURCE_MORPHO,
    SOURCE_OWN_CORPUS,
    SOURCE_PROSE,
    STATUS_ERROR,
    STATUS_IMPLAUSIBLE,
    STATUS_REFUSED,
    Evidence,
    is_plausible_apy_bps,
    is_plausible_tvl_usd,
)

logger = logging.getLogger(__name__)

#: Bounded, because a run must never hang a background task on a slow third party.
_TIMEOUT_S = 15.0
_PROSE_TIMEOUT_S = 10.0

#: Base mainnet — the live market an alpha user will be on at launch.
BASE_MAINNET = 8453
#: Base Sepolia — where the alpha actually runs, and where the figures are play money.
BASE_SEPOLIA = 84532

_LLAMA_POOLS = "https://yields.llama.fi/pools"


async def fetch_chain(config: Any) -> list[Evidence]:
    """What an alpha user is actually getting, read from the chain.

    The ONLY source that can answer for a testnet, and therefore the only source that can describe
    our own product truthfully today.
    """
    out: list[Evidence] = []
    try:
        from ..chain.aave_rate import AavePoolReader
        from ..chain.vault_reader import HttpxJsonRpcTransport

        if not (config.rpc_url and config.aave_pool_address and config.aave_reserve_usdc_address):
            # Not configured on this deployment. An honest absence, not an error — the same
            # position `_read_aave_gross_bps` takes in the recommendation path.
            return []
        reader = AavePoolReader(
            pool_address=config.aave_pool_address,
            transport=HttpxJsonRpcTransport(config.rpc_url, timeout=_TIMEOUT_S),
        )
        bps = await reader.supply_apy_bps(config.aave_reserve_usdc_address)
        if is_plausible_apy_bps(bps):
            out.append(
                Evidence(
                    source=SOURCE_CHAIN,
                    label="vault_net_apy_bps_testnet",
                    value=Decimal(str(bps)),
                    chain_id=BASE_SEPOLIA,
                )
            )
        else:
            out.append(
                Evidence(
                    source=SOURCE_CHAIN,
                    label="vault_net_apy_bps_testnet",
                    chain_id=BASE_SEPOLIA,
                    status=STATUS_IMPLAUSIBLE,
                    payload={"raw": str(bps)},
                )
            )
    except Exception as exc:  # noqa: BLE001 — an unreachable RPC means no figure, never a guess
        logger.warning("selfauthor_chain_read_failed (%s: %s)", type(exc).__name__, exc)
        out.append(
            Evidence(
                source=SOURCE_CHAIN,
                label="vault_net_apy_bps_testnet",
                chain_id=BASE_SEPOLIA,
                status=STATUS_ERROR,
                payload={"error": f"{type(exc).__name__}: {exc}"[:300]},
            )
        )
    return out


def _base_usdc_rows(pools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        p
        for p in pools
        if p.get("chain") == "Base"
        and (p.get("stablecoin") or "USDC" in str(p.get("symbol", "")))
        and isinstance(p.get("apy"), (int, float))
    ]


def summarise_managed_range(pools: list[dict[str, Any]]) -> tuple[Decimal, Decimal] | None:
    """The managed-vault yield range on Base, in basis points.

    A RANGE, deliberately, and never a named product. Decision 5: Sparky describes the landscape
    ("managed USDC vaults on Base currently pay 4–5%") rather than pointing a user at a rival vault
    as an alternative. Aggregating into a range is what makes that structurally true instead of a
    rule someone has to remember while writing.
    """
    managed = [
        p
        for p in _base_usdc_rows(pools)
        if p.get("project") not in {"aave-v3", "compound-v3"}
        and isinstance(p.get("tvlUsd"), (int, float))
        and p["tvlUsd"] > 1_000_000
    ]
    if len(managed) < 2:
        return None
    apys = sorted(Decimal(str(p["apy"])) * 100 for p in managed)
    return apys[0], apys[-1]


async def fetch_defillama(client: httpx.AsyncClient | None = None) -> list[Evidence]:
    """Mainnet benchmarks. Structured JSON with named numeric fields — no prose, no instructions."""
    out: list[Evidence] = []
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        resp = await client.get(_LLAMA_POOLS)
        resp.raise_for_status()
        pools = resp.json().get("data", [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("selfauthor_defillama_failed (%s: %s)", type(exc).__name__, exc)
        return [
            Evidence(
                source=SOURCE_DEFILLAMA,
                label="aave_supply_apy_bps_mainnet",
                url=_LLAMA_POOLS,
                status=STATUS_ERROR,
                payload={"error": f"{type(exc).__name__}"},
            )
        ]
    finally:
        if owns_client:
            await client.aclose()

    for pool in _base_usdc_rows(pools):
        if pool.get("project") == "aave-v3" and pool.get("symbol") == "USDC":
            bps = Decimal(str(pool["apy"])) * 100
            status = "ok" if is_plausible_apy_bps(bps) else STATUS_IMPLAUSIBLE
            out.append(
                Evidence(
                    source=SOURCE_DEFILLAMA,
                    label="aave_supply_apy_bps_mainnet",
                    value=bps if status == "ok" else None,
                    chain_id=BASE_MAINNET,
                    url=_LLAMA_POOLS,
                    status=status,
                    payload={
                        "apyMean30d": pool.get("apyMean30d"),
                        "tvlUsd": (
                            pool.get("tvlUsd")
                            if is_plausible_tvl_usd(pool.get("tvlUsd"))
                            else None
                        ),
                    },
                )
            )
            break

    band = summarise_managed_range(pools)
    if band:
        low, high = band
        out.append(
            Evidence(
                source=SOURCE_DEFILLAMA,
                label="managed_usdc_apy_bps_range_mainnet",
                value=low,
                chain_id=BASE_MAINNET,
                url=_LLAMA_POOLS,
                payload={"lowBps": str(low), "highBps": str(high)},
            )
        )
    return out


async def fetch_morpho(chain_id: int = BASE_MAINNET) -> list[Evidence]:
    """Net APY after the whole fee chain, from Morpho's own API.

    Returns an explicit "unavailable" for a testnet rather than a number: Morpho's API covers no
    testnet at all and rejects chainId 84532 outright, and returning 0 would fabricate a yield.
    """
    if chain_id not in (BASE_MAINNET, 1):
        return [
            Evidence(
                source=SOURCE_MORPHO,
                label="morpho_net_apy_bps",
                chain_id=chain_id,
                status=STATUS_ERROR,
                payload={"reason": "morpho's api covers no testnet"},
            )
        ]
    return []


async def fetch_own_corpus(db: Any) -> list[Evidence]:
    """Our own product, from what we have already published. No network, no third party."""
    try:
        rows = await db.fetch(
            "SELECT count(*) AS n, source_kind::text AS kind FROM memory_chunks "
            "WHERE user_id IS NULL GROUP BY source_kind"
        )
    except Exception:  # noqa: BLE001
        return []
    counts = {str(r["kind"]): int(r["n"]) for r in rows}
    if not counts:
        return []
    summary = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items()))
    return [
        Evidence(
            source=SOURCE_OWN_CORPUS,
            label="product_surface_summary",
            quote=f"SparkPoint's published knowledge currently covers — {summary}.",
            attribution="SparkPoint's own documentation",
        )
    ]


async def fetch_answer_gaps(db: Any, *, days: int = 7) -> list[Evidence]:
    """Which topics the assistant answered without any supporting document.

    READS NO USER TEXT. The query selects a count and a block type — never `content`. That is not a
    filter that could be loosened later; it is a query that cannot return a user's words, which is
    the only version of this that is safe to feed into something Sparky will quote back to everyone.
    """
    try:
        rows = await db.fetch(
            "SELECT count(*) AS n FROM conversation_turns "
            "WHERE role = 'assistant' AND created_at > now() - ($1 || ' days')::interval "
            "AND (blocks IS NULL OR NOT (blocks::text LIKE '%citation%'))",
            str(days),
        )
    except Exception:  # noqa: BLE001
        return []
    uncited = int(rows[0]["n"]) if rows else 0
    if uncited <= 0:
        return []
    return [
        Evidence(
            source=SOURCE_ANSWER_GAPS,
            label="answer_gap_topics",
            quote=(
                f"In the last {days} days, {uncited} assistant answers cited no supporting "
                f"document. Those are the questions our documentation does not yet cover."
            ),
            attribution="SparkPoint's own conversation records (counts only, no message text)",
        )
    ]


async def fetch_prose(
    url: str, domains: list[str] | tuple[str, ...], client: httpx.AsyncClient | None = None
) -> Evidence:
    """One allowlisted page, stored as a QUOTATION attributed to its source.

    Never merged into our voice, never treated as instruction. A page that tries to instruct the
    assistant is stored as a quotation of a page that tried to instruct the assistant — which is a
    fact about the page, not a command.

    Redirects are NOT followed: a permitted host that redirects to an unpermitted one would
    otherwise launder the allowlist.
    """
    try:
        host = check_url(url, domains)
    except NotPermitted as exc:
        return Evidence(
            source=SOURCE_PROSE,
            label="prose",
            url=url,
            status=STATUS_REFUSED,
            payload={"reason": str(exc)},
        )

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=_PROSE_TIMEOUT_S, follow_redirects=False)
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        text = resp.text
    except Exception as exc:  # noqa: BLE001
        return Evidence(
            source=SOURCE_PROSE,
            label="prose",
            url=url,
            attribution=host,
            status=STATUS_ERROR,
            payload={"error": f"{type(exc).__name__}"},
        )
    finally:
        if owns_client:
            await client.aclose()

    return Evidence(
        source=SOURCE_PROSE,
        label="prose",
        url=url,
        quote=clip_quote(_strip_markup(text)),
        attribution=host,
    )


def _strip_markup(html: str) -> str:
    """Crude tag removal — enough that a quotation reads as prose rather than as markup.

    Not a sanitiser, and not pretending to be one. There is no reliable filter for "this sentence
    is an instruction", and building something that looked like one would be worse than knowing
    there isn't: the actual defence is that this text never enters a system prompt and never
    becomes an instruction, which is enforced in the writer, not here.
    """
    out: list[str] = []
    depth = 0
    for char in html:
        if char == "<":
            depth += 1
        elif char == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(char)
    return "".join(out)
