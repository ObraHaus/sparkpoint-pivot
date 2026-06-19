# 00 — Product Brief & Design Handover

> **Audience:** Claude Design (high-fidelity screen production) and anyone reviewing the W1–2 design milestone.
> **Status:** Authoritative product context for the design handover. This is the front-matter that every other handover doc (`01`…`NN`) assumes you have read.
> **Source of truth:** The high-level app plan — *SparkPoint Pivot — High-Level App Plan & Competitive Strategy — v2* (`/home/hello/.claude/plans/right-now-we-have-swift-volcano-v2.md`). Where this brief and the plan disagree, the plan wins; this brief compresses it for designers.
> **What this doc is NOT:** flow specs, screen inventories, component anatomy, or visual design tokens. Those live in the per-flow handover docs that follow. This doc sets *context, positioning, audience, thesis, tone, goals/non-goals, and milestone framing* only.
> **Client-directed amendments since first issue (log, do not apply silently):** (a) the product is now **multi-network — Base at launch, Sui as the designated fast-follow** — plus a dedicated **Bridge** (supersedes the original "Base only at launch"; see §8, §9, §12 and `docs/INCREMENT-multi-network.md`); (b) the canonical user-facing trust term is **"fully self-custodial"** (replaces "non-custodial" in user-facing copy; "non-custodial / self-custodial" remain accurate technical descriptors); (c) the **brand** diverges from the orange spark accent described in early drafts — the real brand is cobalt blue + gold + coral; **`tokens.css` (in the design showcase) is the source of truth** and `04-design-system.md`'s orange is **stale** (see §6, §11). New surfaces added since first issue: **Spark Core marketing Landing, Bridge, Fees, Premium, and an Admin / Stakeholder panel** (see §9).

---

## 1. What we are building (one paragraph)

**SparkPoint is "The First AI-Native Onchain Hedge Fund"** — a **fully self-custodial**, chat-based **Personal DeFi Assistant** paired with an **AI-managed Aave Yield Vault**, **multi-network: Base at launch, Sui as the designated fast-follow network**, with a dedicated **Bridge** to move assets between them. The AI is the *fund manager*: it reads the user's wallet, learns their goals and risk appetite, recommends strategies, explains every move, and reports outcomes like a manager would. But a **deterministic policy layer** sits between the model and the chain — **the model never has final execution authority** — and **the user signs every state-changing transaction**. The protocol can *direct* strategy; it can **never** take, move, or withhold user funds. Two products, one relationship: an engaged **chat advisor** and a passive, hands-off **ERC-4626 vault**. ("Fully self-custodial" is the canonical user-facing term; "non-custodial / self-custodial" remain accurate technical descriptors — see §6 and `07-content-and-tone.md`.)

The single sentence to keep in your head while designing:

> **AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money.**

---

## 2. Positioning

### 2.1 The headline (bold on purpose)

> **"The First AI-Native Onchain Hedge Fund. AI is the fund manager — it learns your goals, explains every move, proves every result onchain, and never touches your keys."**

The bold "AI hedge fund" claim is the headline; it is **ambition in the title, proof in the product**. The four clauses after it — *learns / explains / proves / never touches keys* — are the credibility ballast that separates SparkPoint from a discredited 2024–25 cohort of "AI fund" projects that collapsed 90–99% and drew fraud litigation. We lead bold **on purpose**, which means the UI must **over-index on proof** to be believed.

### 2.2 The anchor: fully self-custodial by construction (native non-custody)

**Fully self-custodial** is the canonical user-facing framing; *non-custody / self-custody by construction* is the technical description of the same invariant. It is not a feature we *add* — it is the **invariant the whole product is built on**, and the design's central trust spine, and it **holds on every network** (Base and Sui) and across the Bridge. The structural promise underneath the headline is blunt:

> **An AI hedge fund that *cannot* hold, move, or lose your money.**

A user could verify, from the contracts alone, that SparkPoint can never abscond with funds — and could always exit without us. **Five structural guarantees** define it; the design must make all five *visible and provable*, never buried in a footer:

