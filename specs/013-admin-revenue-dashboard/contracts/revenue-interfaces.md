# Internal Interface Contracts: Admin Revenue Dashboard (real data) (Phase 1)

This feature adds one background indexer, one aggregation store, one admin HTTP endpoint, one rebuilt web page, and one live-read balances card. Each contract below carries a test obligation. The admin endpoint is `require_admin`-gated with the invisible **404-not-403** posture and is **GET-only** (a pure read — no mutation). Every figure is ledger- or live-read-derived; nothing here touches a custody, policy, or funds-movement path.

## 1. Swap-fee indexer — `services/agent/src/sparkpoint_agent/data/swap_fee_indexer.py`

```python
class SwapFeeIndexer:
    # Copies the fee_indexer.py shape. Reuses data/log_source.py HttpxLogsRpc (eth_getLogs / receipts)
    # and _addr_from_topic (keccak-free indexed-address decode). No signing code — read-only, keyless.
    async def index_once(self, network_id: str) -> IndexResult
    # 1. read the (network, stream='swap_fee') cursor (existing indexer_cursors, 0001); first run = vault-deploy block
    # 2. eth_getLogs Transfer(topic0=ERC20_TRANSFER_TOPIC0) on the OUTPUT token(s), to == fee-recipient set,
    #    from == the swap router, up to (head - FINALITY_MARGIN)
    # 3. for each: fee_value_raw = uint256(data); token_decimals via a cached decimals() read
    # 4. idempotent upsert into swap_fee_events ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING
    # 5. advance the cursor only to (head - FINALITY_MARGIN); re-scan unfinalized blocks next pass

ERC20_TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
# router / fee-recipient set / vault-deploy block are per-network non-key constants read outside AgentConfig.
```

Runs as a background loop in `main.py` (mirror `_index_vault_flows_loop`) — best-effort, fail-open, never on the request path.

**Contract test obligations**: a token-out fee `Transfer(from == router, to == recipient)` is recorded as exactly one `swap_fee_events` row with the correct output token + `fee_value_raw`; a re-run over the same range records **zero** duplicates (idempotent — SC-003); the cursor advances only past `FINALITY_MARGIN` and a reorged-out block leaves **zero** retained rows on re-scan (SC-009); an inbound transfer whose `from` is **not** the router (a membership `from == buyer`, or a perf transfer) to a **shared** recipient address is **rejected**, never ingested (SC-004 / D7); the backfill starts at the vault-deploy block so the first cumulative reflects inception (D6); the native-ETH-out leg (no log) is absent and surfaced as a disclosure, never silently absorbed (SC-005).

## 2. Swap-fee store + aggregation — `services/agent/src/sparkpoint_agent/db/swap_fees.py`

```python
@dataclass
class PgSwapFeeEventStore:                              # mirrors PgFeeEventStore
    db: Database
    async def record(self, ev: SwapFeeEvent) -> bool    # idempotent insert; returns False on conflict (already seen)
    async def fetch(self, network_id: str, *, since=None, until=None) -> list[SwapFeeEventRow]
    async def revenue_summary(                          # Python aggregation over fetched rows (provable from the same rows)
        self, network_id: str, *, since=None, until=None, period: str = "month",
    ) -> SwapFeeRevenueSummary                          # cumulative_fee_raw + per-period SwapFeePeriodBucket[]
```

**Contract test obligations**: `record` is idempotent on `(network_id, tx_hash, log_index)`; `revenue_summary` sums only stored (`from == router`) rows in base units and never fabricates a USD figure (D13); a network with no rows yields a **real** cumulative `0` (distinct from `configured:false`, which is decided at the endpoint from source availability — D2); per-period buckets truncate `block_time` the same way `FeeIndexer._bucket_periods` does.

## 3. Admin revenue summary API — `services/agent/src/sparkpoint_agent/api/admin_revenue.py`

```text
GET /admin/revenue/summary                              -> RevenueSummary
# RevenueSummary = { swap: StreamSeries, perf: StreamSeries, premium: StreamSeries, networkId: str }
# StreamSeries   = { configured: bool, cumulative_raw: int, token_decimals: int|null,
#                    periods: [{ period_start, value_raw }], disclosures: [str] }
```

```python
@router.get("/admin/revenue/summary")
async def revenue_summary(
    admin: Annotated[AccountContext, Depends(require_admin)],   # 404 to non-admins (invisible)
    ...
) -> dict[str, object]:
    # each stream resolved in its OWN try/except -> configured:false on failure (mirror admin_usage.py):
    #   swap    = PgSwapFeeEventStore.revenue_summary(network_id)            + native-ETH under-count disclosure
    #   perf    = FeeIndexer(...).revenue_summary(network_id, vault_address, period="month")   (reused, NOT re-derived)
    #   premium = SUM(payments.amount_raw) by period from feature 012's ledger (verified rows only)
```

