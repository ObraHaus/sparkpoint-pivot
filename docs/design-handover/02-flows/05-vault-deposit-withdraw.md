# 02 · Flow 5 — Vault Deposit / Withdraw (the Aave Yield Vault, ERC-4626)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts).
> **Status:** Authoritative screen-level spec for **Flow 5 (Vault Deposit / Withdraw)** of the six core flows. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to):** `00-brief.md` (positioning, thesis, the vault scope/constraints, non-goals), `01-information-architecture.md` (§1 routes `(app)/vault`, `vault/deposit`, `vault/withdraw`; §2 shell; §3 nav; §4 flow graph; §6 gating/degraded; §3.x the `/vault/withdraw` ↔ `/trust/exit` distinction), `04-design-system.md` (tokens, spark/semantic/**risk** palettes, type, **data-viz §6** incl. **§6.4 APY history** + **§6.5 risk & caps meters**, motion, a11y, shadcn map §11), `07-content-and-tone.md` (**all wording, the net-APY/shares/PnL/number formatting, caps & withdraw framing, tooltips, banned/required phrases, error/empty/warning copy, §8 vault worked examples**), `05-trust-and-safety-ux.md` (§2 prove-it panel, §3.3 caps dashboard, §3.4 kill-switch, **§4 escape-hatch / withdraw-always — the canonical `/trust/exit` spec**), `09-references.md` (**§3 yield-vault benchmarks**: Morpho/Gauntlet/Yearn/Beefy/PolicyLayer; §8 competitor intel). **Where this doc shows copy that conflicts with `07`, `07` wins on wording; where it conflicts with the brief on scope/tone, the brief wins; where it touches the escape hatch, `05` §4 is the source of truth (this doc references, does not re-spec, `/trust/exit`).**
> **What this doc IS:** goal & entry points; the screen sequence and every state (default / empty / loading / success / warning / error) for vault discovery, vault detail, deposit panel, withdraw panel, the withdraw-always state, and caps-reached; component anatomy → shadcn primitives + Recharts; desktop **and** mobile layout notes; microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria.
> **What it is NOT:** visual tokens (in `04`), canonical strings (in `07`), the IA/route map (in `01`), the **signing surface** (that is **Flow 6 / `/confirm/[txIntentId]`** — every state-changing action here routes there; **no signing happens in this flow**), the full **escape-hatch hub** (`/trust/exit` is specced in `05` §4 — this doc specs only how Vault *links and degrades into* it), or the chat/portfolio/strategy/trust flow specs (separate docs). It does **not** redefine the persistent app shell (in `01-IA` §2) — it inherits it.

---

## 0. Goal, scope, and the one-sentence job

**Job:** Let a whitelisted user **understand, fund, and exit the single Aave Yield Vault** — see net-of-fees APY and exactly where the money goes, deposit USDC and receive legible ERC-4626 shares, and **withdraw any amount at any time** (including a self-service on-chain exit that works even if SparkPoint is offline) — while making **non-custody visible at every step**. This is the **product** (`spec.md` US-1, P1) and the smallest viable slice that proves the central trust claim: *AI-managed yield, never touches your keys, withdraw anytime, provable on-chain.*

**The wedge this flow owns (brief; `09` §3, §8):** the vault tooling is table-stakes legible (Morpho/Gauntlet/Yearn/Beefy: **net APY + expandable breakdown**, **shares always shown**, **allocation "where your deposit goes"**, **caps meter**, curator/audit badges, history charts, "your position"). We **out-position the live competitors** (Giza/ARMA's token-subsidized headline APY + collapsed TVL; Fungi's fire-and-forget) on three things: **honest, non-subsidized net APY** (no token-incentive theater), **transparent risk + provable non-custody** surfaced *in the vault itself*, and a **withdraw-always escape hatch that is one tap from the deposit panel**. *Yield is shown, never sold.*

**Hard product/scope facts to encode (brief; `spec.md` FR-017/018/025/026/034; `data-model.md` E8/E9, VR-V*/VR-VP*):**
- **Exactly ONE vault at launch:** the conservative, **0%-on-principal / 0-management**, **non-upgradeable** `SparkPointVault` (ERC-4626), accepts **USDC only**, routes to **Aave v3** yield on Base, issues/redeems shares (`spvUSDC`), **governed for pause only**. It charges an **active 10% profit-only, high-water-mark performance fee on realized yield only** (configurable on-chain, hard-capped at 20%, timelocked; ratified by amendment v1.1.0). There is no second vault — "discovery" is a degenerate one-item case (see §3) and must not imply a marketplace we don't have.
- **The performance fee is a feature, disclosed explicitly** everywhere APY/redemption appears: "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal" (`07` §5.2). Redemption returns **principal + realized yield minus the profit-only performance fee on yield above the high-water mark; never any fee on principal** (`spec.md` FR-018). The fee accrues on-chain as fee-shares to a non-privileged recipient and **fails open** — it never blocks or delays a redemption.
- **ERC-4626 share model must be legible** (`09` §3 Morpho): deposit USDC at the current **share price** → receive `spvUSDC` shares; as the vault earns, share price rises and shares redeem for more USDC. **Always show shares received/redeemed** and the **fiat equivalent beneath** (`07` §5.4).
- **Net APY is the most-regulated number** (`07` §5.2, strict): one decimal + word "net" + "APY", **breakdown mandatory** ("4.2% net APY = 4.7% Aave supply rate − 10% SparkPoint performance fee (profit-only, high-water mark)"), **estimate-framed** ("rates change"), **never bare**, **never the lead** of a surface (`07` §9.1 #1/#2/#3). Prefer a **range** where volatile ("≈ 4.0–4.4% net APY (30-day range)").
- **Caps are real and beta-gated** (`spec.md` FR-025; `data-model.md` VR-V3): **per-user TVL cap**, **vault deposit cap**, **total protocol cap** — all read **fresh from chain at gate time** (`data-model.md` VR-DS1), surfaced as **remaining-capacity meters** in context, and a **deposit that would breach any cap is blocked BEFORE signing** (the block renders on `/confirm`, but the deposit panel must warn pre-emptively). Caps are framed as *current limits that protect users*, never as failures (`07` §2.3, §6.1 "Cap reached").
- **Withdraw is never gated** — not by caps, not by the kill-switch, not by backend health, not by whitelist/geo state (`spec.md` FR-026/034, SC-003; `data-model.md` VR-V2, VR-VP2; `01-IA` §6 Hard IA rule). **`deposits_paused` MUST never block `withdraw`/`redeem`.** The withdraw panel and the on-chain escape hatch must be reachable and functional in **degraded mode**.
- **No signing here.** Deposit and Withdraw build a `txIntent` and route to **`/confirm/[txIntentId]`** (Flow 6) — the single shared simulation + guardrail-checklist + sign surface (`01-IA` §0.3, §4.2.3). This flow's job ends at "build the intent and hand off"; the live shares/USDC preview here is a **convenience estimate**, re-simulated authoritatively on `/confirm`.

**Tone for this flow (`07` §1.3):** *the product surface — confident about process, humble about outcome.* Plain, sober, capital-preservation-first. Lead with **control + non-custody + where-the-money-goes**, *then* yield (`07` §9.1 #3). Honest about risk and the live single-vault reality; no hype, no urgency, no FOMO, no token-incentive theater (`07` §9.1 #9; `09` §8 anti-Giza).

---

## 1. Entry points & exits

### 1.1 Entry points (`01-IA` §4.3, §3)
| From | Lands on |
|---|---|
| **Primary nav** ("Vault" — top bar desktop / bottom tab mobile, `01-IA` §3 tier 3) | `/vault` (overview / vault detail) |
| **Chat** (`ActionCard` "deposit/withdraw", `01-IA` §4.4 ②) | builds `txIntent` → `/confirm`, **or** deep-links `/vault/deposit` / `/vault/withdraw` to set the amount first |
| **Strategies** ("accept" the Aave Yield Vault recommendation, `01-IA` §4.4 ③) | `/vault/deposit` (pre-filled intent) → `/confirm` |
| **Portfolio** (allocation, positions-table **Add / Withdraw** on the vault position, `01-IA` §4.4 ①) | `/vault/deposit` or `/vault/withdraw` → `/confirm` |
| **Onboarding completion** (primed first message "want to fund your vault?", `01-IA` §5 Stage C/D) | `/vault` or `/vault/deposit` |
| **Trust Center** (caps dashboard, kill-switch, prove-it **[Withdraw now]**) | `/vault` (detail) or `/vault/withdraw` / `/trust/exit` |
| **Notifications** (caps near-limit, kill-switch active, yield update) | `/vault` or `/trust` |

### 1.2 Exits (where the vault sends you)
- **Deposit →** builds a `txIntent` (`action_kind=vault_deposit`) → **`/confirm/[txIntentId]`** (Flow 6: simulation + guardrail checklist + sign). **No sign here.**
- **Withdraw (in-app) →** builds a `txIntent` (`action_kind=vault_withdraw`) → **`/confirm/[txIntentId]`**. **No sign here.**
- **Withdraw-always / escape hatch →** **`/trust/exit`** (the canonical hub, `05` §4) — documents the **on-chain, no-frontend** path (Path B) in addition to the in-app path (Path A). Reachable in **≤1 tap** from the deposit/withdraw panels and the shell.
- **Prove-it →** persistent shell badge → permissions panel (`05` §2); plus an in-context "Who can move these funds? → **You only**" affordance on vault detail (§4.6).
- **Learn →** net-APY / shares / performance-fee (profit-only, HWM, 0% on principal) tip cards → `/learn/[slug]` (`07` §4.3 glossary).
- **Ask AI →** "Ask about this vault" → `/chat` primed with the vault in context (Flow 2).
- **Strategies →** "compare strategies" cross-link (honest at launch: only this vault is live; more as vaults open).

---

## 2. Shell context & layout model (inherits `01-IA` §2)

The Vault renders **inside the authenticated app shell** — it does **not** define its own. Inherited and always present (do not re-spec, do not omit): the **non-custodial badge** → prove-it panel, the **wallet/connection status** chip (Base pill), the **AI disclaimer strip** (with **[Prove it]** / **[Exit anytime]**), primary nav, secondary nav (with **Withdraw / Exit** pinned, `01-IA` §3.x), command menu, notifications. **Withdraw/exit + prove-it are ≤1 tap from every screen in this flow** (hard IA rule, `01-IA` §0; `05` §1.2).

> **Per-route state files (`01-IA` §1):** `/vault`, `/vault/deposit`, `/vault/withdraw` each ship `loading.tsx` (skeleton) and `error.tsx` (recoverable + "withdraw is still available" reassurance). **`/vault/withdraw` must additionally define a degraded-mode variant** that promotes the on-chain escape hatch (`01-IA` §1; `05` §4.3).

### 2.1 Layout model (both canvases — `04` §4.2)

- **Desktop (1440 design, 1024 min):** the **vault detail** is the spine — a two-zone layout under the shell, max content ~1200–1280px:
  - **Left / main column (≈ 8 col):** vault header (name + curator/audit + risk badges), **net-APY hero** (big + expandable breakdown), the **"where your funds go" allocation** panel, history charts (APY + TVL), and the audits/curator block. This is a *legible data layout* (Gauntlet/Morpho), not a conversational column.
  - **Right rail (≈ 4 col, sticky):** the **action card** — a `Tabs` (**Deposit | Withdraw**) panel with the amount input, **live shares preview**, **caps meter**, and the always-present **Withdraw-always / "Exit anytime"** link beneath. Plus the **"your position"** sub-panel (shares held · share price · underlying value · realized yield) above or below the action card. *Keeping Deposit and Withdraw on the same card, with Withdraw never more than a tab away, is a deliberate non-custody decision (exit is co-equal with entry).*
- **Mobile (390 design, 360 min):** single column, stacked, scroll order: **vault header (name + risk/curator/audit chips) → net-APY hero + breakdown disclosure → "your position" (if any) → primary action (Deposit/Withdraw `Tabs`) with bottom-anchored CTA → caps meter → "where your funds go" → history charts (collapsible) → audits/curator → withdraw-always link.** The **action card is the priority** above the fold once a user intends to act; the detail (allocation, history) sits below. Overlays (APY breakdown, shares tip, caps "why?", confirmation handoff) = **Sheets/Popovers**, not Dialogs. The Deposit/Withdraw CTA is **bottom-anchored** within thumb reach.
- **Responsive transform:** desktop right-rail action card → a mobile **bottom-anchored action card / `Sheet`**; two charts side-by-side → stacked + `Tabs` (APY / TVL); allocation table/list stays a list; tooltips → tap-`Popover`; `HoverCard` breakdown → `Accordion`/`Sheet`.

> **Don't over-stuff (Zerion critique, `09` §2):** progressive disclosure. The detail shows each dimension's *summary*; depth (full APY breakdown, four-dimension risk rationale, full history, every allocation line) is one tap down via `Accordion`/`Popover`/`Sheet`.

---

## 3. Section A — Vault discovery (`/vault`) — the degenerate one-vault case

**Purpose:** Be the entry to *the* vault. At launch there is **exactly one** vault, so "discovery" is **not** a marketplace — it is either (a) a direct render of the single vault's detail at `/vault`, or (b) a one-card list that resolves straight into detail. **Recommended: `/vault` IS the vault detail** (no separate list screen), with the single card's data inlined. Do **not** fake a multi-vault grid, a "browse vaults" filter bar, or "more coming soon" placeholders that imply a catalog we don't have (honesty — `07` §9.1 #2/#3; brief scope).

### 3.1 If a discovery card is shown (e.g., reached from a "vaults" cross-link)
A single **vault summary `Card`** (the legible benchmark row — `09` §3 Gauntlet/Morpho):
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Name + symbol** | "Aave Yield Vault" · `spvUSDC` · "USDC" asset chip. | `Card` header + `Badge` | `07` §6.2 "Aave Yield Vault" |
| **Net APY** | "{X}% net APY (estimate)" + breakdown ≤1 tap; **not** the card's lead. | text + `Popover`/`HoverCard` | `07` §5.2 |
| **TVL** | "$X.XXM TVL" tabular, abbreviated; "of $Y.YYM cap" sub-line. | text (`.tnum`) | `09` §3; `04` §3.4 |
| **Risk badge** | "Lower · 1/5" + mini segmented meter, **risk palette only** (`04` §2.5). | `Badge` (risk-palette) + meter | `04` §2.5, §6.5 |
| **Curator / audit badges** | "Curated by SparkPoint" + "Audited" + "Non-upgradeable" chips. | `Badge` row | `09` §3 RockawayX/Chorus |
| **Caps state** | a slim caps meter or "Open" / "Filling" / "Cap reached" status chip. | `Progress` (styled) / `Badge` | `04` §6.5; `05` §3.3 |
| **CTA** | "View vault" → detail; (if reached with intent) "Review deposit". | `Button` (≤1 spark) | `07` §2.2 |

### 3.2 States
- **Default:** the single vault card / inlined detail.
- **Loading:** `Skeleton` for the card / detail sections (never a spinner, never `0` for APY/TVL — `07` §5.5).
- **Empty:** there is **never** an empty *list* (there is always one vault). The **pre-deposit / no-position** state of the detail is the meaningful "empty" — see §4.7 / `07` §6.2 "Vault (pre-deposit)".
- **Caps-reached:** the card shows a **"Cap reached"** status (amber/red-amber meter + chip); **deposit CTA disabled with reason; withdraw unaffected** — full treatment §8.
- **Kill-switch active (pause-only):** a "New deposits paused" chip; **withdraw path still surfaced** — §4.4 / §8.
- **Error:** recoverable `Alert` + retry + custody reassurance ("Your funds are safe and untouched.", `07` §6.1); **withdraw remains reachable** via the shell.

**Microcopy (defer to `07`):** never lead with the APY number (`07` §9.1 #3). No "browse"/"explore more vaults" implying a catalog. "Non-custodial — withdraw anytime" belongs on this surface (`07` §6.2 vault pre-deposit).

---

## 4. Section B — Vault detail (`/vault`) — the core legible surface

**Purpose:** Make the vault **fully legible and provably non-custodial in one screen**: net-of-fees APY + breakdown, TVL, risk score + rationale, **where the funds actually go**, audit/curator badges, history charts, and **"your position"**. Benchmark: **Morpho/Gauntlet** vault transparency template (APY current+historical, TVL, allocation breakdown, curator identity, risk), **Yearn/Beefy** net-APY convention, **PolicyLayer** four-dimension risk rationale (`09` §3).

### 4.1 Vault header
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Name + asset + symbol** | "Aave Yield Vault" · accepts **USDC** · share token **`spvUSDC`**. | `Card` header + `Badge` chips | `data-model.md` E8 |
| **Risk badge** | "Lower · 1/5" + segmented meter (risk palette, never color-only). At launch the vault is **Risk 1**. | `Badge` (risk-palette) + meter | `04` §2.5; brief |
| **Curator / audit / non-upgradeable chips** | "Curated by SparkPoint", "Audited" (→ audit), **"Non-upgradeable"**, **"0% on principal"**, **"Profit-only fee · 10% of yield"**. The non-upgradeable + 0%-on-principal + profit-only-fee chips are **trust payload**, not decoration. | `Badge` row | `09` §3; `05` §3.5; `07` §2.1 |
| **Prove-it inline affordance** | "Who can move these funds? → **You only**" micro-line → permissions panel / `/trust/permissions`. | text + link → `Sheet` | `05` §2; §4.6 below |
| **Ask AI** | "Ask about this vault" → `/chat` in context. | `Button` (ghost) | Flow 2 |

### 4.2 Net-APY hero + breakdown (the most-regulated number — `07` §5.2)
| Element | Detail | shadcn / Recharts | ref |
|---|---|---|---|
| **Net APY figure** | Big, tabular, **"{X}% net APY"** (one decimal + word "net"); **estimate-framed** ("estimate · rates change"). Prefer a **range** when volatile: "≈ 4.0–4.4% net APY (30-day range)". **Never bare; never the page's literal lead** — the header (name/risk/non-custody) precedes it. | `Card` + `.tnum` | `07` §5.2; §9.1 #1/#3 |
| **Breakdown (mandatory)** | Expandable: **"4.2% net APY = 4.7% Aave supply rate − 10% SparkPoint performance fee (profit-only, high-water mark)."** Line items: base Aave supply rate; any incentives stated **separately and honestly** (none token-subsidized at launch — anti-Giza, `09` §8); **the 10% profit-only performance fee stated explicitly (0% on principal)**; = net. | `Accordion` (desktop) / `Sheet` (mobile) | `07` §5.2; `09` §3 Beefy/Yearn |
| **APY tip** | First encounter → `TipCard` (`--info` blue): "What's net APY?" (`07` §4.3 canonical). Dismissable. | `Popover`/`Card` `TipCard` | `07` §4.2; **info ≠ green** |
| **"Estimate, not a promise"** | A persistent micro-line near the figure. | `text-xs muted` | `07` §5.2, §3.3 |

> **Hard rule:** every APY readout in this flow (detail hero, discovery card, deposit "est. yield", your-position) is **net + breakdown ≤1 tap + estimate-framed**, never bare, never leading (`07` §5.2; `04` §3.4). No projected/annualized-from-a-good-window numbers (`07` §9.1 #2).

### 4.3 "Where your funds go" — allocation / routing panel
**Purpose:** Answer "where does my money actually sit?" — the **Gauntlet "where your deposit goes"** panel (`09` §3). At launch this is simple and honest: **USDC → SparkPointVault → Aave v3 (Base) supply**. Do not invent a multi-market split we don't have.
- **Anatomy:** a short routing diagram / list — "Your USDC → Aave Yield Vault (`spvUSDC`) → supplied to **Aave v3** on Base" — with the **Aave v3** target as a whitelisted-protocol chip (`spec.md` FR-016/027), each contract **linkable to BaseScan** (provable, not asserted — `05` §1.1). If/when allocation gains structure, render as a small allocation list/bar (% per target, tabular).
- **Whitelist note:** "Only whitelisted protocols (Aave v3, Aerodrome)." — reinforces the policy guardrail.
- **shadcn:** `Card` + list/`Separator` + `Badge` (protocol) + explorer links.
- **ref:** `09` §3 Gauntlet; `data-model.md` E8; `spec.md` FR-016/027.

### 4.4 Audits, curator, non-upgradeable, kill-switch status (trust block)
- **Audits:** badge(s) linking to the audit artifact(s) (PDF/explorer) — honestly framed (`05` §3.5; `09` §3). If unaudited at a given moment, **say so plainly** rather than implying coverage.
- **Curator:** "Curated by SparkPoint" + posture ("conservative, capital-preservation-first" — Steakhouse/blue-chip end of the spectrum, `09` §3 RockawayX/Chorus). No aggressive-curator theater.
- **Non-upgradeable + pause-only:** "This vault is **non-upgradeable** — its rules can't change. SparkPoint can **pause new deposits** but can **never move your money or block withdrawals**." (`07` §2.1 "Pause only — this can never block your withdrawals"; `05` §3.4). Links to `/trust` kill-switch status.
- **Kill-switch status chip:** mirrors `/trust` — **inactive/nominal** (neutral) or **active/paused** (amber "New deposits paused · withdrawals never paused"). Never red; never implies withdrawals can stop (`05` §3.4; `07` §9.1 #7).
- **shadcn:** `Card` + `Accordion` (guarantees) + `Badge` (status) + links.

### 4.5 History charts (APY + TVL)
- **Net-APY history** (`04` §6.4): `LineChart` (or thin area), **net APY** series; **neutral/`--info` (blue) stroke + "net APY" label** (NOT green — avoid implying guaranteed gains), muted/desaturated; faint **"current APY" reference line**; **`7d / 30d / 90d`** range toggle. **No projected/extrapolated values** (`04` §6.4; `07` §9.1 #2).
- **TVL history** (optional companion): `AreaChart` or `LineChart`, neutral stroke, same range toggle; shows the vault filling toward cap (ties to caps meter §6).
- **Layout:** desktop side-by-side or stacked; mobile stacked with a `Tabs` (APY / TVL) switcher.
- **States:** *Default* charts at default range (30d). *Loading* = skeleton at chart height (never a broken axis — `04` §6.1). *Empty / new vault* = "Not enough history yet" centered muted, never a fake flat line. *Error* = "Couldn't load history" + retry; the rest of detail still renders.
- **shadcn / Recharts:** `Card` + Recharts `LineChart`/`AreaChart` + `Tabs`/`ToggleGroup` (range) + styled tooltip (`04` §6.1).

### 4.6 "Your position" sub-panel (shares held · share price · underlying value · realized yield)
**Purpose:** The **Gauntlet/Morpho "your position"** read (`09` §3 line 69) — make the ERC-4626 stake legible. Present only when the user holds `spvUSDC`.
| Element | Detail | format / ref |
|---|---|---|
| **Shares held** | `1,024.5031 spvUSDC` with **fiat equivalent beneath** `≈ $1,031.20`. | `07` §5.4 |
| **Share price** | current share price (USDC per `spvUSDC`), tabular; first-encounter tip "share count fixed, value floats" (`07` §4.2 shares). | `07` §4.3 shares |
| **Underlying value** | current redeemable USDC value, tabular, full precision. | `07` §5.1 |
| **Realized yield** | yield earned to date (accrued), labeled; symmetric/honest if a window shows flat. | `07` §5.3; `data-model.md` §9 |
| **Provenance** | "as of {relative time}", onchain-derived, reconstructable; stale-labeled if degraded. | `07` §5.5; `data-model.md` VR-VP2 |
| **Actions** | **Add** (→ Deposit tab) · **Withdraw** (→ Withdraw tab) · "View in portfolio" (`/portfolio/positions/[id]`). | route only; **no sign** here |
| **Linked recommendation** | if the position came from an accepted rec → link to its Outcome Log entry (`/activity/[entryId]`). | `01-IA` §4.2.4 |
- **Prove-it micro-affordance:** "Who can withdraw these? → **You only**" → permissions panel (`05` §2.3 "No admin withdrawal").
- **States:** *Default* (populated). *No position* → this sub-panel is replaced by the pre-deposit invitation (§4.7). *Loading* = `Skeleton`. *Stale/error* = labeled "as of {time}" / "couldn't load value right now" + retry; **Withdraw still works** (non-custody, `05` §4.3).
- **shadcn:** `Card` + labeled rows (`.tnum`) + `Tooltip` (definitions) + `Button` (actions).

### 4.7 Pre-deposit / no-position state (the meaningful "empty")
When the user has no `spvUSDC` yet, the detail is fully shown (APY, allocation, risk, history, audits) and the "your position" slot becomes the **invitation** (`07` §6.2 "Vault (pre-deposit)"): title **"Aave Yield Vault"**, body **"Conservative, capital-preservation-first yield on USDC. {X}% net APY (estimate). Non-custodial — withdraw anytime."**, CTA **"Review deposit"**. **The withdraw-always documentation is still linked here** so users learn the exit exists *before* depositing (`05` §4.3 empty-state requirement).

### 4.8 Vault-detail states (the six)
- **Default:** full detail + (your position **or** pre-deposit invitation).
- **Empty:** the pre-deposit state (§4.7) — never a dead `$0.00` / broken charts.
- **Loading:** section skeletons (header, APY hero, allocation, charts, your-position) — never spinner-over-stale, never `0` for APY/TVL/shares (`07` §5.5).
- **Success:** returning after a confirmed deposit/withdraw — your-position figures tween ≤300ms, no width reflow; the `Sonner` toast already fired on `/confirm`, don't re-celebrate (`07` §2.5; `04` §7).
- **Warning:** **caps near-limit** (amber caps meter + "near cap" note, §6), **kill-switch active** (amber "new deposits paused", §8), **stale data** ("as of {time}", `07` §5.5). All informational; none remove withdraw.
- **Error:** recoverable `Alert` + retry + custody reassurance; **withdraw reachable** via shell + the in-detail withdraw tab (`07` §6.1; `01-IA` §6).

---

## 5. Section C — Deposit panel (`/vault/deposit`)

**Purpose:** Take a USDC amount, show a **live shares preview** and **net-APY-based estimate**, surface the **caps meter**, and **build the `txIntent` → route to `/confirm`** (Flow 6). Benchmark: Morpho deposit (shares preview), Beefy/Yearn (net APY), Gauntlet (caps). **No signing here** — the preview is a convenience estimate; `/confirm` re-simulates authoritatively.

### 5.1 Anatomy → shadcn
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Tabs (Deposit | Withdraw)** | The action card is a two-tab control; **Deposit** active here. Withdraw is always one tap away (non-custody — exit co-equal). | `Tabs` | `04` §11 (vault deposit/withdraw) |
| **Amount input** | USDC amount; `$`/USDC affixed; **tabular**; numeric keypad on mobile; validates ≥ min and ≤ available + cap. | `Input` (`.tnum`) | `07` §5.1; `04` §3.4 |
| **Max / % chips** | **25% · 50% · Max** quick-fills from the user's USDC balance, **capped at the per-user remaining cap** (Max = min(wallet USDC, remaining cap)). | `Button size=sm`/`ToggleGroup` | `09` §3; `07` §2.3 |
| **Balance line** | "Balance: {amount} USDC" (wallet) + "Max {amount} (your beta cap)" helper. | `text-xs muted` | `07` §2.3 helper |
| **Live shares preview** | **"Deposit {X} USDC → receive ≈ {Y} spvUSDC"** + share price used + **"≈ ${value}"** beneath; updates live as amount changes. **Always show shares** (ERC-4626 legibility). | `Card`/rows (`.tnum`) | `07` §5.4; `09` §3 Morpho |
| **Est. yield** | "Est. yield at current rate: ≈ ${A}/yr ({X}% net APY · estimate · see breakdown)." **Estimate-framed, net, breakdown ≤1 tap, not the lead.** | text + `Popover` | `07` §5.2; §9.1 #1/#3 |
| **Caps meter** | per-user cap (and vault TVL cap) remaining-capacity meter **inside the panel**: "$X used / $Y cap"; healthy = spark fill, **≥80% = caution amber**, at/over = destructive "Cap reached". Tabular; "why caps?" tip. | `Progress` (styled, `04` §6.5) | `04` §6.5; `05` §3.3 |
| **Non-custody line** | "Non-custodial — withdraw anytime." + "[Exit anytime]" link → `/trust/exit`. | text + link | `07` §6.2; `05` §4 |
| **Primary CTA** | **"Review deposit"** (spark, one per view) → builds `txIntent` → `/confirm`. **Never "Deposit now" / "Invest"** (banned, `07` §2.2). | `Button variant=default` | `07` §2.2; `01-IA` §0.3 |
| **Disclaimer** | inline per-card micro-disclaimer "AI suggestion — you approve & sign" only if the amount arrived from an AI rec; the action itself: "Nothing moves until you sign." | `Badge`/`text-xs` | `07` §2.1, §3.3 |

### 5.2 Caps logic (pre-emptive, but the BLOCK lives on `/confirm`)
- The deposit panel reads caps **fresh from chain** (`data-model.md` VR-DS1) and **pre-emptively warns** as the amount approaches/exceeds the **per-user**, **vault deposit**, or **total protocol** cap.
- **If the entered amount would breach any cap:** the **"Review deposit" CTA is disabled** with a plain, non-punitive reason and a one-tap "set to max allowed" fix: *"This is above your beta cap. Max you can add now: ${remaining}."* (`07` §6.1 cap copy; `04` §10.4 disabled communicated via helper text + `aria-disabled`, not color alone). The **authoritative block** is still re-checked and rendered on `/confirm` (`spec.md` VR-V3 / SC-009 "blocked before signing") — the panel just prevents a doomed handoff.
- **Caps are protective, framed as current limits**, never failures (`07` §2.3, §6.1). "Beta cap: ${used} of ${cap} used."

### 5.3 Deposit states (the six)
- **Default:** empty amount, CTA disabled (no amount); caps meter at current fill; preview shows the share-price basis ("≈ — spvUSDC until you enter an amount").
- **Filled (valid):** live shares + est. yield update; CTA **"Review deposit"** enabled.
- **Loading:** building the `txIntent` / fetching share price / reading caps → `Skeleton` on the preview + a pending CTA state (never `0` for shares/APY).
- **Success:** there is **no success here** — success happens on `/confirm` after signing; returning shows the updated "your position" (§4.6) + a `Sonner` toast ("Deposit confirmed. You now hold {shares} spvUSDC (≈ ${value}). View transaction ↗", `07` §2.5).
- **Warning:** **near-cap** (amber meter + note), **kill-switch active** (deposits paused — §8: CTA disabled "new deposits paused", **withdraw tab + exit still offered**), **stale share price/APY** (labeled estimate; no execution on stale beyond tolerance — gate enforced on `/confirm`, `data-model.md` VR-DS2).
- **Error:** insufficient USDC ("You don't have enough USDC for this. Balance: {amount}." — not scary, `07` §6.1); insufficient gas (informed before handoff); amount below min ("Min deposit {amount}." helper); generic build failure → `Alert` + retry + custody reassurance; **withdraw unaffected**.

**Microcopy (defer to `07`):** "Review deposit" → (on `/confirm`) "Sign deposit"; never a one-tap money-mover that skips review (`07` §2.2, §9.1 #4). No bare APY; no return-led lead; lead with what-you'll-get + non-custody (`07` §5.2, §9.1 #3).

---

## 6. Caps meter (shared component — deposit panel, detail, discovery)

**Purpose:** Make beta caps **legible and reassuring** (caps protect users) and show **remaining capacity** at a glance. Benchmark: **Morpho/Gauntlet, Yearn, Beefy** caps meters (`05` §3.3; `09` §3).
- **Two meters** where relevant: **your per-user deposit cap** ("$X,XXX of $Y,YYY used") and the **vault TVL cap** ("$X.XXM of $Y.YYM"). Total protocol cap surfaces if it is the binding one.
- **Fill semantics (`04` §6.5):** spark/healthy → **caution amber ≥ ~80%** → **destructive at/over cap ("Cap reached")**. Always **tabular**; always an **accessible text equivalent** ("82% of your deposit cap used") — not color alone.
- **"Why caps?"** `Tooltip`/`HoverCard`: "Beta caps limit how much is exposed while we prove the system." (`05` §3.3).
- **shadcn:** `Progress` (styled) per `04` §6.5; `Tooltip`/`HoverCard`.
- **States:** default · near-limit (amber) · **at-cap** (full bar + "Cap reached — new deposits paused. Withdrawals are unaffected." → §8) · loading (`Skeleton` bar) · read-error (last-known + "as of {time}" + retry, never a confident wrong number).

---

## 7. Section D — Withdraw panel (`/vault/withdraw`) + the WITHDRAW-ALWAYS state

**Purpose:** Let the user **redeem any amount at any time**, by **underlying USDC amount OR by shares** (toggle), with a clear **redemption preview**, then build the `txIntent` → `/confirm`. **Critically, this panel and the on-chain exit must survive degraded mode** — withdraw is **never** gated (`spec.md` FR-026/034, SC-003; `data-model.md` VR-V2/VR-VP2; `01-IA` §6; `05` §4). Withdraw framing is **positive and empowering** — "Exit anytime", never "cash out" / "take profits" (`07` §2.2).

### 7.1 Anatomy → shadcn
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Tabs (Deposit | Withdraw)** | **Withdraw** active. | `Tabs` | `04` §11 |
| **By-amount / by-shares toggle** | Switch the input mode: enter **USDC to receive** OR **`spvUSDC` shares to redeem**; the other side is computed live. | `ToggleGroup`/`Tabs` (segmented) | `09` §3 ("by underlying OR by shares") |
| **Amount / shares input** | Tabular; validated ≤ position; **Max** redeems the full position. | `Input` (`.tnum`) | `07` §5.1 |
| **Max / % chips** | **25% · 50% · Max** of the user's position. | `Button size=sm`/`ToggleGroup` | `07` §2.3 |
| **Redemption preview** | **"Redeem {Y} spvUSDC → receive ≈ {X} USDC"** (or inverse), **incl. accrued yield and the 10% profit-only performance fee on yield above your high-water mark** stated explicitly ("0% on your principal; no fee below your high-water mark"); share price used; "≈ ${value}". | `Card`/rows (`.tnum`) | `07` §5.4; `spec.md` FR-018 |
| **Constraints (surfaced up front)** | At launch the conservative vault has **no lockup**; if any liquidity constraint ever applies, surface it **before** the user commits (Yearn/Beefy pattern). **Pause never blocks withdraw** — state it. | `Alert` (info) / helper | `09` §3; `05` §3.4 |
| **Withdraw-always / escape hatch link** | Always present beneath the action: **"Exit anytime — even if SparkPoint is offline."** → **`/trust/exit`** (Path B on-chain). | text + link → `/trust/exit` | `05` §4; `07` §7 |
| **Primary CTA** | **"Review withdrawal"** (spark) → builds `txIntent` (`vault_withdraw`) → `/confirm`. → (on `/confirm`) "Sign withdrawal". **Never "Cash out".** | `Button variant=default` | `07` §2.2 |

### 7.2 The WITHDRAW-ALWAYS / self-service escape-hatch state (the highest-signal trust decision — `05` §4.5)
This flow **does not re-spec** the escape hatch (`/trust/exit` is canonical in `05` §4) — it specs **how the Withdraw panel links to and degrades into it**:
- **Always-visible link:** every withdraw render (and the deposit panel, §5.1) carries a one-tap **"Exit anytime"** → `/trust/exit`, which documents **Path A (in-app)** and **Path B (on-chain, no-frontend)**: vault **address** (copy + BaseScan), the **`redeem`/`withdraw`** function with plain-language parameter help, "how to find your share balance", and the explicit note **"no SparkPoint approval, signature, or uptime required."** (`05` §4.2).
- **Degraded mode (`/vault/withdraw` degraded variant, `01-IA` §1; `05` §4.3):** if the backend/agent is offline, the in-app Path A may show "may be unavailable" but is still **attempted**; **Path B (on-chain) is promoted to primary** with a banner: *"SparkPoint's AI is temporarily unavailable. You can still view your portfolio and **withdraw anytime** — your funds never depend on us being online."* (`07` §6.1 degraded). **Withdraw is never removed** (hard IA rule, `01-IA` §6).
- **Kill-switch active (paused):** explicit — *"Deposits are paused. Withdrawals are not."* Withdraw proceeds normally (`05` §4.3; `07` §9.1 #7).
- **Caps reached:** **no effect on withdraw** — withdraw is fully available at any cap state (§8).
- **Geo-blocked / not-whitelisted:** the app deposit features are blocked at `/unavailable`, but **Path B on-chain exit is fully documented and functional** for any existing position (`05` §4.3; `01-IA` §6; `spec.md` SC-014).
- **Verification block:** "Don't trust these instructions? Verify the vault is non-upgradeable and that only you can withdraw — [see permissions]." (`05` §4.2 → prove-it).

### 7.3 Withdraw states (the six)
- **Default (has position):** input + redemption preview + escape-hatch link; CTA enabled when valid.
- **Empty (no position):** "You have nothing deposited right now." — **the escape-hatch documentation is still shown** (so the exit is visible before depositing, `05` §4.3); a gentle cross-link to Deposit.
- **Loading:** `Skeleton` on preview / share price; **Path B (on-chain) instructions render immediately, never gated on backend** (`05` §4.3).
- **Success:** none here — on `/confirm` after sign; returning shows reduced/zeroed position + toast "Withdrawal confirmed. {X} USDC is back in your wallet. View transaction ↗" (`07` §2.5).
- **Warning:** any constraint surfaced up front (none expected at launch); stale share price labeled (estimate); kill-switch note ("withdrawals not paused"). None block withdraw.
- **Error (in-app path fails):** *"You can still withdraw on-chain — here's how"* → Path B (`05` §4.3); never a dead end; custody reassurance; no raw RPC strings (`07` §6.1, §9.1 #10).

**Microcopy (defer to `07`):** positive exit framing throughout; "Exit anytime", "withdraw anytime"; never panic framing; never imply the user needs our permission/keys/servers (`05` §4.4; `07` §7). The performance fee is stated at redemption ("10% of realized yield, profit-only, high-water mark — 0% on your principal; no fee on principal, and never below your high-water mark").

---

## 8. Caps-reached & kill-switch (deposit-blocking) states — full treatment

Both are **deposit-gating, withdraw-preserving** states. They are *informational/protective*, not errors; **withdraw is never affected** (`spec.md` FR-025/026, SC-009; `data-model.md` VR-V2/VR-V3; `05` §3.3/§3.4).

### 8.1 Caps-reached (per-user / vault / total protocol)
- **Trigger:** the entered/attempted deposit would breach a cap, or the cap is already full.
- **Deposit panel:** caps meter at **full destructive bar**; **"Review deposit" disabled**; copy: **"You've reached your beta cap (${cap}). You can still withdraw anytime. New deposits open as caps lift."** + optional **"[Join waitlist for higher cap]"** (`07` §6.1 cap reached). For an over-cap *amount* (not yet at the full cap), offer **"Max you can add now: ${remaining}"** with a one-tap set.
- **Detail / discovery:** a "Cap reached" / "Vault is filling" status chip; the vault remains fully legible.
- **Withdraw:** **unchanged and fully available** (the Withdraw tab + exit hatch are present and enabled).
- **shadcn:** `Progress` (destructive) + `Alert`/`Card` + `Badge`; disabled CTA via `aria-disabled` + helper text.
- **Authoritative block:** re-checked and rendered on `/confirm` ("blocked before signing", `spec.md` SC-009) — the panel pre-empts to avoid a doomed handoff.

### 8.2 Kill-switch active (pause-only, multisig)
- **Trigger:** the multisig has paused **new deposits/rebalances** (`05` §3.4; `data-model.md` VR-V2).
- **Treatment:** amber banner on detail + deposit panel: **"New deposits are paused. Withdrawals are never paused."** (`07` §9.1 #7 — never imply it can stop withdrawals). Deposit CTA disabled with that reason; the **Withdraw tab and "[Exit anytime]" elevated**.
- **CAN/CANNOT statement (always shown):** "Can: pause new deposits & rebalances. **Cannot: block your withdrawals, move your funds, or change custody.**" (`05` §3.4).
- **Withdraw:** **guaranteed available** (N2/N5 — `05` §3.4; `01-IA` §6 hard rule). The screen must present a working withdraw path while paused.
- **shadcn:** `Alert` (caution) + `Badge` (paused) + links to `/trust`.

---

## 9. Cross-cutting states (the six required, per surface)

Every surface ships **default · empty · loading · success · warning · error** where applicable (brief §4; `04` AC#9; `07` §6). Flow-specific summary (full per-section states above):
- **Loading** = `Skeleton` at section shape; **never** spinner-over-stale; **never `0`** for APY/TVL/shares (`07` §5.5; `04` §7). On withdraw, **Path B on-chain instructions render immediately** (never gated).
- **Empty** = vault pre-deposit invitation (§4.7) and withdraw no-position (§7.3) — **invitations, never errors**, and the **exit is documented even when empty** (`07` §6.2; `05` §4.3).
- **Success** = reflected post-`/confirm` (your-position tweens, `Sonner` toast); not re-celebrated here (`07` §2.5).
- **Warning** = `--caution` amber: near-cap, kill-switch paused, stale data — informational, never removing withdraw (`07` §6.3; `04` §2.4).
- **Error** = `07` §6.1 formula (what/why/next-step, no blame, **no raw RPC/revert strings**, custody reassurance "your funds are safe and untouched"); withdraw path **never** removed by any error/degraded state (`01-IA` §6).

---

## 10. Non-custody / trust touchpoints in Vault (mandatory)

The Vault is the product *and* the trust proof — non-custody must be **visible and provable** here above all:

1. **Persistent shell affordances** (inherited, `01-IA` §2): non-custodial badge → prove-it panel, disclaimer strip with **[Prove it]** / **[Exit anytime]**, wallet menu → "view exact permissions". ≤1 tap to proof + exit, desktop and mobile.
2. **Withdraw is co-equal with Deposit** — the action card is a `Tabs` with **Withdraw always one tap away**, and an **"Exit anytime" → `/trust/exit`** link sits on *both* the deposit and withdraw panels. Exit is a routine, not an emergency (`07` §2.2; `05` §4.4).
3. **Withdraw survives degraded mode** — the on-chain Path B (`/trust/exit`, `05` §4) renders without backend; the `/vault/withdraw` degraded variant promotes it. **Withdraw never gated** by caps, kill-switch, backend health, or whitelist/geo state (`spec.md` SC-003; `01-IA` §6).
4. **0% on principal + the profit-only performance fee (10% of yield, HWM) + non-upgradeable + pause-only are stated explicitly** on detail and at redemption (`07` §5.2, §2.1; `05` §3.4) — structural facts, not promises.
5. **"Who can move these funds? → You only"** in-context affordances on detail + your-position → prove-it panel (`05` §2.3 "No admin withdrawal"); contracts linkable to **BaseScan** (provable, not asserted — `05` §1.1).
6. **No signing here** — Deposit/Withdraw build a `txIntent` and **route to `/confirm`**; the live previews are convenience estimates re-simulated authoritatively on `/confirm` (`01-IA` §0.3; `data-model.md` VR-DS1). The Vault never holds keys, never executes.
7. **Caps framed as protection, never failure**; kill-switch **never** framed as able to stop withdrawals (`07` §2.3, §9.1 #7).
8. **Honest, non-subsidized yield** — net APY only, breakdown + estimate-framing, **no token-incentive theater** (anti-Giza/ARMA, `09` §8); never lead with the number (`07` §9.1 #1/#2/#3).
9. **AI presence is suggestion, not actor** — "Ask about this vault" opens chat; the AI never moves vault funds (`07` §9.1 #4).

---

## 11. Component inventory → shadcn/ui + Recharts mapping (this flow)

| Vault component | shadcn/ui / Recharts | Notes / ref |
|---|---|---|
| Vault detail layout | `Card` grid + sticky right rail (desktop) / stacked (mobile) | Gauntlet/Morpho transparency template (`09` §3). |
| Vault header (name/asset/symbol) | `Card` header + `Badge` chips | USDC / `spvUSDC` (`data-model.md` E8). |
| Risk badge | `Badge` (risk-palette) + segmented meter | "Lower · 1/5"; never color-only (`04` §2.5, §6.5). |
| Curator / audit / non-upgradeable / 0%-on-principal / profit-only-fee chips | `Badge` row + links | Trust payload (`05` §3.4/§3.5; `07` §2.1). |
| Net-APY hero | `Card` + `.tnum` | Net, estimate, not the lead (`07` §5.2). |
| APY breakdown | `Accordion` (desktop) / `Sheet` (mobile) | "= supply rate − 10% performance fee (profit-only, HWM)" (`07` §5.2). |
| "Where funds go" allocation | `Card` + list/`Separator` + `Badge` (protocol) + explorer links | Gauntlet "where deposit goes" (`09` §3); whitelist only. |
| APY history chart | `Card` + Recharts `LineChart`/area + `Tabs` (7d/30d/90d) | Neutral/`--info` stroke, no projections (`04` §6.4). |
| TVL history chart | `Card` + Recharts `AreaChart`/`LineChart` | Neutral stroke; ties to caps (`04` §6.1). |
| "Your position" sub-panel | `Card` + labeled rows (`.tnum`) + `Tooltip` | shares · share price · underlying · realized yield (`09` §3). |
| Shares + fiat-equiv | text (`.tnum`) | `1,024.5031 spvUSDC` / `≈ $value` (`07` §5.4). |
| Action card (Deposit\|Withdraw) | `Card` + `Tabs` | Withdraw co-equal; one tap away (`04` §11). |
| Amount input | `Input` (`.tnum`, `$`/USDC affix) | Validated; mobile numeric keypad (`07` §5.1). |
| Max / % chips | `Button size=sm` / `ToggleGroup` | 25/50/Max; Max = min(balance, remaining cap). |
| Live shares preview | `Card`/rows (`.tnum`) | "Deposit X → receive ≈ Y spvUSDC" (`07` §5.4; `09` §3 Morpho). |
| By-amount / by-shares toggle | `ToggleGroup` / segmented `Tabs` | Withdraw input mode (`09` §3). |
| Redemption preview | `Card`/rows (`.tnum`) | "Redeem Y → receive ≈ X USDC (after 10% profit-only fee on yield above your high-water mark; 0% on principal)" (`07` §5.4; FR-018). |
| Caps meter | `Progress` (styled) + `Tooltip` | spark→caution→destructive (`04` §6.5; `05` §3.3). |
| Net-APY / shares / performance-fee tips | `Popover`/`Card` `TipCard` (`--info`) | Blue, dismissable (`07` §4.2). |
| Withdraw-always / "Exit anytime" link | text/`Button` (link) → `/trust/exit` | On deposit AND withdraw (`05` §4). |
| Kill-switch / pause status | `Alert` (caution) + `Badge` + link `/trust` | "withdrawals never paused" (`05` §3.4). |
| Caps-reached / paused deposit block | `Alert`/`Card` + `Badge` + disabled `Button` (`aria-disabled` + helper) | Withdraw unaffected (§8). |
| Primary CTA (Review deposit/withdrawal) | `Button variant=default` (spark) | One per view; routes to `/confirm` (`07` §2.2). |
| Secondary / back / ask-AI | `Button secondary/outline/ghost` | Never spark. |
| Prove-it inline affordance | text/link → `Sheet` (permissions) | "You only" (`05` §2.3). |
| Empty (pre-deposit) | `Card` + Lucide icon + microcopy + CTA | "Aave Yield Vault / Review deposit" (`07` §6.2). |
| Loading | `Skeleton` (header/APY/charts/preview/position) | `04` §7; Path B renders immediately on withdraw. |
| Error / degraded | `Alert` (recoverable) + retry; degraded banner → Path B | Custody reassurance (`07` §6.1; `05` §4.3). |
| Toast (post-confirm) | `Sonner` | Fired on `/confirm`, reflected here (`07` §2.5). |
| Confirm handoff | `txIntent` → `/confirm/[txIntentId]` | Flow 6; **no sign here** (`01-IA` §0.3). |

---

## 12. Accessibility (required, `04` §10)

- **Charts have text/table alternatives:** APY-history `LineChart` gets an `aria-label` summary ("Net APY {X}% now, {range}; {up/down} over {window}"); TVL likewise; tick labels tabular. **No information by color alone** anywhere — risk = number + label + meter; caps fill = label + tabular text equivalent ("82% of your deposit cap used"); APY = text "net APY" not color (`04` §10.2, §10.6).
- **Tabular numerals** on every figure (APY, TVL, shares, share price, value, caps, amount) — also aids low-vision scanning (`04` §3.1, §10.8).
- **Keyboard:** full operability — Deposit/Withdraw `Tabs` (arrow keys), by-amount/by-shares toggle, %/Max chips, amount input, breakdown `Accordion`, range `Tabs`, escape-hatch link, prove-it affordance; Esc closes overlays; logical tab order top→bottom. **Visible 2px spark focus ring + 2px offset** on every control (`04` §10.3/§10.4). Disabled deposit CTA (cap/pause) is **keyboard-focusable-but-disabled**, with reason via `aria-disabled` + helper text, not color alone (`04` §10.4).
- **Touch:** 44px targets on mobile (tabs, chips, toggle, CTA, sheet items, links) (`04` §4.3).
- **Live updates:** polite `aria-live` *sparingly* on the live shares/redemption preview — announce the result, don't spam on every keystroke (`04` §10.6).
- **Reduced motion:** honor `prefers-reduced-motion` on number tweens, chart draw-in, skeleton shimmer — instant/opacity fallback; no info by motion alone (`04` §7, §10.7).
- **AA contrast** both themes (dark default); risk-palette, semantic, and caps tokens pre-tuned (`04` §2/§10.1).

---

## 13. Benchmark references (named, per `09` §3 / research)

- **ERC-4626 shares legible (always show shares received/redeemed; share price rises as vault earns):** **Morpho — vaults docs** → the live shares preview (§5.1) and redemption preview (§7.1), the "your position" share-price read (§4.6) (`09` §3).
- **Net-of-fees APY convention (predicted annual rate incl. compounding AND all fees; label it; expand it):** **Beefy** + **Yearn** → the net-APY hero + mandatory breakdown ("= supply rate − 10% performance fee (profit-only, HWM)"), estimate-framed (§4.2) (`09` §3).
- **Vault transparency template (APY current+historical, TVL, allocation across markets, curator identity, "where your deposit goes"):** **Gauntlet app** → the detail layout, allocation/routing panel (§4.3), history charts (§4.5), caps meter (§6) (`09` §3).
- **Four-dimension risk rationale (smart-contract / centralization / market / operational), stated for retail:** **PolicyLayer** → the risk badge + "how is this scored?" rationale (§4.1; full risk-rationale pattern shared with Portfolio §4 and `05` §3.5) (`09` §3).
- **Curator-posture spectrum + how vault risk is communicated:** **RockawayX (2026)** + **Chorus One** → curator chip "conservative, capital-preservation-first" (§4.4) (`09` §3).
- **Caps meter (remaining-capacity, near-limit, at-cap):** **Morpho/Gauntlet, Yearn, Beefy** → §6 caps meter (`05` §3.3; `09` §3).
- **Out-position the live competitors:** **Giza/ARMA** (token-subsidized APY, collapsed TVL) → **honest non-subsidized net APY, no incentive theater**; **Fungi** (fire-and-forget) → **opt-in, explainable, signed, withdraw-always**; **Brahma** (guardrails alone aren't a moat) → make non-custody **legible in the vault itself** (`09` §8).
- **Self-custody framing on the exit:** **Ledger / Trust Wallet** voice for the withdraw-always link ("works even if SparkPoint disappears") — structural, not promissory (`05` §4.4; `07` §7).
- **Charts on-style:** Recharts per `04` §6.4 (net-APY = neutral/`--info` stroke, **no green-implies-guaranteed**, no projected values, calm axes, styled tabular tooltips).

---

## 14. Acceptance criteria (this flow conforms when ALL hold)

1. **Single-vault honesty.** `/vault` renders the **one** Aave Yield Vault as detail (no fake multi-vault marketplace, no "browse"/"more coming" placeholders); accepts **USDC only**, share token **`spvUSDC`**, **0% on principal / 0 management + active 10% profit-only HWM performance fee on yield**, **non-upgradeable**, Aave-v3-routed (brief; `spec.md` FR-017; `data-model.md` E8).
2. **Net APY is honest everywhere.** Every APY (detail hero, discovery card, deposit est., your-position) is **net + word "net" + one decimal + breakdown ≤1 tap ("= Aave supply rate − 10% SparkPoint performance fee (profit-only, HWM)") + estimate-framed**; **never bare, never the surface's lead, never projected/token-subsidized** (`07` §5.2, §9.1 #1/#2/#3; `09` §3, §8).
3. **Vault detail complete.** Net APY + breakdown, TVL, **risk score + rationale** (risk palette, n/5 + label + meter), **"where your funds go" allocation** (USDC→vault→Aave v3, BaseScan-linkable, whitelist-only), **audit/curator/non-upgradeable/0%-on-principal/profit-only-fee badges**, **APY + TVL history charts** (neutral stroke, no projections), and **"your position"** (shares · share price · underlying value · realized yield) — at **1440px desktop and 390px mobile** (`spec.md` US-1; `09` §3).
4. **Shares legible (ERC-4626).** Deposit shows a **live preview "Deposit {X} USDC → receive ≈ {Y} spvUSDC"** with share price + fiat-equiv beneath; withdraw shows **"Redeem {Y} spvUSDC → receive ≈ {X} USDC (after 10% profit-only fee on yield above your high-water mark; 0% on principal)"**; shares are **always shown**, never hidden behind USDC alone (`07` §5.4; `09` §3 Morpho; `spec.md` FR-018).
5. **Caps in context + blocked before signing.** A **caps meter** (per-user + vault TVL) appears in the deposit panel with **spark→caution(≥80%)→destructive(at cap)** fill, tabular, with accessible text + "why caps?"; a deposit that would breach **per-user / vault / total protocol** cap is **pre-emptively warned and the panel CTA disabled with a plain reason**, with the **authoritative block re-rendered on `/confirm` before signing** (`spec.md` FR-025, SC-009; `data-model.md` VR-V3; `04` §6.5; `05` §3.3).
6. **Withdraw is by-amount OR by-shares, with a clear preview.** The withdraw panel offers a **toggle**, a **redemption preview** (incl. accrued yield, **the 10% profit-only performance fee on yield above the high-water mark stated, 0% on principal**), surfaces any constraint up front (none at launch), and builds a `txIntent` → `/confirm` (`09` §3; `spec.md` FR-017/018).
7. **Withdraw-always is one tap and degraded-safe.** Both the deposit and withdraw panels carry an **"Exit anytime" → `/trust/exit`** link; the `/vault/withdraw` route has a **degraded-mode variant** that promotes the **on-chain, no-frontend Path B** (address + `redeem`/`withdraw` + steps, no SparkPoint approval/uptime needed); **withdraw is never gated** by caps, kill-switch, backend health, or whitelist/geo (`spec.md` SC-003, FR-026/034; `data-model.md` VR-V2/VR-VP2; `01-IA` §6; `05` §4).
8. **Caps-reached & kill-switch states are deposit-gating, withdraw-preserving.** Caps-reached → disabled deposit + "still withdraw anytime / open as caps lift"; kill-switch active → "new deposits paused, **withdrawals never paused**" with a working withdraw path on-screen; **neither ever blocks withdraw** (`spec.md` FR-025/026, SC-009; `05` §3.3/§3.4; `07` §9.1 #7).
9. **No signing here.** Deposit and Withdraw **build a `txIntent` and route to `/confirm/[txIntentId]`** (Flow 6); the in-panel previews are **convenience estimates re-simulated on `/confirm`**; this flow has **no bespoke sign UI** (`01-IA` §0.3; `data-model.md` VR-DS1).
10. **All states, every surface.** discovery / detail / deposit / withdraw each ship default · empty (pre-deposit invitation / no-position, with exit still documented) · loading (skeletons, **never `0`/spinner over stale**, Path B renders immediately) · success (reflect post-confirm) · warning (near-cap / paused / stale, `--caution`) · error (what-why-next + custody reassurance, **no raw RPC strings**) — at both breakpoints (brief §4; `07` §6; `04` AC#9).
11. **Charts on-style (Recharts).** APY history = **neutral/`--info` stroke + "net APY" label (NOT green-as-guaranteed)**, faint current-APY reference line, **no projected values**; TVL neutral; calm axes, styled tabular tooltips, skeleton (never broken axis) loading (`04` §6.1/§6.4).
12. **Non-custody legible & provable.** **0% on principal + profit-only performance fee (fee-shares to a non-privileged recipient, fail-open, never blocks withdrawal) + non-upgradeable + pause-only** stated explicitly; **"Who can move these funds? → You only"** affordance → prove-it (BaseScan-linkable); withdraw co-equal with deposit; caps framed as protection; **yield shown, never sold** (no incentive theater) (brief §2.2; `spec.md` SC-004; `05` §2/§3.4; `09` §8).
13. **Design-system + content conformance.** Token-only color with the three-system discipline (brand/outcome/risk never blur), spark scarcity (≤1 spark CTA/view; spark on AI presence/focus only — **not** on APY/gains/risk), tabular numerals everywhere financial, full keyboard + 44px targets + visible spark focus ring + reduced-motion + chart a11y, sentence case / second person / verb-first specific buttons ("Review deposit"/"Review withdrawal", never "Deposit now"/"Cash out"/"Invest"), banned words avoided (`04` AC; `07` AC, §2.2, §9).
14. **shadcn-mappable.** Every component resolves to a primitive/composition in §11 / `04` §11; charts via Recharts; caps/risk meters via styled `Progress`/segmented bar.

---

## 15. Cross-references

- **Routes:** `01-information-architecture.md` §1 `(app)/vault`, `vault/deposit`, `vault/withdraw`; §3 nav (Vault primary tier 3; Withdraw/Exit pinned); §4 flow graph; §6 gating/degraded; §3.x `/vault/withdraw` ↔ `/trust/exit` distinction.
- **Shell / persistent trust elements:** `01-IA` §2 (badge, wallet chip, disclaimer strip, prove-it panel) — inherited, not re-specified here.
- **Tokens / palettes / data-viz / motion / a11y / shadcn map:** `04-design-system.md` (§2 color, §2.5 risk palette, §3 type/numbers, §6.4 APY history, §6.5 risk & caps meters, §7 motion, §10 a11y, §11 component map).
- **All wording / net-APY & shares & PnL & number formatting / caps & withdraw framing / tooltips / error+empty+warning copy / banned phrases / §8 vault examples:** `07-content-and-tone.md` (§2 motifs/buttons/tooltips, §4 literacy, §5 numbers, §6 error/empty/warning, §7 trust copy, §8 worked examples, §9 DOs/DON'Ts).
- **Escape hatch / withdraw-always (canonical) / caps dashboard / kill-switch / prove-it:** `05-trust-and-safety-ux.md` (§2 prove-it, §3.3 caps, §3.4 kill-switch, §3.5 audits/curator, **§4 `/trust/exit` — source of truth for the on-chain exit this flow links to**).
- **Benchmarks:** `09-references.md` §3 (Morpho/Gauntlet/Yearn/Beefy/PolicyLayer/RockawayX/Chorus — yield vaults), §8 (Giza/ARMA, Fungi, Brahma — out-position).
- **Data shape / provenance / invariants:** `specs/001-sparkpoint-pivot-mvp/data-model.md` E8 (Vault, caps, pause-only — VR-V1/V2/V3), E9 (Vault Position / shares — VR-VP1/VP2, reconstructable offline), E11 (Transaction/Intent — `/confirm` handoff), §16 RPC>subgraph>price (VR-DS1/DS2); `spec.md` FR-017/018/025/026, FR-033/034 (N1/N2), SC-003/004/009, US-1.
- **Downstream/linked flows:** Confirmation (Flow 6 — where Deposit/Withdraw route; sign happens there), Chat (Flow 2 — `ActionCard` deposit/withdraw, "Ask about this vault"), Portfolio (Flow 3 — vault position Add/Withdraw, "your position" mirror), Strategies (Flow 4 — "accept" the vault rec), Trust Center (`/trust`, `/trust/exit`, prove-it), Outcome Log (`/activity` — linked recommendation).
