# Admin / Stakeholder Panel — Design Spec (Claude-Design-Ready)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-by-screen design spec for the **secret, admin-only** internal panel. Translates the plan at [`./README.md`](./README.md) into designer-ready screens: desktop-first layouts, stat cards, chart components (with Recharts types + data series), every state, RBAC-gated visibility, and the design-system mapping.
> **Reads-before (and defers to, in order):**
> - [`./README.md`](./README.md) — the authoritative plan: §0 non-custody/read-only-over-funds, §1 audiences, §2 access/RBAC/audit, §3 dashboards & chart specs, §4 data pipeline, §5 screen inventory, §6 tech, §7 roadmap. **Wins on data sources, RBAC, and the non-custody constraint.**
> - [`../design-handover/04-design-system.md`](../design-handover/04-design-system.md) — tokens, the three orthogonal color systems (brand spark / semantic / risk palette §2.5), tabular numerals §3.1/§3.4, data-viz §6, motion §7, iconography §8, a11y §10, component→shadcn map §11. **Every visual decision defers to `04`.**
> - [`../design-handover/05-trust-and-safety-ux.md`](../design-handover/05-trust-and-safety-ux.md) — kill-switch status (§3.5, pause-only, never red), caps meters (§3.4), the read-only/observe-only framing this panel mirrors.
> - [`../design-handover/06-component-library.md`](../design-handover/06-component-library.md) — reused custom components (KillSwitchStatus §19, CapsMeter §14, RiskChip §15, EmptyState §24, AlertBanner §25, AllocationDonut §20).
> - [`../design-handover/07-content-and-tone.md`](../design-handover/07-content-and-tone.md) — **canonical wording wins on any conflict.** Number/PnL/APY formatting §5; banned/required phrases §9; honest-projection rule.
>
> **What this doc IS:** the admin screen catalog — per-screen goal, entry points, desktop-first layout (sidebar nav + content grid), stat cards, charts (Recharts type + series + axes), states (default/loading/empty/error/no-permission/step-up), RBAC visibility, tablet/phone responsiveness, non-custody/read-only touchpoints, and acceptance criteria.
> **What it is NOT:** code, design tokens (`04`), canonical strings (`07`), the data pipeline internals (`README §4`), or a fee-authorizing document (`README §0` — this panel *visualizes* revenue, it never enables a fee).

---

## 0. The one hard constraint, restated for design — READ-ONLY OVER FUNDS

**Mirrors [`README §0`].** Every screen in this doc is **observe-only**. The panel answers *"what is happening?"* and *"is the system healthy?"* — never *"make it do X to a user's money."* This is a **design rule on every screen**:

