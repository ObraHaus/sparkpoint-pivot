---
title: Aerodrome Slipstream Concentrated Liquidity
source: aerodrome-slipstream
tags: [aerodrome, slipstream, liquidity, base, defi]
risk_tier: growth
updated: 2026-07-16
---

# Aerodrome Slipstream Concentrated Liquidity

Aerodrome is the largest decentralized exchange on Base and uses a `ve(3,3)`
model: participants lock the `AERO` token for `veAERO` and vote on gauges that
direct `AERO` emissions to pools. **Slipstream** is Aerodrome's
concentrated-liquidity AMM (Uniswap-v3-style tick ranges), running alongside the
original v2 stable/volatile pools.

## Concentrated liquidity, briefly

In a Slipstream pool a liquidity provider supplies capital within a chosen
**price range** rather than across the whole curve. Inside the range the capital
is far more fee-efficient than a v2 position; outside it the position stops
earning fees and sits fully in one asset. This is higher yield **and** higher
active-management burden than a passive supply.

## Where the yield comes from

Aerodrome runs a **ve(3,3)** model, so an LP does **not** earn swap fees and
emissions at the same time — it is a choice:

- **Unstaked** (LP position held, not deposited in the gauge): earns the **swap
  fees** from trades routing through the range, but **no** `AERO` emissions.
- **Staked** in the pool's gauge: earns **`AERO` emissions**, but **forfeits the
  swap fees to `veAERO` voters** (lockers who direct emissions to gauges).

So a staked LP trades fee income for (typically higher) emissions — you don't
collect both. Both are variable: emissions depend on gauge votes and the `AERO`
price; fees depend on volume staying in-range.

## Risk framing

Concentrated LP carries **impermanent loss** — divergence between the paired
assets can leave a position worth less than simply holding — plus the risk of
drifting out of range, smart-contract risk, and `AERO` emission volatility. It is
a **growth**-tier strategy, materially riskier than [[aave-v3-supply]]. See
[[usdc-yield-strategies]] for how it maps to a mandate and [[risk-profiles]] for
tier framing. This note is advisory context only — it never sets a cap or gates a
signature; the deterministic policy layer decides that from fresh on-chain reads,
and any swap is bound by the on-chain slippage floor.
