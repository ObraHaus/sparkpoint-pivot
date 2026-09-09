---
title: Conservative, Moderate, and Growth Risk Framing
source: risk-profiles
tags: [risk, mandate, conservative, moderate, growth]
risk_tier: all
updated: 2026-07-10
---

# Conservative, Moderate, and Growth Risk Framing

A user's mandate sets a risk profile that shapes which whitelisted strategies the
assistant ranks first. The profile is advisory framing for the rationale; the
hard caps and slippage bounds it implies are enforced deterministically by the
policy layer, not by this note.

## Conservative

Capital preservation first. Favors the [[profit-only-vault]] and direct
[[aave-v3-supply|Aave v3 supply]] of USDC — stablecoin yield with minimal price
exposure and on-demand liquidity. Tightest caps and lowest slippage tolerance.

## Moderate

Accepts measured volatility for higher expected yield. Still stablecoin-anchored
via the vault, but with a larger per-action cap than conservative. Suitable for a
user comfortable with floating APY and short-term utilization swings.

## Growth

Prioritizes upside and is comfortable with larger allocations and wider slippage
bounds, within the whitelist. Even here the strategy set stays pre-vetted — a
higher risk profile widens caps, it never unlocks an off-whitelist protocol.

## Why this is advisory only

Risk framing tunes tone and ordering. It never fabricates an APY and never makes
a block signable — `isSignable` depends solely on `policy.status == "approved"`
from the fail-closed policy engine.