1. **No fund-moving controls exist anywhere.** No "withdraw," "rebalance," "sweep," "force-redeem," "pause user," or any button that emits a transaction. If a control would *do* something to funds, it does not belong on the screen. There is no spark "primary action" CTA that moves value — **the spark accent is used only for active-nav, focus rings, and the AI-presence marker on AI-derived figures, never for a fund action** (`04` §2.3).
2. **The kill-switch is GOVERNED — pause-only, propose-&-sign, never executes.** *(Client-directed scope amendment vs the original "status-display-only" plan — see `README §0`; logged, not silent.)* On analytics screens (A5, A7, A8) the `KillSwitchStatus` component (`06` §19) renders in a **read-only status variant**: state pill + pause-only scope statement + **2-of-3 multisig** controller transparency, **no in-panel action**, linking to the dedicated **governed manual kill-switch screen (A12)**. On A12 itself an admin may **propose & sign** a pause/unpause, but the panel **can never _execute_** one — **execution requires the on-chain 2-of-3 multisig threshold**. The action is **pause-only** and **NEVER blocks withdrawals (N2)**, the confirm is **ack-gated**, and every propose/sign is written to a **history log** + the admin audit log. Per `05`/`07`, the kill-switch is **never red** — pause is reassurance, not alarm; signing a pause proposal moves **no funds**.
3. **The only "writes" the panel may proxy** are **non-custodial operational config** (whitelist invites, feature flags) on the Super-Admin/Ops `config` screen — these route through the product's existing governed path with their own audit, are **absent from Stakeholder/Client roles entirely**, and never touch a fund path. They are styled as ordinary form actions, never as spark fund-CTAs.
4. **Persistent observe-only marker.** Every screen carries a small, always-visible **"Observe-only · read-only over funds"** chip in the top bar `.opsbar` (the admin analogue of the product's **"fully self-custodial"** badge). It opens a one-tap explainer: *"This panel can watch SparkPoint and propose & sign a pause — but it cannot move a single unit of user funds. The kill-switch is pause-only and never blocks withdrawals; execution requires the on-chain 2-of-3 multisig threshold, not this panel."*
5. **Projection honesty (carried from `README §3` / Constitution III / `07` §5.2).** Every projected/estimated figure (forecast, run-rate, future-stream revenue lanes, expected APY) is **visually differentiated** — **dashed/hatched series + an "est." `Badge`** — and never presented as realized. Realized = solid; projected = dashed. A reviewer must be able to tell them apart at a glance.

---

## 1. Audiences, RBAC & the design consequence

**Mirrors [`README §1.1`, §2.3].** Four roles, each with a **different default landing screen, a different nav set, and server-side enforcement** (RBAC is enforced at the server, not by hiding UI — the design must assume a denied route returns a **404, never a 403**, for secrecy).

| Role | Default landing | Nav set (visible screens) | Never sees |
|---|---|---|---|
| **Super-Admin** | A1 Overview | All (A1–A12) | (nothing withheld; still no fund-movement — none exists; A12 kill-switch is propose-&-sign only, executes only at the 2-of-3 multisig threshold) |
| **Ops / Internal** | A1 Overview | A1–A8, A10, A11, A12 (no A9 Admin management) | A9; secret keys/config |
| **Stakeholder (read-only)** | A8 Stakeholder Overview | A1 Overview (curated), A5 TVL, A6 Revenue, A8 Overview — **aggregate only** | A2/A3 user detail, A4 usage, A7 system, A9/A10/A11; PII; config |
| **Client (read-only)** | A8 Stakeholder Overview | **A8 only** | Everything else (server-denied → 404) |

**Design consequences:**
- **Role-scoped nav by construction.** The sidebar renders only the screens the role can reach. A Stakeholder never sees a "Users" or "System" nav item; a Client sees a near-chromeless single screen. Never render a disabled/locked nav item a role lacks — **hide it** (`README §5` state conventions).
- **No-permission state = full-page 404** (`EmptyState`-styled but neutral, no "you don't have access to /users" confirmation). Secrecy: don't confirm a section's existence.
- **Step-up re-auth** gates per-user drilldown (A3) and the admin audit log (A11): a `Dialog` re-2FA challenge before the sensitive surface renders.
- **Pseudonymization by default** (`README §2.5`): user identifiers render as a truncated `user_ref` / masked `smart_account_address` (mono, `04` §3.1). Full-address reveal is **step-up + audited**, and **never available to Stakeholder/Client**.

---

## 2. Global shell, layout grid & design-system usage

**Desktop-first (data-dense, screen-share-ready).** Two canonical canvases for the admin panel: **desktop 1440px (design target)** and **tablet 1024px**; **phone is a degraded read-only courtesy view** (KPI cards + A8 Stakeholder Overview only; heavy tables/heatmaps collapse to a "Best viewed on desktop" `EmptyState`, `README §5`).

### 2.1 The admin shell (every screen)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR:  [Spark mark · SparkPoint Ops]   env=PROD ▸   ⟳ data fresh 42s ago         │
│           ……   [Observe-only · read-only over funds ⓘ]   {admin name · role ▸} ⏻    │
├──────────────┬─────────────────────────────────────────────────────────────────────┤
│ SIDEBAR NAV  │  CONTENT AREA (12-col grid, 24px gutters, max ~1280px)               │
│ (role-scoped)│                                                                       │
│ ◆ Overview   │  ┌ PAGE HEADER ─────────────────────────────────────────────────┐   │
│ ▷ Users      │  │ Page title (text-h1) · subtitle · [time-range ▾][granularity]│   │
│ ▷ Usage      │  │                                          [Export ▾ (audited)]│   │
│ ▷ TVL/Vault  │  └──────────────────────────────────────────────────────────────┘   │
│ ★ Revenue    │  ┌ STAT-CARD BAND (4 across desktop) ────────────────────────────┐   │
│ ▷ System     │  │ [KPI][KPI][KPI][KPI]  each: label·big tabular value·spark·Δ   │   │
│ ▷ Overview   │  └──────────────────────────────────────────────────────────────┘   │
│ ──────────   │  ┌ CHART GRID (2-col desktop / 1-col tablet) ────────────────────┐   │
│ ⚙ Admin      │  │ [ Recharts card ]            [ Recharts card ]               │   │
│ ⚙ Config     │  │ [ Recharts card (wide, 2-col span) ]                         │   │
│ ⚙ Audit log  │  └──────────────────────────────────────────────────────────────┘   │
└──────────────┴─────────────────────────────────────────────────────────────────────┘
```

- **Top bar (the `.opsbar` — left→right):** spark **AppLogo** ("SparkPoint Ops") · **env badge** (`PROD` red-outline / `STAGING` amber-outline — semantic, informational) · **global data-freshness stamp** ("data fresh {Xs} ago", with a `⟳` refresh) · the **Observe-only chip** (§0.4) · admin identity + a **role-switcher** ("View as": Super-Admin / Ops / Stakeholder / Client) · sign-out. **No wallet connect** — admin auth is separate from user wallet-connect (`README §2.2`).
  - **`.opsbar` is a plain, non-sticky, non-transformed block** (delivered design): `position: relative`, **no `position: sticky`**, **no `transform`** on the bar and no reliance on a transformed ancestor. This is deliberate — a `sticky`+`transform` combination was found to make browsers drop the bar ~1s after load. The body sits beneath it via a simple height chain (`.opsbody { height: calc(100% - var(--barh)) }`), not a sticky offset.
  - **The role-switcher is a CUSTOM (non-native) button-dropdown**, **not** a native `<select>` — `DropdownMenu`-style (`04` §11). The native control misbehaved inside an embedded/scaled iframe and had a mobile width quirk; the custom dropdown fixes both. See the **KNOWN ISSUE** note in §2.4 below.
- **Sidebar nav (left rail):** icons + labels, role-scoped (§1). Active item uses **spark `--spark-subtle` tint + spark left-border** (`04` §2.3 — active-nav is a sanctioned spark usage). Collapsible to icon-only with `Tooltip` (tablet default-collapsed).
- **Page header:** `text-h1` title + one-line subtitle, the **global time-range selector** (`Tabs`/`ToggleGroup`: 24h / 7d / 30d / 90d / YTD / All), a **granularity** toggle (day/week/month) where applicable, and an **Export** affordance (`DropdownMenu`: CSV / PNG — **audited + role-gated**, absent for roles without export).
- **Stat-card band + chart grid:** 12-col grid, 24px gutters; stat cards 4-across desktop, 2-across tablet, 1-across phone; charts 2-across desktop, 1-across tablet/phone.

### 2.2 Design-system usage (the admin reuses the product's language — `04`)

- **Dark-first** (`04` §2.2); light is the supported second theme. Elevation via **surface step + hairline `--border`**, shadow only on overlays (`04` §5).
- **Three orthogonal color systems, never crossed (`04` §1):**
  - **Spark accent** = active-nav, focus rings, and the **AI-presence marker** on AI-derived/forecast figures (the "est." badge on a forecast may carry a spark tint to denote "model output"). **Never** for gains/loss/risk/revenue-up.
  - **Semantic** (green/red/amber/blue) = outcome & safety: deposit/withdraw direction, success/fail rates, health tiles, deltas (▲ green / ▼ red), env badge. **Every semantic state pairs color + icon + text** (`04` §10.2).
  - **Risk palette** (teal→magenta, `04` §2.5) = risk *tier* only: risk-tier distribution, allocation-by-risk. The launch vault reads **Risk 1 (Lower)**.
- **Chart palette (`04` §2.6, §6):** categorical ramp derived from risk + neutral systems; horizontal grid lines only at ~40% `--border`; axes `--muted-foreground` `text-xs` **tabular** ticks; custom shadcn-styled tooltips (`--popover`, 1px border, `shadow-md`); **every value tabular** (`04` §3.4, `07` §5).
- **Revenue-stream color contract (`README §3.5`):** **one color per revenue stream, consistent across every chart** (swap fee, premium tier, perf fee — all three active/solid — plus [projected] mgmt fee, [projected] SRK, treasury float). Projected streams render dashed/hatched + "(projected)" in the legend; active streams render solid. Derive these from the categorical ramp; **do not reuse the semantic green/red** (revenue is not "gain/loss").
- **Tabular numerals everywhere financial** (`04` §3.4, `07` §5): all $, %, bps, counts, share prices. Currency `$1,234.56`, abbreviate dense cells `$1.23M`/`$45.6K` (full precision on hover). Net APY rule applies — "X% net APY," never bare (`07` §5.2). PnL/flows = sign + color + arrow + window.
- **Typography (`04` §3):** `text-h1` page titles, `text-h2`/`h3` card titles, `text-display` for hero stat numbers, mono for addresses/hashes/tx (`04` §3.1).
- **Motion (`04` §7):** skeleton shimmer on load; number tweens ≤300ms with **no width reflow** (tabular); `prefers-reduced-motion` honored. No casino motion.
- **A11y (`04` §10):** WCAG AA both themes; charts carry `aria-label` summaries ("Revenue this period $X, up Y% MoM") + a table alternative (the revenue history table doubles as the chart's text equivalent); 2px spark focus ring; full keyboard operability; no color-only signals.

### 2.3 Universal state conventions (every screen — `README §5`)

- **Loading** — `Skeleton` stat cards + chart-frame shimmer; **never a blank flash, never `0` as a placeholder** (`07` §5.5).
- **Empty (pre-launch)** — **zeroed-but-styled** visuals + purposeful copy ("No data yet — launches Sept") so a demo never looks broken (`EmptyState`, `06` §24).
- **Error** — **per-widget** inline `AlertBanner` (`06` §25) + retry + **source/provenance note** ("source: RPC · 42s ago" / "Stripe · live" / "materialized · 03:00"). **One failing source never blanks the whole page.**
- **No-permission** — **server-side 404** for sections a role can't see (secrecy). Within a page, hide (don't disable) controls a role lacks.
- **Provenance on every chart** — a small source+freshness caption ("RPC, 42s ago" / "materialized, 03:00"); **projected/estimated values always flagged** (dashed + "est.").

### 2.4 ⚠ KNOWN ISSUE (NOT confirmed fixed) — ops top bar in the Showcase's scaled iframe

**Document, do not claim fixed.** When the Admin panel is opened **inside the Showcase's _scaled_ desktop iframe** (the Showcase renders the panel in a `transform: scale(...)`-ed 1440 desktop frame and a 390 phone frame), the **ops top bar (`.opsbar`) can flicker or disappear after ~1s in some browsers** — a **transformed-ancestor + iframe compositing quirk** (a transformed *ancestor* can break descendant layout/compositing). The `.opsbar` has already been de-stickied/de-transformed (§2.1) and the role-switcher de-nativized, and live measurement in a real browser showed the bar `display:flex`, full height, visible, stable past 4.5s — **yet the client still reports the vanish, so this is explicitly NOT confirmed fixed.**

- **Workaround:** **open Admin in its own tab** (`SparkPoint Admin.html` standalone), where the bar is stable.
- **Tooling caveat:** preview/html-to-image screenshots **cannot rasterize the bar** (inline `<svg>` gradients) and may show a false "blank bar" — verify in a real browser (watch `.opsbar` computed `display`/`height` across the first ~2s; confirm the `?v=` admin loads fresh, not cached).
- **Next steps to investigate:** de-scaling the desktop frame, caching/service-worker freshness of the embedded admin file, and the transformed-ancestor compositing interaction. Do **not** reintroduce `position:sticky`/`transform` on `.opsbar` as a "fix."

---

## 3. Screen inventory (routes under the secret base path — `README §5`)

| # | Route | Audience | Purpose | Key states |
|---|---|---|---|---|
| **A0** | `/login` | all admins | SSO/2FA entry (separate from wallet-connect) | default · 2FA-challenge · error · locked-out · denied |
| **A1** | `/` Overview/Home | Super-Admin, Ops (curated → Stakeholder) | North-star KPIs | loading · empty(pre-launch) · error · partial-source-error |
| **A2** | `/users` User analytics | Super-Admin, Ops | User KPIs, funnel, cohorts | loading · empty · error · **no-permission (404)** |
| **A3** | `/users/[ref]` Per-user drilldown | Super-Admin, Ops (step-up) | Observe one user | loading · empty · error · no-permission · **step-up-required** |
| **A4** | `/usage` Usage/product | Super-Admin, Ops | AI & product mechanics | loading · empty · error · no-permission |
| **A5** | `/tvl` TVL & vault | Super-Admin, Ops, Stakeholder | The money view | loading · empty(no deposits) · error |
| **A6** | `/revenue` **Revenue dashboard** | Super-Admin, Ops, Stakeholder | **Central revenue view** | loading · **empty/pre-revenue** · error · partial-source-error |
| **A7** | `/system` System/ops health | Super-Admin, Ops | Health & guardrails | loading · healthy-empty · error(monitoring-down) · no-permission |
| **A8** | `/overview` Stakeholder/Client Overview | Stakeholder, Client (default), SA/Ops (preview) | Curated narrative | loading · empty(launching-Sept) · error · **export-mode** |
| **A9** | `/admin/users` Admin management | Super-Admin | Manage admins/roles | loading · error · no-permission |
| **A10** | `/admin/config` Non-custodial config | Super-Admin, Ops | Whitelist invites, feature flags | loading · error · no-permission · **confirm-change (audited)** |
| **A11** | `/admin/audit` Admin audit log | Super-Admin, Ops (step-up) | Forensics | loading · empty · error · **step-up-required** · no-permission |
| **A12** | `/admin/killswitch` **Governed manual kill-switch** | Super-Admin, Ops (step-up) | **Propose & sign** pause/unpause (pause-only · 2-of-3 multisig · executes on-chain · never blocks withdrawals) | loading · status-only(no pending) · **ack-gated confirm** · pending-signatures · error · no-permission |

---

## A0 — Login (SSO / 2FA)

**Goal.** Authenticate an admin via the SSO + 2FA + allowlist stack (`README §2.2`), **separate from end-user wallet-connect**, and make the secrecy/security posture felt without confirming the surface to outsiders.

**Entry points.** Direct navigation to the unguessable base path (`README §2.1`). Un-allowlisted/un-authenticated requests get a **404, not this screen** (the login page itself only renders for requests that pass the edge IP/geo allowlist).

**Layout (centered, single column, no sidebar).**
- Minimal centered `Card` on `--background`: spark **AppLogo** ("SparkPoint Ops") · env badge · **"Sign in with {SSO provider}"** `Button` (the one spark CTA on this screen — it is auth, not a fund action) · a quiet line "Admin access only. All actions are audited."
- After SSO: **2FA challenge** step (`Input` for TOTP / WebAuthn prompt) inside the same card.
- **No "forgot password," no self-serve sign-up, no wallet-connect** — provisioning is allowlist-only.

**States.**
- **Default** — SSO button + the audited-access note.
- **2FA-challenge** — code `Input` / WebAuthn prompt; resend/backup-code affordance; helper "Enter the 6-digit code from your authenticator."
- **Error** — `AlertBanner` (destructive) "We couldn't sign you in. Try again." (no detail that leaks why — no "user not found" enumeration).
- **Locked-out (rate-limited)** — `AlertBanner` (amber) "Too many attempts. Try again in {N} minutes." (`README §2.5` backoff/lockout).
- **Denied (not allowlisted)** — neutral generic failure, never "you're not an admin" (secrecy) — same copy as Error.

**Non-custody / read-only touchpoint.** Copy states admin auth grants **read access to analytics, never authority over funds** ("Signing in here gives you a window, not a lever.").

**Acceptance.** SSO + enforced 2FA + allowlist; no wallet-connect anywhere; rate-limit/lockout state designed; error copy never enumerates accounts; the audited-access note present; keyboard-operable; AA contrast; 404 (not this page) for un-allowlisted requests is a build invariant the design assumes.

---

## A1 — Overview / Home (north-star KPIs)

**Goal.** "How are we doing, right now, at a glance" — the landing for Super-Admin/Ops and the basis of the curated Stakeholder view (`README §3.1`).

**Entry points.** Default landing for SA/Ops; sidebar "Overview."

**Layout.** Stat-card band (4) → secondary stat row (4) → chart grid (3 charts).

**Stat cards (band of 4 — each: label · big tabular value · sparkline · delta vs prior period with semantic color + arrow):**

| KPI | Value | Sparkline (Recharts) | Delta |
|---|---|---|---|
| **TVL** (all vaults + Aave, USDC-quote) | `text-display` $ | mini `LineChart`, 30d | ▲/▼ % vs prior (green/red) |
| **Active users** (WAU default; DAU/MAU toggle in the card) | big number | mini `BarChart`, 30d | ▲/▼ % |
| **Cumulative revenue** (all streams, all-time) | big $ | mini `AreaChart`, cumulative | ▲ since launch |
| **MRR-equivalent** (normalized monthly run-rate) | big $ | mini `LineChart`, by month | ▲/▼ % MoM |

**Secondary stat row (4):** New users (period) · Net deposit flow (period, signed/colored) · Executions success rate (%) · **System status** (green/amber/red rollup from A7, links to `/system`).

**Charts:**
1. **Growth at a glance** — `ComposedChart` (wide, 2-col span). X = date; **left Y = TVL (`Area`, categorical-ramp fill)**; **right Y = active users (`Line`)**; shared 30/90d range. One glance ties money to people.
2. **Revenue snapshot** — small **stacked `AreaChart`** of cumulative revenue by stream (the revenue-stream color contract §2.2; projected lanes dashed); links into A6.
3. **Activity heat** — `BarChart` of **daily executions** with **explicit green/red colors** (semantic green = success stack, semantic red = fail stack — set fills explicitly, never the default categorical ramp).

**States.**
- **Loading** — skeleton cards + shimmer sparklines + chart frames.
- **Empty (pre-launch)** — zeroed cards + "No data yet — launches Sept" (`EmptyState` tone); charts render zeroed axes, not broken.
- **Error / partial-source-error** — **per-card / per-widget** inline retry (a failing TVL source never blanks the users card); provenance caption on each.

**RBAC.** Full for SA/Ops. The **Stakeholder** curated variant of this screen (reached as their landing or via A8) shows the **same KPI band + Growth + Revenue snapshot** but **drops the System-status secondary tile and any drill affordance** into per-user data.

**Non-custody / read-only touchpoint.** Observe-only chip in shell; System-status tile is a **read rollup**, links to status, never a control.

**Acceptance.** 4 north-star cards with sparkline + semantic delta; 3 charts (Growth `ComposedChart`, Revenue stacked `AreaChart`, Activity `BarChart`); per-widget error isolation; tabular everywhere; pre-launch empty looks intentional; both desktop + tablet layouts; Stakeholder variant strips drilldown.

---

## A2 — User analytics

**Goal.** Who the users are and how they behave — **pseudonymized by default; full reveal step-up + audited; Stakeholder/Client cannot reach this section** (`README §3.2`).

**Entry points.** Sidebar "Users" (SA/Ops only). Top-users table rows → A3 drilldown (step-up).

**Stat cards (band):** Total users · New users (period) · **DAU / WAU / MAU** (three-up, + **DAU/MAU stickiness ratio**) · Onboarding completion rate · Activation rate (% who deposit) · Churn (period).

**Charts:**
1. **Signups over time** — `BarChart` (new users/day) + overlaid `Line` (cumulative). X = date; Y-left = new; Y-right = cumulative.
2. **DAU / WAU / MAU** — multi-series `LineChart` (3 series). X = date.
3. **Onboarding funnel** — `FunnelChart` (or horizontal stacked `BarChart`) across the `onboarding_state` lifecycle: `prospective → wallet_connected → account_ready → mandated → active`; each step shows count + step-conversion %; the **drop-off step highlighted** (amber).
4. **Retention cohorts** — **cohort heatmap** (custom Recharts/`div`-grid; Recharts has no native heatmap): rows = signup-week cohort, cols = weeks-since-signup, **cell color = % retained on a risk-neutral sequential palette** (NOT the risk palette — `README §3.2`), with a `Tooltip` per cell.
5. **Geography** — `BarChart` of users by `geo_region` (coarse region from the edge geo-fence; informational, never a custody gate; no precise geo/PII).
6. **Wallet types** — `PieChart`/donut (`AllocationDonut` compact, `06` §20) of connector mix (WalletConnect / Coinbase / injected).
7. **Risk-profile distribution** — `BarChart`/donut of `mandates.risk_tier` (`conservative`/`moderate`/`growth`) using the **risk palette** (`04` §2.5; launch skews Risk 1–2).

**Top users by TVL** — sortable, virtualized `Table`: rank · pseudonymous ref (mono) · TVL · deposits · last active · # recommendations accepted. Export **audited**; **reveal-address = step-up + audited**.

**States.** Loading skeletons · empty cohort grid "Not enough data yet" · per-widget error · **no-permission = server 404 for the whole section** (Stakeholder/Client).

**Non-custody / read-only touchpoint.** Pseudonymized refs by default; the table has **no fund-action column** — only "view" (→ step-up drilldown). Reveal-address is gated + audited.

**Acceptance.** Pseudonymized by default; the 7 charts present with correct Recharts types (cohort heatmap on a sequential, non-risk palette; risk distribution on the risk palette); top-users table sortable/virtualized/export-audited; reveal step-up + audited; Stakeholder/Client get a 404; tablet reflows charts to one column, table scrolls horizontally.

---

## A3 — Per-user drilldown (`/users/[ref]`)

**Goal.** A single-user **observe-only** profile assembled from existing tables — Super-Admin/Ops only, **step-up required** (`README §3.2`).

**Entry points.** Top-users table row (A2) → step-up `Dialog` → this screen.

**Step-up gate.** Before render: a re-2FA `Dialog` ("Confirm your identity to view user detail — this view is logged."). On pass, the screen renders and the view is **written to the admin audit log** (meta-audit).

**Layout.** Header band → chart/table stack.
- **Header:** pseudonymous ref · `smart_account_address` (**masked**, mono; **[Reveal]** = step-up + audited) · onboarding state `Badge` · risk tier `RiskChip` (`06` §15) · joined date · last active.
- **TVL over time** — `AreaChart` (this user's positions value, USDC-quote).
- **Deposits / withdrawals** — diverging `BarChart` (deposits +, withdrawals −; semantic colors) from `vault_share_events` / Aave events.
- **Chat usage** — `BarChart` of messages/day — **counts only, no message content** (content is offchain + sensitive; the drilldown shows volume & outcomes, not transcripts — `README §3.2`).
- **Recommendations** — `Table` of `recommendations` (title · rank · status proposed/acted/blocked/executed · outcome label win/loss/flat) + acceptance-rate stat.
- **Session keys** — `Table` of `session_keys` (status active/expired/revoked/exhausted · scope summary · caps · `spent` vs `cumulative_cap` via inline `CapsMeter` · expiry) — **observe-only, no revoke control** (revoke is the *user's* onchain action — `README §3.2`).

**States.** Loading skeletons · empty (new user, "No activity yet") · per-widget error · **step-up-required** (gate not yet passed) · no-permission (404 for Stakeholder/Client).

**Non-custody / read-only touchpoint.** **Strictly read-only — no action affects this user or their funds.** Session-key table shows scope/usage but **no revoke button** (that power is the user's, exercised onchain). Address masked; reveal audited. Chat content never shown.

**Acceptance.** Step-up gate before render + the view audited; address masked with audited reveal; session keys observe-only (no revoke); chat shows counts not content; all four user-charts present; SA/Ops only (404 otherwise); both breakpoints.

---

## A4 — Usage / product analytics

**Goal.** How the AI assistant and product mechanics perform (`README §3.3`). Sourced from `chat_messages`, `recommendations`, `intent_bundles`, `simulation_results`, `executions`, `session_keys`, `literacy_tip_impressions`, `audit_logs`.

**Entry points.** Sidebar "Usage" (SA/Ops).

**Stat cards (band):** Chat volume (messages/sessions per period) · **Recommendation acceptance rate** · **Simulation pass rate** · **Execution success rate** · Session-key grants/revocations (period) · Literacy tip engagement (impression→expand %).

**Charts:**
1. **Chat volume & tool-step success** — `ComposedChart`: `Bar` = chat messages/day; `Line` = % agent tool-steps succeeded (coordinator/agent telemetry). X = date.
2. **Recommendation funnel** — horizontal stacked `BarChart` over the `recommendation_status` lifecycle: `proposed → acted_pending → (executed | blocked | abandoned | expired)`; surfaces **acceptance rate** and **policy-block rate**.
3. **Simulation pass/fail** — stacked `BarChart` per day (`passed` vs `will_revert` vs `slippage-blocked`) from `simulation_results`.
4. **Execution success/failure** — stacked `BarChart` (`confirmed` vs `reverted` vs `declined` vs `dropped`) from `executions.status` + a `Line` of success-rate %.
5. **Session-key grants vs revocations** — grouped `BarChart` over time (grants +, revocations −) from `session_keys` register/revoke events.
6. **Literacy engagement** — `BarChart` of tip impressions by `trigger_context` + an expand-rate `Line`.
7. **Feature adoption** — `BarChart` of % of active users who used each feature (chat, vault deposit, Aave supply, swap, session keys, outcomes view) in the period; optional per-feature trend `Line`.

**States.** Loading skeleton · empty = zeroed · per-widget error · no-permission (404 for Stakeholder/Client).

**Non-custody / read-only touchpoint.** Pure telemetry; no controls. A high policy-block rate is framed as a **product signal**, not an alarm (neutral/amber, never destructive-red unless it's an error rate).

**Acceptance.** 7 charts with correct Recharts types (the funnels as horizontal stacked bars; sim/exec as stacked bars + success-rate line); semantic colors on pass/fail; SA/Ops only; tablet single-column; tabular.

---

## A5 — TVL & vault analytics

**Goal.** The money view — onchain truth, reconstructable (`README §3.4`). Sourced from `vaults`, `vault_share_events`, `indexed_positions`, `onchain_events`, `price_snapshots`, + DeFiLlama/subgraph cross-checks. Visible to **Stakeholder** (aggregate).

**Entry points.** Sidebar "TVL/Vault" (SA/Ops/Stakeholder).

**Stat cards (band):** Total TVL · Per-vault TVL (one conservative vault at launch; designed for N) · **Net flow (period)** (signed/colored) · **Cap utilization %** (TVL / `total_protocol_cap`) · Current **share price** · **Trailing APY** (net) · # depositors.

**Charts:**
1. **Total & per-vault TVL over time** — stacked `AreaChart`: X = date, Y = TVL (USDC-quote), **one stacked series per vault** (single series at launch; stacking future-proofed).
2. **Deposits / withdrawals & NET FLOWS** — the **heartbeat chart**: diverging `BarChart` (deposits positive, **semantic green**; withdrawals negative, **semantic red**) + overlaid **net-flow `Line`** (cumulative or per-period).
3. **Caps utilization** — `RadialBarChart` (or horizontal `BarChart` with a `ReferenceLine` at the cap): `total_protocol_cap` utilization + aggregate per-user-cap headroom; **amber as utilization nears the cap** (reuse `CapsMeter` semantics, `06` §14 — spark/healthy → amber ≥~80% → destructive at cap).
4. **Share price / APY history** — dual: `LineChart` of `share_price_ray` over time + a separate `LineChart`/`AreaChart` of trailing APY (7d/30d annualized from share-price growth). APY labeled **"realized, net-of-everything (net of the 10% profit-only performance fee; 0% management, 0% on principal)"** (`07` §5.2 — never bare, never projected).
5. **Withdraw-always drill status** — a **status panel (not a chart)**: last successful **withdraw-always drill** timestamp/result (the quickstart drill: redeem with frontend + agents offline, while paused), current **pause status** (read-only, from `KillSwitch` via `KillSwitchStatus` read-only variant, `06` §19), and a green/red badge. **Status only — no controls.** Makes the N2 guarantee observable.

**States.** Loading skeleton · empty (pre-deposit) = zeroed + "Vault live, no deposits yet" · per-widget error with a "data source: RPC/subgraph" provenance note.

**Non-custody / read-only touchpoint.** **This is the screen where read-only-over-funds is most load-bearing.** TVL/flows/share-price are **display-only, never a gate**. The withdraw-always drill panel + kill-switch status make the non-custody guarantee *observable* — both are **status-only here, zero controls** (the kill-switch panel on A5 is read-only and **links to the governed kill-switch screen A12** for propose & sign; even on A12 the panel only proposes & signs, execution is the on-chain 2-of-3 multisig). Per `05`/`07`, kill-switch is **never red**.

**Acceptance.** TVL stacked area (future-proofed for N vaults); diverging deposit/withdraw bars + net-flow line; caps utilization with cap reference line + amber-near-cap; share-price + net-APY lines (labeled realized, never projected); withdraw-always drill + kill-switch **status panels with no controls**; provenance notes on RPC/subgraph widgets; Stakeholder sees aggregate; both breakpoints.

---

## A6 — Revenue dashboard (CENTRAL — the centerpiece)

**Goal.** Show **revenue in action, graphically** — the screen we screen-share with the client (`README §3.5`). Visualizes the streams from [`../revenue-model/README.md`]: **launch-era (active)** = swap-routing fee (if/when enabled) + premium AI subscription + **vault performance fee** (10% of realized yield only, profit-only, high-water mark; cap 20%, default 10%); **future/projected** = optional management fee, SRK fee-share/buyback. **Realized = solid; projected = dashed + "est." badge — everywhere; only genuine forecasts are dashed.** Visible to **Stakeholder**.

**Entry points.** Sidebar "Revenue" (★, SA/Ops/Stakeholder). Linked from A1 Revenue snapshot and A8.

**Stream taxonomy (one consistent color per stream — §2.2 color contract):**

| Stream | Status at launch | Render |
|---|---|---|
| **Swap-routing fee** (Aerodrome swaps from chat) | **Launch-era, ACTIVE** (~20 bps; early volume may be low (first-N-free)) | solid lane |
| **Premium AI subscription** (SRK-paid freemium Premium tier; Stripe-or-equiv normalized) | **Launch-era, ACTIVE** (modeled now) | solid lane |
| **Performance fee** (Aave Yield Vault, realized yield only, HWM) | **ACTIVE · v1** (active in v1 per constitution v1.1.0 — 10% of yield, profit-only, high-water mark; cap 20%, default 10%) | **solid/realized lane (never dashed, never "not active at launch")** |
| **Management fee** (≤0.25%, multi-strategy only) | **Future / projected** | dashed lane + "(projected)" |
| **SRK fee-share / buyback** | **Future / projected** | dashed lane + "(projected)" |
| **Treasury float** (own capital) | Phase-0, non-user | informational, labeled "non-user" |

**Stat cards (band — each with sparkline + delta):** **Cumulative revenue** (all-time) · **Revenue this period** · **MRR-equivalent** + **ARR-equivalent** · **Run-rate** (annualized current period) · **ARPU** (revenue/active user) · **Revenue per vault** · **Blended take-rate** (revenue ÷ volume-or-TVL, in bps).

**Charts (each fully specified — the hero set):**
1. **Revenue by STREAM, stacked over time** (HERO) — **stacked `BarChart`** (or stacked `AreaChart` for a smoother trend). X = time (day/week/month via granularity toggle); Y = revenue (USD); **one stacked series per stream**. Projected streams **dashed/hatched + legend "(projected)."** "Where the money comes from, over time."
2. **Cumulative revenue** — **`AreaChart`**, monotonic; X = time, Y = cumulative USD; single area (optionally stacked by stream).
3. **Revenue trajectory / run-rate & forecast** — **`LineChart`** with two series: **realized (solid)** and **forecast (dashed, "est.")**; X = time extending into the future; Y = revenue (period or annualized run-rate). Forecast = a **simple, transparent** model (trailing-Nd average growth extrapolated, or run-rate held flat) — **clearly labeled a naive projection, not a promise** (Constitution III, `07` §5.2). A `ReferenceLine` marks **"today."** Optional shaded confidence band (`Area` between low/high) labeled illustrative.
4. **MRR / ARR-equivalent over time** — **`LineChart`** (or `ComposedChart`: bars = monthly bookings + line = MRR). X = month, Y = USD. MRR = subscription MRR + normalized recurring fee portion (normalization defined in a `Tooltip`/footnote). ARR = MRR × 12.
5. **Revenue per user / per vault** — **two `BarChart`s** (or a toggle): ARPU over time (X = period, Y = USD/user) + revenue-per-vault (X = vault, Y = revenue; one bar at launch, future-proofed).
6. **Fee-vs-TVL & take-rate** — **`ComposedChart`**: `Area` = TVL (context) + `Line` = blended take-rate (revenue ÷ TVL, bps) on a secondary axis. The "are we extracting modestly?" story (restraint as a feature).
7. **Performance-fee high-water-mark status** — a **panel + small chart**, **ACTIVE · v1** (the perf fee is active in v1 on the Aave Yield Vault per constitution v1.1.0 — render **solid/realized**, with an **"Active · v1"** status `Badge`; **never dashed/projected, never "not active at launch"**): per vault, **share price vs HWM** as a `LineChart` with the **HWM as a `ReferenceLine`** + a status `Badge` ("Active · v1 · above HWM → fee accrues" / "Active · v1 · at/below HWM → no fee, recovering"). Reinforces "we only earn when you earn — never on your principal, never by taking custody."
8. **Top revenue-generating cohorts** — **horizontal `BarChart`**: revenue by cohort (signup-month / risk-tier / top-vaults); Y = cohort, X = revenue.

**"We only earn when you earn" panel (near the hero chart — the honesty framing, `README §3.5`).** A dual `Area` chart: **cumulative user yield** vs **cumulative protocol revenue**, side by side, with the one-line copy *"We only earn when you earn — never on your principal, never by taking custody."* The revenue story is **always shown against the value delivered to users**, and never leads with a projection.

**Revenue history table** — sortable, exportable `Table`: columns = period · revenue by stream (one col each) · total · cumulative · MoM % · take-rate; **footer totals**. Export **audited/role-gated**. This is the "show me the numbers behind the charts" backstop — and the chart's text/a11y alternative.

**States.**
- **Loading** — skeletons for cards + charts.
- **Empty / pre-revenue (early launch, before flows accrue)** — charts render with **zeroed-but-live active lanes (swap fee, premium tier, performance fee) + visible projected lanes (mgmt fee, SRK)** + a clear banner (`AlertBanner` info): *"Active streams are live at launch and begin accruing on first activity; projected lanes are illustrative, not forecasts of return."* (`README §3.5`). The graphical revenue story is **real and presentable from day one** — the active lanes (incl. premium-tier Stripe) show live as activity accrues.
- **Error / partial-source-error** — per-widget retry with **source provenance** (Stripe vs onchain vs computed).

**RBAC.** SA/Ops/Stakeholder. Stakeholder sees the **same charts, aggregate, no export of raw per-user rows** (the history table is period-aggregate; per-user revenue lives only in A2/A3).

**Non-custody / read-only touchpoint.** This dashboard **visualizes** revenue streams; it **does not introduce or enable any fee** (`README §0`). **No "enable fee," "set fee," or "collect" controls.** The HWM panel and the "we only earn when you earn" framing are the trust spine made graphical. **Every projection is dashed + "est."** — a projection is never presented as realized.

**Acceptance.** Hero stacked revenue-by-stream chart with the per-stream color contract + dashed projected lanes; cumulative area; trajectory line with **realized-solid + forecast-dashed + "today" ReferenceLine + est. label**; MRR/ARR; ARPU + per-vault; fee-vs-TVL take-rate `ComposedChart`; HWM panel with HWM `ReferenceLine`; top-cohorts horizontal bars; the **"we only earn when you earn" dual-area** present near the hero; revenue history table (sortable/export-audited/footer totals); **pre-revenue empty state with projected lanes + the illustrative banner**; no fee-authorizing controls; tabular; both breakpoints; charts carry `aria-label` + the table as text alternative.

---

## A7 — System / ops health

**Goal.** "Is the machine healthy?" (`README §3.6`). Sourced from Sentry, agent-service telemetry, the policy layer's `audit_logs`, `data_source_health`, `indexer_cursors`, `risk_events`, and chain reads (`KillSwitch`, `CapRegistry`).

**Entry points.** Sidebar "System" (SA/Ops); A1 System-status tile.

**Status tiles (band, green/amber/red — each pairs color + icon + text, `04` §10.2):** Agent-service (up/degraded/down) · RPC/Alchemy health · Indexer lag (blocks behind head) · Subgraph (Aave/Aerodrome) health · Dune/DeFiLlama freshness · Tenderly sim availability · Sentry error rate · **Kill-switch status (read-only)**.

**Charts / panels:**
1. **Agent-service status** — status tile + uptime `Line` (period) + last incident.
2. **Policy-engine decision counts & blocks** — stacked `BarChart` per day: `approved` vs `rejected`/`blocked_*` by reason (simulation/cap/slippage/allowlist) from `intent_bundles.policy_verdict` / `audit_logs`. A high block-rate is a **product signal**, not just an error.
3. **Simulation latency** — `LineChart` of p50/p95 Tenderly sim latency (multi-series).
4. **Error rates (Sentry)** — `AreaChart` of errors/period split by service (web / agent / indexer) + a `Line` overlay of error-rate %.
5. **Guardrail triggers** — `BarChart` of `risk_events` by type (owner-mismatch, impl-change, cap-breach attempt, oracle staleness, large drawdown) — defense-in-depth signals.
6. **Kill-switch status** — **read-only status panel** (`KillSwitchStatus` read-only variant, `06` §19): current pause state (`deposits_paused` from chain) · who-can-pause (the **2-of-3** multisig address → BaseScan) · last change (from events). **No action on this panel — it links to the governed kill-switch screen (A12)** for propose & sign. A note: *"Pause-only; never blocks withdrawals (N2); the panel proposes & signs but executes only at the on-chain 2-of-3 multisig threshold."* **Never red** (`05`/`07`).
7. **RPC / indexer health** — `Table` + sparkline per source from `data_source_health` (liveness, staleness, last block) and `indexer_cursors` (lag, reorg watermark); amber/red on degradation; ties to the "no execution on stale data" guarantee.

**States.** Loading skeleton · **healthy-empty** = green "All systems nominal" · **error (monitoring-source-down)** — the health page must **itself degrade gracefully**: if Sentry is down, show "Monitoring source unavailable," not a blank · no-permission (404 for Stakeholder/Client).

**Non-custody / read-only touchpoint.** The **A7 kill-switch panel is read-only** — it displays the 2-of-3 multisig-governed pause status and **links to the governed kill-switch screen (A12)**; it carries **no propose/sign control itself**. The governed propose-&-sign action lives on A12, and even there the panel only proposes & signs — **execution is the on-chain 2-of-3 multisig threshold**, never an in-panel button. Health surfaces never expose a fund or execution control.

**Acceptance.** 8 status tiles (color+icon+text, kill-switch never red); policy-decision stacked bars by block-reason; sim-latency p50/p95 lines; Sentry error area + rate line; guardrail-trigger bars; kill-switch **read-only status panel** on A7 (2-of-3 multisig link, links to A12, no in-panel control, withdraw-unaffected note); RPC/indexer health table; the page degrades gracefully when a monitoring source is down; SA/Ops only.

---

## A8 — Stakeholder / Client Overview

**Goal.** A **curated, non-technical, mostly-graphical, presentation-grade** summary — the default (and only) landing for **Client**, the headline view for **Stakeholders**, designed to be **screen-shared in a meeting** (`README §3.7`). No jargon, no per-user data, no system internals, no config — **aggregate, polished, narrative**.

**Entry points.** Default landing for Stakeholder/Client; SA/Ops can preview via sidebar "Overview."

**Layout (top→bottom, story order):**
1. **Headline KPI band** — four big stat cards with sparklines: **TVL** · **Total users** · **Cumulative revenue** · **Run-rate (ARR-equivalent)** — each with a friendly delta ("▲ 18% this month").
2. **Growth** — `ComposedChart`: TVL `Area` + active-users `Line` over 90d. "Money and people, together."
3. **Revenue trajectory** — the **A6 trajectory chart** (realized solid + forecast dashed, labeled illustrative — the centerpiece for the client) + the cumulative-revenue `AreaChart`.
4. **"We only earn when you earn"** — the user-yield vs protocol-revenue **dual-area**, reinforcing the trust thesis.
5. **TVL & flows** — a simplified net-flows `BarChart` (deposits up / withdrawals down) — proof of real, sticky money.
6. **Trust badges** — a small status row (all observe-only, reading the same status sources): **fully self-custodial ✓** (read-only over funds) · **withdraw-always: last drill passed ✓** · **0-management / profit-only performance-fee vault ✓** (10% of yield, high-water mark, 0% on principal; active in v1) · **kill-switch: pause-only, 2-of-3 multisig-governed, never blocks withdrawals ✓** (status shown; governed propose-&-sign on A12).

Everything here is **derived from the richer dashboards** (one source of truth, simplified presentation). **Tone (`07`):** confident, plain-language, honest — **no projection shown without an "illustrative" label.** This view is **export-to-PDF/PNG** friendly for leave-behinds (audited export).

**States.**
- **Loading** — branded skeleton.
- **Empty / pre-launch** — a **"launching September" hero** with zeroed-but-styled cards (a demo never looks broken).
- **Error** — graceful per-widget fallback.
- **Export-mode** — a print/PDF-optimized render (light-theme-friendly, page-broken, watermarked "Generated {date}"); export is **audited**.

**RBAC.** Client sees **only** this screen (server-denied elsewhere → 404). Stakeholder sees this + A1(curated)/A5/A6.

**Non-custody / read-only touchpoint.** The **trust-badge row** surfaces the non-custody story at presentation altitude — fully self-custodial, withdraw-always drill, 0-management / profit-only performance-fee vault (0% on principal, active in v1), pause-only 2-of-3-multisig kill-switch (never blocks withdrawals) — all **observe-only here**, reading the same status sources as A5/A7, with **no controls on A8** (the governed propose-&-sign lives on A12, and even there execution is the on-chain multisig). The "we only earn when you earn" panel is the revenue-honesty centerpiece.

**Acceptance.** Six-section story order; headline KPI band; Growth `ComposedChart`; revenue trajectory (forecast dashed + illustrative label) + cumulative area; "we only earn when you earn" dual-area; simplified net-flows bars; trust-badge status row (observe-only); export-to-PDF/PNG (audited) + export-mode render; pre-launch "launching Sept" hero; Client sees only this screen; desktop + tablet + a phone courtesy render (this screen is the one heavy view phones keep).

---

## A9 — Admin management (`/admin/users`)

**Goal.** Manage admins and roles — **Super-Admin only** (`README §2.3`).

**Entry points.** Sidebar "Admin" (SA only).

**Layout.** `Table` of admin identities: name/email (SSO subject) · role `Badge` (Super-Admin/Ops/Stakeholder/Client) · status (active / time-boxed-expiring / revoked) · last login · created-by. Row actions: change role (`Select`), revoke, resend invite. **Add admin** → a `Dialog` (`Form`: email/SSO subject + role + optional time-box expiry for Stakeholder/Client guest access, `README §2.2`).

**States.** Loading skeleton · error · no-permission (404 for non-SA). Every change is **confirmed (audited)** and writes the admin audit log.

**Non-custody / read-only touchpoint.** "Admin management" is **non-custodial** — it manages *who can view analytics*, never any authority over funds (none exists, `README §2.3`). Copy near the role selector: *"Roles grant read access to analytics. No role can move user funds — no such capability exists."*

**Acceptance.** SA-only (404 otherwise); add/change-role/revoke with audited confirm; time-boxed guest roles supported; the "roles grant read access, never fund authority" note present; tabular; every change audited.

---

## A10 — Non-custodial config (`/admin/config`)

**Goal.** Operational config that is **not custody-critical** — beta whitelist invites, feature flags, dashboard settings (`README §2.3`, §6). SA/Ops.

**Entry points.** Sidebar "Config" (SA/Ops).

**Layout (Tabs).**
- **Whitelist invites** — `Table` of beta whitelist entries + an "invite" `Form`; geo/whitelist state gates **app access only, never the onchain withdraw escape hatch** (`README §2.3`).
- **Feature flags** — list of flags with `Switch` toggles; each toggle is a **confirm-change (audited)** action.
- **Dashboard settings** — non-custodial display prefs.

**States.** Loading · error · no-permission (404) · **confirm-change (audited)** — a `Dialog`/`AlertDialog` confirming the change before it routes through the **product's existing governed path** (not a raw admin DB write, `README §2.6`), with its own audit.

**Non-custody / read-only touchpoint.** These are the **only writes in the panel**, and they are **non-custodial** — whitelist/flags gate *app access*, never funds, and **never the withdraw escape hatch**. A persistent note: *"These settings control app access and features. They cannot move funds or block withdrawals."* Styled as ordinary form actions — **no spark fund-CTA**.

**Acceptance.** SA/Ops only (404 otherwise); whitelist + flags + settings tabs; every change is confirmed + audited + routed through the governed path; the "controls app access, not funds, never blocks withdrawals" note present; absent entirely for Stakeholder/Client.

---

## A11 — Admin audit log (`/admin/audit`)

**Goal.** Forensics — the **append-only** record of every admin action (`README §2.4`). SA/Ops, **step-up required**.

**Entry points.** Sidebar "Audit log" (SA/Ops).

**Step-up gate.** Re-2FA `Dialog` before render; **viewing the audit log is itself logged** (meta-audit, `README §2.4`).

**Layout.** Filterable, virtualized `Table`: `ts` · `admin_id` · `admin_role` · `action` (enum badge: login/logout/2fa_pass/stepup_pass/view_dashboard/view_user_detail/export_csv/config_change/role_change/feature_flag_toggle/whitelist_invite/killswitch_status_viewed) · `subject` (table+id or dashboard name; **subject ids pseudonymized**) · `ip` · `geo` · `user_agent` · `request_id` · `result` (`ok`/`denied`/`error`, semantic-colored). Filters: by admin · action · result · date. A small **anomaly banner** when the nightly job flags bulk export / off-hours access / repeated `denied`.

**States.** Loading skeleton · empty ("No admin activity in this range") · error · **step-up-required** · no-permission (404).

**Non-custody / read-only touchpoint.** The audit log is **read-only** (append-only at the data layer; no edit/delete in the UI — `README §2.4`). It records `killswitch_status_viewed` but there is no kill-switch *action* to record (none exists in the panel).

**Acceptance.** Step-up gate + meta-audit on view; append-only (no edit/delete controls); full field set with pseudonymized subjects + semantic result colors; filters; anomaly banner; SA/Ops only.

---

## A12 — Governed manual kill-switch (`/admin/killswitch`)

**Goal.** The one place an admin may **propose & sign** a **pause/unpause** — **pause-only, governed by a 2-of-3 multisig, executed on-chain, and NEVER able to block withdrawals.** *(Client-directed scope amendment vs the original "status-display-only" plan — `README §0`, logged not silent.)* The panel is a **co-signing console, not an executor**: it builds and signs a proposal; **execution requires the on-chain 2-of-3 multisig threshold** to be met. SA/Ops, **step-up required**.

**Entry points.** Sidebar "Kill-switch" (SA/Ops); the read-only kill-switch status panels on **A5/A7** and the **A8** trust badge link here.

**Step-up gate.** Re-2FA `Dialog` before render (proposing/signing is a sensitive governance action); the view and every propose/sign are written to the admin audit log.

**Layout.**
- **Current state band** — the `KillSwitchStatus` (`06` §19) read variant: pause state pill (`deposits active` / `deposits paused`), **pause-only scope statement**, the **2-of-3 multisig** controller (address → BaseScan), last change (from events). **Never red** (`05`/`07`).
- **Propose action** — a single primary action (`Propose pause` / `Propose unpause`, pause-only — there is no other proposable action). It is styled as an ordinary governance action, **not** a spark fund-CTA.
- **Ack-gated confirm `Dialog`** — before signing, the signer must tick acknowledgements that **gate the Sign button** (mirrors the product's sign-disabled-until-acknowledged trust gate): *"This pauses deposits only."* · *"Withdrawals are never blocked (N2)."* · *"This does not execute — execution needs the on-chain 2-of-3 multisig threshold."* Sign is disabled until all are checked.
- **Pending-signatures panel** — current proposal's signature progress (e.g., **1 of 2 required**, the 2-of-3 threshold), who has signed (admin refs), and an external link to the multisig (Safe) where execution happens. The panel shows progress; **it cannot push execution** — that occurs on-chain when the threshold is met.
- **History log** — an append-only `Table` of past kill-switch governance actions: `ts` · `admin_ref` · `action` (`propose` / `sign`) · `target` (pause/unpause) · `result` · multisig-tx link. (In addition to the admin audit log; this is the in-screen forensics view.)

**States.** Loading skeleton · **status-only (no pending proposal)** — current state + "Propose…" affordance · **ack-gated confirm** — the acknowledgement `Dialog`, Sign disabled until acked · **pending-signatures** — proposal awaiting the 2-of-3 threshold · error · **step-up-required** · no-permission (404 for Stakeholder/Client).

**Non-custody / read-only touchpoint.** **Pause-only, never withdrawals.** The panel **proposes & signs but cannot execute** — execution lives at the on-chain 2-of-3 multisig threshold, so no single admin (and not the whole panel) can pause anything alone. Signing a *pause* proposal **moves no funds** and emits no fund-moving calldata (N1 intact). Kill-switch is **never red**. The screen carries the note: *"Pause-only. Never blocks withdrawals. The panel proposes & signs; execution requires the on-chain 2-of-3 multisig."*

**Acceptance.** Step-up gate + every propose/sign audited; **pause-only** (no other proposable action, no withdrawal-affecting control); **ack-gated** confirm that gates Sign (sign-disabled-until-acknowledged); **2-of-3 multisig** signature-progress panel with execution shown as on-chain (panel cannot execute); append-only history log; kill-switch **never red**; SA/Ops only (404 otherwise); withdrawals-never-blocked note present; both breakpoints.

---

## 4. Tablet & phone responsiveness (carry on every screen — `README §5`)

- **Desktop (1440px, design target):** sidebar rail + 12-col content grid; stat cards 4-across; charts 2-across (hero charts span 2 cols).
- **Tablet (1024px):** sidebar **collapses to icon-only** (`Tooltip` labels); stat cards **2-across**; **charts reflow to single column**; wide tables **scroll horizontally** (sticky first column); the revenue history / top-users / audit tables keep tabular alignment while scrolling.
- **Phone (degraded read-only courtesy view):** **KPI cards + A8 Stakeholder Overview only**; sidebar → a `Sheet` hamburger; **heavy tables, cohort heatmaps, and dense multi-series charts collapse to a "Best viewed on desktop" `EmptyState`** (`06` §24) rather than rendering broken. A8 is the one rich screen phones fully keep (it is the presentation/leave-behind surface).
- **Overlays transform:** `Dialog` → bottom `Sheet` on phone (`04` §4.2) for step-up prompts, export options, and config confirms.

---

## 5. Cross-screen acceptance criteria (the admin panel as a whole)

A design satisfies this spec when **all** hold:

1. **Read-only over funds, visibly.** No screen contains a control that moves, withdraws, sweeps, reallocates, or otherwise touches user funds. The single governed exception is the **pause-only kill-switch (A12)**, which can only **propose & sign** (never execute, never move funds, never block withdrawals). The persistent **"Observe-only · read-only over funds"** chip is present in the top bar (`.opsbar`) on 100% of screens, with its one-tap explainer. (`README §0`.)
2. **Kill-switch is governed (pause-only, propose-&-sign, never executes).** On analytics screens (A5, A7, A8 trust badges) the kill-switch is the `KillSwitchStatus` **read-only variant** linking to **A12**; on **A12** an admin may **propose & sign** a pause/unpause, but the panel **cannot execute** — **execution requires the on-chain 2-of-3 multisig threshold**. Pause-only scope statement + 2-of-3 multisig transparency + external multisig link, **ack-gated confirm + history log**, **never red**, always noting **"pause never blocks withdrawals."** Signing a pause proposal moves no funds. (`README §0`, `05` §3.5, `07`.)
3. **RBAC by construction.** Each role gets its own default landing + role-scoped nav; denied sections return a **server-side 404 (never 403)**; per-user drilldown (A3) and the audit log (A11) require **step-up + are themselves audited**; Stakeholder/Client are **aggregate-only, pseudonymized, config-free**, and cannot reach A2/A3/A4/A7/A9/A10/A11/A12. (`README §1`, §2.3, §2.4.)
4. **Projection honesty everywhere.** Realized = solid (incl. the three active launch streams: swap fee, premium tier, performance fee); **projected/forecast/future-stream (mgmt fee, SRK, run-rate forecast) = dashed/hatched + "est." badge**; only genuine forecasts are dashed; the revenue trajectory marks "today" with a `ReferenceLine`; the revenue pre-revenue empty state shows zeroed-but-live active lanes + visible projected lanes + the illustrative banner. **No projection is ever presented as realized, and no realized stream is dashed.** (`README §3`, Constitution III, `07` §5.2.)
5. **The revenue dashboard (A6) is the centerpiece.** All eight specified charts + the "we only earn when you earn" dual-area + the revenue history table are present, with the **one-color-per-stream contract** consistent across every chart, and **no fee-authorizing controls.** (`README §3.5`.)
6. **Design-system conformance (`04`).** Dark-first; three color systems never crossed (spark only for active-nav/focus/AI-presence, **never** revenue-up or gain/loss/risk); semantic green/red/amber/blue pair color+icon+text; risk palette only for risk tiers; **tabular numerals on 100% of financial figures**; net-APY rule (never bare); chart axes/grids/tooltips per `04` §6; mono for addresses/hashes; motion subtle + reduced-motion safe.
7. **States, all of them.** Every screen designs loading (skeleton, never blank, never `0`-placeholder) · empty (zeroed-but-styled, pre-launch-intentional) · **per-widget** error (with source/freshness provenance, one failing source never blanks the page) · no-permission (404) · plus screen-specific step-up / confirm-change / export-mode states.
8. **Provenance + freshness.** Every chart can show its source + freshness ("RPC, 42s ago" / "Stripe, live" / "materialized, 03:00"); the global top-bar freshness stamp is present; estimated values flagged.
9. **Responsiveness.** Desktop-first 1440px + a real tablet 1024px reflow (single-column charts, horizontal-scroll tables, icon-rail nav); phone is the degraded courtesy view (KPI + A8 only; heavy widgets → "best viewed on desktop").
10. **Accessibility (`04` §10, AA both themes).** Charts carry `aria-label` summaries + a table text-alternative (the revenue history table doubles for A6); 2px spark focus ring; full keyboard operability; no color-only signals; status tiles and deltas always color+icon+text.
11. **Secret-surface posture.** No links from the user app; admin auth separate from wallet-connect; A0 error copy never enumerates accounts; un-allowlisted requests 404; export is audited + role-gated; no third-party trackers implied in the design.
12. **Content & tone (`07` wins).** Honest, plain, non-hypey; "we only earn when you earn" verbatim; net-APY-with-breakdown; no banned phrases; the read-only/non-custody framing stated as structural fact ("this panel cannot move funds — no such capability exists"), never as a promise.

---

## 6. Cross-references

- **The authoritative plan (audiences, access/RBAC/audit, every dashboard's metrics + Recharts chart specs, data pipeline, screen inventory, non-custody constraint):** [`./README.md`](./README.md) (§0–§7).
- **Tokens, the three color systems, spark = AI presence (never fund/gain/risk), semantic + risk palettes, tabular numerals, data-viz §6, motion, iconography, a11y, component→shadcn map:** [`../design-handover/04-design-system.md`](../design-handover/04-design-system.md).
- **Kill-switch status (pause-only, never red), caps meters, observe-only/read-only framing:** [`../design-handover/05-trust-and-safety-ux.md`](../design-handover/05-trust-and-safety-ux.md) (§3.4, §3.5).
- **Reused custom components (KillSwitchStatus §19, CapsMeter §14, RiskChip §15, AllocationDonut §20, EmptyState §24, AlertBanner §25):** [`../design-handover/06-component-library.md`](../design-handover/06-component-library.md).
- **Canonical wording — number/PnL/APY formatting, honest-projection rule, banned/required phrases (wins on any conflict):** [`../design-handover/07-content-and-tone.md`](../design-handover/07-content-and-tone.md) (§5, §9).
- **The revenue streams the central dashboard visualizes (and the §5.2 amendment gating future lanes):** [`../revenue-model/README.md`](../revenue-model/README.md).
- **Spec Kit formalization target:** `specs/002-admin-panel/` (`README §7`).

> **Final reminder (carried from `README §0`):** every figure in this panel is **observed, never actuated**. The admin panel watches SparkPoint; it cannot touch a single unit of user funds. The lone privileged surface — the kill-switch (A12) — is **pause-only and governed**: the panel may **propose & sign** but **never execute** (execution requires the on-chain 2-of-3 multisig threshold), and it **never blocks withdrawals**. Signing a pause proposal moves no funds.
