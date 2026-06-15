# 02 · Flow 4 — Strategy Recommendations (ranked vs your goal)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui).
> **Status:** Authoritative screen-level spec for **Flow 4 (Strategy Recommendations)** of the six core flows. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — guardrails + you dispose"), five non-custody guarantees, tone, non-goals.
> - `01-information-architecture.md` — §1 routes `/strategies`, `/strategies/[recId]`; §2 persistent shell; §4.2 the **mandate is the spine** and **acceptance writes to the Outcome Log via `/confirm`**; §4.3 entry-point matrix; the single-confirm-funnel rule (§0.3).
> - `04-design-system.md` — tokens (spark = AI presence; strict semantic green/red/amber; **3–5-step risk palette** §2.5; tabular numerals §3.1/§3.4; motion §7; a11y §10; component→shadcn map §11).
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** All strings, the AI-suggestion badge (§2.1), button verbs (§2.2), APY/PnL/number formatting (§5), banned/required phrases (§9), empty/error copy (§6).
> - `02-flows/02-chat-assistant.md` — the `RecommendationCard` is the in-chat seed of this flow; this doc is its full-surface expansion. The in-chat card and this surface must stay consistent (anatomy, copy, the confirm gate).
> - `09-references.md` — §1 chat benchmarks (OpenAI Apps SDK ★★★), §3 vault/risk transparency (Gauntlet ★★★, PolicyLayer risk-score ★★), §4 robo-advisor "tie to your goal" (Wealthfront/Betterment ★★★/★★), §5 simulation/sign gate (Tenderly/Rabby ★★★), §8 competitor intel (out-position Giza/Brahma/Fungi/Axal).
>
> **What this doc IS:** goal & entry points; the ranked-list screen and the recommendation-detail ("why this?") screen; the compare view; the filter system; every state (default / empty / loading / success / warning / blocked / error); component anatomy → shadcn primitives; desktop **and** mobile layout; microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria.
> **What it is NOT:** visual tokens (`04`), canonical strings (`07`), the IA/route map (`01`), the chat surface internals (`02`), the Confirmation/simulation/sign internals (Flow 6 / `/confirm`), the Portfolio risk panel (Flow 3), the Vault deposit/withdraw screens (Flow 5), or the Outcome-log surface (`/activity`). This flow **deep-links into** those and never re-implements them.

---

## 0. The strategy thesis (constraints on every screen in this flow)

1. **This is the visible "fund manager" intelligence.** Strategies is the surface where the differentiator — *advisor-grade, explainable, ranked-to-your-goal* recommendations — is made felt (`00` §0; competitor white-space, `09` §8). Every screen must read as *reasoned*, not *promotional*.
2. **Ranked relative to the mandate, always.** Every recommendation is scored **vs the user's goal/mandate** (the spine, `01` §4.2.1; `spec.md` FR-014, SC-005). The mandate is shown as context on the surface so the ranking is legible, not a black box.
3. **Plain-language rationale is mandatory, never optional.** 100% of recommendations carry a visible plain-language rationale and a ranking relative to the goal (`spec.md` SC-005; FR-015). "Why this?" is a first-class affordance, not buried.
4. **Allowlist-only, in-policy-only.** Only whitelisted protocols (**Aave v3, Aerodrome**) and within-policy actions are ever recommended (`spec.md` FR-016, SC-006). The deterministic policy layer filters *before* anything is shown; an out-of-policy strategy never appears here.
5. **The AI proposes — the UI says so on every card.** Every recommendation carries the verbatim **"AI suggestion — you approve & sign"** badge (`07` §2.1). There is **no one-click money-mover**; the primary action **always routes to `/confirm`** (simulation + guardrail checklist + sign), never executes here (`01` §0.3, §4.2.3).
6. **Honest about outcome, confident about process.** Never lead with a return number; never project APY; net APY only, always with a breakdown ≤1 tap; "Estimates, not guarantees." on any yield-referencing card (`07` §5.2, §9.1). Confidence lives in the reasoning and the guardrails, not in the yield.
7. **Sourced, not hallucinated.** Any live figure (APY, TVL, rate, audit) a recommendation asserts carries a **source affordance** ("Based on {source}" + timestamp + link); on-chain claims link to explorer/verified source (`07` §2.6; `02` §9).
8. **Outcomes close the loop.** Acting on a recommendation creates an **Outcome Log entry** linked to the originating `recId`, updated over time with realized PnL — **wins and losses shown symmetrically** (`01` §4.2.4; `spec.md` FR-039–041, SC-010). The detail screen surfaces this accountability link.
9. **Launch reality.** Single Aave Yield Vault = **Risk 1 (Lower)**; supported actions = Aave v3 deposit/withdraw (USDC, ETH) and Aerodrome swaps from chat (`spec.md` Assumptions). The full risk palette (1–5) is *designed* so compare/ranking surfaces can show context, but the live recommendation set leans Risk 1–2. Beta-gated (whitelist, per-user caps, geo-fence) — caps appear as context where a recommendation implies a deposit.

---

## 1. Goal & entry points

### 1.1 Goal

Give the user a **ranked, reasoned, goal-relative** set of strategy recommendations they can understand, compare, and act on — where every card explains *why this fits your plan*, exposes its *sourced data* and *guardrails-passed*, and routes any money-moving acceptance through simulation + signing. The surface must let a crypto-curious newcomer trust the ranking (because the reasoning is legible) and let a power user interrogate it (filters, compare, sources, raw "why").

The one-sentence job: **turn the AI's analysis into a decision the user can make with confidence and act on safely.**

### 1.2 Entry points (`01` §4.3, §4.2)

