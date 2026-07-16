---
title: ERC-4626 Tokenized Vaults
source: erc4626-vaults
tags: [erc4626, vault, shares, standard, defi]
risk_tier: conservative
updated: 2026-07-16
---

# ERC-4626 Tokenized Vaults

ERC-4626 is the tokenized-vault standard: a vault takes a single underlying asset
(for SparkPoint, USDC) and issues fungible **share** tokens that represent a
proportional claim on the vault's total assets. As the vault earns yield, each
share becomes redeemable for more underlying — the share price (assets per share)
rises rather than the share count.

## Core methods

`deposit(assets, receiver)` / `mint(shares, receiver)` add underlying and issue
shares; `withdraw(assets, receiver, owner)` / `redeem(shares, receiver, owner)`
burn shares and return underlying. The `preview*` views (`previewDeposit`,
`previewRedeem`, …) quote the exact conversion at current state, and
`convertToShares` / `convertToAssets` express the share price. `totalAssets()`
reports what the vault controls.

## Why shares, not balances

Because redemption is priced off live `totalAssets`, a depositor's claim tracks
real yield without a manual claim step, and the accounting cannot be diluted by
new deposits — new shares are minted at the current price. A withdrawal reads the
current share price on-chain, so the exit value is always provable.

## How SparkPoint uses it

The [[profit-only-vault]] IS an ERC-4626 vault over USDC (share token
`spvUSDC`): it deploys idle USDC into [[aave-v3-supply]] and takes a profit-only
performance fee above a high-water mark. Its `redeem` path is never pausable —
withdrawal always reads the live share price. This note is advisory context only;
it never gates a signature.
