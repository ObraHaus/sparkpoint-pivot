# Feature Specification: Testnet activity bots + the unwired vault fee indexer

**Feature Branch**: `feat/046-testnet-activity-bots`

**Created**: 2026-08-18

**Status**: Implemented (agent half + ops tool), broadcast pending operator approval

**Input**: "our revenue share is blocked because there are no/not enough users to drive it" — plus
the follow-up decision to do **cheap testnet bots** first rather than a forked-chain simulation.

## The measured problem

Read live from Robinhood testnet 46630, Base Sepolia 84532 and the develop database, 2026-08-18:

| | |
|---|---|
| routing-fee events, ever | **8** — 2.18 test-USDC, last one 30 July |
| vault performance-fee events, ever | **0** |
| brokers with a tiered payout weight | **1** of 12 minted, across 3 wallets, all ours |
| users | **4** |
| vault TVL | 1,766.41 USDC |

Feature 044 built a weighted revenue share around a **1.0 : 2.0 : 3.3** split. With one weighted
broker there is nothing to split, and with an empty pot there is nothing to distribute.

## ⚠️ The finding that changed the shape of this work

`fee_events` is empty for **two** stacked reasons, and bots only fix one of them:

1. **`accrueFee()` has never been called.** It is `public` — permissionless — and the vault's share
   price (2.0014825) has been **above** its high-water mark (2.0002095) for some time. There is
   unrealised yield sitting there right now.
2. **Nothing ingests the event even if it were emitted.** `FeeIndexer.index()` had **no runtime
   caller** — only the read side (`revenue_summary`) was wired, from `api/admin_revenue.py`. The
   `(base, vault_fee)` cursor was still at block **0**, stamped 2026-07-14, while the `swap_fee`
   and `vault_flows` cursors were minutes fresh.

So generating vault activity without fixing (2) would have produced events nobody records. The
wiring lands first.

## Requirements

- **FR-001**: The vault's `PerformanceFeeAccrued` / `HighWaterMarkUpdated` / `FeeRateUpdated` logs
  MUST be walked and replayed into `fee_events` by a background loop, on the same terms as the
  existing indexers: off the request path, fail-open, no key, never on the withdraw path (N2).
- **FR-002**: Event `topic0` MUST be **derived** from the canonical signatures, never transcribed.
  A wrong topic matches nothing, raises nothing, and renders as "no revenue" — indistinguishable
  from an idle vault. (Feature 044 shipped two wrong hand-written selectors for this reason.)
- **FR-003**: The indexer cursor MUST NOT advance over blocks that were not successfully read, and
  a refused window MUST be retried narrower from the same start rather than skipped.
- **FR-004**: The bot tool MUST refuse to act on any chain outside a **positive** allowlist of
  `84532` and `46630`, checked against the id reported by the **live connection**.
- **FR-005**: The bot tool MUST be dry-run by default; sending requires an explicit `--broadcast`.
- **FR-006**: Every write MUST be simulated before broadcast.
- **FR-007**: Vault deposits MUST clamp to the on-chain per-wallet cap (`maxDeposit`) and to the
  wallet's balance.
- **FR-008**: Swaps MUST use the identical call shape the app builds, so the rows produced are the
  rows a real user would produce.
- **FR-009**: The tool MUST NOT reuse the project's testnet wallets or any other project's.
- **FR-010**: Swaps MUST trade a **single pinned pool tier**, never the best quote across tiers —
  both testnets carry cross-tier dislocations large enough that quote-shopping makes the fleet an
  arbitrage bot rather than a user simulator.
- **FR-011**: A trade above a configured share of the pool's LIVE reserves MUST be refused, and the
  check MUST run before any wallet is examined so it is never misreported as an underfunded bot.
- **FR-012**: Swapping MUST be disabled on any chain whose pools cannot absorb it. Base Sepolia
  qualifies: its tier-500 WETH/USDC pool holds less WETH than the funder's own balance.

## Success Criteria

- **SC-001**: A `PerformanceFeeAccrued` log becomes a `fee_events` row. *(asserted by test)*
- **SC-002**: `topic0` recomputed from the committed ABI equals the module's derivation, via a
  **different derivation path** than the module uses. *(asserted by test, mutation-checked)*
- **SC-003**: When every `eth_getLogs` window is refused, the cursor does not move and nothing
  downstream runs. *(asserted by test, mutation-checked)*
- **SC-004**: Coverage is contiguous — no block between the old cursor and the new one goes
  unqueried. *(asserted by test, mutation-checked)*
- **SC-005**: The tool refuses a mainnet RPC even when the config names a testnet. *(verified live)*
- **SC-006**: A swap simulates against the real router at the expected 0.20%.
  *(verified live on Base Sepolia before swapping there was disabled: 0.0002 ETH → 0.599614 USDC,
  fee 0.001199 USDC, 173,042 gas)*
- **SC-007**: A pinned-pool round trip costs a flat ~1% independent of size, confirming negligible
  price impact. *(verified live on Robinhood tier 3000: 0.996% at 0.0002, 0.002 and 0.02 ETH)*
- **SC-008**: An oversized trade is refused by the depth guard. *(verified live: 50 ETH refused at
  2.16% of reserves; 10 ETH allowed at 0.43%)*
- **SC-009**: Swapping on Base Sepolia is refused with the pool depth named. *(verified live)*

## Out of Scope

- Broker mint/activation bots across the three tiers — the next slice, and the one that finally
  gives 044 a real weighted split.
- Any forked-chain simulation. Assessed and deferred; see the investigation artifact.
- Changing what the client-facing surfaces display. The 044 copy rules stand unchanged.

## ⚠️ Known gap this work surfaced but does not fix

A **sell** pays its 0.20% in native ETH via `unwrapWETH9WithFee`, which emits no ERC-20 `Transfer`.
`swap_fee_indexer` matches only ERC-20 `Transfer` logs, so that fee is received and never counted.
This under-counts real user revenue too, not just the bots'. Recorded here rather than fixed,
because it needs an operator decision about how native-denominated fees should be accounted.
