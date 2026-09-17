# revenue/ — the beta revenue subsystem (Robinhood Chain 4663 only)

**Scope:** these contracts serve the **beta channel only** (4663). Alpha (Base Sepolia 84532) keeps
its existing Broker/SRK surfaces untouched — every app surface added for these contracts must be
env-gated so alpha stays byte-identical.

Ported from the proven `robin-brokers-companion` implementation, with SparkPoint's **multi-asset
AS-IS** change: fees arrive as ETH and any ERC-20 and are distributed **without conversion**.

## Status

| File | State |
|---|---|
| `interfaces/IUtilityToken.sol` · `IBrokerNFT.sol` · `IBrokerVault.sol` · `IPons.sol` | ✅ ported |
| `RoyaltySink.sol` | ✅ ported (unchanged model) |
| `RevenueSplitter.sol` | ✅ ported, **non-upgradeable** (immutable wiring, no owner) |
| `BrokerVault.sol` | ✅ ported **+ native ETH** (`asset == address(0)`) |
| `BrokerEngine.sol` | ✅ ported — AS-IS multi-asset settlement (design below) |
| `FeeRouter.sol` | ✅ new (W.7) — UUPS 0.20% input-side swap router → splitter (design below) |
| `script/DeployBetaRevenue.s.sol` | ✅ ported — dry-run first, `$BCAST` to deploy |
| `script/DeployFeeRouter.s.sol` | ✅ new (W.7) — 4663-only, `FEE_RECIPIENT` must be the splitter |

Tests: `contracts/test/revenue/RevenueSuite.t.sol` (22) + `contracts/test/revenue/BrokerEngine.t.sol` (21)
+ `contracts/test/revenue/FeeRouter.t.sol` (27)
— splitter 90/10 + curve/token sweeps, sink, vault credit/merge/withdraw + EIP-712, the engine:
verbs, weights/round boundaries, AS-IS ETH + ERC-20 delivery, pro-rata splits, sold/burned drops and
salvage, admin one-shots, and the rewind-window promotion regression, and the fee-router: fee math +
truncation, ETH-in/ETH-out/token↔token shapes, refunds, deadline/slippage/reentrancy reverts, the
immutable splitter destination, and owner-gated upgrade/rescue. Full contracts suite: **431 passing /
0 failing**, plus the 4663 fork proof below.

## Fork proof (W.8, 2026-09-17)

`test/fork/BrokerRevenueFork.t.sol` runs the full loop on a **pinned 4663 fork** against the deployed
set — real Pons curve, real token, real splitter, real engine and vault: buy → clock in → fuse →
sweep → settle → deliver → withdraw. The W.7 fee-router proof (4th test) adds a user-signed ETH→USDG
swap through `FeeRouter` on the **real WETH/USDG pool**: the splitter's ETH grows by exactly 0.20%,
`distribute()` pushes the 90% holder leg into `pendingPot`, and the same settle/deliver/withdraw loop
pays it out. Only the collection's ownership oracle is stubbed (the OpenSea drop has minted nothing
at the pinned block; the test asserts that premise before etching). The pin is **block 65,126,400 —
after the 2026-09-17 engine upgrade**, so the tests prove the fixed implementation.

```bash
export ROBINHOOD_MAINNET_RPC=<archive endpoint for 4663>
forge test --match-contract BrokerRevenueFork -vv
```

Two findings, both shipped and now pinned on the fixed behaviour:

- ✅ **A promotion queued inside the round-length rewind window was retroactive — FIXED + DEPLOYED.**
  After `setRoundSeconds(86400)` the grid can rewind (`currentRound() < settledRound`), and
  `_changeWeight` keyed the promotion boundary on `roundInProgress()` — a round that was already
  closed. `_crystallise` then paid the whole accumulator at the queued weight while `settle()` had
  divided the pot by the old `totalWeight`: 1 ETH of revenue became 2.5 ETH owed and `deliver`
  reverted `OutOfFunds`. The boundary is now `settledRound + 1` (the next round to be closed).
  Unit-pinned by `test_setRoundSeconds_promotionInTheRewindWindowIsNotRetroactive` and fork-pinned
  by `test_fork_rewindWindow_fuseIsNotRetroactive` (`owed ≤ held`, delivery lands).
- ✅ **The post-graduation ERC-20 leg — FIXED + DEPLOYED.** `RevenueSplitter.sweepToken` PUSHES the
  holder leg to the engine as a bare `transfer`; the `sweepAsset(asset)` intake books
  `balanceOf(this) − accountedAsset[asset]` into `pendingPot[asset]` (permissionless, no trust in the
  caller), the owner `addAsset`s each fee token, and the W.8 pin flipped with the upgrade to
  `test_fork_postGradTokenLeg_pushIsBooked` (booked exactly once; a pull-deposit books only its own
  delta). USDG is registered on the live engine.

