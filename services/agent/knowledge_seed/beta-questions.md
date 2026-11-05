---
title: Common Beta Questions, Answered Plainly
source: beta-questions
tags: [faq, morpho, aave, apy, slippage, fees, near, non-custody, quota, mandate, beta]
risk_tier: all
updated: 2026-11-05
---

# Common Beta Questions, Answered Plainly

This note collects the questions beta users ask most often. It describes what the
product actually does today, and it says plainly when something is not live yet.
See [[platform-surfaces]] for where each surface lives, and [[sparky-capabilities]]
for what the assistant itself can and cannot do.

## Morpho vs Aave: what is the difference?

SparkPoint uses **both**, in different places.

- **The SparkPoint Aave Yield Vault** is SparkPoint's own ERC-4626 vault. On Base it
  supplies deposited USDC to **Aave v3**, a large shared lending pool. Borrowers pay
  interest, suppliers earn the supply rate, and the rate floats with how much of the
  pool is borrowed. The vault auto-compounds and charges its performance fee only on
  profit above a high-water mark. See [[profit-only-vault]] and [[aave-v3-supply]].
- **The curated board** lists third-party ERC-4626 vaults that Sparky screens and
  ranks. On Robinhood Chain many of these are **Morpho Vault V2** vaults run by
  professional curators (for example Steakhouse). Morpho is not one shared pool: it is
  a framework for isolated lending markets and curated vaults, so each vault carries
  its **curator's** allocation choices on top of the underlying market risk. SparkPoint
  shows the curator, the stored TVL, the stored net APY and the as-of date, and may
  add its own performance-fee wrapper where one is deployed. A curated vault without a
  wrapper is deposited **directly**, with no SparkPoint fee, and the board says so.

**The honest risk comparison.** Aave risk is concentrated in one large, widely used
lending market plus the vault contract. A Morpho-based curated vault adds curator risk
(the curator chooses markets and collateral), the risk of its specific isolated
markets, and potentially tighter withdrawal liquidity. Neither is automatically safer,
and neither is insured. Aave's supply rate and Morpho's net APY can both fall, and a
stablecoin can de-peg.

**One fee detail matters.** SparkPoint's own `SparkPointVault` keeps a real
high-water mark, so it charges nothing while a depositor is below their previous high.
A **Morpho Vault V2** keeps no high-water-mark state: on such a vault, a gain after an
earlier loss can be charged even while the depositor is still below that earlier high.
In both cases the fee is on gains, never on principal, and a flat period earns no fee
on the SparkPoint vault. Each vault's own screen states its exact terms before signing.

## How is APY calculated, and why does it change?

**Gross APY** is the annualised rate the underlying strategy is currently earning — for
the Aave vault, the Aave v3 USDC supply rate. It is driven by **utilization**: the
share of supplied liquidity that is borrowed. More borrowing demand pushes the rate
up; repayments and new supply push it down. It is a **spot reading**, not a promise,
and it moves block to block.

**Net APY** is what a depositor keeps after fees. For the SparkPoint Aave vault it is
the gross supply rate minus the performance fee on the yield portion — by default a
10% fee on profit above the high-water mark, so 0% is taken from principal. For a
curated third-party vault, the stored net APY is the figure the vault or its curator
reports after its own fee chain; where SparkPoint adds a wrapper fee, the board
discloses that wrapper separately.

Every APY Sparky states carries an **as-of** date. Stored figures older than about
48 hours are called out explicitly, because a rate that is days old can look fresh
while being wrong. The **Vault** page (`/vault`) is always the place to see the
current stored board. See [[risk-profiles]] for how a mandate uses these figures —
they inform ranking, never a guarantee.

## What is slippage, and what is the 0.20% swap fee?

**Slippage** is the difference between the price you expect on a swap and the price
you actually get, caused by the market moving while your transaction executes or by
your order being large relative to available liquidity. You set a maximum slippage;
if the trade would exceed it, it should not go through. Slippage is a market outcome,
not a SparkPoint charge.

