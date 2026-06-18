# 02 · Flow 11 — Fee Transparency & Revenue Surfaces ("we only earn when you earn")

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-level spec for **Flow 11 (Fee Transparency / Revenue Surfaces)** — the **user-facing side of the revenue model**. It is the design layer that makes **"we only earn when you earn — never on your principal, never by taking custody"** legible, honest, and provable everywhere a fee could (or pointedly does *not*) appear. Production-ready, **desktop + mobile equal priority, all states**. **No code.**
> **What this surface IS:** the cross-cutting **fee-disclosure system** — (a) the **swap-fee line item** in the confirmation (one of three fees active at launch, cross-ref Flow 9); (b) a dedicated **"Fees & how we make money" transparency page** (`/fees`) in plain language; (c) **per-action receipts** that re-state exactly what fee (if any) was paid; (d) the **"performance-fee disclosure" component** for the Aave Yield Vault, **active at launch**, disclosing the **10% profit-only, high-water-mark performance fee — 0% on your principal**; and (e) **how fees appear in the portfolio and the Outcome Log** (net-of-everything, never hidden). It is the connective tissue between the revenue model and the trust spine.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, the thesis ("AI proposes — guardrails + you dispose — and the protocol never holds your money"), the five non-custody guarantees, **honest-yield / net-of-everything**, the non-goals (no return-led surfaces, no bare APY, no hype). Where this doc and the brief disagree, the brief wins.
> - `docs/revenue-model/README.md` — **the source of truth for what we charge and why.** The load-bearing one-liner *"Fair, transparent fees from day one — we only earn when you earn, never on your principal, never by taking custody."*; the **four hard rules** (never-on-principal, usage-fees-honestly-labeled, non-custodial, provable & transparent); **Stream 0A** (Aerodrome swap-routing fee, **20 bps / 15–30 bps band**, taken inside the user-signed swap, "first N swaps free"); **Stream 0B** (premium AI tier, freemium, paid in SRK); **Stream 1A / 1A-Launch** (the **profit-only, high-water-mark performance fee** — **active at launch** on the Aave Yield Vault, **10% of realized yield** (configurable on-chain, hard-capped at 20%, timelocked), ratified by the §5.2 constitution amendment v1.1.0); and the launch posture: **the single Aave Yield Vault is 0-management / profit-only performance-fee** (0 management, 0 entry/exit, 0 on principal, **10% on realized yield only above a high-water mark**).
> - `04-design-system.md` — tokens; **the three orthogonal color systems** (spark = AI presence/CTA; semantic green/red/amber = outcome/safety; risk palette = tier) and the rule *never cross-contaminate*; **tabular numerals** §3.1/§3.4; **mono** for addresses/hashes; currency/PnL/APY formatting §3.4; data-viz (Recharts) §6; motion §7; iconography §8; a11y §10; the component→shadcn map §11.
> - `05-trust-and-safety-ux.md` — §0 (provable not promised; status not slogans; two truthful columns), §3.6 (the **Trust Center fee panel** this page extends), §8 (the **Outcome Log** fees surface into).
> - `06-component-library.md` — composes **NetApyBreakdown** (§16, "− 10% SparkPoint performance fee (profit-only, HWM)" line), **SimulationBalanceChangeTable** (§23, the swap fee leg), **ConfirmationCard** (§9, cost & outcome block + receipt), **AlertBanner** (§25), **TipCard** (§11, "how do you make money?"), **EmptyState** (§24), **CapsMeter** (n/a here), and **the cross-cutting CitationChip / sourced-figure affordance**.
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Especially §5.2 (APY net + breakdown, **the 10% profit-only performance fee explicit — 0% on principal**), §5.1 (currency), §9 (banned/required phrases — **no hidden fees, no bare APY, no return-led framing**), §2.1 (trust motifs), §3 (success/error patterns).
> - `02-flows/06-execution-confirmation-simulation.md` — **Flow 6 is authoritative for the confirm surface.** The fee line item lives inside its **Cost & outcome** block; this doc specifies only the *fee-disclosure content and copy*, never a second sign UI.
> - `02-flows/09-ai-swap.md` — **Flow 9 §4 is authoritative for the swap-routing fee's in-confirm rendering** (where it appears, the first-N-free states, the ⓘ usage-fee explainer). This doc **cross-references** it and ensures consistency across every other fee surface; it does not redefine §4.
> - `02-flows/10-subscriptions-premium-srk.md` — **Flow 10 is authoritative for the premium-tier price and pay-with-SRK.** This doc only states *how the subscription appears on the fees page and in receipts* (a subscription **payment**, honestly distinguished from a vault fee).
> - `09-references.md` — §3 net-of-fees / vault-transparency benchmarks (**Yearn / Beefy / Morpho / Gauntlet**), §5 simulation/preview (**Tenderly**).
>
> **What this doc is NOT:** the sign-gate internals (`06`); the swap surface or its fee-rendering rules (`09` §4 — authoritative); the premium price/pay flow (`10`); the **admin/stakeholder revenue dashboard** (`docs/admin-panel/README.md` §3.5 — that is the *internal* revenue view; this doc is the *user-facing* mirror of the same honesty); visual tokens (`04`); canonical strings (`07`); the route map/shell (`01`). It **never authorizes a fee** — it visualizes exactly what the revenue model defines, no more.

---

## 0. The fee-transparency thesis (constraints on every screen in this flow)

This flow is where the revenue model meets the user. The market we are entering is discredited precisely because fees and "AI funds" were opaque, custodial, and over-promised (`revenue-model` §1, §6). Our entire monetization defense is **honesty made visible**. Constraints binding every screen here:

1. **Net of everything, never hidden (`revenue-model` rule 4; `07` §5.2, §9.1).** Every fee is **disclosed up-front, itemized (rate *and* USD), and shown net-of-everything**. A fee folded silently into "output," an APY shown without its "− 10% SparkPoint performance fee (profit-only)" breakdown, or a return shown gross-of-fee **fails review**. There is **no place** in the product where a user pays a fee they were not shown first.

2. **We only earn when you earn (`revenue-model` one-liner, verbatim).** The framing is structural, not marketing: a fee may only ever land on **(a) value we created over your principal** (realized yield/profit, future) or **(b) a discrete service you chose to use** (executing a swap; optional premium) — **never on deposits, principal, or AUM at rest.** Copy states this as fact; the fees page proves it side-by-side (user yield vs protocol revenue).

