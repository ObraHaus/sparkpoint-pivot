# Constitution Amendment v3.1.0 → v3.2.0 (MINOR)

**Date:** 2026-09-08 · **Reconciled:** 2026-09-16 · **Operator:** aldrickb · **Status:** proposed (ratification-by-merge on `docs/mainnet-beta-eoa-upgradeability`) · **Classification:** MINOR — additive; no non-custody invariant weakened.

> **Reconciliation (2026-09-16, pre-ratification).** Operator-confirmed: the fee sink stays **ON-CHAIN** — the immutable `RevenueSplitter` is the Pons `creatorFeeRecipient` (**no** "revenue EOA + off-chain fee-bot"). The companion `constitution.md` "Chain & scope" text is aligned to the shipped Phase-1 beta (user-signed Uniswap V3 swap + chat + portfolio; no SparkPoint contracts on 4663 yet; Morpho/wrapper vault surfaces remain a later, fail-closed integration).

Adopts the **Robin Brokers unified revenue model** for the SparkPoint Pivot beta on Robinhood mainnet (4663): the token is launched on the **Pons launchpad**, the broker NFT on **OpenSea**, and a **companion revenue engine + bots** aggregate every fee source to the reward pot for **activated / fused** brokers. Recorded in the "Beta revenue model" constraint in `constitution.md`.

## Why (operator directive)

Reuse the concept proven on Robin Brokers: "token/ERC20 launched from the Pons launchpad; fees collected added to rewards/revenue-share; the NFT launched from OpenSea; a companion engine + bots that collect ETH / ERC20 (token-trade fees, NFT royalties, vault/premium fees, and more) and route them to activated/fused NFTs." For the beta: launch a **test token on Pons** and **test NFTs on OpenSea**.

## The ported architecture

1. **Token — launched on Pons.** `PonsV2LaunchFactory.launchToken()` mints the ERC-20 on a bonding curve (we do **not** deploy our own token). Params are **immutable at launch**: `creatorFeeRecipient = the RevenueSplitter contract`, `buybackEnabled=false`, `creatorTaxBps=100` (~2% total trade fee), `pairToken=address(0)` (native-ETH revenue). Graduates (~4.2 ETH) into a Uniswap pool; the Pons hook keeps charging the fee post-graduation. **Replaces `SparkPointTestToken`.**
2. **RevenueSplitter — deploy FIRST.** Because `creatorFeeRecipient` is immutable at launch, the splitter (with a permissionless `sweepCurve` *and* `sweepPool`) must exist before the token launch. It splits every arrival **90% → engine (holder pot) / 10% → treasury**; every exit is permissionless (value can never be trapped).
3. **NFT — launched on OpenSea (SeaDrop factory clone).** A plain OpenSea factory clone (`createClone → ERC721SeaDropCloneable`) so it earns a real hosted-drop record; public drop `feeBps=1000` + OpenSea's fee recipient; server-signed allowlist phases. **Replaces the custom `SparkyBroker` + `BrokerSale` mint.** Royalties → a `RoyaltySink` → the splitter.
4. **NFT-external Engine.** Because the OpenSea clone has no transfer hooks, the engine holds the whole state machine (rank/tier, `isActive`, `activator`, `parts`/`absorbedWeight`) and reads only `ownerOf`/`burn`. It offers **activate (clockIn)**, **promote**, and **fuse** (merge two brokers → weight bonus, burn the absorbed token). Hold-to-earn is rebuilt by polling `ownerOf` (no hook). A per-weight accumulator (`accPerWeight`) advances at `settle()`; `receive()` adds to the pot.
5. **BrokerVault — value rides a resale, multi-asset.** Earned value is delivered into a vault keyed by **TOKEN ID** (not wallet), withdrawable by per-token EIP-712 signature, so a broker carries its unclaimed rewards to its next owner. The vault holds **ETH and any ERC-20** per token id.
6. **Multi-source fees → one pot, distributed AS-IS.** Token-trade fees (Pons, via RevenueSplitter) + NFT royalties (OpenSea, via RoyaltySink) + the own-router 0.20% swap fee + (as they come online) vault performance fees + Premium payments — each a permissionless feeder hop into `engine.receive()`. **Everything funds the fused NFTs.** SparkPoint's key divergence from Robin: Robin's engine takes only ETH and its keeper **swaps** it to a payout asset; SparkPoint takes **ETH and any ERC-20 and distributes each as-is (no conversion)** via a per-asset accumulator, so `deliver()` is a straight transfer and Robin's deliver-time swap gas-starvation bug does not apply. Delivery is **PUSH** (keeper settle→deliver to per-token vaults), not a per-period Merkle pull.
7. **Companion bots** (in `sparkpoint-bots-runner`): a **keeper** (`settle → sync → deliver` each round, keyed on `block.timestamp`, reads the active/fused set from the ENGINE, delivers by swapping pot ETH → per-token vault) + a **sweeper** (aggregates all fee sources). Neither holds privilege; keys + cadence live on the runner, which reports to the admin panel.

