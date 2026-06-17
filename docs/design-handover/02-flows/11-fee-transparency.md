# 02 · Flow 11 — Fee Transparency & Revenue Surfaces ("we only earn when you earn")

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-level spec for **Flow 11 (Fee Transparency / Revenue Surfaces)** — the **user-facing side of the revenue model**. It is the design layer that makes **"we only earn when you earn — never on your principal, never by taking custody"** legible, honest, and provable everywhere a fee could (or pointedly does *not*) appear. Production-ready, **desktop + mobile equal priority, all states**. **No code.**
> **What this surface IS:** the cross-cutting **fee-disclosure system** — (a) the **swap-fee line item** in the confirmation (the one fee active at launch, cross-ref Flow 9); (b) a dedicated **"Fees & how we make money" transparency page** (`/fees`) in plain language; (c) **per-action receipts** that re-state exactly what fee (if any) was paid; (d) a **future "performance-fee disclosure" component** for advanced strategy vaults, shipping now in a greyed **"not active at launch"** state that proves **0 on the launch Aave vault**; and (e) **how fees appear in the portfolio and the Outcome Log** (net-of-everything, never hidden). It is the connective tissue between the revenue model and the trust spine.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, the thesis ("AI proposes — guardrails + you dispose — and the protocol never holds your money"), the five non-custody guarantees, **honest-yield / net-of-everything**, the non-goals (no return-led surfaces, no bare APY, no hype). Where this doc and the brief disagree, the brief wins.
> - `docs/revenue-model/README.md` — **the source of truth for what we charge and why.** The load-bearing one-liner *"Fair, transparent fees from day one — we only earn when you earn, never on your principal, never by taking custody."*; the **four hard rules** (never-on-principal, usage-fees-honestly-labeled, non-custodial, provable & transparent); **Stream 0A** (Aerodrome swap-routing fee, **20 bps / 15–30 bps band**, taken inside the user-signed swap, "first N swaps free"); **Stream 0B** (premium AI tier, freemium, paid in SRK); **Stream 1A / 1A-Launch** (the **profit-only, high-water-mark performance fee** — **future**, on opt-in advanced strategy vaults, gated on the §5.2 constitution amendment); and the launch posture: **the single Aave Yield Vault is 0-fee** (0 management, 0 on principal, 0 on yield until amendment).
> - `04-design-system.md` — tokens; **the three orthogonal color systems** (spark = AI presence/CTA; semantic green/red/amber = outcome/safety; risk palette = tier) and the rule *never cross-contaminate*; **tabular numerals** §3.1/§3.4; **mono** for addresses/hashes; currency/PnL/APY formatting §3.4; data-viz (Recharts) §6; motion §7; iconography §8; a11y §10; the component→shadcn map §11.
> - `05-trust-and-safety-ux.md` — §0 (provable not promised; status not slogans; two truthful columns), §3.6 (the **Trust Center fee panel** this page extends), §8 (the **Outcome Log** fees surface into).
> - `06-component-library.md` — composes **NetApyBreakdown** (§16, "0% SparkPoint fee" line), **SimulationBalanceChangeTable** (§23, the swap fee leg), **ConfirmationCard** (§9, cost & outcome block + receipt), **AlertBanner** (§25), **TipCard** (§11, "how do you make money?"), **EmptyState** (§24), **CapsMeter** (n/a here), and **the cross-cutting CitationChip / sourced-figure affordance**.
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Especially §5.2 (APY net + breakdown, **0% fee explicit**), §5.1 (currency), §9 (banned/required phrases — **no hidden fees, no bare APY, no return-led framing**), §2.1 (trust motifs), §3 (success/error patterns).
> - `02-flows/06-execution-confirmation-simulation.md` — **Flow 6 is authoritative for the confirm surface.** The fee line item lives inside its **Cost & outcome** block; this doc specifies only the *fee-disclosure content and copy*, never a second sign UI.
> - `02-flows/09-ai-swap.md` — **Flow 9 §4 is authoritative for the swap-routing fee's in-confirm rendering** (where it appears, the first-N-free states, the ⓘ usage-fee explainer). This doc **cross-references** it and ensures consistency across every other fee surface; it does not redefine §4.
> - `02-flows/10-subscriptions-premium-srk.md` — **Flow 10 is authoritative for the premium-tier price and pay-with-SRK.** This doc only states *how the subscription appears on the fees page and in receipts* (a subscription **payment**, honestly distinguished from a vault fee).
> - `09-references.md` — §3 net-of-fees / vault-transparency benchmarks (**Yearn / Beefy / Morpho / Gauntlet**), §5 simulation/preview (**Tenderly**).
>
> **What this doc is NOT:** the sign-gate internals (`06`); the swap surface or its fee-rendering rules (`09` §4 — authoritative); the premium price/pay flow (`10`); the **admin/stakeholder revenue dashboard** (`docs/admin-panel/README.md` §3.5 — that is the *internal* revenue view; this doc is the *user-facing* mirror of the same honesty); visual tokens (`04`); canonical strings (`07`); the route map/shell (`01`). It **never authorizes a fee** — it visualizes exactly what the revenue model defines, no more.

---

## 0. The fee-transparency thesis (constraints on every screen in this flow)

This flow is where the revenue model meets the user. The market we are entering is discredited precisely because fees and "AI funds" were opaque, custodial, and over-promised (`revenue-model` §1, §6). Our entire monetization defense is **honesty made visible**. Constraints binding every screen here:

1. **Net of everything, never hidden (`revenue-model` rule 4; `07` §5.2, §9.1).** Every fee is **disclosed up-front, itemized (rate *and* USD), and shown net-of-everything**. A fee folded silently into "output," an APY shown without its "− 0% SparkPoint fee" breakdown, or a return shown gross-of-fee **fails review**. There is **no place** in the product where a user pays a fee they were not shown first.

2. **We only earn when you earn (`revenue-model` one-liner, verbatim).** The framing is structural, not marketing: a fee may only ever land on **(a) value we created over your principal** (realized yield/profit, future) or **(b) a discrete service you chose to use** (executing a swap; optional premium) — **never on deposits, principal, or AUM at rest.** Copy states this as fact; the fees page proves it side-by-side (user yield vs protocol revenue).

3. **The launch Aave vault is 0-fee — and we *show* the zero (`revenue-model` §3 Phase 0; `06` §9; `07` §5.2).** "SparkPoint fee: 0%" is rendered **explicitly** on every vault confirm, every yield readout, and the fees page — the zero is a feature, not an omission. 0 management, 0 on principal, 0 on yield. This is the trust wedge; the design must make it impossible to miss.

