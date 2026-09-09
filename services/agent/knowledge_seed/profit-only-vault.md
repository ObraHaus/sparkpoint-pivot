---
title: The Profit-Only Aave Yield Vault
source: profit-only-vault
tags: [vault, erc4626, fee, yield]
risk_tier: conservative
updated: 2026-07-10
---

# The Profit-Only Aave Yield Vault

SparkPoint's flagship vault is a non-custodial ERC-4626 vault that supplies
deposited USDC into [[aave-v3-supply|Aave v3]] and auto-compounds the yield.
Depositors receive vault shares; the share price rises as the vault's Aave
position accrues interest. Users keep custody — the vault holds no withdrawal
keys and value here never gates a signature.

## The profit-only fee

The vault charges a **performance fee on profit only**: the fee applies solely to
yield earned above each depositor's high-water mark, and **0% is ever charged on
principal**. If the strategy earns nothing, no fee is taken. This aligns the
manager with the depositor — the vault is paid only when the depositor makes
money, so a quoted net APY is always the gross Aave APY minus the profit-only fee.

The high-water mark described here is a property of **this** vault's own contract
(`SparkPointVault`, which keeps a real `_highWaterMark`). It is not a blanket
property of every vault SparkPoint may list: a Morpho Vault V2 keeps no
high-water-mark state, so on such a vault a gain following an earlier loss is
charged even while the depositor is below their previous high. "0% on principal"
and "nothing in a flat or falling period" hold in both cases. Each vault's own
screen states its exact terms before signing.

## Net vs. gross

Recommendations distinguish the **gross** APY (raw Aave supply rate) from the
**projected net** APY (gross minus the profit-only fee on the yield portion).
Both figures come from live market reads injected at recommendation time — they
are never fabricated by the assistant. See [[risk-profiles]] for how the vault
fits conservative, moderate, and growth mandates.

## Advisory boundary

This note is retrieval context for the recommender's rationale. It informs *how*
a strategy is explained, never *whether* it is signable — the profit-only fee,
caps, and approval all live in the deterministic policy layer.
