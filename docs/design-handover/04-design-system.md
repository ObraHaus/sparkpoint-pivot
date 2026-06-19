# 04 — Design System (Tailwind + shadcn/ui Design Language)

> **Audience:** Claude Design (high-fidelity screen production) and the build team implementing in Next.js (App Router) + TailwindCSS + shadcn/ui.
> **Status:** Authoritative visual-design language for the W1–2 milestone. Every screen in flows `01`…`NN` must be built from the tokens, scales, and components defined here.
> **Reads-before:** `00-brief.md` (positioning, thesis, non-goals). Where this doc and the brief disagree on tone or constraints, the brief wins; this doc operationalizes the brief into concrete tokens.
> **What this doc IS:** color/type/space/elevation tokens, the spark accent, semantic + risk palettes, data-viz style, motion, accessibility rules, and a component→shadcn mapping. **What it is NOT:** flow specs or screen anatomy (those live per-flow).
> **Hard rules carried from the brief:** dark-first; the **spark** brand-accent system reserved for primary CTAs + AI presence; strict semantic colors (green/red/amber, never the accent); a consistent **5-step risk palette** (violet→magenta) reused everywhere risk appears; **tabular numerals** for all financials; **WCAG AA** minimum; maps cleanly to **shadcn/ui** primitives (Card, Badge, Dialog/Drawer, Tabs, Table, Progress, Alert; charts via **Recharts**).

> **⚠️ BRAND SOURCE-OF-TRUTH NOTICE (client-directed, supersedes earlier drafts of this doc).** The delivered brand was changed by client direction to match sparkpoint.io, then improve on it. The **real brand is COBALT BLUE + GOLD + CORAL** warm accents, with a signature **blue→cyan→gold→coral gradient**, on a **deep indigo-navy** dark base; the **risk scale is VIOLET→MAGENTA (5-step)** (so it never collides with the cobalt brand blue); type is **Geist Sans + Geist Mono** with **tabular numerals** on financials. **`tokens.css` in the design showcase is the SOURCE OF TRUTH for all token *values*.** Any **orange "spark" accent** previously specified in this doc (and any teal-anchored risk scale) is **STALE** — the structure/usage rules below still hold, but read every "spark orange / `#FF8A3D`" hex as the cobalt/gold/coral brand from `tokens.css`. Hex values written inline below are illustrative reference only; `tokens.css` wins on any conflict.

---

## 1. Foundations & principles

The visual language must encode three brand truths from the brief into pixels:

1. **Trustworthy & self-sovereign** → calm, precise, fintech-grade. Restraint over decoration. No casino gradients; the **one sanctioned brand gradient is the signature blue→cyan→gold→coral spark gradient** (used for brand/AI-presence moments — logo, hero, AI glow — never to carry semantic meaning), and the one sanctioned hype glow is AI presence.
2. **Data-dense but clean** → tight, predictable spacing scale; tabular numerals; a disciplined type scale; risk and PnL legible at a glance.
3. **Honest autonomy** → the spark accent *is* AI presence; semantic colors *are* outcome/safety; the two color systems never blur. A user must be able to read "this is the AI talking," "this is a gain," "this is blocked," and "this is the risk tier" by color alone (with a non-color fallback for AA).

**Three orthogonal color systems — never cross-contaminate:**

| System | Carries | May appear as | NEVER used for |
|---|---|---|---|
| **Spark accent** (single hue) | Primary CTA, AI presence/identity, focus of attention | Primary buttons, AI avatar/glow, active nav, links, focus ring | Gains, losses, caution, risk tiers |
| **Semantic** (green/red/amber) | Outcome & safety state | Gains/safe, loss/blocked, caution; badges, alerts, PnL, guardrail pass/fail | Brand/CTA emphasis, decoration |
| **Risk palette** (3–5 steps) | Risk *tier* of a strategy/vault/allocation | Risk chips, risk meter, allocation-by-risk, strategy ranking | General status, CTAs, AI presence |

> Mental check before assigning any color: *"Is this brand, outcome, or risk?"* Pick exactly one system.

---

## 2. Color

### 2.1 Theming mechanism (shadcn CSS variables)

Colors ship as **CSS custom properties on `:root` (dark = default) and `.light`**, consumed by Tailwind via the shadcn convention. **Dark is the default theme and the design target**; light is a supported second theme, not the primary canvas. All tokens are authored so both themes meet WCAG AA.

- Use shadcn's HSL-channel variable pattern (`--background: <H S% L%>;` consumed as `hsl(var(--background))`) so opacity utilities work.
- Components reference **semantic tokens** (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `ring-ring`, etc.), **never raw hex**. Designers spec against these token *names*; the build wires the values once.
- The values below are the **canonical starting palette** (hand-tuned for AA on dark). Treat hex as the reference target; the build mirrors them into HSL channels.

### 2.2 Core neutral ramp (dark-first)

A **deep indigo-navy** base ramp (per the delivered brand) — not pure black (avoids OLED smear and harsh contrast), and intentionally cool/indigo-tinted to sit under the cobalt brand without reading as a "techy toy." **Hex below is illustrative; `tokens.css` carries the canonical indigo-navy values.**