| From | Behavior | Lands on |
|---|---|---|
| **Primary nav → "Strategies"** | Desktop top-bar item; mobile bottom-tab. | `/strategies` (ranked list) |
| **Chat `RecommendationCard` → "Why this?"** | The in-chat card's secondary action (`02` §7.1). | `/strategies/[recId]` (detail) |
| **Chat `RecommendationCard` → "Review this move"** | The in-chat card's primary; builds a `txIntent`. | `/confirm/[txIntentId]` (bypasses the list — goes straight to sign gate) |
| **Portfolio risk panel → "Improve this" / "Improve my yield"** | From Flow 3's risk panel / drift indicator. | `/strategies` pre-filtered to the relevant goal/risk (e.g., "lower-risk yield") |
| **Notifications deep-link** | "A better-fitting strategy is available" alert. | `/strategies/[recId]` (the referenced rec) |
| **Empty-mandate nudge** | User without a mandate opens Strategies. | Empty state → "Set my plan" → `/onboarding` (§3.2.B) |
| **Command menu (`⌘K`)** | "Show strategies". | `/strategies` |
| **Outcome Log → "See the original advice"** | From `/activity/[entryId]`. | `/strategies/[recId]` (the originating rec) |

### 1.3 Pre-conditions & gating (handled by shell/IA, surfaced here)

- **Mandate required for ranking.** Recommendations are ranked *vs the mandate*. **No mandate → empty state with "Set my plan"** (`07` §6.2; §3.2.B below). The surface never fabricates a ranking without a goal to rank against.
- **Wallet + whitelist + geo** per `01` §6 — handled at the app boundary; if a recommendation implies a deposit, **caps context** is shown (beta). A geo/whitelist regress mid-session shows the standard gated render (`01` §6) but **withdraw-always stays reachable** via the shell.
- **Degraded mode (agents/data stale or down):** the surface shows a **stale/unavailable banner** and **does not present a live ranking on stale data** (`01` §6; `07` §5.5). Last-known recommendations may show, clearly stamped "as of {time}", with execution still gated (and `/confirm` will re-simulate live). Withdraw path unaffected.

---

## 2. Layout — desktop vs mobile

Both breakpoints first-class (`00` §4; `04` §4.2). Two screens compose this flow: the **ranked list** (`/strategies`) and the **detail / "why this?"** (`/strategies/[recId]`). The **compare view** is a mode overlaid on the list; **filters** are a control cluster on the list.

