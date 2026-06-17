# SparkPoint Pivot — Design Handover

> **Milestone:** W1–2 "Live Wireframe & UI/UX Finalization" (Jun 8–19, 2026) — the **critical design-feedback window** before the coded build. Major change requests after this window significantly impact the build schedule.
> **Audience:** Claude Design (high-fidelity screen production), plus stakeholders reviewing the milestone.
> **Build target:** coded **Next.js (App Router) + TailwindCSS + shadcn/ui** (+ Recharts + Lucide), desktop **and** mobile at equal priority.
> **Source of truth:** the Spec Kit spec and plan at `/home/hello/project/sparkpoint-pivot/specs/001-sparkpoint-pivot-mvp/spec.md` and `…/plan.md`. Where this handover and those disagree on *product behavior*, the spec/plan win.

---

## What you're building (30 seconds)

**SparkPoint is "The First AI-Native Onchain Hedge Fund"** — a non-custodial, chat-based **Personal DeFi Assistant** paired with an **AI-managed Aave Yield Vault** on **Base**. The AI is the fund manager: it learns your goals, recommends strategies, and explains every move — but a **deterministic policy layer means the model never has final execution authority**, and **the user signs every state-changing transaction**. The protocol can *direct* strategy; it can **never** take, move, or withhold your money.

> **Hold this sentence while you design:**
> **AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money.**

Non-custody is the central trust spine and must be **visible and provable** in the UI: one tap to see exactly what SparkPoint can/cannot do (the "prove-it" permissions panel), one tap to exit without us (withdraw-always). Aesthetic: **dark-first**, data-dense-but-clean fintech+crypto; a single **spark** accent for primary CTAs and AI presence; strict semantic colors (green/red/amber); a consistent 3–5 step risk palette; **tabular numerals** for all financials; **WCAG AA**.

**The six core flows** (all fully designed, desktop + mobile, all states): **Onboarding · Chat AI Assistant · Portfolio Overview · Strategy Recommendations · Vault Deposit/Withdraw · Execution Confirmation** — plus supporting surfaces (Trust Center, Automation/session keys, SRK, financial-literacy hub, outcome log, settings, notifications).

---

## Recommended reading order

Read in this order on a first pass — each doc assumes you have read the ones above it.

1. **`00-brief.md`** — start here. Positioning, the five non-custody guarantees, audiences, thesis, tone, scope, non-goals, milestone framing. The front-matter every other doc assumes.
2. **`01-information-architecture.md`** — the route map, the persistent shell, navigation, the flow graph, and the gating/degraded states. The skeleton everything hangs on.
3. **`02-flows/01`…`08`** — the six core flows + supporting surfaces, screen by screen. The heart of the handover. Read in numeric order.
4. **`03-screen-inventory.md`** — the exhaustive numbered checklist (137 artifacts) of every screen, overlay, card, and state to produce. Your production checklist.
5. **`04-design-system.md`** — tokens, the three color systems, type, data-viz, motion, iconography, a11y, and the component→shadcn map. The visual language.
6. **`05-trust-and-safety-ux.md`** — how native non-custody is made visible and provable across every flow (badge, prove-it panel, caps, kill-switch, acknowledge-before-sign, outcome log).
7. **`06-component-library.md`** — the 25 custom SparkPoint components: anatomy, variants, states, shadcn base, trust role, acceptance.
8. **`07-content-and-tone.md`** — canonical voice, microcopy, disclaimers, number formatting. **Wins on any wording conflict.**
9. **`08-deliverables-and-handoff.md`** — exactly what to produce, acceptance criteria, the critical-feedback-window framing, how it feeds the coded build, and what's out of scope. Read before you finish.
10. **`09-references.md`** — the curated benchmark/reference library, each with a "what to borrow." Consult as cited.