1. **No-admin-withdrawal invariant** — only the user can move funds to an external address; SparkPoint has no code path to withdraw to a SparkPoint-controlled address.
2. **Withdraw-always escape hatch** — the user can exit **directly on-chain** even if SparkPoint's frontend and agent are entirely offline. The kill-switch can pause *new* deployments but can **never** block withdrawals.
3. **User-owned keys; no agent-generated wallets** — the user is the sole owner/admin signer of their smart account. We explicitly reject the agent-generated-wallet anti-pattern. Default execution = **per-action user signature**.
4. **Scoped, revocable, time-boxed automation** — opt-in auto-rebalance via an ERC-4337 session key, bounded by an on-chain policy module (allowlist, per-tx + cumulative caps, max slippage, hard expiry), **instantly and unilaterally revocable** by the user without SparkPoint's cooperation.
5. **Non-upgradeable custody semantics + verifiable non-custody** — single-purpose, non-upgradeable vault; any multisig/timelock governs *pause only*, never fund movement; the Trust Center surfaces exact granted on-chain permissions so non-custody is **proven, not promised**.

**Design implication (carry this everywhere):** the user is always **one tap from seeing exactly what SparkPoint can and cannot do** (the "prove-it" permissions panel), and **one tap from exiting without us** (the self-service withdrawal — **withdraw-always holds on every network**). A persistent **"Fully self-custodial"** badge in the global shell is the entry point (the badge wording is the canonical user-facing term; "non-custodial" remains its technical synonym).

### 2.3 The wedge (where we win — what the design should make legible)

- **Conversational goal + risk onboarding** as the wedge (vs. a lone risk slider) — scenario-based capture → a personalized, adjustable **mandate**.
- **"AI as fund manager," not "AI as button-presser"** — explains reasoning, reports performance, proposes changes, asks for sign-off → a *recurring relationship*.
- **Legible guardrails + provable, fully self-custodial design** — make "the AI can't drain you" *visible*, on every network and across the bridge.
- **Outcome accountability** — an honest log of wins *and* losses, tied to the originating recommendation.
- **Honest yield** — net-of-everything APY, no token-incentive theater.

---

## 3. Target audiences

**Retail-first**, designed to scale along a competence gradient from crypto-curious to DeFi-native. The product must feel safe and legible to the newcomer **without** feeling toothless to the expert.

| Tier | Who they are | What they need from the UI | Design priority |
|---|---|---|---|
| **Primary — Crypto-curious retail** | Has a wallet (or will connect one), understands "yield" loosely, intimidated by DeFi mechanics, burned by or wary of "AI fund" hype. | Plain-language framing, scenario-based risk capture, contextual literacy tips, capital-preservation-first messaging, a visible "you can always leave" exit. | **Highest.** Onboarding + chat clarity + trust visibility decide whether they stay. |
| **Secondary — Yield-seeking mainstream** | Comfortable with apps like Coinbase, wants better-than-savings yield, will trust an assistant if it proves itself. | Honest net APY, legible shares, clear risk tier, simulation before signing, outcome log they can audit. | **High.** Vault legibility + confirmation trust. |
| **Tertiary — DeFi-native power users** | Reads contracts, knows ERC-4626/4337, skeptical of custody and of "AI" claims. | One-tap proof-of-non-custody, on-chain permission scope, simulate-before-sign friction (Rabby-style), data density, escape-hatch they can verify. | **Important for credibility.** They validate the claim publicly; design must satisfy their scrutiny without cluttering the retail path. |

**Tone calibration across tiers:** lead with the retail-legible surface; let depth (raw permissions, share math, simulation internals) be **progressively disclosed** — one tap deeper, never forced on the newcomer, always reachable by the expert.

---

## 4. Platforms

**Desktop and mobile are EQUAL priority** — not desktop-first-then-shrink, not mobile-only. Design both as first-class.

- **Build target:** coded **Next.js (App Router) + TailwindCSS + shadcn/ui**, hosted at a live URL. Every design decision must **map cleanly to shadcn/ui primitives** (Card, Badge, Dialog/Drawer, Tabs, Table, Progress, Alert; charts via Recharts).
- **Desktop** favors **side-by-side** layouts — e.g. chat alongside portfolio/vault panels — exploiting horizontal space for data density.
- **Mobile** is **chat-native, single-column**, scaling up; multi-pane desktop layouts collapse to stacked sections and Drawers rather than Dialogs where touch ergonomics demand it.
- Both breakpoints must carry the full set of states (default / empty / loading / success / warning / error) and the non-custody touchpoints (persistent badge → prove-it panel; always-available exit).

---

## 5. Design thesis

> **AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money.**

Every AI suggestion passes through **visible** guardrails and is **user-signed**; custody never leaves the user. Non-custody must be *felt and provable* in the UI, not buried.

The product borrows the strongest pattern from three genres and fuses them:

