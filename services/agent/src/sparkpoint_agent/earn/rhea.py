"""Rhea Finance (Burrow) lending on NEAR — feature 071.

Read-only NEAR JSON-RPC ``query``/``call_function`` VIEW client plus the small amount of
Rhea-specific glue the earn registry needs: MCA lookup, the one-off MCA creation fee, the
Burrow asset (APR/TVL) view, account positions, the ``customRecipientMsg`` builders and the
unit-safe ``extra_decimals`` conversions.

Nothing here signs, submits, or holds a key. The only network calls are NEAR mainnet VIEW calls
against the configured account-manager (``multica.near``) and logic (``contract.main.burrow.near``)
contracts. Caching is per-process and TTL-bounded so a request handler cannot hammer the RPC.

Wire facts (verified 2026-11-01, see ``specs/071-rhea-near-earn/research.md``):

* ``get_mca_by_wallet {"wallet":{"EVM":"<addr without 0x>"}}`` → an account id or ``null``.
* ``get_create_mca_fee_paged {}`` → ``{token_id: raw_amount}`` (USDC = 300000 → 0.30).
* A first deposit ALSO pays a DApp registration fee in the same receipt
  (``collect_dapp_registration_fee`` 300000 = 0.30 USDC, funded run 2026-11-10). Multica has no
  public view for it, so it comes from ``RheaConfig.dapp_registration_fee_fallback``.
* ``get_asset {"token_id": ...}`` → ``supply_apr`` fraction + ``config.extra_decimals``.
* ``get_account_all_positions {"account_id": mca}`` → ``supplied[]`` (inner units) or ``null``.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

import httpx

from .config import EarnConfig, RheaAsset, RheaConfig
from .registry import VaultAsset, VaultEntry, _to_decimal

logger = logging.getLogger("sparkpoint_agent.earn.rhea")

USER_AGENT: Final = "sparkpoint-agent/1.0"
TIMEOUT_S: Final = 10.0
#: A 65-byte placeholder signature (hex, no 0x) for DRY quotes only. The real ``personal_sign``
#: happens in Phase C; dry quotes accept a placeholder and never broadcast anything.
DRY_PLACEHOLDER_SIGNATURE: Final = "00" * 65

#: 1Click custom-recipient business ids. Supply-only in this phase (no collateral flag).
SUPPLY_BUSINESS: Final = "BurrowSupply"
REGISTER_AND_SUPPLY_BUSINESS: Final = "BurrowRegisterAndSupply"


class RheaRpcError(RuntimeError):
    """A failed/unusable NEAR RPC view response. Callers fall back to snapshot/fallback data."""


def strip_0x(value: str) -> str:
    """Remove a leading ``0x`` while preserving the address's original case."""
    text = value.strip()
    return text[2:] if text[:2].lower() == "0x" else text


def is_evm_address(value: str) -> bool:
    """A 20-byte ``0x``-prefixed EVM address (case-insensitive, no checksum validation)."""
    text = value.strip()
    return len(text) == 42 and text[:2].lower() == "0x"


def evm_wallet_string(value: str) -> str:
    """Canonical EVM wallet string for Multica (no ``0x``, EIP-55 checksummed).

    ``multica.near`` keys wallets by the EXACT string it was registered with (EIP-55 from the
    user's wallet), so the lowercased owner the web session carries must be checksummed before
    ``get_mca_by_wallet``/``customRecipientMsg``. Non-EVM values (e.g. a NEAR account id) pass
    through unchanged.
    """
    text = value.strip()
    if is_evm_address(text):
        from eth_utils import to_checksum_address

        try:
            return strip_0x(to_checksum_address(text))
        except ValueError:
            pass
    return strip_0x(text)


@dataclass(frozen=True, slots=True)
class McaLookup:
    """A resolved Multica account lookup.

    ``mca`` is ``None`` only for a genuine first deposit (both lookups missed). ``wallet_form``
    is the EXACT string to reuse in outgoing Multica messages (``customRecipientMsg`` /
    ``messageToSign``): the checksummed form when that matched, the legacy lowercase form when
    that is what matched, and the checksummed form on a miss (what a first registration uses).
    """

    mca: str | None
    wallet_form: str


