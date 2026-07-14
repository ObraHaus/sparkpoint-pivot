---
title: Aave v3 Supply Mechanics
source: aave-v3-supply
tags: [aave, supply, yield, defi]
risk_tier: conservative
updated: 2026-07-10
---

# Aave v3 Supply Mechanics

Supplying an asset to Aave v3 deposits it into a shared liquidity pool and mints
an interest-bearing `aToken` (for USDC, `aUSDC`) to the supplier's account at a
1:1 ratio. The `aToken` balance rebases upward over time as borrowers pay
interest, so accrued yield is reflected directly in the token balance — there is
no separate claim step.

## Where the yield comes from

Supply APY is a function of pool **utilization**: the share of supplied
liquidity currently borrowed. Higher utilization pushes both the borrow rate and
the supply rate up. The rate floats block-to-block and is never guaranteed;
quoted APY is a spot reading, not a promise. See [[risk-profiles]] for how APY
volatility maps to a user's mandate.

## Liquidity and withdrawal

Supplied USDC is withdrawable on demand as long as the pool holds free (unborrowed)
liquidity. In rare high-utilization moments withdrawal can be temporarily
constrained until borrowers repay or new supply arrives. Aave v3 supply carries
smart-contract risk and the (for USDC, minimal) risk of the underlying asset
de-pegging.

## How SparkPoint uses it

The [[profit-only-vault]] routes conservative USDC allocations into Aave v3
supply as its base yield leg. A bare direct supply is offered as the raw,
un-managed alternative to the vault. This note is advisory context only: it
never sets a cap or gates a signature — the deterministic policy layer decides
that from fresh on-chain reads.