⚠️ **Deploy history (4663 engine proxy `0x08a5…DB43`):** impl `0x6338…0C2a` (W.9, daily rounds) →
**impl `0x6c36…5736` on 2026-09-17** (rewind fix + effects-first `deliver` + `sweepAsset`; tx
`0xc1cd…aa54`, block 65,126,350), USDG `addAsset` at block 65,126,399 (tx `0x7b7f…2491`).

## Deliberate divergences from the reference

- **Splitter is immutable, not UUPS.** The constitution (v3.2.0) requires value-bearing contracts to
  be immutable or upgrade-renounced; immutability is the stronger promise, and it removes the one
  privileged key. Cost acknowledged: a bug here means relaunching the token (the recipient is fixed
  at `launchToken()`).
- **Vault holds native ETH too** — the reference vault was ERC-20-only because its engine swapped
  ETH into a payout asset first. SparkPoint distributes as-is, so ETH is a first-class asset.
- **Engine settlement** replaces the reference's TWAP/swap pipeline (see below).

## Function parity with the reference (checked 2026-09-16)

| Contract | Inherited 1:1 | Renamed | Dropped (by design) | Added |
|---|---|---|---|---|
| `BrokerEngine` | `clockIn` `promote` `fuse` `settle` `deliver` `sync` `addAsset` `setVault` `settle/round` helpers `deriveWeight` `rawWeight` `rankOf` `earnedOf` `rescueEth/Token` `renounce/transferOwnership` + all internals (`_reconcileOwner` `_crystallise` `_changeWeight` `_deactivate` `_dropForFuse` `_requireOwner`) | `setRobinToken`→`setToken`; `_accrued`→`_accruedAsset`; `earnedOf(id)`→`earnedOf(id, asset)`; `accAtRound(round)`→`accAtRound(round, asset)` | `_buy` `_buyBatch` `_carve` `_payOut` `quoteFloor` `setMinSwap` `setSplit` `splitOf` `assetPath` (the swap/split layer) | `depositAsset` (permissionless ERC-20 pull) `isRegisteredAsset` `_advanceDebts` `_crystalliseAsset` |
| `RevenueSplitter` | `pull` `sweepCurve` `sweepPool` `distribute` `sweepToken` + guards | — | `initialize` `transferOwnership` `_authorizeUpgrade` (non-upgradeable, no owner — deliberate) | — |
| `BrokerVault` | `credit` `merge` `withdraw` `withdrawWithSig` `withdrawDigest` `nonces` `assetsOf` `balanceOf` | — | — | `creditEth` (native ETH) |
| `RoyaltySink` | `flush` | — | — | — |

## Can we deploy the reference `CompanionEngine` as-is? — checked 2026-09-16

**No, not without changing the payout model.** Concretely, in the reference source:

- `deliver()` reverts `AssetNotRegistered()` when no asset is registered, and `_carve` routes an
  unsplit broker's credit to **asset index 0**; `_buyBatch` → `_buy` then does `weth.deposit{value}`
  and `router.exactInput(path, floor)` with the floor from **`TwapFloor` hops** — so the ETH pot is
  always **swapped into one registered ERC-20**. SparkPoint's ratified model is the opposite:
  multi-asset **AS-IS, no conversion** (specifically to remove the deliver-time swap gas-starvation
  failure).
- Using it as-is requires **`addAsset(asset, path, hops, toleranceBps)`** with a real route + TWAP
  hops (Robin registers SPCX over WETH→USDG→SPCX) and pays brokers in that one asset — Robin's
  asset, not what the protocol actually earned — plus the per-broker `setSplit` machinery.
- Non-blocking cosmetics: `MAX_SUPPLY = 2222` is declared but never enforced; `setRobinToken` /
  `$ROBIN` naming.
- Everything else is compatible: `ownerOf`/`burn` reads, `burnFrom` burns, `block.timestamp` rounds,
  one-shot token setter — so the SparkPoint port is mostly **deleting the swap layer**, not
  rewriting the core.

## BrokerEngine — design (port of `CompanionEngine`, AS-IS settlement)

**Kept from the reference (verified mechanics):**
- `clockIn` / `promote` / `fuse` + rank weights (`100/200/300` bps) and fuse bonuses (`+25%/+35%`,
  ceiling `1215`); `burnFrom` on the utility token; approve-then-fuse via `nft.burn`.
- Rounds keyed on `block.timestamp` (`roundSeconds`, `_startedAt`); the **weight queue**
  (`totalWeightNext` / `pendingWeightOf`) so an increase counts from the next round.