4. **Usage fees are labeled as usage fees (`revenue-model` rule 2).** The **swap routing fee** is a *usage fee on a service you performed* — **not** a custody fee, **not** a vault/deposit/withdrawal/management/yield fee. The **premium subscription** is a *payment for optional capability* — **not** a vault fee. Each is framed for exactly what it is; mislabeling any of them as a fee on your money fails review.

5. **Non-custodial by construction (`revenue-model` rule 3; brief guarantee).** Every fee is collected **without the protocol ever holding, moving, or withholding user funds**: the swap fee is taken **inside the user's own signed swap**; premium is a **user-signed pay-with-SRK** tx; the future performance fee accrues **on-chain via share-mint/NAV accrual to a non-privileged fee-recipient**. The **withdraw-always** escape hatch is **never impaired** by any fee mechanism — copy says so wherever a fee appears.

6. **Provable, not promised (`05` §0.1).** On-chain fees terminate in a **tx hash + explorer link**; the fees page links to the **fee-recipient address** and the relevant contract reads. A fee claim with no verify affordance is a bug.

7. **Future fees are honestly "not yet" (`revenue-model` §5.2; `admin-panel` §3.5).** The **performance fee** on advanced strategy vaults is **not active at launch** and is **gated on a constitution amendment**. Its disclosure component ships now in a **greyed / "not active at launch"** state that **proves 0 on the Aave vault** — never as a live charge, never as a teaser implying it's coming "soon" in a hype sense. Realized vs projected is always visually distinguished (mirrors the admin panel's solid-vs-dashed rule).

8. **Fact-only, sober tone (`07` §1.3, §9).** No "low fees!", no "save money", no urgency, no return-led framing to sell a fee. Plain: *what we charge · when · why · how it's collected · how to verify · and what stays free.* The page leads with **control and the 0-fee principal**, never with a number.

---

## 1. Goal & entry points

### 1.1 Goal

Make a user able to answer, at any moment and in plain language: **"What does SparkPoint charge me, when, why, and how do I verify it?"** — and to come away certain that **nothing touches their principal, the conservative vault is free, and they are never charged a fee they weren't shown first.** A crypto-curious newcomer should feel *the free tier and the vault are genuinely free and the one fee is small, honest, and optional*; a DeFi-native should be able to *verify the fee leg, the fee-recipient, the 0-fee vault constant, and the net-of-everything math on-chain*.

The one-sentence job: **turn the revenue model into a set of honest, provable, net-of-everything fee surfaces — an explicit swap-fee line, a plain-language fees page, per-action receipts, a "not-active-at-launch" performance-fee disclosure proving 0 on the Aave vault, and fee-aware portfolio/outcome views — such that no user ever meets a hidden or mislabeled fee.**

### 1.2 Entry points

| From | Reaches | Notes |
|---|---|---|
| **Confirm surface · Cost & outcome** (`/confirm`, Flow 6 §3) | the fee **line item** (swap fee, or "SparkPoint fee: 0%" on vault) | The single most important fee touchpoint — pre-sign, in-context. Authoritative rendering for swaps = `09` §4. |
| **AI disclaimer strip / shell footer** "How we make money" link | **`/fees`** transparency page | A quiet, persistent, never-hidden link (parallels [Prove it]). |
| **Trust Center** (`/trust`, `05` §3.6 fee panel) "Fees" section → "See full fee details" | **`/fees`** | The Trust Center fee panel is the *summary*; `/fees` is the *full plain-language page*. |
| **NetApyBreakdown** (anywhere APY shows) "see breakdown" → fee line | inline breakdown incl. **"− 0% SparkPoint fee"** | `06` §16; `07` §5.2. The fee is *in* every APY breakdown. |
| **Vault deposit/withdraw** (Flow 5) "0% fee — no fee deducted" → ⓘ | inline tip → optional `/fees` | The 0-fee proof at the point of deposit/redeem. |
| **Per-action success receipt** (Flow 6 §F, Flow 9 §8) "Routing fee: $X" / "0% fee" | receipt fee line → tx proof | Re-states the fee paid, provably, after the fact. |
| **Portfolio position row / detail** (Flow 3) net APY + "fees to date" | fee-aware position read → `/fees` | `03` §161; net only, fees legible. |
| **Outcome Log entry** (`/activity/[entryId]`, `05` §8 / `08` §C) "net of fees" | per-outcome fee line | PnL is **realized, net-of-everything**; any fee paid on the action is shown. |
| **Premium upsell / `/premium`** (Flow 10) "this is a subscription, not a vault fee" | cross-link to `/fees` | Distinguishes the SRK subscription **payment** from any fee. |
| **Command menu (`⌘K`)** "Fees / how we make money" | `/fees` | Discoverable, never buried. |
| **TipCard** "How does SparkPoint make money?" (literacy, `06` §11) | inline answer → `/fees` | Learn-as-you-go; `--info` tone, never green. |

> **`/fees` is a supporting, browsable destination** (unlike `/confirm`, which is transient). It is reachable in ≤2 taps from anywhere and **≤1 tap** from the Trust Center and the disclaimer strip. It carries **no account-gated barrier** — a pre-deposit or even pre-connect user can read exactly what they'd ever be charged (a public mirror parallels `(public)/trust`, `05` §3.1).

### 1.3 Pre-conditions & what's already decided upstream

- **What we charge is fixed by the revenue model**, not by this surface: at launch, exactly **one** fee can ever be charged to a user (the **swap routing fee**, Stream 0A) plus an **optional premium subscription payment** (Stream 0B, paid in SRK, covered by Flow 10). **The vault is 0-fee.** The **performance fee is not live** (gated on amendment). This doc renders that reality; it never invents a charge.
- **The swap fee's authoritative in-confirm rendering is Flow 9 §4** (line item, first-N-free states, ⓘ explainer). This doc ensures the *same* fee reads consistently on the fees page, the receipt, and the portfolio — and that **no other surface contradicts it**.
- **Fee state** (e.g., within first-N-free; premium active/lapsed) is known from user history; rendered honestly per the relevant authoritative flow.

---

## 2. The fee surfaces map (what this flow owns, and where each lives)

Five surfaces, one honesty standard. Each is specified in §3–§7.

