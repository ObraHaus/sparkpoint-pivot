---
title: SRK, Sparky Broker and Premium
source: srk-and-premium
tags: [srk, premium, token, faucet, sparky-broker, nft, activation, pricing]
risk_tier: conservative
updated: 2026-08-14
---

# SRK, Sparky Broker and Premium

SRK is SparkPoint's utility token. **Premium is no longer a monthly subscription** — it comes from
an **activated Sparky Broker**, and SRK is what activates one. All three are deliberately
peripheral: the vault, the assistant, deposits, yield, swaps and withdrawal are free and
never require SRK, and never require a broker.

> **If a user asks about Premium, a plan, a subscription, or "how much does Premium cost" — the
> answer is the Sparky Broker.** The old 10,000-SRK-per-month subscription has been **retired**.
> Never quote a monthly price, an expiry date, or "cancel anytime" for Premium.

## What a Sparky Broker is

A Sparky Broker is a collectible ERC-721 on **Robinhood Chain** — 5,555 of them, ids from 1 to 5,555. It is a
membership you own, and on its own it does nothing.

**You activate it by retiring SRK, once.** That activation is permanent: nothing renews, nothing
expires, there is no clock and there is never a second charge. An activated broker unlocks Premium
for as long as you hold it.

**The one rule everybody misses: transferring the broker clears the activation.** Sell it and your
Premium ends; the buyer receives an *unactivated* broker and retires their own SRK. That is
deliberate — it is what makes the broker worth something to sell, and it is why SparkPoint checks the
chain on every request instead of writing a plan into a database. Reacquiring a broker you sold does
**not** restore the activation; re-activating costs SRK again.

An activated broker wears a two-pixel gold frame in its artwork. The picture and the entitlement are
the same fact.

## Minting and activating

- **Minting is free and open** on testnet — anyone can mint, up to a per-wallet cap. There is no
  holder gate and no allowlist. A freshly minted broker arrives **unactivated**.
- **Activating** retires SRK in a single transaction the holder signs. The SRK goes to an address
  nobody controls. SparkPoint never holds the SRK and never holds the broker.
- Both happen on the **/brokers** page (Trust & Control → Information → Sparky Broker).

⚠️ Say **retired**, never "burned". The token has no burn function, so the total supply does not
change — "burned" would be a supply claim that is not true.

## What SRK is

The alpha SRK is a plain 18-decimal ERC-20 deployed for testing. Its entire supply was minted once at
creation — there is no mint function and no owner, so the supply cannot change. It is deliberately
**not** the older, exchange-listed SparkPoint token; only the name and symbol are shared, for
familiarity.

⚠️ There are **separate SRK deployments per chain** — the Base Sepolia one and the Robinhood testnet
one are different tokens at different addresses. Balances do not carry across and must never be added
together. The one that activates a broker is the one on the broker's chain.

SRK is not an investment. No yield accrues to it, it confers no claim on the vault or on protocol
fees, and SparkPoint quotes no dollar price for it — there is no oracle, so any USD figure would be
invented.

## Getting SRK: the faucet

Anyone can claim **5,000 SRK per 24 hours** from SparkPoint's faucet, which lives on the **/srk**
page (Trust & Control → Information → SRK). The faucet contract holds the tokens and sends them; the
user signs only the claim and pays its gas. A second claim inside the cooldown reverts — the
countdown on the card shows when the next unlocks. The claim amount and cooldown are read live from
the contract, so the figures shown are always the real ones.

## What Premium changes

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

Premium buys more analysis and higher limits. It does not buy better yields, lower fees, or
privileged access to funds, and nothing about custody or the withdrawal path changes with it.
Selling your broker costs you Premium. **It can never cost you access to your own money** — that is a
non-custody invariant, not a pricing choice.

## How SparkPoint knows you have Premium

It reads the chain, every time, and caches the answer for about a minute. **Nothing is written down.**
A stored grant would outlive the sale that should end it, and the result would be a stranger keeping
the access their broker was sold with. So the entitlement lives in the token and nowhere else.

The Premium page names which source is currently paying for a user's access and what would end it.
When it comes from a broker there is deliberately **no expiry date** shown — it ends on transfer, not
on a date.

## Things NOT to say

- ❌ "Premium costs 10,000 SRK per month" — retired. There is no monthly price.
- ❌ "Cancel anytime" / "renew" / "extend a month" — nothing renews.
- ❌ "Your subscription expires on …" — a broker-sourced Premium has no expiry.
- ❌ "Burning SRK reduces the supply" — it is retired to a dead address; supply is unchanged.
- ❌ Any claim that holders receive a share of revenue. **Revenue sharing is not built.** It has been
  discussed as a future direction and nothing about it is live — do not describe it as a benefit, a
  weight, a payout, or a reason to hold. If asked, say it is not currently part of the product.

See [[platform-surfaces]] for where each of these lives in the app, and [[sparky-capabilities]] for
what the assistant itself can and cannot do.