## Non-custody analysis (why MINOR, not a re-ratification)

The engine, splitter, and vault hold **protocol revenue** (fees, royalties), never user deposits — **N1 holds**. Per the v3.1.0 policy they are value-bearing, so they MUST be **IMMUTABLE (or upgrade-renounced)**: the 90/10 split and the no-drain / no-sweep guarantees must be **bytecode**, not a promise a single-EOA upgrade key could break (Robin's splitter is UUPS with `renounceOwnership()` to restore the bytecode guarantee — SparkPoint should renounce, or deploy non-upgradeable). N1–N5, the non-upgradeable *vault*, the pause-only kill-switch, and the AI-disposition rule are **UNCHANGED**.

## Delta vs SparkPoint today

| Area | Today | Becomes |
|---|---|---|
| Token | `SparkPointTestToken` — direct fixed-supply, no fee, no burn | Pons-launched bonding-curve token; trade fees fund rewards; retire/burn to activate/fuse |
| NFT | custom solady `SparkyBroker` + `BrokerSale` free mint | OpenSea SeaDrop factory clone (real drop record on 4663) |
| Rewards | `BrokerRevenueDistributor` — single-source, periodic Merkle **pull**, claiming OFF | NFT-external engine — multi-source, continuous **push** to a per-token vault |
| Fee sources | own-router 0.20% + vault perf fee → Fee Safe (not a broker pot) | all sources → 90/10 pot via splitter/sink/feeders |
| Fusion | activate + tiers only, no fuse | activate + **fuse** (merge → weight bonus, burn absorbed) |

## Gotchas carried over (from Robin's live incidents)

- ⚠️ **Post-graduation fee denomination** — the Pons hook charges in the swap's OUTPUT token; ETH-denominated checks read zero and the product looks dead. Sweeping the token leg is gated to Pons' keeper (a liveness dependency, not a loss). Monitor `pendingFees(poolId,currency)` + `pendingCreatorTax` for BOTH legs; `poolId = keccak256(abi.encode(...))` **padded**, not packed. *(This stalled Robin's real mainnet rewards on 2026-09-04.)*
- ⚠️ **OpenSea 4663 factory-gating** — only a Studio/factory-originated collection gets a drop record; a custom/self-deployed contract is display-only and shows phantom "sold out" while `totalSupply()==0`.
- ⚠️ **Keeper OOG stalls payouts silently** while the container stays green — alert on keeper wallet balance + `settledRound` lag, never container health; fund bots by hand.
- ⚠️ **Silent multicall all-fail + deliver 63/64 gas starvation** — read `isActive` in bounded chunks (≤400), drop transport JSON-RPC batching, use generous gas (2–3×), and treat a reverted-but-mined tx as a failure (`waitForTransactionReceipt` resolves on revert).
- ⚠️ **`weightOf`-zero solvency rule** — any broker drop/half-drop MUST zero `weightOf`, not just subtract from `totalWeight`, or a later permissionless settle over-pays into insolvency.
- ⚠️ **Robinhood `block.number` ≠ RPC height (~89M gap)** — key every round on `block.timestamp`, never `block.number`.
- ⚠️ **Pons can redirect the fee stream** — `creatorFeeRecipient` is changeable by Pons' owner via a 3-day timelock; monitor `CreatorFeeRecipientChangeProposed`. Disclose this external dependency.

## Resolved sub-decisions (2026-09-08)

- **One token — confirmed.** A single utility token, launched on Pons (both the fee source AND the activate/fuse burn token). **SparkPoint deploys no token or NFT contract of its own** for the beta — it integrates the **Pons** (token) and **OpenSea** (NFT) contract access; the testnet's own custom ERC-20 / ERC-721 are retired. SparkPoint's own contracts are only the revenue subsystem (`RevenueSplitter`, engine, `BrokerVault`, `RoyaltySink`) + the swap router.
- **Push engine — confirmed.** Port Robin's continuous push engine (keeper `settle → deliver` to per-token vaults), NOT the periodic Merkle pull. Removes the human-publish step; value rides a resale.
- **Multi-asset, as-is — confirmed.** The engine distributes **ETH and any ERC-20 as-is, with no conversion** (Robin accepts only ETH and swaps to a payout asset). Per-asset accumulator + multi-asset per-token vault + straight-transfer delivery.