| Token | Role | Dark (hex ref) | Light (hex ref) |
|---|---|---|---|
| `--background` | App canvas (deep indigo-navy) | `#0A0C10` *(→ indigo-navy per `tokens.css`)* | `#FBFCFD` |
| `--card` | Card / panel surface (raised from canvas) | `#11141A` | `#FFFFFF` |
| `--popover` | Popover/menu surface | `#141821` | `#FFFFFF` |
| `--muted` | Subtle fill (table zebra, chips, inactive) | `#1A1F29` | `#F1F3F5` |
| `--muted-foreground` | Secondary text, labels, axis | `#9AA4B2` | `#5B6573` |
| `--foreground` | Primary text | `#E8ECF2` | `#0E1116` |
| `--border` | Hairlines, dividers, input borders | `#232A36` | `#E3E7EB` |
| `--input` | Input border (slightly stronger than border) | `#2A323F` | `#D7DCE2` |
| `--ring` | Focus ring (brand-derived) | cobalt brand (per `tokens.css`) | cobalt brand (per `tokens.css`) |

**Elevation by surface + border, not heavy shadow.** Dark UIs read depth via lighter fills and hairline borders far better than via drop shadows. Surfaces step: `background` (0) → `card`/`muted` (1) → `popover` (2). Reserve shadow for true overlays (Dialog, Popover, Drawer, dropdowns) only — see §5.

### 2.3 The spark accent (brand system — cobalt blue + gold + coral)

> **CLIENT-DIRECTED BRAND (supersedes the old single "spark orange").** The accent is now the sparkpoint.io-matched brand: a **cobalt blue** primary with **gold + coral** warm accents, plus a signature **blue→cyan→gold→coral gradient** for brand/AI moments. The old orange `#FF8A3D` is **STALE**. Values below are **illustrative reference**; **`tokens.css` is the source of truth** for every brand hex. The *usage discipline* (scarce, CTA + AI presence only) is unchanged — only the hues changed.

| Token | Role | Reference (illustrative — see `tokens.css`) |
|---|---|---|
| `--primary` | Brand accent — primary CTA & AI presence | **cobalt blue** |
| `--primary-foreground` | Text/icon on the brand fill | near-black / white per contrast |
| `--brand-gold` | Warm secondary accent (highlights, gradient mid-warm, premium/proof moments) | **gold** |
| `--brand-coral` | Warm secondary accent (gradient terminus, energy/AI flourish) | **coral** |
| `--brand-gradient` | Signature gradient: **blue → cyan → gold → coral** (brand/AI presence only; never semantic) | linear blend of the above |
| `--spark-subtle` | Brand at low-emphasis (AI avatar bg, active-nav tint, link hover wash) | ~14% alpha of cobalt |
| `--spark-glow` | AI "thinking"/presence glow (very low alpha, motion-gated; may bloom along the gradient) | low-alpha cobalt/cyan |

**Brand-accent usage rules (strict — from brief §6):**
- **Primary CTA only:** "Sign & Confirm," "Deposit," "Connect Wallet," "Set Mandate." One primary brand CTA per view; everything else is `secondary`/`outline`/`ghost`.
- **AI presence:** the assistant avatar, the AI "thinking" indicator, the "AI suggestion" affordance, suggested-prompt chips on hover/active. This is what makes "the AI is talking" legible by color.
- **The signature gradient** (blue→cyan→gold→coral) is reserved for **brand identity + AI-presence moments** (logo, Spark Core landing, hero, AI glow). **Never** use it — or gold/coral — to carry semantic meaning (gain/loss/caution) or to color risk tiers.
- **Do NOT** use the brand accent (cobalt/gold/coral/gradient) for gains, success, risk tiers, or generic emphasis. It must stay scarce to keep its signal. If a screen has the brand accent in five places, four are wrong.
- **Warm-accent-vs-semantic guard:** gold and coral are warm and can read near the caution **amber** / loss **red**; keep caution amber clearly more yellow and loss red clearly red (see §2.4), and never place a gold/coral brand flourish adjacent to an amber/red semantic chip without the semantic element carrying an icon + label, so they don't read as one signal.

### 2.4 Semantic colors (strict — outcome & safety)

Reused everywhere outcome/safety appears: PnL, gains/loss arrows, guardrail pass/fail, alerts, deposit/withdraw direction, blocked actions. **Each semantic state must pair color with an icon and/or text** (never color alone — AA + colorblind).

| Token | Meaning (from brief) | Dark fg | Dark subtle bg | Light fg |
|---|---|---|---|---|
| `--success` / `--gain` | Gains / safe / pass | `#36D399` | `rgba(54,211,153,0.14)` | `#0E7A52` |
| `--destructive` / `--loss` | Loss / blocked / fail | `#FF5C5C` | `rgba(255,92,92,0.14)` | `#C2362B` |
| `--warning` / `--caution` | Caution / acknowledge-required | `#FFC53D` | `rgba(255,197,61,0.14)` | `#9A6A00` |
| `--info` | Neutral informational (literacy tips, system notes) | `#5BB8FF` | `rgba(91,184,255,0.14)` | `#0B62B0` |
| `--*-foreground` | Text/icon on solid semantic fill | `#0A0C10` | — | `#FFFFFF` |

- **PnL sign convention:** gain = `--gain` + up-triangle + `+`; loss = `--loss` + down-triangle + `−`; flat = `--muted-foreground` + en-dash. Always tabular numerals (§3.4).
- **Guardrail checklist:** pass = `--success` + check; fail/blocked = `--destructive` + slash/lock; needs-ack = `--caution` + alert-triangle. "Sign disabled until acknowledged" maps to caution items still un-acked (brief §5, Rabby benchmark).
- **Info ≠ success.** Don't tint literacy/info content green; reserve green for *gains/safe*.

### 2.5 Risk palette (consistent 3–5 step — reused everywhere)

