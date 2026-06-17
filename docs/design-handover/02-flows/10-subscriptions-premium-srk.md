# 02 · Flow 10 — Subscriptions & the Premium AI Tier (freemium, paid in SRK)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-level spec for **Flow 10 (Subscriptions / Premium AI tier)** — the freemium model where the **free tier is fully capable** and an **optional premium tier is paid in SRK** (the token's concrete launch utility). W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **What this surface IS:** the product home for SparkPoint's freemium subscription — a **free-vs-premium feature matrix** (`/premium`); **non-nagging upsell entry points** that appear only when a premium-only feature is actually touched; the **upgrade flow**; the **pay-with-SRK screen** (SRK balance, plan price in SRK + USD equivalent, the user-signed `approve` + `pay` transaction, non-custodial, with an optional stablecoin fallback flagged); **subscription confirmation**; **manage subscription** (plan, renewal date, usage, cancel/downgrade — cancel always one tap away, no dark patterns); an **"acquire SRK" hand-off**; and the **empty/free-tier**, **lapsed/expired**, and **degraded** states. Premium **only ever adds** advanced AI capability; it **never gates the vault, deposits, yield, or withdrawals**, and **SRK stays non-essential** to every core/custody function.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — guardrails + you dispose"), five non-custody guarantees, tone, non-goals; **SRK is non-essential** and the free tier must stand on its own.
> - `revenue-model/README.md` — **Stream 0B (Premium AI tier — FREEMIUM, premium paid in SRK)** §3 Phase 0 and the §5.1 compliance matrix row: free tier fully usable with **no SRK**; premium **paid in SRK** via a **user-signed, non-custodial** tx (optional **stablecoin fallback** if SRK not yet live); **premium NEVER gates the vault or withdrawals; SRK stays non-essential**. Also the guiding line — **"we only earn when you earn, never on your principal, never by taking custody"** — and the §7 risk row "Premium AI tier creeps into 'essential'" (the anti-requirement this flow must satisfy).
> - `01-information-architecture.md` — §2 the persistent shell (non-custodial badge + AI disclaimer strip with [Prove it]/[Exit anytime]); the **single-confirm-funnel** rule §0.3/§4.2.3 (the pay-with-SRK `approve`+`pay` is a state-changing action and **routes through `/confirm`**); **§4 note 8 "SRK is a dead-end branch by design"** + §4.4/§307/§418 "SRK isolation, low-prominence" — this flow **reconciles** with that (see §0.9); per-route `loading.tsx`/`error.tsx` requirements; §6 gating/degraded (none remove the withdraw path).
> - `04-design-system.md` — tokens; **spark = AI presence / the one primary CTA per view** (§2.3, §11); **strict semantics** (green/red/amber; never the spark hue, §2.4); **`--info` (blue) for literacy/optional framing, never green** (§2.4); **risk palette §2.5** (advanced strategy vaults shown by tier); **tabular numerals** §3.1/§3.4 for SRK amounts/prices/USD; **mono** for addresses/hashes (§3.1); motion §7 (success check, never confetti); a11y §10; component→shadcn map §11 (esp. the SRK-utility row, Settings, Card/Tabs/Badge, Table).
> - `05-trust-and-safety-ux.md` — the **"AI suggestion — you approve & sign"** labeling system (§5) for the pay tx; the **friction/acknowledge model** (§7) the `/confirm` pay routes through; §0.2 "≤1 tap to prove-it + withdraw-always" (premium must never push these away); §0.8 color discipline (premium-gating is `--info`/neutral, **never a red alarm**).
> - `06-component-library.md` — composes **AppShell/Nav** (§1), **NonCustodialBadge/ProveItPanel** (§2–3), **WalletConnectButton** (§4), **ConfirmationCard** (§9, the pay-with-SRK sign gate), **SimulationBalanceChangeTable** (§23, the SRK debit preview), **RiskChip** (§15, advanced-vault tiers), **CapsMeter** (§14, usage/limits), **AlertBanner** (§25, lapsed/degraded/non-essential callouts), **EmptyState** (§24, free-tier), **TipCard** (§11, "what's premium?").
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Voice (§1: confident-process/humble-outcome, never hypey, no urgency/FOMO — §9.3 bans), button verbs (§2.2), the confirmation/sign copy pattern (§2.4), success pattern (§2.5), error/empty/warning copy (§6), number/SRK/USD formatting (§5), the **"Grant scoped access" names-the-scope** discipline (we name what premium does), and the banned register (no "unlock now", no countdowns, no "best/#1").
> - `02-flows/06-execution-confirmation-simulation.md` — **Flow 6 is authoritative for the sign gate.** The pay-with-SRK `approve`+`pay` is **one more entry point into `/confirm`** (§1.2 entry table) and a **bundled** (approve → pay) action (§3-bis); this doc specs only the *subscription-specific* payload and copy, never a second sign UI.
> - `09-references.md` — §"Premium AI subscription" benchmarks: **Hey Anon "Pass"** (~queries/day), **Griffain "energy"**, **Almanak compute-margin** (charge for the AI interface, not a cut of AUM); §8 out-position token-subsidy theater (no SRK price hype).
>
> **What this doc is NOT:** the non-essential **`/srk` informational page** (`08` §A — that page stays low-prominence, no-price, no-buy; this flow's pay/acquire surfaces are **premium-scoped** and do not change `/srk`'s character — see §0.9); the **sign-gate internals** (`06` Flow 6 / `/confirm` — this routes into it); visual tokens (`04`); canonical strings (`07`); the route map/shell (`01`); the **advanced strategy vaults themselves** (their own future Flow — premium only *unlocks access* to them when live; it never changes their custody or 0-fee-principal semantics); legal/Terms copy. It also does **not** authorize a fee — it visualizes Stream 0B exactly as the revenue model defines it.

---

## 0. The subscription thesis (constraints on every screen in this flow)

This flow is the one place in the product where the user is asked to **pay** — and so it is, paradoxically, a **trust** surface as much as a commerce one. The discredited "AI fund" cohort we out-position (`09` §8) made tokens *essential* and dressed paywalls as features. We do the opposite: the **free tier is genuinely, fully capable** (it includes the vault, swaps, the assistant, and withdraw-always), and premium is an **honest, optional, cancel-anytime** upgrade for advanced AI capability, **paid in SRK** to give the token a real, concrete utility — without ever making SRK essential. Constraints binding every screen:

