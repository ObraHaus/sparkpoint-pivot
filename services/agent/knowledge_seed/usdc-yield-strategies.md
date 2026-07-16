---
title: USDC Yield Strategies on Base
source: usdc-yield-strategies
tags: [usdc, yield, strategy, base, mandate]
risk_tier: moderate
updated: 2026-07-16
---

# USDC Yield Strategies on Base

USDC yield on Base spans a risk spectrum, and a strategy is only appropriate
insofar as it matches the user's mandate. SparkPoint surfaces only whitelisted,
policy-cleared strategies; this note frames how the main options trade off.

## The conservative base: lending supply

Supplying USDC to [[aave-v3-supply]] earns a floating, utilization-driven APY
with on-demand withdrawal and no impermanent loss. It is the **conservative**
leg — the lowest-risk productive use of idle USDC — and is what the
[[profit-only-vault]] (an [[erc4626-vaults|ERC-4626]] vault) routes into by
default.

## Higher up the curve: concentrated liquidity

Providing liquidity in an [[aerodrome-slipstream]] pool can earn more (swap fees
plus `AERO` emissions) but adds impermanent loss, range-management burden, and
emission volatility — a **growth**-tier profile. It suits only mandates that
explicitly accept that risk.

## Matching to the mandate

A conservative mandate stays in vault/lending supply; a growth mandate may accept
concentrated-liquidity exposure. Quoted APYs are spot readings, never promises,
and every candidate is bound by the deterministic caps and slippage floor before
it can ever be signed. See [[risk-profiles]] for the tier definitions. This note
is advisory context only — it never sets a cap or gates a signature.
