# 09 — Benchmark & Reference Library

> **Audience:** Claude Design (high-fidelity screen production), plus reviewers of the W1–2 design milestone.
> **What this doc is:** A curated, grouped catalogue of the external products, patterns, and source material the rest of the handover cites — each entry with a one-line **"what to borrow"** so the designer knows precisely *why* the link is here and what pattern to extract. This is a working bibliography, not a flow spec.
> **What this doc is NOT:** flow specs, component anatomy, or visual tokens. Those live in `00`–`08`. This doc backs them with sources.
> **Read first:** `00-brief.md` (positioning, five non-custody guarantees, tone). The named benchmarks below are referenced throughout `01`–`08`; this file consolidates them in one place.
> **Sourced from:** the two W1–2 research reports — *Live Wireframe & UI/UX Research Report* and *Competitive Research: AI DeFi Personal Assistants & Autonomous Yield Agents (2025–2026)*. Links are verbatim from those reports.

---

## How to use this file

- **Borrow patterns, not pixels.** Every "what to borrow" names a *specific interaction or layout idea*, not a whole product. Lift the pattern, re-skin it to our dark-first spark aesthetic (`04-design-system`).
- **Two kinds of reference here:** (A) **UX/pattern benchmarks** — what good looks like, to emulate; (B) **competitor intel** — what the market already ships and where the white space is, to *differentiate against* (don't copy these; out-position them). Section 8 is competitor intel; sections 1–7 are pattern benchmarks.
- **When a flow doc names a benchmark** (e.g. "Rabby's sign-disabled-until-acknowledged"), the canonical link lives here.
- **Priority tags:** ★★★ = primary template, study closely; ★★ = strong secondary; ★ = supporting/context.

---

## 1. Chat assistant / conversational copilot

The primary surface. Borrow the *structured-card-not-prose* discipline and the explicit confirm-before-execute gate.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **OpenAI Apps SDK — UI guidelines** | The canonical rulebook for chat-embedded actions: **inline cards as default, max 2 actions per card** (one primary + one optional secondary, at card bottom), no nested nav/tabs inside cards, fullscreen only when irreducible, and **every data-changing action shows an inline confirm dialog with inputs+outputs and an explicit Confirm; read-only renders without confirmation.** This is the spine of our `RecommendationCard` / `ActionCard` / `ConfirmationCard` system. | ★★★ | https://developers.openai.com/apps-sdk/concepts/ui-guidelines |
| **Cloudscape — generative-AI chat pattern** | Production message-structure rules: distinct user/AI bubbles with avatars, stacked bubbles for long content, **selectable suggested-prompt chips**, **inline citations [1][2][3] with source popovers + expandable Sources list**, explicit loading states, error alert + "try again", **thumbs up/down feedback** (disable opposite after submit), and persistent **AI disclaimer**. | ★★★ | https://cloudscape.design/patterns/genai/generative-AI-chat/ |
| **Hey Anon** | "DeFi by conversation" — natural-language multi-step ops (swap/stake/lend) rendered as confirmable actions; the conversational-command model we adopt for chat-first DeFi. | ★★ | https://iq.wiki/wiki/hey-anon · https://bitkan.com/learn/what-is-hey-anon-can-ai-really-simplify-defi-56954 |
| **Bankr / Griffain (via DeFAI overview)** | The chat-command-with-confirmable-action pattern (Bankr); the "personal agent with persistent memory + user-customizable instructions" terminal model (Griffain). Note: Bankr's agent-generated wallet is the **anti-pattern** we reject — borrow the chat ergonomics, not the custody model. | ★ | https://www.chaincatcher.com/en/article/2161633 |

**Net takeaway for the designer:** render every actionable AI output as a typed structured card with ≤2 actions; never bury an action in prose; gate all state changes behind an inline confirm.

---

## 2. Portfolio dashboard (PnL, risk, allocation)

Borrow data-dense-but-clean dashboards and **inline row actions** — then beat them on the one thing they all lack: an explicit **risk panel**.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **DeBank** | At-a-glance net worth + token/staked/LP/lending balances + unclaimed rewards without overwhelming a new user. Borrow the restraint; note the weakness (thin on risk granularity) is *our* opening. | ★★ | https://medium.com/@datos_finance/debank-zapper-zerion-or-something-else-a-review-of-portfolio-tracking-in-defi-ea7bff622fef |
| **Zerion** | Per-protocol position pages with **performance attribution** (how each position contributes to returns). Caveat to heed: criticized for clutter ("tries to do too much") and shaky PnL — so keep our PnL definitions explicit and tooltip'd, and use progressive disclosure. | ★★ | https://zerion.io/api · https://medium.com/@datos_finance/debank-zapper-zerion-or-something-else-a-review-of-portfolio-tracking-in-defi-ea7bff622fef |
| **Zapper** | "Command center for action" — dashboard rows carry **inline actions** (manage/withdraw/rebalance/"Zap"), not read-only display. We adopt inline Add / Withdraw / Ask-AI per position row. | ★★ | https://deficoininvesting.com/best-crypto-portfolio-trackers-for-defi-investors-zapper-debank-zerion/ |
| **Tracker comparison (Zapper/DeBank/Zerion)** | Confirms the shared gap across all three: weak PnL, **no risk identification, no time-based alerting** — the explicit risk visualization + drift/outcome alerts are our differentiator. | ★ | https://deficoininvesting.com/best-crypto-portfolio-trackers-for-defi-investors-zapper-debank-zerion/ |

**Net takeaway:** clone the legible net-worth hero + positions table + inline actions; *add* a first-class risk panel (score, concentration, drift vs target) none of them have. Tabular numerals, right-aligned numbers.

---

## 3. Yield vaults (ERC-4626, net APY, caps)

Borrow legible share accounting, **net-of-fees APY with an expandable breakdown**, and curator/risk transparency.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **Morpho — vaults docs** | Make ERC-4626 legible: deposit USDC at share price → receive shares; share price rises as the vault earns; redeem for more underlying. **Always show shares received/redeemed.** | ★★★ | https://docs.morpho.org/build/earn/get-started |
| **Beefy — vault docs** | APY display convention: a **predicted annual rate including compounding AND all vault fees** — i.e. net APY, clearly labeled, expandable to base yield / rewards / fees / compounding effect. | ★★ | https://docs.beefy.finance/beefy-products/vaults |
| **Yearn (via aggregator review)** | APY shown **net of fees** based on recent strategy performance — reinforces the "net APY, label it, let users expand it" rule. | ★★ | https://trustscoresorg.medium.com/best-yield-aggregators-right-now-yearn-beefy-autofarm-co-bb3ae47d9d10 |
| **Gauntlet app** | Vault transparency template: surfaces APY (current+historical), TVL, utilization, **allocation breakdown across underlying markets**, curator identity, and "collateral at risk." The "where your deposit actually goes" panel. | ★★★ | https://www.gauntlet.xyz/resources/introducing-the-gauntlet-app |
| **ERC-4626 / DeFi vaults primer** | Background on the receipt-token / proportional-ownership model so the share-preview microcopy is accurate. | ★ | https://defiprime.com/defi-vaults-guide |
| **RockawayX vaults guide (2026)** | Curator-posture spectrum (conservative blue-chip → aggressive) and how vault risk is communicated; informs our curator/risk badges. | ★ | https://www.rockawayx.com/insights/defi-vaults-explained-2026-guide |
| **Chorus One — DeFi curators 2025** | How curators are framed/scored; context for the curator-identity badge on the vault detail. | ★ | https://chorus.one/reports-research/defi-curators-in-2025-navigating-chaos-building-resilience |
| **PolicyLayer — DeFi risk score** | The four risk dimensions to score and surface: smart-contract security (audits/formal-verif/bug-bounty), centralization (admin keys/upgradeability), market risk (liquidity/oracle), operational risk (team/governance). Drives the vault risk-score + rationale. | ★★ | https://policylayer.com/glossary/defi-risk-score |

**Net takeaway:** net APY big + expandable; shares always shown; risk score with a four-dimension rationale; allocation-breakdown panel; per-user + protocol caps meter in the deposit panel (ties to `05`/`06`).

---

## 4. Onboarding / robo-advisor (goals + conversational risk profiling)

Borrow goals-first, conversational, reassuring onboarding and **scenario-based** (not self-rated) risk capture — delivered through chat.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **Wealthfront — onboarding teardown** | Deliberately conversational/human sign-up to defuse fear; segment by experience → **limited set of common goals** (avoids choice paralysis) → real-time projection that updates as inputs change → **personalized risk result with an adjustable tolerance slider + "why this risk score?" inline FAQ.** Our onboarding's structural model. | ★★★ | https://goodux.appcues.com/blog/wealthfront-personalized-ux-copy |
| **Wealthfront iOS onboarding (Mobbin)** | Visual reference for the *mobile* onboarding flow — screen-by-screen pacing, progress, chip/slider treatment. Use for mobile layout parity (desktop+mobile are equal priority). | ★★★ | https://mobbin.com/explore/flows/93880b1f-d03d-4068-be45-d6bd1f29e23d |
| **Betterment (vs Wealthfront)** | Goals-based dashboard showing each goal **vs its target** ("on/off track") — feeds our "drift vs your target risk profile" language in the portfolio risk panel. | ★★ | https://fintechpick.com/betterment-vs-wealthfront/ |
| **Robo-advisor UI best practice** | Capture goals + timeline + risk via **behavioral/scenario questions** ("how would you react to a 20% drop?") rather than abstract self-ratings; visual cues, tooltips, progress, reassurance. | ★★ | https://www.linkedin.com/advice/0/how-can-you-design-user-friendly-robo-advisor |
| **Risk-profiling research** | Evidence base for scenario-style risk questions over self-assessment — backs the scenario-card mechanic. | ★ | https://www.researchgate.net/publication/385247174_Risk_profiling_question_investigation_for_robo-advisor |
| **Fintech literacy in onboarding (SmartDev)** | Just-in-time education embedded during setup (Acorns-style); informs the contextual `TipCard` mechanic. | ★ | https://www.smartdev.com/using-fintech-apps-to-promote-financial-literacy/ |
| **Mobile onboarding examples (Userpilot)** | Progress bars + celebratory + empathetic microcopy patterns for the onboarding-complete/celebration screen. | ★ | https://userpilot.com/blog/mobile-onboarding-examples/ |

**Net takeaway:** turn each robo-advisor step into one or two chat turns answered via inline chips/sliders; risk via scenario cards → tier; result card with an override slider + "why this profile?"; persistent "you can change this later / we never take custody."

---

## 5. Simulation & execution confirmation (the trust gate)

Borrow Tenderly's pre-sign asset-change preview and Rabby's **sign-disabled-until-acknowledged** friction. This is where non-custody becomes felt.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **Tenderly — Transaction Preview / Simulation** | Pre-sign dry-run UI: **asset & balance changes (in/out) converted to USD**, accurate gas estimate, **will-it-revert with human-readable error**, approval footprint, decoded events. Two-panel layout (asset changes left, technical right). Model for our `ConfirmationCard` balance-change table. | ★★★ | https://docs.tenderly.co/simulations/transaction-preview |
| **Tenderly × Rabby integration guide** | How a wallet wires simulation preview into the sign flow + **bundled simulations** validating each step of a compound action (approve→swap→deposit). Drives our multi-step bundled preview. | ★★ | https://docs.tenderly.co/simulations/guides/how-to-add-transaction-preview-to-a-rabby-wallet-using-tenderly-simulation-api |
| **Rabby — "process the alert before signing"** | The keystone friction pattern: **when a risk is detected the Sign button is disabled until the user explicitly acknowledges/ignores the alert.** Friction-as-safety, scoped to risk. Adopt verbatim as our acknowledge-before-sign gate. | ★★★ | https://support.rabby.io/hc/en-us/articles/11495471837071-What-does-Please-process-the-alert-before-signing-mean |
| **Rabby — review** | The broader pre-sign safety model: simulate-before-sign, flag risky/unlimited approvals, batch revoke, scam-tx/address-poisoning labels, site-credibility insight. Informs our approvals section + risk banner. | ★★ | https://cryptoslate.com/crypto-wallets/rabby-wallet-review/ |
| **ERC-4337 session keys & risk limits** | Time- and scope-limited signing keys with on-chain spending caps/time-locks — the mechanism behind opt-in auto-rebalance. Surface scope/cap/expiry as user-facing controls. | ★★ | https://technorely.com/insights/recurring-payments-in-web-3-via-account-abstraction-erc-4337-session-keys-paymasters-risk-limits-and-refunds-on-polygon-zk-evm |
| **Turnkey — 4337 → 7702** | Background on AA / EIP-7702 smart-account capabilities (batch approve+execute, contract-enforced limits) underpinning the automation grant. | ★ | https://www.turnkey.com/blog/account-abstraction-erc-4337-eip-7702 |
| **Blofin — account abstraction explainer** | Plain-language AA/smart-wallet primer for accurate session-key scope microcopy. | ★ | https://blofin.com/en/academy/education/account-abstraction-smart-wallets |

**Net takeaway:** simulation-backed confirmation before every signature — balance-change table + approvals + gas + projected outcome + **our guardrail checklist** (within caps / slippage ok / policy approved) + simulation banner; **Sign disabled until alerts acknowledged**; states: simulating / passed / warning / blocked / signing / success(+explorer link) / failure.

---

## 6. Trust & self-custody framing

Borrow the "you don't have to trust us" framing and contract-enforced, **user-facing** guardrails — then make them *legible as a product*, which competitors do not.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **Ledger — custodial vs non-custodial** | The plain-language self-custody narrative ("only you hold the keys; no third party can move funds") and smart-wallet safety features (spend limits, whitelists, recovery). Source vocabulary for the non-custodial badge + Trust Center. | ★★ | https://www.ledger.com/academy/topics/security/custodial-vs-non-custodial-wallets |
| **Trust Wallet — non-custodial glossary** | Clean, consumer-grade definition framing for the "what non-custodial means for you" explainer copy. | ★ | https://trustwallet.com/glossary/non-custodial-wallet |
| **opendue — user trust via non-custodial wallets** | How to *communicate* (not assume) transparency/audit trust signals; informs the "provable, not promised" treatment in the Trust Center. | ★ | https://www.opendue.com/blog/enhancing-user-trust-with-secure-and-non-custodial-wallets |
| **Rabby — review (again, for guardrails-as-confidence)** | Re-used here for the "visible guardrails build confidence" thesis: risk scanning, disabled sign, whitelist, batch revoke shown *as protection*, not nuisance. | ★ | https://cryptoslate.com/crypto-wallets/rabby-wallet-review/ |

**Net takeaway:** persistent non-custodial badge → "prove-it" panel; Trust Center surfacing the five guarantees, caps dashboard, pause-only kill-switch status, audits; **two truthful columns (CAN do / CANNOT do)**; status not slogans. (Full spec: `05-trust-and-safety-ux`.)

---

## 7. Design systems & aesthetic (Tailwind + shadcn/ui)

Borrow dark-first, data-dense-but-clean fintech/crypto patterns and ready-made shadcn scaffolding.

| Ref | What to borrow | Priority | Link |
|---|---|---|---|
| **shadcn-fintech template** | Working Next.js + shadcn/ui + Tailwind fintech dashboard: cards, live tickers, dark mode, layout density. Closest pre-built scaffold to our portfolio/vault surfaces. | ★★★ | https://github.com/abderrahimghazali/shadcn-fintech |
| **allshadcn — fintech template** | Additional shadcn fintech dashboard reference for card grids, charts, and dense-data layout in dark mode. | ★★ | https://allshadcn.com/templates/shadcn-fintech/ |
| **awesome-shadcn-ui** | Index of shadcn components/blocks (charts, tables, data viz) to map our app components onto primitives without reinventing them. | ★★ | https://github.com/birobirobiro/awesome-shadcn-ui |
| **Fintech website design roundup** | Aesthetic direction: dark-first, whitespace + clear typography, dense data without overwhelm. Mood/tone reference for the spark accent + semantic palette. | ★ | https://www.ballistic.media/blog/fintech-website-designs |

**Net takeaway:** map every app component to a shadcn primitive (Card/Badge/Button/Dialog/Drawer/Tabs/Table/Progress/Tooltip/Alert/Slider/Accordion/Chart); dark-first with light variant via CSS variables; single spark accent reserved for primary CTAs + AI presence; strict semantic + 3–5-step risk palette; tabular numerals; WCAG AA. (Full spec: `04-design-system`.)

---

## 8. Competitor intel (out-position, don't copy)

These are the **direct competitors** from the competitive research. Study them for table-stakes parity and to sharpen differentiation — they are *not* patterns to emulate. Our wedge: conversational goal/risk onboarding, advisor-grade explainable reasoning, a *legible* guardrail/sign-off trust layer, and honest non-subsidized yield.

| Competitor | Why it's on the list | What to do about it | Link |
|---|---|---|---|
| **Giza / ARMA** | Most direct competitor; autonomous USDC yield rebalancer on Base. Headline ~15% APY is **token-subsidized** and live **TVL collapsed (~$14k) post-airdrop.** | Out-position with **honest, non-subsidized net APY + transparent risk**; no token-incentive theater. | https://defillama.com/protocol/giza |
| **Brahma (ConsoleKit / Morpho Agent)** | Closest architectural analog — already ships **non-custodial + policy-guardrail + Safe-account.** The guardrail architecture alone is not a moat. | Differentiate on **chat-first advisor UX, goals/risk onboarding, "AI-as-fund-manager" framing**, and making the guardrail layer *legible* to end users. | https://brahma.fi/blog/introducing-the-morpho-agent-built-on-consolekit |
| **Fungi** | Direct, non-custodial, Base, **same protocols as us** (Aave/Morpho/Fluid/Moonwell), autonomous (not chat). | Win on the conversational, explainable, opt-in-signed relationship vs. fire-and-forget. | https://fungi.ag/ |
| **Axal (Autopilot)** | Risk-tolerance-driven onboarding analog (sets a risk slider + restrictions); verifiable execution. | Go deeper: a genuine **"interview → personalized mandate → explainable plan,"** not just a slider. | https://blockworks.co/news/axal-automating-trading-ai-agents |
| **Bankr** | Chat-first/social trading agent — but **agent-generated wallet (custodial-ish).** | Borrow chat ergonomics; reject the custody model — **lead with true self-custody.** | https://bankr.bot/ |

**Net takeaway for design:** the white space is a **chat-first, advisor-grade, visibly-guardrailed, honestly-yielding** product. Every screen should make the four differentiators *felt*: it learns your goals, explains every move, proves every result, never touches your keys.

---

## 9. Quick index (by source report)

**Live Wireframe & UI/UX Research Report** → sections 1–7 above (all pattern benchmarks).
**Competitive Research (AI DeFi Assistants & Yield Agents, 2025–2026)** → section 8 above (competitor intel) + the differentiation/positioning context in `00-brief.md`.

For full source lists (including secondary links not promoted here), see the two reports referenced in the header.
