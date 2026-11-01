"""Preview + list orchestration for feature 069 (chat and HTTP surfaces share this).

A preview is a DRY 1Click quote (``oneclick_earn``), a same-chain deposit hint (``direct``) or an
Aurora Intents Connect step plan (``intents_connect``) — never a live quote, never a signature, and
never a transaction. Request handlers call this service; the service reads the in-memory snapshot
and never calls Morpho.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from ..coordinator.chat_blocks import EarnQuoteBlock, EarnVaultsBlock
from ..crosschain.addresses import placeholder_for
from ..crosschain.config import CrossChainAsset, CrossChainConfig
from ..crosschain.config import default_config as cc_config
from ..crosschain.oneclick import OneClickClient, QuoteUnavailable, deadline_at
from ..crosschain.service import amount_from_human
from .config import EarnConfig
from .parse import EarnRequest
from .rails import (
    FEE_NOTE,
    LIVE,
    NO_LIQUIDITY,
    RECEIPT_NOTE,
    RailResolution,
    ReceiptLivenessCache,
    default_liveness,
    resolve_rails,
)
from .registry import EarnRegistry, EarnSnapshot, VaultEntry

logger = logging.getLogger("sparkpoint_agent.earn.service")

SortKey = Literal["tvl", "apy"]
_UNKNOWN_SNAPSHOT = (
    "I don't have a Morpho vault snapshot yet. The registry refreshes in the background; "
    "nothing was signed or sent."
)
_NO_MATCH = "No Morpho vault matched those filters in the current snapshot."


@dataclass(frozen=True, slots=True)
class EarnOutcome:
    text: str
    block: EarnVaultsBlock | EarnQuoteBlock


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _usd(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"${value:,.0f}"


def _apy(entry: VaultEntry) -> str:
    return f"{entry.net_apy_percent}% net APY" if entry.net_apy_percent else "APY unavailable"


def _chain_label(config: EarnConfig, entry: VaultEntry) -> str:
    chain = config.chain(entry.chain)
    return chain.label if chain is not None else entry.chain


def _chain_label_for_key(config: EarnConfig, key: str) -> str:
    chain = config.chain(key)
    return chain.label if chain is not None else key


def _vault_summary_wire(
    config: EarnConfig,
    entry: VaultEntry,
    rails: RailResolution,
) -> dict[str, Any]:
    wire = entry.wire()
    wire["curatedDefault"] = config.default_vault(entry.chain) == entry.address.lower()
    wire["rails"] = rails.wire()
    return wire


def vault_wire(config: EarnConfig, entry: VaultEntry, rails: RailResolution) -> dict[str, Any]:
    return _vault_summary_wire(config, entry, rails)


class EarnService:
    """The registry + rails + 1Click client. Feature-gated; no method signs or takes custody."""

    def __init__(
        self,
        config: EarnConfig,
        registry: EarnRegistry,
        *,
        oneclick: OneClickClient | None = None,
        crosschain: CrossChainConfig | None = None,
        liveness: ReceiptLivenessCache | None = None,
        aurora_key: str | None = None,
    ) -> None:
        self.config = config
        self.registry = registry
        self.oneclick = oneclick or OneClickClient.from_env()
        self.crosschain = crosschain or cc_config()
        self.liveness = liveness or default_liveness()
        self._aurora_key = aurora_key

    @property
    def feature_enabled(self) -> bool:
        return self.config.feature_enabled

    # ── reads ──────────────────────────────────────────────────────────────────────────────────

    def _rails(self, entry: VaultEntry) -> RailResolution:
        return resolve_rails(
            self.config,
            entry,
            liveness=self.liveness,
            aurora_key=self._aurora_key,
        )

    def list_vaults(
        self,
        *,
        chain: str | None = None,
        asset: str | None = None,
        rail: str | None = None,
        min_tvl: Decimal | None = None,
        limit: int = 200,
        sort: SortKey = "tvl",
    ) -> tuple[list[dict[str, Any]], EarnSnapshot | None]:
        snapshot = self.registry.current()
        if snapshot is None:
            return [], None
        vaults: list[VaultEntry] = list(snapshot.vaults)
        if chain is not None:
            vaults = [entry for entry in vaults if entry.chain == chain]
        if asset is not None:
            wanted = asset.upper()
            vaults = [entry for entry in vaults if entry.asset.symbol.upper() == wanted]
        if min_tvl is not None:
            vaults = [entry for entry in vaults if (entry.tvl_usd or Decimal(0)) >= min_tvl]
        rows: list[tuple[VaultEntry, RailResolution]] = []
        for entry in vaults:
            resolved = self._rails(entry)
            if rail is not None and rail not in resolved.available:
                continue
            rows.append((entry, resolved))
        if sort == "apy":
            rows.sort(key=lambda item: item[0].net_apy or Decimal(-1), reverse=True)
        else:
            rows.sort(key=lambda item: item[0].tvl_usd or Decimal(0), reverse=True)
        return [_vault_summary_wire(self.config, e, r) for e, r in rows[:limit]], snapshot

    def get_vault(self, chain: str, address: str) -> tuple[dict[str, Any], EarnSnapshot] | None:
        snapshot = self.registry.current()
        if snapshot is None:
            return None
        wanted = address.lower()
        for entry in snapshot.vaults:
            if entry.chain == chain and entry.address.lower() == wanted:
                return _vault_summary_wire(self.config, entry, self._rails(entry)), snapshot
        return None

    def resolve_vault(self, chain: str | None, query: str | None) -> VaultEntry | None:
        snapshot = self.registry.current()
        if snapshot is None:
            return None
        target_chain = chain or "base"
        candidates = [entry for entry in snapshot.vaults if entry.chain == target_chain]
        if query:
            lowered = query.strip().lower()
            wanted = lowered.removesuffix(" vault").strip()
            for entry in candidates:
                if entry.address.lower() == lowered:
                    return entry
            matches = [entry for entry in candidates if wanted and wanted in entry.name.lower()]
            if matches:
                matches.sort(key=lambda item: item.tvl_usd or Decimal(0), reverse=True)
                return matches[0]
        default = self.config.default_vault(target_chain)
        if default:
            for entry in candidates:
                if entry.address.lower() == default:
                    return entry
        if candidates:
            candidates.sort(key=lambda item: item.tvl_usd or Decimal(0), reverse=True)
            return candidates[0]
        return None

    # ── chat list ─────────────────────────────────────────────────────────────────────────────

    def list_outcome(self, request: EarnRequest, *, limit: int = 5) -> EarnOutcome:
        vaults, snapshot = self.list_vaults(
            chain=request.chain,
            asset=request.asset,
            limit=limit,
            sort=request.sort,
        )
        if snapshot is None:
            return EarnOutcome(
                text=_UNKNOWN_SNAPSHOT,
                block=EarnVaultsBlock(state="unavailable", unavailable_reason="no snapshot"),
            )
        if not vaults:
            return EarnOutcome(
                text=_NO_MATCH,
                block=EarnVaultsBlock(
                    state="unavailable",
                    snapshot_age_minutes=snapshot.age_minutes(),
                    snapshot_source=self.registry.loaded_from,
                    unavailable_reason="no matching vaults",
                ),
            )
        block = EarnVaultsBlock(
            state="ready",
            vaults=tuple(vaults),
            snapshot_age_minutes=snapshot.age_minutes(),
            snapshot_source=self.registry.loaded_from,
            note=(
                "Morpho's vault list is data-driven. The 1Click receipt rail is shown only where a "
                "receipt is configured; a direct same-chain deposit gives the native vault share."
            ),
        )
        lines = [
            f"Here are the top Morpho vaults"
            f"{f' on {_chain_label_for_key(self.config, request.chain)}' if request.chain else ''}"
            f"{f' for {request.asset}' if request.asset else ''}, by "
            f"{'net APY' if request.sort == 'apy' else 'TVL'} (snapshot {snapshot.age_minutes()} "
            "min old):"
        ]
        for vault in vaults:
            rails = ", ".join(vault["rails"]["available"]) or "no enabled rail"
            lines.append(
                f"- {vault['name'] or vault['symbol'] or vault['address']} on "
                f"{vault['chain'].title()} — {vault['netApy'] or 'APY n/a'}% net APY, "
                f"{_usd(Decimal(vault['tvlUsd'])) if vault['tvlUsd'] else 'TVL n/a'} "
                f"({rails})"
            )
        lines.append("Nothing here is a transaction; pick a vault to see a dry preview.")
        return EarnOutcome(text="\n".join(lines), block=block)

    # ── chat/HTTP preview ─────────────────────────────────────────────────────────────────────

    async def preview_for(
        self,
        *,
        chain: str,
        address: str,
        origin_key: str,
        amount: Decimal,
        amount_raw: int | None = None,
    ) -> EarnOutcome:
        snapshot = self.registry.current()
        found = self.get_vault(chain, address) if snapshot is not None else None
        if found is None:
            raise ValueError("unknown Morpho vault")
        vault, _ = found
        entry = self._entry(chain, address)
        assert entry is not None  # noqa: S101 - get_vault just proved it
        rails = self._rails(entry)
        origin = self.crosschain.asset(origin_key) if origin_key else None

        # A same-chain origin takes the native ERC-4626 rail; a cross-chain origin must use the
        # 1Click receipt (the direct hint would be misleading about where the funds are).
        if "direct" in rails.available and (origin is None or origin.chain == entry.chain):
            return self._direct_preview(entry, vault, amount, origin_key)
        if "oneclick_earn" in rails.available:
            return await self._oneclick_preview(entry, vault, origin_key, amount, amount_raw)
        if "intents_connect" in rails.available:
            return self._intents_preview(entry, vault, rails)
        reasons = [
            rails.detail.get("direct", {}).get("reason"),
            rails.detail.get("oneclickEarn", {}).get("reason"),
            rails.detail.get("intentsConnect", {}).get("reason"),
        ]
        reason = next((item for item in reasons if item), "No enabled rail can reach this vault.")
        rail = rails.available[0] if rails.available else "direct"
        return self._unavailable(entry, vault, rail, reason)

    def _entry(self, chain: str, address: str) -> VaultEntry | None:
        snapshot = self.registry.current()
        if snapshot is None:
            return None
        wanted = address.lower()
        for entry in snapshot.vaults:
            if entry.chain == chain and entry.address.lower() == wanted:
                return entry
        return None

    def _direct_preview(
        self, entry: VaultEntry, vault: dict[str, Any], amount: Decimal, origin_key: str
    ) -> EarnOutcome:
        origin = self.crosschain.asset(origin_key) if origin_key else None
        if origin is not None and origin.chain != entry.chain:
            return self._unavailable(
                entry,
                vault,
                "direct",
                (
                    f"A direct deposit needs {entry.asset.symbol} on "
                    f"{_chain_label(self.config, entry)}; {origin_key} is on another chain."
                ),
            )
        human = _human(amount)
        text = (
            f"Preview only — nothing is signed or sent. On {_chain_label(self.config, entry)} "
            f"you can deposit {human} {entry.asset.symbol} into "
            f"{entry.name or entry.symbol} directly "
            "and receive the native Morpho vault share. This card carries no calldata; the deposit "
            "is a normal ERC-4626 call from your own wallet."
        )
        block = EarnQuoteBlock(
            state="preview",
            rail="direct",
            vault=vault,
            origin=origin.origin_wire(human) if origin is not None else None,
            amount_in=human,
            receipt_note=(
                "Direct same-chain deposit: you receive the native Morpho vault share, not a "
                "wrapped receipt."
            ),
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    async def _oneclick_preview(
        self,
        entry: VaultEntry,
        vault: dict[str, Any],
        origin_key: str,
        amount: Decimal,
        amount_raw: int | None,
    ) -> EarnOutcome:
        receipt = self.config.receipt_for_vault(entry.address)
        if receipt is None:  # pragma: no cover - rails proved a receipt exists
            return self._unavailable(entry, vault, "oneclick_earn", "No receipt configured.")
        origin = self.crosschain.asset(origin_key)
        if origin is None:
            raise ValueError("unknown origin asset")
        raw = amount_raw
        if raw is None:
            parsed = amount_from_human(_human(amount), origin.decimals)
            if parsed is None:
                raise ValueError("amount has too many decimal places")
            raw = parsed[1]
        try:
            quote = await self.oneclick.quote(
                dry=True,
                origin_asset=origin.asset_id,
                destination_asset=receipt.asset_id,
                amount=str(raw),
                slippage_bps=self.crosschain.slippage_bps,
                deadline=deadline_at(self.crosschain.deadline_minutes),
                refund_to=placeholder_for(origin.address_kind),
                recipient=placeholder_for("evm"),
            )
        except QuoteUnavailable as exc:
            self.liveness.set(receipt.asset_id, NO_LIQUIDITY)
            return self._unavailable(entry, vault, "oneclick_earn", exc.reason)
        self.liveness.set(receipt.asset_id, LIVE)
        fee_note = None if self.oneclick.has_api_key else FEE_NOTE
        eta = (
            f"about {max(1, round(quote.time_estimate_sec / 60))} min"
            if quote.time_estimate_sec
            else "a short time"
        )
        human = _human(amount)
        text = (
            f"Preview only — nothing is signed or sent. {human} {origin.symbol} on "
            f"{origin.chain_label} → about {quote.amount_out_formatted} {receipt.symbol} receipt, "
            f"settling in {eta}. {RECEIPT_NOTE}"
        )
        if fee_note:
            text = f"{text} {fee_note}"
        block = EarnQuoteBlock(
            state="preview",
            rail="oneclick_earn",
            vault=vault,
            origin=origin.origin_wire(human),
            amount_in=human,
            amount_out=quote.amount_out_formatted,
            amount_out_usd=quote.amount_out_usd,
            time_estimate_sec=quote.time_estimate_sec,
            fee_note=fee_note,
            receipt_note=RECEIPT_NOTE,
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    def _intents_preview(
        self, entry: VaultEntry, vault: dict[str, Any], rails: RailResolution
    ) -> EarnOutcome:
        steps = tuple(rails.detail.get("intentsConnect", {}).get("steps") or ())
        text = (
            f"Preview only — nothing is submitted or signed. Aurora Intents Connect can run "
            f"{len(steps)} EVM steps from an MPC intermediary to deposit {entry.asset.symbol} "
            f"into {entry.name or entry.symbol} on {_chain_label(self.config, entry)} "
            "and deliver the native Morpho share. The user address is filled in at execution time."
        )
        block = EarnQuoteBlock(
            state="preview",
            rail="intents_connect",
            vault=vault,
            steps=steps,
            receipt_note="Intents Connect delivers the native Morpho vault share.",
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    def _unavailable(
        self, entry: VaultEntry, vault: dict[str, Any], rail: str, reason: str
    ) -> EarnOutcome:
        text = f"I can't preview that vault right now: {reason} Nothing was signed or sent."
        block = EarnQuoteBlock(
            state="unavailable",
            rail=rail,
            vault=vault,
            unavailable_reason=reason,
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    async def list_outcome_from_message(self, request: EarnRequest) -> EarnOutcome:
        return self.list_outcome(request)


def _human(amount: Decimal) -> str:
    text = format(amount, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


_REGISTRY: EarnRegistry | None = None


def build_registry_from_env(config: EarnConfig | None = None) -> EarnRegistry:
    """The process-wide registry. Loads the snapshot file only; it never calls Morpho."""
    global _REGISTRY
    from .config import default_config

    if config is not None:
        return EarnRegistry(config)
    if _REGISTRY is None:
        _REGISTRY = EarnRegistry(default_config())
    return _REGISTRY


def build_service_from_env() -> EarnService | None:
    """The production service, or ``None`` when the flag is off."""
    from .config import default_config

    config = default_config()
    if not config.feature_enabled:
        return None
    return EarnService(config, build_registry_from_env())


def build_service_for_registry(
    config: EarnConfig, registry: EarnRegistry, *, oneclick: OneClickClient | None = None
) -> EarnService:
    return EarnService(config, registry, oneclick=oneclick)


__all__ = [
    "CrossChainAsset",
    "EarnOutcome",
    "EarnService",
    "build_registry_from_env",
    "build_service_for_registry",
    "build_service_from_env",
    "vault_wire",
]