def _decode_view_result(body: Any) -> Any:
    """Decode a JSON-RPC ``query`` response's base64-ish byte array into JSON (or ``None``)."""
    if not isinstance(body, Mapping):
        return None
    result = body.get("result")
    if not isinstance(result, Mapping):
        return None
    raw = result.get("result")
    if raw is None:
        return None
    if isinstance(raw, list):
        try:
            data = bytes(int(item) for item in raw)
        except (TypeError, ValueError):
            return None
    elif isinstance(raw, str):
        try:
            data = base64.b64decode(raw)
        except ValueError:
            return None
    else:
        return None
    if not data:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None


class NearRpcClient:
    """A bounded NEAR JSON-RPC ``query`` client with URL fallback.

    ``transport`` exists so tests stay offline. A transient failure (network, 408/429/5xx, a
    JSON-RPC ``error`` body) falls through to the next configured URL; if every URL fails a
    :class:`RheaRpcError` is raised and the caller decides whether the snapshot is good enough.
    """

    def __init__(
        self,
        rpc_urls: Sequence[str],
        *,
        timeout_s: float = TIMEOUT_S,
        transport: httpx.AsyncBaseTransport | None = None,
        user_agent: str = USER_AGENT,
    ) -> None:
        self._rpc_urls = tuple(url for url in rpc_urls if url)
        self._timeout_s = timeout_s
        self._transport = transport
        self._user_agent = user_agent

    @property
    def rpc_urls(self) -> tuple[str, ...]:
        return self._rpc_urls

    async def view(self, contract: str, method: str, args: Mapping[str, Any]) -> Any:
        """Call a NEAR ``call_function`` VIEW method and decode its JSON result."""
        payload = {
            "jsonrpc": "2.0",
            "id": "sparkpoint-071",
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": contract,
                "method_name": method,
                "args_base64": base64.b64encode(json.dumps(args).encode("utf-8")).decode("ascii"),
            },
        }
        last_error = "no rpc url configured"
        for url in self._rpc_urls:
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout_s,
                    transport=self._transport,
                    headers={"User-Agent": self._user_agent, "Accept": "application/json"},
                ) as client:
                    response = await client.post(url, json=payload)
            except httpx.HTTPError as exc:
                last_error = f"transport {type(exc).__name__}"
                continue
            if response.status_code != 200:
                last_error = f"http {response.status_code}"
                continue
            try:
                body = response.json()
            except ValueError:
                last_error = "invalid json"
                continue
            if isinstance(body, Mapping) and body.get("error") is not None:
                last_error = "rpc error"
                continue
            return _decode_view_result(body)
        raise RheaRpcError(last_error)


