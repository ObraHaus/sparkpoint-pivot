# 06 — Component Library (the custom components Claude Design must define)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative inventory of **SparkPoint's custom components** — the named, reusable building blocks every flow composes. This doc gives each component its **anatomy**, **variants**, **states**, the **shadcn/ui primitive(s) it builds on**, **non-custody/trust role**, and **acceptance criteria**. It is the bridge between the design system (`04`) and the per-flow screen specs (`02-flows/*`).
> **Reads-before (authoritative, in order):**
> - `00-brief.md` — positioning, thesis, the five non-custody guarantees, non-goals.
> - `04-design-system.md` — **tokens, the three orthogonal color systems (brand/outcome/risk), spark = AI presence, semantic green/red/amber, risk palette §2.5, tabular numerals §3.1/§3.4, mono §3.1, data-viz §6, motion §7, iconography §8, a11y §10, and the component→shadcn map §11.** Every visual decision here defers to `04`.
> - `05-trust-and-safety-ux.md` — the trust components' authoritative behavior/copy (badge, prove-it panel, caps, kill-switch, acknowledge-before-sign, outcome log, "AI suggestion — you approve & sign" label).
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** All strings shown here are illustrative; `07` is the source of truth for microcopy.
> - `01-information-architecture.md` — §2 the persistent shell (where AppShell/Nav, NonCustodialBadge, WalletConnectButton, AI disclaimer live), routes, the single-confirm-funnel rule.
> - `02-flows/*` — every component's in-context usage, props, and per-flow states.
> - `09-references.md` — the named UX benchmarks each component honors.
>
> **What this doc IS:** the component catalog — anatomy, variants, states, shadcn base, trust role, acceptance per component. **What it is NOT:** design tokens (`04`), canonical copy (`07`), flow/screen sequences (`02-flows`), or the route map/shell IA (`01`). It does not re-define shadcn primitives themselves; it defines the *SparkPoint compositions* on top of them.

---

## 0. How to use this catalog