A **5-step ordinal scale** (use a 3-step collapse — Lower/Moderate/Higher — for retail-facing surfaces; the full 5 for power-user/data-dense surfaces). This is its **own** hue system, distinct from semantic green/amber/red so a "high-risk" tier is not misread as a "loss/error." **Client-directed:** it runs a perceptually-spaced **violet→magenta** progression (deepening = safe→risky) — chosen **specifically so it never collides with the cobalt brand blue** (an earlier teal/blue-anchored scale did, and is **stale**). Reference hex below is illustrative; **`tokens.css` is the source of truth.**

| Step | Label (5-step) | Label (3-step) | Token | Dark hex (illustrative) | Use |
|---|---|---|---|---|---|
| 1 | Very Low | **Lower** | `--risk-1` | violet (lightest) | Capital-preservation; the launch Aave vault default |
| 2 | Low | **Lower** | `--risk-2` | violet | Conservative |
| 3 | Moderate | **Moderate** | `--risk-3` | violet→purple | Balanced |
| 4 | Elevated | **Higher** | `--risk-4` | purple-magenta | Growth-leaning |
| 5 | High | **Higher** | `--risk-5` | magenta (deepest) | Aggressive |

- Each step ships with a **subtle bg** variant (≈14% alpha of the hue) for chips/fills and a **solid fg** variant (AA on `--card`) for text/meter strokes.
- **Reuse contract:** the *same* token drives the portfolio risk panel, the vault risk score, the strategy-ranking risk chip, and allocation-by-risk-tier. A user learns the scale once. Never recolor risk per-surface.
- **Non-color fallback:** every risk indicator carries the **numeric step (1–5) or the word label** + a filled-segments meter, so risk is legible without hue.
- **Launch reality:** the single conservative Aave vault is **Risk 1 (Lower)**. Design the full scale, but the live product mostly shows step 1–2; higher steps appear on the strategy-ranking/comparison surfaces as context.

### 2.6 Chart / data-viz palette

Charts get their own **categorical ramp** derived from the risk + neutral systems so allocation slices stay distinct without hijacking semantic meaning. See §6.

---

## Theming — light & dark mode (supported)

> **Status: implemented in the prototype/showcase.** Dark is the default and the design target (§2.1); **light is now a fully supported second theme**, not a token-swap proof-of-concept. Both meet WCAG AA (§10.1). This section is the **authoritative contract** for how theming works; `tokens.css` in the showcase remains the source of truth for the actual values.

### T.1 The token contract (one definition, two themes)

All colors are **CSS variables, never hardcoded hex** in components. They are defined **once** and overridden once:

- **`:root, .dark`** — the canonical (default) **dark** palette. Authoring `:root` and `.dark` together means the dark values are the baseline whether or not a theme class is present.
- **`.light`** — overrides **only** the variables that differ in light. Components don't change; the surfaces flip because the variables they read flip.

```css
/* tokens.css (illustrative shape — values per the showcase) */
:root, .dark {
  --background: …;  --card: …;  --foreground: …;  --border: …;
  --primary: …;     --muted: …;  --muted-foreground: …;  /* …etc */
}
.light {
  --background: …;  --card: …;  --foreground: …;  --border: …;
  --muted: …;       --muted-foreground: …;  /* only what differs */
}
```

Components read **semantic tokens only** (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `ring-ring`, …) — see §2.1. Because nothing in a component names a raw color, **a single class swap on the root re-themes the entire UI**.

**Intentionally theme-independent (do NOT override under `.light`):** the brand/logo and AI-presence colors and the signature **blue→cyan→gold→coral spark gradient** (§2.3); the strict **semantic** hues (gain green, loss red, caution amber, info blue — §2.4); the **risk palette** (violet→magenta, §2.5). These are *identity and meaning*, not surface chrome — a gain is green and the spark is the spark in both themes. (Their *foregrounds*/subtle-bg tints may be tuned per theme for AA, but the hue identity is constant.) Light theming flips **surfaces, neutrals, borders, and text**, not brand/semantic/risk meaning.

### T.2 The active-theme contract (one class on `<html>`)

The active theme is a **single class on the root `<html>` element**: `.dark` or `.light`. Nothing else toggles theming — no per-component variants, no data-attributes the components read. Flip the class, the variables flip, the whole tree re-renders against the new surfaces.

### T.3 Persistence (`sp-theme` in localStorage)

- **Key:** `sp-theme`.
- **Values:** `"light"` | `"dark"`.
- **Default:** `"dark"` (when nothing is stored, or the value is missing/invalid).
- Every theme toggle (§T.5) **writes `sp-theme`**, so all entry points stay in sync and the choice persists across reloads and routes.

### T.4 No FOUC — blocking inline `<head>` script (required)

To avoid a flash of the wrong theme (FOUC), the saved theme must be applied **before first paint**. A **small blocking inline script in `<head>`** reads `sp-theme` and sets the root class synchronously, *before* the body renders:

```html
<!-- in <head>, before any stylesheet-driven paint — runs synchronously -->
<script>
  (function () {
    try {
      var t = localStorage.getItem('sp-theme');
      if (t !== 'light' && t !== 'dark') t = 'dark'; // default dark
      var r = document.documentElement;
      r.classList.remove('light', 'dark');
      r.classList.add(t);
    } catch (e) {
      document.documentElement.classList.add('dark'); // safe fallback
    }
  })();
</script>
```

This is a **hard requirement**, not an optimization: without it, dark-default users who chose light (or vice-versa) see a one-frame flash on every load.

### T.5 Toggle placements (three, all writing `sp-theme`)

The product exposes the theme switch in exactly three places — each writes `sp-theme` and therefore stays in sync with the others:

