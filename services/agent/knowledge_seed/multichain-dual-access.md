---
title: Dual Access and the Multi-Chain Freeze Story
source: multichain-dual-access
tags: [multichain, swap, earn, portfolio, near-intents, morpho, kamino, rhea, dual-access, freeze]
risk_tier: conservative
updated: 2026-11-05
---

# Dual Access and the Multi-Chain Freeze Story

SparkPoint's freeze build is deliberately **dual access**: every core capability is available on a
manual page and again in Sparky chat. Neither surface owns the user's funds; both prepare actions the
user reviews and signs.

## Swaps: two honest paths

- **Manual `/swap`.** A same-network, user-signed EVM swap on the wallet's supported chain — Base or
  Robinhood Chain in the freeze build. The page quotes through the chain's Uniswap-V3-compatible
  router and never silently changes the wallet's network. It is not the cross-chain product and it
  should never be described as the whole hackathon swap.
- **Sparky chat — cross-chain via NEAR Intents (1Click).** Ask Sparky to swap USDC to BTC, move ETH
  to Base, or swap USDC to SOL. Sparky shows a quote/preview, the destination and fees before
  anything is sent; the user sends from their own wallet to a one-time deposit address, and an
  incomplete swap is refunded to the stated refund address. Routes are quoted live where the rail
  and keys are configured. No bridge is offered outside this Intents flow.

If a route or destination is unsupported, both surfaces say so honestly instead of falling back to a
different chain or pretending a route exists.

## Earn: three protocols, one registry

The same data-driven earn registry powers the `/vault` page and Sparky's vault list:

- **Morpho** on Base and Ethereum — curated lending vaults, with the net APY the source reports.
- **Kamino** on Solana — SOL vaults whose 1Click receipt is the native Kamino vault share.
- **Rhea (Burrow) lending** on NEAR — USDC supply, with the contract's variable supply APR and the
  one-time Rhea account setup fee on a first deposit.

Every row names its chain and protocol, and shows which rails are actually available: a direct
same-chain deposit, the 1Click Earn receipt route, or the Rhea rail. A rail that needs a funded
wallet, an Aurora key, or a deployment this build does not have is shown as unavailable — never as a
silently missing badge and never as a fabricated success. Previews are dry: they show the estimated
receipt, fees and destination, but they do not sign or send.

## Portfolio: read across chains, no network flip

The Portfolio page and Sparky's portfolio answer aggregate the signed-in wallet's reads across Base,
Solana and NEAR where the data exists: wallet balances, Morpho positions, Kamino shares linked to a
recorded Solana address, Rhea lending positions and recent cross-chain swaps. Each section degrades
on its own, so one slow or unconfigured source says so in that section instead of hiding the rest.
The read is **read-only and not signable**, and it does not require the user to switch MetaMask to
another network.

## What stays true

- SparkPoint never holds keys or funds; the user signs every transaction.
- Withdrawals are not gated by SparkPoint.
- APY figures are variable spot readings with an as-of, never promises.
- A page and Sparky may describe the same capability differently, but they must not contradict each
  other: the registry, chain badges and rail states are the shared source of truth.
