# Data Model: Universal Vaults (010)

**Created**: 2026-07-21 · **Branch**: `010-universal-vaults` · **Spec**: [spec.md](./spec.md)

No **new database entity** and **no migration**. Everything 010 adds is either (a) a compile-time registry
(code + the shared `AddressBook`), (b) an in-memory, fail-open market-data snapshot cached for the request,
or (c) a read-only, on-chain-derived view. The vault schema, the `content_entries` tables, and the policy
tables are untouched. These are the **in-app shapes** the feature adds or changes; field notes call out the
invariants tests MUST enforce, and every shape carries the load-bearing 010 constraint: **advisory,
read-only, never policy-cleared** (see [plan.md](./plan.md) Constitution Check + the no-widen FR in
[spec.md](./spec.md), which mirrors 007 `FR-024`).

> **Companion feature.** 010 is the read/advisory half; **011 (`011-wrapper-vault-factory`)** is the
> execution/manage half. The `VaultMeta` registry and the generic ERC-4626 reader defined here are the
> shared substrate **consumed** by 011's manage surface and wrapper reads. 010 adds **zero** execution path;
> anything signable/custodial is 011's scope and re-uses these shapes read-only. Cross-ref: 010 US3
> read-only `/admin/vaults` ↔ 011 US4 manage half.

---

## 1. `VaultMeta` — the universal registry entry (NON-policy)

The single metadata row that makes "adding a vault = a registry row". Authored in **two mirrored places**
(Python for the agent, TS for the web), both **plain data, NOT a policy `TargetRef`** — a `VaultMeta` can
never form a `(target, selector)` pair, never enters `TARGET_REF_FIELD`, and has zero T098 parity impact.

**Python** — `services/agent/src/sparkpoint_agent/config.py` (a frozen dataclass, list on `AgentConfig`).
**TS** — `AddressBook.vaults?: readonly VaultMeta[]` in `packages/shared/src/addresses/types.ts`
(per-chain book: `base.ts` / `baseSepolia.ts` / `robinhoodTestnet.ts`).

| Field | Type | Notes |
|---|---|---|
| `chainId` | number | The chain the `address` lives on. MUST equal the enclosing `AddressBook.chainId` (TS) / `AgentConfig.chain_id` scope (Py). |
| `address` | `0x${string}` / str | The ERC-4626 vault address. Read-only target. **Never** added to `policy/enums.py Protocol`, the candidate set, or `packages/shared/src/policy/enums.ts`. |
| `protocol` | `'sparkpoint' \| 'morpho' \| 'quicknode_earn' \| 'external'` | **Descriptive label only** — a DIFFERENT namespace from the policy `Protocol` enum (`aave_v3`/`aerodrome`/`sparkpoint_vault`). Drives the UI badge + honesty copy, never signability. |
| `abiKind` | `'sparkpoint' \| 'erc4626'` | Which reader method set applies (§2). `sparkpoint` ⇒ the full SparkPoint superset; `erc4626` ⇒ the generic-4626 core only. |
| `asset` | `0x${string}` / str | The vault's underlying (`asset()`). Verified on-chain by the reader; the registry value is a hint, on-chain is authoritative. |
| `assetDecimals` | number | Underlying decimals. **On-chain `decimals()` is authoritative for scaling** — the registry value is a display hint only, re-resolved by the reader; clamp/reject `> 36`. |
| `verified` | boolean | true ⇒ operator-curated entry known-good on this chain. A **badge + honesty gate**, never a signability gate (there is nothing to sign in 010). |
| `label` | string | Human display name (e.g. "SparkPoint Aave Vault", "Morpho Gauntlet USDC"). Sanitized before display; never a trust signal. |
| `apySource` | `'morpho' \| 'defillama' \| 'onchain' \| 'none'` | Which market-data provider (§3) supplies this vault's APY/TVL. `none` ⇒ show state only, no yield figure. |

**Invariants**
- The conservative **Aave launch vault** is exactly ONE row: `protocol:'sparkpoint'`, `abiKind:'sparkpoint'`,
  `verified:true`, `address == vault_address` / `AddressBook.vault`. In 010 (advisory/read-only) it is the
  ONLY vault the app labels "a SparkPoint vault"; every other row renders as **external market context**
  (Constitution III/V). The "exactly one" bound is scoped to the **launch Aave vault**, not to
  `abiKind:'sparkpoint'`: companion 011 may — only after the super-majority amendment — add SparkPoint-
  **branded wrapper** rows (`protocol:'morpho'`, `abiKind:'sparkpoint'`) that are distinct from this vault.
- `protocol` and `apySource` never influence policy. A registry that is empty or all-external MUST NOT
  change any candidate the recommender proposes or any `(target,selector)` the policy engine permits.
