# 08 — Deliverables & Handoff (what Claude Design must produce, and how it feeds the build)

> **Audience:** Claude Design (high-fidelity screen production) and the stakeholders reviewing the W1–2 "Live Wireframe & UI/UX Finalization" milestone.
> **Status:** Authoritative definition of **done** for this design milestone — the exact artifacts to produce, their fidelity bar, acceptance criteria, and how the output hands off to the coded **Next.js (App Router) + TailwindCSS + shadcn/ui** build. Where any other handover doc disagrees on *what to ship*, this doc wins; where it disagrees on *content/copy*, `07-content-and-tone.md` wins; on *visual tokens*, `04-design-system.md` wins; on *the inventory of screens*, `03-screen-inventory.md` wins.
> **Reads-before (authoritative, in order):**
> - `00-brief.md` — positioning, the five non-custody guarantees, scope, non-goals, milestone framing.
> - `01-information-architecture.md` — route map (§1), shell (§2), nav (§3), flow graph (§4), gating/degraded states (§6).
> - `02-flows/01`…`08` — the six core flows + supporting surfaces, screen-by-screen.
> - `03-screen-inventory.md` — the **137 numbered artifacts** this milestone must deliver (the production checklist).
> - `04-design-system.md` — tokens, color systems, type, data-viz, motion, a11y, the component→shadcn map (§11).
> - `05-trust-and-safety-ux.md` — the non-custody/trust UX every flow must carry.
> - `06-component-library.md` — the **25 custom components** + their states.
> - `07-content-and-tone.md` — canonical copy (wins on any wording conflict).
> - `09-references.md` — the named UX benchmarks.
> - Spec & plan: `/home/hello/project/sparkpoint-pivot/specs/001-sparkpoint-pivot-mvp/spec.md` and `/home/hello/project/sparkpoint-pivot/specs/001-sparkpoint-pivot-mvp/plan.md`.
>
> **What this doc IS:** the deliverables manifest, acceptance criteria, milestone/critical-feedback-window framing, the design→code handoff contract, and the explicit out-of-scope boundary. **What it is NOT:** the screen list (`03`), the flows (`02`), the tokens (`04`), the components (`06`), or the copy (`07`). It tells you *what to hand over and when you're done*; those tell you *what to draw*.

---

## 0. TL;DR — the milestone in one screen

Produce a **complete, finalized, clickable-quality, high-fidelity picture of the entire app**: all **six core flows** + all **supporting surfaces**, at **desktop (1440) and mobile (390)**, every applicable **state**, with the **non-custody and guardrail touchpoints present throughout** — plus a **reusable design system** (tokens + components) that **maps 1:1 to shadcn/ui** so the coded build can implement it without re-deciding visual or interaction questions.

> **One sentence to hold while you produce:** this is the design the build *implements* — not exploratory wireframes — and it is the **last cheap moment to change direction** before code locks the structure (see §3, the critical-feedback window).

The deliverable is "done" when a stakeholder can click through every flow at both breakpoints, see every state, verify that the five non-custody guarantees are visible and provable on every authenticated surface, and a frontend engineer can pick up any screen and build it against shadcn/ui primitives without asking "what does this look like / how does it behave / what does it say."

---

## 1. The five deliverables

The output of this milestone is **five interlocking artifacts**, each defined below with its scope and acceptance criteria. They are not five separate documents — they are five views of one finished design.

### Deliverable A — High-fidelity screens for all six core flows (desktop + mobile)

**What:** Production-ready, high-fidelity mockups (not wireframes, not sketches) for each of the six core flows, fully laid out at the **1440px desktop** and **390px mobile** canvases (1024 / 360 minimums per `03`), with the desktop side-by-side layouts and the mobile single-column / Dialog→Drawer transforms (`04` §4.2) both resolved.

The six core flows (each owned by a flow spec in `02-flows/`):