| # | Surface | Lives at | Authoritative source it defers to | Launch reality |
|---|---|---|---|---|
| **S1** | **Fee line item** in the confirmation | `/confirm` · **Cost & outcome** (Flow 6 §3) | `06` §3 (block) + `09` §4 (swap fee specifics) | Swap: "routing fee 0.20% = $X" (or first-N-free). Vault: **"SparkPoint fee: 0%"**. |
| **S2** | **"Fees & how we make money"** page | `/fees` (+ `(public)/fees` mirror) | `revenue-model` README; `05` §3.6 | Plain-language: 0 on principal; ~0.20% swap fee; premium optional (SRK); perf fee **future/opt-in**; launch vault 0-fee. |
| **S3** | **Per-action receipt** fee line | `/confirm` success (Flow 6 §F) · `/activity/[entryId]` | `06` §F; `09` §8; `05` §8 | Re-states fee paid ("Routing fee: $X" / "0% fee — none deducted"), with tx proof. |
| **S4** | **Performance-fee disclosure** component | the future advanced-vault surfaces; **previewed on `/fees`** + Trust Center | `revenue-model` §3 Phase 1, §5.2 | **Greyed / "Not active at launch."** Proves **0 on the Aave vault** (HWM/profit-only explained, not charged). |
| **S5** | **Fees in portfolio & Outcome Log** | `/portfolio` rows + `/activity` (Flow 3 / `05` §8 / `08` §C) | `03`; `05` §8; `08` §C | Net-of-everything PnL; "fees paid to date" legible; vault rows show 0-fee. |

> **The honesty contract across all five:** the *same* fee, with the *same* rate, framing, and net math, must read consistently on the line item, the receipt, the fees page, and the portfolio. A figure shown one way pre-sign and another way post-sign is a defect.

---

## 3. S1 — The fee line item in the confirmation (cross-ref Flow 9)

> **Authoritative:** the **Cost & outcome** block of `/confirm` is specified in **Flow 6 §3**; the **swap routing fee** rendering inside it is specified in **Flow 9 §4** (where it appears, first-N-free states, ⓘ explainer, the fee-leg in power-user Details). This section states the **cross-surface fee-disclosure rules** the line item must satisfy and the **vault 0% case**, without re-defining `06`/`09`.

### 3.1 The two launch cases

The Cost & outcome block always shows a SparkPoint-fee line — its value is the proof either way:

- **Swap (Flow 9):** **"SparkPoint routing fee · 0.20% · $X"** with the ⓘ usage-fee explainer; or, when eligible, the **first-N-free** state **"~~0.20% ($X)~~ · $0.00 — first {n} swaps free ({k} left)"** (struck original value stays visible). Reflected in **Net USDC received**. (Full state table = `09` §4.2.)
- **Vault deposit / withdraw (Flow 5 → Flow 6):** **"SparkPoint fee: 0%"** with an ⓘ → *"This vault charges no fee — 0 on your principal and 0 on your yield."* (`06` §3 cost row; `07` §5.2). The **net** line equals the gross because nothing is taken.
- **Premium pay-with-SRK (Flow 10 → Flow 6):** the cost block shows **"SparkPoint fee: n/a — this is a subscription payment, not a vault fee"** (`10` §E); the line item *is* the premium price, plainly.

### 3.2 Line-item disclosure rules (acceptance-bearing, apply on every confirm)

- **Always itemized:** rate **and** USD, never only one; never folded into "output" or "net" without its own visible line.
- **Always pre-sign:** the fee (or the 0%) is shown **before** the Sign CTA is reachable; if the exact fee can't be computed yet (quote partial), show **"— (calculated at simulation)"** and keep **Sign disabled** (never a confident wrong number; `09` §4.2; `07` §5.5).
- **Framed for what it is:** swap = *usage fee*; vault = *0%, no fee*; premium = *subscription payment*. The ⓘ explainer states non-custody ("taken inside this swap — SparkPoint never holds your funds") and scope ("never applies to the vault or your deposits").
- **Net reconciles:** the power-user "Details" shows the fee as its own leg/delta so the math reconciles to the on-chain result (`09` §6 / `06` §3 Details).
- **Consistency:** the rate, framing, and net shown here must match the receipt (§5), the fees page (§4), and the portfolio (§7) exactly.

### 3.3 States (line item)

| State | Treatment | Copy |
|---|---|---|
| **Default — swap, standard fee** | line item with rate + USD, ⓘ; reflected in net | "SparkPoint routing fee · 0.20% · $0.62" |
| **Default — vault, 0%** | explicit 0% line, ⓘ | "SparkPoint fee: 0%" → ⓘ "0 on your principal and 0 on your yield." |
| **First-N-free (swap)** | struck rate + $0.00 + remaining count | "~~0.20% ($0.62)~~ · $0.00 — first {n} swaps free ({k} left)" |
| **Loading / quoting** | skeleton on the fee value (never `0`); rest of block may render | "Routing fee · — (calculated at simulation)" |
| **Fee uncomputable (partial sim)** | en-dash + Sign disabled until resolved | "Routing fee · — (shown before you sign)" |
| **Premium payment** | fee row = n/a + the price line | "SparkPoint fee: n/a — subscription payment, not a vault fee" |

> Both breakpoints: desktop = right-rail **Cost & outcome** card (Flow 6 §2.1); mobile = inline **Cost** section above the sticky sign bar (Flow 6 §2.2). The fee line is **never collapsed behind a tap** on mobile.

---

## 4. S2 — The "Fees & how we make money" page (`/fees`)

The plain-language home of the revenue story, for users. It is the public, browsable proof of *"we only earn when you earn."* It **leads with control and the 0-fee principal**, never with a number (`07` §9.1, §1.1).

### 4.1 Goal & structure

Answer four questions, in order, plainly: **(1) What stays free? (2) What's the one fee we charge today, and why? (3) What's optional (premium)? (4) What's coming later (and isn't charged now)?** — each with a "how it's collected" and a "verify it" affordance. Tone = structural-confident, almost legalistic about the mechanism, humble about returns (`07` §1.3 trust/non-custody register).