- Adding a Morpho/QuickNode-Earn row is a metadata-only change: it MUST NOT touch `policy/enums.py`,
  `packages/shared/src/policy/enums.ts`, `TARGET_REF_FIELD`, or `dag.py`'s candidate builder.

---

## 2. ERC-4626 reader method split (`_REQUIRED_METHODS` → core + extras)

`services/agent/src/sparkpoint_agent/chain/vault_reader.py` today validates ONE frozenset
`_REQUIRED_METHODS` against the single SparkPoint ABI. 010 splits it so a generic ERC-4626 vault (Morpho,
QuickNode-Earn) can be read with the standard subset, while the SparkPoint vault still requires its full
superset. **Still read-only, still `view`/`pure`-filtered, still keyless** — the reader can no more encode a
state-changing call for an external vault than for the SparkPoint one.

```python
# NEW — the EIP-4626 (+ ERC-20) standard read surface every registered vault must expose.
_ERC4626_CORE_METHODS: frozenset[str] = frozenset({
    "asset", "totalAssets", "totalSupply", "decimals", "balanceOf",
    "convertToAssets", "convertToShares",
    "maxDeposit", "maxMint", "maxWithdraw", "maxRedeem",
    "previewDeposit", "previewMint", "previewWithdraw", "previewRedeem",
})

# NEW — the SparkPoint-only extras (fee/pause/HWM). NOT part of a generic 4626 vault.
_SPARKPOINT_EXTRA_METHODS: frozenset[str] = frozenset({
    "paused", "performanceFeeBps", "highWaterMark", "feeRecipient",
})

# Back-compat: the existing name stays the SparkPoint superset (drift guard unchanged).
_REQUIRED_METHODS = _ERC4626_CORE_METHODS | _SPARKPOINT_EXTRA_METHODS
```

| Reader mode | Method set required | Missing-method behavior |
|---|---|---|
| `abiKind='sparkpoint'` | `_REQUIRED_METHODS` (superset) | Fail-closed `VaultUnavailable` (drift guard, unchanged). |
| `abiKind='erc4626'` | `_ERC4626_CORE_METHODS` only | A vault missing a core method ⇒ that vault is `unavailable` in the registry view (fail-**open** — the app degrades, it does not crash). SparkPoint-extra reads simply absent (no fee/pause/HWM shown for external vaults). |

**Invariants**
- The method registry stays filtered to `view`/`pure` (non-custody N1/N2): it is structurally impossible to
  encode `deposit`/`withdraw`/`approve` for ANY vault, external or SparkPoint, through this client.
- `decimals`/`convertTo*` for an external vault are read from THAT vault's chain, never re-derived in Python
  (same rule as the SparkPoint reader).
- A malformed/hostile external vault (reverting reads, absent bytecode, `decimals > 36`) yields a typed
  `VaultUnavailable` → "unavailable", **never a fabricated or `0` figure**.

---

## 3. `StrategyMarket` + per-candidate `MarketData` (the yield feed)

Today `_build_chain_context` sets one request-level `MarketData(gross_apy_bps=None, projected_apy_bps=None)`
→ the AI is **yield-blind**. 010 wires a keyless, fail-open feed so each candidate/vault carries its own
live figures, **advisory only**.

### 3a. `StrategyMarket` (NEW) — one vault's live market snapshot

`services/agent/src/sparkpoint_agent/data/market_data.py`

```python
@dataclass(frozen=True)
class StrategyMarket:
    """One vault's READ market figures, net of fees, for ranking + prose. NEVER invented."""
    vault_address: str                 # keys back to a VaultMeta row
    net_apy_bps: int | None = None     # net of all fees; None ⇒ "unavailable" (never 0-as-unknown)
    tvl_usd: int | None = None
    source: str = "unavailable"        # 'morpho' | 'defillama' | 'onchain' | 'unavailable'
    as_of: str | None = None           # ISO8601 of the upstream figure
    is_external: bool = True           # False ONLY for the SparkPoint launch vault
    is_estimated: bool = True          # True ⇒ label "estimated / external / not a SparkPoint vault"
    stale: bool = False                # feed older than the freshness budget
    citations: tuple[Citation, ...] = ()
```

| Field | Notes |
|---|---|
| `net_apy_bps` | **Net of everything** (Constitution III). `None` renders as "unavailable" — the honest-state contract forbids substituting `0`. |
| `source` | Provenance for the citation + the "estimated/external" label. `unavailable` ⇒ no figure shown. |
| `is_external` / `is_estimated` | Drive the mandatory "external market data — not a SparkPoint vault" framing. Only the launch vault is `is_external=False`. |
| `stale` | Set when the cached snapshot exceeds the freshness budget; surfaced, figure still labeled, never silently trusted. |

### 3b. `MarketData` (EXTENDED) — `services/agent/src/sparkpoint_agent/coordinator/dag.py`

