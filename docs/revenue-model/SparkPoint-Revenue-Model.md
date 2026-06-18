# SparkPoint Revenue Model

*The First AI-Native, Non-Custodial Onchain Hedge Fund*

SparkPoint earns money only from value it demonstrably creates for users, never from holding their funds and never from charging a fee on the money they deposit. This document sets out how SparkPoint monetizes at launch, how that model grows as new products ship, and how it compares to the rest of the market.

> ## Guiding principle
>
> **We only earn when you earn — never on your principal, never by taking custody.**

Every figure in this document labelled *illustrative* is a mechanical example of how the fee math scales, not a forecast or a return projection. The headline performance fee is **10% of realized yield** (profit-only, high-water mark, hard-capped at 20%, default 10%).

---

## 1. Revenue Model at Launch (v1, September 2026)

SparkPoint launches with **three active revenue streams**. None of them touches a user's principal, and none of them requires SparkPoint to take custody of user funds. The conservative Aave Yield Vault charges **0% management fee and 0% on principal** — and adds a **profit-only performance fee on the yield it actually earns you**.

### The three launch streams

| Stream | What it is | Rate | Who pays | Non-custody note |
|---|---|---|---|---|
| **1. Performance fee — Aave Yield Vault** | A profit-only, high-water-mark fee on realized **yield** earned by the conservative vault. 0% management, 0% on principal, fully disclosed. | **10% of realized yield** (configurable on-chain, hard cap 20%, default 10%) | Vault depositors — but only on profit, never on deposits | Collected by minting fee shares to an ordinary, non-privileged recipient. Fee never reduces redeemable principal; withdraw-always is never blocked. |
| **2. Swap-routing fee — Aerodrome** | A small, transparent usage fee on swaps the assistant executes for the user. | **~20 bps (0.20%)**, set within a 15–30 bps range | Chat users who choose to execute a swap. First N swaps free. | Taken inside the user-signed swap transaction. Never touches the vault, vault flows, or principal. |
| **3. Premium AI tier** | An optional, paid upgrade for advanced AI capability. Freemium: the free tier is fully capable. | **Free tier: $0.** Premium: tiered/metered, paid in SRK | Users who opt in to premium for advanced AI features | Premium never gates the vault, deposits, yield, or withdrawals. Paid via a user-signed, non-custodial transaction. |

### How each stream protects the trust promise

**Performance fee (vault).** The fee applies only to gains above a per-share high-water mark. If the vault is flat or down, there is no fee. A user is never charged twice on the same gains after a drawdown and recovery. The fee is collected by minting shares to a recipient who redeems through the same path as any other user and has no special authority — it cannot block, delay, or reorder anyone's withdrawal. A user's redeemable principal is never reduced below what they deposited. Every receipt states it plainly: *"SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal."*

**Swap-routing fee.** This is an honestly-labelled usage fee for a service the assistant performs, shown explicitly in the pre-trade simulation before the user signs. New users get their first few swaps free so they can verify the experience before paying anything. Users who only deposit, earn, hold, or withdraw pay nothing.

**Premium AI tier.** The free tier — the core assistant, the vault, swaps, and the withdraw-always exit — is fully usable with no payment and no token required. Premium only *adds* advanced capability (deeper analysis, higher limits, priority compute, advanced analytics). It is the concrete launch utility for the SRK token, but SRK is never required to use the vault or to withdraw.

### Illustrative unit economics at beta / launch scale

*Illustrative mechanics only — not projections. Inputs are placeholders.*

| Stream | Beta scenario | Driver | **Illustrative annual revenue** |
|---|---|---|---|
| **Performance fee (vault)** | $10M vault TVL, 4% net Aave yield, 10% fee | TVL × net yield × 10% | **~$40K** |
| **Swap-routing fee** | $5M monthly swap volume at 20 bps | volume × 0.20% | **~$120K** |
| **Premium AI tier** | 6,250 free users, 8% convert, ~$25/mo | conversions × price | **~$150K** |
| **Combined (growing-beta mix)** | all three streams stacked | — | **~$310K** |

The vault performance fee is modest early because conservative Aave yield is modest — but it is live from day one and grows directly with vault size and yield. The swap and premium streams already prove that a *0%-on-principal* vault is not a *$0-revenue* business.

---

## 2. Future Revenue Model (following future features)

As SparkPoint ships more advanced products, the **same profit-only performance-fee spine** extends to higher-alpha vaults, and a small number of new, opt-in streams layer on top. Each is capped, transparent, and never gates a user's ability to withdraw. The conservative Aave Yield Vault stays **0% management / 0% on principal forever** — it remains the trust wedge and the side-by-side honesty benchmark.

| Future feature | Revenue stream | Rate / mechanic |
|---|---|---|
| **Advanced strategy vaults** (yield-optimization, market-neutral, volatility-harvesting) | Performance fee on realized yield | **10%** on the conservative tier; **up to 15–20%** on higher-alpha vaults, justified by genuine alpha. High-water mark; optional hurdle (fee only on out-performance vs. the Aave baseline). Hard cap 20%. |
| **Multi-strategy fund / LP shares** | Optional thin management fee + curator-style cut | Management fee **0% by default, capped at 0.25%/yr**, only on genuine allocation products. Curator/protocol cut taken as a slice *of the fee* a strategy charges, within protocol-enforced caps (perf ≤ 20%, mgmt ≤ 0.25%/yr). |
| **SRK token economics** | Fee discounts + fee-funded buyback | SRK may grant capped performance-fee **discounts** and receive a transparent, real-fee-funded **buyback / revenue share**. SRK never gates vault use or withdrawal; no subsidized or emission-driven yield. |
| **B2B / white-label** | License the non-custodial stack | License the account, vault, policy, and agent rails to partner teams as a setup + per-AUM or per-yield rake. Licensees must contractually preserve the non-custody and AI-never-final-authority guarantees. |