### 4.2 Desktop layout (`/fees`, 1440px) — narrative + the honesty chart

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ APP SHELL (badge · wallet · disclaimer strip with [Prove it]/[Exit anytime])   │
├──────────────────────────────────────────────────────────────────────────────┤
│ H1  "Fees & how we make money"                                                 │
│ Lede: "We only earn when you earn — never on your principal, never by taking   │
│        custody. Here's exactly what we charge, when, and why."                 │
│                                                                                │
│ ┌── PRINCIPLE BANNER (the 4 hard rules, as plain checks) ──────────────────┐  │
│ │ ✓ 0 fees on your principal   ✓ The Aave vault is 0-fee                    │  │
│ │ ✓ You see every fee before you sign   ✓ We never hold your funds          │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│ ┌─ WHAT'S FREE ─────────────────┐  ┌─ THE ONE FEE TODAY ───────────────────┐  │
│ │ • The Aave Yield Vault         │  │ Swap routing fee · 0.20% (0.15–0.30%   │  │
│ │   (deposit, yield, withdraw)   │  │   published band)                      │  │
│ │   — 0% fee, 0 on principal     │  │ • Only when YOU execute a swap         │  │
│ │ • Chat assistant (free tier)   │  │ • Taken inside your signed swap        │  │
│ │ • Portfolio, withdraw-always   │  │ • Never on the vault or your deposits  │  │
│ │ • You never need SRK for these │  │ • First {N} swaps free                 │  │
│ │                                │  │ [See an example] · [Verify recipient↗] │  │
│ └────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                │
│ ┌─ OPTIONAL: PREMIUM (paid in SRK) ─┐  ┌─ LATER (NOT charged now) ───────────┐  │
│ │ Advanced AI features, optional.    │  │ Performance fee on ADVANCED, opt-in │  │
│ │ A subscription PAYMENT — not a     │  │ strategy vaults — profit-only, with │  │
│ │ vault fee. Free tier stays full.   │  │ a high-water mark. ▸ Not active at  │  │
│ │ [Compare free vs premium →]        │  │ launch. The Aave vault stays 0-fee. │  │
│ └────────────────────────────────────┘  │ [How a performance fee would work]  │  │
│                                          └─────────────────────────────────────┘  │
│                                                                                │
│ ┌── "WE ONLY EARN WHEN YOU EARN" — the honesty chart (Recharts) ───────────┐  │
│ │ Two areas over time: cumulative USER yield  vs  cumulative PROTOCOL        │  │
│ │ revenue. User-yield area dominant; "0-fee vault" annotated. Tabular.       │  │
│ │ (mirrors admin §3.5 user-yield-vs-revenue, but user-scoped/own data)       │  │
│ └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│ ┌── VERIFY ─────────────────────────────────────────────────────────────────┐  │
│ │ Vault 0-fee constant (read) · Swap fee-recipient address (mono, explorer↗) │  │
│ │ "These limits live in the contracts, not this app." [See permissions →]    │  │
│ └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Left-to-right reading order is deliberate:** **Free first**, then **the one fee**, then **optional**, then **future/not-charged** — so a skimmer's first impression is "most of this is free and nothing touches my principal."
- **The honesty chart** is the page's signature element (§4.5).
- **Verify block** grounds every claim in chain data (mono addresses + explorer + a cross-link to the prove-it permissions page, `05` §2.3).

### 4.3 Mobile layout (390px) — stacked sections, free-first

```
┌───────────────────────────────┐
│ ● Non-custodial ▸ · Base · ⌘  │
├───────────────────────────────┤
│ Fees & how we make money       │
│ "We only earn when you earn…"  │
├───────────────────────────────┤
│ ✓ 0 on principal · vault 0-fee │  ← principle checks (never collapsed)
│ ✓ Shown before you sign        │
│ ✓ We never hold your funds     │
├───────────────────────────────┤
│ ▸ What's free            (open)│  ← Accordion, "What's free" open by default
│   vault · chat · withdraw…     │
│ ▸ The one fee today (swap)     │
│   0.20% · only on swaps you do │
│ ▸ Optional: Premium (SRK)      │
│ ▸ Later (not charged now)      │
│   perf fee · not active · 0 on │
│   the Aave vault               │
├───────────────────────────────┤
│ [Honesty chart — user yield    │
│  vs protocol revenue]          │
├───────────────────────────────┤
│ Verify ▸ addresses · explorer  │
└───────────────────────────────┘
```

- Sections are `Accordion`s; **"What's free" is expanded by default** and the **principle checks are never collapsed**. The honesty chart stacks full-width below.

### 4.4 Section content (plain-language, defer to `07`)

| Section | What it says (plain) | Components |
|---|---|---|
| **Principle banner** | The four hard rules as checks: "0 fees on your principal · the Aave vault is 0-fee · you see every fee before you sign · we never hold your funds." | `Card` + check rows (`--success` check + text; semantic, not spark) |
| **What's free** | "The Aave Yield Vault — deposit, earn, and withdraw with **0% fee** and nothing taken from your principal. The chat assistant's free tier, your portfolio, and withdraw-always are free too. You never need SRK for any of this." | `Card` + list; cross-link to vault + free-vs-premium matrix (`10`) |
| **The one fee today** | "When **you** execute a swap, we charge a **0.20% routing fee** (set within a published 0.15–0.30% band). It's taken **inside your own signed swap** — we never hold your funds — and it **never** applies to the vault or your deposits. **Your first {N} swaps are free.**" + [See an example] (opens an annotated mock confirm) + [Verify recipient ↗]. | `Card` + ⓘ + example `Dialog`/`Sheet` mirroring the Flow 9 confirm; explorer link |
| **Optional: Premium** | "Premium adds advanced AI features and is **paid in SRK** — it's a **subscription payment, not a vault fee**. The free tier stays fully usable; premium never gates the vault, deposits, yield, or withdrawals." + [Compare free vs premium →] (`/premium`, Flow 10). | `Card`; cross-link only (no price here — `10` owns price) |
| **Later (not charged now)** | "On future **advanced, opt-in** strategy vaults we may charge a **performance fee** — **only on profit**, with a **high-water mark** (you're never charged twice on the same gains), and **never on the conservative Aave vault**, which stays **0-fee**. **This is not active at launch.**" + [How a performance fee would work] (opens S4 disclosure in its greyed/preview state). | the **PerformanceFeeDisclosure** component (§6), in **not-active** state |
| **Honesty chart** | "Here's the value we created for you vs what we earned." Two areas (§4.5). | Recharts (§4.5) |
| **Verify** | "Don't take our word for it." Vault 0-fee constant read; swap fee-recipient address (mono, explorer); "limits live in the contracts, not this app." | mono + explorer `Button`s; cross-link `/trust/permissions` |

### 4.5 The "we only earn when you earn" honesty chart (Recharts)

The user-scoped mirror of the admin panel's user-yield-vs-revenue chart (`admin-panel` §3.5 take-rate framing), built to `04` §6 chart style:

