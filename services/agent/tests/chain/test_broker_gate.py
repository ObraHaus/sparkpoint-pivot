# ruff: noqa: S101
"""043 T001 — the test that must be true for the collection to mean anything.

**Written before `broker_gate.py` existed, and watched to fail.** A test written after the code
tends to assert what the code does; this one asserts what the product promises.

The promise: an activated Sparky Broker confers Premium *while you hold it*, and the moment you sell
it, it does not. The bug that makes the whole collection pointless is a holder who sold their broker
last week and still has the access it was sold with — so the sale case is the first thing here, not
an afterthought.

Why this is answerable at all without an indexer (research R1): `SparkyBroker` is solady ERC-721 and
is NOT enumerable, so nothing can list a wallet's tokens. But minting never activates and
``_afterTokenTransfer`` clears activation on every real transfer, so **a wallet can only hold an
activated broker it activated itself**. The registry's own ``activationsBy`` is therefore a complete
candidate set, and the live ``ownerOf`` + ``activatedAt`` reads are the authority. A stale hint can
only ever cost a read, never a wrong verdict.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from sparkpoint_agent.chain.broker_gate import BrokerGate, BrokerGateResult

REGISTRY = "0x39C38c86611FF3679802D5341E830c83DB7F4537"
BROKER = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
HOLDER = "0x32Ed4400C5BBB394712c482F1207886d8C22e8b5"
BUYER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"

_WORD = 32


def _uint(value: int) -> str:
    return f"{value:064x}"


def _addr_word(addr: str) -> str:
    return f"{int(addr, 16):064x}"


def _uint_array(values: list[int]) -> str:
    """ABI-encode `uint256[]` as a dynamic return: offset, length, then the items."""
    body = _uint(0x20) + _uint(len(values)) + "".join(_uint(v) for v in values)
    return "0x" + body


class FakeChain:
    """A chain that answers the three reads the gate makes, and counts them.

    Deliberately dumb: it holds the same state the real contracts hold, so a test can move a token
    the way a real transfer does — which, per the product rule, also clears the activation.
    """

    def __init__(
        self,
        *,
        activations: dict[str, list[int]] | None = None,
        owners: dict[int, str] | None = None,
        activated_at: dict[int, int] | None = None,
    ) -> None:
        self.activations = {k.lower(): v for k, v in (activations or {}).items()}
        self.owners = owners or {}
        self.activated_at = activated_at or {}
        self.calls = 0
        self.fail_with: Exception | None = None

    # -- the thing a real transfer does, so tests cannot forget it --------------------------
    def transfer(self, token_id: int, to: str) -> None:
        """Move a token exactly as `_afterTokenTransfer` does: the activation is cleared."""
        self.owners[token_id] = to
        self.activated_at[token_id] = 0

    def activate(self, token_id: int, by: str) -> None:
        self.activated_at[token_id] = 11_479_836  # a block number, as the contract stores
        self.activations.setdefault(by.lower(), []).append(token_id)

    async def call(self, method: str, params: list[Any]) -> Any:
        self.calls += 1
        if self.fail_with is not None:
            raise self.fail_with
        assert method == "eth_call"
        data = params[0]["data"]
        selector, arg = data[2:10], data[10:]
        # Selectors are the real ones, verified against the deployed contract on 46630 — a fake
        # that answers made-up selectors proves nothing about the code that calls the real chain.

        if selector == "deb24aa6":  # activationsBy(address)
            who = "0x" + arg[24:64]
            return _uint_array(self.activations.get(who.lower(), []))
        if selector == "6352211e":  # ownerOf(uint256)
            owner = self.owners.get(int(arg, 16))
            if owner is None:
                raise RuntimeError("ERC721: token does not exist")
            return "0x" + _addr_word(owner)
        if selector == "ae9ec3cc":  # activatedAt(uint256)
            return "0x" + _uint(self.activated_at.get(int(arg, 16), 0))
        raise AssertionError(f"unexpected selector {selector}")


def gate(chain: FakeChain, **kw: Any) -> BrokerGate:
    return BrokerGate(rpc=chain, broker=BROKER, registry=REGISTRY, **kw)


# ── THE ONE THAT MATTERS ────────────────────────────────────────────────────────────────────


def test_selling_an_activated_broker_ends_premium() -> None:
    """The bug this whole feature exists to prevent, asserted first.

    A stranger keeping the access their broker was sold with is the one outcome that makes the
    collection pointless. Note the assertion is on a FRESH read, not on a cached one — a cache that
    outlives the sale is the same bug wearing a different hat.
    """
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    g = gate(chain, cache_seconds=0)

    before = asyncio.run(g.check(HOLDER))
    assert before.qualified is True, "an activated broker held by this wallet must confer premium"
    assert before.token_id == 7

    chain.transfer(7, BUYER)  # a real, owner-signed sale

    after = asyncio.run(g.check(HOLDER))
    assert after.qualified is False, "SELLING THE BROKER MUST END THE PREMIUM"
    assert after.reason == "no_activated_broker"
    assert after.token_id is None


def test_the_buyer_does_not_inherit_the_activation() -> None:
    """The other half of the same rule: a sale hands over the token, not the membership."""
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    chain.transfer(7, BUYER)

    g = gate(chain, cache_seconds=0)
    assert asyncio.run(g.check(BUYER)).qualified is False, (
        "the buyer must burn their own SRK; they inherit an UNACTIVATED broker"
    )


# ── holding is not activating ───────────────────────────────────────────────────────────────


def test_holding_an_unactivated_broker_does_not_qualify() -> None:
    chain = FakeChain(owners={7: HOLDER}, activated_at={7: 0}, activations={HOLDER: [7]})
    result = asyncio.run(gate(chain, cache_seconds=0).check(HOLDER))
    assert result.qualified is False
    assert result.reason == "no_activated_broker"


def test_a_wallet_with_no_brokers_at_all() -> None:
    result = asyncio.run(gate(FakeChain(), cache_seconds=0).check(HOLDER))
    assert result.qualified is False
    assert result.reason == "no_activated_broker"


# ── the candidate set is a HINT, never the authority (research R1) ──────────────────────────


def test_a_stale_registry_hint_never_grants() -> None:
    """The registry cannot observe a transfer, so its list is allowed to go stale.

    Staleness in a *candidate set* is harmless precisely because the verdict is read live. This is
    the assertion that keeps it that way — if someone ever "optimises" by trusting the list, this
    fails.
    """
    chain = FakeChain(owners={7: BUYER}, activated_at={7: 0})
    chain.activations[HOLDER.lower()] = [7]  # the registry still remembers; the chain has moved on

    result = asyncio.run(gate(chain, cache_seconds=0).check(HOLDER))
    assert result.qualified is False


def test_several_brokers_one_activated() -> None:
    chain = FakeChain(owners={1: HOLDER, 2: HOLDER, 3: HOLDER})
    chain.activate(2, HOLDER)
    result = asyncio.run(gate(chain, cache_seconds=0).check(HOLDER))
    assert result.qualified is True
    assert result.token_id == 2


def test_selling_the_activated_one_while_keeping_the_others() -> None:
    chain = FakeChain(owners={1: HOLDER, 2: HOLDER})
    chain.activate(2, HOLDER)
    chain.transfer(2, BUYER)
    assert asyncio.run(gate(chain, cache_seconds=0).check(HOLDER)).qualified is False


def test_a_token_that_no_longer_exists_is_skipped_not_fatal() -> None:
    """`ownerOf` reverts for a burnt/nonexistent id. That must not take the whole answer down."""
    chain = FakeChain(owners={2: HOLDER})
    chain.activations[HOLDER.lower()] = [99, 2]  # 99 does not exist
    chain.activated_at[2] = 11_479_836
    result = asyncio.run(gate(chain, cache_seconds=0).check(HOLDER))
    assert result.qualified is True
    assert result.token_id == 2


# ── never raises, never grants on a failed read ─────────────────────────────────────────────


def test_an_rpc_failure_never_raises_and_never_grants() -> None:
    """Fail-closed in the safe direction: the unsafe one is granting on a read that did not
    happen."""
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    chain.fail_with = RuntimeError("connect ETIMEDOUT")

    result = asyncio.run(gate(chain, cache_seconds=0).check(HOLDER))
    assert result.qualified is False
    assert result.reason == "rpc_error"


def test_an_unconfigured_gate_is_inert() -> None:
    """No registry address ⇒ the agent behaves exactly as it did before this feature existed."""
    g = BrokerGate(rpc=FakeChain(), broker=BROKER, registry="", cache_seconds=0)
    result = asyncio.run(g.check(HOLDER))
    assert result.qualified is False
    assert result.reason == "not_configured"


@pytest.mark.parametrize("bad", ["", "0x", "nonsense", "0x1234"])
def test_a_bad_address_is_rejected_without_a_chain_call(bad: str) -> None:
    chain = FakeChain()
    result = asyncio.run(gate(chain, cache_seconds=0).check(bad))
    assert result.qualified is False
    assert result.reason == "bad_address"
    assert chain.calls == 0


# ── the cache: short, and it caches the ANSWER not a tier ───────────────────────────────────


def test_the_cache_spares_the_chain_within_its_window() -> None:
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    g = gate(chain, cache_seconds=60)

    now = 1_800_000_000.0
    assert asyncio.run(g.check(HOLDER, now=now)).qualified is True
    first = chain.calls
    assert asyncio.run(g.check(HOLDER, now=now + 30)).qualified is True
    assert chain.calls == first, "inside the window the gate must not re-read the chain"


def test_the_cache_window_is_short_enough_to_notice_a_sale() -> None:
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    g = gate(chain, cache_seconds=60)

    now = 1_800_000_000.0
    assert asyncio.run(g.check(HOLDER, now=now)).qualified is True
    chain.transfer(7, BUYER)

    assert asyncio.run(g.check(HOLDER, now=now + 30)).qualified is True, "still inside the window"
    assert asyncio.run(g.check(HOLDER, now=now + 61)).qualified is False, (
        "past the window the sale MUST be visible"
    )


def test_a_failed_read_is_not_cached() -> None:
    """Otherwise one blip pins a wallet to 'no premium' for the whole window."""
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    g = gate(chain, cache_seconds=60)
    now = 1_800_000_000.0

    chain.fail_with = RuntimeError("connect ETIMEDOUT")
    assert asyncio.run(g.check(HOLDER, now=now)).qualified is False

    chain.fail_with = None
    assert asyncio.run(g.check(HOLDER, now=now + 1)).qualified is True, (
        "a transient failure must not be remembered"
    )


def test_the_cache_holds_the_chain_answer_not_a_tier() -> None:
    """Caching a derived tier would re-create the very bug this feature exists to avoid.

    It would merely move it from Postgres into memory, where it disappears on restart rather than
    being safe. The cached value must be the narrow chain fact.
    """
    chain = FakeChain(owners={7: HOLDER})
    chain.activate(7, HOLDER)
    g = gate(chain, cache_seconds=60)
    asyncio.run(g.check(HOLDER, now=1_800_000_000.0))

    cached = list(g._cache.values())  # noqa: SLF001 - asserting the shape is the point
    assert cached, "expected one cache entry"
    for entry in cached:
        assert isinstance(entry.result, BrokerGateResult)
        assert not hasattr(entry.result, "tier"), "the cache must not hold a tier"


# ── several registries: the migration hazard this design already hit once ───────────────────


class MultiChain(FakeChain):
    """A chain with TWO registries — the shape after `setActivator` is re-pointed."""

    def __init__(self, old: str, new: str, **kw: Any) -> None:
        super().__init__(**kw)
        self.per_registry: dict[str, dict[str, list[int]]] = {old.lower(): {}, new.lower(): {}}

    def record(self, registry: str, holder: str, token_id: int) -> None:
        self.per_registry[registry.lower()].setdefault(holder.lower(), []).append(token_id)

    async def call(self, method: str, params: list[Any]) -> Any:
        data = params[0]["data"]
        if data[2:10] == "deb24aa6":  # activationsBy — answer PER registry
            self.calls += 1
            if self.fail_with is not None:
                raise self.fail_with
            to = params[0]["to"].lower()
            who = "0x" + data[10:][24:64]
            return _uint_array(self.per_registry.get(to, {}).get(who.lower(), []))
        return await super().call(method, params)


OLD_REGISTRY = "0x5370d06bFA9049234C471e0877e249D9322728FF"
NEW_REGISTRY = "0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775"


def test_an_activation_recorded_on_a_REPLACED_registry_still_counts() -> None:
    """The hazard, reproduced from life.

    On 46630 the registry was redeployed and `setActivator` re-pointed at it. Every activation
    recorded on the old one was instantly orphaned — and there is NO recovery on-chain, because
    the NFT still says those tokens are activated, so `activate` reverts `AlreadyActivated`.
    A holder who had paid would silently stop qualifying.

    Reading the union of every registry ever wired makes that survivable, and it is safe
    precisely because the list is only a hint: the live ownerOf + activatedAt reads still decide.
    """
    chain = MultiChain(OLD_REGISTRY, NEW_REGISTRY, owners={3: HOLDER})
    chain.activated_at[3] = 11_481_694
    # Recorded before the swap; the new registry knows nothing about it.
    chain.record(OLD_REGISTRY, HOLDER, 3)

    only_new = BrokerGate(rpc=chain, broker=BROKER, registry=NEW_REGISTRY, cache_seconds=0)
    assert asyncio.run(only_new.check(HOLDER)).qualified is False, "the orphaning is real"

    both = BrokerGate(
        rpc=chain, broker=BROKER, registry=f"{NEW_REGISTRY},{OLD_REGISTRY}", cache_seconds=0
    )
    result = asyncio.run(both.check(HOLDER))
    assert result.qualified is True, "both registries must recover the paid-for activation"
    assert result.token_id == 3


def test_a_token_recorded_by_both_registries_is_only_scanned_once() -> None:
    chain = MultiChain(OLD_REGISTRY, NEW_REGISTRY, owners={3: HOLDER})
    chain.activated_at[3] = 11_481_694
    chain.record(OLD_REGISTRY, HOLDER, 3)
    chain.record(NEW_REGISTRY, HOLDER, 3)

    gate = BrokerGate(
        rpc=chain, broker=BROKER, registry=f"{NEW_REGISTRY},{OLD_REGISTRY}", cache_seconds=0
    )
    assert asyncio.run(gate.check(HOLDER)).qualified is True


def test_blank_and_malformed_registry_entries_are_dropped_not_fatal() -> None:
    chain = MultiChain(OLD_REGISTRY, NEW_REGISTRY, owners={3: HOLDER})
    chain.activated_at[3] = 11_481_694
    chain.record(NEW_REGISTRY, HOLDER, 3)

    gate = BrokerGate(
        rpc=chain, broker=BROKER, registry=f" {NEW_REGISTRY} , , nonsense ,", cache_seconds=0
    )
    assert gate.registries == [NEW_REGISTRY]
    assert asyncio.run(gate.check(HOLDER)).qualified is True


def test_no_valid_registry_at_all_is_unconfigured_not_a_crash() -> None:
    gate = BrokerGate(rpc=FakeChain(), broker=BROKER, registry=" , nonsense ", cache_seconds=0)
    assert gate.configured is False
    assert asyncio.run(gate.check(HOLDER)).reason == "not_configured"


def test_the_rpc_url_falls_back_to_the_chain_the_broker_is_on(monkeypatch: Any) -> None:
    """One URL, not two. A second env var holding the same endpoint only creates drift."""
    from sparkpoint_agent.chain import broker_gate as mod

    monkeypatch.delenv(mod.ENV_RPC_URL, raising=False)
    monkeypatch.setenv(mod.ENV_RPC_URL_FALLBACK, "https://rpc.testnet.chain.robinhood.com")
    monkeypatch.setenv(mod.ENV_BROKER, BROKER)
    monkeypatch.setenv(mod.ENV_REGISTRY, REGISTRY)
    gate = mod.build_broker_gate_from_env(rpc_factory=lambda url: FakeChain())
    assert gate is not None, "the Robinhood RPC already configured must be enough"

    # An explicit override still wins, for the day the collection lives on another chain.
    monkeypatch.setenv(mod.ENV_RPC_URL, "https://example.invalid")
    assert mod.build_broker_gate_from_env(rpc_factory=lambda url: FakeChain()) is not None


def test_no_rpc_at_all_leaves_the_gate_unbuilt(monkeypatch: Any) -> None:
    from sparkpoint_agent.chain import broker_gate as mod

    monkeypatch.delenv(mod.ENV_RPC_URL, raising=False)
    monkeypatch.delenv(mod.ENV_RPC_URL_FALLBACK, raising=False)
    monkeypatch.setenv(mod.ENV_BROKER, BROKER)
    monkeypatch.setenv(mod.ENV_REGISTRY, REGISTRY)
    assert mod.build_broker_gate_from_env(rpc_factory=lambda url: FakeChain()) is None