- `_reconcileOwner` / `_deactivate` / `_dropForFuse` (the D1 ownership re-validation, and the
  load-bearing rule: **a drop must zero `weightOf`**, not merely subtract from `totalWeight`).
- `_crystallise` / `_changeWeight` / per-token debt accounting.
- `sync(ids)`, `MAX_DELIVER_BATCH = 80`, owner `rescueEth`/`rescueToken`, price setters
  (`setClockInBurn`, `setRankBurns`, `setFuseBurns`), one-shot `setToken`, `setVault`, upgradeable
  (`UUPS`, owner) — renounce available.

**Changed for AS-IS multi-asset:**
- **Assets:** `address(0)` = ETH (always accepted); ERC-20s via an owner-managed append-only
  registry, `MAX_ASSETS = 16`.
- **Money in:** `receive()` adds ETH to `pendingPot[address(0)]`; a permissionless
  `depositAsset(address token, uint256 amount)` pulls an ERC-20 (`safeTransferFrom`) into
  `pendingPot[token]`. The splitter/royalty flows send ETH; post-graduation Pons token legs arrive
  as ERC-20s through the splitter.
- **Per-asset accumulator:** `accPerWeight[asset]`, advanced in `settle()` once per elapsed round
  from `pendingPot[asset]`; `accAtRound[round][asset]` recorded. No swaps, no `minSwap`, no TWAP.
- **`deliver(ids)`:** per id, reconcile + crystallise per asset, then hand each share to the vault —
  `creditEth{value}` for ETH, `credit` + `safeTransfer` for ERC-20s. A zero-weight or zero-share leg
  is skipped, never a revert.
- **Dropped entirely:** `TwapFloor`, `ISwapRouter02`/`IWETH9`, the `Asset{toleranceBps}` structs,
  per-broker `Split` picks, `minSwap`, `creditedEth` (replaced by per-asset pending + debts).

**Deploy order (unchanged):** engine → `BrokerVault(engine)` → `RevenueSplitter(escrow, engine,
treasury)` → `RoyaltySink(splitter)`; then OpenSea royalties → sink; token launch with
`creatorFeeRecipient = splitter`; one-shot `setToken`; prices set to single digits (1 · 1/2/3 ·
2/3).

## FeeRouter — design (W.7, spec `specs/047-beta-fee-router/`)

The deployed `SwapRouter02` has no fee hook the splitter could receive through (`sweepWithFee` is
absent; `sweepToken` is the platform's own), so the beta swap — user-signed, fee-free — needed a
router of its own to charge the advertised **0.20%**. `FeeRouter` is that router and nothing more:

- **UUPS** (owner = the beta deployer EOA, `initialize`-bound; implementation has initializers
  disabled), but the fee surface is not upgradeable config: `FEE_BPS = 20` is a constant and the
  ceiling is immutable, so changing the rate or the splitter takes a new implementation — an
  owner-visible upgrade.
- **Fee input-side, in the input asset.** ETH-in pays in ETH straight to the splitter's `receive()`
  (where `distribute()` splits it 90/10); ERC-20-in pays in that token, which the router hands to the
  splitter and settles in the same transaction through the splitter's own immutable `sweepToken`
  (90% pushed to the engine — booked via `sweepAsset` — 10% to the treasury). The destination is the
  splitter immutable; never an EOA.
- **Exact-input, single-hop only** (multi-hop and exact-output are beta non-goals). WETH is the
  native sentinel: `tokenIn == weth` wraps `netIn` to WETH, `tokenOut == weth` unwraps the output and
  forwards native ETH to the recipient.
- **Deadline is enforced here** (`block.timestamp <= params.deadline`) because the `02` router takes
  no deadline; slippage (`amountOutMinimum`) is the caller's number, passed through unchanged, with a
  belt-and-braces floor check on the returned amount.
- **Non-custodial and stateless.** Funds move only inside the signed call; the contract writes no
  storage in the swap path (no state write after an external call), and `nonReentrant` guards the one
  entry point. `rescueEth`/`rescueToken` (owner-only) exist solely for value force-sent outside a
  swap.

The app binds it only when the 4663 book carries a `feeRouter` address; undefined ⇒ the direct
`SwapRouter02` path is byte-identical (alpha untouched). **Deployed + wired 2026-09-17:** proxy
`0x0f5c10d5…ae7F3` (impl `0xA91a7B1d…4F372`; txs `0x15d9…a6a` / `0x5d78…5a6f`), so the 0.20% is
live on the beta. The on-chain 4663 fork proof of the fee in the real WETH/USDG pool lives in
`test/fork/BrokerRevenueFork.t.sol`.