1. **Conversational copilot** — chat-first; render actionable output as **structured action/recommendation/confirmation cards** (≤2 actions each), never walls of prose; suggested-prompt chips; sourced citations; visible tool-step reasoning; persistent AI disclaimer; thumbs feedback.
2. **Robo-advisor** — goals-first onboarding; **risk via scenario cards** ("$1,000 → $800, what do you do?"), not abstract self-rating; an adjustable mandate as the output.
3. **DeFi vault tooling** — legible **ERC-4626 shares**, **net-of-fees APY** with breakdown, per-vault risk transparency, caps meters, and an always-visible **withdraw / exit**.

**Recurring UI motifs the design must establish and reuse:**
- An **"AI suggestion — you approve & sign"** label on every recommendation.
- A **guardrail checklist** on every confirmation screen; **Sign disabled until alerts are acknowledged** (Rabby pattern).
- A **persistent non-custodial badge** → "prove-it" permissions panel.
- An **always-available self-service exit** (withdraw-always).
- **Tool-step / "thinking" transparency** so autonomy is honest, never opaque.

---

## 6. Brand & tone summary

- **Aesthetic:** **dark-first**, data-dense-but-clean **fintech + crypto**. Trustworthy and self-sovereign in feel — calm, precise, not hypey or casino-like. Dark base is a **deep indigo-navy**.
- **Brand accent:** the **spark** accent system reserved for **primary CTAs and AI presence** — but the real brand (matched to sparkpoint.io) is **cobalt blue + gold + coral** warm accents, with a signature **blue→cyan→gold→coral gradient**, **not** the orange spark of early drafts. **`tokens.css` (in the design showcase) is the source of truth; the orange accent in `04-design-system.md` is STALE.** Keep the accent scarce — do not dilute it across the UI.
- **Semantic colors (strict):** **green** = gains / safe; **red** = loss / blocked; **amber** = caution. Never use the brand accent to carry semantic meaning.
- **Risk palette:** a **consistent 5-step risk palette running violet→magenta** (chosen so it never collides with the cobalt brand blue), reused *everywhere* risk appears (portfolio risk panel, vault risk score, strategy ranking, allocation-by-risk-tier). (Supersedes any teal-anchored scale in early drafts.)
- **Type:** **Geist Sans + Geist Mono**.
- **Numerals:** **tabular numerals** for all financial figures (balances, APY, PnL, shares) so columns align and values don't jitter.
- **Accessibility:** **WCAG AA** contrast minimum across both themes.
- **Voice / microcopy:** honest, plain, capital-preservation-first. **Never lead with return projections** — lead with transparency, risk control, and "you're in control." The canonical trust term is **"fully self-custodial"** ("non-custodial / self-custodial" remain technical synonyms). State plainly **what the AI decides vs. what the deterministic policy decides** (honest autonomy is the single biggest trust lever). Avoid hype adjectives; let proof do the persuading.

---

## 7. Design goals