| # | Flow | Spec | Anchoring requirement |
|---|---|---|---|
| 1 | **Onboarding** — chat-driven goals + risk → mandate | `02-flows/01-onboarding.md` | Scenario-based risk capture → confirmed, adjustable mandate (FR-001…004; SC-007 "<5 min"). |
| 2 | **Chat AI Assistant** — primary surface | `02-flows/02-chat-assistant.md` | Structured action/recommendation/confirmation cards (≤2 actions), tool-step transparency, citations, AI disclaimer (FR-005…008). |
| 3 | **Portfolio Overview** — PnL, risk, allocation | `02-flows/03-portfolio.md` | Net-worth hero + a **first-class risk panel** stronger than Zerion/DeBank/Zapper (FR-009…013; SC-011). |
| 4 | **Strategy Recommendations** — ranked vs goal | `02-flows/04-strategy-recommendations.md` | Ranking relative to mandate + plain-language "why this?" rationale on 100% of recs (FR-014…016; SC-005). |
| 5 | **Vault Deposit / Withdraw** — ERC-4626 Aave Yield Vault | `02-flows/05-vault-deposit-withdraw.md` | Legible shares + net-of-everything APY with breakdown + caps meter; withdraw always visible (FR-017…018, FR-025…026; SC-003, SC-009). |
| 6 | **Execution Confirmation** — simulation + guardrails + sign | `02-flows/06-execution-confirmation-simulation.md` | Tenderly-style pre-trade preview + guardrail checklist + **sign disabled until acknowledged**; the single signing chokepoint (FR-021…024; SC-001, SC-002). |

**Acceptance — Deliverable A:**

- **A1.** Every screen in §3 (`03-screen-inventory`) areas 3–8 (the six core flows) is delivered at **both DT and MO**, with the **applicable state set** that the inventory entry lists (default · empty · loading · success · warning · error, plus surface-specific states like `blocked` / `stale-degraded` / `revoked` / `not-found`).
- **A2.** Each flow reads as a **coherent click-path**, not isolated screens — the entry, the happy path, the at-least-one unhappy path (declined-sign, cap-reached, simulation-blocked, revert-predicted), and the exit/return are all present and connected.
- **A3.** Every authenticated screen carries the **persistent non-custodial badge** and a **withdraw/exit path ≤1 tap away** (hard global rule, `03` header; `05` §0). No state — gating, error, degraded, paused — ever removes the withdraw path.
- **A4.** Every state-changing action **funnels to the `/confirm` Execution flow** (no bespoke sign UI anywhere); the "AI suggestion — you approve & sign" label appears on every recommendation/action (`05` §5.2).
- **A5.** Financial figures use **tabular numerals**; semantic color is **never used alone** (always color + icon + label); contrast meets **WCAG AA** in dark (and the light variant per §C below).

### Deliverable B — High-fidelity screens for all supporting surfaces (desktop + mobile)

**What:** The same fidelity and breakpoint/state coverage for everything outside the six core flows — the surfaces that make the product trustworthy, operable, and complete.

In scope (owned by `02-flows/07`, `02-flows/08`, `05`, and `03` areas 0–2 and 9–11):