1. **The free tier is fully capable — say so, everywhere (`revenue-model` §3 Stream 0B; `07` §1.1).** Every screen in this flow carries, in plain language, the load-bearing truth: **"The free tier is fully capable. Premium is optional."** Custody functions (deposit, earn yield, withdraw), the chat assistant, portfolio read, basic recommendations, and swaps are **free and need no SRK**. Premium **only adds** advanced AI capability.
2. **Premium NEVER gates the vault, deposits, yield, or withdrawals (`revenue-model` §5.1; SC-013; N2).** This is a hard anti-requirement. No premium-only feature, no lapsed/expired state, no failed payment, and no degraded billing service may **block, delay, or hide** the vault, a deposit, accrued yield, or — above all — the **withdraw-always** path. If any state in this flow could be misread as gating custody, it is wrong.
3. **SRK stays non-essential (`01` §4 note 8; `08` §A; FR-045/046).** SRK is the **premium-payment rail**, not a gate on anything core. A user who never touches SRK has the full core product. The pay-with-SRK and acquire-SRK surfaces are **premium-scoped** and reconcile with the deliberately non-hypey `/srk` page (see §0.9) — they add a *real utility* without making SRK *required*.
4. **The payment is user-signed and non-custodial (`05` §5; `revenue-model` §3 Stream 0B).** Premium is settled by a **user-signed `approve` + `pay` transaction** that routes through the **single confirm funnel** (`/confirm`, Flow 6). SparkPoint never holds, pulls, or auto-charges from a balance it controls — there is **no custodial wallet, no stored card, no silent recurring pull**. Renewal is an **explicit, user-initiated re-sign** (or an opt-in, scoped, revocable auto-renew allowance — see §5/§7), never a hidden mandate.
5. **No dark patterns — cancel is always one tap, no nagging (`07` §1.4, §9.3; brief tone).** Cancel/downgrade is reachable **directly from the manage screen**, never buried, never gated behind a retention maze, a "are you sure you want to lose…" guilt wall, or a support contact. Upsells are **non-nagging**: they appear **only when a premium-only feature is actually touched**, are **dismissable**, and **never re-nag** after dismissal for that feature (mirrors the `TipCard` "dismiss persists" rule, `06` §11). No countdowns, no FOMO, no "limited time," no exclamation marks on prices (§9.3 bans).
6. **Honest pricing, shown in SRK and USD-equivalent (`07` §5; `revenue-model` §4.0).** The plan price is shown as the **SRK amount** (the thing actually paid) **with a clearly-labeled USD equivalent** ("≈ $X at the current SRK price"). Because premium is paid in SRK, **SRK price volatility flows through** — this is disclosed plainly ("the SRK amount is fixed for this term; the USD value moves with SRK"). No price hype, no token-APY theater, no "buy now to save" urgency.
7. **The optional stablecoin fallback is a flag, not a second product (`revenue-model` §3 Stream 0B sequencing note).** If SRK is **not yet live** at launch, premium may be paid via an **optional stablecoin fallback** (USDC) so the freemium model still earns; once SRK is live, the rail **flips to SRK**. The UI treats this as a **payment-method flag** on the same screens, clearly labeled, and never implies SRK is required when the fallback is active.
8. **Provable + reconcilable (`revenue-model` §4; `admin-panel` §3.5).** An on-chain SRK payment terminates in a **tx hash + explorer link**; the subscription record (plan, term, renewal date) is shown honestly on the manage screen. This is the user-facing side of the premium revenue stream the admin revenue dashboard reconciles (the admin panel reads it via Stripe-or-equivalent for fiat / on-chain events for SRK — not this flow's concern, but the receipt must be real).
9. **Reconciliation with the non-essential `/srk` page (`08` §A; `01` §4 note 8).** `08`'s `/srk` page is **informational, low-prominence, no-price, no-buy** — and it **stays that way**. This flow does **not** turn `/srk` into a market. Instead: the **pay-with-SRK** and **acquire-SRK** surfaces live in the **premium/subscription branch** (`/premium/*`), are reached **only** by a user who has *chosen* to upgrade, and are **scoped to the premium payment**. `/srk` gains at most one quiet, factual cross-link ("SRK can pay for the optional premium tier — see Premium") that does not contradict its "you never need SRK" callout. The two surfaces agree: **SRK is optional; if you want premium, SRK is how you pay; you never need either.**

---

## 1. Goal & entry points

### 1.1 Goal

Let a user who *wants* more from the AI **understand exactly what premium adds, decide freely, pay in SRK non-custodially, and manage or cancel without friction** — while a user who *doesn't* want premium **never feels nagged, blocked, or that the free product is crippled**. The flow must make a newcomer feel the free tier is *complete* (not a trial), let an interested user *compare and upgrade* in a few clear steps, and let any subscriber *cancel in one tap*.

The one-sentence job: **turn an optional, SRK-paid premium tier into an honest, user-signed, cancel-anytime upgrade — that never makes SRK or premium essential to the vault or withdrawals.**

### 1.2 Entry points (non-nagging by construction)

Premium is reached **only** from places where the user has shown intent or is browsing deliberately — never via interstitials, never via a modal on app open, never via the core flows' primary paths.

| From | Trigger | Behavior / notes |
|---|---|---|
| **Secondary nav → "Premium"** | Deliberate navigation (left rail desktop / More drawer mobile) | The canonical, low-prominence entry to the **feature matrix** (`/premium`). Sits *near* SRK/Settings, not in primary nav. |
| **Settings → "Subscription"** | `/settings` → "Subscription" row | Routes to **manage** (`/premium/manage`) if subscribed, else the **matrix** (`/premium`). |
| **Upsell moment in chat** (`02`) | User asks for a **premium-only** capability (e.g. "rebalance me automatically every day at higher caps", "run a deeper weekly strategy analysis", "give me market-neutral vault access") | The assistant answers what it *can* do on free, then surfaces a **dismissable inline upsell** (a `TipCard`-style `Card`, `--info`/spark-subtle, **not** an alarm): "That's a premium feature. Here's what it adds — [See premium]." **Never blocks the chat; never re-nags** for that feature after dismiss. |
| **Premium-only control touched** (portfolio/strategies) | User taps a control that is premium-gated (e.g. an "advanced analytics" tab, an "auto-rebalance (scoped, higher caps)" toggle, a locked advanced strategy vault `RiskChip`) | The control shows a quiet **"Premium" `Badge`** (info-tinted, **never** a red lock-alarm) + a one-line "what this adds" + **[See premium]**. The free equivalent (if any) stays fully usable beside it. |
| **`⌘K`** | "Premium" / "Upgrade" / "Manage subscription" | Direct to matrix or manage. |
| **`/srk` page** (`08` §A) | One quiet factual cross-link only | "SRK can pay for the optional premium tier — see Premium." Does **not** add price/buy to `/srk` (§0.9). |
| **Notifications** | renewal-due / payment-confirmed / lapsed | Links to manage/confirmation; **renewal-due is a reminder, never a threat** ("Your premium term ends {date}. Renew anytime — or let it lapse; your free tier and vault are unaffected."). |

> **No core flow *requires* this surface (`01` §4 note 8 extended).** Deposit, withdraw, swap, the assistant's core help, and onboarding never route *through* premium. A premium-only branch is always an **additive** offshoot with a free path intact.

### 1.3 Pre-conditions

- **Wallet connected + Base** is needed to **pay** (the pay tx is on Base), but **not** to browse the matrix or read about premium — the matrix is viewable disconnected (with a "Connect wallet to upgrade" prompt at the pay step).
- **SRK live?** If SRK is live → pay in SRK (default rail). If SRK is **not yet live** → the **stablecoin fallback** flag is active and the pay screen collects USDC instead, clearly labeled (§4.6, §0.7).
- **Existing subscription?** Resolved at entry: subscribed → manage; lapsed → reactivate; never-subscribed → matrix.

---

## 2. Layout — desktop vs mobile

Both breakpoints first-class (`00` §4; `04` §4.2). All subscription surfaces render inside the **standard authenticated shell** (`06` §1) — the **non-custodial badge → prove-it** and the **AI disclaimer strip with [Prove it]/[Exit anytime]** are present on every screen here (a hard IA invariant), so even mid-upgrade the user is one tap from proof and exit. The **pay step** hands off to the **focused `/confirm` shell** (Flow 6).

### 2.1 Desktop (`/premium`, 1440px) — the feature matrix

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SHELL: [logo] Chat·Portfolio·Vault·Strategies   ● Non-custodial ▸ · 0x12…ab ▸ │
│ AI DISCLAIMER STRIP — "AI suggestion — you approve & sign… [Prove it][Exit]"   │
├──────────────────────────────────────────────────────────────────────────────┤
│ NAV  │  H1 "Premium AI"   · eyebrow badge "Optional — the free tier is fully   │
│ RAIL │   capable"                                                              │
│ (01) │  subhead "Premium adds advanced AI features. It never touches your      │
│      │   vault, your deposits, or your right to withdraw. Paid in SRK."        │
│      │                                                                         │
│      │ ┌─ PLAN TOGGLE ───────────────────────────────────────────────────┐    │
│      │ │  [ Monthly ]  [ Annual · save ~2 months ]   (segmented)          │    │
│      │ └──────────────────────────────────────────────────────────────────┘   │
│      │ ┌─ FREE (you're here) ──────────┐  ┌─ PREMIUM (optional) ──────────┐    │
│      │ │ $0 · always                   │  │ {N} SRK / mo  ≈ $X  ⓘ          │    │
│      │ │ ✓ Chat assistant              │  │ Everything in Free, plus:     │    │
│      │ │ ✓ Portfolio read              │  │ ✓ Deeper, more-frequent       │    │
│      │ │ ✓ Basic recommendations       │  │   strategy analysis           │    │
│      │ │ ✓ Aave Yield Vault            │  │ ✓ Advanced strategy vaults    │    │
│      │ │   (deposit · earn · withdraw) │  │   (when live) [risk-tiered]   │    │
│      │ │ ✓ Swaps                       │  │ ✓ Higher limits & priority    │    │
│      │ │ ✓ Withdraw anytime            │  │ ✓ Advanced analytics & alerts │    │
│      │ │ ✓ Non-custodial · no SRK      │  │ ✓ Scoped auto-rebalance,      │    │
│      │ │                               │  │   higher caps                 │    │
│      │ │ [ You're on Free ] (disabled) │  │ [ Upgrade to premium ] (spark)│    │
│      │ └───────────────────────────────┘  └───────────────────────────────┘    │
│      │ ℹ "The free tier is fully capable. Premium is optional and never gates   │
│      │    your vault, deposits, or withdrawals." (persistent info callout)     │
│      │ ▸ "What counts as a premium feature?" (Accordion · honest, no FOMO)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Two side-by-side plan `Card`s** (Free / Premium). **Free is presented as a complete product the user already has**, not a stripped trial — its column is *full of checks*, labeled "You're on Free", and the Premium column reads **"Everything in Free, plus:"** so premium is visibly *additive*. One **spark** CTA on the surface: **"Upgrade to premium"** (the only primary; `04` §2.3). Free's button is a disabled/neutral "You're on Free".
- **Plan toggle** (Monthly / Annual) as a segmented `ToggleGroup`; annual shows a plain savings line ("save ~2 months" — factual, no "BEST VALUE!" hype).
- **Persistent `--info` callout** (the trust payload): "The free tier is fully capable. Premium is optional and never gates your vault, deposits, or withdrawals."
- **Price** shows **SRK amount + USD-equivalent** with an ⓘ explaining the SRK/USD relationship (§0.6). If the **stablecoin fallback** is active, the price reads in USDC with a "paid in USDC (SRK fallback)" note.

### 2.2 Mobile (390px) — stacked matrix, sticky upgrade bar

```
┌───────────────────────────────┐  ┌───────────────────────────────┐  ┌───────────────────────────────┐
│ ● Non-custodial ▸ · Base · ⌘  │  │ (pay-with-SRK)                │  │ (manage)                      │
│ AI suggest—approve&sign ▾     │  │ ◦ Premium · Monthly           │  │ Premium · Annual              │
├───────────────────────────────┤  │ Plan price  {N} SRK ≈ $X      │  │ Renews {date}  ·  Auto-renew  │
│ Premium AI                    │  │ Your SRK    {bal} SRK ≈ $Y    │  │   [ off ▸ ]                   │
│ "Optional — free is fully     │  │  ├ enough? ✓ / ⚠ not enough → │  │ Usage this period             │
│  capable"                     │  │  │  [Get SRK]                 │  │  ▰▰▰▱▱  deeper analyses 3/5   │
├───────────────────────────────┤  │ Pay method  ● SRK ○ USDC(flag)│  ├───────────────────────────────┤
│ FREE — $0 · always            │  │ You'll sign: ① approve {N} SRK│  │ [ Cancel premium ]  (always)  │
│ ✓ Assistant ✓ Portfolio       │  │             ② pay {N} SRK     │  │ [ Switch to monthly ]         │
│ ✓ Vault ✓ Swaps ✓ Withdraw    │  │ "Non-custodial. Nothing moves │  │ ℹ "Cancelling keeps your free │
│ ✓ Non-custodial · no SRK      │  │  until you sign. SRK never    │  │  tier and vault fully intact. │
├───────────────────────────────┤  │  required for the vault."     │  │  No questions, no penalty."   │
│ PREMIUM — {N} SRK/mo ≈ $X     │  ├───────────────────────────────┤  └───────────────────────────────┘
│ Everything in free, plus:     │  │ ▟ sticky: [Review & sign] →   │
│ ✓ Deeper analysis             │  │   routes to /confirm (Flow 6) │   Sections collapse to Accordions
│ ✓ Advanced vaults (when live) │  └───────────────────────────────┘   where dense. The non-essential
│ ✓ Higher limits ✓ Analytics   │                                      info callout is NEVER collapsed.
│ ✓ Scoped auto-rebalance       │
├───────────────────────────────┤
│ ℹ free is fully capable;      │
│   premium never gates vault   │
├───────────────────────────────┤
│ ▟ sticky: [Upgrade to premium]│
└───────────────────────────────┘
```

- **Single column, stacked**: Free card → Premium card → persistent info callout → "what's premium?" `Accordion`. **Sticky bottom bar** holds the single spark **"Upgrade to premium"** CTA (thumb zone, `04` §4.3).
- Overlays (plan details, "what's premium", get-SRK) are bottom **`Sheet`s** (`04` §4.2 transform).
- The **info callout is never collapsed** — the "free is fully capable / premium never gates the vault" message must always be visible.

### 2.3 Responsive transform rules (carry everywhere)

| Desktop | → Mobile |
|---|---|
| Two-column Free / Premium matrix | Stacked Free → Premium cards (Free first, so "you already have a full product" reads first) |
| Upgrade CTA in Premium card | Sticky bottom-bar spark CTA |
| Plan toggle inline segmented | Same, full-width segmented above cards |
| Pay screen two-column (plan ⟷ balance) | Stacked: plan price → SRK balance → method → sign summary → sticky [Review & sign] |
| "What's premium" / "Get SRK" inline-expand | `Sheet` / `Accordion` |
| Manage as a settings sub-page table | Stacked cards; cancel as a full-width, always-visible button |
| Hover affordances (price ⓘ, savings tip) | Always-visible ≥44px tap targets |
| Info "free is fully capable" callout as a card | Full-width, never collapsed |

---

## 3. Step-by-step screens & states

The flow's surfaces, in order: **(A) Feature matrix → (B) Upsell entry (inline) → (C) Plan select / upgrade → (D) Pay-with-SRK → (E) `/confirm` sign (Flow 6) → (F) Subscription confirmation → (G) Manage → (H) Cancel/downgrade → (I) Acquire SRK → (J) Lapsed/expired → (K) Free-tier/empty.** Each is specified with its **default / empty / loading / success / warning / error** states (plus surface-specific terminal states) at **both breakpoints**, copy deferring to `07`.

### A. Feature matrix — `/premium`

The honest comparison (§2.1/§2.2). It is the page that must make **free feel complete**.

| Part | Content | shadcn |
|---|---|---|
| **Header + eyebrow** | "Premium AI" + badge **"Optional — the free tier is fully capable"** | `text-h1` + `Badge` |
| **Subhead** | "Premium adds advanced AI features. It never touches your vault, your deposits, or your right to withdraw. Paid in SRK." | prose |
| **Plan toggle** | Monthly / Annual (factual savings line) | `ToggleGroup` |
| **Free card** | $0 · always; the full free feature list (assistant · portfolio · basic recs · **Aave Yield Vault deposit/earn/withdraw** · swaps · **withdraw anytime** · non-custodial · **no SRK**); button "You're on Free" (disabled) | `Card` + check rows + `Button` (disabled) |
| **Premium card** | "{N} SRK / {term} ≈ $X" (ⓘ SRK/USD) + **"Everything in Free, plus:"** + premium list (deeper/more-frequent strategy analysis · advanced strategy vaults when live, **RiskChip-tiered** · higher limits & priority compute · advanced analytics & alerts · scoped auto-rebalance, higher caps); button **"Upgrade to premium"** (spark) | `Card` + check rows + `RiskChip` + `Button` (spark) |
| **Non-essential callout** | "The free tier is fully capable. Premium is optional and never gates your vault, deposits, or withdrawals." | `AlertBanner` (info, persistent) |
| **"What counts as premium?"** | Honest, plain Accordion — each premium feature: what it adds, and the free equivalent if any | `Accordion` |

**Feature matrix — canonical free vs premium split** (design must render exactly this allocation; **nothing custody/core may sit in the premium column**):

| Capability | Free | Premium |
|---|---|---|
| Chat assistant (core help, intent → review+sign) | ✓ | ✓ |
| Portfolio read / snapshot | ✓ | ✓ |
| Basic strategy recommendations | ✓ | ✓ |
| **Aave Yield Vault — deposit / earn / withdraw** | ✓ | ✓ |
| **Swaps** (Aerodrome via assistant) | ✓ | ✓ |
| **Withdraw-always / escape hatch** | ✓ | ✓ |
| Non-custodial guarantees, prove-it, outcome log | ✓ | ✓ |
| Deeper / more-frequent strategy analysis | — | ✓ |
| Advanced strategy vaults (market-neutral, vol-harvesting) **when live** | — | ✓ (access) |
| Higher usage limits & priority compute | basic limits | ✓ raised |
| Advanced portfolio analytics & alerts | basic | ✓ |
| Scoped auto-rebalance with higher caps | standard caps (signed per-action / standard grant) | ✓ higher caps |
| Requires SRK? | **No** | only to *pay* (or USDC fallback) |

> **Anti-requirement made literal:** the entire left column is the live product without SRK. Premium is the right column's *additions*. If a reviewer can find a **custody or withdraw** capability in the premium column, the matrix is wrong (`revenue-model` §7 risk row).

**States (A):**
- **Default (free user, connected):** both cards; "You're on Free"; spark "Upgrade to premium" live.
- **Default (premium user):** Premium card shows "Your plan" + "Manage" (→ G); Free card informational. No second upsell.
- **Empty (not connected):** matrix fully readable; price shows current SRK/USD; upgrade button → "Connect wallet to upgrade" (`07` §2.2). No pressure.
- **Loading:** `Skeleton` price + feature rows; the **free feature list can render immediately** (it's static) — only the SRK price/USD skeletons. Never `0`/blank price (`07` §5.5).
- **Warning (SRK price stale):** price labeled "≈ $X (as of {time})" + "rates change" (§0.6).
- **Error (price unavailable):** "Couldn't load the current SRK price. The free tier is unaffected. [Retry]" — **never block the free product** on a price read.

### B. Upsell entry (inline, non-nagging) — in chat / portfolio / strategies

The *only* place premium is "pushed", and only on **explicit touch** of a premium-only feature (§1.2).

- **Anatomy:** a compact, dismissable `Card` (`--info`/spark-subtle, **never** `--destructive`): a one-line "this is a premium feature" + a one-line "what it adds" + **[See premium]** (→ A) + **[Not now]** (dismiss). Mirrors `TipCard` discipline (`06` §11): **dismiss persists; never re-nags** for that feature.
- **In chat:** the assistant first does whatever it *can* on free, *then* offers the upsell as a follow-up message — never refuses-then-sells, never withholds free help to force the upsell. Copy: "I can do {free version} now. Daily auto-rebalance at higher caps is a premium feature — [See premium] if you want it."
- **On a gated control:** a quiet **"Premium" `Badge`** + tooltip "what this adds" + [See premium]; the free equivalent stays operable beside it.
- **States:** default (offered) · dismissed (collapses, persists) · already-premium (the feature is simply available — **no upsell shown**). No loading/error of its own.
- **Banned here (`07` §9.3):** no modal-on-open, no countdown, no "limited", no "unlock now", no exclamation, no greying-out of free features to manufacture FOMO.

### C. Plan select / upgrade — `/premium/upgrade`

Reached from the matrix's "Upgrade to premium". Confirms **plan + term + price** before the pay step.

- **Anatomy:** selected plan summary (Premium · Monthly|Annual) · price **{N} SRK ≈ $X** (ⓘ) · term + renewal-date preview ("Renews {date} — you'll re-sign, or set scoped auto-renew") · a plain "what you're getting" recap (the premium additions) · **[Continue to payment]** (spark) + **[Back]**. The **non-essential callout** persists.
- **Auto-renew choice (opt-in, scoped, revocable):** a `Switch` default **off** ("Auto-renew with a scoped SRK allowance — capped, revocable anytime"). If on, it is implemented as a **scoped, capped, revocable allowance** (the §7 model), *named* like automation ("Grant scoped renewal access", never "enable auto-charge"). Default off = **you re-sign each term**.
- **States:** default · loading (price skeleton) · warning (annual selected → "you'll pay {N} SRK now for the year; cancel anytime, pro-rata per §H") · error (price unavailable → retry; free unaffected).

### D. Pay-with-SRK — `/premium/pay`

The commerce heart, kept honest and non-custodial. **The actual signature happens at `/confirm` (E);** this screen *composes the payment* and previews it.

| Part | Content | Rules / shadcn |
|---|---|---|
| **Plan price** | "Premium · {term}: **{N} SRK**  ≈ $X" (ⓘ SRK/USD, "fixed SRK for this term; USD moves with SRK") | tabular; `Card` + `Tooltip` |
| **Your SRK balance** | "Your SRK: **{bal} SRK** ≈ $Y" (read from chain) + enough/not-enough check | tabular; `Card`; en-dash if unknown, `0 SRK` if real zero |
| **Sufficiency** | ✓ "Enough to pay" / ⚠ "Not enough — you need {N−bal} more SRK. [Get SRK]" (→ I) | `AlertBanner` (info/caution) — **caution, not error** (it's a normal state) |
| **Payment method** | **● SRK** (default) ○ **USDC (fallback)** — the **stablecoin fallback flag**; only shown/active per §0.7. Clearly labeled "SRK fallback" | `RadioGroup` |
| **What you'll sign** | The **bundle**: **① approve {N} SRK** (exact amount, never unlimited — `06` §9 approvals) → **② pay {N} SRK to SparkPoint premium**. "One signature where supported, or two clearly-enumerated signs." | `Accordion`/stepper preview |
| **Non-custodial reminder** | "Non-custodial. Nothing moves until you sign. SRK is never required for the vault or to withdraw." | `text-sm muted` + `AlertBanner` (info) |
| **Primary** | **[Review & sign]** → `/confirm/[txIntentId]` (Flow 6) | `Button` (spark) |
| **Secondary** | [Back] · [Get SRK] (when short) | `Button` outline/ghost |

- **Approvals discipline (`06` §9; Flow 6 §4):** the SRK `approve` defaults to the **exact plan amount**, never unlimited; unlimited (if ever offered) is amber-flagged + acknowledged. A pre-existing sufficient allowance drops the approve step ("Already approved — one signature to pay").
- **Bundle (`06` §3-bis; Flow 6 §3-bis):** approve → pay is a **bundled, per-step simulated** action; the signature model (one batched sig vs two sequential) is stated **up front** so the user is never surprised by a second wallet prompt.
- **Stablecoin fallback (§0.7):** when active, the screen reads in **USDC**, the method shows "USDC (SRK fallback)", and **no copy implies SRK is required**. When SRK is live, SRK is the default and USDC fallback may be hidden or shown per governance flag.

**States (D):**
- **Default (enough SRK):** price + balance + ✓ sufficiency + method=SRK + sign-bundle preview; spark [Review & sign] enabled.
- **Not enough SRK (warning, normal):** ⚠ "Not enough SRK — you need {Δ} more. [Get SRK]"; [Review & sign] disabled with helper "Add SRK or switch method to continue." **Framed calmly** (`--caution`), never a red failure; the free tier reminder stays.
- **Loading:** balance + price `Skeleton`; **withdraw/prove-it still reachable via shell**; never `0` as placeholder.
- **Warning (SRK price moved):** "The SRK price moved; the SRK amount for this term is {N} SRK (≈ $X now)." Re-confirm before sign.
- **Error (balance read failed):** "Couldn't read your SRK balance. Your funds and the free tier are unaffected. [Retry] · [Verify on explorer]." Pay disabled until read succeeds (never pay blind), but **nothing core blocked**.
- **Not connected:** "Connect wallet to pay" (→ WalletConnect); matrix/recap still readable.

### E. The sign — `/confirm/[txIntentId]` (Flow 6, authoritative)

The pay routes into the **single confirm funnel**. This doc does **not** re-spec the gate; it specifies the **premium payload** Flow 6 renders:

- **AI-suggestion banner** present (the payment is a user-signed action under the labeling system, `05` §5).
- **Headline:** "You're paying **{N} SRK** for SparkPoint Premium ({term}). You'll be subscribed until {renewal date}." (or USDC fallback wording).
- **SimulationBalanceChangeTable (`06` §23):** SRK **− out {N}** (≈ −$X) + native gas row; no vault rows (this is not a vault action).
- **Approvals:** exact {N} SRK (or "already approved").
- **Bundle:** ① approve → ② pay (per-step simulated).
- **Cost & outcome:** gas (USD + native); **"SparkPoint fee: n/a — this is a subscription payment, not a vault fee"** (so "0% vault fee" framing isn't confused here); the line item *is* the premium price, shown plainly.
- **Guardrail checklist:** allowlisted recipient (the premium payment contract/address, allowlisted) · simulation passed · (no caps/slippage rows unless applicable).
- **Control reminder:** "Nothing moves until you sign. You can cancel now with no effect."
- **Success → (F).** Failure/rejected/sim-error all use Flow 6's states verbatim, with the custody reassurance ("Nothing moved — your funds are untouched.") — and **the free tier and vault remain fully usable** regardless.

### F. Subscription confirmation (receipt)

Plain, specific, non-celebratory (`07` §2.5; `04` §7 one success beat, never confetti).

- **Copy:** "Premium is active. You're subscribed until **{renewal date}**. Paid **{N} SRK** (≈ $X). View transaction ↗" + "Manage your subscription" (→ G).
- **Receipt anatomy:** plan + term · renewal date · **tx hash + explorer link** (SRK on-chain) or payment id (USDC fallback) · what just unlocked (the premium additions, with deep-links where live) · **non-essential reassurance restated**: "Your free tier and vault were always fully usable — premium just adds advanced AI."
- **Toast mirror (`Sonner`):** "Premium active · View tx ↗".
- **States:** success (above) · pending (Flow 6 pending stepper while the pay tx confirms) · partial (approve signed, pay pending — clear stepper, never "subscribed" until pay confirms).

### G. Manage subscription — `/premium/manage` (also `/settings` → Subscription)

The honest control room. **Cancel is always one tap from here.**

| Part | Content | shadcn |
|---|---|---|
| **Plan summary** | "Premium · {Monthly|Annual} · {N} SRK/{term} (≈ $X)" · status pill "Active" | `Card` + `Badge` |
| **Renewal** | "Renews {date}" + **auto-renew** state: **off** ("You'll re-sign to continue — nothing auto-charges") / **on** ("Scoped renewal allowance — capped {N} SRK, revocable") with **[Manage renewal access]** (→ revoke via `/confirm`, the §7 model) | `Card` + `Switch`/`Badge` |
| **Usage this period** | the premium meters (e.g., "Deeper analyses: 3 of 5", "Auto-rebalance cap used") via **CapsMeter** (`06` §14) — tabular, accessible text equivalent | `CapsMeter` rows |
| **Payment method** | "Paid in SRK" (or "USDC — SRK fallback"); last payment tx ↗ | `Card` + explorer link |
| **Cancel / downgrade** | **[Cancel premium]** (always visible, no maze) · **[Switch to monthly/annual]** (downgrade/cross-grade) | `Button` (outline; cancel is **empowering, not scary**, `04` §11) |
| **Non-essential reassurance** | "Cancelling keeps your free tier and vault fully intact. No questions, no penalty." | `AlertBanner` (info) |

- **No dark patterns (`07` §1.4):** cancel is a **direct action on this page** — not behind "contact support", not behind a multi-step retention funnel, not gated by a guilt modal. A single, sober `AlertDialog` confirm is allowed (it's a state change), phrased **neutrally/empoweringly** ("Cancel premium? Your free tier and vault stay fully usable. You keep premium until {date}."), with **[Cancel premium]** and **[Keep premium]** equally weighted — **no** pre-checked "stay", no dimmed cancel.
- **Auto-renew = scoped allowance (§7):** turning auto-renew on/off, and revoking the renewal allowance, are surfaced exactly like automation (scope · cap · revoke ≤1 tap, SparkPoint-independent, degraded-safe — `05` §6; `06` §18). Default **off**.
- **States:** active (default) · auto-renew-on (shows allowance + revoke) · near-renewal (info reminder, never threat) · canceled-but-active-until-date ("Premium ends {date}. Free tier unaffected. [Resubscribe]") · loading (`Skeleton`) · error ("Couldn't load your subscription. Your vault and withdrawals are unaffected. [Retry]" — **never block core**).

### H. Cancel / downgrade

- **Cancel:** one tap → sober neutral `AlertDialog` → on confirm: **"Premium canceled. You keep premium until {renewal date}, then you're on the free tier — which is fully capable. Your vault and withdrawals were never affected."** No win-back nag chain; an optional, **dismissable**, one-line "what you'll miss" is allowed (factual, not guilt) but **never a blocker**.
- **Downgrade / cross-grade (annual ↔ monthly):** plain, with honest proration copy ("you've paid through {date}; switching to monthly starts at the next term"). Any refund/credit logic is stated plainly or explicitly "no refund for the current term" — **never hidden**.
- **No auto-renew?** Then "cancel" is mostly informational ("Premium ends {date}; nothing renews unless you re-sign") — reinforce there is **no silent charge**.
- **States:** confirm-dialog · success (canceled, active-until-date) · already-on-free (n/a) · error ("Couldn't process the change — premium stays as-is; your vault is unaffected. [Retry]").

### I. Acquire SRK hand-off — `/premium/get-srk` (premium-scoped)

Where/how to get SRK to pay for premium — **scoped to the premium decision**, kept honest and non-hypey (reconciles with `/srk`'s no-price/no-buy character, §0.9: this surface exists **only** in the premium branch, for users who chose to upgrade and need SRK).

- **Anatomy:** "To pay for premium you need **{N} SRK** ({Δ} more than your {bal})." + **honest acquisition options** (each a `Card` row with a status badge):
  - **Where to get SRK** — the real, available routes only (e.g., a supported DEX/onramp link), each clearly external, **no price prediction, no "buy now to save", no APY/token theater** (`07` §9.3; `09` §8).
  - **The stablecoin fallback reminder** — "Don't want to hold SRK? You can pay premium in USDC instead." (when the fallback flag is active) → back to D with method=USDC. This keeps SRK **optional even for premium**.
  - **Non-essential reminder** — "You only need SRK if you want premium. The free tier and your vault need no SRK."
- **No price hype:** SRK amount + current USD-equivalent for *sizing the purchase only*; **no chart, no projection, no urgency**. If product later adds an in-app buy, it lives here behind the same non-hypey rules.
- **States:** default (options listed) · already-enough ("You have enough SRK — [Back to payment]") · loading (skeleton) · error ("Couldn't load SRK options. The free tier and vault are unaffected. [Retry]") · fallback-active (lead with "pay in USDC instead" so the user isn't forced to acquire SRK).

### J. Lapsed / expired (graceful downgrade)

The most trust-critical state: a premium term ends or a renewal isn't signed → **the user drops to the fully-usable free tier, with nothing core touched**.

- **Trigger:** renewal date passes without a signed renewal (auto-renew off, or allowance revoked/exhausted/expired, or payment not completed).
- **Treatment:** a calm **`--info`/neutral** `AlertBanner` (never `--destructive`, never a lock-alarm): **"Your premium term ended. You're on the free tier now — which is fully capable. Your vault, deposits, yield, and withdrawals were never affected. [Renew premium] anytime."** Premium-only features show the quiet "Premium" badge again; **no data is destroyed** (analytics/history return if they resubscribe).
- **Hard rule:** lapsing **must not** block a deposit, a withdrawal, the assistant's core help, or the escape hatch. There is **no "your account is locked"** state — ever. Withdraw-always and prove-it stay ≤1 tap.
- **Notifications:** a single, non-threatening "term ended" notice + an optional pre-expiry reminder ("Premium ends {date}; renew anytime, or let it lapse — your free tier and vault are unaffected"). No dunning escalation, no "act now or lose everything."
- **States:** just-lapsed (banner + reactivate path) · long-lapsed (clean free tier, premium entry still available, no nag) · auto-renew-failed (if a scoped renewal allowance couldn't cover it: "Auto-renew couldn't complete — you're on the free tier. [Renew manually]" — calm, never blaming, **core untouched**).

### K. Free-tier / empty state

The default for the ~95% who never subscribe — and it must feel **complete**, not like a perpetual trial.

- **Treatment:** there is no "empty premium" dead-end. `/premium` for a free user is the **matrix** (A) with the free column celebrated as "You're on Free — fully capable." `/premium/manage` for a non-subscriber **redirects to the matrix** (no broken "manage nothing" screen). The shell never shows a persistent "upgrade" nag.
- **Copy (`07` §6.2 empty pattern, adapted):** the free state is framed as *having a full product*, not lacking one: "You're on the free tier — the assistant, the vault, swaps, and withdraw-always are all yours, no SRK needed. Premium adds advanced AI if you ever want it."
- **States:** default-free (matrix, no pressure) · never-show-as-error (free is a *complete state*, not an empty/error one).

---

## 4. Microcopy (defer to `07`; subscription-specific strings)

All strings sentence-case, second person, present/active, no hype/urgency/emoji, no exclamation on prices (`07` §1.4, §9.3). Canonical, reusable:

- **The load-bearing motif (reuse verbatim across this flow):** **"The free tier is fully capable. Premium is optional."** Pair, where space allows, with: **"Premium never gates your vault, deposits, or withdrawals."**
- **Header eyebrow:** "Optional — the free tier is fully capable."
- **Premium framing:** "Everything in Free, plus:" (premium is **additive**, never a replacement).
- **Price:** "{N} SRK / {term}  ≈ ${X}" + ⓘ "Paid in SRK. The SRK amount is fixed for this term; the USD value moves with SRK." (no "save big", no "best value!").
- **Non-custodial / SRK-non-essential (reuse):** "Non-custodial. Nothing moves until you sign. SRK is never required for the vault or to withdraw."
- **Not enough SRK (calm, not error):** "Not enough SRK — you need {Δ} more. You can get SRK, or pay in USDC instead." (when fallback active).
- **Pay button:** "Review & sign" → (at `/confirm`, after acks) "Sign payment" / "Sign premium payment" (verb-first; never "Subscribe now"/"Pay now" finality that skips review — `07` §2.2).
- **Confirmation:** "Premium is active. You're subscribed until {renewal date}. Paid {N} SRK (≈ ${X}). View transaction ↗"
- **Cancel (empowering, `07` §2.2):** button "Cancel premium"; confirm "Cancel premium? Your free tier and vault stay fully usable. You keep premium until {date}." (no guilt, no dimmed-cancel).
- **Cancel success:** "Premium canceled. You keep it until {renewal date}, then you're on the fully-capable free tier. Your vault and withdrawals were never affected."
- **Lapsed (calm, `--info`):** "Your premium term ended. You're on the free tier now — which is fully capable. Your vault, deposits, yield, and withdrawals were never affected. Renew anytime."
- **Auto-renew (names the scope, `07` §2.2):** label "Auto-renew with a scoped SRK allowance" (default off); never "enable auto-charge" / "let us bill you".
- **Acquire SRK (no hype):** "To pay for premium you need {N} SRK. Here's where to get it — or pay in USDC instead. You only need SRK if you want premium."
- **Renewal reminder (reminder, not threat):** "Premium ends {date}. Renew anytime — or let it lapse; your free tier and vault are unaffected."
- **Banned in this flow (`07` §9.3 + brief tone):** "unlock now", "limited time", countdowns, "best/#1/exclusive", "don't miss", "act now", exclamation marks on prices, "subscribe to keep your money safe" (would falsely tie custody to payment), any phrasing implying SRK is required for core/withdraw, any implication the vault or withdrawal could be gated.

---

## 5. Non-custody & trust touchpoints (this flow)

This is the product's only paywall — so it must *prove* it isn't a custody lever:

- **Free tier is the whole product (`revenue-model` §3 Stream 0B):** the matrix shows the free column carrying the vault, swaps, the assistant, and withdraw-always — premium is visibly *additive*. Repeated verbatim: **"The free tier is fully capable. Premium is optional."**
- **Premium never gates custody (`revenue-model` §5.1; SC-013; N2):** no state here (lapsed, failed pay, degraded billing) blocks deposit/withdraw/yield or the escape hatch. The shell's **[Exit anytime]** and **[Prove it]** stay ≤1 tap on every screen, including the pay screen.
- **SRK stays non-essential (`01` §4 note 8; `08` §A):** SRK is only the **premium-payment rail**; the **USDC fallback** means a user can even buy premium without holding SRK. The acquire/pay surfaces are premium-scoped and don't make `/srk` a market (§0.9).
- **User-signed, non-custodial payment (`05` §5):** the `approve`+`pay` routes through `/confirm`; no stored card, no custodial pull, no silent recurring charge. Auto-renew, if chosen, is a **scoped, capped, revocable allowance** (§7), not an open mandate.
- **No dark patterns (`07` §1.4):** cancel is one tap, equally weighted, no maze, no guilt; upsells are touch-triggered, dismissable, and never re-nag.
- **Provable receipt (`revenue-model` §4; `admin-panel` §3.5):** SRK payments terminate in a **tx hash + explorer link**; the manage screen states plan/term/renewal honestly.
- **Honest token framing (`09` §8):** no SRK price hype, no token-APY theater, no urgency to acquire — the antithesis of the subsidized-yield cohort.

---

## 6. Auto-renew as a scoped, revocable allowance (the §7 / automation parallel)

If the user opts **in** (default **off**), recurring premium is implemented and surfaced as a **scoped SRK allowance**, never an open auto-charge — mirroring the automation trust model (`05` §6; `06` §18 SessionKeyScopeCard):

- **Scope shown before signing:** "Auto-renew premium · ≤ {N} SRK per {term} · next renewal {date} · revocable anytime." Named "Grant scoped renewal access" (`07` §2.2 — names the scope), never "enable auto-billing".
- **Granting it is a user-signed action via `/confirm`** (a capped SRK allowance to the premium contract) — one explicit signature, not a toggle that silently authorizes future pulls.
- **Revoke ≤1 tap, SparkPoint-independent, degraded-safe:** from manage, prove-it, or `⌘K`; revoking reverts to "you re-sign each term." Surfaced like any allowance (Revoke.cash framing, `05` §2.3).
- **Auto-revert on expiry/exhaustion:** if the allowance is exhausted/expired/revoked, the next term simply **doesn't renew** → graceful lapse (§3.J), never a failed charge that disrupts anything core.
- **Default off is the loud default:** the upgrade flow defaults to "you re-sign each term," so a user is never accidentally on a recurring mandate.

---

## 7. shadcn/ui mapping (this flow)

| Element | shadcn/ui primitive(s) |
|---|---|
| Feature matrix page shell | `AppShell` (`06` §1) + standard nav + persistent badge/disclaimer |
| Free / Premium plan cards | `Card` (+ Header/Content/Footer) + check rows (Lucide `check`) + `Badge` |
| Plan toggle (Monthly/Annual) | `ToggleGroup` (segmented) |
| Upgrade CTA (the one spark primary) | `Button variant="default"` (spark) |
| "You're on Free" (disabled) | `Button` (disabled/secondary) |
| Non-essential / SRK-non-essential callout | `AlertBanner` (info, persistent) (`06` §25) |
| "What's premium" / FAQ | `Accordion` |
| Advanced-vault tier indicators | `RiskChip`/`RiskTierBar` (`06` §15) |
| Inline upsell (chat/portfolio/strategies) | `Card`/`TipCard` (info, dismissable) (`06` §11) + "Premium" `Badge` on gated controls |
| Upgrade summary / plan select | `Card` + `Switch` (auto-renew, default off) + `Button` |
| Pay-with-SRK: plan price + balance | `Card` (`.tnum`) + `Tooltip` (SRK/USD ⓘ) |
| Sufficiency / not-enough | `AlertBanner` (info/caution) + [Get SRK] `Button` |
| Payment method (SRK / USDC fallback) | `RadioGroup` |
| Approve+pay bundle preview | `Accordion`/stepper |
| The sign gate | **`ConfirmationCard` / `/confirm`** (Flow 6) — `Dialog`/`Sheet`/route + `SimulationBalanceChangeTable` + `GuardrailChecklist` + spark Sign |
| Confirmation receipt | `Card` + `--success` check (`04` §7) + tx/explorer link + "Manage" link + `Sonner` toast |
| Manage subscription | `Card`s + `Badge` (status) + `CapsMeter` (usage) + `Switch` (auto-renew) + `Button` (Cancel/Switch) |
| Cancel confirm | `AlertDialog` (sober, neutral, equally-weighted buttons) |
| Auto-renew allowance / revoke | `Switch` + `SessionKeyScopeCard`-style scope (`06` §18) + revoke via `/confirm` |
| Acquire SRK hand-off | `Card` rows + `Badge` (status) + external-link `Button` + fallback reminder `AlertBanner` |
| Lapsed/expired | `AlertBanner` (info, **never destructive**) + [Renew] `Button` |
| Free-tier/empty | `EmptyState`/matrix (framed as a complete product, never an error) (`06` §24) |
| Loading | `Skeleton` (price/balance/usage; never `0`) |
| Notifications (renewal/lapse/paid) | `Sonner` toast + notifications center row |

---

## 8. Benchmarks honored (this flow)

| Pattern | Benchmark (`09`) | How we apply it |
|---|---|---|
| **Charge for the AI interface, not a cut of AUM** | **Hey Anon "Pass", Griffain "energy", Almanak compute-margin** (`09` "Premium AI subscription") | Premium prices advanced AI capability (deeper analysis, higher limits, advanced vault access) — never the vault, principal, or custody. |
| **Token utility without token-essentialism / no yield theater** | Out-position the subsidized-yield cohort (`09` §8; Giza/ARMA) | SRK is the *optional* premium-payment rail (USDC fallback exists); no price hype, no token-APY theater; SRK stays non-essential. |
| **Confirmable, user-signed action (no custodial pull)** | Hey Anon / Bankr chat-confirm pattern; Bankr's custodial wallet is the **anti-pattern** (`09` §"Hey Anon"/"Bankr") | Pay is a user-signed `approve`+`pay` via `/confirm`; no stored card, no custodial auto-charge. |
| **Simulation-backed sign + acknowledge model** | **Tenderly + Rabby** (`09` §5; Flow 6) | The SRK debit is previewed (balance-change + gas), allowlisted recipient checked, signed deliberately. |
| **Calm self-custody framing at the money moment** | **Ledger / Trust Wallet** (`09`) | "Nothing moves until you sign"; cancel-is-free; lapsing never locks the account. |
| **No-dark-pattern cancellation** | Consumer-trust best practice (FTC "click-to-cancel" spirit) | Cancel is one tap, equally weighted, no retention maze, no guilt wall. |

---

## 9. Acceptance criteria (Flow 10 — Subscriptions / Premium AI tier)

A design satisfies this flow when **all** hold:

1. **Both breakpoints, full-fidelity.** The matrix (`/premium`), upgrade, pay-with-SRK, confirmation, manage, cancel/downgrade, acquire-SRK, and lapsed states are each designed at **1440px desktop** and **390px mobile** (matrix stacked Free-first; pay screen → sticky [Review & sign]; overlays → `Sheet`).
2. **All states designed.** matrix(default-free / default-premium / empty-disconnected / loading / price-stale / price-error) · inline-upsell(offered / dismissed-persists / already-premium) · upgrade · pay(enough / not-enough-calm / loading / price-moved / read-error / disconnected) · `/confirm` sign (via Flow 6) · confirmation(success / pending / partial) · manage(active / auto-renew-on / near-renewal / canceled-until-date / loading / error) · cancel/downgrade · acquire-SRK(default / enough / loading / error / fallback-active) · lapsed(just / long / auto-renew-failed) · free-tier/empty — each with on-spec copy from `07`.
3. **Free tier is visibly complete.** The matrix's Free column carries the **vault (deposit/earn/withdraw), swaps, the assistant, withdraw-always, non-custodial guarantees — and "no SRK"**; Premium reads "Everything in Free, plus:" and contains **only** additive AI capability. **No custody/withdraw/core capability appears in the premium column.** (`revenue-model` §3/§7; SC-013.)
4. **Premium never gates custody — anywhere.** No screen or state (lapsed, failed pay, degraded billing, not-enough-SRK) blocks, delays, or hides deposit, withdrawal, yield, the assistant's core help, or the escape hatch; **[Exit anytime]/[Prove it] stay ≤1 tap on every screen, including pay.** (N2; SC-003/013.)
5. **SRK stays non-essential.** The flow makes plain SRK is only the **premium-payment rail**; the **USDC fallback** lets a user buy premium without SRK; the acquire/pay surfaces are premium-scoped and do **not** make `/srk` a market or contradict its "you never need SRK" callout (§0.9; `01` §4 note 8; FR-045/046).
6. **Payment is user-signed and non-custodial.** The `approve`+`pay` routes through the **single confirm funnel** (`/confirm`, Flow 6) as a **bundled, simulated** action; **no stored card, no custodial pull, no silent recurring charge**; approvals default to **exact** (never unlimited unflagged). (`05` §5; `06` §9/§3-bis.)
7. **No dark patterns.** Cancel is a **direct, one-tap, equally-weighted** action on manage (no retention maze, no support-contact gate, no guilt wall, no dimmed cancel); upsells appear **only on explicit touch** of a premium feature, are **dismissable**, and **never re-nag**; no countdowns/FOMO/urgency/exclamation; lapsing is calm `--info`, never a lock-alarm. (`07` §1.4, §9.3.)
8. **Honest pricing.** Price shows the **SRK amount paid + a clearly-labeled USD equivalent**, with the SRK/USD volatility disclosed; **no projected token price, no "save"/"best value" hype, no APY theater**; the USDC-fallback flag is clearly labeled and never implies SRK is required. (`07` §5, §9.3; `09` §8.)
9. **Auto-renew is opt-in + scoped + revocable.** Default **off** ("you re-sign each term"); if on, it is a **capped, revocable SRK allowance** granted via `/confirm` and surfaced like automation (scope shown, revoke ≤1 tap, auto-revert on expiry → graceful lapse). (`05` §6; `06` §18.)
10. **Provable receipt + reconcilable.** Premium activation terminates in a **tx hash + explorer link** (SRK) or a clear payment id (USDC fallback); manage shows plan/term/renewal honestly (the user-side of the revenue stream the admin dashboard reconciles). (`revenue-model` §4; `admin-panel` §3.5.)
11. **Reconciled with the non-essential `/srk` page.** `/srk` keeps its informational, no-price, no-buy character; at most one quiet factual cross-link to Premium; the two surfaces agree that **SRK is optional, premium is optional, and neither is needed for the vault or withdrawals.** (§0.9; `08` §A.)
12. **Trust motifs verbatim & non-custody reachable.** "The free tier is fully capable. Premium is optional." and "Non-custodial. Nothing moves until you sign. SRK is never required for the vault or to withdraw." appear where the flow calls for them; the AI-suggestion labeling rides the pay tx; cancelling is neutral and free.
13. **Maps to shadcn + accessible.** Every element resolves to §7; **one spark primary per view** (Upgrade / Review&sign / Renew); **visible 2px spark focus ring**; the upgrade→pay→sign flow is **keyboard-completable**; all SRK/USD/usage figures **tabular**, mono for addresses/hashes; premium-gating is conveyed by text+icon+`--info` (never color-alone, never red); `Dialog`→`Sheet` on mobile; reduced-motion honored (success check degrades to opacity).

---

## 10. Cross-references

- **The revenue stream this visualizes (free tier fully usable, premium paid in SRK, non-custodial, USDC fallback, SRK-non-essential, the anti-"essential-creep" guardrail):** `revenue-model/README.md` (§3 Phase 0 Stream 0B, §5.1 matrix, §7 risk row).
- **The sign gate the pay routes into (Tenderly preview, approvals exact-by-default, bundle approve→pay, all sign states, the single-confirm-funnel rule):** `02-flows/06-execution-confirmation-simulation.md` and `01-information-architecture.md` (§0.3, §4.2.3).
- **The non-essential `/srk` page this reconciles with (no price, no buy, low-prominence, non-essential callout):** `02-flows/08-srk-literacy-outcomes-settings.md` (§A) and `01-information-architecture.md` (§4 note 8, §4.4).
- **Components composed:** `06-component-library.md` — AppShell (§1), NonCustodialBadge/ProveItPanel (§2–3), WalletConnectButton (§4), ConfirmationCard (§9), SimulationBalanceChangeTable (§23), RiskChip (§15), CapsMeter (§14), AlertBanner (§25), EmptyState (§24), TipCard (§11), SessionKeyScopeCard (§18, the auto-renew allowance parallel).
- **Tokens / spark = AI presence / semantic + risk palettes / `--info` for optional framing / tabular / mono / motion / a11y / component→shadcn map:** `04-design-system.md` (§2, §3, §7, §10, §11).
- **All canonical wording — voice (no hype/urgency), button verbs, the confirmation/sign pattern, success/error/empty copy, SRK/USD number formatting, banned phrases:** `07-content-and-tone.md` (§1, §2.2, §2.4, §2.5, §5, §6, §9) — **wins on any conflict.**
- **The admin-side reconciliation of this revenue (revenue-by-stream, MRR/ARR, premium subscription source):** `admin-panel/README.md` (§3.5).
- **Benchmarks (Hey Anon, Griffain, Almanak; Tenderly/Rabby; Ledger/Trust Wallet; out-positioning token theater):** `09-references.md` (§"Premium AI subscription", §5, §8).
- **Requirements traced:** FR-045/046 (SRK non-essential), SC-013 (works without SRK), SC-003 (withdraw-always), N2 (withdraw-always escape hatch), plus the single-confirm-funnel (SC-001) the pay tx rides; revenue-model Stream 0B (premium, freemium, SRK-paid, USDC fallback).
