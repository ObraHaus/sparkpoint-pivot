# SparkPoint Pivot — Revenue Model Plan

> **What this document is:** the authoritative revenue-model plan for SparkPoint Pivot. It defines *how* we monetize "The First AI-Native Onchain Hedge Fund" without breaking the trust spine the product is built on. It is written to be **reconciled with the Constitution** (`.specify/memory/constitution.md`, v1.1.0) and the high-level plan (`docs/high-level-plan/high-level-plan-v2-native-non-custodial.md`).
>
> **Authoritative status:** This plan authorizes **three active-at-launch revenue streams**, all non-custodial and all compliant with the ratified Constitution (v1.1.0): a transparent Aerodrome swap-routing fee, an optional premium AI tier (neither touches the vault principal or custody), and — newly ratified — a **10% profit-only, high-water-mark performance fee on the launch Aave Yield Vault's realized yield**. The swap fee requires only a **minor spec addition** (a new FR). The launch Aave Yield Vault is now **0-management / profit-only performance-fee** (0% management fee, 0% on principal, 10% on realized yield only above a high-water mark) — the Principle V amendment (constitution v1.0.0 → v1.1.0) that authorizes the vault performance fee is **RATIFIED and in force**; see §3 Phase 0 / Launch and the compliance matrix in §5.1. The vault performance fee (Stream 1A-Launch) is **ACTIVE at launch**; §5.2.B records the now-completed amendment.
>
> **One-line thesis:** **Fair, transparent fees from day one — we only earn when you earn, never on your principal, never by taking custody.**

---

## 1. Context & the core tension

SparkPoint launches with a **0-management / profit-only-performance-fee vault and a non-custodial architecture**. That is not a pricing accident — the *0-fee-on-principal* vault is the trust wedge. The market we are entering ("AI hedge fund") is discredited: ~99% token drawdowns, a fraud class action alleging an AI "never existed as presented," a study finding 62% of users lost money across leading AI-trading platforms, and Giza/ARMA's token-subsidized ~15% APY that evaporated to near-zero TVL after the airdrop. Our credibility strategy is **"earn trust on the principal, charge only fairly and transparently for the work we do — and only on the profit we make you."**

The launch model has **three active revenue streams**, and none of them charge your principal: a swap-routing usage fee, an optional premium AI tier, and a **10% profit-only performance fee on the launch vault's realized yield** (0% management, 0% on principal, high-water mark). **The 0-fee guarantee is about your principal** — never deposits, never AUM at rest — not about every interaction with the product. We charge fairly and transparently for *usage* (a small swap-routing fee on swaps the assistant executes), for *optional advanced capability* (a premium AI tier), and for *value we demonstrably created* (a cut of realized yield above a high-water mark), while your principal stays free. That is the resolution of the apparent tension:

- **The Constitution fixes the launch vault at 0-management / profit-only performance-fee** (Principle V, as amended in v1.1.0: "a SINGLE conservative Aave Yield Vault … 0 management fee, 0 fee on principal, and a capped (≤20%), profit-only, high-water-mark performance fee on realized yield, default 10%"). Principle III requires yield "net of everything" and bans token-incentive yield. Principle I forbids any code path that moves user funds to a SparkPoint-controlled address. **None of the launch revenue streams below change any of that.**
- **A business makes money from day one — fairly.** Revenue at launch comes from a transparent, usage-based swap fee, an optional premium tier, and a profit-only performance fee on the vault's realized yield — none of which touches principal or custody.

So the model is **two complementary moves working together from launch:** (1) charge fairly and transparently for *usage and optional capability* (the swap fee and premium tier), and (2) charge a *cut of value we demonstrably created* for the user (the performance fee on yield) — now active on the launch vault under the ratified Principle V amendment, and extending to the advanced, opt-in strategy vaults as they ship (Phases 1–2). We never monetize the vault's principal, and we never take custody.

### The guiding principle (load-bearing — reuse verbatim)

> **Fair, transparent fees from day one — we only earn when you earn, never on your principal, never by taking custody.**

Operationally this means four hard rules that every revenue stream in this document is tested against:

1. **Never on principal.** The vault principal is **always free** — no deposit, withdrawal, or management fee on the conservative Aave vault at launch (the launch vault charges **0% management, 0% on principal**, and a profit-only performance fee on realized yield above a high-water mark). A fee may only ever land on (a) *value we created over your principal* (realized yield/profit) or (b) a *discrete service you used* (executing a swap, premium assistant features) — never on deposits or AUM at rest (with one narrowly-scoped, opt-in, capped exception evaluated in Phase 2).
2. **Usage fees are honestly labeled as usage fees.** The launch swap-routing fee is a **usage fee on a service the assistant performs**, not a custody fee and not a fee on the vault. It is shown explicitly in the simulation/confirmation before the user signs, taken inside the user-signed swap, and never touches the vault or principal.
3. **Non-custodial.** Fees are collected without the protocol ever holding, moving, or withholding user funds — the swap fee is taken inside the user-signed swap transaction; any yield/performance fee is collected on-chain by **minting/accruing vault shares to a fee-recipient address** or skimming at harvest. The withdraw-always escape hatch (N2) is never impaired by any fee mechanism.
4. **Provable & transparent.** Every fee is disclosed up-front, itemized, and (for on-chain fees) verifiable from chain data, shown net-of-everything (Principle III). We never lead with a return projection to sell a fee, and we offer a "first N swaps free" trust option so users can verify the experience before paying anything.

This is also a *positioning* asset: "fair, transparent fees from day one — fee only on profit or on a usage you chose, 0-fee on principal, non-custodial" is a claim the discredited cohort and the custodial funds structurally cannot make (see §6).

---

## 2. Revenue-model taxonomy — the competitor menu, scored for fit

Below is the menu of revenue models observed across the competitor research, each scored for SparkPoint **fit** (how well it matches our product and roadmap), **trust-risk** (how much it endangers the trust wedge / constitution), and **effort** (build + governance cost). Scores are H/M/L. All figures are from the assembled research (June-2026 point-in-time snapshots where dollar values are cited; treat as illustrative, not projections).

