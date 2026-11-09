---
title: Dual Access and the Multi-Chain Freeze Story
source: multichain-dual-access
tags: [multichain, swap, earn, portfolio, near-intents, morpho, kamino, rhea, dual-access, freeze]
risk_tier: conservative
updated: 2026-11-09
---

# Dual Access and the Multi-Chain Freeze Story

SparkPoint's freeze build is deliberately **dual access**: every core capability is available on a
manual page and again in Sparky chat. Neither surface owns the user's funds; both prepare actions the
user reviews and signs.

The beta is at **https://beta.sparkpoint.io** — `/connect` to sign in, `/chat` for Sparky, and
`/swap`, `/vault` and `/portfolio` for the manual surfaces. The same story is on both surfaces.

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

Rhea has **two different rails**, and they must not be confused:

- **Same-chain Rhea (078).** A connected NEAR wallet supplies native USDC to Burrow (Rhea) on NEAR
  and withdraws it with an unsigned `execute → Withdraw` review. No access key is added.
- **Cross-chain Rhea (079).** EVM USDC on Base or Ethereum reaches Rhea on NEAR through NEAR Intents
  1Click plus Rhea's Multichain Account. The dry review shows the origin, refund address, MCA
  message, one-time MCA fee, routing fee, net supplied and APY. A live commit is server-gated and
  returns an unsigned origin ERC-20 transfer plan; it is not the same-chain flow.

## Live earn is off by default

The live deposit/withdraw reviews are built but **off by default**. They appear only when an owner
explicitly enables the matching flags: `NEXT_PUBLIC_EARN_LIVE_KAMINO` / `EARN_LIVE_KAMINO`,
`NEXT_PUBLIC_EARN_LIVE_MORPHO` / `EARN_LIVE_MORPHO`, `NEXT_PUBLIC_EARN_LIVE_RHEA` /
`EARN_LIVE_RHEA`, and `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` / `EARN_LIVE_RHEA_XCHAIN` for the
cross-chain review's live commit. With the flags off, the beta shows previews and reads only.

When a flag is on, the review is still **unsigned**: SparkPoint builds the transaction, shows the
exact amount, accounts, network fee and rent, and your own wallet signs. SparkPoint never signs,
approves, submits or broadcasts, and no funded execution is claimed until an owner-approved funded
test. Simulations are labelled **SIMULATED**.

## Withdrawals: what each rail does

- **Kamino on Solana / Morpho on Base (077):** an in-wallet unsigned withdraw/redeem review; your
  wallet signs. No custody.
- **Rhea same-chain on NEAR (078):** an in-wallet unsigned Burrow withdraw review; your NEAR wallet
  signs. No custody.
- **Rhea cross-chain (079):** a **guided review** only. It lists the documented Rhea SDK paths
  (`relayer`, `nearMcaWithdrawTx`) first and the Rhea app link-out last, and states
  `nep413IsTransaction=false`, `custodian=null`, `signedBySparkPoint=false`. A link-out is not a
  SparkPoint-signed transaction.
- **Rhea preview (071):** an external link to `app.rhea.finance`.

No rail gives SparkPoint the ability to move, freeze or withhold a user's funds.

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