- **Global shell & cross-cutting** (`03` #1–#14): authenticated app shell (DT + MO), non-custodial badge, **"prove-it" permissions panel**, wallet/connection menu, command menu (⌘K), AI disclaimer strip, notifications preview, toast host, loading-skeleton pattern, recoverable-error pattern, 404, degraded-mode banner, **and both theme variants (dark default + light)**.
- **Public / marketing** (`03` #15–#24): landing ("AI hedge fund" headline anchored by native non-custody), how-it-works, public Trust/Security mirror, legal (terms/privacy/risk), waitlist, public chrome.
- **Connection & gating** (`03` #25–#30): connect wallet, verify whitelist, **unavailable (geo-blocked / not-whitelisted) — still surfacing the on-chain withdraw-always escape hatch**, wrong-network prompt, disconnected interstitial.
- **Automation / Session keys** (`02-flows/07`; `03` #94–#101): scope/cap/expiry grant + **instant, unilateral revoke**.
- **Trust & Safety** (`05`; `03` #102–#113): Trust Center hub, self-custody guarantees panel, prove-it/permissions, **caps dashboard**, **pause-only kill-switch status**, audits, the **withdraw-always self-service exit**.
- **SRK · Literacy · Outcomes · Settings · Notifications** (`02-flows/08`; `03` #114–#137): SRK utility view (non-gating), financial-literacy hub + contextual `TipCard`s, **outcome log (wins AND losses, each tied to its originating recommendation)**, settings (risk profile / goals / wallet / theme), notifications center.

**Acceptance — Deliverable B:**

- **B1.** Every numbered artifact in `03` areas 0–2 and 9–11 is delivered at its specified breakpoints (almost all DT + MO) and full applicable state set.
- **B2.** The **Trust Center makes non-custody provable**, not merely claimed: the prove-it panel renders the five guarantees as checkable rows + a two-column **CAN do / CANNOT do** matrix; the caps dashboard, pause-only kill-switch status, whitelisted protocols, and exact on-chain permissions are all surfaced (FR-038; SC-012).
- **B3.** Gating/degraded states (`unavailable`, geo-blocked, not-whitelisted, caps-reached, degraded-mode) are all designed and **all preserve the withdraw-always exit** (FR-034, FR-044; SC-014).
- **B4.** Automation is shown as **opt-in, scoped, time-boxed, instantly revocable** — the grant surface enumerates allowlist / per-tx + cumulative caps / max slippage / hard expiry, and revoke is one obvious, always-available action (FR-029…032; SC-008).
- **B5.** The outcome log shows **losses as honestly as wins**, each entry linked back to the recommendation that produced it (FR-039…041; SC-010).

### Deliverable C — Every component state from the component library

**What:** A delivered, fully-stated rendering of all **25 custom components** in `06-component-library.md` (plus the two shared atoms — `AiSuggestionBadge`, `CitationChip`), at both breakpoints, in **all of each component's applicable states** — assembled as a **component sheet / states gallery** the build can use as the implementation reference for each composition.

This is the "component library page" of the deliverable: each of the 25 components shown in isolation with its variants and states (e.g., `ConfirmationCard`: simulating · passed · warning · blocked · signing · success · failure; `NonCustodialBadge`: nominal · degraded · paused · automation-active · loading · wrong-network; `CapsMeter`: under-cap · near-cap · at-cap; `RiskChip/RiskTierBar` across the 3–5 step risk palette; etc.).

**Acceptance — Deliverable C:**

- **C1.** All 25 components from `06` (+ the two atoms) are present, each with **every state listed in its `06` entry**, at DT + MO.
- **C2.** Each component is visually traceable to its **shadcn/ui base primitive(s)** per `06`'s "Builds on" line and `04` §11 — i.e., a `Card`-based component looks like a styled `Card`, an overlay uses Dialog/Drawer/Sheet, a meter uses `Progress`, etc. No component requires a primitive outside the shadcn + Recharts + Lucide set.
- **C3.** Each component obeys the **one-color-system-per-element** rule (`04` §1; `06` §0.2): spark = AI presence/primary CTA, semantic green/red/amber = outcome/safety, risk palette = risk tier — never cross-contaminated.
- **C4.** Verbatim trust strings are used **as written in `07`** inside the components (e.g., "AI suggestion — you approve & sign", "Simulation passed — no risks detected", "Nothing moves until you sign. You can cancel now with no effect.").
- **C5.** Tabular numerals on all figures; visible 2px spark focus ring + keyboard operability on every interactive part (`04` §10).

### Deliverable D — A clickable, production-ready prototype

**What:** A **clickable prototype** wiring the screens of Deliverables A + B into navigable flows at **both breakpoints**, so a reviewer (and a stakeholder in the feedback window) can *walk* each of the six core flows and the key supporting surfaces end to end, including at least one unhappy path per flow and the non-custody touchpoints (badge → prove-it; any-screen → withdraw/exit).

"Production-ready" here means **fidelity and completeness**, not live functionality: the prototype is a faithful, navigable picture of the final UI — **no live data, no real transactions, no wallet signing, no on-chain calls** (see §4, out of scope).

**Acceptance — Deliverable D:**

- **D1.** All six core flows are click-throughable start→finish at **DT and MO**.
- **D2.** Each core flow includes a navigable **unhappy path**: declined/cancelled signature, cap-reached/blocked deposit, simulation predicts revert or over-slippage (sign blocked, reason shown), session-key revoke, and an empty state.
- **D3.** From any authenticated screen the reviewer can reach the **prove-it permissions panel** and the **withdraw/exit** path in ≤1 tap.
- **D4.** The prototype demonstrates the **single signing chokepoint**: every state-changing action routes into the `/confirm` Execution flow (`01` §2; `06`/`02-flows/06`).
- **D5.** Critical degraded/gating states are reachable (degraded banner, wrong-network, unavailable/geo-blocked) and visibly preserve the exit.

### Deliverable E — The design system as reusable tokens + components mappable to shadcn/ui

**What:** The **design system delivered as a reusable system**, not just applied to screens: the token set (color/type/spacing/radius/elevation/motion) from `04`, expressed as **named semantic tokens** (CSS-variable-ready), plus the component compositions from `06`, organized so the build can stand up the shadcn/ui theme and component layer directly from it.

This is the layer that lets the coded build be **fast and faithful**: the build wires the tokens once into Tailwind/CSS variables and the shadcn theme, then composes the 25 components from primitives — see §5 (handoff).

**Acceptance — Deliverable E:**

- **E1.** Tokens are **semantic and named** (e.g., spark/brand, outcome green/red/amber, the 3–5 step risk palette, surface/elevation, tabular-numeral type styles) — never delivered as raw hex scattered across screens. Each maps to a CSS variable the Tailwind theme can consume (`04` §2.1).
- **E2.** The **three orthogonal color systems** (brand / outcome / risk) are documented as distinct, with the "ask brand-or-outcome-or-risk first" rule explicit (`04` §1).
- **E3.** Every custom component carries its **shadcn/ui base mapping** (`04` §11; `06` index) so the build composes, not reinvents.
- **E4.** Dark is the default theme; the light variant is delivered as a **token swap** (proving the system is variable-driven, not hard-coded), both AA (`04` §2.1, §10.1). **Light-theme depth:** the light variant is delivered as a **token-swap proof on a representative set of screens** (enough to demonstrate the token system is fully variable-driven and AA-compliant in light) — **not** a full re-mock of every one of the ~137 screen/state artifacts; dark remains the primary, fully-stated theme.
- **E5.** Data-viz styling (Recharts: AreaChart/PieChart/donut), motion specs, iconography (Lucide), and a11y rules are specified at the system level so charts and interactions are consistent across surfaces (`04` §6–§10).

---

## 2. Master acceptance criteria (the milestone is done when…)

These are the cross-cutting gates over **all five deliverables**. Each ties to the spec's requirements/success criteria so the design is verifiably aligned with what the build must satisfy.

1. **Completeness — all flows, both breakpoints, all states.** All six core flows + all supporting surfaces from `03` are delivered at **DT (1440) + MO (390)** with each entry's **applicable state set**. (Brief §9; `03`.)
2. **Non-custody is visible and provable everywhere.** The persistent badge + ≤1-tap prove-it panel + ≤1-tap withdraw/exit appear on every authenticated surface; the five guarantees are surfaced and provable in the Trust Center; no state removes the exit. (Brief §2.2; `05`; FR-033…038; SC-003, SC-004, SC-012.)
3. **The AI is honestly framed.** Every recommendation/action is labeled "AI suggestion — you approve & sign"; tool-steps, citations, and the AI disclaimer are present; the design distinguishes **AI proposal → deterministic guardrail → user signature** at every step. (Brief §5; FR-006…008; SC-005.)
4. **Signing is safe by construction.** Every state-changing action funnels through the `/confirm` Execution flow with a Tenderly-style pre-trade simulation, a guardrail checklist, and **Sign disabled until alerts acknowledged**; simulation precedes 100% of signature requests. (`02-flows/06`; FR-021…024; SC-001, SC-002.)
5. **Yield + risk are legible.** Net-of-everything APY with expandable breakdown, explicit ERC-4626 shares, caps meter, and a first-class risk panel/score using the consistent 3–5 step risk palette. (Brief §7.4; FR-017…018; SC-011.)
6. **Outcomes are accountable.** Wins **and** losses are logged, each tied to its originating recommendation. (FR-039…041; SC-010.)
7. **Maps cleanly to shadcn/ui.** Every component resolves to a shadcn primitive (+ Recharts/Lucide) per `04` §11 / `06`; tokens are semantic CSS-variable-ready; dark default + light token-swap. (Brief §4; Deliverable E.)
8. **Copy is canonical.** All strings match `07-content-and-tone.md` verbatim where `07` specifies them (disclaimers, custody/exit clauses, simulation/guardrail strings, number formatting). (`07`.)
9. **Accessibility.** WCAG AA contrast both themes; color never the sole signal; tabular numerals; visible spark focus rings; keyboard operability. (`04` §10.)
10. **Clickable + reviewable in the feedback window.** A navigable prototype (Deliverable D) lets stakeholders walk the flows and exercise the unhappy paths and non-custody touchpoints during W1–2. (§3.)
11. **Scope discipline.** No out-of-scope surfaces designed (multi-vault, multi-chain, SRK-as-gatekeeper, return-projection-led marketing, custodial patterns); no live functionality implied. (§4; Brief §8.)

> **Definition of done (single sentence):** a complete, finalized, clickable-quality picture of the app — all six core flows + supporting surfaces, both breakpoints, every state, non-custody + guardrail touchpoints throughout, components fully stated and shadcn-mappable, tokens reusable — **ready for stakeholder feedback in the W1–2 window, then for the build.**

---

## 3. The W1–2 critical-feedback window (why this milestone is load-bearing)

**This is the W1–2 milestone of the 12-week build** (Jun 8–19, 2026, within Jun 1 – Sep 4, 2026): **"Live Wireframe & UI/UX Finalization"** — final UI/UX, **all flows, mockups only**. Its place in the pipeline is stage ④ (high-fidelity design via Claude Design), downstream of the high-level plan (①), architecture (②), and the Spec Kit spec/plan (③), and **directly upstream of the core build (⑤)**.

**Why it is the critical window:**

- **It is the last cheap moment to change direction.** Per the plan, **major change requests after this point significantly impact the build schedule** (production launch target: **Sep 4, 2026**). Structural decisions made (or missed) here — flow shape, the single-confirm funnel, where non-custody lives, the component set — get hard-coded into the Next.js routes, the shadcn theme, and the component layer immediately after. Changing them later means re-cutting code, not re-drawing frames.
- **The fidelity bar is "the design the build implements."** This is not exploratory; the output is what stage ⑤ codes. Anything ambiguous, missing a state, or missing a breakpoint becomes an engineering question (and a guess) during the build.
- **It must be reviewable as a product, not a deck.** The clickable prototype (Deliverable D) exists so stakeholders can *experience* the flows — especially the trust/non-custody touchpoints and the simulate-before-sign friction — and give feedback that is cheap to act on *now*.

**How to use the window:**

1. **Front-load the trust spine and the wedge.** Non-custody visibility (`05`) and the conversational goal/risk onboarding (`02-flows/01`) are the differentiators most expensive to get wrong — get explicit stakeholder sign-off on these first.
2. **Review per-flow, both breakpoints, with unhappy paths.** A flow isn't "approved" until its blocked/declined/cap-reached/degraded states are reviewed, not just its happy path.
3. **Lock the component set + tokens early.** Deliverables C and E gate the build's speed; freezing them mid-window lets the screen work and the eventual code share one vocabulary.
4. **Treat post-window changes as scoped, costed change requests** — the milestone's purpose is to make that line bright.

---

## 4. Out of scope (explicitly NOT part of this deliverable)

This milestone produces **design only**. The following are out of scope and must **not** appear (and must not be implied) in the deliverables:

**No live functionality / no real behavior.**
- **No live data** — all figures (balances, APY, PnL, shares, caps) are realistic *mock* values for illustration; no data feeds, indexer, or RPC reads.
- **No real transactions, no wallet signing, no on-chain calls** — the confirmation/sign flow is a faithful *picture* of the simulate-and-sign gate, not a working signer. The prototype navigates; it does not execute.
- **No backend, no agent, no contracts** — no API wiring, no Python agent service, no Solidity, no bundler/paymaster. (Those are stage ⑤ and the contracts/agent tracks.)
- **No code** — this is design handover; map to shadcn primitives, do not implement them. (Brief §8.)

**No out-of-scope product surfaces** (Brief §8; spec Assumptions):
- **No multi-strategy / multi-vault complexity** — design for the **single conservative Aave Yield Vault**; vault discovery may exist only as a shell.
- **No multi-chain** — **Base only**; no chain switchers or cross-chain UI.
- **No SRK-as-gatekeeper** — SRK is a non-essential informational surface; never gate vault/onboarding/chat behind it (FR-045…046; SC-013).
- **No custodial patterns** — no agent-generated wallets, no "we hold your keys," no admin-withdrawal path, no flow implying SparkPoint can move funds; the kill-switch is **pause-only** and shown as such.
- **No return-projection-led marketing** — never lead with cherry-picked APY or promised returns.
- **No "AI does it all, trust us" opacity** — default is per-action signing; automation is opt-in/scoped/revocable.
- **Deferred features** (placeholders only where genuinely needed): multi-strategy vaults, ZK trade proofs, SRK v2 governance, KYC/compliance gating, stocks/TradFi, a general (non-DeFi) assistant.

**Owned by other teams (not this design milestone):** external security audit, penetration testing, legal review (final terms/risk/geo rules), and marketing/growth are SparkPoint internal-team owned (spec Assumptions). Design surfaces *reference* legal/audit content (e.g., legal routes, audit badges) but does not author it.

---

## 5. How the output feeds the coded Next.js + shadcn build (the handoff contract)

The deliverables are structured so stage ⑤ (the core build) can implement them with minimal re-decisioning. The mapping is deliberate:

### 5.1 Screens → App Router routes

The design's flows map directly onto the planned route tree (`plan.md` §Project Structure; `01` §1). Each designed flow/surface lands on a known route, so a screen has a destination before the build starts:

| Design flow / surface | App Router location (from `plan.md`) |
|---|---|
| Onboarding (Flow 1) | `apps/web/app/app/onboarding/` |
| Chat Assistant (Flow 2) | `apps/web/app/app/chat/` |
| Portfolio (Flow 3) | `apps/web/app/app/portfolio/` (+ `[positionId]`) |
| Strategy Recommendations (Flow 4) | `apps/web/app/app/strategy/` (+ `[recId]`) |
| Vault Deposit/Withdraw (Flow 5) | `apps/web/app/app/vault/` |
| Execution Confirmation (Flow 6) | the `ExecutionDrawer` chokepoint + `/confirm` (single signing funnel) |
| Automation / session keys (Flow 7) | `apps/web/app/app/automation/` |
| Outcome log / SRK / Settings (Flow 8) | `apps/web/app/app/{outcomes,srk,settings}/` |
| Trust Center + prove-it (public) | `apps/web/app/trust/` + `apps/web/app/trust/permissions/` |
| Withdraw-always exit (public) | `apps/web/app/exit/` |
| Global shell | `apps/web/app/app/layout.tsx` + `components/` (AppShell, NonCustodialBadge, ExecutionDrawer) |

Designing the **public, backend-independent** `trust/` and `exit/` surfaces as standalone (no app shell dependency on the agent/backend) is what makes the withdraw-always invariant (N2) *designable as code* — the build reads chain state directly there and the design must not couple those screens to authenticated/agent state.

### 5.2 Tokens → Tailwind theme + CSS variables

Deliverable E's semantic tokens (spark/brand, outcome green/red/amber, the risk palette, surface/elevation, type/tabular-numeral styles) are wired **once** into Tailwind config + CSS variables and the shadcn theme. Because tokens are semantic and variable-driven (not hex-per-screen), the dark default and light variant are a token swap — exactly how the coded theme will work. This is the seam that keeps the built UI faithful to the design without per-component color decisions.

### 5.3 Components → shadcn/ui compositions

Deliverable C's 25 components each carry their shadcn base mapping (`04` §11; `06` index). The build composes them from `Card`, `Badge`, `Dialog`/`Drawer`/`Sheet`, `Tabs`, `Table`, `Progress`, `Alert`, `Tooltip`, `Accordion`, `Checkbox`, `Slider`, `Command`, `Sonner`, etc., plus Recharts (Area/Pie/donut) and Lucide icons. No component needs a primitive outside that set — so "build the design" means "style and compose known primitives," not "invent UI."

### 5.4 Copy → strings

All canonical strings live in `07`; the build sources microcopy (disclaimers, custody/exit clauses, simulation/guardrail strings, number formats) from there verbatim. The design uses the same strings, so there is no copy drift between mock and build.

### 5.5 Spec/SC traceability → testable build

Because each deliverable is tied to spec FRs and SCs (§1, §2), the design is checkable against the same criteria the build is tested against — e.g., SC-002 ("simulation before 100% of signature requests") is a design fact (the `/confirm` funnel) before it is a build/test fact; SC-012 (Trust Center provability) is a designed surface before it is wired to chain reads. The Spec Kit `tasks.md` (generated after the plan) will turn these into build tasks; this design is their visual contract.

> **Net handoff promise:** hand a frontend engineer any screen from this milestone and they can build it against shadcn/ui — the route exists, the tokens are themed, the component is mapped to a primitive, the copy is canonical, and the acceptance criterion is the same one the build is tested on.

---

## 6. Deliverables checklist (quick reference)

- [ ] **A** — High-fidelity screens, six core flows, **DT + MO**, all applicable states (`03` areas 3–8).
- [ ] **B** — High-fidelity screens, all supporting surfaces, **DT + MO**, all states (`03` areas 0–2, 9–11): shell, public, gating, automation, Trust & Safety, SRK/literacy/outcomes/settings/notifications.
- [ ] **C** — All **25 custom components** (+ `AiSuggestionBadge`, `CitationChip`), every state, DT + MO, shadcn-mapped (`06`).
- [ ] **D** — **Clickable prototype**: six flows click-throughable both breakpoints, ≥1 unhappy path each, prove-it + exit ≤1 tap, single-confirm funnel demonstrated.
- [ ] **E** — **Design system**: semantic CSS-variable tokens + component→shadcn mappings; dark default + light token-swap; data-viz/motion/icon/a11y specs (`04`).
- [ ] **Gates** — non-custody visible/provable everywhere · AI honestly framed · sign-disabled-until-acknowledged · net APY + shares + caps + risk panel · outcomes (wins+losses) · WCAG AA · canonical copy · no out-of-scope surfaces · no live functionality.

When every box is checked and the master acceptance criteria (§2) hold, the W1–2 design milestone is **done** and ready for the critical-feedback window and the build.