- **Type:** two stacked/overlaid `Area`s over time — **cumulative yield earned *for you*** vs **cumulative fees *you* paid to SparkPoint**. The user-yield area is visually dominant; the fee area is small (and **zero** for a vault-only user). Single honest range (default 1M or All), no flattering window.
- **Color discipline:** user-yield area = the sanctioned spark area treatment (`04` §6.2, "your money, the thing of focus") **or** `--info`; the fee area = a muted neutral — **never** semantic red (a fee is not a loss) and **never** alarm. Tabular values, styled tooltip, `aria-label` summary.
- **Annotations:** "Aave vault: 0-fee" marker; if the user has paid $0 in fees, the fee area is flat-zero with the label **"You've paid $0 in fees."** (not an empty/broken chart).
- **Honesty rule:** historical/realized only — **no projected revenue, no projected yield** on the user-facing chart (projections live only in the admin panel, dashed + "est.", `admin-panel` §3.5). Never lead the page with this chart's number.

### 4.6 States (`/fees`)

| State | Treatment |
|---|---|
| **Default (connected, has activity)** | Full page; honesty chart populated with the user's real yield vs fees-paid. |
| **Pre-deposit / no activity** | All sections render (the page is educational before you ever pay). Honesty chart shows **"You've paid $0 in fees."** + a flat user-yield baseline — an **EmptyState**-style invitation, never a dead `$0.00` widget (`06` §24). |
| **Public / pre-connect (`(public)/fees`)** | Sections + addresses + the example, **no account-specific data** (no personal chart); "Connect to see your own fees." Mirrors `(public)/trust` (`05` §3.1). |
| **Loading** | `Skeleton` for chart + any account figures; the **static plain-language sections render immediately** (they don't depend on chain reads). |
| **Stale** | Account figures stamped "as of {time}"; the policy text is never stale (it's static truth). |
| **Read error (chain reads for Verify / chart)** | The **claims still stand** — "We couldn't load the live figures right now. These fees live in the contracts, not this app. [Retry] · [Verify on explorer]" (`05` §2.4 framing). Never block or hide the page on a read failure. |
| **Degraded mode** | Banner "Some services are degraded — your custody and exit are unaffected"; the page's policy text + the on-chain verify links still work; withdraw-always elevated. |

---

## 5. S3 — Per-action receipts (what fee, if any, was paid)

The post-sign proof that the fee shown pre-sign is exactly what happened — closing the honesty loop. Lives in the **success receipt** (Flow 6 §F) and the **Outcome Log entry** (`05` §8 / `08` §C).

### 5.1 What the receipt fee line shows

| Action | Receipt fee line | Proof |
|---|---|---|
| **Swap** | **"Routing fee paid: $X (0.20%)"** — or **"Routing fee: $0.00 (first {n} swaps free)"** | tx hash + explorer; fee-leg reconciles in Details (`09` §8) |
| **Vault deposit / withdraw** | **"SparkPoint fee: $0.00 (0% — none deducted)"** | tx hash + explorer; redeem shows "0% fee" (`06` §F; `17` SharesPreview) |
| **Premium payment** | **"Premium subscription: {price} (paid in SRK) — not a vault fee"** | tx hash + explorer (`10` §F) |
| **Performance fee (future)** | **n/a at launch** — vault receipts show "$0.00 (0% — none deducted)"; the perf-fee line only ever appears on a *future advanced-vault* action, and only when live | (future) on-chain share-mint event |

### 5.2 Rules

- **Re-state, don't re-compute silently:** the receipt repeats the fee **with the same rate + USD framing** the user saw pre-sign; any difference (e.g., final gas) is shown honestly, but the **SparkPoint fee never exceeds what was disclosed**.
- **Provable:** the fee is reconcilable from the on-chain tx (the receipt links it); for swaps, the fee-leg appears in the power-user Details.
- **0 is stated, not omitted:** a 0-fee vault action **explicitly** shows "$0.00 (0% — none deducted)" — never a blank.
- **Honest framing carries through:** swap = "routing fee"; vault = "0% fee"; premium = "subscription payment." Never relabel post-hoc.

### 5.3 States (receipt fee line)

default (fee paid, shown + tx) · **0-fee** (explicit $0.00 / 0%) · **first-N-free** ($0.00 + struck original) · **subscription** (price, "not a vault fee") · loading (skeleton on the fee value, the rest of the receipt may render) · error (if the receipt can't load the fee detail, show "fee as disclosed pre-sign: $X" + retry, never a fabricated number). Both breakpoints; toast mirror (`Sonner`) carries the headline only ("Swap confirmed · View tx ↗"), not fee detail (`07` §6.4).

---

## 6. S4 — The Performance-Fee Disclosure component (future; greyed "not active at launch")

A **reusable disclosure component** that ships now in a **"not active at launch"** state, proving **0 on the Aave vault**, and is ready to flip to a **live** state on the future advanced, opt-in strategy vaults **only after the §5.2 constitution amendment** (`revenue-model` §3 Phase 1, §5.2.B). It is the user-facing twin of the admin panel's HWM-status panel (`admin-panel` §3.5 #7) and the design's readiness for the fund-revenue switch.

### 6.1 Purpose & the two states

- **Not-active (the launch state — what ships):** explains *how a performance fee would work* and **proves it is 0** on the current vault. Greyed/quiet, **never a charge, never a hype teaser**. Used on `/fees` ("Later") and the Trust Center fee panel.
- **Live (future, post-amendment, advanced vaults only):** shows the **actual** profit-only fee with its **high-water mark**, rate, recipient, and **cumulative fees charged** — net-of-everything, on-chain-verifiable. **Never** applies to the conservative Aave vault.

### 6.2 Anatomy (defer to `07` for wording)

| Part | Not-active (launch) | Live (future) |
|---|---|---|
| **State pill** | greyed **"Not active at launch"** (neutral/muted, **not** red, **not** spark) | **"Active on this vault"** (semantic, only on advanced vaults) |
| **Headline** | "Performance fee — profit-only, with a high-water mark. **Not active at launch.**" | "Performance fee: {rate}% of realized profit, above your high-water mark." |
| **What it means** | "If we ever charge it, it's **only on profit** — never your principal — and a **high-water mark** means you're never charged twice on the same gains. **It will never apply to the conservative Aave vault.**" | same explanation + **"applies to this advanced vault only."** |
| **The 0-proof (launch)** | **"On the Aave Yield Vault you are charged 0. Always. SparkPoint fee: 0%."** + a mini HWM diagram in a **greyed/illustrative** treatment (clearly "example, not a charge") | live **share-price vs HWM** read (`LineChart` + HWM `ReferenceLine`, `admin-panel` §3.5 #7 user-scoped) + "fee accrues above HWM / no fee below" status |
| **Rate** | "Capped at 10% of realized yield (proposed). 0% management, 0% on principal — always." | the actual configured rate (≤ cap), net-of-everything |
| **Recipient / mechanics** | "Collected on-chain via vault-share accrual to a non-privileged recipient — never via custody; withdraw-always is never impaired." (future-tense) | live recipient address (mono, explorer) + cumulative fees charged |
| **Governance note** | **"Requires a published constitution amendment before it can ever ship. The launch vault stays 0-fee until then."** (`revenue-model` §5.2) | links to the ratified amendment record |
| **APY framing** | the vault's APY is shown **net of a 0% fee** (`07` §5.2) | APY shown **net of the live fee**, with breakdown (never bare) |

### 6.3 States

| State | Treatment |
|---|---|
| **Not active at launch (default — what ships)** | Greyed component; explanatory; **0-proof prominent** ("0% on the Aave vault"); HWM shown as an illustrative diagram clearly labeled "example." **No live numbers, no charge.** |
| **Live (future, advanced vault)** | Full live disclosure: rate, HWM read, recipient, cumulative fees, net-of-everything APY. Only renders where the fee is actually active. |
| **Below HWM (future)** | "No fee right now — the vault is recovering to your high-water mark. We only earn when you're back in profit." (reinforces the thesis) |
| **Loading (future)** | skeleton on HWM/recipient/cumulative; the explanation renders immediately. |
| **Read error (future)** | "Couldn't load live fee figures — these are enforced on-chain, not by this app. [Retry] · [Verify ↗]"; never blocks withdrawal. |

> **Color rule:** the not-active state is **muted/greyed neutral**, never red (a future fee that's off is not a danger) and never spark (it's not AI presence or a CTA). The HWM "below HWM = no fee" state, when live, reads as **reassuring** (the thesis working), not as a loss.

### 6.4 Acceptance (S4)

- Ships at launch in a **greyed "not active at launch"** state that **explicitly proves 0% on the Aave vault**; never renders as a live charge at launch.
- Explains **profit-only + high-water mark + never-on-principal + amendment-gated** in plain language (`revenue-model` §5.2.B).
- The component is the **same** one that flips to live on future advanced vaults — designed once, ready for the switch.
- **Never** applies to, or implies a fee on, the conservative Aave vault, in any state.

---

## 7. S5 — How fees appear in the portfolio & the Outcome Log

Fees must be legible exactly where the user evaluates performance — **always net, never hidden** — so "honest yield" is structural (`07` §5.2, §5.3; `03`; `05` §8; `08` §C).

### 7.1 Portfolio (`/portfolio`, Flow 3)

- **Net APY on yield-bearing rows** is **net of fees**, with the breakdown ≤1 tap including the **"− 0% SparkPoint fee"** line (`03` §161; `06` §16 NetApyBreakdown). Idle rows use en-dash, never a fake `0%`.
- **PnL is realized, net-of-everything** (`07` §5.3). Any fee paid on an action that produced a position is reflected in its net figures, not bolted on as a surprise.
- **Optional "fees paid to date" read** (position detail or a portfolio summary line): a quiet, tabular **"SparkPoint fees paid: $X to date"** (almost always $0.00 for vault-only users) → cross-link `/fees`. Framed neutrally (a record, not a warning); **vault contribution to this is always $0.00**.
- The **vault position row** carries the 0-fee truth (its net APY breakdown shows "− 0% SparkPoint fee"); withdraw on the row is always available and **never** fee-bearing.

### 7.2 Outcome Log (`/activity`, `/activity/[entryId]`, `05` §8 / `08` §C)

- Each entry's **realized PnL is net-of-everything** (`08` §25; `05` §8). The entry detail shows a **fee line** for the originating action: a swap entry shows **"Routing fee: $X"**; a vault action shows **"0% fee — none deducted."**
- **Wins and losses are symmetric** (`05` §8.7); the fee line never softens a loss or inflates a win — it's a factual cost line, tied to the same tx the outcome links.
- **Verification:** every entry links its **tx hash(es)**, so the fee is on-chain checkable alongside the outcome.

### 7.3 States (fee-aware portfolio/outcome)

default (net figures + fee line) · **vault-only / $0 fees** ("SparkPoint fees paid: $0.00" — the common, reassuring case) · loading (skeleton; never `0`) · stale ("as of {time}") · error (row degrades to "couldn't load value" + retry; **withdraw still works**; never a broken `$0.00`). Both breakpoints (desktop table rows / mobile cards, `03` / `08`).

---

## 8. Microcopy (defer to `07`; fee-transparency-specific strings)

All strings below are illustrative compositions of `07` rules; **`07` wins on any conflict.** Reuse the **verbatim** motifs.

**Verbatim (reuse exactly):**
- The thesis: **"We only earn when you earn — never on your principal, never by taking custody."** (`revenue-model` one-liner)
- **"SparkPoint fee: 0%"** (vault) and the APY breakdown **"{X}% net APY = {X}% Aave supply rate − 0% SparkPoint fee."** (`07` §5.2)
- **"Estimates, not guarantees."** on any yield-referencing line (`07` §3.3).
- Swap fee line + ⓘ explainer = **`09` §4.1** (do not paraphrase).

**Fees page (`/fees`):**
- Lede: "We only earn when you earn — never on your principal, never by taking custody. Here's exactly what we charge, when, and why."
- Free section: "The Aave Yield Vault is **0-fee** — 0 on your principal, 0 on your yield. The free assistant, your portfolio, and withdraw-always are free too. You never need SRK for any of this."
- The one fee: "When **you** execute a swap, we charge a **0.20% routing fee** (set within a published 0.15–0.30% band), taken **inside your own signed swap** — we never hold your funds — and **never** on the vault or your deposits. Your first {N} swaps are free."
- Premium: "Premium is **optional** and **paid in SRK** — a **subscription payment, not a vault fee**. The free tier stays fully usable."
- Later: "On future **advanced, opt-in** strategy vaults we may charge a **performance fee — only on profit, with a high-water mark, never on the conservative Aave vault.** This is **not active at launch**, and requires a published amendment before it could ever ship."
- Verify: "Don't take our word for it — these fees live in the contracts, not this app. [See the fee-recipient ↗] · [See permissions →]"

**Receipts:**
- Swap: "Routing fee paid: $X (0.20%)." / "Routing fee: $0.00 — first {n} swaps free."
- Vault: "SparkPoint fee: $0.00 (0% — none deducted)."
- Premium: "Premium subscription: {price} (paid in SRK) — not a vault fee."

**Performance-fee disclosure (not-active state):**
- "Performance fee — profit-only, with a high-water mark. **Not active at launch.** On the Aave Yield Vault you are charged **0**. Always."
- "If we ever charge it: only on profit, never your principal, and never on the conservative Aave vault. A high-water mark means you're never charged twice on the same gains."

**Banned here (carry `07` §9.3):** no "low fees!/save money/cheapest"; no bare APY; no return-led line to sell a fee; no "small fee" minimizing language that hides the rate; never call the swap fee or premium a fee "on your funds/principal/custody"; never imply the future performance fee is imminent or applies to the Aave vault.

---

## 9. Non-custody, fee-transparency & trust touchpoints (this flow)

- **Net-of-everything, pre-sign, always (`revenue-model` rule 4; `07` §5.2):** every fee itemized (rate + USD) before signing; every APY net with a "− 0% SparkPoint fee" breakdown; no hidden or folded fees anywhere.
- **The 0-fee vault is shown, not assumed (`06` §9; `revenue-model` §3):** "SparkPoint fee: 0%" is explicit on confirms, receipts, the fees page, and the perf-fee disclosure's 0-proof.
- **Usage/optional fees honestly labeled (`revenue-model` rule 2):** swap = usage fee; premium = subscription payment; neither is a fee on principal or custody, and the copy says so.
- **Non-custodial by construction (`revenue-model` rule 3):** swap fee taken inside the user's signed swap; premium a user-signed pay-with-SRK; future perf fee accrues on-chain to a non-privileged recipient — **withdraw-always is never impaired by any fee**, stated wherever a fee appears.
- **Provable (`05` §0.1):** fee-recipient address + explorer links on `/fees` and receipts; the vault 0-fee constant is readable; "limits live in the contracts, not this app."
- **Future fees are honestly "not yet" (`revenue-model` §5.2):** the performance-fee disclosure ships greyed, amendment-gated, proving 0 on the Aave vault — never a live charge, never a hype teaser.
- **We only earn when you earn (the honesty chart):** user yield vs protocol revenue shown side-by-side, historical only, never red, never projected on the user surface.
- **Withdraw/exit ≤1 tap (`05` §0.2):** present on `/fees` and every fee surface; no fee surface or its error state hides the escape hatch.

---

## 10. shadcn/ui mapping (this flow)

| Fee element | shadcn/ui primitive(s) / component |
|---|---|
| Fee line item (confirm Cost & outcome) | `Card` + `Tooltip`/`Popover` (ⓘ usage-fee explainer) — inside ConfirmationCard (`06` §9) |
| Swap fee rendering (authoritative) | per **Flow 9 §4** (line + first-N-free `Badge`/strike + ⓘ) |
| Vault "0% fee" line | text + `Tooltip` ("0 on principal and yield") |
| `/fees` page shell | standard AppShell content slot + `(public)/fees` mirror |
| Principle banner (4 hard rules) | `Card` + check rows (`--success` icon + text) |
| Free / one-fee / optional / later sections | `Card`s (desktop) · `Accordion` (mobile) |
| "See an example" annotated confirm | `Dialog` (desktop) / `Sheet` (mobile) mirroring the Flow 9 confirm |
| Honesty chart (user yield vs revenue) | Recharts overlaid/stacked `Area`s + styled tooltip + range `ToggleGroup` (`04` §6) |
| Verify block (addresses) | mono text + copy `Button` + explorer-link `Button`; cross-link `/trust/permissions` |
| Performance-fee disclosure (S4) | dedicated **PerformanceFeeDisclosure** = `Card` + state `Badge` (greyed "Not active") + `Accordion` + Recharts `LineChart` + `ReferenceLine` (HWM, future) |
| Receipt fee line | within ConfirmationCard receipt (`06` §F) + Outcome Log entry (`08` §C) |
| Net APY breakdown (incl. "− 0% fee") | **NetApyBreakdown** (`06` §16) |
| Portfolio "fees paid to date" | `text-sm` tabular line + cross-link; PositionRow context (`06` §22) |
| Outcome Log fee line | entry detail row + tx explorer link (`05` §8 / `08` §C) |
| "How do you make money?" tip | **TipCard** (`06` §11, `--info`) |
| Empty / pre-deposit (paid $0) | **EmptyState**-style honesty-chart zero ("You've paid $0 in fees.") (`06` §24) |
| Read-error / degraded banners | **AlertBanner** (`06` §25, info/warning) + retry + "enforced on-chain" |
| Toast mirrors | `Sonner` (headline only: "Swap confirmed · View tx ↗") |

---

## 11. Benchmarks honored (this flow)

| Pattern | Benchmark (canonical link in `09`) | How we apply it |
|---|---|---|
| **Net-of-fees figure with a breakdown; never bare APY** | **Yearn / Beefy / Morpho (★★/★★★)** `09` §3 | Every APY shows "− 0% SparkPoint fee"; net-of-everything portfolio/outcome PnL; the fees page proves the 0. |
| **Profit-only performance fee + high-water mark, on-chain, itemized** | **Yearn v3 / Beefy / Morpho curators; Numerai HWM** `09` §3 / `revenue-model` §2 | The PerformanceFeeDisclosure (S4) — profit-only, HWM, non-privileged recipient, **off at launch**. |
| **Pre-trade fee shown in the simulation, before signing** | **Tenderly (★★★)** `09` §5 | The fee line in Cost & outcome, pre-sign, reconciled in Details (via Flow 6 / Flow 9). |
| **Restraint as a feature (modest take-rate, shown honestly)** | **Gauntlet / Steakhouse "race to 0%" read** `revenue-model` §6 | 0-fee conservative vault as the wedge; the one fee is small, banded, and first-N-free; the honesty chart shows revenue ≪ user yield. |
| **Status, not slogans; two truthful columns; verify-on-chain** | **Ledger / Trust Wallet + Morpho/Gauntlet transparency** `05` §0, §3.6 | The fees page leads with what's free + 0-on-principal, grounds every claim in chain reads, and links the recipient/permissions. |

---

## 12. Acceptance criteria (Flow 11 — Fee Transparency / Revenue Surfaces)

A design satisfies this flow doc when **all** hold:

1. **Both breakpoints, full-fidelity.** Every surface (S1–S5) is designed at **1440px desktop** and **390px mobile**, with the `/fees` page leading **free-first** and the **principle checks never collapsed**; Dialog→Sheet on mobile.
2. **All states designed.** For each surface: default · loading · empty/pre-activity ("paid $0") · stale · read-error ("enforced on-chain, not this app") · degraded — plus the swap fee's first-N-free state and the perf-fee disclosure's not-active vs live states. Copy from `07`.
3. **The fee line item is honest and pre-sign (S1).** Every confirm shows a SparkPoint-fee line — **swap routing fee (rate + USD, ⓘ usage-fee framing)** per **Flow 9 §4**, or **"SparkPoint fee: 0%"** on the vault — **before Sign is reachable**; uncomputable → "— (calculated at simulation)" + Sign disabled; net reconciles in Details; **never folded or hidden**.
4. **The `/fees` page answers the four questions plainly (S2).** What's free → the one fee → optional premium → future/not-charged, each with "how it's collected" + a verify affordance; **leads with control + 0-on-principal, never with a number**; carries the **honesty chart** (historical only, user-yield-dominant, fee area never red, no projections); has a **public mirror** with no account data.
5. **Receipts re-state the fee provably (S3).** Each success/Outcome-Log entry shows the fee paid with the **same framing** as pre-sign (swap "Routing fee: $X" / vault "$0.00 — 0%, none deducted" / premium "subscription payment"); the **SparkPoint fee never exceeds what was disclosed**; tx-linked and reconcilable; **0 is stated, not omitted**.
6. **Performance-fee disclosure ships greyed and proves 0 (S4).** It renders at launch as **"Not active at launch,"** explains **profit-only + high-water mark + never-on-principal + amendment-gated**, **explicitly proves 0% on the Aave vault**, never renders a live charge at launch, never applies to (or implies a fee on) the conservative vault, and is the **same** component that flips live on future advanced vaults.
7. **Fees are net-of-everything in portfolio & outcomes (S5).** Net APY carries "− 0% SparkPoint fee"; PnL is realized net-of-everything; an optional "fees paid to date" reads (almost always $0.00, vault contribution always $0.00); Outcome Log entries carry a tx-linked fee line; wins/losses symmetric; idle rows en-dash not fake `0%`.
8. **Labels are honest (no mislabeling).** Swap = **usage fee**; premium = **subscription payment**; vault = **0% fee**; future perf fee = **profit-only, opt-in, advanced-vault-only, not active**. No fee is ever framed as a charge on principal or custody; no future fee is implied imminent or applied to the Aave vault.
9. **Non-custodial & provable everywhere.** Every fee surface states/keeps **withdraw-always unimpaired**; on-chain fees terminate in tx + explorer; the fees page links the **fee-recipient** and the **vault 0-fee read** and cross-links permissions; read failures never hide the page or the escape hatch.
10. **Net-of-everything honesty, no hype.** No bare APY, no return-led framing to sell a fee, no "low fees!" minimizing, no projected revenue/yield on user surfaces; the thesis **"we only earn when you earn — never on your principal, never by taking custody"** is verbatim and structurally demonstrated, not merely claimed.
11. **Consistency across surfaces.** The same fee reads identically (rate, framing, net) on the line item, receipt, fees page, and portfolio; a discrepancy pre- vs post-sign is a defect.
12. **Maps to shadcn + accessible (`04` §10).** Every element resolves to the §10 map; fee figures **tabular**; mono for addresses; **never color-only** (the 0% and any fee carry text + icon, the fee area in the chart is neutral not red); visible 2px spark focus ring; keyboard-operable; reduced-motion honored; AA contrast both themes.

---

## 13. Cross-references

- **What we charge and why (authoritative):** `docs/revenue-model/README.md` — the one-liner + four hard rules; **Stream 0A** (swap fee, 20 bps, first-N-free, §3 Phase 0); **Stream 0B** (premium, freemium, SRK); **Stream 1A / 1A-Launch** (profit-only HWM performance fee, future, §3 Phase 1 / §5.2.B amendment); the **0-fee launch vault** (Principle V).
- **The confirm surface the fee line lives in:** `02-flows/06-execution-confirmation-simulation.md` (§3 Cost & outcome; §F receipt) — authoritative for the sign gate.
- **The swap fee's in-confirm rendering (authoritative):** `02-flows/09-ai-swap.md` (§4 — line item, first-N-free states, ⓘ explainer, fee-leg in Details).
- **The premium price & pay-with-SRK:** `02-flows/10-subscriptions-premium-srk.md` (§D pay, §E sign, §F receipt — authoritative for price/pay; this doc only distinguishes a subscription **payment** from a fee).
- **The Trust Center fee panel + provable-not-promised + Outcome Log fees surface into:** `05-trust-and-safety-ux.md` (§0, §3.6, §8).
- **Net-of-fee APY / portfolio / outcome rendering:** `02-flows/03-portfolio.md` (§161 net APY, breakdown); `02-flows/08-srk-literacy-outcomes-settings.md` (§C Outcome Log, net-of-everything).
- **NetApyBreakdown / SimulationBalanceChangeTable / ConfirmationCard / AlertBanner / TipCard / EmptyState:** `06-component-library.md` (§16, §23, §9, §25, §11, §24).
- **Tokens, the three color systems, tabular numerals, mono, data-viz, a11y, component→shadcn map:** `04-design-system.md` (§2, §3, §6, §10, §11).
- **All canonical wording — APY net + 0% fee, currency, banned/required phrases, success/error patterns, trust motifs:** `07-content-and-tone.md` (§5.1, §5.2, §5.3, §2.1, §3, §9) — **wins on any conflict.**
- **The internal mirror (revenue dashboard):** `docs/admin-panel/README.md` (§3.5 — revenue by stream, user-yield-vs-revenue take-rate, HWM-status, realized-vs-projected solid/dashed). This user-facing flow is the public, account-scoped, projection-free counterpart.
- **Benchmark links (Yearn/Beefy/Morpho/Gauntlet net-of-fees; Tenderly preview; Ledger/Trust Wallet transparency):** `09-references.md` (§3, §5).
- **Requirements traced:** the swap-fee FR + disclosure (revenue-model §5.2.0); FR-017/018 (the 0-fee launch vault; future amendment §5.2.B); FR-039–041 (Outcome Log linkage, net-of-everything); the honest-yield / net-of-everything principle (Constitution III); the non-custody invariants N1–N5 (every fee mechanism preserves them, withdraw-always never impaired).