class RheaViews:
    """TTL-cached Rhea/Burrow view reads shared by the service and the background refresher."""

    def __init__(
        self,
        config: RheaConfig,
        *,
        rpc: NearRpcClient | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self._rpc = rpc or NearRpcClient(config.rpc_urls)
        self._clock = clock
        self._assets: dict[str, tuple[float, Mapping[str, Any] | None]] = {}
        self._fee: tuple[float, dict[str, str]] | None = None
        self._mca: dict[str, tuple[float, McaLookup]] = {}

    @property
    def rpc(self) -> NearRpcClient:
        return self._rpc

    async def _lookup_mca(self, wallet: str) -> str | None:
        value = await self._rpc.view(
            self.config.am_contract,
            "get_mca_by_wallet",
            {"wallet": {"EVM": wallet}},
        )
        return value if isinstance(value, str) and value else None

    async def mca_for_wallet(self, wallet: str) -> McaLookup:
        """The user's Multichain Account lookup. Cached ~60s.

        ``multica.near`` matches wallets by the exact registered string, so the canonical EIP-55
        checksummed form is always tried first. A lowercase-only hit (an MCA registered by an
        older lowercase path) is still treated as existing: the second lookup is read-only and
        prevents a duplicate MCA / a bogus one-time fee. The exact form that matched is returned
        with the MCA so every outgoing message uses the same string Multica keyed the account on;
        a first deposit gets the checksummed form. Any RPC failure raises ``RheaRpcError`` so the
        caller can fail closed instead of assuming a first deposit.
        """
        key = wallet.strip().lower()
        now = self._clock()
        cached = self._mca.get(key)
        if cached is not None and now - cached[0] < self.config.mca_ttl_s:
            return cached[1]
        canonical = evm_wallet_string(wallet)
        wallet_form = canonical
        mca = await self._lookup_mca(canonical)
        if mca is None and is_evm_address(wallet):
            legacy = strip_0x(wallet).lower()
            if legacy != canonical:
                mca = await self._lookup_mca(legacy)
                if mca is not None:
                    wallet_form = legacy
        lookup = McaLookup(mca=mca, wallet_form=wallet_form)
        self._mca[key] = (now, lookup)
        return lookup

    async def create_mca_fee(self) -> dict[str, str]:
        """``get_create_mca_fee_paged`` as ``{token_id: raw_amount}``. Cached ~5 min."""
        now = self._clock()
        if self._fee is not None and now - self._fee[0] < self.config.fee_ttl_s:
            return self._fee[1]
        value = await self._rpc.view(
            self.config.am_contract, "get_create_mca_fee_paged", {}
        )
        fees = (
            {str(key): str(item) for key, item in value.items()}
            if isinstance(value, Mapping)
            else {}
        )
        self._fee = (now, fees)
        return fees

    async def asset(self, token_id: str) -> Mapping[str, Any] | None:
        """The Burrow ``get_asset`` view. Cached ~5 min (including a null answer)."""
        now = self._clock()
        cached = self._assets.get(token_id)
        if cached is not None and now - cached[0] < self.config.asset_ttl_s:
            return cached[1]
        value = await self._rpc.view(
            self.config.logic_contract, "get_asset", {"token_id": token_id}
        )
        asset = value if isinstance(value, Mapping) else None
        self._assets[token_id] = (now, asset)
        return asset

    async def positions(self, account_id: str) -> Mapping[str, Any] | None:
        """``get_account_all_positions`` for an MCA. Unknown accounts answer ``null``."""
        value = await self._rpc.view(
            self.config.logic_contract,
            "get_account_all_positions",
            {"account_id": account_id},
        )
        return value if isinstance(value, Mapping) else None


# ── customRecipientMsg (exact wire shape) ────────────────────────────────────────────────────


def _message_wallet(wallet: str, wallet_form: str | None) -> str:
    """The Multica wallet string for an outgoing message.

    ``wallet_form`` is the exact form a lookup matched (checksum or legacy lowercase); when it is
    absent this is a first deposit and the checksummed form is used.
    """
    if wallet_form:
        return strip_0x(wallet_form)
    return evm_wallet_string(wallet)


def supply_message(wallet: str, *, wallet_form: str | None = None) -> dict[str, Any]:
    """Existing-MCA supply: ``{"w":[{"EVM":"<addr no 0x>"}],"b":{"r":"BurrowSupply"}}``."""
    return {
        "w": [{"EVM": _message_wallet(wallet, wallet_form)}],
        "b": {"r": SUPPLY_BUSINESS},
    }


def register_message(
    wallet: str, signature: str, *, wallet_form: str | None = None
) -> dict[str, Any]:
    """First deposit: register the MCA and supply in one 1Click leg."""
    return {
        "w": [{"EVM": _message_wallet(wallet, wallet_form)}],
        "b": {"r": REGISTER_AND_SUPPLY_BUSINESS},
        "s": [strip_0x(signature)],
    }


def message_to_sign(wallet: str, *, wallet_form: str | None = None) -> str:
    """The exact string the web must ``personal_sign`` on a first deposit.

    Matches the Rhea SDK's ``JSON.stringify([{EVM: "<addr without 0x>"}])`` — compact separators,
    original address case.
    """
    return json.dumps([{"EVM": _message_wallet(wallet, wallet_form)}], separators=(",", ":"))


def custom_recipient_msg(message: Mapping[str, Any]) -> str:
    """Serialize a message the way 1Click expects it (a compact JSON string)."""
    return json.dumps(dict(message), separators=(",", ":"))


# ── unit-safe math ────────────────────────────────────────────────────────────────────────────


def inner_units_to_decimal(
    raw: Any, token_decimals: int, extra_decimals: int = 0
) -> Decimal | None:
    """Burrow inner units → human amount (``token decimals + extra_decimals``)."""
    value = _to_decimal(raw)
    if value is None:
        return None
    return value.scaleb(-(token_decimals + extra_decimals))


def token_units_to_decimal(raw: Any, decimals: int) -> Decimal | None:
    """A plain token raw amount → human amount (no ``extra_decimals``)."""
    value = _to_decimal(raw)
    if value is None:
        return None
    return value.scaleb(-decimals)


def extra_decimals_for(asset_detail: Mapping[str, Any] | None) -> int:
    if not isinstance(asset_detail, Mapping):
        return 0
    config = asset_detail.get("config")
    if not isinstance(config, Mapping):
        return 0
    try:
        return int(config.get("extra_decimals") or 0)
    except (TypeError, ValueError):
        return 0


def dapp_registration_fee_amount(asset: RheaAsset, fallback: Mapping[str, str]) -> Decimal:
    """The one-off DApp registration fee charged with a first deposit's create-MCA fee.

    There is no on-chain view for it (``multica.near`` only emits a
    ``collect_dapp_registration_fee`` event), so the configured per-symbol fallback is
    authoritative. Unknown symbols are 0.
    """
    raw = fallback.get(asset.symbol) or fallback.get(asset.symbol.upper())
    if raw is None:
        return Decimal(0)
    try:
        return max(Decimal(str(raw)), Decimal(0)).quantize(Decimal("0.01"))
    except (ArithmeticError, ValueError):
        return Decimal(0)


def mca_fee_amount(
    fees: Mapping[str, str], asset: RheaAsset, fallback: Mapping[str, str]
) -> Decimal:
    """The one-off MCA creation fee for ``asset``, live value first, config fallback second."""
    live = token_units_to_decimal(fees.get(asset.token_id), asset.decimals)
    if live is not None:
        return live
    # The config fallback is already human-readable ("0.30"), unlike the raw on-chain value.
    configured = _to_decimal(fallback.get(asset.symbol.upper()))
    return configured if configured is not None else Decimal(0)


def percent_string(value: Decimal | None) -> str | None:
    """A fraction (``0.1404``) rendered as a display percent (``14.04``)."""
    if value is None:
        return None
    text = format(value * Decimal(100), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def human_string(value: Decimal | None) -> str | None:
    if value is None:
        return None
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def fee_string(value: Decimal | None) -> str:
    """A currency fee with two decimals (``0.30``), as the preview copy shows it."""
    if value is None:
        return "0.00"
    try:
        return format(value.quantize(Decimal("0.01")), "f")
    except Exception:  # noqa: BLE001 - a pathological value still prints honestly
        return human_string(value) or "0"


# ── positions ────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class RheaPosition:
    symbol: str
    token_id: str
    amount: Decimal
    apy: Decimal | None

    def wire(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "amount": human_string(self.amount) or "0",
            "apy": percent_string(self.apy),
        }


def parse_supplied_positions(
    portfolio: Mapping[str, Any],
    config: RheaConfig,
    details: Mapping[str, Mapping[str, Any] | None],
) -> list[RheaPosition]:
    """Extract enabled-asset supply rows from ``get_account_all_positions``."""
    supplied = portfolio.get("supplied")
    if not isinstance(supplied, list):
        return []
    rows: list[RheaPosition] = []
    for item in supplied:
        if not isinstance(item, Mapping):
            continue
        token_id = item.get("token_id")
        if not isinstance(token_id, str):
            continue
        asset = config.asset_for_token(token_id)
        if asset is None or not asset.enabled:
            continue
        detail = details.get(token_id)
        amount = inner_units_to_decimal(
            item.get("balance"), asset.decimals, extra_decimals_for(detail)
        )
        if amount is None or amount <= 0:
            continue
        apy = _to_decimal(item.get("apr"))
        if apy is None and isinstance(detail, Mapping):
            apy = _to_decimal(detail.get("supply_apr"))
        rows.append(RheaPosition(symbol=asset.symbol, token_id=token_id, amount=amount, apy=apy))
    return rows


# ── registry rows ────────────────────────────────────────────────────────────────────────────


def _chain_id(config: EarnConfig) -> int:
    chain = config.chain("near")
    return chain.chain_id if chain is not None else 0


def _stable_symbol(symbol: str) -> bool:
    return symbol.upper() in {"USDC", "USDT"}


async def fetch_rhea_vaults(
    config: EarnConfig, *, views: RheaViews | None = None
) -> list[VaultEntry]:
    """One :class:`VaultEntry` per enabled Rhea asset (APR from ``get_asset``). Fail-open."""
    rhea = config.rhea
    if not rhea.enabled:
        return []
    views = views or RheaViews(rhea)
    fetched_at = datetime.now(UTC).isoformat()
    chain_id = _chain_id(config)
    entries: list[VaultEntry] = []
    for asset in rhea.enabled_assets():
        detail: Mapping[str, Any] | None = None
        try:
            detail = await views.asset(asset.token_id)
        except RheaRpcError as exc:
            logger.warning("rhea_asset_failed token=%s err=%s", asset.token_id, exc)
        apy = _to_decimal(detail.get("supply_apr")) if isinstance(detail, Mapping) else None
        # Display precision only: the wire's netApy is a percent, so 4 fraction decimals gives
        # the "14.05%" the Rhea UI shows while the source object still names supply_apr.
        if apy is not None:
            apy = apy.quantize(Decimal("0.0001"))
        supplied = detail.get("supplied") if isinstance(detail, Mapping) else None
        supplied_amount = (
            inner_units_to_decimal(
                supplied.get("balance"),
                asset.decimals,
                extra_decimals_for(detail),
            )
            if isinstance(supplied, Mapping)
            else None
        )
        # Stablecoins are pegged ~$1, so the supplied amount is a cheap TVL estimate. Anything
        # else stays null rather than inventing a USD price.
        tvl = supplied_amount if _stable_symbol(asset.symbol) else None
        entries.append(
            VaultEntry(
                chain="near",
                chain_id=chain_id,
                address=asset.token_id,
                version="lending",
                name=f"Rhea Lending {asset.symbol}",
                symbol=asset.symbol,
                asset=VaultAsset(
                    address=asset.token_id,
                    symbol=asset.symbol,
                    decimals=asset.decimals,
                ),
                listed=True,
                tvl_usd=tvl,
                net_apy=apy,
                source="rhea_rpc",
                fetched_at=fetched_at,
                protocol="rhea",
            )
        )
    return entries


__all__ = [
    "DRY_PLACEHOLDER_SIGNATURE",
    "McaLookup",
    "NearRpcClient",
    "RheaPosition",
    "RheaRpcError",
    "RheaViews",
    "custom_recipient_msg",
    "evm_wallet_string",
    "extra_decimals_for",
    "fetch_rhea_vaults",
    "human_string",
    "inner_units_to_decimal",
    "is_evm_address",
    "dapp_registration_fee_amount",
    "mca_fee_amount",
    "message_to_sign",
    "parse_supplied_positions",
    "percent_string",
    "register_message",
    "strip_0x",
    "supply_message",
    "token_units_to_decimal",
]
