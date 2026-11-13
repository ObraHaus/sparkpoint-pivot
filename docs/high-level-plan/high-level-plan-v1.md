# SparkPoint Pivot — High-Level App Plan & Competitive Strategy

> **What this document is:** the first artifact in the SparkPoint Pivot delivery pipeline. It paints the whole app and its full feature set in high fidelity (conceptually — every flow, surface, and differentiator), and sets the competitive positioning, so the next stages have a single source of truth to build from.
>
> **Pipeline (per your workflow):** **① High-level app plan (this doc)** → ② Architectural design → ③ Spec plan via [GitHub Spec Kit](https://github.com/github/spec-kit) → ④ High-fidelity design via Claude Design → ⑤ Core build.
>
> **This doc deliberately stops at "what & why."** No technical spec, no architecture diagrams, no wireframes — those are owned by stages ②–④.

---

## Context — why this plan, and the decisions that shape it

SparkPoint has a green light to pivot into **"The First AI-Native Onchain Hedge Fund"**: a non-custodial, chat-based Personal DeFi Assistant paired with an AI-managed Aave Yield Vault on Base, where autonomous AI agents (reasoning on Claude, fenced by a deterministic policy layer) manage capital, risk, and strategy — and everyday users interact conversationally. The 12-week build runs **Jun 1 – Sep 4, 2026**; the immediate milestone is **Live Wireframe & UI/UX Finalization (Weeks 1–2, Jun 8–19)**.

The problem this plan solves: before architecture and high-fidelity design begin, we need (a) a competitively-grounded picture of the **entire app and its full feature set**, and (b) a **positioning** that survives a market where the "AI fund" narrative has been damaged by 2024–25 blow-ups. This document delivers both so stages ②–④ don't re-litigate scope or strategy.

**Locked decisions (from stakeholder, 2026-06-15):**
- **Build target:** coded **Next.js (App Router) + TailwindCSS + shadcn/ui**, hosted at a live URL. (Visual wireframing is **not** done here — it is handed to Claude Design after the spec stage.)
- **Positioning:** **bold "AI Hedge Fund" framing** front-and-center — anchored by radical transparency so it reads as *credible ambition*, not hype.
- **Platform:** **desktop + mobile, equal priority.**

---

## 1. The product in one picture

**Vision:** *Not "AI analytics for DeFi." This is AI as the fund manager — onchain, non-custodial, on Base.*

**Three pillars (from the project summary):**
1. **Personal DeFi Assistant** — retail-facing MVP. A non-custodial AI copilot that reads wallet activity, learns goals + risk appetite, recommends strategies, and executes only on user-signed opt-in. *The front door.*
2. **AI Hedge Fund Core** — the onchain vault + agent engine that turns AI strategy into managed capital. Launches as a single conservative **Aave Yield Vault (ERC-4626, 0-fee)** and scales to multi-strategy.
3. **SRK Utility Token** — access, incentives, and governance for the ecosystem (activates in a later cycle; **the core product must work without it** — see §7).

**The flywheel:** retail users → outcome data → better models → managed capital → better returns → more users. Each turn compounds the others; SRK becomes the access primitive for autonomous capital intelligence.

**Positioning statement (bold framing, credibility-anchored):**
> **"The First AI-Native Onchain Hedge Fund. AI is the fund manager — it learns your goals, explains every move, proves every result onchain, and never touches your keys."**

The bold "hedge fund" claim is the headline. The four clauses after it (*learns / explains / proves / never touches keys*) are the credibility ballast that separates us from the discredited cohort. **Ambition in the title; proof in the product.**

---

## 2. Competitive landscape (research synthesis)

Full competitor reports are saved alongside this plan (see *Appendix — research files*). Key findings:

### Market context (2025–2026)
- **DeFAI** (DeFi + AI agents) is a recognized ~**$2.6B** sector; broader DeFi ~$238B. The category has graduated from "chatbot AI" (talks) to "agentic AI" (acts).
- **Base is the center of gravity** for non-custodial agentic yield — Giza ARMA, Brahma's Morpho Agent, Fungi, Bankr, and Axal all live on Base. **Our most direct competition is concentrated exactly where we're launching.**
- The hype tailwind has **cooled** (AI-agent active wallets fell 4.8M → 3.1M quarter-over-quarter; many DeFAI tokens down 85–99%). This *favors a credibility-first entrant* but means we cannot rely on narrative beta — TVL must be earned with proof.

### Direct competitors (assistant / autonomous yield agents)
| Product | Custody | Chat-first? | Assistant vs Autonomous | Note |
|---|---|---|---|---|
| **Giza / ARMA** | Non-custodial (AA+ZK) | No | Autonomous USDC yield bot | Big historical numbers, but **live TVL collapsed (~$14k)**; ~15% yield was **$GIZA-token-subsidized**. The cautionary tale. |
| **Brahma (ConsoleKit / Morpho Agent)** | Non-custodial (Safe) | Config-by-chat | Autonomous, policy-guardrailed | **Closest architectural analog** — already shipped non-custodial + policy guardrails. Architecture alone is *not* a moat. |
| **Fungi** | Non-custodial | No | Autonomous | Same Base protocols (Aave/Morpho/Fluid/Moonwell) as us. |
| **Hey Anon** | Non-custodial | **Yes** | Assistant + exec | >$100M mcap; NL DeFi ops, but trade/research-centric, not fund-manager. |
| **Bankr** | **Agent-generated wallet (custodial-ish)** | Yes (social) | Trader | Farcaster-native; key-custody trust concern. |
| **Axal (Autopilot)** | Non-custodial (ZK-verified) | Partial | Autonomous, risk-set | Best analog for **risk-tolerance onboarding** — but only a slider. |
| **Griffain / Neur (Solana)** | Non-custodial | Yes | Assistant | UX reference: **Neur beat Griffain on feel despite less power → UX polish converts.** |

### Category competitors ("AI as fund manager" / vaults)
- **Numerai** — credible AI hedge fund, but **offchain/custodial** (regulated equities fund); onchain stake/burn history is its proof mechanism.
- **Almanak** — institutional DeFi agent vaults; **claimed $132M "peak" TVL vs ~$502K live on DefiLlama** → the peak-vs-live inflation trap to avoid.
- **Morpho + curators (Gauntlet / Steakhouse / Re7), Yearn, Beefy** — the **institutional credibility benchmark**: non-custodial ERC-4626 vaults, public track records, third-party risk curation — but they market as "risk-managed vaults," *not* "AI fund manager."
- **daos.fun / ai16z / ElizaOS / Virtuals** — the **discredited wing**: raised billions on narrative, collapsed 90–99%, drew fraud litigation; research found most "AI agents" **weren't actually trading autonomously**.

### Table stakes (what users now expect — we must ship all of these)
Non-custodial smart accounts · natural-language chat · 24/7 autonomous rebalancing across Base blue-chips · user-set risk controls · policy guardrails ("the model never has the final word" is now an **expectation, not a moat**) · onchain transparency · fast, smooth onboarding.

### The credibility trap — and how we turn the bold claim into a strength
The phrase "AI hedge fund" now carries baggage: ~99.9% drawdowns (ai16z), a fraud class action alleging the AI "never existed as presented," and a study finding **62% of users lost money** across leading AI-trading platforms. Because we are **leading with the bold framing on purpose**, the product must over-index on proof to be believed:
- **Onchain-reconstructable performance** (anyone can verify results from chain data — Numerai's trust mechanism).
- **0-fee conservative launch** ("we earn trust before we earn fees" — a verifiable signal Almanak/structured-product vaults can't make).
- **Honest autonomy** — state exactly what the AI decides vs. what the deterministic policy/human decides (the single biggest failure of the discredited cohort).
- **Never lead with return projections** — lead with capital preservation, transparency, and risk control (Sortino/drawdown over cherry-picked APY).

### White space → our wedge (where we win)
1. **Conversational goal + risk onboarding as the wedge** — almost nobody does a deep structured interview → personalized mandate; Axal only has a slider.
2. **"AI as fund manager," not "AI as button-presser"** — explains reasoning, reports performance like a manager, proposes changes, asks for sign-off → a *recurring relationship*, not fire-and-forget.
3. **Make the guardrail layer a visible trust product** — Brahma proved the architecture; nobody markets it legibly (live policy view, scoped-permission receipts, simulate-before-sign).
4. **Honest, non-subsidized yield** — direct contrast to Giza's token-subsidized APY and post-airdrop TVL flight.
5. **Chat-first AND autonomous in one product** — advisor mode + hands-off ERC-4626 vault; competitors are one or the other.
6. **Own the credible "AI fund manager" claim the institutional wing won't make** — Morpho/Yearn are trusted but won't say "AI manager"; Numerai is AI but offchain/custodial. *Onchain + non-custodial + explicitly-AI-managed + institutionally credible* is uncrowded — and on **Base it is effectively empty.**

---

## 3. The whole app — full feature map (high fidelity, conceptual)

Everything below maps to the **"Included at Launch"** scope in the project summary, organized into the **six core user flows** plus supporting surfaces. This is the complete feature picture the architecture and design stages build against. Targets **desktop + mobile** equally.

### Core flows (the spine of the product)
1. **Onboarding** — chat-driven capture of goals + risk tolerance → a personalized mandate.
2. **Chat AI Assistant** — the primary surface; conversational portfolio reading, recommendations, education, and action initiation.
3. **Portfolio Overview** — PnL, risk, and allocation across Base assets.
4. **Strategy Recommendations** — yield/allocation suggestions ranked against the user's goal.
5. **Vault Deposit / Withdraw** — the Aave Yield Vault (ERC-4626) and future strategy vaults.
6. **Execution Confirmation** — pre-trade simulation + user-signed, guardrail-checked execution.

### Feature inventory (grouped, mapped to launch scope)
- **Assistant & intelligence:** chat-based AI assistant · contextual financial-literacy tips (learn-as-you-go) · explainable "why this?" reasoning on every recommendation · outcome logging (each recommendation labeled with realized PnL over time).
- **Portfolio & strategy:** portfolio reader (positions, PnL, allocation) · risk visualization & drift-vs-target · strategy recommender ranked to goal.
- **Vault & DeFi actions:** Aave Yield Vault (ERC-4626, 0-fee, deposit USDC→yield→withdraw anytime) · Aave v3 deposit/withdraw (USDC, ETH) · Aerodrome swaps from chat.
- **Execution & safety:** opt-in execution layer (user-signed) · pre-trade simulation · deterministic policy guardrails · per-user & protocol caps · multisig kill-switch · beta gating (whitelist, per-user caps, geo-fenced frontend).
- **Account abstraction UX:** custom ERC-4337 smart account · scoped, time-limited **session keys** for opt-in delegated auto-rebalancing.
- **Token & ecosystem:** SRK utility surface (what it does, balance, how to earn/use) — scoped as **non-essential to vault function.**

### Differentiating features to emphasize (our wedge, made concrete)
- **Conversational mandate onboarding** (vs. a slider) — scenario-based risk capture → a personalized, adjustable mandate.
- **Advisor-grade explainability** — reasoning narrative + sourced data citations on every suggestion.
- **Legible guardrails** — a Trust Center + per-action guardrail checklist that makes "the AI can't drain you" *visible*.
- **Outcome accountability** — an honest log of wins *and* losses, tied back to the recommendation that produced them.
- **Honest-yield display** — net-of-everything APY, no token-incentive theater.

### Surface / screen inventory (condensed — full set drives the design stage)
The design stage should produce mockups for these surfaces at **desktop + mobile** breakpoints. (A 55-item screen-and-state inventory exists in the UX research file for the design stage to expand from.)

- **Global shell:** nav · persistent non-custodial badge · wallet connect (Base) · AI disclaimer strip · light/dark · empty/loading/error states.
- **Onboarding:** welcome + non-custodial promise · connect wallet · experience segmentation · goal selection · timeline · risk scenario cards · risk-profile result (adjustable) · first-recommendation preview · completion.
- **Chat:** empty state w/ suggested prompts · recommendation cards · action cards · portfolio-snapshot card · tip card · outcome card · "thinking"/tool-steps state · citations popover · thumbs feedback · error/retry.
- **Portfolio:** net-worth hero + over-time chart · allocation (asset / strategy / **risk tier**) · risk panel (score, concentration, drift) · positions table w/ inline actions · position detail.
- **Strategy:** ranked recommendations · recommendation detail / "why this?" · compare · filters.
- **Vaults:** vault discovery · vault detail (net APY + breakdown, TVL, risk score + rationale, allocation, audit/curator badges, history, your position) · deposit panel (live shares preview + caps meter) · withdraw panel (by-amount/by-shares) · caps-reached state.
- **Execution & simulation:** simulating · confirmation card (balance-change table, approvals, gas, projected outcome, **guardrail checklist**, simulation-passed banner) · warning state (**sign disabled until acknowledged**) · bundled multi-step preview · signing/pending · success (receipt + explorer link, links back to originating rec) · failure/retry · approval management.
- **Automation / session keys:** enable auto-rebalance (scope/cap/expiry) · active session-key management (view/revoke).
- **Trust & safety:** Trust Center hub · policy-guardrails detail · caps dashboard · multisig kill-switch status · audits & risk ratings.
- **SRK / literacy / outcomes / settings:** SRK utility · financial-literacy hub · outcome log (wins + losses) · settings (risk profile, goals, alerts, wallet, theme) · notifications/alerts.

---

## 4. UX principles & design direction (input for the design stage)

**Design thesis:** *AI proposes — deterministic guardrails + you dispose.* Every AI suggestion passes through **visible** guardrails and is **user-signed** and non-custodial. This must be *felt* in the UI, not buried in a footer. The product borrows the strongest pattern from three genres: conversational copilot (chat-first, structured action cards), robo-advisor (goals-first onboarding, scenario-based risk), and DeFi vault tooling (legible ERC-4626 shares, net APY, per-vault risk transparency).

**Per-flow direction (with benchmarks):**
- **Chat** — render actionable output as **structured cards with ≤2 actions**, never walls of prose; suggested-prompt chips; sourced citations; thumbs feedback; persistent AI disclaimer; visible tool-step reasoning. *(OpenAI Apps SDK guidelines, Cloudscape gen-AI pattern, Hey Anon / Griffain.)*
- **Portfolio** — net-worth hero + over-time chart; allocation by asset/strategy/**risk tier**; a **risk panel** (our differentiator vs. Zerion/DeBank/Zapper's weak PnL/risk); positions with inline actions. *(Zerion, DeBank, Zapper.)*
- **Vaults** — **net-of-fees APY** with breakdown; explicit **shares received/redeemed**; risk score + curator/audit badges; caps meters. *(Morpho/Gauntlet, Yearn, Beefy.)*
- **Onboarding** — robo-advisor flow turned conversational; **risk via scenario cards** ("$1,000 → $800, what do you do?"), not abstract self-rating; adjustable result. *(Wealthfront, Betterment.)*
- **Confirmation/simulation** — Tenderly-style balance-change preview + approvals + gas + projected outcome + **guardrail checklist**; **Sign disabled until alerts acknowledged** (Rabby pattern); session-key/AA screens for capped auto-rebalance.
- **Trust & safety** — persistent non-custodial badge; Trust Center hub (guardrails, caps, **kill-switch status**, audits); outcome log as an accountability surface.

**Design system direction (Next.js + Tailwind + shadcn/ui, desktop + mobile):** dark-first, data-dense-but-clean; single "spark" brand accent for primary CTAs and AI presence; strict semantic colors (green gains/safe, red loss/blocked, amber caution); a consistent 3–5 step **risk palette** reused everywhere; **tabular numerals** for all financials; WCAG AA contrast; map components to shadcn primitives (Card, Badge, Dialog/Drawer, Tabs, Table, Progress, Alert, charts via Recharts). Desktop favors side-by-side chat + portfolio/vault panels; mobile is chat-native single-column scaling up.

---

## 5. High-level execution roadmap

### The delivery pipeline (your stages, with this plan's place)
1. **High-level app plan — this document** ✅ *(scope, features, positioning, competitive strategy).*
2. **Architectural design** — system layers, contracts, agent orchestration, data flows. *(Next stage; inputs listed in §8.)*
3. **Spec plan via GitHub Spec Kit** — formal, executable specs per feature/flow.
4. **High-fidelity design via Claude Design** — the actual production-ready visual prototype (desktop + mobile) from §3–§4.
5. **Core build** — the coded Next.js + shadcn/ui app.

### Map to the 12-week timeline (from the project summary)
| Window | Phase | Focus | Pipeline stage |
|---|---|---|---|
| **W0** (Jun 1–5) | Kickoff | Scope, alignment, project board | ✅ Done / context |
| **W1–2** (Jun 8–19) | **Live Wireframe & UI/UX Finalization** ← *we are here* | Final UI/UX design, all flows, mockups only | **②→③→④** (this plan feeds them) |
| W3–6 (Jun 22–Jul 17) | Core Development | Infra, contracts, assistant MVP, AA stack, Aave/Aerodrome, vault, testnet | ⑤ |
| W7 (Jul 20–24) | Internal Testing | Full-flow test, feedback, fixes | ⑤ |
| W8–9 (Jul 27–Aug 7) | Final Iteration | Refine, optimize, pre-launch prep | ⑤ |
| W10–11 (Aug 10–21) | Pre-Launch | Mainnet deploy, security hardening, closed alpha | ⑤ |
| W12 (Aug 24–Sep 4) | **Production Launch** | Public beta, onboarding, continuous-improvement pipeline | ⑤ |

### What "done" looks like for the current milestone (W1–2)
A **complete, finalized picture of the app** ready for high-fidelity design: this plan approved → architecture designed → specs written (Spec Kit) → Claude Design produces the clickable, production-ready prototype (desktop + mobile) covering all six core flows + supporting surfaces. **This is the critical design-feedback window** — per the summary, major change requests after this point significantly impact the build schedule.

### Workstreams owned elsewhere (out of scope for this plan, per summary)
External security audit & pen-testing, legal review (ToS, risk disclosures, geo rules), and marketing/growth are owned by SparkPoint's internal teams. Multi-strategy vaults, ZK trade proofs, SRK v2 governance, KYC/compliance gating, stocks/TradFi, and a general financial assistant are **deferred to the post-launch roadmap.**

---

## 6. Risks & mitigations (product/market — high level)

| Risk | Why it matters here | Mitigation baked into the product |
|---|---|---|
| **"AI hedge fund" hype association** | We lead with the bold claim into a damaged narrative | Over-index on proof: onchain-verifiable results, 0-fee launch, never lead with return projections, honest-autonomy copy |
| **Fake-autonomy perception** | Most "AI agents" weren't really autonomous; users are skeptical | State exactly what the AI decides vs. deterministic policy; show tool-steps and the guardrail checklist |
| **Token-first backlash** | ai16z/Almanak/etc. show token-first + AI hype = collapse + litigation | Scope **SRK as non-essential** to vault function; vault usable without it |
| **Yield theater** | Giza's subsidized APY → post-airdrop TVL flight | Show honest net-of-everything APY; no token-incentive yield |
| **Peak-vs-live TVL inflation** | Almanak's $132M "peak" vs ~$502K live is the trap | Only ever cite current, DefiLlama-verifiable figures |
| **Security surface (AA + policy + vault + oracle)** | AI-driven exploits surging; Ribbon DOV exploited via oracle | Keep the stack auditable & simple; deterministic guardrails; caps; kill-switch; pre-trade simulation; external audit (internal team) |
| **UX feel decides adoption** | Neur beat Griffain on feel, not power | Invest design-stage effort in onboarding speed and conversational polish |

---

## 7. Recommendations & open decisions to settle before architecture (stage ②)

**Recommendations**
- **Lead bold, prove relentlessly.** Keep "The First AI-Native Onchain Hedge Fund" as the headline; make onchain-verifiable transparency the product's spine so the claim is credible.
- **Make onboarding the wedge.** Invest disproportionately in conversational goal/risk capture → personalized mandate — it's the clearest white space.
- **Ship the guardrail layer as a visible trust product**, not just plumbing.
- **Two modes, one relationship:** chat advisor (engaged) + hands-off ERC-4626 vault (passive).
- **Depth over breadth:** be the best, safest assistant for **Base** DeFi — don't chase multi-chain at launch.

**Open decisions for the architecture stage to resolve** (flagging, not deciding here):
1. **SRK scope & timing** — confirm it stays out of the launch critical path (access/incentives only, no gating of core vault).
2. **Autonomy level at launch** — per-action signed opt-in only, or also offer scoped session-key auto-rebalance in the first beta?
3. **Auto-rebalance protocol set** — Aave-only at launch (per summary) vs. adding Moonwell/Morpho/Fluid for competitive parity with Giza/Fungi.
4. **Outcome-logging data model** — what's captured per recommendation to make PnL attribution onchain-reconstructable.
5. **Geo-fencing & beta-gating rules** — inputs needed from the legal workstream before the AA/policy design.
6. **AA fallback** — the summary already names a battle-tested AA SDK (ZeroDev/Kernel) fallback if the custom stack slips; confirm the trigger/checkpoint.

---

## 8. Next steps / handoff to the architecture stage

This plan is the input to **stage ② (architectural design)**. To proceed, the architecture stage needs:
1. **Sign-off** on the feature map (§3) and positioning (§1–§2) — this is the scope contract.
2. **Resolution** of the six open decisions (§7).
3. The two **research files** (Appendix) for deeper competitor/UX detail.

The architecture stage then defines the four-layer system (frontend · AI orchestration · onchain execution · data), after which Spec Kit formalizes specs and Claude Design produces the high-fidelity prototype.

---

## Verification — how to validate this plan

This is a planning/strategy deliverable, so "verification" is stakeholder alignment, not code execution:
1. **Scope-fidelity check:** confirm §3's feature map covers every item in the project summary's "Included at Launch" list (it does — assistant, onboarding, portfolio reader, strategy recommender, AA, opt-in execution, Aave v3, Aerodrome, Aave Yield Vault, literacy tips, outcome logging, beta gating) and excludes the deferred items.
2. **Positioning check:** confirm the bold "AI Hedge Fund" headline + the four credibility clauses (§1) match stakeholder intent.
3. **Competitive check:** confirm the differentiation wedge (§2) is defensible vs. Brahma (architecture), Giza (yield), and Axal (onboarding) — the three closest threats.
4. **Decision check:** ensure the six open decisions (§7) are routed to the architecture stage, not left implicit.
5. **Approval gate:** once approved, hand off to stage ② (architecture) → Spec Kit → Claude Design, per §5.

---

## Appendix — research files (saved alongside this plan)

Full sourced reports (with comparison tables and inline URLs) produced for this plan:
- **Direct competitors (AI DeFi assistants & yield agents):** `right-now-we-have-swift-volcano-agent-a979d869a48fc91c6.md`
- **UI/UX benchmarks & 55-item screen inventory:** `right-now-we-have-swift-volcano-agent-a262f8ce54ea59f87.md`
- **AI fund-manager category & credibility playbook:** *(see the inline category report in the session transcript — Almanak, Numerai, Morpho curators, daos.fun/ai16z analysis)*

Located in `/path/to/.claude/plans/`.
