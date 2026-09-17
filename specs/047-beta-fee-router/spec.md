# Feature Specification: Beta fee-router — the 0.20% swap fee, on 4663

**Feature Branch**: `feat/beta-broker-ui` (W.7)

**Created**: 2026-09-17

**Status**: Specified — implementation pending

**Input**: Beta tracker C.6 / W.7: "Custom fee-router (C.6): UUPS router → the external Uniswap V3,
imposes 0.20% → splitter; interim option: evaluate SwapRouter02 sweepWithFee".

## The measured problem

The 4663 beta swap is **fee-free**: `swapFeeRecipient` is undefined in the `robinhoodMainnet` book
and the app calls the external `SwapRouter02` directly, user-signed. The revenue subsystem that
would receive a fee is live and proven (W.8: splitter 90/10 → engine pot → vault → holder withdraw),
but nothing charges the swap leg, so the 0.20% stated in the product copy is not collected.

## ⚠️ The interim option is dead — verified on-chain

The deployed `SwapRouter02` (`0xCaf6…E5cb2`) was probed by selector on 2026-09-17:

| Function | Selector | On the deployed router |
|---|---|---|
| `sweepWithFee(address,uint256,address)` | `0xc99e721e` | **absent** |
| `sweepToken(address,uint256,address)` | `0xdf2ab5bb` | present — **owner-gated by Uniswap**, unusable |
| `unwrapWETH9(uint256,address)` · `refundETH()` · `multicall(bytes[])` | — | present (standard V2 surface) |

So there is no existing hook that can divert 0.20% to the splitter. A custom router is the only
path; `multicall`/`unwrapWETH9`/`refundETH` availability is what makes a correct ETH-in/ETH-out
router implementable.

## Requirements

- **FR-001**: A swap through the router MUST be **user-signed and non-custodial**: the router holds
  funds only for the duration of the call and sends the output to the caller-named recipient.
- **FR-002**: The fee MUST be 0.20% of the swap's input amount, enforced by a constant
  `FEE_BPS = 20` with an immutable ceiling the owner can never exceed.
- **FR-003**: The fee MUST reach the **RevenueSplitter** — never an EOA — so the existing 90/10
  path and the immutable destinations apply. Fees in ETH go straight to the splitter's `receive()`;
  fees in an ERC-20 use `RevenueSplitter.sweepToken`.
- **FR-004**: A failed swap MUST NOT charge a fee and MUST return the user's input (subject to the
  underlying router's own revert semantics). The fee is taken only on a completed swap.
- **FR-005**: The router MUST support the two shapes the app actually builds on 4663:
  exact-input single-hop token→token, and exact-input ETH→token / token→ETH (USDG ↔ WETH pool,
  fee tier 100). Exact-output and multi-hop are **non-goals** for the beta.
- **FR-006**: Slippage (`amountOutMinimum`) and `deadline` MUST be caller-supplied and passed
  through unchanged; the router MUST NOT substitute its own defaults.
- **FR-007**: Upgradeability: UUPS, owner = the beta deployer EOA (the same key as the engine),
  with `_authorizeUpgrade` owner-gated. The fee rate and recipient **are not** upgradeable setters —
  changing the split requires an upgrade, which is itself an owner-visible event.
- **FR-008**: The alpha/testnet builds MUST be byte-for-byte unchanged: the app routes through the
  router only when the chain's book carries a `feeRouter` address.
- **FR-009**: The swap confirm UI MUST disclose the fee and its destination **before** signing, in
  the same register as the vault's fee rows (a real number, from the router's constants — never a
  hardcoded "0.20%" string in the app).

## ✅ DECIDED — the fee is denominated in the input token

**Decision (2026-09-17): option 1 — the fee is taken from the input side, in the asset the user
already pays with.** ETH-in swaps pay the fee in ETH (straight to the splitter's `receive()`, the
path W.8 proved). USDG-in swaps pay the fee in USDG, which the splitter collects like any ERC-20
leg via `sweepToken`.

Why not option 2 (convert the fee to ETH inside the router): it adds a second swap per trade whose
gas and slippage are paid by the swapper, and it puts a second independently-failing leg inside the
one transaction that must settle the user's own swap. The revenue subsystem was built AS-IS — a
USDG fee is the model working, not a problem to engineer around.

**Consequence, and the reason this decision closes the W.8 finding:** a USDG fee reaches the engine
as a PUSH (the splitter's immutable `sweepToken` transfers it), and the engine currently books only
pull-deposits. The splitter cannot be changed (immutable, and it is the token's fixed
`creatorFeeRecipient`), so the fix is engine-side and ships in the same upgrade as the W.8 rewind
fix:

- `BrokerEngine` gains a permissionless `sweepAsset(address asset)`: it books
  `IERC20(asset).balanceOf(address(this)) - accountedAsset[asset]` into `pendingPot[asset]` and
  raises the watermark. `depositAsset` raises the same watermark, and `deliver` lowers it as it
  sends tokens out — so the engine can never double-book its own balance, and a pushed token is
  credited without trusting the pusher.
- The owner must `addAsset(token)` for each fee token (append-only registry, already in place).
- The W.8 fork pin (`test_fork_postGradTokenLeg_pushIsNotBooked_butPullIs`) flips to assert the
  booked path in the same change that lands `sweepAsset`.

Implementation order: engine `sweepAsset` + unit tests → the router contract + tests → the 4663
fork test (real pool: ETH→USDG fee = 0.20% to the splitter, then the W.8 loop) → the app swap route.

## Test plan

- Unit: fee math and rounding (fee is `amountIn * 20 / 10000`, truncating in the protocol's favour);
  the ceiling cannot be exceeded; ETH refund of any unspent value; slippage/deadline revert leaves
  no fee; non-reentrant; fee recipient is the splitter (immutable reference).
- Fork (extends `BrokerRevenueFork.t.sol`): on pinned 4663, swap ETH→USDG through the router against
  the **real** WETH/USDG pool, assert the splitter's ETH balance grew by exactly 0.20%, then call
  `splitter.distribute()` and follow the money into `pendingPot` — the W.8 loop's first two legs.
- App: the swap page binds the router from the book; with `feeRouter` undefined (alpha, and beta
  until deployed) the current direct-SwapRouter02 path is byte-identical.
- Fork regression for the engine intake fix (option 1), replacing the W.8 trap pin.

## Non-goals

- Exact-output swaps, multi-hop routing, or an aggregator.
- Arbitrum bridging (explicitly deferred by the tracker).
- Charging the fee on alpha/testnet swaps.