1. **App — user-avatar menu.** In the avatar `DropdownMenu`, positioned **between "Learn" and "Log out"**: a sun/moon icon + label **"Light mode" / "Dark mode"** + a `Switch`.
2. **Admin — left side-nav (bottom).** Styled like a nav item, pinned to the **bottom** of the admin side-nav.
3. **Onboarding — header (top-right).** A small **sun/moon icon button** in the onboarding header, top-right.

> **Marketing landing is dark-only by design.** The Spark Core marketing landing is **art-directed for dark** (the gradient + AI-bloom hero reads only on the deep indigo-navy base). It reads `var(--background)` but **pins `.dark`** and shows **no toggle**. Light mode covers the app, admin, and onboarding surfaces; the landing intentionally does not flip.

### T.6 Building it in Next.js

- Use **`next-themes`** with `attribute="class"`, `storageKey="sp-theme"`, `defaultTheme="dark"`, `enableSystem={false}`. (`attribute="class"` makes it write `.light`/`.dark` on `<html>`; `storageKey` makes it persist under `sp-theme`; `enableSystem={false}` keeps dark the deterministic default rather than following the OS.) `next-themes` injects its own blocking pre-paint script, satisfying §T.4. **Equivalent allowed:** a hand-rolled blocking inline `<head>` script (§T.4) + a small client store — as long as the key, values, default, and no-FOUC behavior match this contract.
- **Port `tokens.css`** `:root`/`.dark`/`.light` blocks into **`app/globals.css`**, and **map the variables into the Tailwind theme** with `darkMode: 'class'`, so utilities like `bg-background` / `text-foreground` / `border-border` resolve to the CSS variables (shadcn's `hsl(var(--…))` convention, §2.1). One wiring, both themes.
- **Render the toggles** in the three placements above (§T.5) — app avatar menu, admin side-nav bottom, onboarding header — each driven by the same `next-themes` (or client-store) setter so they stay in sync.
- **No hardcoded hex in components.** Every colored element names a token; theming is the variable layer's job (AC#1, AC#7). Pin the marketing landing to dark explicitly; leave it out of the toggle surfaces.

---

## 3. Typography

### 3.1 Families

| Role | Family | Fallback | Rationale |
|---|---|---|---|
| **UI / body / display** | **Geist Sans** (canonical brand type) | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | Neutral, high-legibility fintech grotesque with excellent tabular-figure support. **Geist Sans is the brand UI face** — use throughout. (Inter is an acceptable emergency fallback only.) |
| **Numerals / financials** | Geist Sans with **`font-variant-numeric: tabular-nums`** (and `slashed-zero`) | — | Prefer the *tabular figures of Geist Sans* over switching to mono for inline numbers, so balances align without a jarring face change. |
| **Mono** (addresses, tx hashes, code/calldata, raw permission scopes) | **Geist Mono** (canonical brand mono) | `ui-monospace, "SF Mono", Menlo, monospace` | Hashes/addresses, simulation calldata, on-chain permission strings in the "prove-it" panel and confirmation screen. |

> **Tabular-numerals rule (brief §6, non-negotiable):** every financial figure — balances, APY, PnL, shares, caps, prices — uses tabular numerals so columns align and live-updating values don't jitter. Provide a `.tnum` utility (`font-variant-numeric: tabular-nums slashed-zero`) and apply it to all numeric cells, the net-worth hero, APY readouts, and share counts. Prose stays proportional.

### 3.2 Type scale (rem @ 16px root; tight, fintech-dense)

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-display` | 36 / 40 (2.25rem) | 600 | Net-worth hero, onboarding marquee numbers |
| `text-h1` | 28 / 34 | 600 | Page titles |
| `text-h2` | 22 / 28 | 600 | Section headers, card titles (large) |
| `text-h3` | 18 / 24 | 600 | Card titles, panel headers |
| `text-base` | 15 / 22 | 400 | Body, chat messages, descriptions |
| `text-sm` | 13 / 18 | 400/500 | Secondary text, table cells, captions, microcopy |
| `text-xs` | 12 / 16 | 500 | Labels, badge text, axis ticks, legal/disclaimer |
| `text-mono-sm` | 13 / 18 mono | 400 | Addresses, hashes, calldata |

- **Display/financial figures** may render one step larger with `font-feature-settings` for tabular nums; pair a large number with a small `text-xs muted` unit/label.
- **Weights:** ship 400 / 500 / 600 only. Avoid 700+ (reads heavy/hypey against the calm brand); reserve emphasis for weight 600 + spark, used sparingly.
- **Letter-spacing:** slight negative tracking on `display`/`h1` (−0.01em); `0` elsewhere. All-caps labels (badges, eyebrows) get +0.04em.

### 3.3 Hierarchy & color rules

- Primary text `--foreground`; secondary/labels/axis `--muted-foreground`; never go below `--muted-foreground` contrast for meaningful text (AA).
- Links/inline-actions use spark `--primary` with underline-on-hover; visited not differentiated (app, not document).
- Disclaimer/AI-caveat strip uses `text-xs` `--muted-foreground` — present and readable, never shouting.

### 3.4 Financial-number formatting conventions (design + content)

- Currency: `$1,234.56` (2dp for fiat balances; abbreviate large with `$1.23M`/`$45.6K` in dense cells, full precision on tap/hover).
- APY: one decimal, **net** label mandatory — `4.2% net APY` (brief: honest, net-of-everything; never lead with gross).
- PnL: `+$312.40 (+2.8%)` gain / `−$88.10 (−0.7%)` loss, color + sign + arrow.
- Shares: explicit ERC-4626 — `1,024.5031 spvUSDC` with a `≈ $1,031.20` fiat equivalent beneath in `--muted-foreground`.
- Always tabular; align right in tables; never let a live value change width.

---

## 4. Spacing, grid & layout

### 4.1 Spacing scale (4px base — Tailwind default, no custom)

Use Tailwind's default 4px step (`1`=4 … `2`=8, `3`=12, `4`=16, `6`=24, `8`=32, `12`=48, `16`=64). **Density rules:**

- **Card padding:** desktop `p-6` (24), mobile `p-4` (16). Compact data cards `p-4`/`p-3`.
- **Section rhythm:** `space-y-6` between cards/sections desktop; `space-y-4` mobile.
- **Inline gaps:** `gap-2`/`gap-3` for chip rows, badge+label, icon+text.
- **Table cells:** `py-2.5 px-3`; never below `py-2` (touch + scannability).
- **Radius:** shadcn `--radius: 0.625rem` (10px) base. Cards/inputs/buttons `rounded-lg` (10px); chips/badges `rounded-full`; large hero panels `rounded-xl` (14px). Consistent, soft-but-not-bubbly.

### 4.2 Grid & breakpoints (desktop + mobile EQUAL — brief §4)

Tailwind breakpoints: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`. Design at **two canonical canvases**, both first-class:

| Canvas | Width | Layout model |
|---|---|---|
| **Mobile** | **390px** (design), 360 min support | Single column, chat-native, stacked sections; **Sheet/Drawer** for overlays; bottom-anchored primary CTA where thumb-reachable; sticky global header with non-custodial badge + wallet. |
| **Desktop** | **1440px** (design), 1024 min | 12-col grid, 24px gutters, max content `~1200–1280px`. **Side-by-side**: persistent left nav rail; primary content + a secondary panel (e.g., chat alongside portfolio/vault). **Dialog** for overlays. |

- **Responsive transform rule (carry everywhere):** multi-pane desktop layouts **collapse to stacked sections**; **Dialog→Drawer/Sheet** on mobile where touch ergonomics demand (brief §4). The chat surface is the through-line at both sizes.
- **Global shell:** desktop = left nav rail (icons+labels) + top bar (wallet, non-custodial badge, network=Base pill, notifications); mobile = top bar + bottom tab bar (or hamburger) with the same destinations. The **persistent non-custodial badge** and **always-available exit/withdraw** must be reachable in ≤1 tap at both sizes.
- **AI disclaimer strip** lives in the shell footer/below chat at both sizes.

### 4.3 Touch & hit targets

- Minimum interactive target **44×44px** (mobile) / 36px (desktop dense controls, with adequate spacing). Icon-only buttons get `size="icon"` (≥36, 44 on touch).

---

## 5. Elevation & depth

Dark-first depth = **surface step + hairline border first; shadow only for true overlays.**

| Level | Surface | Border | Shadow | Used for |
|---|---|---|---|---|
| 0 | `--background` | — | none | App canvas |
| 1 | `--card` / `--muted` | `1px --border` | none (optional `shadow-xs` on light) | Cards, panels, inputs |
| 2 | `--popover` | `1px --border` | `shadow-md` | Dropdown, Popover, Tooltip, Select |
| 3 | `--popover` | `1px --border` | `shadow-lg` + scrim | Dialog, Drawer/Sheet, command palette |

- **Scrim** behind Dialog/Drawer: `bg-black/60` (dark), `bg-black/40` (light) + subtle backdrop-blur (`backdrop-blur-sm`) — focuses attention on signing/confirmation moments.
- **AI presence depth:** the AI "thinking" state may use `--spark-glow` as a soft ring/halo (motion-gated, §7) — this is the *one* sanctioned decorative glow, and only on AI elements.
- No nested shadows; no neumorphism; borders carry most separation.

---

## 6. Data visualization (Recharts)

Charts must read as **calm, precise instruments**, not dashboards-for-show. All via **Recharts** (brief stack). Three primary chart types are first-class:

### 6.1 Shared chart style tokens

- **Grid:** horizontal lines only, `--border` at ~40% alpha; no vertical grid; no chart border box.
- **Axes:** `--muted-foreground`, `text-xs`, **tabular** tick labels; minimal ticks (4–5 y, sparse x); abbreviate ($1.2M, 4.2%). Hide axis lines, keep ticks subtle.
- **Tooltips:** custom shadcn-styled card (`--popover`, `1px --border`, `shadow-md`, `rounded-lg`), tabular numbers, date header + value rows with the series' color swatch. Crosshair = 1px dashed `--muted-foreground`.
- **Empty/loading:** skeleton shimmer at chart height (§7); empty = centered muted icon + "No data yet" microcopy, never a broken axis.
- **Numbers:** every value tabular; currency/percent formatted per §3.4.

### 6.2 Net-worth area chart (Portfolio hero)

- **Type:** `AreaChart`, single series, **spark-derived** stroke with a vertical gradient fill fading to transparent.
  - Stroke `--primary` (spark) at full; fill `linear-gradient(--primary 18% → 0%)`. This is one of the *few* sanctioned spark usages outside CTA — it reads as "your money, the thing of focus."
  - If the series is net *down* over the selected range, **do not recolor the whole area red** (avoid alarm); keep spark stroke, and surface the −% in the PnL readout above with `--loss`. (Color-by-sign on the *number*, not the area.)
- **Range tabs:** `1D / 1W / 1M / 1Y / All` as shadcn `Tabs` or segmented `ToggleGroup`.
- **Interaction:** hover/scrub → tooltip + a spark dot on the line; last point always dotted.

### 6.3 Allocation donut (Portfolio + Vault)

- **Type:** `PieChart` with `innerRadius` (donut), center label = total + count.
- **Color:** **allocation-by-risk-tier uses the §2.5 risk palette directly** (violet→magenta) so the donut *is* a risk read. Allocation-by-asset (USDC/vault/idle) uses the categorical ramp (risk-1, risk-3, risk-5, neutral) — distinct, legend-labeled, never relying on color alone (legend carries label + %).
- **Legend:** right (desktop) / below (mobile), each row = swatch + label + `%` + tabular `$`.
- Min slice handling: slices <3% collapse into "Other" with disclosure.

### 6.4 APY history (Vault)

- **Type:** `LineChart` (or thin area), **net APY** series; `--success`/`--gain` stroke is acceptable here *only because APY-up is literally the safe/good axis* — but keep it muted/desaturated so it doesn't compete with PnL greens. Prefer a neutral/blue (`--info`) stroke + label "net APY" to avoid implying guaranteed gains.
- Show a faint reference line for "current APY" and a `7d/30d/90d` range toggle.
- **Honesty rule (brief non-goals):** never annotate with projected/extrapolated future APY; historical + current only. No cherry-picked windows in default view.

### 6.5 Risk & caps meters

- **Risk meter:** 5 segments using `--risk-1…5`, filled to the tier, numeric `n/5` + label. (Linear segmented bar, not a gauge.)
- **Caps meter** (per-user cap / vault TVL cap — beta-gated): shadcn `Progress` styled; fill `--primary` when healthy, switch to `--caution` ≥80%, `--destructive` at/over cap, with "Cap reached" state (brief constraints). Always tabular `$X used / $Y cap`.

---

## 7. Motion

**Subtle, functional, fast** — motion clarifies state change and signals AI presence; it never decorates or delays.

| Pattern | Spec | Notes |
|---|---|---|
| **Durations** | micro 120ms · standard 180–220ms · overlay 240ms | Nothing slower than ~280ms in the core path. |
| **Easing** | `ease-out` for enters, `ease-in` for exits; standard `cubic-bezier(0.2,0,0,1)` | shadcn/Radix defaults are fine. |
| **Dialog/Drawer** | fade scrim + scale-in (Dialog) / slide-up (Sheet) | Radix data-state animations. |
| **Cards/lists** | fade+`transl-y-1` on mount; no stagger >40ms | Keep dense lists snappy. |
| **AI "thinking"** | spark dot pulse + optional `--spark-glow` halo + tool-step ticker | The sanctioned brand motion — signals AI presence (brief §5 "tool-step / thinking transparency"). Pulse opacity 0.4↔1, ~1s loop. |
| **Number transitions** | balances/APY **tween over ≤300ms** but **never reflow width** (tabular) | No odometer gimmicks; calm count is fine. |
| **Skeletons** | shimmer 1.2s linear loop, `--muted`→`--muted` lighter | All loading states (chart, table, card). |
| **Success (sign/deposit)** | brief `--success` check-draw, ≤400ms, then settle | Confirmation moments may have *one* satisfying beat — never confetti/casino. |
| **Blocked/guardrail-fail** | short shake (`transl-x ±4px`, 1 cycle) + `--destructive` | Signals "Sign disabled until acknowledged" friction without being punitive. |

**Reduced motion (required):** honor `prefers-reduced-motion: reduce` — disable shimmer, pulse/glow, scale/slide and shake; replace with instant state + opacity cross-fade ≤80ms. AI "thinking" falls back to a static spark dot + text label. No information may be conveyed by motion alone.

---

## 8. Iconography

- **Library:** **Lucide** (shadcn's default; consistent 24/20/16 grid, 1.5–2px stroke). One library only.
- **Sizing:** inline-with-text 16; buttons/controls 18–20; nav 20; feature/empty-state 24–32. Stroke width 1.75 default.
- **Color:** inherit text color by default; semantic icons take the matching semantic token (check=success, alert-triangle=caution, lock/slash=blocked); risk icons may carry the risk-tier color but **always with the numeric/label** beside them.
- **Canonical icons (consistency contract):**

| Concept | Icon | Notes |
|---|---|---|
| Non-custody / self-custody | `shield-check` | The persistent badge; opens "prove-it" panel. |
| Keys / signing | `key` / `pen-line` | "You sign" affordance. |
| Guardrail / policy | `shield` / `list-checks` | Guardrail checklist. |
| AI assistant | dedicated **spark** mark (see §9) | Not a generic robot; the spark *is* the AI. |
| Gain / loss | `triangle` up/down (filled) | Pair with sign + color. |
| Risk | segmented meter + number | Avoid a single ambiguous "warning" icon for *tiers*. |
| Withdraw / exit | `arrow-up-from-line` / `door-open` | Always-available exit. |
| Pause-only kill-switch | `pause` | Never a "stop/lock-funds" metaphor — it cannot block withdrawals. |
| Network (Base / Sui) | Base + Sui wordmark/logo assets | **Persistent network switcher** pill (multi-network). |
| Bridge (Base ↔ Sui) | `arrow-left-right` / `route` | Bridge surface + bridge intent. |
| Simulation | `flask-conical` / `activity` | Tenderly-style pre-trade preview. |

- **Don't** mix filled and outline styles arbitrarily; Lucide is outline — use fill only for tiny directional PnL triangles and active states.

---

## 9. Brand mark & AI identity

- **Spark mark:** a single, simple spark/spark-burst glyph in the brand accent — cobalt `--primary`, and where a richer brand moment is warranted (logo lockup, Spark Core landing, AI bloom) rendered in the **signature blue→cyan→gold→coral gradient** — used as the app logo and — critically — as the **AI assistant identity** (avatar, "AI is thinking," "AI suggestion — you approve & sign" affordance). Keeping the mark = the AI presence makes the brand accent do double duty as brand + "this is the model speaking."
- **AI message styling:** assistant turns get the spark avatar + a faint `--spark-subtle` left border or chip; user turns are neutral. The **"AI suggestion — you approve & sign"** label (brief recurring motif) renders as a small spark-tinted `Badge` on every recommendation/action card.
- **Never** let the spark mark imply autonomy beyond proposal — it always sits next to the sign/guardrail affordances, reinforcing "AI proposes, you dispose."

---

## 10. Accessibility (WCAG AA — required, both themes)

1. **Contrast:** body/meaningful text ≥ **4.5:1**; large text (≥24px/≥19px bold) and UI components/graphical objects ≥ **3:1**. The token values in `tokens.css` are tuned for this on the deep indigo-navy dark base; light theme mirrors. The brand `--primary` (cobalt) as a *fill* uses its `--primary-foreground` for AA; the brand accent as *text* on the dark canvas must be **verified for AA per `tokens.css`** — re-verify any new placement (and note gold/coral warm accents need particular contrast care as text).
2. **Never color-only:** every semantic/risk signal pairs color with **icon + text/number** (PnL sign+arrow, guardrail check/slash, risk `n/5`+label, allocation legend labels). Colorblind users must read every state.
3. **Focus visible:** a **2px spark `--ring` focus ring with 2px offset** on every interactive element (Radix/shadcn `focus-visible`). Never remove outlines; the ring is part of the spark system and must meet 3:1 against adjacent colors.
4. **Keyboard:** full operability — logical tab order, Radix roving focus in menus/tabs/lists, Esc closes overlays, Enter/Space activate, arrow-key nav in Tabs/ToggleGroup/Select. The **sign flow must be fully keyboard-completable**, and "Sign" remains keyboard-focusable-but-disabled until guardrail alerts are acknowledged (disabled state communicated via `aria-disabled` + helper text, not color alone).
5. **Targets & spacing:** §4.3 (44px touch / 36px dense desktop).
6. **Semantics/ARIA:** charts get text/table alternatives or `aria-label` summaries (e.g., "Net worth $X, up Y% over 1M"); live-updating financials use polite `aria-live` sparingly (don't spam SRs on every tick); icon-only buttons require `aria-label`; the non-custodial badge announces its state.
7. **Motion:** §7 reduced-motion is an accessibility requirement, not a nicety.
8. **Tabular numerals** also aid low-vision scanning — keep them everywhere financial.
9. **Hit-state clarity:** hover, active, focus, disabled, and selected are visually distinct on every control (not just hover).

---

## 11. Component → shadcn/ui mapping

The reference map from product concepts to shadcn primitives + Recharts. The build composes these; designers spec against them.

| SparkPoint concept / surface | shadcn/ui primitive(s) | Notes / variant |
|---|---|---|
| Chat action / recommendation / confirmation card | `Card` (+ `CardHeader/Content/Footer`) + `Badge` | **≤2 actions** per card (OpenAI Apps SDK benchmark); footer holds the 1–2 buttons; "AI suggestion — you approve & sign" badge in header. |
| Primary CTA (Sign, Deposit, Connect) | `Button` `variant="default"` (spark) | One per view; spark fill. |
| Secondary / tertiary actions | `Button` `variant="secondary" | "outline" | "ghost"` | Never spark. |
| Suggested-prompt chips | `Button` `size="sm" variant="outline"` or `Badge` (interactive) | Spark-tint on hover (AI presence). |
| Non-custodial badge → "prove-it" panel | `Badge` (trigger) → `Dialog` (desktop) / `Sheet` (mobile) | `shield-check` icon; opens permissions panel. |
| Self-custody guarantees / Trust Center panels | `Card` + `Accordion` + `Tabs` | Five guarantees as accordion/list; permissions as `Table` of granted on-chain scopes (mono). |
| Guardrail checklist | `Checkbox` (ack) + list rows w/ semantic icons + `Alert` | Sign disabled until required acks checked (Rabby). |
| Execution confirmation / simulation (Tenderly-style) | `Dialog`/`Drawer` + `Table` (balance-change) + `Alert` + `Button` | Balance-change table (tabular, +/− colored), gas, approvals, guardrail checklist, spark Sign CTA. |
| Pre-trade balance-change / shares preview | `Table` | Right-aligned tabular; semantic +/−; ERC-4626 shares row. |
| Onboarding risk scenario cards | `Card` (selectable) / `RadioGroup` of cards | Scenario-based ("$1,000 → $800…"); selected = spark ring. |
| Resulting **mandate** summary | `Card` + `Badge` (risk tier from risk palette) + `Slider` (adjust) | Adjustable; risk chip uses §2.5. |
| Risk tier chip / score | `Badge` (risk-palette variant) + segmented meter | `n/5` + label always. |
| Risk meter / caps meter | `Progress` (styled) or custom segmented bar | Caps: spark→caution→destructive per §6.5. |
| Net-worth hero + chart | `Card` + Recharts `AreaChart` + `Tabs`/`ToggleGroup` (range) | Spark area; PnL readout colored by sign. |
| Allocation donut | `Card` + Recharts `PieChart` (donut) + `Legend` | Risk-palette or categorical ramp; labeled legend. |
| APY history | `Card` + Recharts `LineChart` + `ToggleGroup` (7/30/90d) | Net APY; info/neutral stroke; no projections. |
| Strategy recommendations (ranked) | `Card` list / `Table` + `Badge` (risk) + "Why this?" `Popover`/`Accordion` | Ranked vs goal; "why this?" disclosure. |
| Vault deposit / withdraw | `Card` + `Tabs` (Deposit|Withdraw) + `Input` + `Button` + shares/APY readouts | Legible shares + net APY + caps meter; always-visible Withdraw. |
| Outcome log (wins & losses) | `Table` / `Card` list + `Badge` (gain/loss) + link to originating recommendation | Honest; both outcomes; tabular. |
| Automation / session-key grant | `Dialog`/`Sheet` + `Form` (scope/cap/expiry) + `Switch` + `Slider` + `Button` (Revoke = destructive) | Scoped, time-boxed; instant Revoke prominent. |
| Notifications | `DropdownMenu`/`Popover` + `Badge` (count) + (toast) `Sonner` | Toasts for tx/sign results. |
| Toasts / inline status | `Sonner` (toast) + `Alert` | Semantic-colored; success/blocked beats per §7. |
| Literacy hub / contextual tips | `HoverCard`/`Popover` + `Card` + `Accordion` | `--info` tone, not green. |
| Settings | `Tabs` + `Form` controls (`Input`, `Switch`, `Select`, `RadioGroup`) | — |
| SRK utility surface | `Card` + `Tabs` + `Badge` | Non-essential; never gates core flows. |
| Global nav (desktop rail / mobile tabs) | custom + `Tooltip` (rail) / `Tabs`-style bottom bar | Base pill, wallet, non-custodial badge. |
| Wallet connect | `Dialog` (connector list) + `Button` | WalletConnect/Coinbase per stack. |
| Network switcher (persistent) | `DropdownMenu` + `Badge` (active network) | **Multi-network: Base (live) + Sui (fast-follow).** Switching updates the active-network indicator and the per-network wallet address. Bridge (Base ↔ Sui) is a dedicated surface. |
| Loading states | `Skeleton` | Charts, tables, cards. |
| Empty states | `Card` + Lucide icon + microcopy + optional CTA | Per §6.1 / brief states. |
| Beta-gate / not-whitelisted / caps-reached | `Alert` / `Card` + `Badge` | Design these explicit states (brief constraints). |
| Confirmable destructive (revoke, full exit) | `AlertDialog` | Extra-confirm; Revoke/Exit are *user-empowering*, not scary — phrase positively. |
| Tooltips / definitions | `Tooltip` / `HoverCard` | Term definitions, info affordances. |

---

## 12. Acceptance criteria (design-system conformance)

A screen/component conforms to this system when **all** hold:

1. **Token-only color.** No raw hex in specs; every color names a token, with **`tokens.css` as the source of truth** for values (this doc's inline hex is illustrative). Each colored element answers "brand, outcome, or risk?" with exactly one system.
2. **Brand-accent scarcity.** ≤1 brand (cobalt) primary CTA per view; the brand accent (cobalt/gold/coral + the signature gradient) otherwise appears *only* on AI presence (avatar/thinking/"AI suggestion" label, suggested-prompt active, net-worth area, focus ring) and brand-identity moments. No brand accent — and never gold/coral/gradient — on gains/loss/caution/risk.
3. **Strict semantics.** Green=gain/safe, red=loss/blocked, amber=caution, blue=info — and **never** the brand accent (cobalt/gold/coral/gradient). Every semantic state pairs color + icon + text.
4. **Risk palette reused.** The same **5-step violet→magenta** palette (§2.5) drives every risk surface, always with a numeric step/label fallback, and never collides with the cobalt brand blue. Launch vault reads Risk 1 (Lower).
5. **Tabular everywhere financial.** All balances/APY/PnL/shares/caps use tabular numerals and right-align in tables; live values never reflow.
6. **Typography in-scale.** Sizes/weights from §3 only; weights ≤600; mono only for addresses/hashes/calldata/raw scopes.
7. **Dark-first, both themes AA.** Designed on dark; light provided; both meet WCAG AA contrast (§10.1) — verified, not assumed.
8. **Elevation discipline.** Depth via surface step + hairline border; shadow only on overlays (§5); the only sanctioned glow is AI presence.
9. **Both breakpoints, all states.** 390px mobile and 1440px desktop, each with default/empty/loading/success/warning/error; Dialog→Drawer/Sheet on mobile; non-custodial badge + exit reachable in ≤1 tap at both.
10. **Charts via Recharts, on-style.** Net-worth area / allocation donut / APY line follow §6 (calm axes, styled tooltip, tabular, honest — no projected APY, no whole-area red alarm).
11. **Motion subtle + reduced-motion safe.** Durations/easing per §7; `prefers-reduced-motion` fully honored; no info conveyed by motion alone.
12. **Accessible by construction.** Visible 2px spark focus ring + offset on every control; full keyboard operability incl. the sign flow; 44px touch targets; ARIA/text alternatives for charts and icon-only buttons; no color-only signals.
13. **Maps to shadcn.** Every component resolves to a primitive (or composition) in the §11 table; chat action/confirmation cards honor **≤2 actions** (OpenAI Apps SDK).
14. **Trust legible.** Non-custodial badge, "AI suggestion — you approve & sign" label, guardrail checklist with sign-disabled-until-acknowledged, and always-available exit are styleable and present wherever the flow calls for them — the design system gives each a defined, reused treatment.