3. **The launch Aave vault is 0-management / profit-only — and we *show* the math (`revenue-model` §3 Phase 0; `06` §9; `07` §5.2).** "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — **0% on your principal**" is rendered **explicitly** on every vault confirm, every yield readout, and the fees page — disclosed, never buried. 0 management, 0 entry/exit, **0 on principal**, **10% on realized yield only above a high-water mark** (configurable on-chain, hard-capped at 20%, timelocked). "We only earn when you earn" is the trust wedge; the design must make both the **0-on-principal** truth and the **profit-only fee** impossible to miss.

4. **Usage fees are labeled as usage fees (`revenue-model` rule 2).** The **swap routing fee** is a *usage fee on a service you performed* — **not** a custody fee, **not** a vault/deposit/withdrawal/management/yield fee. The **premium subscription** is a *payment for optional capability* — **not** a vault fee. Each is framed for exactly what it is; mislabeling any of them as a fee on your money fails review.

5. **Non-custodial by construction (`revenue-model` rule 3; brief guarantee).** Every fee is collected **without the protocol ever holding, moving, or withholding user funds**: the swap fee is taken **inside the user's own signed swap**; premium is a **user-signed pay-with-SRK** tx; the performance fee accrues **on-chain by minting fee-shares to a non-privileged fee-recipient** during lazy accrual (deposit/withdraw/harvest), only against realized yield above the high-water mark — never against principal. The fee-recipient is an **ordinary, non-privileged share holder** (redeems via the same path as any user; no admin/withdraw authority; cannot block, delay, or reorder a redemption). Fee accrual **fails open** — it never blocks or reverts a withdrawal. The **withdraw-always** escape hatch is **never impaired** by any fee mechanism — copy says so wherever a fee appears.

6. **Provable, not promised (`05` §0.1).** On-chain fees terminate in a **tx hash + explorer link**; the fees page links to the **fee-recipient address** and the relevant contract reads. A fee claim with no verify affordance is a bug.

