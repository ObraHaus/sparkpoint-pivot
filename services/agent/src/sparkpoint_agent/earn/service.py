"""Preview + list orchestration for features 069/070 (chat and HTTP surfaces share this).

A preview is a DRY 1Click quote (``oneclick_earn``), a same-chain deposit hint (``direct``) or an
Aurora Intents Connect step plan (``intents_connect``) — never a live quote, never a signature, and
never a transaction. Request handlers call this service; the service reads the in-memory snapshot
and never calls Morpho or Kamino.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from ..coordinator.chat_blocks import EarnPositionsBlock, EarnQuoteBlock, EarnVaultsBlock
from ..crosschain.addresses import placeholder_for
from ..crosschain.config import CrossChainAsset, CrossChainConfig
from ..crosschain.config import default_config as cc_config
from ..crosschain.oneclick import OneClickClient, QuoteUnavailable, deadline_at
from ..crosschain.service import amount_from_human
from .config import EarnConfig, addresses_equal
from .parse import EarnRequest
from .rails import (
    FEE_NOTE,
    LIVE,
    NATIVE_SHARES_NOTE,
    NO_LIQUIDITY,
    RECEIPT_NOTE,
    RHEA_NOTE,
    RailResolution,
    ReceiptLivenessCache,
    default_liveness,
    resolve_rails,
)
from .registry import EarnRegistry, EarnSnapshot, VaultEntry
from .rhea import (
    DRY_PLACEHOLDER_SIGNATURE,
    RheaRpcError,
    RheaViews,
    custom_recipient_msg,
    fee_string,
    human_string,
    mca_fee_amount,
    message_to_sign,
    parse_supplied_positions,
    percent_string,
    register_message,
    supply_message,
)
from .rhea_xchain import (
    RheaXchainDisabled,
    RheaXchainError,
    build_origin_transfer_plan,
    gate_wire,
    live_gate,
    withdraw_review,
    xchain_live_enabled,
)

logger = logging.getLogger("sparkpoint_agent.earn.service")

SortKey = Literal["tvl", "apy"]
_UNKNOWN_SNAPSHOT = (
    "I don't have an earn vault snapshot yet. The registry refreshes in the background; "
    "nothing was signed or sent."
)
_NO_MATCH = "No vault matched those filters in the current snapshot."


@dataclass(frozen=True, slots=True)
class EarnOutcome:
    text: str
    block: EarnVaultsBlock | EarnQuoteBlock | EarnPositionsBlock


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
    default = config.default_vault(entry.chain)
    wire["curatedDefault"] = bool(default and addresses_equal(default, entry.address))
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
        rhea_views: RheaViews | None = None,
    ) -> None:
        self.config = config
        self.registry = registry
        self.oneclick = oneclick or OneClickClient.from_env()
        self.crosschain = crosschain or cc_config()
        self.liveness = liveness or default_liveness()
        self._aurora_key = aurora_key
        self.rhea_views = rhea_views or RheaViews(config.rhea)
        # 079 — in-process ownership of live Rhea deposit addresses (read-only status). A
        # multi-instance deploy should move this to the crosschain_quotes store; documented in
        # the spec. Holds only public 0x addresses, never a key.
        self._xchain_deposits: dict[str, str] = {}

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
        protocol: str | None = None,
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
        if protocol is not None:
            wanted_protocol = protocol.lower()
            vaults = [entry for entry in vaults if entry.protocol == wanted_protocol]
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
        for entry in snapshot.vaults:
            if entry.chain == chain and addresses_equal(entry.address, address):
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
                if addresses_equal(entry.address, query.strip()):
                    return entry
            receipt = self.config.receipt_for_symbol(query.strip())
            if receipt is not None:
                for entry in candidates:
                    if addresses_equal(entry.address, receipt.underlying_vault):
                        return entry
            matches = [entry for entry in candidates if wanted and wanted in entry.name.lower()]
            if matches:
                matches.sort(key=lambda item: item.tvl_usd or Decimal(0), reverse=True)
                return matches[0]
            # Rhea requests name the ASSET ("deposit into Rhea USDC"), not a vault name.
            asset_matches = [
                entry for entry in candidates if wanted and entry.asset.symbol.lower() == wanted
            ]
            if asset_matches:
                asset_matches.sort(key=lambda item: item.tvl_usd or Decimal(0), reverse=True)
                return asset_matches[0]
        default = self.config.default_vault(target_chain)
        if default:
            for entry in candidates:
                if addresses_equal(entry.address, default):
                    return entry
        if candidates:
            candidates.sort(key=lambda item: item.tvl_usd or Decimal(0), reverse=True)
            return candidates[0]
        return None

    # ── chat list ─────────────────────────────────────────────────────────────────────────────

    def list_outcome(self, request: EarnRequest, *, limit: int = 5) -> EarnOutcome:
        protocol = getattr(request, "protocol", None)
        # A protocol-agnostic "what earn options do I have?" lists the top rows of every protocol
        # in the live registry (Kamino + Morpho + Rhea) instead of one protocol's vaults.
        combined = protocol is None and request.chain is None and request.asset is None
        combined_labels: list[str] = []
        if combined:
            snapshot = self.registry.current()
            vaults: list[dict[str, Any]] = []
            for name in ("morpho", "kamino", "rhea"):
                rows, _ = self.list_vaults(protocol=name, limit=2, sort=request.sort)
                if not rows:
                    continue
                combined_labels.append(name.title())
                for row in rows:
                    row = dict(row)
                    row["protocol"] = name
                    vaults.append(row)
        else:
            vaults, snapshot = self.list_vaults(
                chain=request.chain,
                asset=request.asset,
                protocol=protocol,
                limit=limit,
                sort=request.sort,
            )
        if snapshot is None:
            return EarnOutcome(
                text=_UNKNOWN_SNAPSHOT,
                block=EarnVaultsBlock(state="unavailable", unavailable_reason="no snapshot"),
            )
        if protocol == "rhea" and request.asset:
            # USDT (or any other Burrow market) is config-disabled: say so plainly instead of
            # leaking into the generic no-match copy.
            configured = self.config.rhea.asset_for_symbol(request.asset)
            if configured is None or not configured.enabled:
                symbol = request.asset.upper()
                return EarnOutcome(
                    text=(
                        f"Rhea Lending on NEAR is USDC only for now — {symbol} isn't enabled. "
                        "Tell me a USDC amount (for example 100 USDC) and I'll show a dry "
                        "deposit preview."
                    ),
                    block=EarnVaultsBlock(
                        state="unavailable",
                        snapshot_age_minutes=snapshot.age_minutes(),
                        snapshot_source=self.registry.loaded_from,
                        unavailable_reason=f"{symbol} is not enabled for Rhea",
                    ),
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

        protocol_label = {"kamino": "Kamino", "morpho": "Morpho", "rhea": "Rhea"}.get(
            protocol or "", ""
        )
        if combined:
            note = (
                "Kamino runs on Solana, Morpho on Base/Ethereum, and Rhea on NEAR. Each row "
                "lists the rails enabled for that vault; nothing here is a transaction."
            )
        elif protocol == "kamino":
            note = (
                "Kamino's vault list is data-driven. The 1Click rail uses a configured receipt "
                "whose underlying vault matches; the native kVault share is what the user receives."
            )
        elif protocol == "rhea":
            note = (
                "Rhea (Burrow) lending on NEAR is data-driven. The rate is the contract's "
                "supply APR (variable), read live; supply runs through 1Click into your Rhea "
                "account. USDC only for now. Withdraw on app.rhea.finance with the same wallet."
            )
        else:
            note = (
                "Morpho's vault list is data-driven. The 1Click receipt rail is shown only where "
                "a receipt is configured; a direct same-chain deposit gives the native vault share."
            )
        block = EarnVaultsBlock(
            state="ready",
            vaults=tuple(vaults),
            snapshot_age_minutes=snapshot.age_minutes(),
            snapshot_source=self.registry.loaded_from,
            note=note,
        )
        if combined:
            across = ", ".join(combined_labels) if combined_labels else "the live registry"
            lines = [
                f"Here are the top earn options across {across}, by "
                f"{'net APY' if request.sort == 'apy' else 'TVL'} "
                f"(snapshot {snapshot.age_minutes()} min old):"
            ]
        else:
            chain_label = _chain_label_for_key(self.config, request.chain) if request.chain else ""
            asset_label = f" for {request.asset}" if request.asset else ""
            lines = [
                f"Here are the top {protocol_label + ' ' if protocol_label else ''}vaults"
                f"{f' on {chain_label}' if chain_label else ''}{asset_label}, by "
                f"{'net APY' if request.sort == 'apy' else 'TVL'} "
                f"(snapshot {snapshot.age_minutes()} min old):"
            ]
        for vault in vaults:
            rails = ", ".join(vault["rails"]["available"]) or "no enabled rail"
            if combined:
                label = {"kamino": "Kamino", "morpho": "Morpho", "rhea": "Rhea"}.get(
                    str(vault.get("protocol") or "morpho"), "Morpho"
                )
                lines.append(
                    f"- {vault['name'] or vault['symbol'] or vault['address']} — {label} on "
                    f"{_chain_label_for_key(self.config, vault['chain'])} — "
                    f"{vault['netApy'] or 'APY n/a'}% net APY, "
                    f"{_usd(Decimal(vault['tvlUsd'])) if vault['tvlUsd'] else 'TVL n/a'} "
                    f"({rails})"
                )
            else:
                lines.append(
                    f"- {vault['name'] or vault['symbol'] or vault['address']} on "
                    f"{vault['chain'].title()} — {vault['netApy'] or 'APY n/a'}% net APY, "
                    f"{_usd(Decimal(vault['tvlUsd'])) if vault['tvlUsd'] else 'TVL n/a'} "
                    f"({rails})"
                )
        if protocol == "rhea":
            lines.append(
                "Rhea Lending is the supported NEAR yield — USDC only for now. Tell me an "
                "amount (for example 100 USDC) and I'll show a dry deposit preview."
            )
            lines.append("Source: Rhea's on-chain get_asset supply APR (variable).")
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
        recipient: str | None = None,
        wallet: str | None = None,
    ) -> EarnOutcome:
        snapshot = self.registry.current()
        found = self.get_vault(chain, address) if snapshot is not None else None
        if found is None:
            raise ValueError("unknown vault")
        vault, _ = found
        entry = self._entry(chain, address)
        assert entry is not None  # noqa: S101 - get_vault just proved it
        if entry.protocol == "rhea":
            return await self._rhea_preview(entry, vault, origin_key, amount, amount_raw, wallet)
        rails = self._rails(entry)
        origin = self.crosschain.asset(origin_key) if origin_key else None

        # A same-chain origin takes the native ERC-4626 rail; a cross-chain origin must use the
        # 1Click receipt (the direct hint would be misleading about where the funds are).
        if "direct" in rails.available and (origin is None or origin.chain == entry.chain):
            return self._direct_preview(entry, vault, amount, origin_key)
        if "oneclick_earn" in rails.available:
            return await self._oneclick_preview(
                entry, vault, origin_key, amount, amount_raw, recipient
            )
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
        for entry in snapshot.vaults:
            if entry.chain == chain and addresses_equal(entry.address, address):
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
        recipient: str | None = None,
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
        sol_receipt = receipt.chain == "sol"
        dry_probe = self.config.dry_probe_addresses.get("sol") or placeholder_for("sol")
        if sol_receipt:
            quote_recipient = recipient or dry_probe
            refund_to = (
                dry_probe if origin.address_kind == "sol" else placeholder_for(origin.address_kind)
            )
        else:
            quote_recipient = recipient or placeholder_for("evm")
            refund_to = placeholder_for(origin.address_kind)
        try:
            quote = await self.oneclick.quote(
                dry=True,
                origin_asset=origin.asset_id,
                destination_asset=receipt.asset_id,
                amount=str(raw),
                slippage_bps=self.crosschain.slippage_bps,
                deadline=deadline_at(self.crosschain.deadline_minutes),
                refund_to=refund_to,
                recipient=quote_recipient,
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
        native = receipt.receipt_kind == "native_shares"
        note = NATIVE_SHARES_NOTE if native else RECEIPT_NOTE
        label = "kV shares" if native else "receipt"
        text = (
            f"Preview only — nothing is signed or sent. {human} {origin.symbol} on "
            f"{origin.chain_label} → about {quote.amount_out_formatted} {receipt.symbol} "
            f"({label}), settling in {eta}. {note}"
        )
        if fee_note:
            text = f"{text} {fee_note}"
        wallet_support = (
            {
                "recipient": "paste_solana_address",
                "deposit": "evm_wallet" if origin.address_kind == "evm" else "copy_address",
            }
            if sol_receipt
            else None
        )
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
            receipt_note=note,
            receipt_kind="native_shares" if native else None,
            wallet_support=wallet_support,
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    async def _rhea_preview(
        self,
        entry: VaultEntry,
        vault: dict[str, Any],
        origin_key: str,
        amount: Decimal,
        amount_raw: int | None,
        wallet: str | None,
        *,
        dry: bool = True,
        signature: str | None = None,
    ) -> EarnOutcome:
        rhea = self.config.rhea
        if not rhea.enabled:
            return self._unavailable(
                entry, vault, "oneclick_rhea", "Rhea lending is disabled in the earn config."
            )
        if not wallet:
            raise ValueError("a signed-in wallet is required for a Rhea preview")
        asset = rhea.asset_for_token(entry.address)
        if asset is None:
            return self._unavailable(
                entry, vault, "oneclick_rhea", "That asset is not enabled for Rhea."
            )
        origin = self.crosschain.asset(origin_key) if origin_key else None
        if origin is None:
            raise ValueError("unknown origin asset")
        if not rhea.supports_origin(origin.key):
            return self._unavailable(
                entry,
                vault,
                "oneclick_rhea",
                f"{origin.chain_label} {origin.symbol} is not an enabled Rhea origin.",
            )
        raw = amount_raw
        if raw is None:
            parsed = amount_from_human(_human(amount), origin.decimals)
            if parsed is None:
                raise ValueError("amount has too many decimal places")
            raw = parsed[1]

        # 079 — a live (dry=false) commit is gated on the server flag AND key presence. The
        # key VALUE is never read here; only the client's boolean capability.
        if not dry:
            allowed, reason = live_gate(
                server_enabled=xchain_live_enabled(), key_present=self.oneclick.has_api_key
            )
            if not allowed:
                raise RheaXchainDisabled(reason or "Live cross-chain Rhea deposits are disabled.")

        # MCA + one-off fee. A lookup failure is fail-open: the preview still renders, assuming a
        # first deposit, and the text says the account read was unavailable.
        mca: str | None = None
        lookup_failed = False
        try:
            mca = await self.rhea_views.mca_for_wallet(wallet)
        except RheaRpcError:
            lookup_failed = True
        first_deposit = mca is None
        fee_amount = Decimal(0)
        one_time_fee: dict[str, Any] | None = None
        if first_deposit:
            try:
                fees = await self.rhea_views.create_mca_fee()
            except RheaRpcError:
                fees = {}
            fee_amount = mca_fee_amount(fees, asset, rhea.mca_fee_fallback)
            one_time_fee = {
                "amount": fee_string(fee_amount),
                "symbol": asset.symbol,
                "reason": "one-time Rhea account fee — first deposit only",
            }

        requires_signature = False
        if first_deposit:
            message_text: str | None = message_to_sign(wallet)
            if dry:
                message = register_message(wallet, DRY_PLACEHOLDER_SIGNATURE)
            elif signature and signature.strip():
                # The web obtained this from the user's own wallet ``personal_sign``; it is
                # off-chain auth, never a transaction. The agent still never signs.
                message = register_message(wallet, signature)
            else:
                # Live first deposit without the off-chain signature: return the review and ask
                # for it. Do NOT call 1Click with dry=false yet.
                requires_signature = True
                message = register_message(wallet, DRY_PLACEHOLDER_SIGNATURE)
        else:
            message = supply_message(wallet)
            message_text = None
        message_json = custom_recipient_msg(message)
        recipient = mca or rhea.am_contract
        refund_to = (
            wallet
            if origin.address_kind == "evm"
            else (
                self.config.dry_probe_addresses.get(origin.address_kind)
                or placeholder_for(origin.address_kind)
            )
        )
        quote = None
        if not requires_signature:
            try:
                quote = await self.oneclick.quote(
                    dry=dry,
                    origin_asset=origin.asset_id,
                    destination_asset=asset.asset_id,
                    amount=str(raw),
                    slippage_bps=self.crosschain.slippage_bps,
                    deadline=deadline_at(self.crosschain.deadline_minutes),
                    refund_to=refund_to,
                    recipient=recipient,
                    custom_recipient_msg=message_json,
                )
            except QuoteUnavailable as exc:
                self.liveness.set(entry.address, NO_LIQUIDITY)
                reason = exc.reason
                if "liquidity" in reason.lower() and "smaller" not in reason.lower():
                    reason = f"{reason} — try a smaller amount."
                return self._unavailable(entry, vault, "oneclick_rhea", reason)
            self.liveness.set(entry.address, LIVE)

        human = _human(amount)
        out_amount = _decimal(quote.amount_out_formatted) if quote is not None else None
        net = (out_amount - fee_amount) if out_amount is not None else None
        eta = (
            f"about {max(1, round(quote.time_estimate_sec / 60))} min"
            if quote is not None and quote.time_estimate_sec
            else "a short time"
        )
        deposit_address = (
            quote.deposit_address if quote is not None and not dry else None
        )
        transfer_plan: dict[str, Any] | None = None
        if not dry and not requires_signature:
            if not deposit_address:
                raise RheaXchainError(
                    "1Click did not return a deposit address for that live quote. Nothing was "
                    "signed or sent."
                )
            transfer_plan = build_origin_transfer_plan(
                asset=origin,
                wallet=wallet,
                deposit_address=deposit_address,
                amount_human=human,
                amount_raw=raw,
            )
            self._xchain_deposits[deposit_address.lower()] = wallet.lower()
        supply_apy = f"{entry.net_apy_percent}%" if entry.net_apy_percent else None
        source = {
            "kind": "contract",
            "contract": rhea.logic_contract,
            "method": "get_asset",
            "field": "supply_apr",
            "uiUrl": rhea.app_url,
            "fetchedAt": entry.fetched_at,
            "stale": self.registry.is_stale(),
        }
        fee_line = (
            f" A one-time {fee_string(fee_amount)} {asset.symbol} Rhea account fee applies on "
            "this first deposit."
            if first_deposit
            else ""
        )
        net_line = (
            f" Net supplied after the fee: {human_string(net)} {asset.symbol}."
            if first_deposit and net is not None
            else ""
        )
        if requires_signature:
            text = (
                "Live first-deposit review — nothing is signed or sent yet. Sign the message below "
                "in your own wallet (EVM personal_sign, off-chain) so I can prepare an unsigned "
                f"{origin.symbol} transfer from {origin.chain_label}.{fee_line} {RHEA_NOTE}"
            )
        elif dry:
            text = (
                f"Preview only — nothing is signed or sent. {human} {origin.symbol} on "
                f"{origin.chain_label} → about {out_amount} {asset.symbol} supplied to "
                f"Rhea Lending on NEAR, settling in {eta}.{fee_line}{net_line} {RHEA_NOTE}"
            )
        else:
            text = (
                f"Live quote prepared — no funds have moved. Send exactly {human} {origin.symbol} "
                f"on {origin.chain_label} to the 1Click deposit address using the unsigned "
                "transfer plan, confirmed from your own wallet; the agent never signs or sends. "
                f"About {out_amount} {asset.symbol} is then supplied to Rhea Lending on NEAR, "
                f"settling in {eta}.{fee_line}{net_line} {RHEA_NOTE}"
            )
        if supply_apy:
            text = f"{text} Supply APY {supply_apy} (Rhea, variable)."
        if lookup_failed:
            text = (
                f"{text} I couldn't read your Rhea account just now, so this preview assumes a "
                "first deposit."
            )
        block = EarnQuoteBlock(
            state="preview",
            rail="oneclick_rhea",
            vault=vault,
            origin=origin.origin_wire(human),
            amount_in=human,
            amount_out=quote.amount_out_formatted if quote is not None else None,
            amount_out_usd=quote.amount_out_usd if quote is not None else None,
            time_estimate_sec=quote.time_estimate_sec if quote is not None else None,
            fee_note=None if self.oneclick.has_api_key else FEE_NOTE,
            receipt_note=RHEA_NOTE,
            protocol="rhea",
            first_deposit=first_deposit,
            mca=mca,
            recipient=recipient,
            custom_recipient_msg=message_json,
            message_to_sign=message_text,
            one_time_fee=one_time_fee,
            net_supplied=human_string(net),
            supply_apy=supply_apy,
            source=source,
            withdraw={
                "kind": "external_link",
                "url": rhea.app_url,
                "note": "Withdraw on Rhea with the same wallet",
            },
            live=True if (not dry and not requires_signature) else None,
            deposit_address=deposit_address,
            transfer_plan=transfer_plan,
            requires_signature=True if requires_signature else None,
            quoted_at=_now_iso(),
        )
        return EarnOutcome(text=text, block=block)

    async def rhea_positions(self, *, wallet: str) -> EarnOutcome:
        """Read-only Rhea supply positions for the signed-in wallet (never a transaction)."""
        rhea = self.config.rhea
        if not rhea.enabled:
            return EarnOutcome(
                text="Rhea lending is not enabled on this deployment.",
                block=EarnPositionsBlock(
                    state="unavailable",
                    app_url=rhea.app_url,
                    unavailable_reason="Rhea lending is disabled in the earn config.",
                ),
            )
        if not wallet:
            raise ValueError("a signed-in wallet is required to read Rhea positions")
        source = {
            "kind": "contract",
            "contract": rhea.logic_contract,
            "method": "get_account_all_positions",
            "field": "supplied",
            "uiUrl": rhea.app_url,
            "fetchedAt": _now_iso(),
        }
        try:
            mca = await self.rhea_views.mca_for_wallet(wallet)
        except RheaRpcError:
            return EarnOutcome(
                text=(
                    "I couldn't read your Rhea account just now — nothing was signed or sent. "
                    f"You can check positions directly at {rhea.app_url}."
                ),
                block=EarnPositionsBlock(
                    state="unavailable",
                    app_url=rhea.app_url,
                    source=source,
                    unavailable_reason="The NEAR RPC read is unavailable right now.",
                ),
            )
        if mca is None:
            fee_asset = next(iter(rhea.enabled_assets()), None)
            fee_value = (
                mca_fee_amount({}, fee_asset, rhea.mca_fee_fallback)
                if fee_asset is not None
                else Decimal("0.30")
            )
            fee_symbol = fee_asset.symbol if fee_asset is not None else "USDC"
            explainer = (
                "You don't have a Rhea account yet. Your first deposit creates one (a one-time "
                f"{fee_string(fee_value)} {fee_symbol} fee) and starts earning on NEAR."
            )
            return EarnOutcome(
                text=(
                    "You don't have a Rhea account yet, so there are no positions to show. "
                    "Deposit into Rhea and your first supply creates the account — nothing was "
                    "signed or sent."
                ),
                block=EarnPositionsBlock(
                    state="empty",
                    mca=None,
                    app_url=rhea.app_url,
                    explainer=explainer,
                    source=source,
                ),
            )
        try:
            portfolio = await self.rhea_views.positions(mca)
        except RheaRpcError:
            return EarnOutcome(
                text=(
                    "I couldn't read your Rhea positions just now — nothing was signed or sent. "
                    f"You can check them directly at {rhea.app_url}."
                ),
                block=EarnPositionsBlock(
                    state="unavailable",
                    mca=mca,
                    app_url=rhea.app_url,
                    source=source,
                    unavailable_reason="The NEAR RPC read is unavailable right now.",
                ),
            )
        details: dict[str, Mapping[str, Any] | None] = {}
        for asset in rhea.enabled_assets():
            try:
                details[asset.token_id] = await self.rhea_views.asset(asset.token_id)
            except RheaRpcError:
                details[asset.token_id] = None
        rows = parse_supplied_positions(portfolio, rhea, details) if portfolio is not None else []
        if not rows:
            return EarnOutcome(
                text=(
                    f"No supplied Rhea positions found for {mca} yet. Nothing was signed or sent."
                ),
                block=EarnPositionsBlock(
                    state="empty",
                    mca=mca,
                    app_url=rhea.app_url,
                    explainer="No supplied positions were found for this Rhea account.",
                    source=source,
                ),
            )
        total = sum(
            (row.amount for row in rows if row.symbol.upper() in {"USDC", "USDT"}),
            Decimal(0),
        )
        lines = [f"Your Rhea positions on NEAR ({mca}) — read-only, nothing was signed or sent:"]
        for row in rows:
            apy = f", supply APY {percent_string(row.apy)}%" if row.apy is not None else ""
            lines.append(f"- {human_string(row.amount)} {row.symbol}{apy}")
        lines.append(f"Withdraw on Rhea with the same wallet: {rhea.app_url}")
        return EarnOutcome(
            text="\n".join(lines),
            block=EarnPositionsBlock(
                state="ready",
                mca=mca,
                supplied=tuple(row.wire() for row in rows),
                total_usd=human_string(total) if total > 0 else None,
                source=source,
                app_url=rhea.app_url,
                note=(
                    "Read-only view of your Rhea (Burrow) account. Supply/withdraw happen on "
                    "Rhea with the same wallet."
                ),
            ),
        )

    def rhea_withdraw_text(self) -> str:
        url = self.config.rhea.app_url
        return (
            f"To withdraw from Rhea, open {url} and connect the same wallet you supplied with. "
            "In-app Rhea withdrawals aren't enabled in this beta yet — nothing was signed or sent."
        )

    # ── 079 cross-chain Phase C (review + gated live commit, never signs) ─────────────────────

    def rhea_xchain_gate(self) -> dict[str, Any]:
        """Key-free gate metadata for the dual-access review UI."""
        return gate_wire(
            server_enabled=xchain_live_enabled(), key_present=self.oneclick.has_api_key
        )

    async def rhea_xchain_quote(
        self,
        *,
        chain: str,
        address: str,
        origin_key: str,
        amount: Decimal,
        amount_raw: int | None,
        wallet: str,
        dry: bool,
        signature: str | None = None,
    ) -> EarnOutcome:
        """A Rhea cross-chain review (``dry=true``) or a gated live commit (``dry=false``).

        The live path only *prepares* an unsigned origin ERC-20 transfer. It never signs,
        submits or broadcasts; the user's own wallet confirms the plan.
        """
        snapshot = self.registry.current()
        found = self.get_vault(chain, address) if snapshot is not None else None
        if found is None:
            raise ValueError("unknown vault")
        vault, _ = found
        entry = self._entry(chain, address)
        assert entry is not None  # noqa: S101 - get_vault just proved it
        if entry.protocol != "rhea":
            raise ValueError("not a Rhea vault")
        return await self._rhea_preview(
            entry,
            vault,
            origin_key,
            amount,
            amount_raw,
            wallet,
            dry=dry,
            signature=signature,
        )

    def rhea_xchain_withdraw_review(self) -> dict[str, Any]:
        """Honest withdraw review: link-out + documented Rhea SDK paths, no fake NEP-413 tx."""
        return withdraw_review(app_url=self.config.rhea.app_url)

    async def rhea_xchain_status(
        self, *, wallet: str, deposit_address: str
    ) -> dict[str, Any]:
        """Live 1Click status for a deposit address this process prepared for ``wallet``."""
        owner = self._xchain_deposits.get(deposit_address.strip().lower())
        if not wallet or owner != wallet.strip().lower():
            raise RheaXchainError(
                "That deposit address was not prepared for the signed-in wallet."
            )
        return dict(await self.oneclick.status(deposit_address=deposit_address))

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


def _decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        number = Decimal(value)
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


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