| # | Model | How it works (competitor evidence) | Fit | Trust-risk | Effort | Verdict for SparkPoint |
|---|---|---|---|---|---|---|
| 1 | **Performance fee on realized yield** | Profit-gated % of yield, collected on-chain at harvest/withdrawal. Giza/ARMA **10%**; Yearn v3 manager-configurable (10% a common factory convention, *not* a hardcoded rate); Beefy **4.05%** standard (split 3.0% stakers / 0.5% treasury / 0.5% strategist / **0.05% harvest-caller**), up to 9.5% max post-BIP:45; Morpho curators **0–20%** observed (cap 50%); Numerai 20% incentive fee. | **H** | **L–M** | **M** | **CORE — ACTIVE AT LAUNCH.** The most defensible, most constitution-compatible model. Profit-gated by construction. Now live on the launch Aave Yield Vault (10% of realized yield, HWM) under the ratified Principle V amendment (v1.1.0), and the spine that extends to the Phase 1 strategy vaults. |
| 2 | **Management / AUM fee** | Flat %/yr on assets at rest. Yearn v2 historical 2%; Cega/Ribbon ~2%/yr; Morpho V2 cap 5%/yr; robo-advisor floor **0.25%/yr** (Wealthfront flat 0.25%; Betterment Digital 0.25%, Premium 0.65%). | **L–M** | **H** | **M** | **DEFER / narrow.** Charges principal even in down periods — violates "never on your principal" in spirit. Only viable as a *tiny* (≤0.25%) optional component on premium multi-strategy products in Phase 2, never on conservative vaults. Most curators compete this toward 0%. |
| 3 | **Swap-routing fee (bps)** | Thin % on swaps routed through the platform. Exponential.fi ~0.2% (unverified); Bankr ~0.8% routed-to-buyback portion (gross unverified); Virtuals/Axal/daos.fun ~1% trade tax. | **M–H** | **L–M** | **L** | **ACTIVE AT LAUNCH (usage fee).** We already route Aerodrome swaps from chat. A small, transparent routing fee (**recommend 20 bps; 15–30 bps range**) is taken inside the user-signed swap, shown pre-sign in the simulation, never touches vault principal or custody. Framed honestly as a *usage fee* (not a yield/custody fee) with a "first N swaps free" trust option, the trust-risk is low and it gives a real revenue stream from day one. Constitution-compliant today (needs only a minor spec FR addition). See §3 Phase 0 / Launch. |
| 4 | **Curator / strategy-creator fee** | Third-party strategists set mgmt/perf fees on vaults; protocol skims a slice. Morpho "curator sets fee, protocol provides rails"; Yearn v3 **Protocol Fee 0–50%** of fees the Accountant collects (docs example: 100 profit, 20% perf, 10% protocol fee → 18 to manager, 2 to Treasury); Almanak DAO take on creator commissions. | **M–H** | **M** | **H** | **PHASE 2.** Strong template once we open a multi-strategy/curator marketplace. Lets SparkPoint rake a protocol cut without charging users a higher headline fee. Requires governance + a fee-cap framework. |
| 5 | **SRK access tiers + fee-share/buyback** | Token gates discounts/access; fee revenue funds buyback/burn or staker distribution. Aave 100%-to-DAO + ~$50M/yr buyback; Beefy routes ~3.0% of 4.05% to BIFI stakers; Giza fee-funded buybacks; Virtuals buyback-and-burn; Bankr fee→buyback. | **M–H** | **M–H** | **M** | **PHASE 2, GUARDRAILED.** SRK may grant *fee discounts* and receive a *transparent slice* of protocol revenue (stake-revenue-share and/or buyback). **Hard limit:** SRK must NEVER gate the ability to use the vault or to withdraw (Principle V). No subsidized APY / yield theater (Principle III). |
| 6 | **Premium AI subscription (FREEMIUM, premium paid in SRK)** | Pay for the AI interface, not a cut of AUM. Hey Anon "Pass" (~15 queries/day) + ~$0.60/query; Griffain stablecoin-priced "energy"; Almanak compute-margin. | **M–H** | **L** | **M** | **ACTIVE AT LAUNCH (freemium).** Free tier is fully usable (core assistant + vault + swaps + withdraw-always, no SRK needed); the optional **premium tier is paid in SRK** (the token's concrete launch utility), unlocking advanced AI features. Charges for advanced capability, not for custody or principal. Must stay *non-essential* — premium NEVER gates the vault or withdrawals, and SRK stays non-essential to core function. Constitution-compliant today (not a vault fee). See §3 Phase 0 / Launch. |
| 7 | **B2B / white-label of the non-custodial AI-fund stack** | License the execution/agent infra. Brahma ConsoleKit (productized Morpho Agent took 10% of yield); Yearn v3 vault-as-a-service; Exponential.fi ratings/B2B licensing. | **M** | **L** | **H** | **PHASE 2+.** Sell the rails (AA + ERC-4626 + policy layer + agents) to other teams. Caution: Brahma's standalone agent-infra business was hard to sustain (acquired/wound down). Best as a *supplement* to AUM-based revenue, not a base. |
| 8 | **Float / treasury yield** | Yield on protocol's own treasury/operating capital. Implicit across protocols; not a user-charged fee. | **M** | **L** | **L** | **EVALUATE.** Earning yield on *SparkPoint's own* treasury (e.g., in our own conservative vault) is non-custodial and charges users nothing. Modest but clean. Never route *user* float to the protocol — that would breach non-custody. |
| 9 | **Structured-product fees** | Higher mgmt+perf on principal-at-risk products. Cega 2% + 15% perf; Ribbon/Aevo 2% + 10% perf, profit-gated weekly. | **L–M** | **M–H** | **H** | **LATE / OPTIONAL.** Only relevant if/when the roadmap reaches volatility-harvesting / options-like products. Higher fees are justifiable on genuine alpha/option premia but raise risk-disclosure and "looks like the funds we criticized" concerns. Keep gated behind explicit opt-in + risk labeling. |

**Read of the menu:** the spine — and our best fit — is **a profit-gated performance fee on realized yield (model 1)**, collected on-chain, and it is **active from launch** on the Aave Yield Vault under the ratified Principle V amendment (v1.1.0). Alongside it, the menu yields two more **active day-one streams**: the **swap-routing fee (model 3)** and the **premium AI tier (model 6)**, both *usage / optional-capability* fees that never touch the vault, principal, or custody — so their trust-risk is low when disclosed transparently. Together these are the **three active launch streams**. The performance fee (model 1) then extends to the advanced, opt-in strategy vaults as they ship (Phase 1). Later supplements: a curator cut (4), an SRK fee-share/buyback (5), and B2B (7). Models 2 (AUM fee) and 9 (structured products) carry the most trust-risk and are deferred/narrowed.

---

## 3. Recommended model — phased, mapped to the roadmap

The roadmap (from the constitution + plan): **Launch (single Aave Yield Vault) → Yield Optimization → Market-Neutral → Volatility Harvesting → Multi-Strategy Fund → LP Share Mechanics**; platform expansions: Full Hedge Fund → Stocks/TradFi → General Financial Assistant. Revenue at launch comes from **three active, fair, transparent streams** — a swap-routing usage fee, an optional premium AI tier, and a profit-only performance fee on the launch vault's realized yield (all now permitted under the ratified Constitution v1.1.0); the performance-fee spine then grows through Phases 1–2 onto the advanced, opt-in strategy vaults.

### Phase 0 — Launch (Sept 2026 v1). A WORKING revenue model from day one — your principal stays free.

The launch `SparkPointVault` (ERC-4626, non-upgradeable) is **0-management / profit-only performance-fee** exactly as the amended Principle V requires — **0% management fee, 0% on principal, 0% deposit/withdrawal**, plus a **10% profit-only performance fee on realized yield above a high-water mark** (configurable on-chain within a hard cap of 20%, default 10%); pure Aave v3 yield, net of everything, no token incentives (Principle III, Principle V). The *0-fee-on-principal* vault is still the trust wedge — we only earn when you earn. **"0-fee vault" never meant "$0 revenue":** revenue at launch comes from three streams, none of which touches your principal or custody.

There are **three active-at-launch streams**: two usage / optional-capability streams (A) that comply with the constitution and need only a minor spec addition, plus the vault performance fee (B) that is now live under the ratified Principle V amendment (v1.1.0).

#### (A) Active at launch — no constitution amendment, no fee on principal, non-custodial

**Stream 0A — Aerodrome swap-routing fee (a transparent usage fee).**

- **Rate (proposed):** **20 bps (0.20%)** on swaps the assistant executes for the user, stated as a **15–30 bps range** to be set at launch within governance. This is competitive with or below the observed field (Exponential.fi ~0.2%, Bankr ~0.8% routed portion, Virtuals/Axal ~1% trade tax) and far below the 1% "trade tax" cohort.
- **Who pays:** chat users who choose to **execute a swap** through the assistant. Users who only deposit, hold, earn vault yield, or withdraw pay **nothing**.
- **Mechanics (non-custodial by construction):** the fee is taken **inside the user-signed swap transaction** (a fee leg / recipient in the Aerodrome route), so the protocol never holds, moves, or withholds user funds. It is shown **explicitly in the Tenderly pre-trade simulation / confirmation UI** (the balance-change preview already itemizes it) **before the user signs**. It **never touches the vault, vault flows, or principal** — vault deposits/withdrawals are not swaps and carry no fee.
- **Trust option — "first N swaps free":** new users get their first **N** swaps (e.g., 3–5) routed fee-free so they can verify the experience and the exact fee disclosure before paying anything. Honest, low-friction onboarding that pre-empts the "nickel-and-diming" critique.
- **Why it's compliant:** it is a **usage fee on a discrete service**, not a fee on the vault, principal, or AUM, and not custody. The vault's 0% management / 0% on principal is untouched and the swap fee never touches vault flows (Principle V untouched); the non-custody invariants N1–N5 are untouched (the fee is inside the user's own signed swap); SRK stays non-essential. It needs only a **minor spec addition** — a new functional requirement for the swap fee plus its disclosure (see §5.2.0), **not** a Constitution amendment.

**Stream 0B — Premium AI tier (FREEMIUM, premium tier paid in SRK).**

- **What it is:** a **freemium** model. The **FREE tier is fully usable** on its own — the core chat assistant, portfolio reader, basic strategy recommendations, the Aave Yield Vault (deposit/withdraw), swaps, and withdraw-always all work **without any SRK and without paying anything**. The optional **PREMIUM tier is PAID IN SRK** (this is the token's concrete, real launch utility), unlocking **advanced AI features**: deeper/more-frequent strategy analysis, advanced strategy-vault access when live (market-neutral, vol-harvesting), higher usage/limits & priority compute, advanced portfolio analytics & alerts, and scoped auto-rebalance with higher caps. The Hey-Anon "Pass" / Griffain "energy" / Almanak compute-margin pattern. Priced as a tiered plan or metered credits, **settled in SRK via a user-signed, non-custodial pay-with-SRK transaction** (with an optional stablecoin fallback flag — see sequencing note below).
- **Who pays:** users who *opt in* to **premium** for advanced AI capability, paying **in SRK**. Users on the free tier — the full core assistant + vault + swaps + withdraw-always — pay **nothing** and need **no SRK**.
- **Hard non-essential / SRK-non-essential guarantee:** premium **NEVER gates the vault, deposits, yield, or withdrawals**, and never gates the user's ability to exit (N2). It only *adds* advanced AI capability. **SRK stays NON-ESSENTIAL to every core/custody function** (Principle V) — paying in SRK buys *optional* premium features only, never the vault or the right to withdraw. It charges for advanced assistant capability, not for custody or principal.
- **SRK utility + sequencing note:** accepting **SRK as the premium-tier payment gives SRK a real, concrete utility at launch** (beyond Phase-2 discounts/fee-share). **Sequencing consideration:** SRK must be **live** to accept SRK payments, so the launch enables an **optional stablecoin fallback for premium** if SRK is not yet live — the freemium model still earns at launch either way, and the payment rail flips to SRK once the token is live. This keeps SRK non-essential (it's only the *premium-payment* rail, never a gate on core function).
- **Why it's compliant today:** it is **not a vault fee** and touches neither custody nor principal, so it does not change Principle V or the non-custody invariants. Paying premium in SRK is a **user-signed, non-custodial** transaction and SRK remains non-essential to the vault. Route it through governance for the record, but it requires **no** Constitution amendment (no constitution edit needed).

#### (B) Active at launch — the vault performance fee, now live under the ratified Principle V amendment (v1.1.0)

**Stream 1A-Launch — 10% performance fee on the Aave Yield Vault's realized YIELD (the core fund-aligned monetization), ACTIVE AT LAUNCH.**

This is the monetization most aligned with running a fund: **a 10% cut of the *yield the vault actually earns the user* — profit-only, with a high-water mark, net-of-everything, 0% management fee, 0% on principal, and withdraw-always preserved.** It makes the launch vault itself revenue-generating, and it is **active at launch** under the ratified Principle V amendment (constitution v1.0.0 → v1.1.0), which rescoped the launch vault from "0-fee" to **0-management / profit-only performance-fee** while keeping every custody guarantee intact. The amendment is **DONE** — §5.2.B records the now-completed package.

- **Rate:** **10% of realized yield** (anchored to the Giza/ARMA 10% and Yearn v3 factory convention; well below the 15–20% structured-product band and the 50% on-chain cap). The rate is **configurable on-chain within a hard cap of 20%** (default 10%), timelocked and multisig-bounded.
- **What stays sacrosanct (the amended Principle V preserves all of this):** **0% management fee, 0% fee on principal, non-custodial, profit-only.** No yield → no fee; no fee in flat or down periods (at/below the HWM). A high-water mark means a user is never charged twice on the same gains after a drawdown-and-recovery. The withdraw-always escape hatch (N2) is never impaired — redemption math never depends on a fee being collectible (fail-open in the user's favor; a stale/failed fee computation defaults to charging ZERO and never blocks a redemption).
- **Mechanics:** identical to Stream 1A below — on-chain via **vault-share minting / NAV accrual** to a `performanceFeeRecipient` at deposit/withdraw/harvest (lazy accrual): mint fee shares whose claim equals feeRate × (assets gained above the HWM since last accrual), then advance the HWM; entry/exit fees stay pure-constant 0 and management fee stays 0. The fee-recipient is a normal, non-privileged share holder with no admin/withdraw authority over other users' shares — it redeems via the same withdraw/redeem path as any user and cannot block, delay, or reorder any redemption; a user's redeemable principal is never reduced below deposited principal by fee shares (fee shares accrue ONLY against realized gains above the HWM).
- **Status — ACTIVE AT LAUNCH:** ratified via the §5.2 standard Principle V amendment (the now-completed wording and the downstream spec/contract list are in §5.2.B). This is a **standard amendment, not a super-majority re-ratification**, because N1–N5, the pause-only kill-switch, the AI-disposition rule, and non-upgradeable custody semantics are all unchanged.

> **Cross-reference:** the **same** profit-gated performance-fee mechanism is also the growth engine in **Phase 1** (extended to the advanced, opt-in strategy vaults) and is supplemented in **Phase 2** (curator cut, SRK economics, B2B) — see below. Stream 1A-Launch is simply that mechanism, live on the launch vault from day one under the ratified amendment.

- **Constitution status (summary):** all three launch streams are compliant under the ratified constitution (v1.1.0). Streams **0A and 0B** need only a minor spec addition (§5.2.0); Stream **1A-Launch** is authorized by the now-ratified §5.2.B Principle V amendment and is **active at launch**.

### Phase 1 — Strategy expansion (Yield Optimization → Market-Neutral → Volatility Harvesting vaults): a transparent PERFORMANCE FEE on the advanced, opt-in vaults.

This is where the performance fee **extends to higher-alpha products**. The conservative Aave vault **stays 0-management / 0-on-principal forever** (it is the wedge), charging only the profit-only 10% performance fee on its realized yield (active since launch). Phase 1 adds the performance fee to the **new, advanced, opt-in strategy vaults** a user must deliberately choose.

**Stream 1A — Performance fee on realized yield (the core revenue engine).**

- **Rate (proposed):** **10% of realized yield** on the strategy vaults at introduction. This anchors to the AI-agent / efficient-curator standard (Giza/ARMA 10%, Yearn v3 factory 10% convention, Beefy 4.05–9.5%, Morpho curators 0–20%) and sits well below the structured-product ceiling (15–20%) and the Morpho on-chain cap (50% perf). Higher-touch, higher-alpha vaults (e.g., volatility harvesting) may carry **up to 15–20%**, justified only by genuine alpha/premia and always disclosed; the conservative tier stays at or below 10%. **Do not exceed 20%, ever**, and stay clear of the on-chain caps as a credibility signal.
- **Who pays:** depositors **in the advanced strategy vaults only** — never the conservative Aave vault, never on principal.
- **Mechanics (all on-chain, all profit-gated):**
  - **Fee only on profit.** Charged solely on positive realized yield per accrual/harvest. No yield → no fee. This is a soft hurdle by construction (the Giza/Yearn/Beefy/Ribbon pattern).
  - **High-water mark (HWM).** Per-vault (or per-share) HWM so a user is never charged twice on the same gains after a drawdown-and-recovery. This is stricter than most DeFi curators (who are merely per-harvest profit-gated) and is a deliberate trust upgrade — it mirrors the hedge-fund HWM users expect (Numerai/Cega-class) while staying on-chain-verifiable.
  - **Optional hurdle rate.** For vaults benchmarked against a risk-free/Aave baseline, charge the performance fee **only on yield above the benchmark** (e.g., only on out-performance vs. the conservative Aave vault). This makes the pitch honest: *we only take a cut of the alpha we add over what you'd earn doing nothing.* Strongly recommended for the Yield-Optimization vault specifically. **Benchmark read is READ-ONLY:** the hurdle's benchmark (out-performance vs. the conservative Aave vault) is read only as a reference — the Aave vault share price or an on-chain oracle of it — used solely to compute the fee at harvest; a failed or stale benchmark read must default to charging **ZERO** fee (fail-open in the user's favor) and must **NEVER** block or delay a redemption, consistent with the guardrail that redemption math never depends on a fee being collectible.
  - **Net-of-everything.** The fee is computed after costs, slippage, and gas reflected in realized yield (Principle III). The displayed APY is always net-of-fee with a breakdown (never APY without a breakdown).
  - **Collection method:** on-chain via **vault-share minting / NAV accrual** to a `performanceFeeRecipient` address at harvest/accrual — the Morpho/Beefy/Axal pattern. The protocol never takes custody; the user's withdraw-always path (N2) is untouched; redeeming shares still works even if SparkPoint is fully offline.
- **Trust safeguards:** HWM + optional hurdle + profit-gating + on-chain itemization + net-of-everything display + a Trust Center fee panel showing the exact rate, recipient, and cumulative fees charged. The conservative Aave vault remains the live, side-by-side honesty benchmark — 0% management, 0% on principal, and the same profit-only 10% HWM performance fee, so the comparison is apples-to-apples.
- **Roadmap phase:** **Phase 1** (introduced with the first advanced vault; extends to market-neutral and volatility-harvesting vaults as they ship).

### Phase 2 — Multi-Strategy Fund / LP Share Mechanics / hedge-fund scale: optional management/curator components, SRK economics, B2B.

At scale, layer additional streams onto the performance-fee spine — each opt-in, capped, and constitution-checked.

**Stream 2A — Optional thin management/AUM fee (multi-strategy / fund products only).**

- **Rate (proposed):** **0% by default; up to 0.25%/yr** maximum, only on the multi-strategy fund / LP-share products where a standing allocation service is genuinely provided. Anchored to the robo-advisor floor (Wealthfront/Betterment 0.25%) so we never look expensive vs. mainstream passive products. The conservative Aave vault and the single-strategy Phase-1 vaults stay **0% management**.
- **Who pays:** depositors in the multi-strategy fund/LP product, opt-in.
- **Collection:** on-chain via share/NAV accrual (Morpho V2 management-fee pattern), pro-rated, never via custody.
- **Trust safeguard:** because this is the one component that can touch principal, it is **(a) capped hard at 0.25%/yr, (b) optional/off by default, (c) only on explicitly higher-touch products, and (d) governance-gated.** It must be justified as a real allocation/curation service, not a passive rake. If in doubt, keep it at 0% and rely on performance fees.
- **Roadmap phase:** **Phase 2** (multi-strategy fund / LP shares).

**Stream 2B — Curator / strategy-creator fees (the marketplace cut).**

- **Mechanics:** when third parties (or SparkPoint's own agents as "strategists") run strategy vaults, they set a performance fee within a **protocol-enforced cap** (propose: **perf ≤ 20%, mgmt ≤ 0.25%/yr** — deliberately tighter than Morpho's 50%/5% to differentiate on restraint). SparkPoint levies a **protocol fee as a % of the fees the strategy collects** (the Yearn v3 Accountant/Protocol-Fee pattern: e.g., a 10% protocol cut of a 20% perf fee → 18 to strategist, 2 to SparkPoint, all on-chain).
- **Who pays:** depositors pay the strategist; SparkPoint skims a slice of the *fee*, not extra from the user.
- **Collection:** on-chain share-minting to the respective recipients; fee changes timelocked.
- **Trust safeguard:** protocol-enforced caps; all fees on-chain and itemized; no strategy can gate withdrawal; SparkPoint's own agent-run vaults are labeled as such (honest autonomy).
- **Roadmap phase:** **Phase 2** (multi-strategy + LP share mechanics), aligned with the Full-Hedge-Fund expansion.

**Stream 2C — SRK access tiers, fee discounts, and a transparent fee→buyback/share loop.**

- **Mechanics:** SRK (utility token — access / incentives / governance) may:
  - grant **performance-fee discounts** to stakers (e.g., a capped reduction on the strategy-vault perf fee);
  - receive a **defined, transparent slice of protocol revenue** via **buyback** and/or **staker revenue-share** (the Aave-100%-to-DAO + $50M/yr-buyback and Beefy-staker-split templates; the clean "fees → token value" path the research flags as the sustainability differentiator vs. Morpho's $256M+ cumulative fees at $0 to holders).
- **Hard limits (Constitution Principle V & III):**
  - SRK must **NEVER** gate the ability to use the vault or to withdraw. Every vault is fully usable, and every withdrawal works, with **zero** SRK. SRK only ever *discounts* or *adds*, never *unlocks core function*.
  - **No subsidized APY / no yield theater.** SRK must not be used to inflate headline yield with emissions (the Giza/Almanak failure mode). Fee revenue funding buyback must come from *real* fees, not emissions.
  - Discounts must not create a hidden paywall (a non-staker still gets a fair, clearly-disclosed rate).
- **Roadmap phase:** **Phase 2** (SRK activates in a later cycle per the plan; revenue-share/buyback only once real fee revenue exists).

**Stream 2D — B2B / white-label of the non-custodial AI-fund stack.**

- **Mechanics:** license the rails — custom ERC-4337 stack (`SparkPointAccount`/`AccountFactory`/`SessionKeyValidator`/`PolicyModule`) + ERC-4626 vault pattern + the deterministic policy layer + OpenClaw/Hermes agents — to other teams (ConsoleKit-style), priced as a setup + per-AUM or per-yield rake.
- **Who pays:** partner teams (B2B), not SparkPoint's retail users.
- **Trust safeguard:** licensees must preserve the five non-custody invariants and the AI-never-final-authority principle as a contractual + technical condition (the rails enforce it). Caution from the research: standalone agent-infra was hard to sustain (Brahma) — treat as a supplement, not the base.
- **Roadmap phase:** **Phase 2+** (Full Hedge Fund / platform expansion).

### Ancillary / supplementary streams (cross-phase)

| Stream | Rate (proposed) | Who pays | Collection | Trust safeguards | Phase |
|---|---|---|---|---|---|
| **Aerodrome swap-routing fee** *(now a LAUNCH stream — see §3 Phase 0, Stream 0A)* | **20 bps (15–30 bps range)** | chat users executing swaps | taken inside the user-signed swap (fee leg/recipient in the route), never via custody | Disclosed pre-sign in the Tenderly simulation (balance-change preview already itemizes it); framed honestly as a **usage fee**, not a yield/custody fee; "first N swaps free" trust option; never on vault flows or principal. | **Phase 0 / Launch** (active) |
| **Premium AI tier (FREEMIUM, premium paid in SRK)** *(now a LAUNCH stream — see §3 Phase 0, Stream 0B)* | **free tier fully usable, $0**; optional **premium tier priced/paid in SRK** (tiered plan or metered credits) | users opting into **premium** for advanced AI capability | **paid in SRK via user-signed, non-custodial tx** (optional stablecoin fallback if SRK not yet live); off-chain metered / on-chain settled | Must stay **non-essential**: the free tier (core assistant + vault + swaps + withdraw-always, no SRK) remains fully usable and premium NEVER gates the vault or withdrawals; **SRK stays non-essential** (premium-payment rail only). SRK-as-payment gives SRK real launch utility. Charges for advanced capability, not for custody/principal. | **Phase 0 / Launch** (active) |
| **Treasury float** | yield on SparkPoint's own treasury | nobody (it's our capital) | our own capital in our own conservative vault / Aave | **Never** route *user* float to the protocol — that breaches non-custody (N1). Only the protocol's own capital. Clean, modest, no user cost. | Phase 0+ |

---

## 4. Illustrative unit economics (NOT projections)

> **These are illustrative mechanics, not forecasts.** They show how the fee math scales. They are **not** return projections and must never be presented to users as expected returns (Principle III). All inputs are placeholders.

### 4.0 Launch / beta-scale illustrative scenarios (Sept 2026 v1)

These show what the **three active-at-launch** streams (swap fee + premium tier + the launch-vault performance fee) generate at modest beta scale. **Illustrative, not projections; inputs are placeholders.**

**Swap-routing fee (Stream 0A), active at launch:**

```
Monthly swap-fee revenue  ≈  Monthly swap volume ($) × Swap_Fee%   (20 bps = 0.0020)
```

| Scenario | Monthly swap volume | Fee (bps) | **Monthly swap-fee revenue** | **Annualized** |
|---|---|---|---|---|
| **L1 — small closed beta** | $1.0M | 20 | **$2,000** | **$24K** |
| **L2 — growing beta** | $5.0M | 20 | **$10,000** | **$120K** |
| **L3 — early traction** | $20.0M | 20 | **$40,000** | **$480K** |

*(At 15 bps these scale to ~$18K / $90K / $360K annualized; at 30 bps, ~$36K / $180K / $720K. "First N swaps free" reduces early-month revenue slightly in exchange for trust/conversion.)*

**Premium AI tier (Stream 0B) — FREEMIUM, premium paid in SRK, active at launch.** Revenue is driven by **free→premium conversion** on the free base, with premium **priced in SRK** (the SRK amount × SRK price equals the displayed monthly value; SRK price volatility flows through, which is exactly why the optional stablecoin fallback exists if SRK is not yet live):

```
Monthly premium revenue  ≈  Free users × (Free→Premium conversion %) × Premium price/mo (paid in SRK = SRK amount × SRK price)
```

| Scenario | Free users (base) | Free→Premium conversion | Paying premium users | Avg price/mo (paid in SRK) | **Monthly premium revenue** | **Annualized** |
|---|---|---|---|---|---|---|
| **P1 — small base** | 2,000 | 5% | 100 | $20 | **$2,000** | **$24K** |
| **P2 — growing base** | 6,250 | 8% | 500 | $25 | **$12,500** | **$150K** |
| **P3 — early traction** | 20,000 | 10% | 2,000 | $25 | **$50,000** | **$600K** |

*(Premium is **paid in SRK**, so the monthly value = SRK amount × SRK price; if SRK is not yet live at launch, the optional stablecoin fallback collects the same value so the freemium model still earns. Conversion % is the freemium lever — the free tier stays fully capable and unpaid, so revenue scales with how many free users opt into advanced AI.)*

**Launch-vault performance fee (Stream 1A-Launch), ACTIVE at launch —** what the 10% profit-only fee on the launch Aave vault's realized yield contributes at beta TVL (the conservative Aave yield is modest, so this is small early, but it is live from day one under the ratified Principle V amendment):

```
Vault perf-fee revenue  ≈  Vault TVL × Net_Aave_Yield% × 10%
```

| Scenario | Launch-vault TVL | Net Aave yield (illustrative) | Perf fee | **Added annual revenue** |
|---|---|---|---|---|
| **V1 — small beta TVL** | $2.0M | 4% | 10% | **$8K** |
| **V2 — growing beta TVL** | $10.0M | 4% | 10% | **$40K** |
| **V3 — early traction TVL** | $50.0M | 5% | 10% | **$250K** |

**Combined launch read (illustrative):** at a *growing-beta* mix all three active streams stack — swap L2 ~$120K + premium P2 ~$150K + vault perf-fee V2 ~$40K — for **~$310K annualized at launch**, with the vault perf-fee contributing from day one (it never touches principal) under the ratified Principle V amendment. The usage-only subset (swap + premium ~$270K) already proves "0-fee-on-principal vault" and "$0 revenue" are not the same thing; the profit-only vault fee adds to it. These are illustrative mechanics, not forecasts.

### 4.1 Strategy-TVL scenarios (Phase 1+ growth engine)

**Formula (performance-fee spine, Stream 1A):**

```
Annual protocol revenue  ≈  TVL_in_strategy_vaults × Net_Yield% × Performance_Fee%
```

(Profit-gated: revenue is a cut of *yield generated*, so it is zero in a zero-yield year and scales with both TVL and realized yield — exactly the Gauntlet/Re7/Beefy reality where >$1B TVL still yields modest absolute revenue because the cut is on yield, not principal.)

**Scenario table** — strategy-vault TVL × net yield × 10% performance fee (conservative-tier rate). The conservative Aave vault's own perf-fee contribution is captured separately in §4.0 (Stream 1A-Launch); this table covers only the Phase-1 strategy vaults.

| Scenario | Strategy-vault TVL | Net yield (illustrative) | Perf fee | Yield generated for users | **Protocol revenue** |
|---|---|---|---|---|---|
| **A — early Phase 1** | $10M | 6% | 10% | $600K | **$60K** |
| **B — traction** | $100M | 6% | 10% | $6.0M | **$600K** |
| **C — scale** | $500M | 8% | 10% | $40.0M | **$4.0M** |

**Reality-check against the research (so these stay honest, not hopeful):** Gauntlet at ~$1.49B TVL shows ~$1.11M annualized curator revenue; Re7 ~$89K; Beefy ~$1.79M at ~$113M TVL. Our Scenario C (~$4.0M at $500M strategy-TVL, 8% yield, 10% fee) is at or above the *leading* curators — i.e., **ambitious but not fantastical**, and only reachable well after the trust wedge has done its job. The takeaway mirrors the research: performance-fee-on-yield revenue is *modest in absolute terms* until TVL is large, which is exactly why the 0-on-principal trust wedge (to win TVL) leads, with the profit-only fee monetizing only the yield it earns.

**Sensitivity notes (illustrative):**
- A management fee, *if* ever added at the 0.25% cap on a $100M multi-strategy fund, adds only ~$250K/yr — small, and the reason we keep it optional/near-zero rather than leaning on it.
- With an optional **hurdle** (charging perf fee only on out-performance vs. the Aave baseline), revenue is lower but the pitch is maximally honest — a deliberate trade we favor for the Yield-Optimization vault.

---

## 5. Constitution reconciliation (checklist)

Each proposed stream is checked against the five binding constraints. **Status (ratified):** all **three active-at-launch streams comply with the ratified constitution (v1.1.0)**. The **swap-routing fee (0A)** and the **premium AI tier (0B)** are usage / optional-capability fees that do not touch the vault principal or custody, so they require only a **minor spec addition** (the swap fee needs a new spec FR for the fee + disclosure; see §5.2.0), not an amendment. The **launch-vault performance fee (1A-Launch)** is authorized by the **now-ratified Principle V amendment (v1.0.0 → v1.1.0)**, which rescoped the launch vault from "0-fee" to **0-management / profit-only performance-fee** — the amendment is **DONE** and recorded in §5.2.B. The Phase-1 strategy-vault performance fee (1A) follows the same standard-amendment lane as it ships. Crucially, the non-custody invariants (N1–N5), withdraw-always, the pause-only kill-switch, the AI-disposition rule, and non-upgradeable custody semantics are **all unchanged** by every stream below — which is why the vault fee was a standard amendment, not a super-majority re-ratification.

### 5.1 Per-stream compliance matrix

| Stream | Non-custody (N1–N5) | Withdraw-always (N2) | SRK non-essential (Prin. V) | Honest-yield / no projections (Prin. III) | 0-on-principal launch vault (Prin. V) | Needs amendment? |
|---|---|---|---|---|---|---|
| **Phase 0 — launch Aave vault (0% mgmt / 0% principal / profit-only perf fee)** | PASS | PASS | PASS (works w/o SRK) | PASS | PASS (0% management, 0% on principal; profit-only yield fee) | **No** — authorized by ratified v1.1.0 |
| **0A — Swap-routing fee (LAUNCH, usage fee)** | PASS (taken in user-signed swap; no custody) | PASS (vault flows untouched) | PASS (no SRK gating) | PASS (disclosed pre-sign, itemized; not a yield projection) | PASS — **not a vault fee; vault principal stays free** | **No** — minor spec FR addition only (§5.2.0) |
| **0B — Premium AI tier (LAUNCH, FREEMIUM, premium paid in SRK)** | PASS (premium paid via user-signed, non-custodial tx) | PASS | PASS (free tier fully usable w/o SRK; premium-in-SRK never gates vault — SRK non-essential to core) | PASS | PASS — **not a vault fee** | **No** (route through governance for the record) |
| **1A-Launch — Perf fee on the LAUNCH Aave vault's yield (ACTIVE at launch)** | PASS (share-mint, no custody) | PASS (HWM/fee never blocks redeem; fail-open) | PASS (no SRK gating) | PASS (profit-gated, net-of-everything, no projections) | PASS — **0% mgmt / 0% on principal; profit-only yield fee per amended Principle V** | **DONE — ratified via §5.2.B (v1.1.0); ACTIVE at launch** |
| **1A — Perf fee on strategy vaults (Phase 1)** | PASS (share-mint, no custody) | PASS (HWM/fee never blocks redeem) | PASS (no SRK gating) | PASS (profit-gated, net-of-everything, no projections) | **N/A — applies only to NEW vaults; launch vault already on the amended profit-only model** | **YES — same standard-amendment lane (§5.2)** |
| **2A — Thin mgmt fee (≤0.25%, multi-strat only)** | PASS (NAV accrual) | PASS | PASS | PASS if disclosed; **watch**: touches principal → keep optional/capped | Launch vault stays 0% management / 0% on principal | **YES** |
| **2B — Curator/protocol fee** | PASS (on-chain split) | PASS | PASS | PASS (caps + itemized) | Launch vault unaffected | **YES** |
| **2C — SRK discounts + fee→buyback/share** | PASS | PASS | **PASS ONLY IF** SRK never gates use/withdraw and no subsidized APY | PASS (real fees only, no emission yield) | Launch vault unaffected | **YES (token-economics change)** |
| **2D — B2B / white-label** | PASS (licensees bound to invariants) | PASS | PASS | PASS | Launch vault unaffected | **No** for SparkPoint users; partner terms reviewed separately |
| **Swap-routing fee** *(see row 0A — now a launch stream)* | PASS (taken in user-signed swap, no custody) | PASS | PASS | PASS — disclosed pre-sign, framed as usage fee | Launch vault unaffected (vault flows excluded) | **No** — minor spec FR addition (§5.2.0) |
| **Premium AI tier (FREEMIUM, premium paid in SRK)** *(see row 0B — now a launch stream)* | PASS (premium paid via user-signed, non-custodial tx) | PASS | PASS (free tier fully usable w/o SRK; premium-in-SRK never gates vault — SRK non-essential) | PASS | Launch vault unaffected | **No** (not a vault fee), route through governance for the record |
| **Ancillary — treasury float** | PASS (own capital only) | PASS | PASS | PASS | Launch vault unaffected | **No** |

### 5.2.0 Active-at-launch streams — NO amendment required (minor spec addition only)

The two usage / optional-capability streams (0A, 0B) ship under the **ratified constitution (v1.1.0)** with only a minor spec addition because they are **not fees on a vault's principal or yield** (the vault performance fee 1A-Launch is the third launch stream, authorized by the Principle V amendment — see §5.2.B):

- **Stream 0A — swap-routing fee:** a usage fee taken inside the user-signed Aerodrome swap. It does not touch the vault, principal, or custody, and the launch vault's 0% management / 0% on principal is unchanged (vault flows are excluded), so Principle V is unchanged on this point. **No Constitution amendment.** It does require a **minor spec addition** for cross-artifact consistency (Principle VI): a new functional requirement covering the swap fee, its bps parameter/range, the mandatory pre-sign disclosure in the simulation, the "first N swaps free" allowance, and the explicit exclusion of vault flows. Suggested artifacts to touch: `spec.md` (new FR adjacent to the Aerodrome-swap requirements), `plan.md` (note the fee leg in the swap flow), `contracts/smart-contracts.md` (the swap-routing path / fee recipient — **not** the vault), and the Trust Center copy. **This is an ADDITION, not a Principle V amendment.**
- **Stream 0B — premium AI tier (FREEMIUM, premium paid in SRK):** not a vault fee and not custody; the **free tier stays fully usable without SRK** and premium never gates the vault or withdrawals. Premium is **paid in SRK** via a user-signed, non-custodial transaction (optional stablecoin fallback if SRK is not yet live), so **SRK stays non-essential to core/custody function** — paying in SRK buys optional advanced AI features only. **No Constitution amendment** (no constitution edit needed); route through governance for the record and reflect the freemium tier + pay-with-SRK flow in product/spec copy where relevant.

### 5.2 Amendment / sign-off path (for vault-yield fees and token economics)

- **What triggers an amendment:** any fee on a **vault's yield** (Streams **1A-Launch** on the launch vault — now ratified, **1A** on strategy vaults, **2A** mgmt fee, **2B** curator fee) and the SRK fee-economics (2C). The original Principle V fixed the launch vault as 0-fee; **putting a profit-only fee on vault yield was a material change to Principle V's scope and to Principle III's fee/yield framing, so it was ratified, not introduced implicitly** (Governance §: "Any change to scope, architecture, or invariants MUST be reflected back into the governing artifacts"). For the launch vault that amendment is **DONE** (v1.0.0 → v1.1.0; see §5.2.B); the same lane governs the Phase-1 strategy-vault fee (1A) and the Phase-2 streams as they ship. The active-at-launch usage streams (0A, 0B) are explicitly **out of scope for this amendment** — see §5.2.0.
- **What does NOT require re-ratification:** the proposed streams do **not** touch the five non-custody invariants (N1–N5), the pause-only kill-switch, the AI-disposition rule, or the non-upgradeable vault semantics — so they need a **standard amendment** (written proposal + rationale + affected artifacts + review + approval), **not** the super-majority re-ratification reserved for custody changes. *Provided* the fee mechanics are implemented exactly as specified (share-mint/NAV accrual, withdraw-always preserved, SRK non-gating). If any implementation were to alter custody semantics or impair withdrawal, it would escalate to super-majority re-ratification and should be rejected by default. **Fee-parameter mutability** is restricted to non-custody fee fields only, is timelocked, can NEVER alter custody/withdraw semantics or the redemption path, and the strategy vaults remain non-upgradeable in their custody semantics — keeping fee changes inside the standard-amendment lane rather than super-majority re-ratification. **Performance-fee-share invariant:** the fee-recipient is a normal, NON-privileged share holder subject to the identical redemption rules as any user; it has no admin/withdraw authority over other users' shares; it cannot block, delay, or reorder any user's redemption; and a user's redeemable principal is never reduced below deposited principal by fee shares (fee shares accrue ONLY against realized gains). A reviewer MUST confirm these properties before the standard-amendment path applies; otherwise it escalates to super-majority re-ratification.
- **Required amendment package (per Governance §):**
  1. Written proposal: the specific fee (rate, mechanics, vault scope), with rationale.
  2. Affected artifacts updated for consistency: this revenue-model doc, the constitution's Principle V wording (to scope "0-fee" precisely to the launch/conservative vault and permit fees on opt-in advanced vaults), the relevant spec/plan/tasks, and the Trust Center copy.
  3. Confirmation that N1–N5, pause-only kill-switch, AI-disposition, and non-upgradeable semantics are **unchanged** (so standard, not super-majority, applies).
  4. Version bump (MINOR — new materially-expanded guidance) per the constitution's semantic-versioning rule.

### 5.2.B Ratified fund-revenue stream — the completed Principle V amendment (Stream 1A-Launch)

This is the **ratified** package that put the **10% profit-only performance fee on the launch Aave Yield Vault's realized yield** live at launch. It was a **standard amendment** (not super-majority re-ratification) because the mechanics preserve N1–N5, withdraw-always, the pause-only kill-switch, and non-upgradeable custody semantics exactly as specified (share-mint/NAV accrual; fee-recipient is a non-privileged share holder; redemption never depends on a fee being collectible; fee shares accrue only against realized gains above the HWM). **The amendment is DONE — constitution v1.0.0 → v1.1.0, ratified; the fee is active at launch.**

**Ratified amended wording for Principle V** (replaced the single "0-fee Aave Yield Vault" clause; all other Principle V sentences unchanged). Prior text:

> "The vault product at launch MUST be a SINGLE conservative, 0-fee Aave Yield Vault (ERC-4626): deposit USDC, earn Aave yield, withdraw anytime, non-upgradeable."

Amended text (now in force):

> "The vault product at launch MUST be a SINGLE conservative Aave Yield Vault (ERC-4626): deposit USDC, earn Aave yield, withdraw anytime, non-upgradeable. The vault MUST charge **0 management fee and 0 fee on principal**, and MUST remain **non-custodial** with the withdraw-always escape hatch (N2) never impaired. The vault MAY charge a **profit-only performance fee on realized yield**, capped at **20%** (default **10%**), collected solely on positive realized yield above a per-share high-water mark via on-chain vault-share minting / NAV accrual to a non-privileged fee-recipient — never on principal, never via custody, and never in a way that blocks, delays, or reduces any user's redemption (a stale or failed fee computation MUST default to charging zero). The feeRate is the only mutable parameter (timelocked, hard-capped, never altering custody). The performance fee MUST be disclosed, on-chain-verifiable, and shown net-of-everything."

This keeps every load-bearing guarantee — **0 management fee / 0 fee on principal / non-custodial / profit-only** — and only removed the absolute "0-fee" framing in favor of "0 fee on principal + a capped profit-only yield fee."

**Downstream spec artifacts updated for cross-artifact consistency (Principle VI) as part of the ratified amendment (the constitution is already at v1.1.0; remaining artifacts tracked separately, not edited in this task):**

- **`.specify/memory/constitution.md`** — **DONE:** Principle V wording above is in force; Principle III's launch-vault sentence reconciled to "0-management / profit-only performance-fee (0 management fee, 0 fee on principal, capped (≤20%) high-water-mark performance fee on realized yield, default 10%), net of everything"; **Version** bumped to **1.1.0 (MINOR)**, **Last Amended** updated.
- **`specs/001-sparkpoint-pivot-mvp/spec.md`** — **FR-017** ("single conservative, 0-fee Aave Yield Vault") and **FR-018** ("redeem shares for principal plus realized yield with no fee deducted") amended to permit a capped profit-only performance fee on realized yield with HWM; **FR-037** (N5) confirmed unchanged (custody/non-upgradeable semantics untouched); add new FRs for the performance-fee mechanics, HWM, disclosure, and the fail-open/withdraw-always guarantee.
- **`specs/001-sparkpoint-pivot-mvp/plan.md`** — re-run the Constitution Check gate against amended Principle V/III; record the fee in the vault design and the Trust Center fee panel.
- **`specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md`** — the **vault 0-fee constant** is currently bytecode-level (`entryFeeBasisPoints()`/`exitFeeBasisPoints()` are `pure` returns of `0`, and "Fees are `pure` constant `0`"); add a profit-only `performanceFeeBps` (≤ 1000) on **realized yield only** with HWM + `performanceFeeRecipient`, while **keeping entry/exit/management at 0** and keeping all custody/withdraw/non-upgradeable semantics and the pause-only multisig path unchanged. (Note: because the launch vault is non-upgradeable, enabling the fee means **deploying a new vault version** under the amended principle, not mutating the shipped 0-fee bytecode.)
- **`specs/001-sparkpoint-pivot-mvp/data-model.md`** — add HWM / per-share fee-accrual / cumulative-fees-charged fields and the fee-recipient share-holder entity for the Trust Center.
- **`specs/001-sparkpoint-pivot-mvp/tasks.md`** — add tasks for the fee mechanics, HWM, disclosure UI, fuzz tests proving withdraw-always holds even if the fee path reverts, and Trust Center fee-panel work; trace each back to the new FRs.

**Re-ratification check:** this qualified as a *standard* amendment because N1–N5, the pause-only kill-switch, the AI-disposition rule, and non-upgradeable custody semantics are all unchanged — confirmed at ratification. Any future implementation detail that would alter custody/withdraw semantics escalates to **super-majority re-ratification** and should be rejected by default.

- **Sequencing rule:** the launch-vault performance fee (1A-Launch) shipped together with the ratified v1.1.0 amendment and is **active at launch**; the Phase-1 strategy-vault performance fee (1A) still follows the same §5.2 standard-amendment lane as those vaults ship. The active-at-launch usage/optional streams (0A, 0B) need only the §5.2.0 minor spec addition. The launch vault remains **0% management / 0% on principal** at all times.

---

## 6. Competitive positioning

Our revenue model is itself a differentiator. "**Fair, transparent fees from day one — 0-fee on principal, non-custodial, fee-only-on-profit (with a high-water mark) or on a usage you chose**" is a posture the competitive field structurally cannot match. Crucially, we are revenue-generating from launch *without* compromising any of that — three active streams (a transparent swap usage fee, an optional premium tier, and a profit-only performance fee on the vault's realized yield), none on principal, none via custody:

- **vs. token-subsidized agents (Giza/ARMA, Almanak):** they manufactured headline APY with token emissions ("yield theater") that collapsed when incentives stopped — Giza's TVL cratered to ~$14K and 7-day revenue to ~$0 post-airdrop. **We never subsidize yield (Principle III), and we don't need a token subsidy to have revenue:** our day-one income is a transparent usage fee on swaps, an optional premium tier, and a profit-only performance fee on the vault's realized yield — active at launch, a cut of *real* realized profit, never a subsidy. Our revenue and our users' yield are honest by construction. When their subsidies stop, their story ends; ours never depended on subsidies.
- **vs. custodial / opaque funds (Numerai's regulated fund; Bankr's agent-generated wallet):** they take custody or hold keys, and their fee accrues off-chain or behind a wallet they control. **We never take custody (Principle I); every fee is on-chain and verifiable, and you can exit without us (N2).** "We literally cannot hold, move, or withhold your money, and we only get paid on the profit you actually realize" is a claim a custodial fund cannot make.
- **vs. the "race to 0%" curators (Steakhouse 0% flagships, Gauntlet 0/5/10%):** the incumbents compete fees toward zero to win TVL, then capture little (Gauntlet ~$1.1M, Re7 ~$89K annualized despite >$1B TVL). **We use the *conservative* vault — 0% management, 0% on principal, fee only on realized profit — as the deliberate trust wedge** (the place we win trust) and charge a defensible ~10% only on profit, never on deposits — so we are neither over-charging on principal nor racing to zero on the products that actually warrant a fee. We also out-align them on token: unlike Morpho ($256M+ cumulative fees, $0 to holders), SRK gets a transparent, real-fee-funded share/buyback.
- **vs. the discredited "AI fund" wing (ai16z/Virtuals-class):** they monetized hype via launch taxes and trading taxes tied to speculation. **We monetize delivered yield, not speculation** — the fee exists only because the user made money, and it's provable on-chain.

**One-line market position:** *the only AI-managed, non-custodial, on-Base fund with fair, transparent fees from day one — nothing on your principal, nothing on the conservative vault's deposits, only a clearly-disclosed usage fee on swaps you choose to make and a profit-only cut (high-water mark) of the yield it provably made you — with the withdraw-always exit it can never block.*

---

## 7. Risks & sequencing

| Risk | Why it matters | Guardrail / sequencing |
|---|---|---|
| **Fees deter TVL** ("race to 0%" pressure) | Curators competed fees toward 0 to win liquidity; a fee can stall growth | **Lead with 0% on principal**: the conservative vault charges 0% management / 0% on principal and only a profit-only 10% on realized yield — nothing if you don't earn — so the trust wedge holds while the fee still monetizes real profit. Higher rates stay on the *advanced, opt-in* vaults a user deliberately upgrades to. Keep the conservative vault 0% management / 0% on principal permanently as the on-ramp. Anchor the rate (~10%) to the efficient end of the market, not the structured-product top. |
| **We look like the funds we criticized** | Leading with "AI hedge fund" + adding fees risks the credibility trap | Profit-gating + HWM + optional hurdle + net-of-everything + on-chain itemization make the fee *more* honest than competitors', not less. Never lead with a return projection to sell a fee. Keep the conservative vault (0% on principal, profit-only fee) live as the side-by-side honesty benchmark. |
| **SRK becomes a paywall** | Token-gating core function would breach Principle V and repeat the token-first backlash (ai16z/Almanak) | **Absolute rule:** SRK never gates use or withdrawal; it only discounts or adds. Every vault works, every withdrawal works, with zero SRK. Audit this invariant in code review (same rigor as the non-custody invariants). |
| **Management fee touches principal** | Any AUM fee charges users even in down periods — against "never on your principal" | Default 0%; cap at 0.25%; multi-strategy/fund products only; optional and governance-gated. When in doubt, stay at 0% and rely on performance fees. |
| **Swap fee seen as "nickel-and-diming"** | A per-swap fee can read as petty and erode the "fair, honest" brand if it feels hidden or steep | **Transparency + competitive rate + first-N-free.** Show the exact fee in the pre-sign simulation every time; keep it at a competitive **20 bps (15–30 bps band)**, at or below the field; give new users their first **N** swaps free to verify the experience; frame it honestly as a *usage fee for executing a swap*, never a custody or principal fee; never apply it to vault flows. |
| **Swap fee is volume-volatile** | Swap-fee revenue rises/falls with trading activity | Treat it as one of *several* day-one streams (swap fee + premium tier, later the vault perf-fee switch) so revenue isn't single-source; size the business on the blended/illustrative mix, not on swap volume alone. |
| **Fee mechanism impairs withdraw-always** | A badly-designed fee accrual could block or delay redemption (breach N2) | Fees are share-mint/NAV accrual only; redemption math must never depend on a fee being collectible; verify in fuzz tests that withdraw works even if the fee-recipient path reverts. |
| **Premium AI tier creeps into "essential"** | A freemium tier that gates core help — or makes SRK required to use the vault — repeats the SRK paywall risk | Free tier (core chat assistant + vault + swaps + withdraw-always) stays fully usable for free with **no SRK**; premium only *adds* advanced AI capability and is the only thing paid in SRK. **SRK stays non-essential to core/custody function.** Audit this invariant in code review alongside the SRK-non-gating rule. |
| **Implicit fee introduction** (skipping governance) | Adding a fee on vault yield without amending the constitution violates Governance §; erodes the "provable, not promised" trust | **The launch-vault performance fee was ratified, not introduced implicitly** — the §5.2.B Principle V amendment (v1.0.0 → v1.1.0) is DONE and in force. The active-at-launch usage streams (0A swap fee, 0B premium tier) need only the §5.2.0 minor spec FR. Any *future* fee on a vault's yield (Phase-1 1A and beyond) still ships only after its §5.2 standard amendment. |

**Master sequencing:** **(0 / Launch)** ship the conservative vault (0% management, 0% on principal) with all three active day-one streams under the ratified v1.1.0 constitution — the transparent swap usage fee (0A), the optional premium tier (0B), and the 10% profit-only HWM performance fee on the launch vault's realized yield (1A-Launch, ratified via §5.2.B; 0% on principal preserved) — earning real revenue while building verifiable trust and TVL → **(amend)** ratify the broader fee framework via §5.2 as later products need it → **(1)** introduce/extend the performance fee on the advanced, opt-in vaults (HWM + optional hurdle), conservative vault principal stays free → **(2)** at multi-strategy scale, layer optional thin mgmt fee, curator cut, SRK discounts + fee→buyback/share, and B2B — each opt-in, capped, on-chain, and constitution-checked. All three launch streams are revenue from day one; every *additional* yield fee still comes only after its amendment.

---

*Document status: strategy plan. Authoritative for revenue-model direction. Authorizes the three active-at-launch streams, all compliant with the ratified Constitution v1.1.0 — the swap-routing usage fee (0A, needing only the §5.2.0 minor spec FR), the optional premium AI tier (0B), and the 10% profit-only performance fee on the launch Aave Yield Vault's realized yield (1A-Launch), authorized by the now-ratified §5.2.B Principle V amendment. None of the three touches principal or custody; the launch vault is 0% management / 0% on principal. The Phase-1 strategy-vault fee (1A) follows the same §5.2 standard-amendment lane as those vaults ship. Reconciled with Constitution v1.1.0 and high-level plan v2.*
