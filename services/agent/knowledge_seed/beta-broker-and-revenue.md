---
title: Sparky Broker and revenue on the Robinhood Chain beta
source: beta-broker-and-revenue
tags: [sparky-broker, nft, revenue, robinhood-chain, beta, vault, clock-in, promote, fuse, withdraw, sparky-test]
risk_tier: conservative
updated: 2026-09-16
---

# Sparky Broker and revenue on the Robinhood Chain beta (4663)

Robinhood Chain (chain 4663) runs a **rehearsal** of the broker-and-revenue system, at full scale
but with test assets. The parts exist and work; the collection and the token are stand-ins for the
production ones, and nothing there is worth money. This note describes what is true on 4663 **today**
— the production model across other networks is described in `srk-and-premium` and
`platform-surfaces`.

## What is deployed

- **Sparky Broker - Test (SPKBTest)** — an OpenSea drop collection, cap **5,555**. It is a test
  collection: the production Sparky Broker drop arrives later.
- **SPARKYTEST** — a test utility token with no market value and no sale. It exists to be burned by
  the broker engine. It is **not** an investment, and nobody should buy it.
- **BrokerEngine** — the contract that runs clock in / promote / fuse and accrues revenue per round.
- **BrokerVault** — an immutable vault that holds each broker's earnings, keyed by token id.
- **RevenueSplitter** — the fee recipient for trading fees: **90% to the engine, 10% to the
  treasury**, both set immutably on the contract.
- **RoyaltySink** — the destination for marketplace royalties; it forwards to the splitter.

## What a holder does

1. **Hold a broker.** Holding alone earns nothing.
2. **Clock it in.** Clocking in burns a small amount of SPARKYTEST through the engine and starts the
   broker earning. A sale clears it: the next owner clocks it in themselves (the engine checks the
   current owner, not a stored flag).
3. **Promote** it to a higher rank (Associate, then Partner) to record a larger payout weight. A
   promotion charges only the difference the current rank has not already burned.
4. **Fuse** two or three owned brokers into one. The **first one survives**, the others are **burned
   forever** — the collection permanently shrinks — and their banked earnings move to the survivor.
   Fusion needs a one-time approval so the engine can burn the absorbed tokens.
5. **Withdraw.** A broker's earnings sit in the BrokerVault under its token id. The broker's current
   owner withdraws them; nobody else can. If the broker is sold, its vault balance goes with it.

## Where the revenue comes from

Trading fees on the SPARKYTEST curve accrue to the RevenueSplitter (the fee recipient is the
contract, not a wallet). Anyone may sweep them in. The splitter sends **90% to the BrokerEngine** and
**10% to the treasury**, in ETH. The engine holds arriving ETH in a pot, books it to clocked-in
brokers at the round boundary in proportion to their recorded weight, and delivers each broker's
credit into the BrokerVault on-chain. The round is **daily**.

**Revenue is delivered as-is: ETH in, ETH out.** There is no swap, no conversion and no payout asset.
There is also **no projection, no rate and no APY** — the only honest number is what the contracts
hold for a broker right now, and it is often zero.

## What is NOT on Robinhood Chain yet

- The **AI vault** (deposits, yield, strategies) is not deployed on 4663.
- **Premium** is not wired on 4663 — do not offer or quote it there.
- The **production** Sparky Broker collection and the production token are later steps; the current
  collection and SPARKYTEST are a rehearsal.
- The SRK faucet and the SRK Premium purchase are testnet features, not Robinhood Chain features.

## Custody, stated plainly

The **BrokerVault has no owner, no upgrade path, no fee and no rescue function** — the only way value
leaves it is the broker's owner withdrawing. The **BrokerEngine is a UUPS proxy**, so its owner can
upgrade the engine's behaviour; that cannot move what the vault already holds. Every action here is
**user-signed or permissionless** (clock in / promote / fuse / withdraw are the holder's; settle,
deliver and sweeps may be called by anyone), and no automated agent path can reach any of these
contracts.
