# Claude Design — Handover Prompt 2: ADD these four surfaces

> Copy-paste the block below to Claude Design. It extends the design you are already building; it does not replace it.

---

You are continuing the **SparkPoint Pivot** design — a non-custodial, chat-based AI DeFi assistant paired with an AI-managed Aave Yield Vault on Base (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide; dark-first; user app desktop **and** mobile at equal priority).

**ADD the four surfaces below to the work in progress. Do NOT replace, redraw, or restyle anything you have already produced.** These are *additive* — new flows and a new internal panel that compose the existing design system and component library. For each one, **read the linked repo doc first** — it is the authoritative, screen-level spec (goal, entry points, step-by-step screens with all states, components mapped to shadcn/ui, desktop + mobile layouts, microcopy, trust touchpoints, acceptance criteria). Design to the doc; this prompt is only the index and the guardrails.

## The four additions

### 1. AI Swap — conversational ETH→USDC via Aerodrome, with a transparent routing fee
**Read:** `docs/design-handover/02-flows/09-ai-swap.md`

The end-to-end conversational swap, **faithful to the original SparkPoint hub demo's AI-swap proposal**: the user types e.g. "swap ETH for USDC"; the assistant classifies the intent and proposes the best route (ETH→USDC via Aerodrome, highest liquidity, slippage protection built in), shows a swap suggestion card, and on Preview routes into the **existing single confirmation funnel** (`/confirm`, Flow 6) — balance-change table (ETH out / USDC in), expected output + min received, gas, simulation status, guardrail checklist — then signing → success ("Swapped X ETH for ~Y USDC via Aerodrome…") with a chaining card offering to deposit that USDC into the vault or supply to Aave. Keep the visible **"how it works" architecture trace** (intent → policy → Tenderly sim → Aerodrome → outcome log) as a trust/education element. **The one net-new thing vs the old demo:** a transparent **SparkPoint routing fee ~20 bps (15–30 bps band)**, shown explicitly in the preview/confirm as a line item ("SparkPoint routing fee: 0.20% = $X"), with an optional "first N swaps free" state. It is a **usage** fee taken **inside the user-signed swap** — never a custody fee, never on the vault or principal, never hidden.

### 2. Subscriptions & the Premium AI tier — freemium, paid in SRK
**Read:** `docs/design-handover/02-flows/10-subscriptions-premium-srk.md`

