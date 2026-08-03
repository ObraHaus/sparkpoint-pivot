---
title: SparkPoint Platform Surfaces
source: platform-surfaces
tags: [trust-center, outcomes, fees, learn, changelog, navigation, product]
risk_tier: conservative
updated: 2026-08-03
---

# SparkPoint Platform Surfaces

Where things live in the app, and what each page can actually tell a user. When
someone asks a question a page answers better than prose can, point them at it.

## Trust Center (/trust)

The proof-of-custody page. It reads the deployed vault live — owner, pause state,
performance fee, total assets, the deposit caps in the CapRegistry — and shows
the whitelisted protocols and actions the policy engine will permit at all. It
also names the fee recipient multisig.

It is never gated by authentication or a wallet connection, deliberately: proving
that SparkPoint cannot take a user's funds must be reachable by anyone, at any
time, including someone who has not connected a wallet. Sub-pages cover
permissions and the exact scope of anything the user has granted.

## Outcome Log (/outcomes)

What actually happened to real money, reprojected from indexed on-chain deposit
and withdrawal flows. Two views:

- **By recommendation** — one row per recommendation the user acted on, with
  realized and unrealized profit and loss marked to market, linked to the exact
  transaction they signed.
- **All withdrawals** — the position-level realized ledger, one row per
  withdrawal.

Figures appear only when the share history reconciles exactly; when it does not,
the page shows an honest empty or pending state rather than an approximate
number. A withdrawal that spans several deposits is not split across
recommendations, and the page says so.

## Fees (/fees)

Everything SparkPoint charges, with the live fee parameters read straight from
the vault contract. 0% on deposits, withdrawals and principal; a performance fee
charged only on profit above the high-water mark; 0.20% on swaps routed through
SparkPoint; Premium paid separately in SRK. There is deliberately **no**
per-wallet "fees paid" figure: the performance fee is share dilution to a shared
recipient, so no truthful personal total can be indexed, and the page says that
rather than inventing one.

## Learn (/learn)

Short plain-language answers to the questions that block people: what net APY is,
what vault shares are, what slippage is, what self-custody means. Good for a user
who wants a definition rather than a figure.

## Changelog (/changelog)

What has shipped, newest first, written for users rather than developers. Each
entry is tagged as new, improved or fixed, and dated. This is the page that
answers "what changed this week?" or "did you fix that?". It sits under the
Information section of the navigation.

## The rest of the app

- **/portfolio** — positions, allocation and profit and loss.
- **/vault** — the Aave yield vault: deposit, withdraw, current rate.
- **/swap** — user-signed swaps, 0.20% routing fee.
- **/premium** — the SRK balance, the faucet, and the subscription. See
  [[srk-and-premium]].
- **/notifications** — alerts derived from real on-chain activity.
- **Settings → Memory** — read or erase what Sparky remembers.
- **Settings → Security** — active session keys, and revoking them.
- **Settings → Account** — the subscription status.

See [[sparky-capabilities]] for what the assistant itself can and cannot do.