7. **The performance fee is active and fully disclosed (`revenue-model` §5.2; `admin-panel` §3.5).** The **performance fee** on the Aave Yield Vault is **active at launch** (constitution amendment v1.1.0, ratified). Its disclosure component renders **live**: **10% of realized yield, profit-only, above a high-water mark — 0% on your principal**, with the rate **timelocked and hard-capped at 20%**. It is disclosed pre-deposit and on every receipt, with net-of-everything APY shown and the mechanism provable on-chain — never minimized, never hidden, never hyped. Realized vs projected is always visually distinguished (mirrors the admin panel's solid-vs-dashed rule).

8. **Fact-only, sober tone (`07` §1.3, §9).** No "low fees!", no "save money", no urgency, no return-led framing to sell a fee. Plain: *what we charge · when · why · how it's collected · how to verify · and what stays free.* The page leads with **control and 0% on your principal**, never with a number.

---

## 1. Goal & entry points

### 1.1 Goal

Make a user able to answer, at any moment and in plain language: **"What does SparkPoint charge me, when, why, and how do I verify it?"** — and to come away certain that **nothing touches their principal, they only ever pay on profit, and they are never charged a fee they weren't shown first.** A crypto-curious newcomer should feel *the free tier is genuinely free, the vault never touches their principal, and the performance fee only ever lands on profit*; a DeFi-native should be able to *verify the fee leg, the fee-recipient, the high-water-mark accrual, the 10% rate (timelocked, hard-capped at 20%), and the net-of-everything math on-chain*.

The one-sentence job: **turn the revenue model into a set of honest, provable, net-of-everything fee surfaces — an explicit swap-fee line, a plain-language fees page, per-action receipts, an active performance-fee disclosure showing 10% profit-only / HWM / 0% on principal on the Aave vault, and fee-aware portfolio/outcome views — such that no user ever meets a hidden or mislabeled fee.**

### 1.2 Entry points

| From | Reaches | Notes |
|---|---|---|
| **Confirm surface · Cost & outcome** (`/confirm`, Flow 6 §3) | the fee **line item** (swap fee, or "SparkPoint performance fee: 10% of yield, profit-only — 0% on your principal" on vault) | The single most important fee touchpoint — pre-sign, in-context. Authoritative rendering for swaps = `09` §4. |
| **AI disclaimer strip / shell footer** "How we make money" link | **`/fees`** transparency page | A quiet, persistent, never-hidden link (parallels [Prove it]). |
| **Trust Center** (`/trust`, `05` §3.6 fee panel) "Fees" section → "See full fee details" | **`/fees`** | The Trust Center fee panel is the *summary*; `/fees` is the *full plain-language page*. |
| **NetApyBreakdown** (anywhere APY shows) "see breakdown" → fee line | inline breakdown incl. **"− 10% SparkPoint performance fee (profit-only, HWM)"** | `06` §16; `07` §5.2. The fee is *in* every APY breakdown. |
| **Vault deposit/withdraw** (Flow 5) "10% performance fee on yield, profit-only — 0% on your principal" → ⓘ | inline tip → optional `/fees` | The profit-only / 0-on-principal proof at the point of deposit/redeem. |
| **Per-action success receipt** (Flow 6 §F, Flow 9 §8) "Routing fee: $X" / "Performance fee: $X (10% of yield)" | receipt fee line → tx proof | Re-states the fee paid, provably, after the fact. |
| **Portfolio position row / detail** (Flow 3) net APY + "fees to date" | fee-aware position read → `/fees` | `03` §161; net only, fees legible. |
| **Outcome Log entry** (`/activity/[entryId]`, `05` §8 / `08` §C) "net of fees" | per-outcome fee line | PnL is **realized, net-of-everything**; any fee paid on the action is shown. |
| **Premium upsell / `/premium`** (Flow 10) "this is a subscription, not a vault fee" | cross-link to `/fees` | Distinguishes the SRK subscription **payment** from any fee. |
| **Command menu (`⌘K`)** "Fees / how we make money" | `/fees` | Discoverable, never buried. |
| **TipCard** "How does SparkPoint make money?" (literacy, `06` §11) | inline answer → `/fees` | Learn-as-you-go; `--info` tone, never green. |

> **`/fees` is a supporting, browsable destination** (unlike `/confirm`, which is transient). It is reachable in ≤2 taps from anywhere and **≤1 tap** from the Trust Center and the disclaimer strip. It carries **no account-gated barrier** — a pre-deposit or even pre-connect user can read exactly what they'd ever be charged (a public mirror parallels `(public)/trust`, `05` §3.1).

### 1.3 Pre-conditions & what's already decided upstream

- **What we charge is fixed by the revenue model**, not by this surface: at launch, **three** fees can be charged to a user — the **swap routing fee** (Stream 0A), the **vault performance fee** (Stream 1A-Launch: 10% of realized yield, profit-only, high-water mark, 0% on principal), plus an **optional premium subscription payment** (Stream 0B, paid in SRK, covered by Flow 10). **The vault charges 0 on principal and 0 management; the performance fee is live** (ratified by constitution amendment v1.1.0). This doc renders that reality; it never invents a charge.
- **The swap fee's authoritative in-confirm rendering is Flow 9 §4** (line item, first-N-free states, ⓘ explainer). This doc ensures the *same* fee reads consistently on the fees page, the receipt, and the portfolio — and that **no other surface contradicts it**.
- **Fee state** (e.g., within first-N-free; premium active/lapsed) is known from user history; rendered honestly per the relevant authoritative flow.

---

## 2. The fee surfaces map (what this flow owns, and where each lives)

Five surfaces, one honesty standard. Each is specified in §3–§7.

| # | Surface | Lives at | Authoritative source it defers to | Launch reality |
|---|---|---|---|---|
| **S1** | **Fee line item** in the confirmation | `/confirm` · **Cost & outcome** (Flow 6 §3) | `06` §3 (block) + `09` §4 (swap fee specifics) | Swap: "routing fee 0.20% = $X" (or first-N-free). Vault: **"Performance fee: 10% of yield, profit-only, HWM — 0% on your principal"**. |
| **S2** | **"Fees & how we make money"** page | `/fees` (+ `(public)/fees` mirror) | `revenue-model` README; `05` §3.6 | Plain-language: 0 on principal; ~0.20% swap fee; premium optional (SRK); vault **10% profit-only performance fee, HWM, active at launch**. |
| **S3** | **Per-action receipt** fee line | `/confirm` success (Flow 6 §F) · `/activity/[entryId]` | `06` §F; `09` §8; `05` §8 | Re-states fee paid ("Routing fee: $X" / "Performance fee: $X — 10% of yield, 0% on principal"), with tx proof. |
| **S4** | **Performance-fee disclosure** component | the Aave Yield Vault surfaces; **on `/fees`** + Trust Center | `revenue-model` §3 Phase 1, §5.2 | **Active at launch.** Discloses **10% profit-only / HWM / 0% on principal** on the Aave vault (timelocked, hard-capped at 20%). |
| **S5** | **Fees in portfolio & Outcome Log** | `/portfolio` rows + `/activity` (Flow 3 / `05` §8 / `08` §C) | `03`; `05` §8; `08` §C | Net-of-everything PnL; "fees paid to date" legible; vault rows show the profit-only performance fee. |

> **The honesty contract across all five:** the *same* fee, with the *same* rate, framing, and net math, must read consistently on the line item, the receipt, the fees page, and the portfolio. A figure shown one way pre-sign and another way post-sign is a defect.

---

## 3. S1 — The fee line item in the confirmation (cross-ref Flow 9)

> **Authoritative:** the **Cost & outcome** block of `/confirm` is specified in **Flow 6 §3**; the **swap routing fee** rendering inside it is specified in **Flow 9 §4** (where it appears, first-N-free states, ⓘ explainer, the fee-leg in power-user Details). This section states the **cross-surface fee-disclosure rules** the line item must satisfy and the **vault 0% case**, without re-defining `06`/`09`.

### 3.1 The two launch cases

The Cost & outcome block always shows a SparkPoint-fee line — its value is the proof either way:

- **Swap (Flow 9):** **"SparkPoint routing fee · 0.20% · $X"** with the ⓘ usage-fee explainer; or, when eligible, the **first-N-free** state **"~~0.20% ($X)~~ · $0.00 — first {n} swaps free ({k} left)"** (struck original value stays visible). Reflected in **Net USDC received**. (Full state table = `09` §4.2.)
- **Vault deposit / withdraw (Flow 5 → Flow 6):** **"SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal"** with an ⓘ → *"We charge 10% of the yield you earn above your high-water mark — never on your principal, never on a deposit or withdrawal, never in a flat or down period. We only earn when you earn."* (`06` §3 cost row; `07` §5.2). On a **deposit**, the **net** line equals the gross (no fee is taken on principal in/out); on a **withdraw**, any accrued profit-only fee is itemized and the **net** reconciles.
- **Premium pay-with-SRK (Flow 10 → Flow 6):** the cost block shows **"SparkPoint fee: n/a — this is a subscription payment, not a vault fee"** (`10` §E); the line item *is* the premium price, plainly.

### 3.2 Line-item disclosure rules (acceptance-bearing, apply on every confirm)

- **Always itemized:** rate **and** USD, never only one; never folded into "output" or "net" without its own visible line.
- **Always pre-sign:** the fee (or the 0%) is shown **before** the Sign CTA is reachable; if the exact fee can't be computed yet (quote partial), show **"— (calculated at simulation)"** and keep **Sign disabled** (never a confident wrong number; `09` §4.2; `07` §5.5).
- **Framed for what it is:** swap = *usage fee*; vault = *10% profit-only performance fee, 0% on principal*; premium = *subscription payment*. The ⓘ explainer states non-custody ("the performance fee accrues on-chain as fee-shares to a non-privileged recipient — SparkPoint never holds your funds, never blocks your withdrawal") and scope ("only on realized yield above your high-water mark — never on your principal or a deposit/withdrawal").
- **Net reconciles:** the power-user "Details" shows the fee as its own leg/delta so the math reconciles to the on-chain result (`09` §6 / `06` §3 Details).
- **Consistency:** the rate, framing, and net shown here must match the receipt (§5), the fees page (§4), and the portfolio (§7) exactly.

### 3.3 States (line item)

| State | Treatment | Copy |
|---|---|---|
| **Default — swap, standard fee** | line item with rate + USD, ⓘ; reflected in net | "SparkPoint routing fee · 0.20% · $0.62" |
| **Default — vault, performance fee** | explicit profit-only line, ⓘ | "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal" → ⓘ "Only on yield above your high-water mark; never on your principal." |
| **First-N-free (swap)** | struck rate + $0.00 + remaining count | "~~0.20% ($0.62)~~ · $0.00 — first {n} swaps free ({k} left)" |
| **Loading / quoting** | skeleton on the fee value (never `0`); rest of block may render | "Routing fee · — (calculated at simulation)" |
| **Fee uncomputable (partial sim)** | en-dash + Sign disabled until resolved | "Routing fee · — (shown before you sign)" |
| **Premium payment** | fee row = n/a + the price line | "SparkPoint fee: n/a — subscription payment, not a vault fee" |

> Both breakpoints: desktop = right-rail **Cost & outcome** card (Flow 6 §2.1); mobile = inline **Cost** section above the sticky sign bar (Flow 6 §2.2). The fee line is **never collapsed behind a tap** on mobile.

---

## 4. S2 — The "Fees & how we make money" page (`/fees`)

The plain-language home of the revenue story, for users. It is the public, browsable proof of *"we only earn when you earn."* It **leads with control and 0% on your principal**, never with a number (`07` §9.1, §1.1).

### 4.1 Goal & structure

Answer four questions, in order, plainly: **(1) What stays free? (2) What do we charge today, and why? (3) What's optional (premium)? (4) How is the vault performance fee structured (profit-only, HWM, 0% on principal)?** — each with a "how it's collected" and a "verify it" affordance. Tone = structural-confident, almost legalistic about the mechanism, humble about returns (`07` §1.3 trust/non-custody register).

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
│ │ ✓ 0% on your principal   ✓ The vault fee is profit-only (only on yield)   │  │
│ │ ✓ You see every fee before you sign   ✓ We never hold your funds          │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│ ┌─ WHAT'S FREE ─────────────────┐  ┌─ WHAT WE CHARGE TODAY ────────────────┐  │
│ │ • Your principal — 0% always   │  │ Swap routing fee · 0.20% (0.15–0.30%   │  │
│ │   (deposit & withdraw, 0 fee)  │  │   band) — only when YOU swap           │  │
│ │ • 0% management, 0 entry/exit  │  │ Vault performance fee · 10% of yield   │  │
│ │ • Chat assistant (free tier)   │  │   • Profit-only, above a high-water    │  │
│ │ • Portfolio, withdraw-always   │  │     mark — 0% on your principal        │  │
│ │ • You never need SRK for these │  │   • Configurable on-chain, capped 20%  │  │
│ │                                │  │ [See an example] · [Verify recipient↗] │  │
│ └────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                │
│ ┌─ OPTIONAL: PREMIUM (paid in SRK) ─┐  ┌─ HOW THE PERFORMANCE FEE WORKS ─────┐  │
│ │ Advanced AI features, optional.    │  │ 10% of realized yield, profit-only, │  │
│ │ A subscription PAYMENT — not a     │  │ above a high-water mark. ▸ Active on │  │
│ │ vault fee. Free tier stays full.   │  │ the Aave vault. 0% on your principal│  │
│ │ [Compare free vs premium →]        │  │ — no fee in flat or down periods.   │  │
│ └────────────────────────────────────┘  │ [How the performance fee works]     │  │
│                                          └─────────────────────────────────────┘  │
│                                                                                │
│ ┌── "WE ONLY EARN WHEN YOU EARN" — the honesty chart (Recharts) ───────────┐  │
│ │ Two areas over time: cumulative USER yield  vs  cumulative PROTOCOL        │  │
│ │ revenue. User-yield area dominant; "10% of yield, 0% on principal"         │  │
│ │ annotated. Tabular. (mirrors admin §3.5, user-scoped/own data)            │  │
│ └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│ ┌── VERIFY ─────────────────────────────────────────────────────────────────┐  │
│ │ Vault fee-rate + HWM (read) · Fee-recipient address (mono, explorer↗)       │  │
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
│ ✓ 0% on principal · profit-only│  ← principle checks (never collapsed)
│ ✓ Shown before you sign        │
│ ✓ We never hold your funds     │
├───────────────────────────────┤
│ ▸ What's free            (open)│  ← Accordion, "What's free" open by default
│   principal · chat · withdraw… │
│ ▸ What we charge today         │
│   swap 0.20% · vault perf 10%  │
│ ▸ Optional: Premium (SRK)      │
│ ▸ How the performance fee works│
│   10% of yield · profit-only · │
│   HWM · 0% on your principal   │
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
| **Principle banner** | The four hard rules as checks: "0% on your principal · the vault fee is profit-only (only on yield above your high-water mark) · you see every fee before you sign · we never hold your funds." | `Card` + check rows (`--success` check + text; semantic, not spark) |
| **What's free** | "Your **principal is never touched** — deposit and withdraw with **0% fee on principal**, **0% management**, and no entry/exit fee. The chat assistant's free tier, your portfolio, and withdraw-always are free too. You never need SRK for any of this." | `Card` + list; cross-link to vault + free-vs-premium matrix (`10`) |
| **What we charge today** | "Two fees today. **(1)** When **you** execute a swap, a **0.20% routing fee** (published 0.15–0.30% band), taken **inside your own signed swap** — first {N} swaps free. **(2)** On the Aave Yield Vault, a **10% performance fee on realized yield only** — **profit-only**, above a **high-water mark**, **0% on your principal**, no fee in flat or down periods. The rate is configurable on-chain within a **hard cap of 20%**, timelocked. We never hold your funds." + [See an example] (opens an annotated mock confirm) + [Verify recipient ↗]. | `Card` + ⓘ + example `Dialog`/`Sheet` mirroring the Flow 9 confirm; explorer link |
| **Optional: Premium** | "Premium adds advanced AI features and is **paid in SRK** — it's a **subscription payment, not a vault fee**. The free tier stays fully usable; premium never gates the vault, deposits, yield, or withdrawals." + [Compare free vs premium →] (`/premium`, Flow 10). | `Card`; cross-link only (no price here — `10` owns price) |
| **How the performance fee works** | "The Aave Yield Vault charges a **performance fee — only on profit**, with a **high-water mark** (you're never charged twice on the same gains), and **never on your principal**. It is **10% of realized yield** (configurable on-chain, hard-capped at 20%, timelocked). It accrues on-chain as fee-shares to a non-privileged recipient and **never blocks your withdrawal**." + [How the performance fee works] (opens S4 disclosure in its **active** state). | the **PerformanceFeeDisclosure** component (§6), in **active** state |
| **Honesty chart** | "Here's the value we created for you vs what we earned." Two areas (§4.5). | Recharts (§4.5) |
| **Verify** | "Don't take our word for it." Vault fee-rate + hard cap + HWM reads; fee-recipient address (mono, explorer); "limits live in the contracts, not this app." | mono + explorer `Button`s; cross-link `/trust/permissions` |

### 4.5 The "we only earn when you earn" honesty chart (Recharts)

The user-scoped mirror of the admin panel's user-yield-vs-revenue chart (`admin-panel` §3.5 take-rate framing), built to `04` §6 chart style:

- **Type:** two stacked/overlaid `Area`s over time — **cumulative yield earned *for you*** vs **cumulative fees *you* paid to SparkPoint**. The user-yield area is visually dominant; the fee area is small (and **zero** for a vault-only user). Single honest range (default 1M or All), no flattering window.
- **Color discipline:** user-yield area = the sanctioned spark area treatment (`04` §6.2, "your money, the thing of focus") **or** `--info`; the fee area = a muted neutral — **never** semantic red (a fee is not a loss) and **never** alarm. Tabular values, styled tooltip, `aria-label` summary.
- **Annotations:** "10% of yield, 0% on principal" marker; if the user has paid $0 in fees (no realized yield above the high-water mark yet), the fee area is flat-zero with the label **"You've paid $0 in fees — we only earn when you earn."** (not an empty/broken chart).
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
| **Vault deposit** | **"SparkPoint fee: $0.00 (0% on your principal — nothing taken on deposit)"** | tx hash + explorer; deposit never accrues a fee (`06` §F; `17` SharesPreview) |
| **Vault withdraw / harvest** | **"Performance fee: $X (10% of realized yield, profit-only, above your high-water mark) — $0.00 on your principal"** — or **"$0.00 (no yield above your high-water mark — we only earn when you earn)"** | tx hash + explorer; on-chain fee-share mint event reconciles in Details |
| **Premium payment** | **"Premium subscription: {price} (paid in SRK) — not a vault fee"** | tx hash + explorer (`10` §F) |

### 5.2 Rules

- **Re-state, don't re-compute silently:** the receipt repeats the fee **with the same rate + USD framing** the user saw pre-sign; any difference (e.g., final gas) is shown honestly, but the **SparkPoint fee never exceeds what was disclosed**.
- **Provable:** the fee is reconcilable from the on-chain tx (the receipt links it); for swaps, the fee-leg appears in the power-user Details.
- **0 is stated, not omitted:** a vault action with no fee (deposit, or a withdraw with no yield above the high-water mark) **explicitly** shows "$0.00 (0% on your principal — none deducted)" — never a blank.
- **Honest framing carries through:** swap = "routing fee"; vault = "performance fee (10% of yield, profit-only, 0% on principal)"; premium = "subscription payment." Never relabel post-hoc.

### 5.3 States (receipt fee line)

default (fee paid, shown + tx) · **no-fee** (explicit $0.00 / 0% — deposit, or withdraw with no yield above HWM) · **first-N-free** ($0.00 + struck original) · **subscription** (price, "not a vault fee") · loading (skeleton on the fee value, the rest of the receipt may render) · error (if the receipt can't load the fee detail, show "fee as disclosed pre-sign: $X" + retry, never a fabricated number). Both breakpoints; toast mirror (`Sonner`) carries the headline only ("Swap confirmed · View tx ↗"), not fee detail (`07` §6.4).

---

## 6. S4 — The Performance-Fee Disclosure component (active at launch on the Aave vault)

A **reusable disclosure component** that ships **live at launch** on the Aave Yield Vault, disclosing the **10% profit-only, high-water-mark performance fee — 0% on your principal**, ratified by the §5.2 constitution amendment (v1.1.0) (`revenue-model` §3 Phase 1, §5.2.B). It is the user-facing twin of the admin panel's HWM-status panel (`admin-panel` §3.5 #7) and the same component that disclosure scales to any future opt-in advanced strategy vault.

### 6.1 Purpose & the states

- **Active (the launch state — what ships):** discloses the **live** profit-only fee with its **high-water mark**, the **10% rate** (configurable on-chain, hard-capped at 20%, timelocked), recipient, and **cumulative fees charged** — net-of-everything, on-chain-verifiable. It makes the **0%-on-principal** truth and the **profit-only** mechanism equally legible. **Never a hype teaser**, never a fee on principal. Used on `/fees` and the Trust Center fee panel.
- **Below HWM:** when the share price is at or below the high-water mark, the component reads **"No fee right now — we only earn when you're back in profit."** — the thesis working, never a loss frame.

### 6.2 Anatomy (defer to `07` for wording)

| Part | Active (launch — Aave vault) | Below HWM (recovering) |
|---|---|---|
| **State pill** | **"Active on this vault"** (semantic, calm — not alarm) | **"No fee right now"** (neutral/reassuring) |
| **Headline** | "Performance fee: **10% of realized yield**, profit-only, above your high-water mark — **0% on your principal.**" | "Performance fee — profit-only. **No fee right now: you're below your high-water mark.**" |
| **What it means** | "It's charged **only on profit** — never your principal — and a **high-water mark** means you're never charged twice on the same gains. Never on a deposit or withdrawal, never in a flat or down period." | same explanation + **"we only earn when you're back in profit."** |
| **The mechanism proof** | live **share-price vs HWM** read (`LineChart` + HWM `ReferenceLine`, `admin-panel` §3.5 #7 user-scoped) + "fee accrues above HWM / no fee below" status + **"0% on your principal — always."** | the same chart with share price below the HWM line; "no fee accruing" status |
| **Rate** | "**10% of realized yield** (configurable on-chain, **timelocked, hard-capped at 20%**). 0% management, **0% on principal** — always." | same; the live rate that would apply once back above HWM |
| **Recipient / mechanics** | "Collected on-chain by minting fee-shares to a **non-privileged recipient** — never via custody; the recipient cannot block, delay, or reorder your withdrawal, and **withdraw-always is never impaired**." + live recipient address (mono, explorer) + cumulative fees charged | same mechanics; cumulative fees charged to date |
| **Governance note** | **"Ratified by constitution amendment v1.1.0. The rate is the only mutable parameter — timelocked, hard-capped at 20%, and can never alter custody, withdrawal, or principal semantics."** (`revenue-model` §5.2) | links to the ratified amendment record |
| **APY framing** | the vault's APY is shown **net of the live performance fee**, with breakdown (never bare) (`07` §5.2) | same; APY net of the fee that would apply above HWM |

### 6.3 States

| State | Treatment |
|---|---|
| **Active (default — what ships on the Aave vault)** | Full live disclosure: **10% rate** (timelocked, hard-capped at 20%), HWM read, recipient, cumulative fees, net-of-everything APY; **"0% on your principal" prominent**. Calm/semantic, never alarm. |
| **Below HWM** | "No fee right now — the vault is recovering to your high-water mark. We only earn when you're back in profit." (reinforces the thesis) |
| **Loading** | skeleton on HWM/recipient/cumulative; the explanation renders immediately. |
| **Read error** | "Couldn't load live fee figures — these are enforced on-chain, not by this app. [Retry] · [Verify ↗]"; never blocks withdrawal. |

> **Color rule:** the active state is **calm/semantic**, never red (a profit-only fee is not a danger or a loss) and never spark (it's not AI presence or a CTA). The "below HWM = no fee" state reads as **reassuring** (the thesis working), not as a loss.

### 6.4 Acceptance (S4)

- Ships at launch in an **active** state that discloses the **10% profit-only, HWM performance fee** and **explicitly states "0% on your principal"** on the Aave vault.
- Explains **profit-only + high-water mark + never-on-principal + timelocked-and-hard-capped-at-20% + ratified by amendment v1.1.0** in plain language (`revenue-model` §5.2.B).
- The component is the **same** one that scales to any future opt-in advanced vault — designed once.
- **Never** frames the fee as a charge on principal or custody, in any state; the fee accrues on-chain to a non-privileged recipient and never impairs withdraw-always.

---

## 7. S5 — How fees appear in the portfolio & the Outcome Log

Fees must be legible exactly where the user evaluates performance — **always net, never hidden** — so "honest yield" is structural (`07` §5.2, §5.3; `03`; `05` §8; `08` §C).

### 7.1 Portfolio (`/portfolio`, Flow 3)

- **Net APY on yield-bearing rows** is **net of fees**, with the breakdown ≤1 tap including the **"− 10% SparkPoint performance fee (profit-only, HWM)"** line (`03` §161; `06` §16 NetApyBreakdown). Idle rows use en-dash, never a fake `0%`.
- **PnL is realized, net-of-everything** (`07` §5.3). Any fee paid on an action that produced a position is reflected in its net figures, not bolted on as a surprise.
- **Optional "fees paid to date" read** (position detail or a portfolio summary line): a quiet, tabular **"SparkPoint fees paid: $X to date"** → cross-link `/fees`. Framed neutrally (a record, not a warning); the **vault's contribution is the profit-only performance fee — $0.00 whenever the position has earned no yield above its high-water mark, and 0 on principal always**.
- The **vault position row** carries the profit-only truth (its net APY breakdown shows "− 10% SparkPoint performance fee (profit-only, HWM)" and states **"0% on your principal"**); withdraw on the row is always available, **never** principal-bearing, and never blocked by fee accrual.

### 7.2 Outcome Log (`/activity`, `/activity/[entryId]`, `05` §8 / `08` §C)

- Each entry's **realized PnL is net-of-everything** (`08` §25; `05` §8). The entry detail shows a **fee line** for the originating action: a swap entry shows **"Routing fee: $X"**; a vault deposit shows **"0% on your principal — none deducted"**; a vault withdraw/harvest shows **"Performance fee: $X (10% of realized yield, profit-only) — 0% on principal"** (or **"$0.00 — no yield above your high-water mark"**).
- **Wins and losses are symmetric** (`05` §8.7); the fee line never softens a loss or inflates a win — it's a factual cost line, tied to the same tx the outcome links.
- **Verification:** every entry links its **tx hash(es)**, so the fee is on-chain checkable alongside the outcome.

### 7.3 States (fee-aware portfolio/outcome)

default (net figures + fee line) · **no yield above HWM / $0 fees** ("SparkPoint fees paid: $0.00 — we only earn when you earn" — the reassuring case) · loading (skeleton; never `0`) · stale ("as of {time}") · error (row degrades to "couldn't load value" + retry; **withdraw still works**; never a broken `$0.00`). Both breakpoints (desktop table rows / mobile cards, `03` / `08`).

---

## 8. Microcopy (defer to `07`; fee-transparency-specific strings)

All strings below are illustrative compositions of `07` rules; **`07` wins on any conflict.** Reuse the **verbatim** motifs.

**Verbatim (reuse exactly):**
- The thesis: **"We only earn when you earn — never on your principal, never by taking custody."** (`revenue-model` one-liner)
- **"SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal"** (vault) and the APY breakdown **"{X}% net APY = {Y}% Aave supply rate − 10% SparkPoint performance fee (profit-only, HWM)."** (`07` §5.2)
- **"Estimates, not guarantees."** on any yield-referencing line (`07` §3.3).
- Swap fee line + ⓘ explainer = **`09` §4.1** (do not paraphrase).

**Fees page (`/fees`):**
- Lede: "We only earn when you earn — never on your principal, never by taking custody. Here's exactly what we charge, when, and why."
- Free section: "Your **principal is never touched** — 0% on principal, 0% management, no entry/exit fee, on deposit and withdrawal. The free assistant, your portfolio, and withdraw-always are free too. You never need SRK for any of this."
- The fees today: "Two fees. When **you** execute a swap, a **0.20% routing fee** (published 0.15–0.30% band), taken **inside your own signed swap**. And on the Aave Yield Vault, a **10% performance fee on realized yield only** — profit-only, above a high-water mark, **0% on your principal**, no fee in flat or down periods. We never hold your funds. Your first {N} swaps are free."
- Premium: "Premium is **optional** and **paid in SRK** — a **subscription payment, not a vault fee**. The free tier stays fully usable."
- Performance fee: "On the Aave Yield Vault we charge a **performance fee — only on profit, with a high-water mark, and never on your principal.** It's **10% of realized yield** (configurable on-chain, **timelocked and hard-capped at 20%**), ratified by constitution amendment v1.1.0. It accrues on-chain and never blocks your withdrawal."
- Verify: "Don't take our word for it — these fees live in the contracts, not this app. [See the fee-recipient ↗] · [See permissions →]"

**Receipts:**
- Swap: "Routing fee paid: $X (0.20%)." / "Routing fee: $0.00 — first {n} swaps free."
- Vault deposit: "SparkPoint fee: $0.00 (0% on your principal — none deducted)."
- Vault withdraw/harvest: "Performance fee: $X (10% of realized yield, profit-only, above your high-water mark) — $0.00 on your principal." / "$0.00 — no yield above your high-water mark."
- Premium: "Premium subscription: {price} (paid in SRK) — not a vault fee."

**Performance-fee disclosure (active state):**
- "Performance fee: **10% of realized yield**, profit-only, with a high-water mark. **0% on your principal.** Active on the Aave Yield Vault."
- "We charge only on profit, never your principal, and a high-water mark means you're never charged twice on the same gains. The rate is timelocked and hard-capped at 20%."

**Banned here (carry `07` §9.3):** no "low fees!/save money/cheapest"; no bare APY; no return-led line to sell a fee; no "small fee" minimizing language that hides the 10% rate; never call the swap fee, the performance fee, or premium a fee "on your principal/custody" (the performance fee is on **realized yield only**); never hide or bury the performance fee's rate or its profit-only/HWM mechanism.

---

## 9. Non-custody, fee-transparency & trust touchpoints (this flow)

- **Net-of-everything, pre-sign, always (`revenue-model` rule 4; `07` §5.2):** every fee itemized (rate + USD) before signing; every APY net with a "− 10% SparkPoint performance fee (profit-only, HWM)" breakdown; no hidden or folded fees anywhere.
- **0% on principal is shown, not assumed (`06` §9; `revenue-model` §3):** "0% on your principal" and the profit-only performance-fee line ("10% of yield, HWM") are explicit on confirms, receipts, the fees page, and the perf-fee disclosure.
- **Usage/optional/performance fees honestly labeled (`revenue-model` rule 2):** swap = usage fee; premium = subscription payment; vault = profit-only performance fee on realized yield only; none is a fee on principal or custody, and the copy says so.
- **Non-custodial by construction (`revenue-model` rule 3):** swap fee taken inside the user's signed swap; premium a user-signed pay-with-SRK; the performance fee accrues on-chain as fee-shares to a non-privileged recipient (no admin/withdraw authority) and **fails open** — **withdraw-always is never impaired by any fee**, stated wherever a fee appears.
- **Provable (`05` §0.1):** fee-recipient address + explorer links on `/fees` and receipts; the vault fee-rate, hard cap, and HWM are readable on-chain; "limits live in the contracts, not this app."
- **The performance fee is governed, not arbitrary (`revenue-model` §5.2):** the disclosure is live at launch (amendment v1.1.0); the rate is the only mutable parameter — timelocked, hard-capped at 20%, and can never alter custody/withdrawal/principal semantics — never a hype teaser, never minimized.
- **We only earn when you earn (the honesty chart):** user yield vs protocol revenue shown side-by-side, historical only, never red, never projected on the user surface.
- **Withdraw/exit ≤1 tap (`05` §0.2):** present on `/fees` and every fee surface; no fee surface or its error state hides the escape hatch.

---

## 10. shadcn/ui mapping (this flow)

| Fee element | shadcn/ui primitive(s) / component |
|---|---|
| Fee line item (confirm Cost & outcome) | `Card` + `Tooltip`/`Popover` (ⓘ usage-fee explainer) — inside ConfirmationCard (`06` §9) |
| Swap fee rendering (authoritative) | per **Flow 9 §4** (line + first-N-free `Badge`/strike + ⓘ) |
| Vault performance-fee line | text + `Tooltip` ("10% of yield, profit-only, HWM — 0% on your principal") |
| `/fees` page shell | standard AppShell content slot + `(public)/fees` mirror |
| Principle banner (4 hard rules) | `Card` + check rows (`--success` icon + text) |
| Free / one-fee / optional / later sections | `Card`s (desktop) · `Accordion` (mobile) |
| "See an example" annotated confirm | `Dialog` (desktop) / `Sheet` (mobile) mirroring the Flow 9 confirm |
| Honesty chart (user yield vs revenue) | Recharts overlaid/stacked `Area`s + styled tooltip + range `ToggleGroup` (`04` §6) |
| Verify block (addresses) | mono text + copy `Button` + explorer-link `Button`; cross-link `/trust/permissions` |
| Performance-fee disclosure (S4) | dedicated **PerformanceFeeDisclosure** = `Card` + state `Badge` (semantic "Active on this vault") + `Accordion` + Recharts `LineChart` + `ReferenceLine` (HWM) |
| Receipt fee line | within ConfirmationCard receipt (`06` §F) + Outcome Log entry (`08` §C) |
| Net APY breakdown (incl. "− 10% performance fee, profit-only") | **NetApyBreakdown** (`06` §16) |
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
| **Net-of-fees figure with a breakdown; never bare APY** | **Yearn / Beefy / Morpho (★★/★★★)** `09` §3 | Every APY shows "− 10% SparkPoint performance fee (profit-only, HWM)"; net-of-everything portfolio/outcome PnL; the fees page proves the math. |
| **Profit-only performance fee + high-water mark, on-chain, itemized** | **Yearn v3 / Beefy / Morpho curators; Numerai HWM** `09` §3 / `revenue-model` §2 | The PerformanceFeeDisclosure (S4) — profit-only, HWM, non-privileged recipient, **active at launch** (10%, hard-capped 20%). |
| **Pre-trade fee shown in the simulation, before signing** | **Tenderly (★★★)** `09` §5 | The fee line in Cost & outcome, pre-sign, reconciled in Details (via Flow 6 / Flow 9). |
| **Restraint as a feature (modest take-rate, shown honestly)** | **Gauntlet / Steakhouse "race to 0%" read** `revenue-model` §6 | 0% on principal + profit-only fee as the wedge; the performance fee is profit-only, hard-capped at 20%, and the honesty chart shows revenue ≪ user yield. |
| **Status, not slogans; two truthful columns; verify-on-chain** | **Ledger / Trust Wallet + Morpho/Gauntlet transparency** `05` §0, §3.6 | The fees page leads with what's free + 0% on principal, grounds every claim in chain reads, and links the recipient/permissions. |

---

## 12. Acceptance criteria (Flow 11 — Fee Transparency / Revenue Surfaces)

A design satisfies this flow doc when **all** hold:

1. **Both breakpoints, full-fidelity.** Every surface (S1–S5) is designed at **1440px desktop** and **390px mobile**, with the `/fees` page leading **free-first** and the **principle checks never collapsed**; Dialog→Sheet on mobile.
2. **All states designed.** For each surface: default · loading · empty/pre-activity ("paid $0") · stale · read-error ("enforced on-chain, not this app") · degraded — plus the swap fee's first-N-free state and the perf-fee disclosure's active vs below-HWM states. Copy from `07`.
3. **The fee line item is honest and pre-sign (S1).** Every confirm shows a SparkPoint-fee line — **swap routing fee (rate + USD, ⓘ usage-fee framing)** per **Flow 9 §4**, or **"SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal"** on the vault — **before Sign is reachable**; uncomputable → "— (calculated at simulation)" + Sign disabled; net reconciles in Details; **never folded or hidden**.
4. **The `/fees` page answers the four questions plainly (S2).** What's free → what we charge today (swap + vault performance fee) → optional premium → how the performance fee works, each with "how it's collected" + a verify affordance; **leads with control + 0% on principal, never with a number**; carries the **honesty chart** (historical only, user-yield-dominant, fee area never red, no projections); has a **public mirror** with no account data.
5. **Receipts re-state the fee provably (S3).** Each success/Outcome-Log entry shows the fee paid with the **same framing** as pre-sign (swap "Routing fee: $X" / vault deposit "$0.00 — 0% on principal" / vault withdraw "Performance fee: $X — 10% of yield, 0% on principal" / premium "subscription payment"); the **SparkPoint fee never exceeds what was disclosed**; tx-linked and reconcilable; **0 is stated, not omitted**.
6. **Performance-fee disclosure ships active and discloses the rate (S4).** It renders at launch as **"Active on this vault,"** explains **profit-only + high-water mark + never-on-principal + 10% rate (timelocked, hard-capped at 20%) + ratified by amendment v1.1.0**, **explicitly states "0% on your principal,"** reads "no fee right now" below the HWM, and is the **same** component that scales to future opt-in advanced vaults.
7. **Fees are net-of-everything in portfolio & outcomes (S5).** Net APY carries "− 10% SparkPoint performance fee (profit-only, HWM)"; PnL is realized net-of-everything; an optional "fees paid to date" reads ($0.00 whenever no yield above the HWM, 0 on principal always); Outcome Log entries carry a tx-linked fee line; wins/losses symmetric; idle rows en-dash not fake `0%`.
8. **Labels are honest (no mislabeling).** Swap = **usage fee**; premium = **subscription payment**; vault = **profit-only performance fee (10% of realized yield, HWM, 0% on principal)**. No fee is ever framed as a charge on principal or custody; the performance fee's rate and profit-only/HWM mechanism are never hidden or minimized.
9. **Non-custodial & provable everywhere.** Every fee surface states/keeps **withdraw-always unimpaired** (fee accrual fails open); on-chain fees terminate in tx + explorer; the fees page links the **fee-recipient** and the **vault fee-rate / hard cap / HWM reads** and cross-links permissions; read failures never hide the page or the escape hatch.
10. **Net-of-everything honesty, no hype.** No bare APY, no return-led framing to sell a fee, no "low fees!" minimizing, no hiding the 10% rate, no projected revenue/yield on user surfaces; the thesis **"we only earn when you earn — never on your principal, never by taking custody"** is verbatim and structurally demonstrated, not merely claimed.
11. **Consistency across surfaces.** The same fee reads identically (rate, framing, net) on the line item, receipt, fees page, and portfolio; a discrepancy pre- vs post-sign is a defect.
12. **Maps to shadcn + accessible (`04` §10).** Every element resolves to the §10 map; fee figures **tabular**; mono for addresses; **never color-only** (the 0% and any fee carry text + icon, the fee area in the chart is neutral not red); visible 2px spark focus ring; keyboard-operable; reduced-motion honored; AA contrast both themes.

---

## 13. Cross-references

- **What we charge and why (authoritative):** `docs/revenue-model/README.md` — the one-liner + four hard rules; **Stream 0A** (swap fee, 20 bps, first-N-free, §3 Phase 0); **Stream 0B** (premium, freemium, SRK); **Stream 1A / 1A-Launch** (profit-only HWM performance fee, **active at launch**, 10%, hard-capped 20%, §3 Phase 1 / §5.2.B amendment v1.1.0); the **0%-on-principal / 0-management launch vault** (Principle V).
- **The confirm surface the fee line lives in:** `02-flows/06-execution-confirmation-simulation.md` (§3 Cost & outcome; §F receipt) — authoritative for the sign gate.
- **The swap fee's in-confirm rendering (authoritative):** `02-flows/09-ai-swap.md` (§4 — line item, first-N-free states, ⓘ explainer, fee-leg in Details).
- **The premium price & pay-with-SRK:** `02-flows/10-subscriptions-premium-srk.md` (§D pay, §E sign, §F receipt — authoritative for price/pay; this doc only distinguishes a subscription **payment** from a fee).
- **The Trust Center fee panel + provable-not-promised + Outcome Log fees surface into:** `05-trust-and-safety-ux.md` (§0, §3.6, §8).
- **Net-of-fee APY / portfolio / outcome rendering:** `02-flows/03-portfolio.md` (§161 net APY, breakdown); `02-flows/08-srk-literacy-outcomes-settings.md` (§C Outcome Log, net-of-everything).
- **NetApyBreakdown / SimulationBalanceChangeTable / ConfirmationCard / AlertBanner / TipCard / EmptyState:** `06-component-library.md` (§16, §23, §9, §25, §11, §24).
- **Tokens, the three color systems, tabular numerals, mono, data-viz, a11y, component→shadcn map:** `04-design-system.md` (§2, §3, §6, §10, §11).
- **All canonical wording — APY net + the 10% profit-only performance fee (0% on principal), currency, banned/required phrases, success/error patterns, trust motifs:** `07-content-and-tone.md` (§5.1, §5.2, §5.3, §2.1, §3, §9) — **wins on any conflict.**
- **The internal mirror (revenue dashboard):** `docs/admin-panel/README.md` (§3.5 — revenue by stream, user-yield-vs-revenue take-rate, HWM-status, realized-vs-projected solid/dashed). This user-facing flow is the public, account-scoped, projection-free counterpart.
- **Benchmark links (Yearn/Beefy/Morpho/Gauntlet net-of-fees; Tenderly preview; Ledger/Trust Wallet transparency):** `09-references.md` (§3, §5).
- **Requirements traced:** the swap-fee FR + disclosure (revenue-model §5.2.0); FR-017/018 (the launch vault: 0% on principal, 0 management, profit-only performance fee; amendment §5.2.B / v1.1.0); FR-039–041 (Outcome Log linkage, net-of-everything); the honest-yield / net-of-everything principle (Constitution III); the non-custody invariants N1–N5 (every fee mechanism preserves them, fee accrual fails open, withdraw-always never impaired).