The freemium model where the **free tier is fully capable** (chat assistant, portfolio read, basic recommendations, the Aave Yield Vault deposit/withdraw, swaps, withdraw-always — **no SRK required for any core or custody function**) and an **optional Premium tier is paid in SRK** (the token's concrete launch utility: deeper/more-frequent strategy analysis, advanced strategy vaults when live, higher limits & priority compute, advanced analytics & alerts, scoped auto-rebalance with higher caps). Design: a **free-vs-premium feature matrix** (`/premium`); non-nagging upsell entry points that appear only when a premium-only feature is touched; the **upgrade flow**; the **pay-with-SRK screen** (SRK balance, plan price in SRK + USD equivalent, the user-signed `approve` + `pay` tx via the existing `/confirm` funnel, non-custodial, with an optional stablecoin fallback flagged); subscription confirmation; **manage/renew/cancel/downgrade** (cancel always one tap away, no dark patterns); an **"acquire SRK" hand-off**; plus free-tier / lapsed / degraded states. Copy must make clear premium is **optional** and the free tier is fully capable. **Premium NEVER gates the vault, deposits, yield, or withdrawals; SRK stays non-essential** — reconcile with that everywhere.

### 3. Fee Transparency & revenue surfaces — "we only earn when you earn"
**Read:** `docs/design-handover/02-flows/11-fee-transparency.md`

The user-facing fee-disclosure system that makes **"we only earn when you earn — never on your principal, never by taking custody"** legible everywhere a fee could (or pointedly does *not*) appear: the **swap-fee line item** in the confirmation (one of three fees active at launch — cross-ref Flow 9); a dedicated plain-language **"Fees & how we make money" page** (`/fees`); per-action receipts that re-state exactly what fee (if any) was paid; the **launch vault's performance fee** shown explicitly ("SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your principal") so "net" is legible; and the **performance-fee disclosure** component, **active at launch** on the Aave Yield Vault (the same component scales to future opt-in advanced strategy vaults). Fees must always be net-of-everything and never hidden — in the confirm surface, the portfolio, and the Outcome Log.

### 4. Admin / Stakeholder Panel — secret, read-only-over-funds, graphical revenue dashboard
**Read:** `docs/admin-panel/design-spec.md` (the screen-by-screen design spec) and `docs/admin-panel/README.md` (the authoritative plan: audiences, access/RBAC, dashboards, data, roadmap)

The **secret, admin-only** internal panel where the team, stakeholders, and the client *observe* the product in motion. It is **READ-ONLY OVER FUNDS** — it holds no keys, builds no transactions, and only *displays* the pause-only kill-switch status. Centerpiece = a **graphical revenue dashboard** (revenue by stream over time, cumulative, trajectory/forecast, MRR/ARR, per-user/per-vault, high-water-mark status, fee-vs-TVL, and the "we only earn when you earn" user-yield-vs-protocol-revenue view), plus user analytics, usage, TVL/vault, and ops health. **Desktop-first.** It reuses the existing design language (tokens, charts, risk palette) and existing custom components.

## Non-negotiables (carry into every screen)

- **Non-custody is the trust spine.** The user signs every state-changing transaction; nothing moves until they sign; withdraw-always; every new action funnels through the existing single `/confirm` sign gate — no bespoke signing UI. The **admin panel is read-only over funds** (no key custody, builds no transactions, only displays the pause-only kill-switch).
- **SRK stays non-essential.** Premium is optional; the free tier is fully capable; SRK is never required for any core or custody function and **never gates the vault, deposits, yield, or withdrawals.**
- **Fee transparency — never hide a fee.** The swap routing fee is shown as an explicit pre-sign line item; the launch vault shows the **active 10% profit-only performance fee** ("10% of yield, high-water mark — 0% on your principal"), disclosed transparently and configurable on-chain within a hard cap of 20% (timelocked). Honest, net-of-everything, sourced/provable.
- **Breakpoints:** the three **user** flows (AI Swap, Subscriptions, Fee Transparency) are **desktop + mobile at equal fidelity, all states**. The **admin** panel is **desktop-first** (tablet/phone responsive as the spec notes).
- **Consistency with the existing system.** Build from the existing design system (`docs/design-handover/04-design-system.md`) and component library (`docs/design-handover/06-component-library.md`) — same tokens, the single spark accent, strict semantic + risk palettes, tabular numerals, the three orthogonal color systems (never cross-contaminated). Compose existing components; do not invent a parallel language.

## Also reference

- **Revenue model:** `docs/revenue-model/README.md` — the source of truth for *what* we charge and why (Stream 0A swap-routing fee; Stream 0B premium AI tier; Stream 1A-Launch the active 10% profit-only, high-water-mark performance fee on the launch vault — 0% on principal, hard-capped at 20%, timelocked, ratified by amendment v1.1.0). The designs **visualize** this — they never authorize a new fee.
- **The existing flows and trust/voice docs** the four specs already lean on: `02-flows/06-execution-confirmation-simulation.md` (the authoritative sign gate every new action routes into), `02-flows/02-chat-assistant.md`, `02-flows/05-vault-deposit-withdraw.md`, `05-trust-and-safety-ux.md`, and `07-content-and-tone.md` (**canonical wording wins on any conflict**).
- **If anything in these specs would force a divergence from an existing spec (the design system, content/tone, trust model, or the revenue model), ASK before diverging.** Do not silently override a spec.

## Deliverables expected

1. **Hi-fi screens, desktop + mobile, all states** for the three user flows: **AI Swap** (proposal card → preview/confirm with the routing-fee line item → signing → success + vault-chaining card), **Subscriptions / Premium** (feature matrix → upgrade → pay-with-SRK → confirmation → manage/cancel → acquire-SRK hand-off), and **Fee Transparency** (the `/fees` page → in-confirm fee line item → receipts → vault performance-fee line ("10% of yield, profit-only, HWM — 0% on your principal") → active performance-fee disclosure).
2. **The admin / stakeholder dashboards, desktop-first**: the graphical revenue dashboard plus user analytics, usage, TVL/vault, and ops-health screens, with the read-only-over-funds and pause-only kill-switch touchpoints.
3. **Updated component states** for any existing component these surfaces extend (e.g. the confirmation cost-&-outcome block gaining a fee line item, the SRK-utility row, usage/limits caps meters, the active performance-fee-disclosure state with its below-HWM "no fee right now" state) — extended in place, consistent with the existing library, not forked.