All `Depends(require_admin)`; keyed on the server-verified `X-Owner`, never a client claim. Each stream honest-degrades independently; a real `$0` is distinct from `configured:false`. The swap stream's `disclosures` always carries the native-ETH-out under-count note when configured.

**Contract test obligations**: a non-admin gets `404` (not 403) — SC-010; one dead source degrades only its own stream (`configured:false`) and never blanks the others — SC-002; the perf stream **exactly equals** `FeeIndexer.revenue_summary` over the same `fee_events` (parity test — SC-006); the membership stream sums **verified** payments only and returns `configured:false` when 012's `payments` table is absent — SC-007; no fabricated or projected number is ever returned (FR-001/FR-021); values are base units with `token_decimals`, no USD invented (D13). Mounted in `main.py` with one `include_router(admin_revenue_router)` line.

## 4. Rebuilt Revenue page — `apps/web/src/app/admin/revenue/page.tsx`

```ts
const CHAIN_HEADERS = { "x-chain-id": "84532" };
async function loadRevenue(): Promise<RevenueSummary> {
  const r = await fetch("/api/agent/admin/revenue/summary", { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load revenue (${r.status})`);
  return (await r.json()) as RevenueSummary;
}
// loaded / loadErr / busy state (useCallback refresh + useEffect on mount) — the admin/gateway page pattern.
// DELETE: import { revByStream, ... } from "@/components/admin/data"  and the inline "Sample data" pill.
// KEEP VERBATIM: import { StackedBars, Trajectory, DualArea, Composed, Kpi, LegendStreams } from "@/components/admin/charts"
//   — they take plain number[] / {x,...}[] + a computed max; wiring real series = "fetch, compute max, pass in".
```

**Contract test obligations**: the page performs **zero** reads from `components/admin/data.tsx` (`revByStream` import removed) and no `$13.9K`/`$82.8K` literal renders (SC-001); a `configured:false` stream renders an explicit not-instrumented state with **no** number, per-stream, without blanking the others (SC-002); the page-level "Sample data" pill is gone once any stream is live and a still-degrading stream keeps an honest affordance (FR-003); an entirely unreachable endpoint degrades honestly ("cannot load") rather than reverting to a mock series (FR-004); the `charts.tsx` primitives are imported unchanged (only real series + a computed `max` passed in — D11); identity is never client-supplied (only `x-chain-id` crosses; the BFF injects `x-owner` from the session).

## 5. Multisig balances card — `apps/web/src/components/admin/revenue-multisig.tsx`

```ts
// Live on-chain reads only — no indexer, no migration, no snapshot. viem PublicClient (lib/chain/clients.ts).
const client = getPublicClient(chainId);
const native = await client.getBalance({ address: safe });                                  // eth_getBalance
const bal    = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [safe] });
// safe = getAddresses(chainId).feeTreasury (owned by feature 014); undefined ⇒ honest-degrade (configured:false).
// The card STATES the Safe's actual on-chain power: a plain recipient/holder, nil authority over user funds (N5).
```

**Contract test obligations (live, non-destructive probe)**: with the Safe configured, the card's native + ERC-20 balances match a block explorer for the same address at the same block (SC-008); with no Safe address, the card honest-degrades ("unavailable") rather than showing a placeholder balance (FR-019); **no** migration and **no** stored balance row is introduced (SC-008); the stated power reflects the Safe's real (nil over user funds) authority, proving N5 rather than asserting it (FR-019).

## 6. Non-key display constants — `services/agent/src/sparkpoint_agent/api/main.py` / new modules

```python
# Read directly in the new modules (like main.py reads PREMIUM_ALLOWLIST), NOT funneled through AgentConfig,
# to preserve that module's provable-keyless posture (_assert_no_key_material). None are key-bearing.
SWAP_ROUTER[network]            # the SwapRouter02 address (Base Sepolia 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4)
FEE_RECIPIENT_SET[network]      # a SET of recipients (union old EOA + new 014 Safe across the cutover block — D14)
VAULT_DEPLOY_BLOCK[network]     # backfill anchor for an honest first cumulative
# The Safe address for the balances card is NOT a 013 constant — it is feature 014's FEE_WALLET_ADDRESS
# (normalized into AgentConfig by 014); the address book exposes it as feeTreasury.
```

**Contract test obligations**: absent constants degrade the relevant stream/card to `configured:false` rather than crashing (fail-open); the fee-recipient filter is a **set** so a 014 recipient cutover does not drop the swap stream at the cutover block (D14); fee values are recorded/summed in each token's base units with its decimals — no USD conversion is fabricated (D13).