1. **Compose, don't reinvent.** Every component here is a composition of shadcn/ui primitives (+ Recharts/Lucide). The "Builds on" line names the base primitive(s); the build wires the tokens once (`04` §2.1) and these components reference semantic tokens only — never raw hex.
2. **One color system per element (`04` §1).** Before coloring any sub-part, ask "brand, outcome, or risk?" — spark = AI presence/primary CTA; semantic green/red/amber = outcome/safety; risk palette (teal→magenta) = risk *tier*. Never cross-contaminate.
3. **States are mandatory, not optional.** Where a component can load, be empty, succeed, warn, or error, **all applicable states are designed** (`04` AC#9; brief §4). Each component below lists the states it must ship.
4. **Both breakpoints, always.** Each component is designed at the **1440px desktop** and **390px mobile** canvases, with the Dialog→Drawer/Sheet transform (`04` §4.2) where it overlays.
5. **Tabular + non-color + keyboard by construction.** All financial figures use `.tnum` (`04` §3.4); every semantic/risk signal pairs color with icon + text/number (`04` §10.2); every interactive part has a visible 2px spark focus ring and is keyboard-operable (`04` §10.3/§10.4).
6. **Verbatim trust strings.** "AI suggestion — you approve & sign", "Estimates, not guarantees.", "Nothing moves until you sign. You can cancel now with no effect.", "Simulation passed — no risks detected", net-APY-with-breakdown, and the custody/exit clauses are reused **verbatim** from `07` — never paraphrased to save space.

**Component count: 25** custom components (the required set), grouped below as: **Shell & Trust (1–11)**, **Chat & Cards (12–18 incl. the card family)**, **Finance & Data-Viz (19–24)**, and **Primitives-of-state (25 + the AlertBanner)**. Each is independently reusable.

**Index**

| # | Component | Builds on (shadcn) | Primary surfaces |
|---|---|---|---|
| 1 | **AppShell / Nav** | layout + `NavigationMenu`/custom rail + `Tooltip` + `Command` + `Sheet` | every `(app)` route |
| 2 | **NonCustodialBadge** | `Badge` + dot + `HoverCard` → `Sheet` | shell (all routes) |
| 3 | **ProveItPanel** | `Sheet` + `Card` + `Accordion` + `Badge` + `Button` | badge / disclaimer / ⌘K |
| 4 | **WalletConnectButton** | `Button` → `Dialog` (connectors) / `DropdownMenu` (connected) + `Badge` | shell |
| 5 | **ChatComposer** | `Textarea` + `Button size=icon` | chat |
| 6 | **ChatMessage** | `Card`/bubble + spark `Avatar` + `Toggle` | chat |
| 7 | **RecommendationCard** | `Card` + `Badge` + `Accordion`/`Popover` + `Button` ×2 | chat, strategies |
| 8 | **ActionCard** | `Card` + `Badge` + `Input` + `Progress` + `Button` ×2 | chat |
| 9 | **ConfirmationCard** | `Card`/`Dialog`/`Sheet` + `Table` + `Alert` + `Checkbox` + `Button` | confirm, chat |
| 10 | **PortfolioSnapshotCard** | `Card` + Recharts `PieChart` + `Badge` + `Button` ×2 | chat |
| 11 | **TipCard** | `Card`/`HoverCard`/`Popover` + `Button ghost` | everywhere (literacy) |
| 12 | **OutcomeCard** | `Card` + `Badge` + `Button` ×2 | chat, activity |
| 13 | **GuardrailChecklist** | list rows + Lucide icons + `Tooltip` + `Checkbox` | confirm, strategies |
| 14 | **CapsMeter** | styled `Progress` + `Tooltip` | vault, trust, automation |
| 15 | **RiskChip / RiskTierBar** | `Badge` (risk variant) + custom segmented bar | everywhere risk appears |
| 16 | **NetApyBreakdown** | text + `Accordion`/`Popover`/`HoverCard` | vault, strategies, cards |
| 17 | **SharesPreview** | `Card`/rows (`.tnum`) | vault deposit/withdraw, confirm |
| 18 | **SessionKeyScopeCard** | `Card` + `Badge` chips + `Progress` + countdown + `Button` | automation |
| 19 | **KillSwitchStatus** | `Card` + `Badge` (pill) + `Accordion` + `Alert` + `Button` | trust, vault |
| 20 | **AllocationDonut** | `Card` + Recharts `PieChart` (donut) + `Legend` + `Tabs` | portfolio, vault, chat |
| 21 | **NetWorthChart** | `Card` + Recharts `AreaChart` + `Tabs`/`ToggleGroup` | portfolio, chat |
| 22 | **PositionRow** | `Table` row (desktop) / `Card` (mobile) + `Badge` + `Button`/`DropdownMenu` | portfolio |
| 23 | **SimulationBalanceChangeTable** | `Table` (`.tnum`, semantic +/−) | confirm, chat |
| 24 | **EmptyState** | `Card` + Lucide icon + `Button` | every surface |
| 25 | **AlertBanner** | `Alert` (success/warning/destructive/info) + Lucide icon + optional `Checkbox`/`Button` | everywhere |

> Two extra cross-cutting micro-components are specified inline where they belong (they are reused, not standalone screens): the **AiSuggestionBadge** (the verbatim "AI suggestion — you approve & sign" chip, `05` §5.2 — defined in §7/§9) and the **CitationChip** (sourced-number affordance, `02` §9 — defined in §6). Treat both as shared atoms.

---

# Group A — Shell & Trust

## 1. AppShell / Nav

**Purpose.** The persistent authenticated chrome that wraps every `(app)` route (`01` §2). It owns the three global non-custody affordances (NonCustodialBadge, WalletConnectButton, AI disclaimer strip), navigation, command menu, and notifications. It is **not** redefined per flow — flows render into its content slot.

**Builds on.** Next.js `layout.tsx` + a custom nav rail/top bar + `Tooltip` (rail icons) + `Command` (cmdk, ⌘K) + `Sheet` (mobile nav / notifications) + `DropdownMenu` (avatar) + the `Sonner` toaster mount.

**Anatomy.**
- **Top bar** (left→right): spark **AppLogo** (mark = brand + AI identity, `04` §9); **primary nav** (Chat · Portfolio · Vault · Strategies) as horizontal items (desktop); right cluster = **NonCustodialBadge** (§2) → **WalletConnectButton** (§4, with Base network pill) → ⌘K trigger → notifications bell (count `Badge`) → avatar `DropdownMenu`.
- **AI disclaimer strip** (full-width, directly under top bar): pinned `Alert` (info) with verbatim copy "AI suggestion — you approve & sign. SparkPoint never holds your funds." + inline links **[Prove it]** (→ ProveItPanel) and **[Exit anytime]** (→ `/trust/exit`). `Collapsible` to a thin line on scroll; **never fully removable** (`07` §3.4).
- **Secondary nav** (desktop left rail, collapsible): Trust Center · Automation · Outcome Log · Learn · SRK · Settings — icons + labels, `Tooltip` on collapse. **Withdraw / Exit** and **Prove-it** pinned.
- **Mobile:** condensed top bar (logo + badge + wallet + bell) + **bottom tab bar** (Chat · Portfolio · Vault · Strategies, Chat center-weighted) + a **More drawer** (`Sheet`) for secondary nav with **Withdraw / Exit pinned top**.
- **Toaster region** (`Sonner`) for tx/sign echoes.

**Variants.**
- **Standard app shell** (full nav) — default for all `(app)` core/supporting routes.
- **Focused shell** (`/confirm`, onboarding) — primary nav suppressed, but **NonCustodialBadge + AI disclaimer strip with [Prove it]/[Exit anytime] remain** (hard IA invariant, `05` §1.1; `01` §2).

**States.**
- **Default** (connected, Base, nominal): all affordances present, badge green.
- **Loading / connection resolving:** badge dot muted-pulse; nav present; route renders its own `loading.tsx`.
- **Degraded mode:** a top-level degraded `AlertBanner` ("Some SparkPoint services are degraded — your custody and exit are unaffected."); badge amber; **[Exit anytime] elevated** (`05` §0.3).
- **Wrong network / disconnected:** WalletConnectButton surfaces the state; badge amber on wrong network; withdraw/prove-it still reachable.
- **Notifications: empty / unread-count / preview** (bell + `Badge`).

**Layout notes.** Desktop = top bar + disclaimer strip + left rail + content (max ~1200–1280px). Mobile = top bar + disclaimer (1-line, chevron) + content + bottom tabs; overlays as `Sheet`.

**Non-custody/trust role.** The shell is the guarantee that **prove-it + withdraw-always are ≤1 tap from every authenticated screen** (`05` §0.2). Owns the persistent badge + disclaimer.

**Acceptance.** Renders on 100% of `(app)` routes incl. focused shells; NonCustodialBadge + [Prove it] + [Exit anytime] reachable in ≤1 tap at both breakpoints; AI disclaimer never fully removable; full keyboard nav (roving focus in rail/tabs, ⌘K opens command, Esc closes overlays); visible spark focus ring on every control.

---

## 2. NonCustodialBadge

**Purpose.** The permanent, glanceable signal that funds are self-custodied and all non-custody invariants are nominal — and the one-tap doorway to proof (`05` §1). *The* persistent trust affordance.

**Builds on.** `Badge` (outline/secondary) with a leading status **dot** + `shield-check` icon (`04` §8) + chevron; desktop hover = `HoverCard`; trigger opens **ProveItPanel** as a `Sheet`.

**Anatomy.** Status dot (live invariant health) · label "Non-custodial" (desktop) / shield glyph only (mobile/condensed) · chevron caret · optional sub-chip ("Paused" / "Auto").

**Variants.** (dot color is load-bearing; **never red** — custody is structural, red would falsely imply funds at risk, `05` §1.3)
- **Nominal** — green dot, "Non-custodial".
- **Automation active** — green dot + small "Auto" chip (hover lists active session keys + [Revoke]).
- **Degraded** — amber dot ("services degraded, exit still works").
- **Kill-switch active (pause-only)** — amber dot + "Paused" sub-label.
- **Wrong network** — amber dot ("not on Base — withdrawals unaffected").
- **Loading** — muted/neutral dot, subtle pulse ("Checking your connection…"); badge stays tappable.

**States.** default/nominal · loading · degraded · paused · automation-active · wrong-network — each with the `05` §1.3 hover/tooltip copy.

**Layout notes.** Top bar right cluster, immediately left of WalletConnectButton (`01` §2.2). Desktop hover → `HoverCard` summarizing the five guarantees + "Tap to see proof". Tap → `Sheet` (right desktop / bottom mobile).

**Non-custody/trust role.** Its persistence *is* the message; its tap-through is the proof. The amber-but-never-red rule encodes "services can degrade, custody cannot."

**Acceptance.** Dot never red; present on 100% of authed routes incl. onboarding + confirm shells; opens ProveItPanel in ≤1 tap; focusable, Enter/Space opens, Esc closes; AA contrast on dot + label; state announced to SR (not color-alone).

---

## 3. ProveItPanel

**Purpose.** In one tap, show **exactly what SparkPoint can and cannot do with the user's funds on-chain right now**, each claim linked to verifiable on-chain evidence, plus the two privileged escape affordances (withdraw-always, revoke-automation). **The single most important trust touchpoint** (`05` §2).

**Builds on.** `Sheet` (right desktop / bottom mobile) + `Card`/rows + `Accordion` (raw-read disclosure) + `Badge` (verified / status) + `Button` (Withdraw / Revoke / See full Trust Center) + `Tooltip`.

**Anatomy.**
- **Header:** "What SparkPoint can — and can't — do with your money." + connected address (truncated) + "on Base" + **"Last verified on-chain: {relative time}"** stamp + refresh affordance.
- **Section A — five guarantees** (each a row with status + evidence link): No admin withdrawal · **Withdraw-always** (primary [Withdraw now] → `/trust/exit`) · You own your keys · Scoped, revocable automation (per-key scope chips + [Revoke]) · Non-upgradeable, pause-only.
- **Section B — two-column CAN / CANNOT matrix.** CAN (green/neutral + check). **CANNOT** (lock icon, **reassuring** neutral/green frame — *not red*; `05` §1.3), with ≥ visual parity to CAN.
- **Footer (pinned):** [Withdraw / Exit] + [See full Trust Center] (→ `/trust`).

**Variants.** Summary `Sheet` (this component) vs the full **`/trust/permissions` page** (contract registry, live permission read, allowance audit, "reproduce yourself" reads) — the Sheet *summarizes*, the page *proves*.

**States.**
- **Default** — full matrix, green checks, "verified just now".
- **Loading** — `Skeleton` rows per guarantee; **Withdraw/Exit + Revoke remain enabled** (never gated on read success).
- **Stale** — amber "Last verified {X} ago — [Refresh]".
- **Read error / RPC down** — warning `AlertBanner`: "We couldn't verify on-chain right now… these limits are enforced by the contracts, not our app. [Retry] · [Verify on explorer]"; **withdraw stays prominent**.
- **Automation present** — Section A automation row expands to per-key SessionKeyScopeCards.
- **Degraded** — banner; escape-hatch CTA elevated; renders no-frontend exit references.

**Non-custody/trust role.** The proof spine — every guarantee row terminates in a verifiable artifact; a row without an evidence link fails review. A failed read **never** hides/disables the escape hatch.

**Acceptance.** All five guarantees with live state + evidence link; CAN/CANNOT parity; Withdraw/Exit + Revoke reachable inside the panel; failed read never hides exit; focus-trapped, Esc closes, keyboard-operable; works in degraded mode.

---

## 4. WalletConnectButton

**Purpose.** Connect a wallet and, once connected, surface address + network (Base) + smart-account state, with the menu path to permissions and disconnect (`01` §2.2). Reinforces user-owned keys.

**Builds on.** `Button` (spark, when disconnected — a sanctioned primary CTA) → `Dialog` (connector list) when connecting; `DropdownMenu` + network `Badge` when connected.

**Anatomy.** Disconnected = spark **"Connect wallet"** `Button` → `Dialog` listing connectors (WalletConnect / Coinbase per stack). Connected = chip showing truncated address `0x12…ab` + **Base network `Badge`** + smart-account indicator; tap → `DropdownMenu`: copy address · view on explorer · switch wallet · disconnect · **"View exact permissions"** (→ `/trust/permissions`).

**Variants.** Disconnected (spark CTA) · Connecting (in-dialog) · Connected (chip + menu) · Wrong-network (amber, "Switch to Base — withdrawals unaffected") · Pending-tx (subtle activity indicator).

**States.** default-disconnected · connecting (connector dialog: idle / awaiting wallet / error-retry) · connected · wrong-network · disconnected-error · resolving (skeleton chip).

**Layout notes.** Top bar right cluster, right of NonCustodialBadge. Mobile: condenses to address+network; menu = `Sheet`/`DropdownMenu`. **No chain switcher beyond Base** (single-chain non-goal) — network `Badge` is informational; wrong-network offers a switch-to-Base action only.

**Non-custody/trust role.** The entry to permissions + disconnect; the network pill states "Base"; "View exact permissions" cross-links the prove-it spine. Never implies SparkPoint holds keys.

**Acceptance.** Truncated address + Base pill + smart-account state visible when connected; menu exposes "View exact permissions" + disconnect; wrong-network reassures withdrawals unaffected; AA contrast; keyboard-operable; connector dialog → `Sheet` on mobile.

---

# Group B — Chat & the Card Family

## 5. ChatComposer

**Purpose.** The persistent chat input — **one per surface**, never duplicated in a side panel (OpenAI Apps SDK; `02` §3).

**Builds on.** Auto-grow `Textarea` + `Button size="icon" variant="default"` (spark send/stop) + optional ghost attach-context affordance + helper/state line.

**Anatomy.** Multi-line auto-grow textarea (1→~5 lines then scroll; placeholder "Ask about your wallet, or tell me your goal…") · spark **send** button (the one spark element here = AI presence + primary action) · optional ghost "attach context" (not a file uploader) · helper line below (`text-xs muted`: char count near cap, else the compact AI-disclaimer link).

**Variants / States.**
- **Empty** — send disabled.
- **Typing/valid** — send enabled (Enter sends, Shift+Enter newline desktop; mobile explicit send).
- **Streaming** — send becomes **Stop** (square icon), halts generation, preserves partial output.
- **Error (send failed)** — **input retained** (never lost), retry affordance.
- **Degraded (AI unavailable)** — composer disabled with canonical reassurance copy ("…You can still view your portfolio and withdraw anytime — your funds never depend on us being online."); withdraw/prove-it reachable via shell.

**Layout notes.** Desktop: bottom of chat column, suggested-prompt chip row above. Mobile: bottom-anchored above the tab bar, floats above keyboard; chips in a horizontal-scroll row above it.

**Non-custody/trust role.** Nothing money-moving executes from the composer; degraded copy reassures funds don't depend on uptime.

**Acceptance.** One per surface; Stop replaces Send while streaming; text never lost on error; degraded disables with reassurance + reachable withdraw; 2px spark focus ring; fully keyboard-completable.

---

## 6. ChatMessage

**Purpose.** Render a user or AI turn in the stream, with AI identity legible by the spark system (`02` §5; `04` §9). Hosts per-turn affordances (thumbs, citations) and any structured card.

**Builds on.** Custom bubble on `Card` + spark `Avatar` (AI) + `Toggle`/`ToggleGroup` (thumbs) + `Popover`/`Sheet` (citation source + thumbs-down follow-up) + `Accordion` (turn-level Sources).

**Anatomy.**
- **AI turn:** spark **Avatar** (`aria-label="SparkPoint AI"`) + faint `--spark-subtle` left border/chip; content = prose and/or a structured card (§7–§12); per-turn affordances = **thumbs up/down** (selecting one disables the opposite), **CitationChip(s)** on cited live numbers, optional copy/regenerate (ghost).
- **User turn:** neutral, right-aligned/distinct bubble; no avatar.
- **Tool-step ticker** (in-progress AI turn): vertical list of present-continuous steps ("Reading your wallet…" → ✓), spark dot pulse + `--spark-glow` halo while active (motion-gated, `04` §7), resolves to `--success` check; collapses to "Showed 4 steps ▾" once answered.

**CitationChip (shared atom).** Small spark-tinted interactive `Badge` attached to a cited value → `Popover` (desktop) / `Sheet` (mobile) "Based on {source}" + value-as-fetched + timestamp + link. Turn-level "Sources" `Accordion` lists all.

**States.** empty (first-open hero greeting) · primed-first-message (post-onboarding) · thinking/tool-step · streaming (token caret) · settled (thumbs + citations + follow-up chips) · warning (acknowledge-required preview banner) · error/retry (inline `AlertBanner` + "Try again", input preserved) · stopped.

**Non-custody/trust role.** AI identity is suggestion, never authority; tool-steps are real (no faked progress); cited numbers always carry a source; custody reassurance on any action-related failure ("Nothing moved — your funds are untouched.").

**Acceptance.** Distinct programmatic user/AI roles; spark avatar labeled; tool-steps `aria-live="polite"` (not per-token); thumbs are labeled toggles; reduced-motion disables pulse/glow/caret; numbers tabular; semantic state always color + icon + text.

---

## 7. RecommendationCard

**Purpose.** A strategy proposal ranked against the user's mandate, with plain-language rationale — the visible "fund manager" intelligence. Read-only to view; its primary action routes to review+sign (`02` §7.1; the full-surface sibling is `StrategyCard`, `04`-strategies).

**Builds on.** `Card` (Header/Content/Footer) + `Badge` (rank, **AiSuggestionBadge**, RiskChip) + `Accordion`/`Popover`/`Sheet` ("Why this?") + NetApyBreakdown + CitationChip + `Button` ×2.

**Anatomy.**
- **Header:** rank `Badge` ("Best fit" / "#1 vs your goal") + **AiSuggestionBadge** = verbatim "AI suggestion — you approve & sign" (spark-tinted, never shortened).
- **Content:** one-line thesis · **NetApyBreakdown** ("{X}% net APY", breakdown ≤1 tap, never bare) · **RiskChip** (n/5 + label) · "Fit to your goal" line · clearly-labeled projected outcome + "Estimates, not guarantees." · **CitationChips** on cited rate/TVL · **"Why this?"** disclosure (rationale, trade-off, guardrail-fit).
- **Footer (≤2):** primary **"Review this move"** (→ `/confirm` via txIntent; never "Accept"/"Do it") + secondary **"Not now"** (never "Reject").

**Variants.** chat inline (~560–620px) · strategies list row (`StrategyCard`) · ranks: Best fit / Good fit / Consider.

**States.** loading (APY/risk skeleton) · default · **warning** (above-plan → caution `AlertBanner`: "Heads up: higher-risk than your plan… you'll be asked to acknowledge before signing") · error (rate unavailable → "Couldn't load the current rate. Try again." retry).

**Non-custody/trust role.** AiSuggestionBadge mandatory; acceptance never one-click (routes to the confirm gate); "Estimates, not guarantees."; rationale exposes which guardrails it satisfies. **Benchmark:** OpenAI Apps SDK (≤2 actions, confirm-gate); robo-advisor "tie to your goal".

**Acceptance.** ≤2 footer actions; AiSuggestionBadge present + verbatim; net APY never bare; risk via RiskChip with n/5+label; primary routes to `/confirm`; all four states designed; both breakpoints.

---

## 8. ActionCard

**Purpose.** A concrete deposit / withdraw / swap **intent** the user expressed or the AI proposes — an *intent preview*, not an execution (`02` §7.2).

**Builds on.** `Card` + `Badge` (action type, AiSuggestionBadge) + `Input` (inline editable amount) + CapsMeter (preview) + NetApyBreakdown + `Button` ×2.

**Anatomy.**
- **Header:** action label ("Deposit" / "Withdraw" / "Swap") + **AiSuggestionBadge** (when AI-proposed).
- **Content:** asset + amount (tabular) · target (allowlisted only — Aave Yield Vault / Aave v3 / Aerodrome) · estimated result ("≈ {shares} spvUSDC" + fiat; or swap output + price impact + max slippage) · NetApyBreakdown (deposit) · **CapsMeter** preview ("Beta cap: ${used} of ${cap}") · inline editable amount (editing routes to the proper flow, not an in-card execute).
- **Footer (≤2):** primary **"Review deposit/withdrawal/this move"** (→ `/confirm`) + secondary **"Edit"** (opens the flow with amount staged).

**Variants.** deposit · withdraw · swap.

**States.** loading · default · **warning** (cap near / above-plan) · **blocked** (cap reached / not-whitelisted / sim would revert → destructive, plain reason "Blocked by your guardrails: this would exceed your beta cap." — **no primary offered**) · error.

**Non-custody/trust role.** Every state-changing action funnels to `/confirm` (single funnel); the **withdraw action is the escape hatch in card form** and must always be reachable; never imply the AI executes.

**Acceptance.** ≤2 actions; routes to `/confirm`, never signs in-card; blocked state offers no sign, only a remedy; withdraw variant always reachable; tabular; both breakpoints.

---

## 9. ConfirmationCard

**Purpose.** The shared **sign gate** anatomy — full route at `/confirm/[txIntentId]` (two-pane desktop / sticky-sign-bar mobile) and its compact **in-chat mirror** (`02` §7.6; Flow 6 is authoritative). Turns an AI-proposed, guardrail-checked tx into an informed, deliberate, user-signed execution — with zero blind signing.

**Builds on.** `Card` (full route) or `Dialog`/`Sheet` (overlay) + AiSuggestionBadge `Alert` + **SimulationBalanceChangeTable** + status `AlertBanner` + approvals (`RadioGroup`/`ToggleGroup` + `Badge`) + bundle `Accordion`/stepper + **GuardrailChecklist** + `Checkbox` (acks) + **CapsMeter** (near-limit) + spark `Sign` `Button` (gated) + `AlertDialog` (final sign, if escalated).

**Anatomy (top→bottom, `07` §2.4).**
1. **AiSuggestionBadge** banner (verbatim).
2. **Headline** — plain: "You're depositing 500 USDC into the Aave Yield Vault and will receive ≈ 498.21 spvUSDC."
3. **SimulationStatusBanner** (`AlertBanner`): green "Simulation passed — no risks detected" / amber caution / red blocked / "Simulating…".
4. **SimulationBalanceChangeTable** (§23).
5. **Approvals** — exact-by-default; "Unlimited" flagged amber + adds an ack.
6. **Bundle** (compound actions) — ordered per-step simulated stepper; one-batched-sig vs enumerated sequential sigs stated up front.
7. **Cost & outcome** — gas (USD + native) · **vault: "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal"** (deposit shows $0.00; withdraw itemizes any accrued profit-only fee) explicit · net · projected $ estimate + "Estimates, not guarantees."
8. **GuardrailChecklist** (§13).
9. **Control reminder** — "Nothing moves until you sign. You can cancel now with no effect."
10. **Footer (≤2):** primary **"Review & sign"** → after acks **"Sign deposit/withdrawal/transaction"** (disabled until all acks checked + sim passed; helper "Acknowledge the {n} item(s) above to enable signing.") + secondary **"Open full confirmation"** (chat mirror) / **"Cancel"** / **"Edit"**.
11. **Power-user "Details"** `Accordion` — raw deltas, decoded events, calldata + contract addresses (mono, copy + explorer).

**Variants.** full route (two-pane: what-happens left / decision rail right) · in-chat mirror (compact, ≤2 actions, "Open full confirmation") · overlay (`Dialog`/`Sheet`).

**States.** Simulating(loading) · Passed(ready) · Warning(acknowledge-before-sign) · **Blocked(no override, remedy only)** · Signing/pending (incl. bundle stepper) · Success/receipt (tx hash + explorer + "From: {rec}" link + "See in portfolio/activity") · Failure/retry · User-rejected ("You cancelled the signature. Nothing moved.") · Simulation-error ("…we won't ask you to sign blind. [Retry]") · Degraded/withdraw-protection · Not-found/expired txIntent · Caps-near-limit · Kill-switch-active(deposit).

**Non-custody/trust role.** **This is the trust gate.** Simulation before every signature; GuardrailChecklist visible; **Sign disabled until acknowledged**; **blocks cannot be overridden**; out-of-policy never offered for signing; cancel always free; **withdraw-always never gated here**; receipt links to the originating rec + Outcome Log. **Benchmarks:** Tenderly (preview) + Rabby (sign-disabled-until-acknowledged).

**Acceptance.** No blind signing (100% simulated); ≤2 actions on the mirror + "Open full confirmation"; friction scales to severity (all-pass = one deliberate sign, no ceremonial acks); blocks offer remedy not override; Sign keyboard-focusable-but-disabled (`aria-disabled` + helper, not color-alone); all states both breakpoints; mono for hashes/calldata.

---

## 10. PortfolioSnapshotCard

**Purpose.** An at-a-glance read of the user's position inline in chat — read-only, no confirm; Portfolio (Flow 3) in miniature (`02` §7.3).

**Builds on.** `Card` + Recharts `PieChart` (mini, via AllocationDonut compact mode) + RiskChip + `Button` ×2.

**Anatomy.** Header "Your portfolio" + "as of {time}" · net worth (tabular, full precision) + PnL with window (sign + color + arrow) · mini allocation (small donut/stacked bar, by asset and/or risk tier) · portfolio RiskChip + drift-vs-plan note ("On plan" / "Slightly above your plan") · vault position (shares + value + accrued yield) · footer (≤2) primary **"Open portfolio"** (→ `/portfolio`) + secondary **"Improve my yield"** (→ Strategies/chips), both navigational, no signing.

**States.** loading · default · **empty** ("Nothing here yet" + "Explore the vault") · error ("Couldn't load your portfolio. Your funds are safe. Retry.").

**Non-custody/trust role.** Read-only, no confirmation needed; honest PnL incl. losses; stale labeled. **Benchmarks:** Zerion/DeBank/Zapper snapshot + a stronger risk read.

**Acceptance.** Read-only (never signs); ≤2 navigational actions; PnL signed/colored/windowed; risk via RiskChip; stale labeled; both breakpoints.

---

## 11. TipCard (financial literacy)

**Purpose.** Contextual, learn-as-you-go education when a term/concept first appears — `--info` blue, **never green** (`02` §7.4; `07` §4; `04` §2.4).

**Builds on.** `Card` (info variant) + `Button variant="ghost"`; or `HoverCard`/`Popover` when triggered from an inline term.

**Anatomy.** Header = the term/question, plain ("What's net APY?" / "What are vault shares?") · content = ≤2 sentences (plain definition → why it matters to you), info icon, blue accent · footer (≤1) "How this works" → `/learn/[slug]`. **Dismissable; never re-nags after dismiss.**

**Variants.** inline card (in a flow/chat) · `HoverCard`/`Popover` (from an inline glossary term) · empty/hub tile (`/learn`).

**States.** default · dismissed (collapses, doesn't reappear for that term). No loading/error (static content).

**Non-custody/trust role.** Education frames *so the user can hold us accountable*, not blind trust; non-condescending (no "simply/just/easy").

**Acceptance.** `--info` tone (never green); ≤2 sentences; dismiss persists; links `/learn/[slug]`; AA contrast; keyboard-dismissable.

---

## 12. OutcomeCard

**Purpose.** Show the realized PnL of a **past acted-on recommendation**, tied to the advice that caused it — the accountability loop, **wins and losses shown symmetrically** (`02` §7.5; `05` §8).

**Builds on.** `Card` + `Badge` (gain/loss semantic) + `Button` ×2 + explorer link.

**Anatomy.** Header "Outcome" + originating recommendation reference + date · realized PnL (signed + colored + arrow + window — a loss reads as plainly as a gain, no euphemism, no flattering window) · plain cause line ("The rate dropped after the move.") · proof "View transaction ↗" · footer (≤2) primary **"See the original advice"** (→ `/strategies/[recId]` / `/activity/[entryId]`) + secondary **"What changed?"** (AI explains).

**Variants.** chat inline · activity-log entry (table row / mobile card).

**States.** loading · default-win · default-loss · pending ("Outcome still settling — realized PnL updates over time") · error.

**Non-custody/trust role.** Honesty is the trust mechanism — never hide a loss, never default to a flattering range; always link the originating rec + on-chain proof.

**Acceptance.** Wins/losses equal prominence (semantic color only); tied to originating rec; tx link; tabular; both breakpoints.

---

# Group C — Trust & Finance Components

## 13. GuardrailChecklist

**Purpose.** Make the deterministic policy's checks **literal and visible** — "guardrails + you dispose" as a click. Renders each check pass/warn/block, and warn-items produce the acknowledgement checkboxes that gate Sign (`05` §7; `02`-Flow 6 §3).

**Builds on.** List rows + Lucide semantic icons (`check`/`alert-triangle`/`slash`/`lock`, `04` §8) + `Tooltip` (literacy "what's this?") + `Checkbox` (per warn-ack) inside an amber `Alert`.

**Anatomy.** One row per check, plain label + state icon: "✓ Within your beta cap", "✓ Within the vault cap", "✓ Slippage under your max ({x}%)", "✓ Allowlisted protocol ({Aave v3 / Aerodrome})", "✓ Policy approved", "✓ Simulation passed". Each row: "what's this?" `Tooltip`. **Warn rows** carry a **specific** ack `Checkbox` ("I understand slippage could be up to 0.9%."). The banner and checklist must agree (a red banner ⇒ ≥1 red row; amber ⇒ ≥1 amber row + ack).

**Variants.**
- **Pass** — `--success` + check.
- **Warn / needs-ack** — `--caution` + alert-triangle + ack `Checkbox`.
- **Block** — `--destructive` + slash/lock; **uncheckable** (Sign impossible), remedy not override.
- **Preview mode** (strategies "Guardrails passed" / chat warning) — read-only checks, no ack boxes (the real gate is `/confirm`).

**States.** all-pass · warns-present (counter "Acknowledge 2 of 3 to continue") · block-present (remedy) · simulating (sim row pending) · sim-error (Sign stays disabled).

**Non-custody/trust role.** The deterministic layer made visible; friction-as-safety; blocks cannot be overridden; specific acks (never generic "I accept the risks").

**Acceptance.** Each item color + icon + text (never color-alone) + a "what's this?" tooltip; warns produce specific acks that gate Sign; blocks uncheckable with a remedy; agrees with the SimulationStatusBanner; keyboard-operable acks; reduced-motion safe.

---

## 14. CapsMeter

**Purpose.** Make beta caps **legible and reassuring** (caps protect users) and show remaining capacity at a glance (`04` §6.5; `05` §3.4; vault/automation/trust).

**Builds on.** Styled shadcn `Progress` (or custom segmented bar) + `Tooltip`/`HoverCard` ("why caps?").

**Anatomy.** Labeled meter with tabular figures: "$X used / $Y cap" + an accessible text equivalent ("82% of your deposit cap used") + "why caps?" tip ("Beta caps limit how much is exposed while we prove the system."). Fill semantics (`04` §6.5): **spark/healthy → caution amber ≥ ~80% → destructive at/over ("Cap reached")**.

**Variants.** per-user deposit cap · vault TVL cap ("$X.XXM of $Y.YYM") · per-tx cap (static) · **session-key usage** (cumulative/weekly used, used by SessionKeyScopeCard).

**States.** default · near-limit (amber) · **at-cap** (destructive bar + "Cap reached — new deposits paused. Withdrawals are unaffected.") · loading (`Skeleton` bar) · read-error (last-known + "as of {time}" + retry, never a confident wrong number).

**Non-custody/trust role.** Caps framed as protection, **never failure**; at-cap always affirms **withdrawals unaffected**; the authoritative block lives on `/confirm` (the meter pre-empts a doomed handoff).

**Acceptance.** Tabular + accessible text equivalent (not color-alone); spark→amber→destructive fill; at-cap reassures withdraw; "why caps?" present; reduced-motion safe.

---

## 15. RiskChip / RiskTierBar

**Purpose.** The single, learn-once risk-tier indicator reused **everywhere risk appears** (portfolio score, vault risk, strategy ranking, allocation-by-risk, session-key context). Risk gets its **own** palette (teal→magenta, `04` §2.5) so "higher risk" never misreads as "loss/error."

**Builds on.** `Badge` (risk-palette variant) + a **custom 5-segment meter** (RiskTierBar). For drift, a **two-marker meter** (target marker + current fill).

**Anatomy.**
- **RiskChip:** `Badge` = word label + **n/5** ("Lower · 1/5"), risk-palette colored. **Never color-alone** — always carries number + label.
- **RiskTierBar:** 5 segments filled to the tier, colored from `--risk-1…5`; optional inline numeric.
- **DriftMeter variant:** target marker vs current fill + an on-track/drifting/off-track `Badge` + delta ("Your plan: Lower (1/5). Right now: Moderate (3/5) — above your plan.").

**Variants.** 3-step retail collapse (Lower/Moderate/Higher) · full 5-step (power-user) · drift (two-marker). Launch vault = **Risk 1 (Lower)**; most surfaces read 1–2.

**States.** default · loading (skeleton meter) · no-mandate (drift variant shows "Set your plan…" prompt, never a fabricated target) · stale/unavailable ("risk read unavailable — your funds are safe and withdrawable").

**Non-custody/trust role.** Honest both ways (flags below-plan conservatism too); on read-only surfaces drift is `--caution`, never a hard error (the real block is on `/confirm`).

**Acceptance.** Same palette across every surface (never recolored per-surface); always n/5 + label + meter fallback; risk palette only (never semantic green/red); drift never fabricates a target; AA + reduced-motion safe.

---

## 16. NetApyBreakdown

**Purpose.** Render the **most-regulated number** honestly — net APY, with the mandatory breakdown ≤1 tap, estimate-framed, never bare, never the lead (`07` §5.2; vault/strategies/cards).

**Builds on.** Text (`.tnum`) + `Accordion` (desktop) / `Sheet` (mobile) / `HoverCard`/`Popover` (inline) for the breakdown; optional CitationChip on the rate.

**Anatomy.** Figure: **"{X}% net APY"** (one decimal + word "net"), estimate micro-line ("estimate · rates change"); prefer a **range** when volatile ("≈ 4.0–4.4% net APY (30-day range)"). Breakdown (≤1 tap, mandatory): **"4.2% net APY = 4.7% Aave supply rate − 10% SparkPoint performance fee (profit-only, high-water mark)."** — line items: base supply rate · any incentives stated separately + honestly (none token-subsidized at launch) · **the 10% profit-only performance fee explicit (0% on principal)** · = net.

**Variants.** hero (vault detail) · inline (recommendation/action cards, position rows, deposit "est. yield") · range vs single value.

**States.** default · loading (skeleton, **never `0`**) · stale (labeled estimate) · error ("Couldn't load the current rate. Try again.").

**Non-custody/trust role.** Net only, never gross-led; **no projected/extrapolated APY**; the 10% profit-only performance fee (0% on principal) provable; "Estimates, not guarantees." on any yield-referencing surface. **Benchmark:** Yearn/Beefy/Morpho net-of-fees convention.

**Acceptance.** Always net + word "net" + one decimal + breakdown ≤1 tap + estimate-framed; never bare; never the surface's literal lead; no projected APY; tabular; both breakpoints.

---

## 17. SharesPreview

**Purpose.** Make the ERC-4626 share model legible — the live deposit/withdraw conversion and the "your position" read (`02`-Flow 5 §5/§7; `07` §5.4).

**Builds on.** `Card`/labeled rows (`.tnum`) + `Tooltip` (shares definition) + optional TipCard ("share count fixed, value floats").

**Anatomy.**
- **Deposit preview:** "Deposit {X} USDC → receive ≈ {Y} spvUSDC" + share price used + "≈ ${value}" beneath; updates live as amount changes. **Always show shares.**
- **Withdraw/redemption preview:** "Redeem {Y} spvUSDC → receive ≈ {X} USDC" (or inverse), **incl. accrued yield and the "10% profit-only performance fee on yield above your high-water mark — 0% on your principal"**, share price, "≈ ${value}".
- **Your-position read:** shares held ("1,024.5031 spvUSDC" + "≈ $1,031.20") · share price · underlying value · realized yield · "as of {time}" provenance.

**Variants.** deposit · withdraw (by-amount or by-shares) · your-position sub-panel.

**States.** default · empty/pre-amount ("≈ — spvUSDC until you enter an amount") · loading (skeleton, never `0`) · stale (labeled "as of {time}") · error ("couldn't load value right now" + retry — **withdraw still works**).

**Non-custody/trust role.** Shares always shown (never hidden behind USDC alone); the profit-only performance fee (10% of yield above the high-water mark, 0% on principal) stated at redemption; convenience estimate re-simulated authoritatively on `/confirm`; withdraw read survives degraded mode.

**Acceptance.** Shares always shown with fiat-equiv beneath; the profit-only performance fee (10% of yield above the HWM, 0% on principal) stated at redemption; tabular; live update announced sparingly (`aria-live`, not per-keystroke); both breakpoints.

---

## 18. SessionKeyScopeCard

**Purpose.** Show one automation grant's **exact bounded scope + live usage + expiry**, and host the **instant, unilateral revoke** (`02`-Flow 7; `05` §6; `data-model` E10). Used on `/automation`, `/automation/[id]`, and inside ProveItPanel.

**Builds on.** `Card` + `Badge` (status pill) + scope `Badge` chips + **CapsMeter** (usage) + countdown text/`Badge` + `Button` (Manage outline; **Revoke** destructive) + `AlertDialog` (revoke confirm) + `Accordion` (raw on-chain read).

**Anatomy.** Header: "Auto-rebalance" + status pill · **scope chips** ("Only: Aave Yield Vault" · "≤ $X per move" · "≤ $Y per week" · "Slippage ≤ Z%" · "Expires {date}", tabular, allowlist-only) · **per-tx cap** (informational) · **cumulative/weekly CapsMeter** (spark→amber≥80%→destructive at cap) · **expiry countdown** ("Expires in {N days}", amber when near) · last activity → `/activity` · **provenance** (`session_pubkey` truncated, `registered_tx_hash` explorer link, "limits enforced by the contract, not our app") · actions [Manage] · **[Revoke access]** (prominent, empowering).

**Variants.** hub summary card · detail full read-out (every on-chain parameter) · prove-it-panel compact row · the **scope builder** companion (grant form: `Input`/`Slider`/`ToggleGroup` expiry presets/date `Popover`) + **live Scope summary** restatement. **No "unlimited", no "all vaults", no "never expires" — ever.**

**States.** Active(default) · Near-cap (amber) · Near-expiry (amber) · **Exhausted** · **Expired** · **Revoked** (each terminal pill + "back to signing every action" + [Grant new access], never silent renew) · loading (skeleton — **revoke + on-chain revoke instructions render immediately**, never gated) · read-error ("…limits enforced by the contract… [Retry]/[Verify on explorer]", revoke stays functional) · degraded (on-chain revoke promoted).

**Non-custody/trust role.** Per-action signing is the loud default; exact scope shown before signing; grant is one user-signed action via `/confirm`; **revoke ≤1 tap, unilateral, SparkPoint-independent, degraded-safe**; expiry/exhaustion auto-revert to per-action; automation can never withdraw or touch the escape hatch. **Benchmarks:** ERC-4337 session keys + Revoke.cash + Rabby + Ledger/Trust Wallet.

**Acceptance.** Every on-chain parameter shown in plain language; usage CapsMeter + countdown with non-color text; no unlimited/all-vaults/never-expires; revoke reachable ≤1 tap + degraded-safe + never gated on read; terminal states explain auto-revert + [Grant new access]; both breakpoints.

---

## 19. KillSwitchStatus

**Purpose.** Show the multisig kill-switch state honestly and make unmistakable that it is **pause-only** — it can halt *new* deposits/rebalances and can **never** block withdrawals (`05` §3.5; vault §4.4).

**Builds on.** `Card` + `Badge` (state pill) + `Accordion` (signer detail) + `Alert` (active banner) + `Button` ([Withdraw now] when active).

**Anatomy.** State pill: "Inactive — system nominal" (green) / "Active — new deployments paused" (amber). **Scope statement (always shown, both states):** two-line CAN/CANNOT — "Can: pause new deposits & rebalances. **Cannot: block your withdrawals, move your funds, or change custody.**" · controller transparency ("Controlled by a {n-of-m} multisig" + signer addresses/explorer + any timelock; "Governs pause only") · **when active:** prominent reassurance row + **[Withdraw now]**.

**Variants.** Trust Center full status card · vault-detail status chip (compact) · public-mirror (no account data).

**States.** inactive/nominal (green, default) · active/paused (amber banner + exit CTA elevated) · loading · read-error (last-known + "limits enforced on-chain" + retry).

**Non-custody/trust role.** **Never red** (it's reassurance, not alarm); active state must co-locate a working withdraw path; never implies withdrawals can stop.

**Acceptance.** States pause-only scope in BOTH states; active state co-locates a working [Withdraw now]; never implies withdrawals can be blocked; signer transparency; AA contrast; keyboard-operable.

---

# Group D — Data Visualization

## 20. AllocationDonut

**Purpose.** Show the portfolio/vault mix three ways, with **risk tier as a first-class view** so the donut *is* a risk read (`04` §6.3; portfolio §5.1; vault; chat snapshot).

**Builds on.** `Card` + Recharts `PieChart` (donut, `innerRadius`) + custom `Legend` + `Tabs`/`ToggleGroup` (view switcher).

**Anatomy.** View switcher: **Asset · Strategy · Risk tier** (`Tabs`/`ToggleGroup`) · donut with center label = total + position count · legend (right desktop / below mobile): each row = swatch + label + **%** (tabular) + **$** (tabular). **Risk-tier view** colors slices directly from the §2.5 risk palette; **Asset/Strategy** use the categorical ramp (risk-1, risk-3, risk-5, neutral). Slices <3% collapse into "Other" with disclosure.

**Variants.** full (portfolio/vault) · **compact mini** (PortfolioSnapshotCard — small donut or stacked bar).

**States.** default · single-position (clean ring, no broken arc) · loading (skeleton ring + legend rows) · empty (part of global EmptyState) · error ("No data yet" centered, never a broken axis).

**Non-custody/trust role.** Legend carries label + % (never color-alone); risk view reuses the learn-once palette; no projections.

**Acceptance.** Three views; risk view = risk palette, asset/strategy = categorical; labeled legend (color + label + % + $); <3% → "Other"; `aria-label` summary + legend as the non-color read; tabular; reduced-motion safe.

---

## 21. NetWorthChart

**Purpose.** The "how am I doing" trend — net worth over time with an honest range toggle (`04` §6.2; portfolio §3).

**Builds on.** `Card` + Recharts `AreaChart` (single series) + `Tabs`/`ToggleGroup` (range) + custom styled tooltip.

**Anatomy.** Net-worth figure (`text-display`, full precision, tabular) + **PnL readout** ("+$312.40 (+2.8%, 1M)": sign + color + filled triangle + window) + PnL-definition `Tooltip`/`Popover` + over-time `AreaChart` (**spark stroke + vertical gradient fill** — a sanctioned spark usage outside CTA) + **range toggle** (1D/1W/1M/1Y/All, default a non-flattering 1M) + "as of {time}" provenance.

**Critical color rule.** If down over the range, **do NOT recolor the whole area red** — keep spark stroke + gradient; color **only the PnL number** by sign (`04` §6.2).

**Variants.** portfolio hero (large) · chat snapshot compact (number + short chart + range chips) · per-position mini (position detail).

**States.** default · empty (replaced by global EmptyState, not `$0.00`+dead chart; idle-only-balance shows the real small figure + flat chart) · loading (figure skeleton + chart-height shimmer, never spinner-over-stale, never `0`) · success (figure tweens ≤300ms, no width reflow) · warning (stale "as of {time}") · error (`AlertBanner` + retry + custody reassurance).

**Non-custody/trust role.** No projected net worth; honest losses; stale labeled; failure reassures "funds are safe."

**Acceptance.** Spark area never recolors red on a down range; PnL signed/colored/windowed/tabular; honest default range; `aria-label` summary ("Net worth $X, up Y% over 1M"); number tween never reflows; reduced-motion safe.

---

## 22. PositionRow

**Purpose.** The legible per-position ledger entry with **inline actions** — the Zapper "rows carry actions" pattern, our version (portfolio §5.2).

**Builds on.** `Table` row (desktop) / `Card` (mobile) + `Badge` (kind chip, RiskChip) + NetApyBreakdown + SharesPreview text + `Button`/`DropdownMenu` (actions).

**Anatomy (desktop columns, right-aligned tabular).** Position (icon + name + kind chip: idle USDC/ETH `token_balance`, "Aave v3 · USDC/ETH" `aave_supply`, "Aave Yield Vault" `vault_shares`) · Balance/amount (vault = shares + fiat beneath) · Value · **Net APY** (NetApyBreakdown; en-dash for idle, never fake `0%`) · PnL (sign + color + triangle + window; realized/unrealized labeled) · **Risk** (RiskChip) · **Actions: Add · Withdraw · Ask AI**.

**Inline actions.** Add → deposit intent → `/confirm`; Withdraw → withdraw intent → `/confirm` (**always available on every holding**, survives degraded mode); Ask AI → `/chat` primed with the position. **Never signs in the row.**

**Variants.** desktop table row · mobile `Card` (header icon+name+RiskChip, 2-col mini-grid value/PnL/APY/balance, footer actions / overflow / bottom `Sheet`).

**States.** default · loading (skeleton rows, never `0`) · empty (global EmptyState, not an empty table with headers) · partial/stale (row "as of {time}", value labeled, withdraw still works) · error (row degrades to name + "couldn't load value right now" + retry, not a broken `$0.00`; rest of table renders).

**Non-custody/trust role.** Withdraw on every holding, ≤1 tap, degraded-safe; all actions route to `/confirm` (never signs); "Ask AI" suggests, doesn't act; failure reassures funds safe.

**Acceptance.** Add/Withdraw/Ask AI per row; Add/Withdraw route to `/confirm`; withdraw always available + degraded-safe; vault shows shares + accrued yield; net APY never bare; risk via RiskChip; tabular right-aligned; mobile `Card` transform; keyboard + 44px targets.

---

## 23. SimulationBalanceChangeTable

**Purpose.** The Tenderly-style pre-trade balance-change preview — exactly what leaves and arrives, in USD, with gas (`02`-Flow 6 §3; `04` §11).

**Builds on.** `Table` (right-aligned tabular; semantic +/− colored) — the data core of ConfirmationCard.

**Anatomy.** One row per asset in/out **+ a native gas row**: asset · direction (**− out** = `--loss` direction / **+ in** = `--gain` direction) · amount (token, tabular) · USD value (signed, colored, priced source via CitationChip). True minus `−` (U+2212). The ERC-4626 **shares row** uses the "{shares} spvUSDC ≈ ${value}" pattern. No persuasion prose.

**Variants.** single action · **bundled** (per-step sub-tables in the bundle `Accordion`/stepper: ① approve → ② swap → ③ deposit, each its own delta).

**States.** simulating (skeleton rows) · passed (full table) · warning (table shown in full — user decides with full info) · blocked (table shown + the offending row flagged) · sim-error ("couldn't simulate — won't sign blind").

**Non-custody/trust role.** The honest, fact-only preview that precedes 100% of signatures; no whole-table red alarm on a down projection (red = blocked/loss only); USD figures sourced.

**Acceptance.** Assets in/out + native gas; token + USD; signed + semantic-colored + icon (never color-alone); tabular right-aligned; shares row pattern; true minus glyph; skeleton (never broken) loading; mono available in the power-user details.

---

# Group E — State Primitives

## 24. EmptyState

**Purpose.** Turn "nothing here yet" into an **invitation, not a failure or an error** (`04` §6.1; portfolio §7.1; vault pre-deposit; automation default; outcome log empty).

**Builds on.** `Card` + Lucide feature icon (24–32) + microcopy + optional single CTA `Button`.

**Anatomy.** Centered feature icon · title (plain, e.g. "Nothing here yet") · body (one sentence, e.g. "Once you deposit, your balance, yield, and risk show up here.") · ≤1 CTA (e.g. "Explore the vault" → `/vault`). Sits **inside the shell** with the non-custodial badge + disclaimer present.

**Variants.** portfolio-empty ("Nothing here yet / Explore the vault") · vault pre-deposit (title "Aave Yield Vault", body with non-custody + net APY, CTA "Review deposit", **exit still documented**) · automation default ("You sign every action." — reassuring, NOT a hard sell, CAN/CANNOT preview) · outcome-log empty ("No outcomes yet… wins and losses") · no-matches (filtered) · chart "No data yet".

**States.** default (per-variant). No loading/error of its own (it *is* a terminal state).

**Non-custody/trust role.** Empty surfaces still show prove-it + exit; the vault/withdraw empty states **document the exit before deposit**; the automation empty state frames the safe default positively.

**Acceptance.** Never a `$0.00`-with-dead-widgets or an error; one clear CTA where actionable; reassuring copy; sits inside the shell; both breakpoints; keyboard-operable CTA.

---

## 25. AlertBanner

**Purpose.** The reusable semantic banner for status, warnings, blocks, and info across every surface — the single styled wrapper for success/warning/destructive/info messaging (`04` §11; used as the SimulationStatusBanner, error/degraded/stale banners, caution previews, etc.).

**Builds on.** shadcn `Alert` (success / warning / destructive / info variants) + Lucide semantic icon + optional inline `Checkbox` (acknowledgement) / `Button` (retry/remedy/action) / link.

**Anatomy.** Leading semantic icon (`check`/`alert-triangle`/`slash`-`lock`/`info`, `04` §8) + title + body (plain, no raw RPC/revert strings) + optional inline action(s) (retry / remedy / [Prove it] / [Exit anytime]) + optional ack `Checkbox`. Color + icon + text always (never color-alone).

**Variants.**
- **Success** (`--success`) — e.g. "Simulation passed — no risks detected"; receipt confirmations (one satisfying beat, never confetti).
- **Warning/caution** (`--caution`) — acknowledge-required (with ack `Checkbox`), near-cap, drift/concentration, kill-switch paused, stale data.
- **Destructive/blocked** (`--destructive`) — blocked-by-guardrails (with remedy, never override), tx failure (+ custody reassurance "your funds are safe and untouched"), cap reached.
- **Info** (`--info`) — degraded-mode notice, system notes, literacy framing (blue, **not green**).

**States.** static · with-action (retry/remedy) · with-ack (gates a Sign) · dismissable (where allowed; the AI disclaimer is collapsible, never fully removable).

**Non-custody/trust role.** Carries the verbatim trust/error strings (custody reassurance on every action failure; degraded "exit still works"; blocked framed as protection + remedy, never an override). The simulation status banner and GuardrailChecklist must agree.

**Acceptance.** Correct semantic variant (green=success/safe, red=blocked/loss, amber=caution, blue=info — never the spark hue); color + icon + text; no raw tech strings; action failures carry custody reassurance; ack variant gates Sign; reduced-motion safe (blocked-shake degrades to opacity/state); AA contrast both themes.

---

## 26. Cross-component conformance (acceptance for the library as a whole)

A component conforms to this library when **all** hold:

1. **Composes a shadcn primitive.** Every component resolves to a primitive/composition in `04` §11 (+ Recharts/Lucide); no bespoke primitive is reinvented.
2. **One color system per element.** Brand (spark) / outcome (semantic) / risk (palette) never blur; spark stays scarce (≤1 spark CTA per view; spark only on AI presence / net-worth area / focus ring).
3. **All applicable states designed.** default · empty · loading · success · warning · error (+ component-specific terminal states), at **1440px desktop and 390px mobile**, with Dialog→Drawer/Sheet on mobile.
4. **Tabular + non-color + keyboard by construction.** All financials `.tnum`; every semantic/risk signal = color + icon + text/number; visible 2px spark focus ring + full keyboard operability (incl. the gated Sign); 44px touch targets; reduced-motion honored; mono for addresses/hashes/calldata/raw scopes.
5. **Verbatim trust strings.** AiSuggestionBadge ("AI suggestion — you approve & sign"), "Estimates, not guarantees.", net-APY-with-breakdown, "Nothing moves until you sign…", "Simulation passed — no risks detected", custody/exit clauses — reused verbatim from `07`; `07` wins on any wording conflict.
6. **The trust spine is reachable.** NonCustodialBadge → ProveItPanel and a withdraw/exit path are ≤1 tap wherever a component renders; no component (or its failure state) ever hides the escape hatch; withdraw-always is never gated; blocks offer a remedy, never an override; the AI proposes, the user signs.

---

## 27. Cross-references

- **Tokens / spark = AI presence / semantic + risk palettes / tabular / mono / data-viz / motion / iconography / a11y / component→shadcn map:** `04-design-system.md` (§2, §3, §6, §7, §8, §10, §11).
- **Trust component behavior/copy (badge, prove-it, caps, kill-switch, acknowledge-before-sign, outcome log, AI-suggestion label):** `05-trust-and-safety-ux.md` (§1, §2, §3, §5, §6, §7, §8, §11).
- **Canonical wording (all strings here are illustrative):** `07-content-and-tone.md` — **wins on any conflict.**
- **Shell placement / routes / single-confirm-funnel:** `01-information-architecture.md` (§1, §2).
- **In-context usage, props, per-flow states:** `02-flows/01-onboarding.md` … `08-srk-literacy-outcomes-settings.md`.
- **Named benchmarks per component:** `09-references.md` (OpenAI Apps SDK, Cloudscape, Tenderly, Rabby, Revoke.cash, Morpho/Gauntlet/Yearn/Beefy, Zerion/DeBank/Zapper, Betterment/Wealthfront, Ledger/Trust Wallet, ERC-4337 session keys).
