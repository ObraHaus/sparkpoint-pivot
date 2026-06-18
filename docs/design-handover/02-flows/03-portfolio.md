# 02 · Flow 3 — Portfolio Overview (net worth · PnL · risk · allocation · positions)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts).
> **Status:** Authoritative screen-level spec for **Flow 3 (Portfolio Overview)** of the six core flows. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to):** `00-brief.md` (positioning, thesis, non-goals), `01-information-architecture.md` (§1 routes `(app)/portfolio`, §2 shell, §3 nav, §4 flow graph, §6 degraded states), `04-design-system.md` (tokens, spark/semantic/**risk** palettes, type, **data-viz §6**, motion, a11y, shadcn map), `07-content-and-tone.md` (**all wording, PnL/APY/number formatting, tooltips, banned/required phrases, error/empty copy**), `09-references.md` (§2 portfolio benchmarks). **Where this doc shows copy that conflicts with `07`, `07` wins on wording; where it conflicts with the brief on scope/tone, the brief wins.**
> **What this doc IS:** goal & entry points; the screen-level layout and every state (default / empty / loading / success / warning / error); component anatomy → shadcn primitives + Recharts; desktop **and** mobile layout notes; microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria.
> **What it is NOT:** visual tokens (in `04`), canonical strings (in `07`), the IA/route map (in `01`), or the chat/strategy/vault/confirm flow specs (separate docs). It also does **not** redefine the persistent app shell (in `01-IA` §2) — it inherits it.

---

## 0. Goal, scope, and the one-sentence job

**Job:** Answer **"how am I doing, and how much risk am I carrying?"** at a glance, then let the user act on any position **without leaving the relationship** (Add / Withdraw / Ask AI) — all funneling through the one shared `/confirm` surface. The Portfolio is the **situational-awareness** surface and a precondition for trustworthy, context-aware recommendations (`spec.md` US-4).

**The wedge this flow owns (brief; `09` §2):** *a first-class **RISK PANEL** none of the trackers have.* Zerion/DeBank/Zapper give a legible net-worth hero + positions table + inline actions, but all three share the same gap — **weak PnL, no risk identification, no drift/time-based alerting** (`09` §2 "tracker comparison"). We clone the legible parts and **out-position them with an explicit risk panel** (score · concentration · drift-vs-target) tied to the onboarding mandate. Risk is a *first-class dimension here, not just an asset mix.*

**Hard product/data facts to encode (`spec.md` FR-009–013, SC-011; `data-model.md` §6):**
- The portfolio is **onchain-derived and reconstructable** — every figure (net worth, PnL, allocation) is computed from onchain events + a block-anchored price snapshot, never asserted. Design must support an **"as of {block/time}"** provenance line and a **stale** treatment (`07` §5.5).
- Positions are exactly three kinds at launch: **`token_balance`** (idle USDC/ETH), **`aave_supply`** (Aave v3 USDC/ETH deposit + accrued yield), **`vault_shares`** (the single Aave Yield Vault, spvUSDC). No other protocols (whitelist: Aave v3, Aerodrome — `spec.md` FR-016/027).
- PnL is split **realized** (from closed/withdrawn portions) and **unrealized** (mark-to-snapshot); both must be labeled and never conflated (`data-model.md` §6; `07` §5.3).
- **Portfolio reads are NEVER a signature gate** — gates re-read RPC live (`data-model.md` VR-P4). The Portfolio is read-only; every action it offers routes out to `/confirm`.
- Empty portfolio renders an **empty state, not an error** (FR-013, VR-P2).

**Tone for this flow (`07` §1.3):** everyday, direct, explanatory — a knowledgeable peer showing you your money plainly. **Honest about losses as plainly as gains** (`07` §1.2.5, §5.3): no hiding red, no flattering default time-window, no "unrealized" softening that obscures a real loss. **Capital-preservation-first** framing; risk shown soberly, not as alarm.

---

## 1. Entry points & exits

### 1.1 Entry points (`01-IA` §4.3)
| From | Lands on |
|---|---|
| **Primary nav** ("Portfolio" — top bar desktop / bottom tab mobile) | `/portfolio` (overview) |
| **Chat** ("see portfolio", `PortfolioSnapshotCard` "open full portfolio") | `/portfolio` |
| **Vault** (your-position sub-panel "view in portfolio") | `/portfolio` or `/portfolio/positions/[id]` (the vault position) |
| **Strategies** (none → "improve this" cross-link back from risk panel) | `/strategies` (outbound) |
| **Notifications** (drift alert, cap-approaching, big-move) | `/portfolio` or a specific `/portfolio/positions/[id]` |
| **Position detail** | `/portfolio/positions/[id]` (single-position detail, §6) |

### 1.2 Exits (where the portfolio sends you)
- **Act on a position →** inline row action **Add** → `/vault/deposit` or Aave deposit intent → `/confirm/[txIntentId]`; **Withdraw** → `/vault/withdraw` or Aave/withdraw intent → `/confirm/[txIntentId]`. **No signing happens here** (`01-IA` §0.3).
- **Ask AI →** opens `/chat` primed with that position in context ("Tell me about my Aave USDC position").
- **Improve risk →** risk-panel CTA → `/strategies` (ranked vs mandate) or `/chat`.
- **Edit target →** drift indicator → `/settings/mandate` (re-runs onboarding review/confirm — Flow 1 §5.6).
- **Prove-it / Withdraw-always →** persistent shell badge + disclaimer-strip links, present here as on every `(app)` route (≤1 tap, `01-IA` §2).

---

## 2. Shell context & layout model (inherits `01-IA` §2)

The Portfolio renders **inside the authenticated app shell** — it does **not** define its own. Inherited and always present (do not re-spec, do not omit): the **non-custodial badge** → prove-it panel, the **wallet/connection status** chip (Base pill), the **AI disclaimer strip** (with [Prove it] / [Exit anytime]), primary nav, secondary nav, command menu, notifications. Withdraw/exit + prove-it are ≤1 tap from here.

### 2.1 Layout model (both canvases — `04` §4.2)

- **Desktop (1440 design, 1024 min):** a **12-col dashboard** under the shell, max content ~1200–1280px. Vertical reading order top→bottom:
  1. **Net-worth hero band** (full width) — total + change readout + over-time area chart with range toggle.
  2. **Two-column row:** **left ≈ 8 col = Allocation** (donut + view switcher: asset / strategy / **risk tier**); **right ≈ 4 col = Risk panel** (the differentiator) — OR risk panel left-rail-pinned; pick one and keep it. *Recommended:* Risk panel on the **right** as a tall sticky card so it stays in view while the user scans (it's the differentiator — keep it visible).
  3. **Positions table** (full width) with inline row actions.
  This is a true data layout (not the centered conversational column of onboarding).
- **Mobile (390 design, 360 min):** single column, stacked, scroll order: **hero (number + compact chart + range chips) → risk panel card → allocation (donut + legend below, view switcher as `ToggleGroup`/`Tabs`) → positions as stacked cards (not a wide table)**. Primary per-position actions collapse into a row overflow / swipe / bottom `Sheet`. Overlays (PnL definition, allocation detail, "as of" provenance) = **Sheets/Popovers**, not Dialogs.
- **Responsive transform:** desktop two-column allocation+risk → stacked; positions `Table` → stacked position `Card`s; per-row action buttons → an action overflow `DropdownMenu` or a bottom-`Sheet` action set; chart range `Tabs`→ compact `ToggleGroup` chips; tooltips → tap-popovers.

> **Don't over-stuff (Zerion "tries to do too much" critique, `09` §2):** progressive disclosure everywhere. The overview shows the *summary* of each dimension; depth (per-position attribution, full history, the full risk rationale) lives one tap down in §6 position detail or in expandable disclosures.

---

## 3. Section A — Net-worth hero band

**Purpose:** The "how am I doing" headline. Total net worth, period change, and the over-time trend. Benchmark: **DeBank** at-a-glance net worth + restraint; **Zerion** performance feel — but with **explicit, tooltip'd PnL definitions** because Zerion's PnL is criticized (`09` §2).

### 3.1 Anatomy → shadcn / Recharts
| Element | Detail | shadcn / Recharts | `04`/`07` ref |
|---|---|---|---|
| **Net-worth figure** | `text-display`, **full precision** (not abbreviated in the hero), tabular, `$` prefix, USD-denominated. | `Card` header text + `.tnum` | `04` §3.2/§3.4; `07` §5.1 (hero shows full precision) |
| **Period change (PnL)** | `+$312.40 (+2.8%)` / `−$88.10 (−0.7%)`: **sign + color + directional triangle + window label**, e.g. "+2.8% (1M)". Colored by `--gain`/`--loss`/`--muted` (flat). | text + Lucide `triangle` (filled) | `04` §2.4/§3.4; `07` §5.3 |
| **PnL definition tooltip** | Info affordance next to the change: plain definition of *what this PnL is* (realized vs unrealized, the window). | `Tooltip`/`HoverCard` (desktop), tap-`Popover` (mobile) | `07` §2.3 tooltip pattern; §5.3 |
| **Over-time area chart** | Single-series `AreaChart`; **spark stroke** + vertical gradient fill fading to transparent (one of the few sanctioned spark usages outside CTA — "your money, the thing of focus"). | Recharts `AreaChart` in `Card` | `04` §6.2 |
| **Range toggle** | `1D · 1W · 1M · 1Y · All`; default to a **non-flattering, honest** window (do **not** auto-pick whichever range looks greenest — `07` §5.3). Recommend **1M** as default. | `Tabs` or segmented `ToggleGroup` | `04` §6.2; `07` §5.3 |
| **"As of" provenance** | Subtle line: "as of {relative time}" / block, with absolute on hover; this surface is onchain-derived. | `text-xs muted` + `Tooltip` | `07` §5.5/§5.6; `data-model.md` §6 |

### 3.2 Critical color rule (do not violate)
If net worth is **down** over the selected range, **do NOT recolor the whole area red** (avoid alarm). Keep the **spark stroke + gradient**; color **only the PnL *number*** by sign (`--loss`). Color-by-sign lives on the figure, never on the chart fill. (`04` §6.2.)

### 3.3 Interaction
- Hover/scrub the chart → custom shadcn-styled tooltip (`--popover`, hairline border, `shadow-md`, tabular) with date header + value; a **spark dot** on the line; the last point is always dotted (`04` §6.1/§6.2).
- Number transitions tween ≤300ms, **never reflow width** (tabular) — no odometer gimmicks (`04` §7).
- Tapping the change readout / its tooltip can deep-link to a fuller PnL explainer (`/learn/[slug]` "What counts as my PnL?").

### 3.4 States
- **Default:** full figure + change + chart at the default range.
- **Empty (no positions):** the *whole portfolio* is in its empty state — see §7.1 (the hero is replaced by the empty invitation, not shown as `$0.00` with a dead chart). *Exception:* a user who has **only idle wallet balance** (e.g. USDC, no Aave/vault) is **not empty** — show the real figure and a flat/short chart.
- **Loading:** `Skeleton` for the figure + a chart-height shimmer (never a spinner over a stale number, never `0` as a placeholder — `07` §5.5).
- **Success:** (post-deposit/withdraw return) the figure tweens to the new value; a `Sonner` toast already fired on `/confirm` — the hero just reflects it.
- **Warning (stale data):** label "as of {time}" + a subtle stale indicator (`07` §5.5); never present old as live. If a price source is degraded beyond tolerance, mark affected values stale (`data-model.md` VR-DS2) — see §8.
- **Error (can't load):** `Alert` (recoverable) with retry + the **custody reassurance** ("Your funds are safe and untouched.", `07` §6.1) — the portfolio reader being down never implies funds are at risk; withdraw remains reachable via the shell.

**Microcopy (defer to `07`):** never lead the hero with a *return projection* (the figure is a current state, fine; a *projected* number is banned — `07` §9.1 #3). PnL always carries its window (`07` §5.3). No bare percentages.

---

## 4. Section B — Risk panel (THE differentiator)

**Purpose:** Make risk a **first-class, legible dimension** — the thing every competitor lacks (`09` §2). Three reads, in priority order: **(1) portfolio risk score**, **(2) concentration**, **(3) drift vs the user's target risk profile** (the mandate from Flow 1). Ties to robo-advisor "on/off track" language (**Betterment** goal-vs-target, `09` §4).

> **Color discipline (hard):** risk uses the **§2.5 risk palette** (teal→magenta), its **own** system — **never** semantic green/red (so "higher risk" never misreads as "loss/error"). Every risk indicator carries a **numeric step (n/5) or word label + a filled-segments meter** so it's legible without hue (`04` §2.5, §10.2). At launch the live vault is **Risk 1 (Lower)**; most users read 1–2.

### 4.1 Anatomy → shadcn
| Sub-component | What it shows | shadcn | Notes / `04`/`07` |
|---|---|---|---|
| **Portfolio risk score** | A single tier read for the whole portfolio: **`n/5` + word label** ("Lower · 1/5") + a 5-segment meter filled to the tier, colored from the risk palette. Plus a one-line plain gloss. | `Badge` (risk-palette variant) + custom segmented meter | `04` §2.5, §6.5; never color-only |
| **"How is this scored?"** | Progressive-disclosure rationale: the dimensions behind the score (concentration, protocol exposure, asset volatility) in plain language — borrowing the four-dimension framing (smart-contract / centralization / market / operational, `09` §3 PolicyLayer) but **stated for retail**. | `Accordion` / `Popover` (desktop) / `Sheet` (mobile) | progressive disclosure; `07` §4 literacy tone |
| **Concentration** | Plain warnings when too much sits in one asset/protocol/position, e.g. "{N}% of your portfolio is in {asset/protocol}." Threshold-driven; neutral when healthy. | list rows + `--caution` `Alert` when over threshold (icon + text, not color-only) | `07` §6.3 warning tone; `04` §2.4 |
| **Protocol-exposure breakdown** | Where risk concentrates by protocol (Aave v3 vault / Aave direct / idle). Compact bar or list with %. | small stacked bar / list + tabular % | `09` §2 ("protocol-exposure breakdown") |
| **Drift vs target** | The mandate's target tier vs the portfolio's *current* tier, with an "on track / drifting / off track" read and the **delta**. e.g. "Your plan: Lower (1/5). Right now you're carrying Moderate (3/5) — above your plan." | a two-marker meter (target marker + current fill) + `Badge` status | Betterment on/off-track (`09` §4); ties to mandate (Flow 1) |
| **Act-on-risk CTA** | One next step when drifting/concentrated: "See lower-risk options" → `/strategies`, or "Ask AI about this" → `/chat`. **Secondary**, never spark unless it's the single primary on the panel; routes out (never signs here). | `Button` (secondary/outline) | `07` §2.2; routes to Strategies/Chat |
| **Literacy tip** | First encounter of "concentration", "drift", "risk tier" → contextual `--info` tip card, dismissable, links `/learn/[slug]`. | `Card`/`Popover` `TipCard` (`--info` blue) | `07` §4.2; **info ≠ green** |

### 4.2 Drift logic & honest framing
- **Drift is read against the mandate** (the spine — `01-IA` §4.2.1). If **no mandate yet** (user skipped/edited), the drift sub-panel shows a neutral prompt instead of a fake target: "Set your plan to see whether your portfolio matches your risk target." → `/onboarding` or `/settings/mandate`. **Never fabricate a target.**
- **Above-plan = caution, not block.** Drift/concentration are *informational* on this read-only surface — there is no signing here, so **never** style them as a hard error. Use `--caution` amber (icon + text), reserve `--destructive` red for *actual blocked actions*, which happen on `/confirm`, not here (`04` §2.4; `07` §6.3 vs §6.1).
- **Honest both ways:** if the user is *more conservative* than their plan, say so plainly too ("below your plan — you may be leaving yield on the table, at lower risk"), without pushing risk. Capital-preservation-first (brief).

### 4.3 Desktop / mobile
- **Desktop:** tall card in the right column (recommend sticky), score at top, then concentration, protocol exposure, drift; "how is this scored?" expands inline.
- **Mobile:** full-width card directly under the hero (high priority — it's the differentiator; do not bury it below allocation). Disclosures as `Collapsible`/bottom `Sheet`. 44px targets.

### 4.4 States
- **Default:** score + concentration (healthy = neutral) + exposure + drift (on/near target).
- **Warning:** concentration over threshold and/or drift above-plan → `--caution` rows + a plain "what this means" + the act-on-risk CTA.
- **Empty / no-mandate:** drift sub-panel shows the "set your plan" prompt (above); score still computes from holdings if any.
- **Empty / no-positions:** the panel is part of the global empty state (§7.1) — don't render a meaningless "0/5".
- **Loading:** `Skeleton` for score meter + rows.
- **Error / stale:** if risk inputs are stale/degraded, label the panel "as of {time}" or "risk read unavailable right now — your funds are safe and withdrawable" (`07` §6.1) rather than a confident wrong number; never block withdraw.

**Microcopy (defer to `07`):** plain, sober, non-alarmist; never euphemize ("drawdown opportunity" is banned — `07` §9.3); never imply the AI will *fix* risk autonomously (it suggests; you sign — `07` §2.1).

---

## 5. Section C — Allocation (asset / strategy / RISK TIER) + Positions table

### 5.1 Allocation visualization
**Purpose:** Show the mix three ways, with **risk tier as a first-class view** (not just asset class). Benchmark: a **donut/ring by asset class AND by strategy/vault**, plus the risk dimension (`09` §2, line 54).

**Anatomy → shadcn / Recharts:**
- **View switcher:** **Asset · Strategy · Risk tier** as `Tabs`/`ToggleGroup` above the donut. (Asset = USDC / ETH / vault shares / idle; Strategy = Aave Yield Vault / Aave direct / idle wallet; Risk tier = grouped by §2.5 tier.)
- **Donut:** Recharts `PieChart` with `innerRadius`; center label = **total + position count** (`04` §6.3).
  - **Risk-tier view** colors slices **directly from the §2.5 risk palette** (teal→magenta) — so the donut *is* a risk read.
  - **Asset / strategy views** use the **categorical ramp** (risk-1, risk-3, risk-5, neutral) — distinct, legend-labeled, never color-only.
- **Legend:** right (desktop) / below (mobile); each row = swatch + label + `%` (tabular) + `$` (tabular). Slices `<3%` collapse into **"Other"** with disclosure (`04` §6.3).
- **States:** *Default* donut + legend. *Single-position* (one slice) renders cleanly (no broken ring). *Loading* = skeleton ring + legend rows. *Empty* = part of global empty state (§7.1). *Error* = "No data yet" centered, never a broken axis (`04` §6.1).

### 5.2 Positions table (with inline row actions)
**Purpose:** The legible per-position ledger with **inline actions** — borrowing **Zapper's** "dashboard rows carry actions, not read-only display" (`09` §2). We adopt **Add / Withdraw / Ask AI** per row.

**Columns (desktop `Table`, right-align all numerics, tabular):**
| Column | Content | Format / `07` |
|---|---|---|
| **Position** | Icon + name + kind chip: idle USDC/ETH (`token_balance`), "Aave v3 · USDC/ETH" (`aave_supply`), "Aave Yield Vault" (`vault_shares`). | plain labels; whitelist only |
| **Balance / amount** | Token amount (e.g. `1,234.56 USDC`); for vault, **shares + fiat-equiv beneath** (`1,024.5031 spvUSDC` / `≈ $1,031.20`). | `07` §5.1/§5.4 |
| **Value** | Current USD value, tabular; abbreviate in dense cells, full on hover. | `07` §5.1 |
| **Net APY** *(yield-bearing rows only)* | `4.2% net APY` + breakdown ≤1 tap (Aave supply − 10% performance fee, profit-only, HWM). **Never bare APY.** En-dash `—` for non-yield rows (idle). | `07` §5.2; `04` §3.4 |
| **PnL** | `+$312.40 (+2.8%)` with sign + color + triangle + **window**; realized vs unrealized labeled or disclosed. Accrued yield shown for Aave/vault rows. | `07` §5.3; `data-model.md` §6 |
| **Risk** | Risk chip from §2.5 (`n/5` + label + mini-meter). | `04` §2.5; never color-only |
| **Actions** | **Add · Withdraw · Ask AI** (inline). | see below |

**Inline row actions (the Zapper pattern, our version):**
- **Add** → routes to deposit intent (`/vault/deposit` for the vault; Aave deposit for an Aave position) → builds a `txIntent` → `/confirm`. **Never signs in the table.**
- **Withdraw** → routes to `/vault/withdraw` or Aave withdraw intent → `/confirm`. Withdraw is **always available** on every holding (non-custody — even in degraded mode the manual/on-chain path persists; `01-IA` §6).
- **Ask AI** → opens `/chat` primed with this position as context (Flow 2). The spark "AI presence" affordance.
- Action set: **desktop** = a compact button group or an overflow `DropdownMenu` per row (keep ≤1 spark — these are secondary actions, not spark CTAs); **mobile** = the position becomes a `Card` with the actions in a footer row / overflow / bottom `Sheet`.

**Row → detail:** clicking the position name/row opens **`/portfolio/positions/[id]`** (§6).

**Sort/filter (light):** sortable by value / PnL / risk (desktop column headers). Default sort = value descending. Keep it simple — progressive disclosure, not a data-grid (`09` §2 anti-overstuff). "No matches" empty per `07` §6.2 if a filter is applied.

**Mobile transform:** `Table` → stacked **position `Card`s**: header (icon + name + risk chip), a 2-col mini-grid (value · PnL · APY · balance), footer actions. 44px targets, tabular numerals preserved.

### 5.3 Table states
- **Default:** rows/cards populated.
- **Loading:** `Skeleton` rows (≈3–5) at table height; never `0` placeholders.
- **Empty:** global empty state (§7.1) — there is no "empty table with headers"; show the invitation.
- **Partial / stale:** a single position can be `is_stale` → row carries an "as of {time}" / stale marker (`07` §5.5), value still shown but labeled; withdraw still works.
- **Error (a row failed to resolve):** the row degrades to name + "couldn't load value right now" with a retry, **not** a broken `$0.00`; the rest of the table renders.

---

## 6. Single-position detail (`/portfolio/positions/[id]`)

**Purpose:** Drill into one holding: **realized + unrealized PnL, history, and the actions**. Benchmark: **Zerion** per-protocol position pages with **performance attribution** — but with our **explicit, tooltip'd PnL definitions** and risk read (`09` §2). Also mirrors the vault "your position" sub-panel where the position is the vault (`09` §3 line 69).

### 6.1 Anatomy
- **Header:** position name + kind + **risk chip** (§2.5); current **value** (tabular, full precision); the inline **Add / Withdraw / Ask AI** actions (same routing as §5.2 → `/confirm` / chat).
- **PnL block (explicit):**
  - **Total PnL** (signed, colored, triangle, window) **broken into Realized + Unrealized**, each labeled and tooltip'd (realized = from closed/withdrawn portions; unrealized = mark-to-current-snapshot, "not banked"). **Never let unrealized read as banked** (`07` §5.3).
  - **Cost basis** (average-cost) and **accrued yield** (for `aave_supply` / `vault_shares`) shown plainly (`data-model.md` §6, §9).
  - For **vault** positions: **shares held** + **share price** + **underlying value** + **your realized yield** (`09` §3 line 69), with the spvUSDC share gloss on first encounter (`07` §4.3 "count fixed, value floats").
- **History:** a per-position event ledger (deposits / withdrawals / yield accrual / redemptions) — `Table`/timeline, each with amount, time (relative + absolute on hover), and a **"View tx ↗"** onchain proof link (proof, not promise — `07` §2.5). Optional small per-position value/PnL-over-time chart (same chart style, §3; spark stroke; no projections).
- **Risk context:** this position's contribution to portfolio concentration/exposure (ties back to §4) — "this is {N}% of your portfolio."
- **Linked recommendation (if any):** if the position came from an acted-on recommendation, link to its **Outcome Log** entry (`/activity/[entryId]`) — closes the proof loop (`01-IA` §4.2.4). "From the {date} recommendation · see the original advice."
- **Provenance:** "as of {block/time}", reconstructable (`data-model.md` §6).

### 6.2 Layout
- **Desktop:** header band; two-column body (PnL + cost basis + risk context left; history ledger + chart right) or stacked; actions in the header, repeated bottom-anchored is optional.
- **Mobile:** stacked — header + actions, PnL block, vault/shares block, history ledger (collapsible), risk context. Actions bottom-anchored.

### 6.3 States
- **Default:** populated.
- **Loading:** `Skeleton` for header value, PnL block, history rows / chart.
- **Empty history:** "No activity yet for this position." (neutral) — only plausible for a just-opened position.
- **Not-found:** `not-found.tsx` — "We couldn't find that position." + link back to `/portfolio`.
- **Error / stale:** recoverable `Alert` + retry + custody reassurance; stale values labeled; **Withdraw remains available** even if reads fail (`01-IA` §6; non-custody).

---

## 7. Cross-cutting states (the six required, per surface)

Every surface ships **default · empty · loading · success · warning · error** where applicable (brief §4; `04` AC#9; `07` §6).

### 7.1 Empty state (FR-013, VR-P2 — empty, never error)
- **Trigger:** zero positions (no idle balance, no Aave, no vault).
- **Treatment:** replace the dashboard with a single **empty-state `Card`** (Lucide icon + microcopy + one CTA) — **not** a `$0.00` hero with dead chart/donut/table.
- **Copy (canonical, `07` §6.2):** title **"Nothing here yet"** · body **"Once you deposit, your balance, yield, and risk show up here."** · CTA **"Explore the vault"** (→ `/vault`).
- **Trust touchpoint:** the empty state still sits inside the shell with the non-custodial badge + disclaimer; reassuring, an invitation not a failure (`07` §6.2). (Edge: **only idle wallet balance, no positions** = NOT empty — show the real, possibly small, figure + an "put idle USDC to work?" nudge to `/vault`, never auto-acting.)

### 7.2 Loading
- **Skeletons** at the shape of each section (hero figure + chart, risk meter + rows, donut + legend, table rows). Never a spinner over stale numbers; never `0` as a placeholder; shimmer per `04` §7; honor reduced-motion (`07` §5.5; `04` §7).

### 7.3 Success
- The portfolio is read-only, so "success" is **reflecting a completed action**: after a deposit/withdraw confirmed on `/confirm`, returning here shows the updated figure/positions (number tweens ≤300ms, no width reflow). The `Sonner` toast + `/notifications` entry already fired on `/confirm` — don't re-celebrate here (`07` §2.5; `04` §7).

### 7.4 Warning (stale / drift / concentration)
- **Stale data:** label "as of {time}" + subtle stale indicator; if a source is degraded beyond tolerance, mark affected values stale and **never present old as live** (`07` §5.5; `data-model.md` VR-DS2). No execution proceeds on stale data — but that gate lives on `/confirm`, not here.
- **Drift / concentration:** `--caution` amber (icon + text), informational, with a next step (§4) — never a hard block on this read-only surface.

### 7.5 Error
- **Pattern (`07` §6.1):** {what happened} + {why if known} + {next step}, calm, no blame, **no raw RPC/revert strings** (a "Details" disclosure may show raw for power users), and **custody reassurance**: "Your funds are safe and untouched." Retry available.
- **Degraded backend (`01-IA` §6, `spec.md` edge cases):** portfolio may show a **stale/unavailable banner**; the canonical degraded copy applies — *"SparkPoint's AI is temporarily unavailable. You can still view your portfolio and **withdraw anytime** — your funds never depend on us being online."* (`07` §6.1). **Withdraw path is never removed** by any error/degraded state (hard IA rule, `01-IA` §6).

---

## 8. Non-custody / trust touchpoints in Portfolio (mandatory)

The Portfolio is read-only, but it is a **trust surface** — it must never imply custody or autonomous action:

1. **Persistent shell affordances present** (inherited, `01-IA` §2): non-custodial badge → prove-it panel, disclaimer strip with [Prove it] / [Exit anytime], wallet menu → "view exact permissions". ≤1 tap to proof + exit, desktop and mobile.
2. **Withdraw is always offered** on every holding (row action + position detail) and **survives degraded mode** — even if the reader is down, the manual/on-chain withdraw path persists (`spec.md` SC-003; `01-IA` §6). Withdraw framing positive/empowering, never "cash out" (`07` §2.2).
3. **Every action routes out to `/confirm`** — the Portfolio **never signs**. Add/Withdraw build a `txIntent` and funnel to the single shared confirmation surface (`01-IA` §0.3, §4.2.3). No bespoke sign UI here.
4. **"Ask AI" is the AI-presence affordance, not an actor** — it opens chat (suggest), it does not execute. The AI never moves funds from the portfolio (`07` §9.1 #4).
5. **Custody reassurance on failure** — any load/transaction error reassures "your funds are safe and untouched" (`07` §6.1). The reader being down ≠ funds at risk.
6. **Provenance honesty** — onchain-derived, reconstructable, "as of {time}", stale-labeled; numbers are *provable, not asserted* (`data-model.md` §6; `07` §5.5).
7. **No return-led, no projections** — the Portfolio shows *current state and history only*; no projected net worth, no extrapolated APY (`07` §9.1 #2/#3; `04` §6.4 honesty rule).

---

## 9. Component inventory → shadcn/ui + Recharts mapping (this flow)

| Portfolio component | shadcn/ui / Recharts | Notes / ref |
|---|---|---|
| Net-worth hero | `Card` + Recharts `AreaChart` + `Tabs`/`ToggleGroup` (range) | Spark area; PnL colored by sign on the *number* only (`04` §6.2). |
| PnL definition / "as of" | `Tooltip`/`HoverCard` (desktop), `Popover` (mobile) | Plain definition → relevance (`07` §2.3). |
| Risk panel — score | `Badge` (risk-palette) + custom segmented meter | `n/5` + label + meter (`04` §2.5, §6.5). |
| Risk panel — "how scored?" | `Accordion`/`Popover`/mobile `Sheet` | Four-dimension framing, retail-plain (`09` §3). |
| Concentration / stale warning | `Alert` (`--caution`) + icon + text | Informational, not blocking (`04` §2.4; `07` §6.3). |
| Drift vs target | two-marker meter + `Badge` (on/off track) | Betterment on/off-track (`09` §4); ties to mandate. |
| Allocation donut | `Card` + Recharts `PieChart` (donut) + `Legend` | Risk-tier view = risk palette; asset/strategy = categorical ramp (`04` §6.3). |
| Allocation view switcher | `Tabs`/`ToggleGroup` (Asset/Strategy/Risk tier) | — |
| Positions table | `Table` (desktop) | Right-aligned tabular; inline actions (`09` §2 Zapper). |
| Positions (mobile) | stacked `Card`s | Header + mini-grid + footer actions. |
| Row actions (Add/Withdraw/Ask AI) | `Button` (secondary/outline) / `DropdownMenu` (overflow) / mobile bottom `Sheet` | Route to `/confirm` or `/chat`; never sign here. |
| Risk chip (per row/position) | `Badge` (risk-palette) + mini-meter | `n/5` + label (`04` §2.5). |
| Net APY readout | text + breakdown disclosure (`Popover`/`HoverCard`) | Never bare APY (`07` §5.2). |
| Shares + fiat-equiv | text (`.tnum`) | `1,024.5031 spvUSDC` / `≈ $value` (`07` §5.4). |
| Position detail — PnL block | `Card` + labeled rows + `Tooltip` | Realized/unrealized split (`07` §5.3). |
| Position detail — history | `Table`/timeline + "View tx ↗" | Onchain proof links (`07` §2.5). |
| Linked recommendation | link → `/activity/[entryId]` | Proof loop (`01-IA` §4.2.4). |
| Literacy tip | `Card`/`Popover` `TipCard` (`--info`) | Blue, not green; dismissable (`07` §4.2). |
| Empty state | `Card` + Lucide icon + microcopy + CTA | "Nothing here yet" (`07` §6.2). |
| Loading | `Skeleton` (figure / chart / meter / donut / rows) | `04` §7; `07` §5.5. |
| Error / degraded | `Alert` (recoverable) + retry; banner for degraded | Custody reassurance (`07` §6.1). |
| Toast (reflecting prior action) | `Sonner` | Fired on `/confirm`, not re-fired here (`07` §6.4). |

---

## 10. Accessibility (required, `04` §10)

- **Charts have text/table alternatives:** the area chart gets an `aria-label` summary ("Net worth $X, {up/down} Y% over {range}"); the donut's legend is the non-color read (swatch + **label + %**); the risk meter announces "{label}, {n} of 5". **No information by color alone** anywhere — PnL = sign + arrow + color; risk = number + label + meter; allocation = labeled legend (`04` §10.2).
- **Tabular numerals** on every figure (hero, PnL, APY, shares, %, value) — also aids low-vision scanning (`04` §3.1, §10.8).
- **Keyboard:** full operability — range `Tabs`/`ToggleGroup` (arrow keys), allocation switcher, sortable table headers, row actions, overflow menus (Esc closes), position-detail disclosures. Logical tab order top→bottom. **Visible 2px spark focus ring + offset** on every control (`04` §10.3/§10.4).
- **Touch:** 44px targets on mobile (range chips, view switcher, row/card actions, sheet items) (`04` §4.3).
- **Live updates:** use polite `aria-live` *sparingly* for the net-worth figure — don't spam SRs on every tick (`04` §10.6).
- **Reduced motion:** honor `prefers-reduced-motion` on chart scrub animation, number tweens, skeleton shimmer — instant/opacity fallback; no info conveyed by motion alone (`04` §7, §10.7).
- **AA contrast** both themes (dark default); risk-palette and semantic tokens are pre-tuned (`04` §2/§10.1).

---

## 11. Benchmark references (named, per `09`/research)

- **Net-worth hero + restraint:** **DeBank** — at-a-glance net worth + balances without overwhelming a newcomer; borrow the restraint, note the weakness (thin on risk) is *our* opening (`09` §2).
- **Per-position performance attribution + caution:** **Zerion** — per-protocol position pages with attribution; **but** criticized for clutter and shaky PnL, so **our PnL definitions stay explicit + tooltip'd** and we use progressive disclosure (`09` §2).
- **Inline row actions:** **Zapper** — "command center for action": dashboard rows carry actions (manage/withdraw/"Zap"), not read-only display → our **Add / Withdraw / Ask AI** per row (`09` §2).
- **The shared gap = our wedge:** the tracker comparison confirms all three lack risk identification + drift/time-based alerting → our **risk panel (score · concentration · drift-vs-target) + drift/cap notifications** are the differentiator (`09` §2).
- **Drift / on-track language:** **Betterment** goal-vs-target ("on/off track") → the drift-vs-your-target read (`09` §4).
- **Risk-score dimensions (retail-plain):** **PolicyLayer** four dimensions (smart-contract / centralization / market / operational) → the "how is this scored?" rationale, stated for retail (`09` §3).
- **Vault "your position" sub-panel:** **Gauntlet / Morpho** — shares held, share price, underlying value, your realized yield (`09` §3) → the vault position-detail block.
- **Charts on-style:** Recharts per `04` §6 (calm axes, styled tooltip, tabular, **no projected values, no whole-area red alarm**).
- **shadcn fintech scaffold:** the shadcn-fintech templates (`09` §7) for card grids, charts, dense dark-mode layout.

---

## 12. Acceptance criteria (this flow conforms when ALL hold)

1. **Three core reads present, both breakpoints.** Net-worth hero (figure + change + over-time area chart with range toggle), allocation (donut with **asset / strategy / risk-tier** views), and a **first-class risk panel**, all rendered at **1440px desktop and 390px mobile** (`spec.md` FR-009/010/011; `09` §2).
2. **Risk panel is the differentiator and complete.** It shows a **portfolio risk score (n/5 + label + meter)**, **concentration** warnings, **protocol exposure**, and **drift vs the mandate target** with on/off-track language and the delta — using the **§2.5 risk palette only** (never semantic green/red), always with numeric/label/meter fallback (brief; `09` §2/§4; `04` §2.5).
3. **PnL is explicit and honest.** Per-position and total PnL show **sign + color + triangle + window**; **realized vs unrealized are labeled/disclosed and never conflated**; losses shown as plainly as gains; **no flattering default time-window**; PnL definitions are tooltip'd (`spec.md` FR-010, SC-011; `07` §5.3; `09` §2).
4. **APY honest.** No bare APY on any yield-bearing row/position; every APY is **net, estimate-framed, with a breakdown ≤1 tap**; idle rows use en-dash, not a fake `0%` yield (`07` §5.2; `04` §3.4).
5. **Positions table with inline actions.** Each position offers **Add / Withdraw / Ask AI**; Add/Withdraw build a `txIntent` and **route to `/confirm` (never sign here)**; Ask AI opens chat in context; vault + Aave positions appear with current value and **accrued yield** (`spec.md` FR-012; `09` §2 Zapper; `01-IA` §0.3).
6. **Single-position detail complete.** `/portfolio/positions/[id]` shows **realized + unrealized PnL, cost basis, accrued yield, shares (for vault), history with onchain "View tx ↗" links**, risk contribution, and any linked Outcome Log entry (`spec.md` US-4; `09` §2/§3; `01-IA` §4.2.4).
7. **Empty is an invitation, not an error.** Zero positions → "Nothing here yet / Explore the vault", inside the shell, never a `$0.00`-with-dead-widgets screen or an error (`spec.md` FR-013, VR-P2; `07` §6.2).
8. **All states, every section.** default / empty / loading (skeletons, never `0`/spinner over stale) / success (reflect prior action) / warning (stale + drift/concentration, `--caution`) / error (what-why-next + custody reassurance, no raw tech) — at both breakpoints (brief §4; `07` §6; `04` AC#9).
9. **Provenance & no-projection honesty.** Figures are onchain-derived, "as of {time}", stale-labeled; **no projected net worth, no extrapolated APY, no return-led surface** (`07` §5.5/§9.1; `data-model.md` §6; `04` §6.4).
10. **Non-custody legible & exit-safe.** Persistent badge → prove-it and a **withdraw path are ≤1 tap from this surface** at both sizes; **Withdraw is offered on every holding and survives degraded mode**; the Portfolio **never signs**; failures reassure "funds are safe" (brief §2.2; `01-IA` §2/§6; `spec.md` SC-003; `07` §6.1).
11. **Charts on-style (Recharts).** Net-worth area = spark stroke + gradient, **down-range never recolors the whole area red**; allocation donut = risk-palette (risk view) / categorical (asset, strategy), legend-labeled, `<3%`→"Other"; calm axes, styled tabular tooltips, no projections (`04` §6).
12. **Design-system + content conformance.** Token-only color with the orthogonal three-system discipline (brand/outcome/risk never blur), spark scarcity (≤1 spark CTA/view; spark on AI-presence/net-worth area/focus only), tabular numerals everywhere financial, full keyboard + 44px targets + visible spark focus ring + reduced-motion + chart a11y, sentence case / second person / verb-first specific actions, banned words avoided (`04` AC; `07` AC).
13. **shadcn-mappable.** Every component resolves to a primitive/composition in §9 / `04` §11; charts via Recharts.
14. **Mandate spine honored.** The risk panel reads drift against the onboarding mandate; with **no mandate**, it prompts "set your plan" instead of fabricating a target, deep-linking `/onboarding` or `/settings/mandate` (`01-IA` §4.2.1; `spec.md` FR-003).

---

## 13. Cross-references

- **Routes:** `01-information-architecture.md` §1 `(app)/portfolio` + `portfolio/positions/[id]`, §3 nav, §4 flow graph, §6 gating/degraded.
- **Shell / persistent trust elements:** `01-IA` §2 (badge, wallet chip, disclaimer strip, prove-it panel) — inherited, not re-specified here.
- **Tokens / palettes / data-viz / motion / a11y / shadcn map:** `04-design-system.md` (§2 color, §2.5 risk palette, §3 type/numbers, §6 charts, §7 motion, §10 a11y, §11 component map).
- **All wording / PnL & APY & number formatting / tooltips / error+empty copy / banned phrases:** `07-content-and-tone.md` (§2 motifs/buttons/tooltips, §5 numbers, §6 error/empty/warning, §9 DOs/DON'Ts).
- **Benchmarks:** `09-references.md` §2 (DeBank/Zerion/Zapper + the gap), §3 (vault "your position"), §4 (Betterment on/off-track), §7 (shadcn scaffold).
- **Data shape / provenance:** `specs/001-sparkpoint-pivot-mvp/data-model.md` §6 (Portfolio/Position), §9 (Vault shares), §13 (Outcome Log link); `spec.md` FR-009–013, SC-011, US-4.
- **Downstream/linked flows:** Chat (Flow 2 — "Ask AI", `PortfolioSnapshotCard`), Strategies (Flow 4 — risk-panel "improve this"), Vault (Flow 5 — Add/Withdraw, "your position"), Confirmation (Flow 6 — where Add/Withdraw route), Outcome Log (`/activity` — linked recommendation), Onboarding/Settings (mandate target for drift).