### 2.1 Desktop ranked list (`/strategies`, 1440px canvas)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL (01 §2): top bar [logo · Chat·Portfolio·Vault·Strategies* …       │
│   ● Non-custodial ▸ · Wallet 0x12…ab ▸ · ⌘K · 🔔 · avatar]                      │
│ AI DISCLAIMER STRIP — "AI suggestion. You approve & sign. SparkPoint never      │
│   holds your funds. [Prove it] [Exit anytime]"                                  │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│ SECONDARY│ PAGE HEADER                                                          │
│ NAV RAIL │  H1 "Strategies"  ·  subhead "Ranked for your plan"                  │
│ (01 §2)  │  [ MANDATE CONTEXT BAR: "Your plan: Lower risk (1/5) · capital-      │
│          │    preservation · steady USDC yield"  ·  Edit plan ▸ ]              │
│          │  ┌──────────── FILTER BAR ───────────────────────────────────────┐  │
│          │  │ [Risk ▾] [Asset ▾] [Protocol ▾] [Min APY ▾] · Sort: Best fit ▾ │  │
│          │  │ active chips: ✕ Lower risk  ✕ USDC      [Compare] [Clear all]   │  │
│          │  └────────────────────────────────────────────────────────────────┘  │
│          │                                                                       │
│          │  RANKED LIST (cards, full-width rows, vertically stacked)            │
│          │  ┌──────────────────────────────────────────────────────────────┐   │
│          │  │ [①Best fit]  AI suggestion — you approve & sign     [☐ compare]│   │
│          │  │ Strategy title · one-line thesis                              │   │
│          │  │ 4.3% net APY ⓘ   · Risk 1/5 ▮▯▯▯▯ Lower · Fit ●●●●○ Strong    │   │
│          │  │ Projected: est. +$X/yr at current rate (estimate)            │   │
│          │  │           [Why this?]            [Review this move]  [Not now] │   │
│          │  └──────────────────────────────────────────────────────────────┘   │
│          │  ┌── ②Good fit … ──┐  ┌── ③Consider … ──┐  (more rows) …            │
│          │                                                                       │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```

- **Single-column ranked list** of recommendation cards (rows ~`max-w` of the content column ~960–1100px); ranking is **top-to-bottom**, with an explicit rank badge per card (never rely on order alone — `04` §10.2).
- **Mandate context bar** sits directly under the page header so the ranking basis is always visible (the "vs your goal" is literal, not implied). "Edit plan ▸" → `/settings/mandate`.
- **Filter bar** is sticky beneath the mandate bar; active filters render as removable chips; **Compare** toggles selection mode; **Sort** defaults to "Best fit".
- **≤2 primary/secondary actions visible per card footer** (OpenAI Apps SDK discipline carried from chat, `02` §7.0); "Why this?" is a tertiary/expander affordance, not counted as one of the two money/decision actions.

### 2.2 Desktop recommendation detail (`/strategies/[recId]`, 1440px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL + AI DISCLAIMER STRIP (as above)                                  │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│ SECONDARY│  ← Back to Strategies                                                │
│ NAV RAIL │  [①Best fit]  Strategy title          AI suggestion — you approve…  │
│          │  one-line thesis                                                     │
│          │ ┌─────────────────────────────────┬──────────────────────────────┐  │
│          │ │ LEFT (primary, ~62%)             │ RIGHT RAIL (~38%)            │  │
│          │ │ • RATIONALE NARRATIVE            │ • KEY FIGURES                │  │
│          │ │   "Why this?" — plain, 2–4 ¶     │   4.3% net APY ⓘ (breakdown) │  │
│          │ │   the move · the reason · the    │   Risk 1/5 ▮▯▯▯▯ Lower        │  │
│          │ │   trade-off · why it fits        │   Fit to your goal ●●●●○      │  │
│          │ │ • FIT-TO-GOAL detail             │   Projected (estimate)       │  │
│          │ │   maps to mandate dimensions     │ • GUARDRAILS PASSED          │  │
│          │ │ • SOURCED DATA                    │   ✓ Allowlisted protocol     │  │
│          │ │   each figure → source chip      │   ✓ Within your beta cap     │  │
│          │ │ • RISK RATIONALE (4-dim)         │   ✓ Slippage under your max  │  │
│          │ │   contract/centralization/       │   ✓ Fits your risk plan      │  │
│          │ │   market/operational            │ • OUTCOME (if acted before)  │  │
│          │ │                                  │   linked Outcome Log         │  │
│          │ │                                  │ ─ ACTIONS ─                  │  │
│          │ │                                  │ [Review this move] (spark)   │  │
│          │ │                                  │ [Compare] [Not now]          │  │
│          │ └─────────────────────────────────┴──────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```

- **Two-pane:** left = the **reasoning** (rationale narrative, fit-to-goal, sourced data, risk rationale); right rail = **key figures + guardrails-passed + actions** (the decision column). The right rail's primary CTA "Review this move" is the only spark element.
- **Back affordance** preserves list scroll/filter state on return.

### 2.3 Mobile (390px canvas) — single column, stacked

```
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ TOP BAR (condensed) + badge   │        │ ← Back                        │
│ AI DISCLAIMER (1 line ▾)      │        │ [①Best fit] Strategy title    │
├───────────────────────────────┤        │ AI suggestion — you approve…  │
│ Strategies                    │        │ one-line thesis               │
│ Your plan: Lower risk 1/5 ▸   │        ├───────────────────────────────┤
│ [Filters (2)] [Sort ▾][Compare]│       │ KEY FIGURES                   │
│ ✕ Lower risk  ✕ USDC          │        │ 4.3% net APY ⓘ · Risk 1/5     │
├───────────────────────────────┤        │ Fit ●●●●○ · Projected (est.)  │
│ ┌───────────────────────────┐ │        ├───────────────────────────────┤
│ │ ① Best fit   [☐ compare]  │ │  →     │ WHY THIS? (rationale ¶)       │
│ │ AI suggestion—approve&sign│ │        │ Fit to your goal              │
│ │ Title · thesis            │ │        │ Sourced data (chips)          │
│ │ 4.3% net APY · Risk 1/5   │ │        │ Risk rationale (4-dim ▾)      │
│ │ Fit ●●●●○ · est. +$X/yr   │ │        │ Guardrails passed ✓✓✓✓        │
│ │ [Why this?]  [Review move]│ │        │ Outcome (if any) ▸            │
│ └───────────────────────────┘ │        ├───────────────────────────────┤
│ ② Good fit …  ③ Consider …    │        │ ▟ sticky bottom action bar:   │
├───────────────────────────────┤        │ [Review this move] (spark)    │
│ BOTTOM TABS: Chat·Pf·Vault·St*│        │ [Compare]  [Not now]          │
└───────────────────────────────┘        └───────────────────────────────┘
```

- **List:** stacked near-full-width cards (`p-4` gutter); the same rank badge + figures + ≤2 actions. Mandate context is a compact one-line bar (tap → `/settings/mandate`).
- **Filters → bottom `Sheet`** (the `Dialog→Drawer/Sheet` rule, `04` §4.2); active filter chips show in a horizontally scrollable row; a count badge on the "Filters" trigger.
- **Detail:** single-column stacked sections (figures → why this → fit → sources → risk rationale → guardrails → outcome), with the primary CTA in a **sticky bottom action bar** (thumb-reachable; `04` §4.2/§4.3). "Risk rationale" and "Sources" collapse into `Accordion`s to keep the screen scannable.
- **Compare → full-screen `Sheet`** on mobile (§5.3).

### 2.4 Responsive transform rules (carry everywhere)

| Desktop | → Mobile |
|---|---|
| Filter bar (inline `DropdownMenu`/`Popover` per facet) | "Filters" trigger → bottom `Sheet` with all facets; active chips in a scroll row |
| Detail two-pane (reasoning + decision rail) | Single column stacked; primary CTA → sticky bottom action bar |
| "Risk rationale" / "Sources" inline blocks | `Accordion` collapsibles |
| Compare = side-by-side columns table | Compare = full-screen `Sheet`, 2 strategies swipeable / segmented |
| "Why this?" `Popover` (from list card) | Bottom `Sheet` or navigate to `/strategies/[recId]` |
| Hover affordances (compare checkbox, source hint) | Always-visible tap targets (≥44px, `04` §4.3) |
| Cards ~960–1100px content column | Near-full-width, `p-4` gutter |

---

## 3. Screen A — Ranked recommendations list (`/strategies`)

### 3.0 Goal

Present strategies **ranked vs the user's goal**, each scannable in one glance (rank, net APY, risk, fit, projected outcome) and explainable in one tap ("Why this?"), with money-moving acceptance routed to `/confirm`.

### 3.1 The `StrategyCard` (ranked-list row) — anatomy

This is the full-surface sibling of the chat `RecommendationCard` (`02` §7.1); keep anatomy and copy consistent. `Card` composition (`CardHeader/Content/Footer`), **≤2 footer actions** + a tertiary "Why this?" expander.

| Slot | Content | Rules | shadcn |
|---|---|---|---|
| **Rank badge** | `① Best fit` / `② Good fit` / `③ Consider` (or `#1 vs your goal`) | Explicit rank — never order-only (`04` §10.2). Rank label is **fit-relative**, not "best APY". | `Badge` |
| **AI-suggestion badge** | **"AI suggestion — you approve & sign"** | Verbatim, never shortened (`07` §2.1). Spark-tinted (`04` §9). Present on every card. | `Badge` (spark-subtle) |
| **Title + one-line thesis** | e.g. *"Move idle USDC into the Aave Yield Vault"* + *"Aave's USDC rate rose to 4.3% net APY — more yield at the same low risk."* | Plain; what + why in one line (`07` §8). Never lead with the number. | `text-h3` + `text-base` |
| **Net APY readout** | **"4.3% net APY"** + ⓘ breakdown disclosure (`07` §5.2: "= 4.3% Aave supply rate − 0% SparkPoint fee") | Never bare; one decimal; estimate-framed; **range when volatile** ("≈ 4.0–4.4% net APY, 30-day"). Tabular. | text + `Popover`/`HoverCard` |
| **Risk chip** | risk-palette tier + `n/5` segmented meter + label ("Risk 1/5 · Lower") | Risk palette §2.5; **always number + label**, never hue-only. Launch vault = Risk 1. | `Badge` + segmented meter |
| **Fit-to-goal** | "Fit to your goal: ●●●●○ Strong" (or "Strong / Good / Partial fit") | The "vs your goal" score (SC-005). Uses a **neutral/spark-neutral** dot meter — **not** the risk palette and **not** semantic green (fit ≠ gain). Label always present. | dot meter + `text-sm` |
| **Projected outcome** | "Projected: est. +${X}/yr at the current rate" + "Estimates, not guarantees." | **Clearly labeled estimate**; never lead with it; **never project/annualize APY itself** (`07` §5.2, §9.1). Shown as a derived $ figure, framed. Tabular. | `text-sm muted` |
| **Sources** | inline source chip(s) on the cited APY/TVL | "Based on {source}" + timestamp + link (`02` §9; `07` §2.6). | interactive `Badge` → `Popover`/`Sheet` |
| **Compare checkbox** | `☐ Compare` (top-right or footer-left) | Adds the card to the compare selection (§5). | `Checkbox` |
| **Footer actions (≤2)** | **primary "Review this move"** (→ `/confirm` via `txIntent`) + secondary **"Not now"** | Never "Accept"/"Do it" (`07` §2.2). Money primary always routes to sign gate, never one-click. | `Button` ×2 |
| **Tertiary** | **"Why this?"** → `/strategies/[recId]` (desktop may also offer an inline `Popover` summary) | First-class but not a money action. | `Button variant="link"` / `Popover` |
| **Per-card affordances** | thumbs up/down (feeds accountability loop, `02` §10) | Optional, low-prominence; selecting one disables the opposite. | `Toggle`/`ToggleGroup` |

> **Trust strings (reuse verbatim, `07`):** "AI suggestion — you approve & sign"; "{X}% net APY" + breakdown ≤1 tap; "Estimates, not guarantees." on every yield-referencing card.

### 3.2 States — ranked list

**A. Default (ranked recommendations present)**
- Mandate context bar populated; filter bar idle (Sort = "Best fit"); cards ranked top→bottom with explicit rank badges; each card complete (APY/risk/fit/projected/sources/actions).
- One spark primary per card footer ("Review this move"); the surface still has only **one** spark *emphasis* per visual cluster (avoid five sparks; `04` §2.3).

**B. Empty — no mandate yet** (`07` §6.2, "Strategy recs (none yet)")
- Title **"No recommendations yet"**; body *"Once I understand your goal and see your wallet, I'll rank strategies here with the reasons behind each."*; CTA **"Set my plan"** → `/onboarding`.
- No fake/sample cards. The AI-disclaimer + non-custody shell still present.

**C. Empty — mandate set, nothing to recommend right now**
- Title "Nothing to suggest right now"; body *"Your current plan is well-matched to where your funds already are. I'll surface a strategy here the moment a better-fitting move appears."* CTA: "Ask the AI" (→ `/chat`) and/or "Review your vault" (→ `/vault`). Honest non-urgency; never manufacture a move (`07` §1.4 banned: urgency/FOMO).

**D. Empty — filters exclude everything** (`07` §6.2, "Search/filter no results")
- Title "No matches"; body "Try a different filter."; CTA **"Clear filters"** (restores the full ranked set). Active-filter chips remain visible so the user sees *why* it's empty.

**E. Loading**
- Skeleton rows (card scaffolds with shimmer for rank/APY/risk/fit fields); mandate context bar may show first; no `0` placeholders, no spinner-over-stale (`04` §6.1, §7; `07` §5.5).

**F. Warning — a recommendation is above the user's risk plan** (`02` §5.6; `07` §6.3)
- The specific card carries an **amber caution banner** (icon + text, never color alone): *"Heads up: this move is higher-risk than your plan (your {tier} → {move tier}). You'll be asked to acknowledge before signing."*
- The card's primary still routes to `/confirm`, where the full acknowledge-before-sign gate lives (Flow 6). The list **previews** the friction; it does not replace it.
- Above-plan cards are **not hidden** but are **never ranked #1/Best fit** by construction (fit-to-goal penalizes risk mismatch).

**G. Stale / degraded** (`01` §6; `07` §5.5)
- Banner: *"These may be out of date — I won't act on stale data."* Cards stamped "as of {time}". "Refresh" action. Execution still gated (`/confirm` re-simulates live).

**H. Error — couldn't load recommendations** (`07` §6.1)
- Inline `Alert`: *"We couldn't load your strategies right now. Your funds are safe and untouched. Try again in a moment."* + "Retry". Never a dead end; never raw tech strings.

### 3.3 Filters & sort

Filters narrow the ranked set; sort reorders it. **Filtering never changes the policy** — out-of-policy/out-of-allowlist strategies are never in the set to begin with (`spec.md` FR-016). Filters operate on the *eligible* set only.

| Facet | Control | Options (launch-aware) | Notes |
|---|---|---|---|
| **Risk** | multi-select | Risk 1–5 (3-step collapse Lower/Moderate/Higher for retail) — uses risk palette §2.5 | Launch set leans Risk 1–2; higher tiers shown for context/compare. Each option carries the tier color + `n/5` + label. |
| **Asset** | multi-select | USDC, ETH (+ "All") | Matches supported assets (`spec.md` Assumptions). |
| **Protocol** | multi-select | Aave v3, Aerodrome (+ "All") | **Allowlist only** — these are the *only* protocols that can ever appear (`spec.md` FR-016/027). The filter is honest about the small allowlist; no non-allowlisted option exists. |
| **Min APY** | slider / stepped input | e.g. 0% → current-max, 0.1% steps | Labeled "Minimum net APY"; framed as a floor, not a promise; never lead the surface with it. Tabular. |
| **Sort** | single-select | **Best fit (default)** · Net APY (high→low) · Risk (low→high) · Newest | "Best fit" = the goal-relative ranking (the default and the differentiator). Sorting by APY does **not** suppress the rank badges or the fit score (so the user never loses the "vs your goal" context). |

- **Control patterns:** desktop = inline `DropdownMenu`/`Popover` per facet + a `Select` for Sort; mobile = a single **"Filters" `Sheet`** bundling all facets + Sort, with a count badge.
- **Active filters** render as **removable chips** ("✕ Lower risk", "✕ USDC") in a row beneath the filter bar (both breakpoints); **"Clear all"** resets.
- **Compare entry** lives in the filter bar cluster ("Compare" toggles selection mode, §5).
- **Persistence:** filter/sort state persists on the surface within a session and is restored when returning from a detail/confirm screen.
- **No-results** → state D above.

### 3.4 Microcopy (list) — defer to `07` for canon

- Page title "Strategies"; subhead "Ranked for your plan".
- Mandate context: "Your plan: Lower risk (1/5) · capital preservation · steady USDC yield" + "Edit plan ▸".
- Rank labels: "Best fit" / "Good fit" / "Consider" (or "#1 vs your goal").
- Card thesis exemplar (`07` §8): "Aave's USDC rate rose to 4.3% net APY. Moving your idle USDC in could earn more, at the same low risk. Estimates, not guarantees."
- Buttons: primary "Review this move" (→ `/confirm`); secondary "Not now"; tertiary "Why this?". **Never** "Accept/Do it/Apply" (`07` §2.2, §9.3).
- Fit label: "Fit to your goal: Strong / Good / Partial".
- Empty/error/stale copy per §3.2 (all from `07` §6).

---

## 4. Screen B — Recommendation detail / "why this?" (`/strategies/[recId]`)

### 4.0 Goal

Let the user **interrogate a single recommendation**: read the plain-language rationale, see exactly how it **fits the goal**, inspect the **sourced data** behind every figure, understand the **risk rationale** (four dimensions), confirm the **guardrails it passes**, and see any **outcome** if they (or the system) acted on it before — then act via the same `/confirm` gate. This screen is where SC-005 ("visible plain-language rationale + ranking relative to goal") is satisfied in full.

### 4.1 Sections & anatomy

| Section | Content | Rules / benchmark | shadcn |
|---|---|---|---|
| **Header** | rank badge + title + one-line thesis + **"AI suggestion — you approve & sign"** badge | Verbatim badge (`07` §2.1); back-link preserves list state. | `Badge` ×2 + `text-h2`/`text-base` |
| **Key figures (decision rail)** | Net APY (+ breakdown ⓘ), Risk `n/5` + meter + label, Fit-to-goal meter + label, Projected outcome (estimate-framed) | Net APY never bare; breakdown ≤1 tap; "Estimates, not guarantees." Tabular. Risk palette §2.5. | `Card` + meters + `Popover` |
| **Rationale narrative ("Why this?")** | 2–4 short paragraphs, plain language: **the move · the reason (the data shift) · the trade-off · why it fits your plan** | Measured/reasoned tone (`07` §1.3); honest about the trade-off; never hype; never imply certainty. This is the headline content. | prose (`text-base`) |
| **Fit-to-your-goal detail** | maps the rec to the mandate dimensions: goal (capital-preservation / steady yield), timeline, risk tier — shows *why* the fit score is what it is | The "ranked relative to the user's goal" made explicit (SC-005; Wealthfront/Betterment "tie to your goal", `09` §4). | list / `Card` + dot meter |
| **Sourced data** | every asserted live figure (APY, TVL, rate, audit) as a **source chip** → "Based on {source}" + value-as-fetched + timestamp + link; a turn-level/section-level **"Sources"** list | Never assert a live number without a source (`07` §2.6; Cloudscape citations, `09` §1). On-chain claims → explorer/verified source. Stale labeled. | interactive `Badge` → `Popover`/`Sheet`; `Accordion` "Sources" |
| **Risk rationale (4 dimensions)** | the PolicyLayer four-dimension risk read (`09` §3): **smart-contract security** (audits/bug-bounty), **centralization** (admin keys/upgradeability), **market risk** (liquidity/oracle), **operational** (team/governance) — each with a plain one-liner | Drives the Risk `n/5` score; gives the score a *rationale*, not just a number. Use the risk palette for the tier; the four lines explain it. | `Accordion` / `Card` + `Tooltip` |
| **Guardrails passed** | a **checklist** of the deterministic guardrails this rec satisfies: "✓ Allowlisted protocol (Aave v3)", "✓ Within your beta cap", "✓ Slippage under your max", "✓ Fits your risk plan" — or "⚠ Requires your acknowledgement: {reason}" if above-plan | This is the **"guardrails-passed"** payload — shows the policy layer already checked it (the AI-proposes / guardrails-check / you-sign thesis, made visible *before* the sign screen). Mirrors (does not replace) the `/confirm` checklist (Flow 6; Rabby, `09` §5). Semantic icons + text, never color-only. | list rows + semantic icons (`04` §2.4) |
| **Outcome link (if acted on)** | if this rec was acted on → a compact **OutcomeCard** seed: realized PnL (signed, colored, windowed) + "See in your activity ▸" (→ `/activity/[entryId]`) | Closes the accountability loop (`01` §4.2.4; FR-039–041). Wins and losses shown symmetrically; never hide a loss (`07` §5.3). If not acted on, this section is absent (not a placeholder). | `Card` + `Badge` (gain/loss) + link |
| **Actions (≤2 + tertiary)** | **primary "Review this move"** (→ `/confirm` via `txIntent`) + secondary **"Compare"** (adds to compare, §5) and/or **"Not now"**; tertiary **"Ask the AI"** (→ `/chat` pre-seeded with this rec) | Money primary always → sign gate (`01` §0.3). "Ask the AI" lets the user dig deeper conversationally. | `Button` (spark) + `Button` ×1–2 + link |

### 4.2 States — detail

- **Default** — all sections populated; one spark CTA ("Review this move").
- **Loading** — skeletons for figures and the rationale block; sources/risk-rationale accordions collapsed-loading; no `0` placeholders.
- **Warning / above-plan** — the guardrails block shows the **"⚠ Requires your acknowledgement"** row + an amber caution banner near the CTA: *"This move is higher-risk than your plan. You'll acknowledge before signing."* CTA still routes to `/confirm` (where the ack gate lives). (`07` §6.3.)
- **Blocked / no longer valid** — if the underlying data changed so the rec is now out-of-policy or stale-beyond-tolerance (e.g., rate moved, cap reached), show a **destructive `Alert`**: *"This suggestion no longer fits your guardrails: {plain reason, e.g. 'it would now exceed your beta cap'}. Nothing was acted on."* — **no sign offered** (deterministic policy rejects pre-signature, `spec.md` FR-008, FR-023/025). Offer "Back to strategies" / "Ask the AI". (`07` §6.1.)
- **Stale** — "as of {time}" stamps + "Refresh"; execution still gated and re-simulated at `/confirm`.
- **Error** — couldn't load the rec: *"We couldn't load this strategy. Your funds are safe. Try again."* + "Retry"; or `not-found` if `recId` is invalid/expired → "This recommendation has expired. See your latest strategies." → `/strategies`.
- **Outcome — pending** — if acted on but PnL still settling: "Outcome still settling — realized PnL updates over time." (`07` §5.5).

### 4.3 Microcopy (detail) — defer to `07`

- "Why this?" header; rationale exemplar built from `07` §8 (the move / reason / trade-off / fit).
- Net APY + breakdown verbatim pattern (`07` §5.2).
- Guardrails rows: "✓ Allowlisted protocol", "✓ Within your beta cap", "✓ Slippage under your max", "✓ Fits your risk plan", "⚠ Requires your acknowledgement: {reason}" (`07` §2.4).
- Risk rationale lines: plain one-liners per dimension; define jargon inline / via `Tooltip` (`07` §4.3 glossary tone).
- Buttons: "Review this move" (primary), "Compare", "Not now", "Ask the AI". Never "Accept/Confirm/Do it" (`07` §2.2).
- Loss/outcome line (if present), verbatim pattern (`07` §8): "−$88.10 (−0.7%, 1M) · The rate dropped after the move. View tx ↗ · See it in your activity."

---

## 5. Compare view

### 5.0 Goal

Let the user **directly compare 2–3 selected strategies** side-by-side on the dimensions that matter — net APY, risk (tier + 4-dim rationale summary), fit-to-goal, projected outcome, guardrails, sources — so the ranking is *defensible*, not just asserted. Compare is a **mode**, not a separate route; it overlays the list/detail.

### 5.1 Entry & selection

- Toggle **"Compare"** in the filter bar (list) or the detail actions; the surface enters **selection mode** — each card shows a `Compare` checkbox.
- **Select 2–3** strategies (cap at 3 for legibility; disable further checkboxes at 3 with helper "Compare up to 3"); a sticky "Compare (2) ▸" affordance appears.
- "Compare" opens the comparison surface with the selected set.

### 5.2 Comparison layout (desktop)

A **column-per-strategy comparison table** (`Table`-style), one **row per dimension**, with the user's mandate shown as a reference column/annotation so "fit" is anchored:

| Dimension (row) | Strategy A | Strategy B | Strategy C |
|---|---|---|---|
| **Rank / fit** | ① Best fit · Fit ●●●●○ | ② Good fit · Fit ●●●○○ | ③ Consider · Fit ●●○○○ |
| **Net APY** | 4.3% net APY ⓘ | 4.1% net APY ⓘ | 5.2% net APY ⓘ |
| **Risk** | 1/5 Lower ▮▯▯▯▯ | 2/5 Lower ▮▮▯▯▯ | 4/5 Higher ▮▮▮▮▯ ⚠ above plan |
| **Projected (est.)** | est. +$X/yr | est. +$Y/yr | est. +$Z/yr |
| **Protocol / asset** | Aave v3 · USDC | Aave v3 · USDC | Aerodrome · ETH |
| **Guardrails** | ✓✓✓✓ | ✓✓✓✓ | ✓✓✓ · ⚠ ack needed |
| **Sources** | chips | chips | chips |
| **Action** | [Review this move] | [Review this move] | [Review this move] |

- **Best-in-row hinting:** highlight the best value per row **only with a neutral marker + label** (e.g. a small "highest" tag) — **not** semantic green (a higher APY isn't a "gain") and **not** a winner-takes-all framing; the **Fit row remains the headline** (highest APY ≠ best fit; the table must make that legible — e.g. Strategy C has the highest APY but a worse fit and an above-plan risk flag).
- **Mandate anchor:** a reference annotation ("Your plan: Lower risk 1/5, capital preservation") sits above or as a sticky left annotation so every "fit"/"risk" cell is read against it.
- **Each column keeps its AI-suggestion badge and the per-row source chips**; each column's action is the same `/confirm`-routed "Review this move".
- **Above-plan columns** carry the amber caution inline (icon + text), consistent with §3.2.F.

### 5.3 Compare on mobile

- Compare opens as a **full-screen `Sheet`**. Two patterns acceptable: (a) a **2-up segmented** view with a strategy switcher (A | B | C) swapping the second column, or (b) **swipeable strategy columns** with a fixed dimension-label column on the left. Either way: dimensions stay row-aligned and tabular; the Fit row stays prominent; above-plan flags visible.
- Actions per strategy ("Review this move") reachable without horizontal scrolling the action row off-screen (pin the action row or surface it per selected column).

### 5.4 States — compare

- **Default** — 2–3 columns populated.
- **Min-selection** — fewer than 2 selected: helper "Select at least 2 strategies to compare."; Compare surface not yet openable.
- **Max** — at 3: further checkboxes disabled with helper "Compare up to 3".
- **Loading** — skeleton cells.
- **Above-plan present** — caution flags inline (§5.2); any above-plan column's eventual "Review this move" routes to the acknowledge-before-sign gate.
- **Error** — a column fails to load: that column shows a graceful "Couldn't load this strategy. Retry." without breaking the others.

### 5.5 Microcopy (compare)

- "Compare strategies"; "Compare up to 3"; "Select at least 2 strategies to compare."
- Row labels reuse the canonical figure labels (Net APY / Risk / Fit to your goal / Projected (estimate) / Protocol / Guardrails / Sources).
- "highest" / "lowest risk" neutral tags (no superlative hype; `07` §9.3 — no "best/#1/unbeatable" as marketing).
- Action per column "Review this move".

---

## 6. Non-custody & trust touchpoints (this flow)

This flow is the "fund manager intelligence" — trust is earned by **legibility and honesty**, and by never letting the AI feel like it can act.

- **Persistent shell** (`01` §2): non-custodial badge → prove-it panel, wallet status, **AI disclaimer strip with [Prove it] / [Exit anytime]** are present on every screen here — withdraw/exit and "what we can/can't do" stay ≤1 tap away.
- **AI-suggestion badge on every card and detail** — verbatim "AI suggestion — you approve & sign" (`07` §2.1); the recommendation is explicitly a *proposal*.
- **No one-click money-mover** — every "Review this move" routes to `/confirm` (simulation + guardrail checklist + sign); the AI never executes from Strategies (`01` §0.3; `spec.md` SC-001/002).
- **Guardrails-passed, shown before the sign screen** — the detail's guardrails checklist makes the deterministic policy's pre-check *visible* here (it re-runs authoritatively at `/confirm`); above-plan recs preview the acknowledge-before-sign friction (Rabby pattern, `09` §5).
- **Allowlist honesty** — only Aave v3 / Aerodrome ever appear; the Protocol filter is honest about the small allowlist; out-of-policy strategies are never shown (`spec.md` FR-016/027).
- **Sourced, not promised** — every live figure carries a source affordance + timestamp + link; on-chain claims link to verified source (`07` §2.6; "provable, not promised", `05`).
- **Honest yield** — net APY only, breakdown ≤1 tap, "Estimates, not guarantees.", never projected/led-with; capital-preservation-first framing (`07` §5.2, §9.1) — the deliberate out-positioning of token-subsidized competitors (`09` §8, Giza/ARMA).
- **Honest outcomes** — the detail surfaces the linked Outcome Log entry (win *or* loss) when acted on; losses read as plainly as gains (`07` §5.3).
- **Withdraw-always** — even when reviewing strategies, the escape hatch is reachable; degraded/stale states never gate the withdraw path (`01` §6).

---

## 7. shadcn/ui mapping (this flow)

| Strategy element | shadcn/ui primitive(s) |
|---|---|
| Ranked-list `StrategyCard` | `Card` (+ `CardHeader/Content/Footer`) + `Badge` (rank, AI-suggestion, risk) + `Button` ×≤2 |
| Rank / AI-suggestion / risk badges | `Badge` (spark-subtle for AI; risk-palette variant for risk, §2.5) |
| Net APY breakdown | text + `Popover` (desktop) / `HoverCard` / `Sheet` (mobile) |
| Risk chip + meter | `Badge` + custom segmented meter (`n/5`, `04` §6.5) |
| Fit-to-goal meter | custom dot/segment meter + label (neutral, not risk/semantic) |
| "Why this?" disclosure (list) | `Popover` (desktop) / `Sheet` (mobile) / navigate to detail |
| Source citation chip → source | interactive `Badge` → `Popover` (desktop) / `Sheet` (mobile); section-level `Accordion` "Sources" |
| Risk rationale (4-dim) | `Accordion` / `Card` + `Tooltip` (term definitions) |
| Guardrails-passed checklist | list rows + semantic icons (`04` §2.4) — pass=`--success`+check, ack-needed=`--caution`+alert-triangle |
| Caution banner (above-plan) | `Alert` (warning variant) |
| Blocked / no-longer-valid | `Alert` (destructive) — **no sign offered** |
| Filters (desktop) | `DropdownMenu`/`Popover` per facet + `Select` (sort) + `Slider`/stepped `Input` (min APY) |
| Filters (mobile) | `Sheet` bundling facets + count `Badge` on trigger |
| Active-filter chips | removable `Badge`/chip row + "Clear all" `Button` |
| Compare selection | `Checkbox` per card + sticky "Compare (n)" `Button` |
| Compare table (desktop) | `Table` (dimension rows × strategy columns) |
| Compare (mobile) | full-screen `Sheet` (segmented switcher or swipeable columns) |
| Outcome link (acted-on) | `Card` + `Badge` (gain/loss) + link to `/activity/[entryId]` |
| Thumbs feedback | `Toggle`/`ToggleGroup` (+ optional `Popover`/`Sheet` follow-up) |
| Mandate context bar | `Card`/inline strip + `Badge` (risk tier) + "Edit plan" link |
| Loading | `Skeleton` (card scaffolds, figure fields, table cells) |
| Empty / no-results | `Card` + Lucide icon + microcopy + CTA |
| Errors / stale banners | `Alert` (destructive / warning / info) |
| Primary CTA "Review this move" | `Button variant="default"` (spark) → `/confirm` |
| Toasts (e.g., "Added to compare") | `Sonner` |

---

## 8. Benchmarks honored (this flow)

| Pattern | Benchmark (canonical link in `09`) | How we apply it |
|---|---|---|
| Ranked, **goal-relative** recommendations with "tie to your goal" + adjustable plan context | **Wealthfront / Betterment (★★★/★★)** `09` §4 | Rank = fit-to-goal; mandate context bar; fit-to-goal meter & detail; "on/off plan" language; "Edit plan" |
| Structured cards over prose; **≤2 actions**; data-changing → inline confirm with inputs+outputs; no nested nav in cards | **OpenAI Apps SDK — UI guidelines (★★★)** `09` §1 | `StrategyCard` anatomy; ≤2 footer actions + tertiary "why this?"; every accept routes to `/confirm` |
| Inline **citations + source popovers + Sources list** | **Cloudscape — gen-AI chat (★★★)** `09` §1 | Per-figure source chips; section-level "Sources" disclosure; timestamps |
| **Four-dimension risk score + rationale**; "where your deposit goes" transparency | **PolicyLayer risk-score (★★) / Gauntlet app (★★★)** `09` §3 | Risk `n/5` driven by contract/centralization/market/operational rationale; honest risk read |
| Net-of-fees APY with **expandable breakdown**; never projected | **Yearn / Beefy / Morpho (★★/★★★)** `09` §3 | "{X}% net APY" + breakdown ≤1 tap; "0% SparkPoint fee" explicit; no projections |
| Pre-trade simulation + guardrail checklist; **sign disabled until acknowledged** | **Tenderly + Rabby (★★★)** `09` §5 | Guardrails-passed preview here; the authoritative gate at `/confirm`; above-plan → acknowledge-before-sign |
| Out-position token-subsidized "AI yield" agents with **honest, non-subsidized net APY + transparent risk + explainable reasoning** | **Giza/ARMA, Brahma, Fungi, Axal (competitor intel)** `09` §8 | No yield theater; legible guardrails; "interview → mandate → explainable plan", deeper than a risk slider |

---

## 9. Acceptance criteria (Flow 4 — Strategy Recommendations)

A design satisfies this flow doc when **all** hold:

1. **Both breakpoints, full-fidelity.** Ranked list, recommendation detail, compare view, and the filter system are all designed at **1440px desktop** and **390px mobile**, with the desktop two-pane detail collapsing to a single column + sticky bottom CTA, and filters/compare becoming `Sheet`s on mobile.
2. **All states designed.** For the list: default / empty-no-mandate / empty-nothing-to-suggest / empty-filters-exclude-all / loading / warning-above-plan / stale-degraded / error. For the detail: default / loading / warning-above-plan / blocked-no-longer-valid / stale / error / not-found / outcome-pending. For compare: default / min-selection / max / loading / above-plan / error. Each with on-spec copy from `07`.
3. **Ranked vs the goal, visibly.** Every recommendation shows an explicit **rank badge** and a **fit-to-goal** read, with the **mandate context** shown on the surface; ranking is never order-only; sorting by APY never removes the rank/fit context (SC-005; FR-014).
4. **Plain-language rationale present on 100% of recs.** The detail's "Why this?" narrative (move / reason / trade-off / fit) is first-class; the list card carries a one-line thesis + a one-tap path to the full rationale (SC-005; FR-015).
5. **Card anatomy correct.** `StrategyCard` carries rank badge, **verbatim AI-suggestion badge**, title+thesis, **net APY with breakdown ≤1 tap (never bare)**, risk chip (`n/5` + label + palette), fit-to-goal meter+label, projected outcome (labeled estimate, "Estimates, not guarantees."), source chip(s), and **≤2 footer actions** + tertiary "Why this?".
6. **Net APY & projection honesty.** No bare APY anywhere; every APY is net, estimate-framed, with breakdown ≤1 tap; no projected/annualized-from-a-good-window APY; projected outcome is a clearly-labeled $ estimate, never led-with (`07` §5.2, §9.1).
7. **Sourced data everywhere asserted.** Every live figure carries a source affordance ("Based on {source}" + timestamp + link); a section-level "Sources" list exists on the detail; on-chain claims link to explorer/verified source; stale data labeled, never shown as live (`07` §2.6, §5.5).
8. **Risk rationale present.** The detail surfaces the **four-dimension** risk read (contract / centralization / market / operational) that justifies the `n/5` tier, using the risk palette + numeric/label fallback (never color-only).
9. **Guardrails-passed shown.** The detail shows a guardrails checklist (allowlisted protocol / within beta cap / slippage under max / fits risk plan), with above-plan recs surfacing "⚠ Requires your acknowledgement" — previewing (not replacing) the `/confirm` gate.
10. **Allowlist + policy honesty.** Only Aave v3 / Aerodrome and in-policy actions ever appear; the Protocol filter exposes only the allowlist; no out-of-policy strategy is shown or made signable (FR-016/027; SC-006).
11. **Confirm gate enforced.** Every money-moving acceptance ("Review this move") routes to `/confirm` via a `txIntent`; **no one-click money-mover** exists on this surface; blocked/no-longer-valid recs offer no sign (FR-008/023/025; SC-001/002).
12. **Compare is decision-useful.** Compare supports 2–3 strategies, row-aligned on net APY / risk / fit / projected / protocol / guardrails / sources, with the **mandate anchored** and the **Fit row headline** (highest APY ≠ best fit is legible); above-plan columns flagged; each column actions through `/confirm`.
13. **Outcomes close the loop.** When a rec was acted on, the detail links its Outcome Log entry showing realized PnL — **wins and losses symmetrically**, never a flattering window, with on-chain proof (FR-039–041; SC-010).
14. **Trust motifs verbatim & non-custody reachable.** "AI suggestion — you approve & sign" on every card/detail; "Estimates, not guarantees." on yield cards; the shell's non-custodial badge → prove-it and a withdraw/exit path remain ≤1 tap from every screen here.
15. **Maps to shadcn + accessible.** Every element resolves to the §7 map; cards honor ≤2 actions; visible 2px spark focus ring; full keyboard operability (list, filters, compare selection, detail, the route to sign); risk/fit/PnL never color-only (icon + number/label + sign); all financials tabular; reduced-motion honored; Dialog→Sheet/Drawer on mobile.

---

## 10. Cross-references

- **Shell, routes (`/strategies`, `/strategies/[recId]`), hub role, single-confirm-funnel, mandate spine, entry-point matrix, gating/degraded states:** `01-information-architecture.md` (§0, §1, §2, §4, §6).
- **Tokens, spark = AI presence, semantic + risk palettes, risk/caps meters, tabular numerals, AI "thinking" motion, ≤2-action card mapping, a11y:** `04-design-system.md` (§2, §3, §6, §7, §10, §11).
- **All canonical wording, the AI disclaimer, trust motifs, button verbs, error/empty/warning copy, number/PnL/APY/shares formatting, banned/required phrases:** `07-content-and-tone.md` (§2, §3, §5, §6, §8, §9) — **wins on any conflict.**
- **The in-chat `RecommendationCard` (the seed of this flow), citations, thumbs feedback, the in-chat confirm mirror:** `02-flows/02-chat-assistant.md` (§7.1, §9, §10).
- **Onboarding → mandate (the goal this flow ranks against), risk tiers, "edit plan":** `02-flows/01-onboarding.md`.
- **Confirmation / simulation / guardrail checklist / sign internals (where every "Review this move" lands):** Flow 6 (`/confirm`) handover doc.
- **Portfolio risk panel ("improve this" entry) and Vault deposit/withdraw (acceptance target):** Flows 3 and 5.
- **Outcome Log (the accountability loop this flow links into):** `/activity` supporting-surface doc.
- **Benchmark links (OpenAI Apps SDK, Cloudscape; Wealthfront/Betterment; PolicyLayer/Gauntlet; Yearn/Beefy/Morpho; Tenderly/Rabby; competitor intel):** `09-references.md` (§1, §3, §4, §5, §8).
- **Requirements traced:** FR-014–016 (ranked recs + rationale + allowlist), FR-008 (policy-gate), FR-039–041 (outcome log); SC-005 (visible rationale + ranking), SC-006 (allowlist only), SC-001/002 (signed + simulated), SC-010 (outcome entries).