1. **Make non-custody visible and provable.** One tap to see exactly what SparkPoint can/cannot do on-chain; one tap to exit without us. Trust is *shown*, not claimed.
2. **Make the AI honest.** Always distinguish AI proposal from deterministic guardrail from user signature. Show tool-steps, citations, and the guardrail checklist. Label every recommendation "AI suggestion — you approve & sign."
3. **Make onboarding the wedge.** A conversational, scenario-based goal+risk interview that produces a legible, adjustable **mandate** — disproportionately polished, because it is our clearest white space.
4. **Make yield and risk legible.** Net-of-everything APY with breakdown, explicit ERC-4626 shares, caps meters, a real **risk panel** (stronger than Zerion/DeBank/Zapper's weak PnL/risk), and a reused risk palette.
5. **Make outcomes accountable.** An honest log of wins **and** losses, each tied back to the recommendation that produced it.
6. **Make signing safe.** Tenderly-style pre-trade simulation + balance-change preview + guardrail checklist; **sign disabled until acknowledged**.
7. **Equal-fidelity desktop and mobile**, mapping cleanly to shadcn/ui, all states covered.
8. **Production-ready (high fidelity).** This milestone's output is the design that the build implements — not exploratory sketches.

---

## 8. Explicit non-goals (do NOT design these)

- **No multi-strategy / multi-vault complexity.** A **single conservative Aave Yield Vault** at launch. Vault discovery can exist as a shell, but design for one vault.
- **No SRK-as-gatekeeper.** The SRK token is a **non-essential** utility surface (what it does, balance, how to earn/use). The **core product must work without it** — never gate the vault, onboarding, or chat behind SRK.
- **No custodial patterns.** No agent-generated wallets, no "we hold your keys for convenience," no admin-withdrawal path, no flow that implies SparkPoint can move user funds. The kill-switch is **pause-only** and must be shown as such.
- **No return-projection-led marketing surfaces.** Don't design hero screens or cards that lead with cherry-picked APY or promised returns; lead with capital preservation, transparency, and risk.
- **No "AI does it all, trust us" opacity.** Default is **per-action user signing**; delegated automation is **opt-in, scoped, time-boxed, instantly revocable**. Never design a flow that hides what the AI is doing.
- **~~No multi-chain. Base only at launch.~~ SUPERSEDED — CLIENT-DIRECTED SCOPE AMENDMENT.** The product is now **multi-network: Base at launch (live), Sui as the designated fast-follow network**, with a dedicated **Bridge** (Base ↔ Sui). **DO** design the persistent network switcher, the per-network indicators, and the Bridge surfaces. **Networks beyond Base + Sui remain out of scope.** **Discipline:** Sui is **non-EVM (Move-based)** — it does **not** use ERC-4337 / ERC-4626 / Solidity; do **not** fabricate a detailed Sui contract spec. Amend scope + principles to multi-network and add the bridge at the product/UX/non-custody level only; the **Sui-side account/vault architecture and the bridge mechanism/provider are a separate follow-on increment to be designed** (see §9, §12, and `docs/INCREMENT-multi-network.md`). Keep the existing Base/EVM contract spec intact.
- **Deferred (out of scope for these mockups):** multi-strategy vaults, ZK trade proofs, SRK v2 governance, KYC/compliance gating, stocks/TradFi, a general (non-DeFi) financial assistant, **networks beyond Base + Sui, and the real bridge provider/route-selection logic and Sui contract spec (flagged as a follow-on increment, above)**. Mention only where a placeholder is genuinely needed.
- **No code.** This is design handover. Map to shadcn primitives; do not write implementation.

---

## 9. Scope of the design deliverable

**Six core flows — all must be fully designed**, desktop + mobile, with all states:

1. **Onboarding** — chat-driven goals + risk-tolerance capture → personalized mandate.
2. **Chat AI Assistant** — the primary surface; structured action / recommendation / confirmation cards.
3. **Portfolio Overview** — PnL, risk, allocation.
4. **Strategy Recommendations** — ranked vs the user's goal, with "why this?".
5. **Vault Deposit / Withdraw** — ERC-4626 Aave Yield Vault; legible shares + net APY + caps.
6. **Execution Confirmation** — Tenderly-style pre-trade simulation + guardrail checklist + user-signed.

**Supporting surfaces (also in scope):** global shell (nav, persistent **"Fully self-custodial"** badge, **persistent network switcher**, wallet connect, AI disclaimer strip); **Trust Center** (self-custody guarantees panel, "prove-it" permissions panel, caps dashboard, pause-only kill-switch status, audits); **Automation / session keys** (scope/cap/expiry grant + instant revoke); **SRK utility**; **financial-literacy hub** + contextual tip cards; **outcome log** (wins and losses); **settings**; **notifications**.

**Delivered since first issue — light mode is now a supported feature.** SparkPoint ships **both a dark and a light theme** (dark remains the default and the design target; light is a fully supported second theme, not a token-swap demo). The choice is **persisted in `localStorage` under `sp-theme`** and applied before first paint (no flash). The toggle is reachable in the **app** (user-avatar menu), the **admin / stakeholder panel** (side-nav), and **onboarding** (header). The **Spark Core marketing landing is dark-only by design** (art-directed for dark). All colors remain CSS-variable tokens (no hardcoded hex), so surfaces flip on a single root class; brand, semantic, and risk colors stay theme-independent. See `04-design-system.md` → "Theming — light & dark mode".

**New surfaces added by client direction (also in scope):**
- **Spark Core marketing Landing** — an animated marketing entry page (distinct from the in-app `landing` surface). The **flavor selector (Ember / Plasma / Constellation) is intentionally an open choice left for the client to pick** — note it as unresolved, do not lock it.
- **Bridge** — move assets **Base ↔ Sui**; routes through the same simulation + guardrail + you-sign confirmation gate (`/confirm/bridge`). **Fully self-custodial:** the user signs a lock/burn on the source network and receives funds in their **own** wallet on the destination network; SparkPoint **never custodies funds in transit**.
- **Fees** — fee-transparency page ("we only earn when you earn"); reflects the **active** 10% profit-only, high-water-mark performance fee on the Aave vault (0% on principal/deposits/withdrawals).
- **Premium** — the SRK-paid subscription surface (framed as a subscription payment, never a vault fee; free tier never gated).
- **Admin / Stakeholder panel** — read-only-over-funds revenue dashboard with a **governed manual kill-switch** (pause-only, 2-of-3 multisig, **never blocks withdrawals**; the panel can only *propose & sign* — execution requires the on-chain multisig threshold).

---

## 10. UX benchmarks to honor (named references)

| Surface | Benchmarks | What to borrow |
|---|---|---|
| **Chat action cards** | OpenAI Apps SDK (**≤2 actions** per card), Cloudscape gen-AI chat, Hey Anon, Griffain | Structured cards over prose; suggested prompts; tool-step transparency; citations; thumbs feedback. |
| **Portfolio** | Zerion, DeBank, Zapper | Net-worth hero + over-time chart, allocation views — **plus a stronger risk panel** than any of them. |
| **Vaults** | Morpho / Gauntlet, Yearn, Beefy | Net APY + breakdown, explicit shares, caps meter, curator/audit badges, always-visible exit. |
| **Onboarding** | Wealthfront, Betterment (robo-advisor) | Goals-first flow; **scenario-based** risk capture; adjustable result. |
| **Simulation / confirmation** | Tenderly (pre-trade preview), Rabby (**sign disabled until acknowledged**) | Balance-change table, approvals, gas, projected outcome, guardrail checklist, visible-risk friction. |
| **Trust / self-custody** | Ledger, Trust Wallet | Self-custody framing; "your keys, your funds"; legible permission scope. |
| **UX-feel cautionary** | Neur beat Griffain on *feel* despite less power | **Polish converts** — invest in onboarding speed and conversational feel. |

---

## 11. Milestone framing — W1–2 "Live Wireframe & UI/UX Finalization"

- **This is the W1–2 milestone** (Jun 8–19, 2026) of the 12-week build (Jun 1 – Sep 4, 2026): **Live Wireframe & UI/UX Finalization** — final UI/UX design, **all flows, mockups only**.
- **This is the CRITICAL design-feedback window.** Per the plan, **major change requests after this point significantly impact the build schedule.** Get the flows, states, and trust touchpoints right now.
- **Fidelity bar:** **production-ready, high-fidelity** mockups for **all six core flows + supporting surfaces**, at **desktop + mobile**. Not exploratory wireframes — the design the build implements.
- **Pipeline position:** this brief sits at stage ④ input (High-fidelity design via Claude Design), downstream of the high-level plan (①), architecture (②), and Spec Kit specs (③), and upstream of the core build (⑤).
- **Definition of done for the design milestone:** a complete, finalized, clickable-quality picture of the app — all six core flows + supporting surfaces, both breakpoints, every state, with non-custody and guardrail touchpoints present throughout — ready for stakeholder feedback in this window and then for the build.

---

## 12. Constraints (carry into every screen)

- **Single Aave Yield Vault at launch** (ERC-4626, USDC; **0% on principal / 0 management**, with an active **10% profit-only, high-water-mark performance fee** on realized yield — configurable on-chain, hard-capped at 20%, timelocked).
- **SRK is non-essential** — never gates core function. (SRK *is* the payment rail for the optional **Premium** subscription — that is not a core gate.)
- **Beta-gated** — whitelist, per-user caps, geo-fenced frontend. Design the **gated / not-whitelisted / caps-reached** states. **Per-network and per-bridge caps** wire to policy limits.
- **Multi-network: Base at launch, Sui as the fast-follow** — design the **persistent network switcher**, per-network indicators, and the **Bridge** (Base ↔ Sui). **Networks beyond Base + Sui are out of scope.** Sui is **non-EVM (Move)** — no fabricated Sui contract spec; the Sui account/vault architecture and bridge mechanism are a **follow-on increment** (§8, §9).
- **Withdraw-always holds on EVERY network**, not just Base.
- **Per-action signing is the default**; automation is opt-in, scoped, revocable.
- **Kill-switch is pause-only** — it can never block withdrawals, and the UI must say so. The Admin panel kill-switch is **governed (2-of-3 multisig, propose-and-sign only)**.
- **Map to shadcn/ui**; **dark-first** (deep indigo-navy base); **Geist Sans + Geist Mono**; **tabular numerals**; **WCAG AA**; the **cobalt blue + gold + coral** brand accent system (signature blue→cyan→gold→coral gradient — **`tokens.css` is the source of truth; doc-04's orange is stale**); strict semantic colors; consistent **violet→magenta** 5-step risk palette.
