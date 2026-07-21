# Internal Interface Contracts: Universal Vaults (010)

**Created**: 2026-07-21 · **Branch**: `010-universal-vaults`

This feature adds **no HTTP endpoint and no on-chain contract**. The "contracts" are the internal module
interfaces the advisory + read surfaces depend on: (1) the generic ERC-4626 reader (Python + web), (2) the
market-data provider (Python primary, web thin consumer), (3) the shared `AddressBook.vaults[]` registry
field, and (4) the recommender/`ChainContext` wiring. Each has a **test obligation**. The overriding
contract across all of them: **read-only + advisory; Morpho/QuickNode-Earn are NEVER policy-cleared,
signable, or reachable by the policy engine or vault** (see [plan.md](../plan.md) Constitution Check + the
no-widen FR in [spec.md](../spec.md), mirroring 007 `FR-024`).

> **Companion 011.** The generic reader (§1) and the market provider (§2) are the substrate 011
> (`011-wrapper-vault-factory`) consumes for its manage/wrapper half. 010 exposes only reads; any signable
> path is 011's and out of scope here.

---

## 1. Generic ERC-4626 reader

### 1a. Python — `services/agent/src/sparkpoint_agent/chain/vault_reader.py`

Splits the single `_REQUIRED_METHODS` into `_ERC4626_CORE_METHODS` + `_SPARKPOINT_EXTRA_METHODS`
(data-model §2) and generalizes the reader to a registry entry, keeping the existing single-vault reader as
the `abiKind='sparkpoint'` path.

```python
def read_vault(cfg: AgentConfig, meta: VaultMeta) -> VaultSnapshot: ...
# view/pure-filtered method registry, keyed by abiKind:
#   'sparkpoint' → validate against _REQUIRED_METHODS (superset), fail-CLOSED on drift (unchanged).
#   'erc4626'    → validate against _ERC4626_CORE_METHODS, fail-OPEN per vault (→ VaultUnavailable).
# Reads asset()/decimals() ON-CHAIN (authoritative); NEVER re-derives 4626 math in Python.
# Only eth_call / eth_blockNumber are ever issued — never eth_sendTransaction (non-custody N1/N2).
```

**Contract test obligations**
- Reads a generic 4626 vault (mock ABI) via the core set; returns real `totalAssets`/`convertToAssets`.
- A vault missing a core method ⇒ typed `VaultUnavailable` (fail-open), **not** a crash, **not** a `0`.
- SparkPoint vault still requires the full superset (drift guard preserved) — dropping an extra method
  fails **closed** for `abiKind='sparkpoint'`.
- **Non-custody structural test**: no state-changing selector (`deposit`/`withdraw`/`approve`) is registrable
  for ANY `abiKind`; the registry is `view`/`pure` only.
- A hostile external vault (revert / no bytecode / `decimals > 36`) ⇒ "unavailable", never fabricated.

### 1b. Web — `apps/web/src/lib/vault/resolveErc4626.ts`

```ts
export async function resolveErc4626(
  chainId: number, meta: VaultMeta,
): Promise<VaultView>   // data-model §4; fail-open per row; on-chain decimals authoritative (clamp >36)
// Uses wagmi transport (react-query), multicall allowFailure. SparkPoint extras (paused/fee/HWM)
// read ONLY when meta.abiKind === 'sparkpoint'. Signs nothing; independent of exit.ts.
```

**Contract test obligations**: resolves a generic 4626 row (asset/decimals/totalAssets/sharePrice); returns
`{status:'unavailable'}` on no-code / read failure without throwing; reads SparkPoint extras only for the
`sparkpoint` abiKind; a one-row failure does not reject the batch (`useVaults` returns a mixed list).

### 1c. Web hook — `apps/web/src/lib/chain/useVaults.ts`

```ts
export function useVaults(chainId?: number): { vaults: VaultView[]; isLoading: boolean }
// Iterates getAddresses(chainId).vaults ?? [] → resolveErc4626 each, fail-open, display-plane only.
// The single-vault useVault.ts is unchanged; useVaults is additive.
```

