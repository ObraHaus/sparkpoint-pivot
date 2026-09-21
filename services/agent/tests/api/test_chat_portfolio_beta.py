# ruff: noqa: S101  (pytest asserts)
"""053 — the chat portfolio provider on a chain WITHOUT the launch vault.

The AI must see the SAME beta portfolio the app shows: the idle stable + every whitelisted
curated wrapper the wallet holds. The launch-vault read there would degrade to an empty stale
view and hide the user's funds from every recommendation — the whole point of extending the
agent for 4663.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.api.chat import _VaultChatPortfolioProvider
from sparkpoint_agent.chain import VaultUnavailable, VaultUnavailableReason
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.coordinator import ChainContext

STABLE_4663 = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"  # USDG (6 dp)
WRAPPER_4663 = "0xd43fc69f019d1c1fd509bd340b44e4abb6f77cfe"
OWNER = "0x1111111111111111111111111111111111111111"


class _Entry:
    def __init__(self, proxy: str, *, chain_id: int = 4663, status: str = "deployed") -> None:
        self.chain_id = chain_id
        self.status = status
        self.proxy_address = proxy
        self.label = "Steakhouse USDG"
        self.name = "Steakhouse USDG"


class _Store:
    def __init__(self, entries: list[Any] | None = None) -> None:
        self._entries = entries or []

    async def list_entries(self, chain_id: int, *, limit: int = 200) -> list[Any]:
        return [e for e in self._entries if e.chain_id == chain_id]


class _Reader:
    """A chain with NO launch vault: per-token balances + generic ERC-4626 reads."""

    def __init__(
        self,
        *,
        idle: int = 0,
        wrappers: dict[str, dict[str, Any]] | None = None,
        fail: bool = False,
    ) -> None:
        self._idle = idle
        self._wrappers = wrappers or {}
        self._fail = fail

    async def token_balance_of(self, token: str, owner: str) -> int:
        if self._fail:
            raise VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "rpc down")
        key = token.lower()
        if key in self._wrappers:
            return int(self._wrappers[key]["shares"])
        if key == STABLE_4663:
            return self._idle
        return 0

    async def convert_to_assets_at(self, vault: str, shares: int) -> int:
        return int(self._wrappers[vault.lower()]["underlying"])

    async def asset_at(self, vault: str) -> str:
        return str(self._wrappers[vault.lower()]["asset"])

    async def decimals_at(self, token: str) -> int:
        # The wrapper's own shares are 9-dp; its asset (and the stable) is 6-dp.
        return 9 if token.lower() == WRAPPER_4663 else 6

    async def native_balance(self, owner: str) -> int:
        return 0

    async def block_number(self) -> int:
        return 7


def _provider(reader: _Reader, store: _Store | None) -> _VaultChatPortfolioProvider:
    return _VaultChatPortfolioProvider(
        reader,  # type: ignore[arg-type]
        AgentConfig(
            chain_id=4663,
            rpc_url=None,
            vault_address=None,
            database_url=None,
            stable_token_address=STABLE_4663,
        ),
        store,  # type: ignore[arg-type]
    )


def _chain() -> ChainContext:
    return ChainContext(chain_id=4663, user_account=OWNER, owner=OWNER)


async def test_chat_sees_the_beta_wrapper_and_idle_stable() -> None:
    reader = _Reader(
        idle=2_150_000_000,  # 2,150 USDG
        wrappers={
            WRAPPER_4663: {
                "shares": 99_900_000_000,  # 99.9 shares (9 dp)
                "underlying": 100_000_000,  # 100 USDG (6 dp)
                "asset": STABLE_4663,
            }
        },
    )
    view = await _provider(reader, _Store([_Entry(WRAPPER_4663)])).read(_chain())

    assert view.stale is False
    assert view.net_worth_usd == "2250.00"
    assert view.idle_usdc == 2_150_000_000
    venues = {p.venue for p in view.positions}
    assert venues == {"Steakhouse USDG", "Wallet (idle)"}
    wrapper = next(p for p in view.positions if p.venue == "Steakhouse USDG")
    assert wrapper.value_usd == "100.00"
    assert wrapper.shares == "99.90"  # the wrapper's OWN 9-dp share scale
    assert wrapper.price_source == "ERC-4626 convertToAssets"


async def test_chat_beta_idle_only_is_live_not_stale() -> None:
    view = await _provider(_Reader(idle=500_000_000), _Store([_Entry(WRAPPER_4663)])).read(_chain())

    assert view.stale is False
    assert view.net_worth_usd == "500.00"
    assert [p.venue for p in view.positions] == ["Wallet (idle)"]


async def test_chat_beta_read_failure_is_stale_never_fabricated() -> None:
    view = await _provider(
        _Reader(fail=True), _Store([_Entry(WRAPPER_4663)])
    ).read(_chain())

    assert view.stale is True
    assert view.positions == ()