**The 0.20% swap fee** is SparkPoint's routing fee on swaps routed through
SparkPoint. It is separate from slippage and from the underlying DEX pool fee. It is
taken on the input side of the swap by the fee router, and the swap is still
user-signed. See [[platform-surfaces]] for the `/swap` surface and the Fees page.

## What is NEAR Intents, and is it live?

**NEAR Intents** is a cross-chain execution model in which a user expresses an
intent (for example, "swap this asset on this chain for that asset on another
chain") and solvers compete to fill it. SparkPoint uses it, through 1Click, for
**cross-chain swaps in Sparky chat**.

In the freeze build, ask Sparky to swap **USDC→BTC**, move **ETH→Base** or swap
**USDC→SOL**. Sparky shows a preview with the amount, destination and fees before
anything is sent; the user sends from their own wallet to a one-time deposit
address, and an incomplete swap is refunded to the stated refund address. The
**manual `/swap` page is the same-network EVM swap**, not the cross-chain product.
There is no standalone bridge outside the Intents flow, and an unsupported route
is refused honestly. See [[multichain-dual-access]].

## Non-custody and signing: who can move my funds?

Only you. SparkPoint holds no private keys that can move user funds. When Sparky
proposes a deposit, withdrawal or swap, it builds an **unsigned** transaction; your
own wallet signs it, and only then does anything reach the chain. A proposal that
fails the deterministic policy check is shown without a way to sign it at all — that
check runs in code, not in the model.

Withdrawing is always available. The vault is an ERC-4626 contract, so redemption is
a direct on-chain call: there is no lock-up, no notice period, and no SparkPoint
approval that can withhold it. Session keys (where a network offers them) are scoped,
time-boxed permissions you create and can revoke; they remove the repeated signature
prompt, not your control. See [[sparky-capabilities]] and [[profit-only-vault]].

## Is there a daily question limit?

Yes — the AI-compute surfaces have a daily allowance, and it never gates custody,
withdrawals or the vault.

By default the **Free** tier includes **40 chat turns**, **10 recommendation
requests** and **20 onboarding turns** per day. **Premium** raises those to **400**,
**100** and **40**. The window resets at **midnight Asia/Manila (UTC+8)**. A turn that
fails because the AI provider is unavailable is refunded, so a degraded answer does
not cost you a question. Limits are advisory compute only: `/exit`, `/trust`, the
vault and the on-chain withdraw path are never checked against them. See
[[srk-and-premium]] for what Premium is and how a Sparky Broker unlocks it.

## What is a mandate, and why does it matter?

A **mandate** is the plain-language agreement you confirm during onboarding: your
goal, time horizon and risk profile (conservative, moderate or growth), plus the
limits that follow from them. It shapes which whitelisted strategies are ranked
first and how much a single move may be — but it is **advisory framing**, not
permission. Hard caps and slippage bounds are enforced separately by the
deterministic policy layer, and every proposal still needs your signature.

You can change the mandate later in Settings. A mandate can make the assistant more
conservative; it can never unlock a protocol outside the whitelist, and it never gives
SparkPoint custody. See [[risk-profiles]].

## Quick answers

- **Is my yield guaranteed?** No. Rates are variable, and deposits are not insured.
- **Can SparkPoint freeze my withdrawal?** No. Redemption is a direct ERC-4626 call.
- **Do I need SRK to use the vault or the assistant?** No. SRK activates a Sparky
  Broker, which unlocks Premium; core access never requires it.
- **Does SparkPoint quote an SRK price?** No. There is no oracle, so any USD figure
  would be invented.
- **Are BTC, SOL and NEAR tradeable here?** Yes as **cross-chain destinations via Sparky chat**
  (NEAR Intents): for example USDC→BTC or USDC→SOL. The manual `/swap` page stays same-network
  EVM. The product does not custody these assets.