**Contract test obligations**: an empty/absent `vaults[]` ⇒ `[]` (no throw, app still renders the single
SparkPoint vault via `useVault`); a mixed available/unavailable registry renders both without one blocking
the other.

---

## 2. Market-data provider

### 2a. Python — `services/agent/src/sparkpoint_agent/data/market_data.py` (NEW)

Keyless, fail-open, cached in-memory. Primary = Morpho GraphQL (`https://api.morpho.org/graphql`, public,
keyless, ~750 req/min, no SLA, **mainnet-only**); fallbacks = DeFiLlama / on-chain-derived. All figures **net
of fees**; a miss ⇒ `unavailable` (never `0`, never fabricated).

```python
class MarketDataProvider(Protocol):
    async def snapshots(self, chain_id: int, vaults: Sequence[VaultMeta]) -> dict[str, StrategyMarket]: ...
    # returns {vault_address: StrategyMarket}; addresses with no live figure are OMITTED or 'unavailable'.

class MorphoGraphQLProvider(MarketDataProvider): ...     # primary; MAINNET (8453) only
class DeFiLlamaProvider(MarketDataProvider): ...         # fallback (yields.llama.fi)
class OnChainDerivedProvider(MarketDataProvider): ...    # last resort: rate-from-index over a window
class CompositeMarketProvider(MarketDataProvider):
    """Try providers in order per vault; first real figure wins; all fail ⇒ 'unavailable'.
    Timeouts/HTTP errors NEVER propagate — they degrade to 'unavailable' (fail-open)."""
```

Env (documented in `DEVELOPMENT.md`, all optional, keyless-by-default):
`MARKET_DATA_ENABLED` (default `true`), `MORPHO_GRAPHQL_URL` (default the public endpoint),
`MARKET_DATA_TTL_SECONDS` (freshness budget), `MARKET_DATA_TIMEOUT_MS`.

**Contract test obligations**
- Morpho GraphQL success ⇒ `StrategyMarket` with `source='morpho'`, `net_apy_bps` net of fees, `as_of` set.
- Morpho timeout/5xx ⇒ **fail-open** to DeFiLlama; both fail ⇒ `unavailable` (**never `0`**, never raise).
- On a chain with no Morpho data (e.g. 84532, 46630) the provider returns `unavailable`, not a fabricated
  figure; the recommender still ranks (SparkPoint vault present, external rows "unavailable").
- Stale cache beyond TTL ⇒ `stale=True` surfaced, figure still labeled external/estimated.
- **Advisory-only test (load-bearing)**: with the provider forced to all-`unavailable`, the set of
  **signable** candidates and every policy verdict is byte-identical to the feed-populated run. The feed
  changes ORDER/PROSE only, never signability. Morpho never appears in `policy/enums.py Protocol`, the
  candidate set, or a `(target,selector)` pair.

### 2b. Recommender / context wiring — `api/recommendations.py`, `coordinator/dag.py`, `agents/recommender.py`

```python
# _build_chain_context: replace the hardcoded null MarketData with a fail-open populated one.
external = await market_provider.snapshots(account.chain_id, cfg.vaults)          # fail-open
sp = external.get(cfg.vault_address)                                              # SparkPoint's own row (if any)
market = MarketData(
    gross_apy_bps=(sp.net_apy_bps if sp else None),       # None when no feed — NEVER fabricated
    projected_apy_bps=None,                               # still no projection (Constitution III: no forecasts)
    performance_fee_bps=fee_bps,
    source=(sp.source if sp else "unavailable"),
    external=tuple(v for a, v in external.items() if a != cfg.vault_address),
)
# recommender reads MarketData.external ONLY to rank/narrate; propose() still builds the SAME code candidate
# set; the policy gate is unchanged. _to_item attaches per-candidate figures for prose/citations.
```

**Contract test obligations**: `_build_chain_context` never raises on a feed error (degrades to nulls);
`projected_apy_bps` stays `None` (no return projections, Constitution III); the recommender consumes
`external` for ordering only — proven by the byte-identical-signable test in §2a.