### Illustrative growth scenarios

*Performance-fee spine on advanced strategy-vault TVL — illustrative, not projections.*

| Scenario | Strategy-vault TVL | Net yield | Fee | Yield earned for users | **Illustrative protocol revenue** |
|---|---|---|---|---|---|
| **Early** | $10M | 6% | 10% | $600K | **$60K** |
| **Traction** | $100M | 6% | 10% | $6.0M | **$600K** |
| **Scale** | $500M | 8% | 10% | $40.0M | **$4.0M** |

Because the fee is a cut of *yield generated* — not of principal — revenue is zero in a zero-yield year and scales with both TVL and realized yield. For reference, the leading vault curators in the market today earn roughly $0.1M–$1.8M annually even at $100M–$1.5B in TVL, so the *Scale* scenario is ambitious but grounded, reachable only after the trust wedge has done its job of winning TVL.

---

## 3. Competitor Revenue Model Comparison

SparkPoint was designed against a thorough survey of how capital-managing and AI-agent products actually make money. The dominant pattern is a profit-gated performance fee on realized yield — roughly **10%** at the efficient AI-agent end, **15–20%** for higher-touch strategy and structured products — usually paired with a small management fee and, often, token subsidies that inflate headline yield.

| Competitor | Category | Primary model | Rate | Notes |
|---|---|---|---|---|
| **Yearn** | DeFi yield aggregator | Mgmt + performance fee (v3 configurable + protocol fee) | 2% + 20% (v2); v3 manager-set, 0–50% protocol cut | On-chain at harvest. "Vault-as-a-service" rake is a clean B2B template. |
| **Beefy** | Autocompounder | Performance fee on harvested yield | 4.05% standard (up to 9.5%) | Profit-gated; split across stakers / treasury / strategist / keeper. |
| **Morpho** (+ curators **Gauntlet / Steakhouse / Re7**) | Lending infra + curated vaults | Protocol fee switch (off) + curator-set performance fee | Switch capped 25%, never on (0%); curators 0–20% (cap 50%) | $256M+ cumulative protocol fees, $0 to token holders. Curators race fees toward 0% to win TVL. |
| **Aave** | Base lending protocol | Reserve factor (spread on borrow interest) | ~10–25% per asset | Upstream yield source. ~$50M/yr buyback; moving to 100% revenue to DAO. |
| **Giza / ARMA** | AI DeFi agent | Performance fee on realized yield | 10% (no deposit/withdrawal/mgmt fee) | Cleanest model, but token-subsidized APY collapsed to near-zero TVL after the airdrop. |
| **Almanak** | AI strategy marketplace | Creator-set mgmt + perf; DAO take; compute margin | Defaults unverified; DAO take ~10–20% | Creator-marketplace fees + token-staking discounts. |
| **Brahma** | AI agent infra (B2B) | Per-agent perf fee + subscription | Morpho Agent 10% of yield | Validated the "infra + 10%" pattern, but standalone agent-infra was hard to sustain (wound down). |
| **Bankr** | Chat/trading agent + launchpad | Per-trade swap fee + token-launch fee | ~0.8% routed-to-buyback share; 1.2% launch-token swap | Volume-dependent; ~60% of revenue to token holders. |
| **Virtuals** | Token launchpad | Creation fee + trading tax | 1% baseline trade tax (70/30 creator/treasury) | Hype-correlated revenue; buyback-and-burn. |
| **daos.fun** | On-chain fund wrapper | Creator carry + DAO-token trade fee | Carry = manager-set % of profit; 1% trade fee | Fixed-term funds; highly reflexive. |
| **Numerai** | AI hedge fund (benchmark) | AUM mgmt + performance fee | 1% + 20% | Off-chain regulated fund; stake/burn tournament layer. |
| **Wealthfront / Betterment** | TradFi robo-advisor (benchmark) | Flat AUM advisory fee | 0.25%/yr (Betterment Premium 0.65%) | The low-cost passive anchor; no performance fee. |
| **Cega / Ribbon** | Structured products (benchmark) | Mgmt + performance fee on options vaults | 2% + 15% (Cega); 2% + 10% (Ribbon) | Profit-gated at epoch; higher fees justified by option premia. |

### Where SparkPoint sits

SparkPoint is the only entrant in this set that is **profit-only, non-custodial, and fee-only-on-profit** all at once: a high-water-mark fee that earns nothing in flat or down periods, zero fee on principal, and a vault a user can always exit without us. That posture is something the token-subsidized agents (which manufacture headline yield with emissions) and the custodial or off-chain funds (which hold user money and accrue fees behind a wallet they control) structurally cannot claim. We monetize delivered yield and chosen usage — provable on-chain — not speculation, custody, or principal at rest.