The existing per-request `MarketData` on `ChainContext` gains provenance so the SparkPoint vault's own row is
also honestly sourced, and a **map** of external snapshots the recommender/`_to_item` read per candidate:

```python
@dataclass(frozen=True)
class MarketData:
    gross_apy_bps: int | None = None
    projected_apy_bps: int | None = None
    performance_fee_bps: int = 1000
    source: str = "unavailable"                 # NEW — provenance for the SparkPoint vault figure
    as_of: str | None = None                    # NEW
    stale: bool = False                         # NEW
    external: tuple[StrategyMarket, ...] = ()    # NEW — external vaults' snapshots (advisory context)
    citations: tuple[Citation, ...] = ()
```

**Invariants**
- `MarketData.external` is **advisory input to ranking/narration only**. It feeds the recommender's ordering
  and the prose/citations; it MUST NOT alter which candidates exist, their `signable` verdict, or the policy
  gate. Removing the feed (all `unavailable`) MUST leave the set of signable candidates byte-identical.
- No figure is ever fabricated: a missing/failed feed ⇒ `None`/`unavailable`, surfaced as such.
- The launch vault's "yield from Aave v3, never token incentives" claim (Constitution III) is untouched;
  external figures are clearly disjoint (`is_external=True`, separate rows, "not a SparkPoint vault" label).

---

## 4. Web `VaultView` (`useVaults`) + `resolveErc4626` result

`apps/web/src/lib/vault/resolveErc4626.ts` (NEW) + `apps/web/src/lib/chain/useVaults.ts` (NEW), siblings of
the existing single-vault `useVault.ts` / `exit.ts`.

```ts
export interface ResolvedVault {
  meta: VaultMeta;                 // the registry row (label/protocol/verified)
  asset: `0x${string}`;            // on-chain asset()
  assetDecimals: number;           // on-chain decimals() — authoritative, clamp >36
  totalAssets?: bigint;            // TVL in asset base units (undefined ⇒ unavailable)
  sharePrice?: bigint;             // convertToAssets(1e{shareDecimals})
  paused?: boolean;                // sparkpoint abiKind only
  performanceFeeBps?: number;      // sparkpoint abiKind only
  unavailable?: 'not_deployed' | 'no_code' | 'read_failed' | 'unsupported_abi';
}
export type VaultView =
  | { status: 'ok'; vault: ResolvedVault; market?: StrategyMarketWire }
  | { status: 'unavailable'; meta: VaultMeta; reason: string };  // fail-open, per row
```

**Invariants**
- One row failing to resolve NEVER blocks the others (fail-open, per-vault) and NEVER blocks the exit path
  (`exit.ts` remains independent of `useVaults`, exactly as it is independent of `useVault`).
- APY/TVL figures shown on the web come from the same fail-open provider provenance; the SparkPoint row is
  the only one styled/labeled as a SparkPoint vault. All others carry "external · estimated" chrome.
- `useVaults` is display-plane only — like `useVault`, it signs nothing, holds no key, and gates nothing
  custodial.

---

## 5. `DerivedPortfolio` — N-vault (`apps/web/src/lib/portfolio/derive.ts`)

The closed `key: 'vault' | 'idle'` union widens to include **external** positions the user actually holds in
registered vaults (read-only), while keeping USD math honest.

```ts
export interface LivePosition {
  readonly key: 'vault' | 'idle' | `ext:${string}`;  // ext:<vaultAddress> for a registered external vault
  readonly label: string;
  readonly sub: string;
  readonly valueUsd: number;
  readonly shares?: number;
  readonly external?: boolean;   // NEW — true ⇒ "external, not a SparkPoint vault"
}
```

**Invariants**
- Only balances the user provably holds (via that vault's `balanceOf`/`convertToAssets`) are shown; external
  positions are labeled `external:true`. The SparkPoint `'vault'` position keeps its existing derivation.
- USD net-worth math keeps the existing decimals discipline (USDC 6-dp; shares == asset decimals; ETH shown
  in ETH, never converted). An external vault with an unknown-price asset is shown in its asset unit, not
  folded into the USD total (no oracle invented).

---

## 6. No database migration

010 adds **no** table, column, or migration. Rationale:
- The registry is compile-time code (`config.py` + `AddressBook.vaults[]`), so a new vault is a code review,
  not a data migration — keeping it inside the spec-driven, drift-guarded surface.
- Market data is ephemeral: fetched per request, cached **in-memory** with a short TTL, and recomputed on
  miss. Persisting external APY would risk serving stale figures as fresh (Constitution III) and add a
  custody-adjacent surface for no benefit (YAGNI, Constitution VII).
- The read-only `/admin/vaults` page (US3) reads live from the reader + provider; it stores nothing.

If a future analytics/history need appears it belongs to a later feature with its own migration and gate —
**not** 010.