### 2c. Web thin consumer

The web `/admin/vaults` + multi-vault display read figures either from the agent recommendation payload
(already carrying `grossApyBps`/external rows) or, where a direct feed is desired, a mirrored fail-open
client helper `apps/web/src/lib/vault/market.ts` with the identical honesty contract (external/estimated
labels, "unavailable" not `0`). No secret, no key, CSP-safe (public keyless endpoint).

---

## 3. Shared `AddressBook.vaults[]` — a plain, NON-policy registry field

`packages/shared/src/addresses/types.ts` gains one optional field, mirroring how 007 added
`swapFeeRecipient` as a plain field (NOT a `TargetRef`):

```ts
/**
 * §010 — the universal vault registry for this chain. PLAIN optional data (NOT a policy `TargetRef`):
 * these are READ-ONLY, ADVISORY market/display targets. A `VaultMeta` NEVER enters `TARGET_REF_FIELD`,
 * never forms a `(target,selector)` pair, and has ZERO T098 parity impact. Adding an external vault here
 * grants NO execution path — the policy allowlist / Asset enum / candidate set are unchanged.
 */
readonly vaults?: readonly VaultMeta[];

export interface VaultMeta {              // data-model §1
  readonly chainId: number;
  readonly address: Address;
  readonly protocol: 'sparkpoint' | 'morpho' | 'quicknode_earn' | 'external';
  readonly abiKind: 'sparkpoint' | 'erc4626';
  readonly asset: Address;
  readonly assetDecimals: number;
  readonly verified: boolean;
  readonly label: string;
  readonly apySource: 'morpho' | 'defillama' | 'onchain' | 'none';
}
```

**Contract test obligations**
- `TARGET_REF_FIELD` is UNCHANGED — a compile-time `satisfies Record<TargetRef, keyof AddressBook>` still
  passes with NO `vaults` mapping (proving `vaults` is non-policy).
- The T098 policy-parity CI (Protocol/Asset/TargetRef parity between `enums.py` and `enums.ts`) is unaffected
  — a test asserts `Protocol` still has exactly `{aave_v3, aerodrome, sparkpoint_vault}` on both sides.
- The Python `VaultMeta`/`vaults` list mirrors the TS shape field-for-field (a small structural parity test),
  but is deliberately OUTSIDE the policy-parity surface.

---

## 4. Chat advisory wire (US4) — read-only citations, no new signable field

Chat references to external vaults reuse the existing recommendation/citation wire; the assistant cites the
`StrategyMarket.source` + `as_of` and labels each figure "external · estimated · not a SparkPoint vault".
**No new `proposedAction` field, no new `Asset`, no execution block** — an external vault can be *described*
and *compared*, never *proposed as signable*. `services/agent/src/sparkpoint_agent/coordinator/chat_blocks.py`
carries external market context as prose+citation only.

**Contract test obligations**: a chat turn comparing the SparkPoint vault to a Morpho vault emits citations
with provenance + the external/estimated label; it emits **no** `proposedAction` targeting a non-whitelisted
protocol; the deterministic gate is never invoked for an external vault (nothing signable is produced).

---

## 5. Summary of non-custody guarantees (review checklist)

| Guarantee | Enforced by |
|---|---|
| No new on-chain contract / no vault change | 010 ships zero Solidity; `SparkPointVault.sol` untouched. |
| No execution path into Morpho/QuickNode-Earn | reader is `view`/`pure`-only; provider is HTTP read; no signer anywhere in 010. |
| Policy allowlist / Asset enum / candidate set unchanged | `Protocol` parity test (§3); `propose()` candidate set is code, unchanged; byte-identical-signable test (§2a). |
| `TargetRef` surface unchanged | `TARGET_REF_FIELD` compile guard; `vaults[]` is a plain field. |
| Figures honest | fail-open "unavailable" (never `0`/fabricated); external/estimated labels; net-of-fees; no projections. |
