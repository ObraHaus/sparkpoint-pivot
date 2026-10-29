---
title: Protocol Basics for Lending and Liquid Staking
source: protocol-basics
tags: [aave, compound, morpho, lido, rocket-pool, lending, staking, risk]
risk_tier: all
updated: 2026-10-29
---

# Protocol Basics for Lending and Liquid Staking

These are conservative, structural notes for the protocols users most often ask Sparky to
compare. They contain no yield or size figures: a live rate must come from a fresh on-chain
read with an as-of date, never from this note. See [[risk-profiles]] and [[beta-questions]].

## Aave

Aave is a decentralised lending protocol. A supplier deposits an asset into a shared
liquidity pool and receives an interest-bearing receipt token; borrowers pay interest into
the pool, and the supplier's balance grows as that interest accrues. Supply rates are
variable and driven by how much of the pool is borrowed, so they can fall as well as rise.
Risk is concentrated in one shared market plus the protocol contracts, and positions are not
insured. SparkPoint's own Aave Yield Vault routes USDC into Aave v3, while a direct supply is
the raw, un-managed alternative. See [[aave-v3-supply]] and [[profit-only-vault]].

## Compound

Compound is a decentralised lending protocol in the same broad shape as Aave: suppliers
deposit into shared pools, borrowers pay interest, and suppliers earn a variable rate driven
by utilisation. It is governed by holders of its governance token, so parameter and contract
changes follow that governance process. The main risks are smart-contract risk, governance
risk, and the market risk of the assets listed; it is not insured. This note is general
context and does not describe a SparkPoint vault for Compound.

## Morpho

Morpho is a lending framework built around isolated markets and curated vaults rather than
one shared pool. A curated vault allocates across markets chosen by its curator, so
depositors take the curator's allocation choices and the liquidity profile of those specific
markets on top of the underlying market risk. A Morpho-based curated vault can sit beside a
single Aave supply position, but it is not automatically safer: curation adds a layer of risk
as well as expertise, and neither venue is insured. SparkPoint may list screened Morpho Vault
V2 vaults on its curated board. See [[beta-questions]] and [[usdc-yield-strategies]].

## Lido

Lido is a liquid-staking protocol for Ethereum. A user deposits ETH and receives a liquid
staking token that represents the staked position; staking rewards accrue to that token, and
it can be transferred or used elsewhere instead of being locked. The risks are smart-contract
risk, validator-operation risk, withdrawal-queue and liquidity risk, and the possibility that
the liquid staking token trades below the value of the underlying ETH. It is not insured.
This note is general context and does not describe a SparkPoint staking position for Lido.

## Rocket Pool

Rocket Pool is a decentralised liquid-staking protocol for Ethereum. Users deposit ETH and
receive a liquid staking token backed by staked ETH run by a network of independent node
operators; staking rewards accrue to the token. The risks are smart-contract risk,
node-operator performance and penalty risk, withdrawal-queue and liquidity risk, and the
possibility that the liquid staking token trades below the value of the underlying ETH. It is
not insured. This note is general context and does not describe a SparkPoint staking position
for Rocket Pool.