> **Working order vs. reading order:** read `00`→`09` once for context; then *work* primarily from `02-flows/*` (what to draw) cross-checked against `03` (have I covered every state?), `06` (which component?), `04` (which token?), `07` (what's the exact copy?), and `05` (is non-custody visible here?). `08` tells you when you're done.

---

## Precedence (who wins on a conflict)

- **Product behavior** → the spec/plan (`/home/hello/project/sparkpoint-pivot/specs/001-sparkpoint-pivot-mvp/`).
- **What to ship / done-ness** → `08-deliverables-and-handoff.md`.
- **The inventory of screens & states** → `03-screen-inventory.md`.
- **Visual tokens / color systems** → `04-design-system.md`.
- **Exact wording / microcopy** → `07-content-and-tone.md`.
- **Non-custody / trust behavior** → `05-trust-and-safety-ux.md`.

---

## Table of contents (every file in this handover)

### Top-level docs

| # | File | What it covers |
|---|---|---|
| 00 | [`00-brief.md`](./00-brief.md) | **Product Brief & Design Handover** — positioning, five non-custody guarantees, audiences, thesis, tone, goals/non-goals, milestone framing. |
| 01 | [`01-information-architecture.md`](./01-information-architecture.md) | **Information Architecture** — route map, persistent shell, navigation, flow graph, gating/degraded states. |
| 02 | [`02-flows/`](./02-flows/) | **The six core flows + supporting surfaces** (see the per-flow table below). |
| 03 | [`03-screen-inventory.md`](./03-screen-inventory.md) | **Screen & State Inventory** — the complete, numbered production checklist (137 artifacts), all states, desktop + mobile. |
| 04 | [`04-design-system.md`](./04-design-system.md) | **Design System (Tailwind + shadcn/ui)** — tokens, color systems, type, data-viz, motion, iconography, a11y, component→shadcn map. |
| 05 | [`05-trust-and-safety-ux.md`](./05-trust-and-safety-ux.md) | **Trust & Safety UX** — native non-custody made visible & provable (badge, prove-it, caps, kill-switch, acknowledge-before-sign, outcomes). |
| 06 | [`06-component-library.md`](./06-component-library.md) | **Component Library** — the 25 custom components: anatomy, variants, states, shadcn base, trust role, acceptance. |
| 07 | [`07-content-and-tone.md`](./07-content-and-tone.md) | **Content & Tone** — voice, microcopy, disclaimers, number formatting. Canonical copy. |
| 08 | [`08-deliverables-and-handoff.md`](./08-deliverables-and-handoff.md) | **Deliverables & Handoff** — what to produce, acceptance criteria, critical-feedback-window, design→code handoff, out of scope. |
| 09 | [`09-references.md`](./09-references.md) | **Benchmark & Reference Library** — curated external patterns/competitors, each with a "what to borrow." |

### Flows (`02-flows/`)

| # | File | Flow |
|---|---|---|
| 1 | [`02-flows/01-onboarding.md`](./02-flows/01-onboarding.md) | **Flow 1 — Onboarding** (chat-driven goals + risk → mandate). |
| 2 | [`02-flows/02-chat-assistant.md`](./02-flows/02-chat-assistant.md) | **Flow 2 — Chat AI Assistant** (primary surface; structured cards). |
| 3 | [`02-flows/03-portfolio.md`](./02-flows/03-portfolio.md) | **Flow 3 — Portfolio Overview** (net worth · PnL · risk · allocation · positions). |
| 4 | [`02-flows/04-strategy-recommendations.md`](./02-flows/04-strategy-recommendations.md) | **Flow 4 — Strategy Recommendations** (ranked vs your goal, "why this?"). |
| 5 | [`02-flows/05-vault-deposit-withdraw.md`](./02-flows/05-vault-deposit-withdraw.md) | **Flow 5 — Vault Deposit / Withdraw** (the Aave Yield Vault, ERC-4626; shares + net APY + caps). |
| 6 | [`02-flows/06-execution-confirmation-simulation.md`](./02-flows/06-execution-confirmation-simulation.md) | **Flow 6 — Execution Confirmation & Pre-Trade Simulation** (the trust gate; sign-disabled-until-acknowledged). |
| 7 | [`02-flows/07-automation-session-keys.md`](./02-flows/07-automation-session-keys.md) | **Flow 7 — Automation / Session Keys** (opt-in, scoped, instantly revocable — ERC-4337). |
| 8 | [`02-flows/08-srk-literacy-outcomes-settings.md`](./02-flows/08-srk-literacy-outcomes-settings.md) | **Supporting Surfaces** — SRK · financial-literacy · outcome log · settings · notifications. |
| 9 | [`02-flows/09-ai-swap.md`](./02-flows/09-ai-swap.md) | **Flow 9 — AI Swap** (conversational ETH→USDC via Aerodrome; transparent ~20 bps routing fee; chains into vault/Aave). |
| 10 | [`02-flows/10-subscriptions-premium-srk.md`](./02-flows/10-subscriptions-premium-srk.md) | **Flow 10 — Subscriptions & Premium (SRK freemium)** (free-vs-premium matrix · upgrade · pay-with-SRK · manage/cancel · acquire-SRK; SRK never gates the vault). |
| 11 | [`02-flows/11-fee-transparency.md`](./02-flows/11-fee-transparency.md) | **Flow 11 — Fee Transparency / Revenue Surfaces** ("we only earn when you earn" — fee line item · `/fees` page · receipts · perf-fee disclosure · portfolio/outcome fees). |

### Admin / Stakeholder Panel (a distinct, separately-gated surface — `../admin-panel/`)

> A **separate admin-only surface**, not part of the end-user `(app)`. Secret base path, SSO+2FA (no wallet-connect), **read-only over funds** (no key custody, builds no transactions; only displays pause-only kill-switch status). Centerpiece = a graphical **revenue dashboard**. Desktop-first. Design it as its own product, in the product's design language.

| File | What it is |
|---|---|
| [`../admin-panel/design-spec.md`](../admin-panel/design-spec.md) | **Admin Panel — Design Spec** (Claude-Design-ready) — admin shell, RBAC, the 12 admin screens A0–A11 (Login · Overview · User analytics · Per-user drilldown · Usage · TVL/vault · **Revenue dashboard** · Ops health · Stakeholder/Client overview · Admin mgmt · Non-custodial config · Audit log), states, responsiveness, acceptance. |
| [`../admin-panel/README.md`](../admin-panel/README.md) | **Admin Panel — Plan** — purpose & audiences (Ops / Stakeholder / Client), access & security model, the non-custody read-only checklist, dashboards & sections, data sources, screen inventory, roadmap. |

### Upstream source material (outside this folder)

| File | What it is |
|---|---|
| [`../../specs/001-sparkpoint-pivot-mvp/spec.md`](../../specs/001-sparkpoint-pivot-mvp/spec.md) | Feature spec — user stories (US1–US6), functional requirements (FR-001…046), success criteria (SC-001…014), non-custody invariants (N1–N5). |
| [`../../specs/001-sparkpoint-pivot-mvp/plan.md`](../../specs/001-sparkpoint-pivot-mvp/plan.md) | Implementation plan — four-layer architecture, the App Router route tree, non-custody enforcement, the single signing chokepoint. |

---

## Hard rules to carry into every screen

- **Non-custody is visible & provable:** persistent non-custodial badge → "prove-it" panel ≤1 tap, and a **withdraw/exit path ≤1 tap** from every authenticated screen. **No state ever removes the exit.**
- **Single signing funnel:** every state-changing action routes to the `/confirm` Execution flow — no bespoke sign UI. Simulation precedes 100% of signature requests; **Sign disabled until alerts acknowledged.**
- **Honest AI:** "AI suggestion — you approve & sign" on every recommendation/action; tool-steps + citations + AI disclaimer present; distinguish AI proposal → guardrail → signature.
- **Legible finance:** net-of-everything APY with breakdown, explicit ERC-4626 shares, caps meter, a first-class risk panel; **tabular numerals** everywhere.
- **Equal-fidelity desktop + mobile**, all states (default · empty · loading · success · warning · error + surface-specific), mapping cleanly to **shadcn/ui**.
- **Constraints:** single Aave Yield Vault · Base only · SRK never gates core function · kill-switch is **pause-only** · beta-gated (whitelist / per-user caps / geo-fence) · dark-first · WCAG AA · single spark accent · strict semantic + risk palettes.

**This is mockups only** — no live functionality, no real transactions, no code (see `08-deliverables-and-handoff.md` §4).
