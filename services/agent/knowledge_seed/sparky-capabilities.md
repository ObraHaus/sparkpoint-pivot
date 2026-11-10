---
title: What Sparky Can and Cannot Do
source: sparky-capabilities
tags: [sparky, assistant, capabilities, memory, automation, non-custody, faucet]
risk_tier: conservative
updated: 2026-11-09
---

# What Sparky Can and Cannot Do

Sparky is SparkPoint's assistant. It reads a user's wallet and positions,
explains DeFi in plain language, suggests strategies from a fixed whitelist, and
prepares transactions for the user to sign. It does not hold funds, cannot move
funds, and has no ability to act on a wallet that the owner has not explicitly
authorized. Everything below describes capabilities that exist in the product
today — nothing here is planned or aspirational.

## Signing: the user signs, always

SparkPoint is non-custodial. There is no SparkPoint-controlled key that can move
a user's money. When Sparky proposes a deposit, withdrawal or swap, it builds an
unsigned transaction; the user's own wallet signs it, and only then does anything
reach the chain. A proposal that fails the deterministic policy check is shown
without any way to sign it at all — that check runs in code, never in the model,
so no phrasing of a request can talk the assistant past it.

Withdrawing is always available. There is no lock-up, no notice period, and no
condition under which SparkPoint can refuse to return funds — the vault is an
ERC-4626 contract and redemption is a direct call on it.

## Memory: Sparky remembers across conversations

Sparky keeps a short, rolling digest of what a wallet has done on the platform.
It carries across conversations, so a brand-new chat is not blank: asked "what
did we do last time?", Sparky can answer.

The digest also folds in activity that never went through the chat at all — a
deposit made on the Vault page, a withdrawal, a swap, a claim from the faucet.
That fold happens when the next chat turn starts, so a move made an hour ago on
another page is already known.

It stores short prose lines only — a description of what happened. It never
stores balances as authority, and memory can never widen what the assistant is
allowed to propose: a suggestion made "because you did this before" faces exactly
the same policy check as any other. Users can read the whole digest and erase it
from **Settings → Memory**; clearing it is immediate and permanent.

## Automation: scoped, revocable session keys

Sparky cannot trade a wallet on its own initiative, and there is no setting that
grants it that power. What exists is a **session key**: a permission the user
creates, scoped to specific actions with specific limits and an expiry. While it
is active, an in-scope move can go through without a fresh signature each time.
The user sets the scope, and can revoke it instantly from **Settings → Security
→ Active session keys**. Revocation takes effect on chain. Actions under a
session key are still bound by the user's mandate and the same policy checks.

"Hands off" therefore means *no signature prompt*, not *no human*. Nothing is
autonomous: the user has already approved the shape of what can happen.

## Test funds: the faucets

On testnet, users need two things: gas (Base Sepolia ETH) and SRK.

- **SRK** comes from SparkPoint's own faucet, at **/srk** (Trust & Control → Information → SRK).
  Anyone can claim 5,000 SRK per 24 hours — it is not a Premium perk. SRK's one use is activating a
  Sparky Broker, which is what grants Premium; there is no monthly subscription.
- **Base Sepolia ETH** for gas comes from public faucets, not from SparkPoint.
  The Coinbase Developer Platform faucet and the Alchemy Base Sepolia faucet are
  the usual sources. A user who cannot get gas cannot sign anything, so this is
  the first thing to sort out.

Testnet funds have no monetary value. Telling a user where to get them is part of
the product, not "outside its scope".

## Swaps and bridging

There are two swap paths, and they are deliberately different:

- **Manual `/swap`** — a same-network, user-signed EVM swap on the wallet's supported chain (Base or Robinhood Chain in the freeze build), with the 0.20% routing fee where the fee router is wired. The page does not change the user's MetaMask network.
- **Sparky chat — cross-chain via NEAR Intents (1Click)** — USDC→BTC, ETH→Base, USDC→SOL and similar routes. Sparky shows a preview (amount, destination, fees) before anything is sent; the user sends from their own wallet to a one-time deposit address, and an incomplete swap is refunded to the stated refund address.

There is still **no standalone bridge** outside the Intents flow. If a route or destination is
unsupported, Sparky says so rather than inventing a route or falling back to a different chain. See [[multichain-dual-access]].

## Earn and live reviews: previews by default

Sparky reads the same earn registry as the `/vault` page: **Morpho** on Base and Ethereum, **Kamino**
on Solana, and **Rhea (Burrow)** on NEAR. It can list vaults and build dry previews that show the
estimated receipt, fees, destination and APY provenance, but a preview does not sign or send.

Live deposit/withdraw reviews are built but **off by default**. They appear only when an owner
enables the matching flags: `NEXT_PUBLIC_EARN_LIVE_KAMINO` / `EARN_LIVE_KAMINO`,
`NEXT_PUBLIC_EARN_LIVE_MORPHO` / `EARN_LIVE_MORPHO`, `NEXT_PUBLIC_EARN_LIVE_RHEA` /
`EARN_LIVE_RHEA`, and `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` / `EARN_LIVE_RHEA_XCHAIN` for the
cross-chain Rhea live commit. With the flags off, only previews and reads are available.

When enabled, the review builds an **unsigned** transaction and the user's own wallet signs it.
SparkPoint never signs, approves, submits or broadcasts. No funded execution is claimed until an
owner-approved funded test, and simulations are labelled **SIMULATED**.

Rhea has two separate rails: **same-chain** NEAR USDC supply/withdraw (078), signed by the user's
NEAR wallet, and **cross-chain** EVM USDC → Rhea on NEAR through 1Click plus a Multichain Account
(079), whose withdraw is a **guided review** of the documented Rhea SDK paths and the Rhea app
link-out — not an in-app signed transaction.

The beta is at **https://beta.sparkpoint.io**. See [[multichain-dual-access]] for the rail-by-rail
detail and withdraw postures.

## What Sparky will not do

It will not give financial advice, tell a user how much of their savings to
commit, or promise a return. Yields are variable and nothing here is insured.
Asked whether to go all-in, the honest answer is to set a mandate first — a limit
the policy engine enforces automatically — and pick a strategy second.

See [[platform-surfaces]] for where each of these lives in the app, and
[[srk-and-premium]] for what SRK and Premium actually change.
