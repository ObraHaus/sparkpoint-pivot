"""Policy constants — the Python mirror of the shared source of truth.

MIRRORS packages/shared/src/policy/constants.ts (caps, slippage, the
(targetRef, selector) allowlist, POLICY_VERSION, session bounds, forbidden
selectors, the governance perf-fee bound) AND packages/shared/src/addresses/*
(the per-chain AddressBook + resolveTargetRef join). T098 asserts parity; keep in
lockstep — any drift is a CI failure.

Grounding:
  policy-schema.md §1 (policyVersion), §3 (allowlist grammar), §4 (caps),
  §4.1 (performance-fee governance bound), §5 (slippage), §6 (session scope);
  packages/shared/src/addresses/{base,baseSepolia,localFork}.ts (pinned, on-chain
  verified addresses). smart-contracts.md §6.1 (MAX_PERFORMANCE_FEE_BPS == 2000).

Numeric policy: token amounts are Python ``int`` raw base units (exact,
EVM-parity, never floats). ``decimals`` is carried alongside per §4.

Address policy: this module carries the pinned protocol/token addresses that are
knowable at authoring time; the deploy-time-determined SparkPoint contracts (the
vault) stay ``None`` here (fail-closed). ``resolve_target_ref`` performs the
symbolic ``TargetRef`` → concrete address join; an unresolved (``None``) target
cannot form a ``(target, selector)`` pair, so an action against it correctly fails
allowlisting rather than being silently permitted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .enums import ActionType, Asset, Direction, Protocol

# policy-schema.md §1 — pinned, monotonic, logged with every verdict/outcome (N5).
POLICY_VERSION = "policy@2026.06.0"

# Chain ids this policy foundation is parameterized for (R14).
CHAIN_ID: dict[str, int] = {
    "base": 8453,
    "base_sepolia": 84532,
    "local_fork": 31337,
    # Robinhood Chain Testnet (§B3). The SparkPoint vault stays BASE-ONLY — 46630 is
    # supported for chat + read-only portfolio, but its allowlist is EMPTY so every vault/
    # swap action fails closed (we NEVER point the adapter at the unofficial Robinhood pilot).
    "robinhood_testnet": 46630,
}
SUPPORTED_CHAIN_IDS: tuple[int, ...] = (8453, 84532, 31337, 46630)

# A symbolic reference to an on-chain target, resolved via the address book.
TargetRef = Literal[
    "sparkpoint_vault",
    "aave_v3_pool",
    "aerodrome_router",
    "aerodrome_factory",
]

# policy-schema.md §3/§3b — every fund-moving recipient is pinned to the user's
# own account/owner (N1). No SparkPoint or arbitrary external recipient is nameable.
RecipientPin = Literal["user_account"]


# ─────────────────────────────────────────────────────────────────────────────
# Types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TokenAmount:
    """policy-schema.md §4 — a cap/amount in raw base units + decimals.

    ``ceiling`` is the immutable hard maximum the (pause-only, timelocked) multisig
    may raise this cap UP TO — never exceedable even by a compromised multisig (§4).
    ``None`` where §4 gives no separate ceiling (the session caps).
    """

    asset: Asset
    amount: int
    decimals: int
    ceiling: int | None = None


@dataclass(frozen=True)
class PolicyCaps:
    """policy-schema.md §4 — the five caps (G2)."""

    per_user_tvl: TokenAmount
    total_protocol: TokenAmount
    vault_deposit: TokenAmount
    session_per_tx: TokenAmount
    session_cumulative: TokenAmount


@dataclass(frozen=True)
class SlippageConfig:
    """policy-schema.md §5 — slippage config (G4). Swaps only."""

    user_max_bps: int
    protocol_floor_bps: int
    absolute_ceiling_bps: int
    applies_to: tuple[ActionType, ...]


@dataclass(frozen=True)
class AllowlistEntry:
    """policy-schema.md §3 — one closed (protocol, target, selector, constraints) entry.

    Matched by decoded calldata off-chain and by ``isAllowedTarget(target, selector)``
    on-chain — address+selector level, never name level (§0.3).
    """

    protocol: Protocol
    target_ref: TargetRef
    selector: str
    action: ActionType
    direction: Direction
    assets: tuple[Asset, ...]
    recipient_must_be: RecipientPin
    cap_gated: bool
    pause_gated: bool
    slippage_bound: bool = False
    route_factory_must_be: TargetRef | None = None
    # True ⇒ target not deployed on this chain; EXCLUDED from the resolved allowlist
    # (fail-closed) so an action against it correctly fails allowlisting.
    undeployed: bool = False


@dataclass(frozen=True)
class SessionBounds:
    """policy-schema.md §6 — bounds a session-key grant is validated against (N4)."""

    max_session_duration_days: int
    allowlist_must_be_subset_of_global: bool
    forbidden_selectors: tuple[str, ...]


@dataclass(frozen=True)
class PerformanceFeeBound:
    """policy-schema.md §4.1 / smart-contracts.md §6.1 — profit-only perf-fee bound."""

    default_bps: int
    ceiling_bps: int


@dataclass(frozen=True)
class GovernanceParams:
    """The only mutable governance bound beyond pause/caps (§4.1)."""

    performance_fee: PerformanceFeeBound


@dataclass(frozen=True)
class PolicyConstants:
    """The per-chain policy bundle returned by ``get_policy_constants``."""

    policy_version: str
    chain_id: int
    caps: PolicyCaps
    slippage: SlippageConfig
    # Resolved allowlist — ``undeployed`` entries are already filtered out (fail-closed).
    allowlist: tuple[AllowlistEntry, ...]
    session_bounds: SessionBounds
    governance: GovernanceParams


# ─────────────────────────────────────────────────────────────────────────────
# Chain-independent constants (§4 caps, §5 slippage, §6 bounds, §4.1 governance).
# The spec gives single values for all chains; only the allowlist varies by chain.
# ─────────────────────────────────────────────────────────────────────────────

# policy-schema.md §4 — caps in raw USDC base units (6 dp).
CAPS = PolicyCaps(
    # 5,000 USDC per user; ceiling 10,000 USDC.
    per_user_tvl=TokenAmount(Asset.USDC, 5_000_000_000, 6, ceiling=10_000_000_000),
    # 1,000,000 USDC total; ceiling 5,000,000 USDC.
    total_protocol=TokenAmount(Asset.USDC, 1_000_000_000_000, 6, ceiling=5_000_000_000_000),
    # 1,000,000 USDC vault deposit cap; ceiling 5,000,000 USDC.
    vault_deposit=TokenAmount(Asset.USDC, 1_000_000_000_000, 6, ceiling=5_000_000_000_000),
    # 500 USDC per session UserOp. §4 gives no separate ceiling (a grant may only narrow, §6.4).
    session_per_tx=TokenAmount(Asset.USDC, 500_000_000, 6),
    # 5,000 USDC lifetime per session key. §4 gives no separate ceiling.
    session_cumulative=TokenAmount(Asset.USDC, 5_000_000_000, 6),
)

# policy-schema.md §5 — slippage floors/ceilings (bps). Swaps only.
SLIPPAGE = SlippageConfig(
    user_max_bps=50,
    protocol_floor_bps=50,
    absolute_ceiling_bps=300,
    applies_to=(ActionType.AERODROME_SWAP,),
)

# policy-schema.md §6 — session-scope bounds (N4).
SESSION_BOUNDS = SessionBounds(
    max_session_duration_days=30,
    allowlist_must_be_subset_of_global=True,
    forbidden_selectors=(
        "0x095ea7b3",  # approve(address,uint256)     — never self-grant spend power (N1/N4)
        "0xa9059cbb",  # transfer(address,uint256)    — never move funds to a non-user recipient
        "0x23b872dd",  # transferFrom(address,address,uint256)
        "0x",  # arbitrary / empty-calldata call — never reach unknown code
    ),
)

# policy-schema.md §4.1 / smart-contracts.md §6.1 — profit-only performance-fee bound.
GOVERNANCE = GovernanceParams(
    performance_fee=PerformanceFeeBound(default_bps=1000, ceiling_bps=2000)
)

# policy-schema.md §2.4 — canonical ActionType → Direction map. Mirrors the
# per-entry ``direction`` in the allowlist below PLUS the two account-level session
# ops (grant=inflow, revoke=exit) that are NOT (target,selector) allowlist entries.
# Load-bearing for the exit-skip branches (§8 steps 4 & 7); a module-load assert
# below verifies it agrees with every allowlist entry (drift guard).
ACTION_DIRECTION: dict[ActionType, Direction] = {
    ActionType.VAULT_DEPOSIT: Direction.INFLOW,
    ActionType.VAULT_WITHDRAW: Direction.EXIT,
    ActionType.VAULT_REDEEM: Direction.EXIT,
    ActionType.AAVE_SUPPLY: Direction.INFLOW,
    ActionType.AAVE_WITHDRAW: Direction.EXIT,
    ActionType.AERODROME_SWAP: Direction.OUTFLOW,
    ActionType.SESSION_KEY_GRANT: Direction.INFLOW,
    ActionType.SESSION_KEY_REVOKE: Direction.EXIT,
}


# ─────────────────────────────────────────────────────────────────────────────
# Allowlist tables (policy-schema.md §3). Selectors verified with `cast sig`.
# ``session_key_grant`` / ``session_key_revoke`` are account-level ops
# (authorizeSessionKey / revokeSessionKey on SparkPointAccount), NOT protocol
# (target,selector) entrypoints, so they are intentionally absent here.
# ─────────────────────────────────────────────────────────────────────────────

# Base mainnet (8453) allowlist. Also used verbatim by the localFork (31337) Anvil
# fork of Base mainnet (R14 — localFork uses the Base-mainnet targets).
_BASE_MAINNET_ALLOWLIST: tuple[AllowlistEntry, ...] = (
    AllowlistEntry(
        protocol=Protocol.SPARKPOINT_VAULT,
        target_ref="sparkpoint_vault",
        selector="0x6e553f65",  # deposit(uint256,address)
        action=ActionType.VAULT_DEPOSIT,
        direction=Direction.INFLOW,
        assets=(Asset.USDC,),
        recipient_must_be="user_account",
        cap_gated=True,
        pause_gated=True,
    ),
    AllowlistEntry(
        protocol=Protocol.SPARKPOINT_VAULT,
        target_ref="sparkpoint_vault",
        selector="0xba087652",  # redeem(uint256,address,address)
        action=ActionType.VAULT_REDEEM,
        direction=Direction.EXIT,
        assets=(Asset.USDC,),
        recipient_must_be="user_account",
        cap_gated=False,  # N2 — exit is never gated
        pause_gated=False,
    ),
    AllowlistEntry(
        protocol=Protocol.SPARKPOINT_VAULT,
        target_ref="sparkpoint_vault",
        selector="0xb460af94",  # withdraw(uint256,address,address)
        action=ActionType.VAULT_WITHDRAW,
        direction=Direction.EXIT,
        assets=(Asset.USDC,),
        recipient_must_be="user_account",
        cap_gated=False,  # N2
        pause_gated=False,
    ),
    AllowlistEntry(
        protocol=Protocol.AAVE_V3,
        target_ref="aave_v3_pool",
        selector="0x617ba037",  # supply(address,uint256,address,uint16)
        action=ActionType.AAVE_SUPPLY,
        direction=Direction.INFLOW,
        # onBehalfOf forced to account; native-ETH gateway is a separate deferred entry.
        assets=(Asset.USDC, Asset.ETH),
        recipient_must_be="user_account",
        cap_gated=True,
        pause_gated=True,
    ),
    AllowlistEntry(
        protocol=Protocol.AAVE_V3,
        target_ref="aave_v3_pool",
        selector="0x69328dec",  # withdraw(address,uint256,address)
        action=ActionType.AAVE_WITHDRAW,
        direction=Direction.EXIT,
        assets=(Asset.USDC, Asset.ETH),
        recipient_must_be="user_account",
        cap_gated=False,  # N2
        pause_gated=False,
    ),
    AllowlistEntry(
        protocol=Protocol.AERODROME,
        target_ref="aerodrome_router",
        # swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)
        # Route = {from,to,stable,factory}; selector via `cast sig` (smart-contracts.md §7).
        selector="0xcac88ea9",
        action=ActionType.AERODROME_SWAP,
        direction=Direction.OUTFLOW,
        assets=(Asset.USDC, Asset.ETH),
        recipient_must_be="user_account",
        cap_gated=True,
        pause_gated=True,
        slippage_bound=True,
        # routes constrained to the whitelisted factory (§3).
        route_factory_must_be="aerodrome_factory",
    ),
)

# Base Sepolia (84532): mainnet minus Aerodrome, plus an ``undeployed`` Aerodrome
# placeholder (no Base-Sepolia deployment; swaps are fork-only) that
# ``get_policy_constants`` filters out (fail-closed).
_BASE_SEPOLIA_ALLOWLIST: tuple[AllowlistEntry, ...] = (
    *(e for e in _BASE_MAINNET_ALLOWLIST if e.protocol is not Protocol.AERODROME),
    AllowlistEntry(
        protocol=Protocol.AERODROME,
        target_ref="aerodrome_router",
        selector="0xcac88ea9",
        action=ActionType.AERODROME_SWAP,
        direction=Direction.OUTFLOW,
        assets=(Asset.USDC, Asset.ETH),
        recipient_must_be="user_account",
        cap_gated=True,
        pause_gated=True,
        slippage_bound=True,
        route_factory_must_be="aerodrome_factory",
        # TODO_VERIFY: no Aerodrome on Base Sepolia — fork-only; excluded from resolved allowlist.
        undeployed=True,
    ),
)

# §B3 — Robinhood testnet (46630): EMPTY allowlist by design. The vault is Base-only and the only
# on-chain Aave-like venue here is an unofficial, resettable "stock market" pilot we must NEVER
# target. An empty allowlist makes every (target, selector) action fail allowlisting (fail-closed),
# so BUILD_ACTION on 46630 correctly refuses with "not supported on this network".
_ROBINHOOD_TESTNET_ALLOWLIST: tuple[AllowlistEntry, ...] = ()

# Raw (unfiltered) allowlist per chain — includes ``undeployed`` placeholders.
_ALLOWLIST_BY_CHAIN: dict[int, tuple[AllowlistEntry, ...]] = {
    8453: _BASE_MAINNET_ALLOWLIST,
    84532: _BASE_SEPOLIA_ALLOWLIST,
    31337: _BASE_MAINNET_ALLOWLIST,  # Anvil fork of Base mainnet (R14)
    46630: _ROBINHOOD_TESTNET_ALLOWLIST,  # §B3 vault Base-only ⇒ empty (fail-closed)
}


# ─────────────────────────────────────────────────────────────────────────────
# Address book mirror (packages/shared/src/addresses/*). Only the fields a policy
# ``TargetRef`` resolves through are needed here; the deploy-time SparkPoint vault
# stays ``None`` (fail-closed) exactly as in the shared address books.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AddressBook:
    """The subset of packages/shared AddressBook needed for TargetRef resolution."""

    chain_id: int
    aave_pool: str
    usdc: str
    weth: str
    aerodrome_router: str | None = None
    aerodrome_factory: str | None = None
    vault: str | None = None  # deploy-time-determined ⇒ None here (fail-closed)


# Base mainnet (8453) — on-chain-verified 2026-07-13 (see addresses/base.ts).
_BASE_ADDRESSES = AddressBook(
    chain_id=8453,
    aave_pool="0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    usdc="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth="0x4200000000000000000000000000000000000006",
    aerodrome_router="0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    aerodrome_factory="0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    vault=None,
)

# Base Sepolia (84532) — Aerodrome undeployed (None); Aave-market test USDC.
_BASE_SEPOLIA_ADDRESSES = AddressBook(
    chain_id=84532,
    aave_pool="0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
    usdc="0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
    weth="0x4200000000000000000000000000000000000006",
    aerodrome_router=None,
    aerodrome_factory=None,
    vault=None,
)

# localFork (31337) mirrors Base mainnet (Anvil fork of Base mainnet — R14).
_LOCAL_FORK_ADDRESSES = AddressBook(
    chain_id=31337,
    aave_pool=_BASE_ADDRESSES.aave_pool,
    usdc=_BASE_ADDRESSES.usdc,
    weth=_BASE_ADDRESSES.weth,
    aerodrome_router=_BASE_ADDRESSES.aerodrome_router,
    aerodrome_factory=_BASE_ADDRESSES.aerodrome_factory,
    vault=None,
)

# §B3 — Robinhood testnet (46630): NO official Aave/USDC/WETH deployment; the vault is Base-only.
# The token/pool fields are the zero address (a non-target) — they are NEVER used because the 46630
# allowlist is empty (every action fails closed) and no action target resolves through them. Present
# only so ``get_addresses(46630)`` honors the same supported-chain contract as get_policy_constants.
_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
_ROBINHOOD_TESTNET_ADDRESSES = AddressBook(
    chain_id=46630,
    aave_pool=_ZERO_ADDRESS,
    usdc=_ZERO_ADDRESS,
    weth=_ZERO_ADDRESS,
    vault=None,  # vault is Base-only (fail-closed everywhere off Base)
)

_ADDRESSES_BY_CHAIN: dict[int, AddressBook] = {
    8453: _BASE_ADDRESSES,
    84532: _BASE_SEPOLIA_ADDRESSES,
    31337: _LOCAL_FORK_ADDRESSES,
    46630: _ROBINHOOD_TESTNET_ADDRESSES,  # §B3 — no real targets (empty allowlist)
}

# TargetRef → AddressBook field. A new TargetRef without a mapping here raises at
# resolution (fail-closed) rather than silently resolving to None.
_TARGET_REF_FIELD: dict[TargetRef, str] = {
    "sparkpoint_vault": "vault",
    "aave_v3_pool": "aave_pool",
    "aerodrome_router": "aerodrome_router",
    "aerodrome_factory": "aerodrome_factory",
}


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


def get_addresses(chain_id: int) -> AddressBook:
    """The address book for ``chain_id``.

    :raises ValueError: if ``chain_id`` is unsupported (fail-closed — same contract
        as ``get_policy_constants``).
    """
    book = _ADDRESSES_BY_CHAIN.get(chain_id)
    if book is None:
        raise ValueError(
            f"get_addresses: unsupported chainId {chain_id} "
            f"(supported: {', '.join(map(str, SUPPORTED_CHAIN_IDS))})"
        )
    return book


def resolve_target_ref(
    chain_id: int,
    ref: TargetRef,
    overrides: dict[str, str] | None = None,
) -> str | None:
    """Resolve a policy ``TargetRef`` to its concrete address on ``chain_id``.

    This is the join that forms the ``(target, selector)`` pair the on-chain
    ``PolicyModule`` and the T098 drift check compare.

    ``overrides`` supplies deploy-time-determined addresses (the SparkPoint vault)
    that are ``None`` in the static address book — the Coordinator passes the fresh,
    deployed addresses here from live chain reads. An override always wins.

    Returns ``None`` when the target is not deployed / not yet known on this chain
    (Aerodrome on Base Sepolia; the vault before deploy). This is fail-closed by
    design: a ``None`` target cannot form a ``(target, selector)`` pair, so the
    action correctly fails allowlisting — never silently permitted.

    :raises ValueError: if ``chain_id`` is unsupported (via ``get_addresses``).
    """
    if overrides is not None and ref in overrides:
        return overrides[ref]
    book = get_addresses(chain_id)
    resolved: str | None = getattr(book, _TARGET_REF_FIELD[ref])
    return resolved


def get_policy_constants(chain_id: int) -> PolicyConstants:
    """The per-chain policy constant bundle (R14).

    The allowlist is keyed by ``chain_id`` (8453 · 84532 · 31337-localFork); caps,
    slippage, session bounds, and governance are chain-independent per the spec.

    The returned ``allowlist`` is fail-closed: ``undeployed`` placeholder entries
    are filtered out, so an action against an undeployed target correctly fails
    allowlisting rather than being silently permitted.

    :raises ValueError: if ``chain_id`` is not one of the supported chains (fail-closed).
    """
    allowlist = _ALLOWLIST_BY_CHAIN.get(chain_id)
    if allowlist is None:
        raise ValueError(
            f"get_policy_constants: unsupported chainId {chain_id} "
            f"(supported: {', '.join(map(str, SUPPORTED_CHAIN_IDS))})"
        )
    return PolicyConstants(
        policy_version=POLICY_VERSION,
        chain_id=chain_id,
        caps=CAPS,
        slippage=SLIPPAGE,
        allowlist=tuple(e for e in allowlist if not e.undeployed),
        session_bounds=SESSION_BOUNDS,
        governance=GOVERNANCE,
    )


# Drift guard (fail-closed at import): every protocol allowlist entry's direction
# MUST agree with the canonical ACTION_DIRECTION map, and every TargetRef must have
# a resolution field. A mismatch is a construction error, not a silent pass.
for _entry in _BASE_MAINNET_ALLOWLIST:
    assert ACTION_DIRECTION[_entry.action] is _entry.direction, (  # noqa: S101
        f"ACTION_DIRECTION drift for {_entry.action}: "
        f"{ACTION_DIRECTION[_entry.action]} != {_entry.direction}"
    )
    assert _entry.target_ref in _TARGET_REF_FIELD, (  # noqa: S101
        f"unresolvable target_ref {_entry.target_ref}"
    )
del _entry
