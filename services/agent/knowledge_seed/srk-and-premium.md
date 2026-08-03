---
title: SRK and Premium
source: srk-and-premium
tags: [srk, premium, token, faucet, subscription, pricing]
risk_tier: conservative
updated: 2026-08-03
---

# SRK and Premium

SRK is SparkPoint's utility token, and Premium is the optional subscription it
pays for. Both are deliberately peripheral: the vault, the assistant, deposits,
yield, swaps and withdrawal are free and never require SRK.

## What SRK is

The alpha SRK is a plain 18-decimal ERC-20 on Base Sepolia, deployed for testing.
Its entire supply was minted once at creation — there is no mint function and no
owner, so the supply cannot change. It is deliberately **not** the older,
exchange-listed SparkPoint token; only the name and symbol are shared, for
familiarity.

SRK is not an investment. No yield accrues to it, it confers no claim on the
vault or on protocol fees, and SparkPoint quotes no dollar price for it — there
is no oracle, so any USD figure would be invented.

## Getting SRK: the faucet

Premium members can claim **5,000 SRK per 24 hours** from SparkPoint's faucet,
which lives on the **/premium** page next to the balance. The faucet contract
holds the tokens and sends them; the user signs only the claim itself and pays
its gas. A second claim inside the cooldown window reverts — the countdown on the
card shows when the next one unlocks. The claim amount and cooldown are read live
from the contract, so the figures shown are always the real ones.

Gas for that claim is Base Sepolia ETH, which comes from public testnet faucets
(Coinbase Developer Platform, Alchemy), not from SparkPoint. See
[[sparky-capabilities]].

## Premium: price and what it changes

Premium costs **10,000 SRK per month**, paid as a single SRK transfer — no
approval step. It can be cancelled at any time by simply not renewing, and an
active subscription can be extended a month at a time.

Free and Premium members get **identical** access to everything that matters:

| | Free | Premium |
|---|---|---|
| AI chat assistant | Full | Full |
| Portfolio and read access | Full | Full |
| Aave Yield Vault — deposit, yield, withdraw | Full | Full |
| Swaps and withdraw-always | Full | Full |
| Strategy analysis | Basic | Deeper and more frequent |
| Advanced strategy vaults (when live) | — | Included |
| Limits and priority compute | Standard | Higher |
| Advanced analytics and alerts | — | Included |
| Scoped auto-rebalance | — | Higher caps |
| SRK faucet | — | 5,000 SRK / 24h |

Premium buys more analysis and higher limits. It does not buy better yields,
lower fees, or privileged access to funds, and nothing about custody or the
withdrawal path changes with it.

## Where the money goes

Premium payments go to a 2-of-3 multisig treasury, disclosed in the Trust Center.
SRK is separate from how SparkPoint earns from the product itself — that is the
performance fee and the swap routing fee, both explained on the Fees page. See
[[platform-surfaces]].
