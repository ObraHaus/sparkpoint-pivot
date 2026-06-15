# 02 · Flow 1 — Onboarding (chat-driven goals + risk → mandate)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui).
> **Status:** Authoritative screen-level spec for **Flow 1 (Onboarding)** of the six core flows. This is the W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to):** `00-brief.md` (positioning, thesis, audiences, non-goals), `01-information-architecture.md` (§1 routes `(onboarding)`, §2 shell, §5 Stage C journey), `04-design-system.md` (tokens, spark/semantic/risk palettes, type, motion, a11y, shadcn map), `07-content-and-tone.md` (**all wording, the AI disclaimer, number/PnL/APY formatting, banned/required phrases**). **Where this doc shows copy that conflicts with `07`, `07` wins on wording; where it conflicts with the brief on scope/tone, the brief wins.**
> **What this doc IS:** goal & entry points; the step-by-step screen sequence and every state (default / empty / loading / success / warning / error); component anatomy → shadcn primitives; desktop **and** mobile layout notes; microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria.
> **What it is NOT:** visual tokens (in `04`), canonical strings (in `07`), the IA/route map (in `01`), or the chat/strategy/vault/confirm flow specs (separate docs).

---

## 0. Goal, scope, and the one-sentence job

**Job:** Turn a freshly connected, whitelisted user into a user with a **confirmed, human-readable mandate** (goals + timeline + risk tier) — the spine that drives Strategies ranking, Portfolio risk, and Chat (`01-IA` §4.2.1) — and do it as a **conversational robo-advisor** (Wealthfront/Betterment, made chat-native), in **under 5 minutes** (`spec.md` SC-007).

**The wedge this flow owns (brief §2.3):** *conversational goal + risk onboarding* via **scenario cards, not an abstract slider**, producing a **personalized, adjustable** mandate. This is the differentiator; design it as the front door to trust, not a form.

**Tone for this flow (`07` §1.3):** *warm, reassuring, unhurried; lead with "you're in control" and "you can always leave."* Newcomers are wary of the collapsed "AI fund" cohort — **reduce fear first** (brief §3, primary tier = crypto-curious retail). Capital-preservation-first framing throughout.

**Output (the mandate), persisted to the account (`spec.md` FR-002/003):**
- **Experience level** (New / Some / Pro) — adjusts later copy density only; never gates.
- **Goal** (one of a limited chip set).
- **Timeline** (horizon).
- **Risk tier** (1–5, from §2.5 risk palette; launch reality leans 1–2), captured via scenarios and **user-adjustable**.
- A one-paragraph **plain-language mandate summary** (`07` §8 "Mandate summary" exemplar).

**Hard product facts to encode (brief §2.2, `spec.md`):** single Aave Yield Vault at launch = **Risk 1 (Lower)**; the AI **proposes**, guardrails check, **the user signs**; SparkPoint **can never move or withhold funds**; everything here is **changeable later** in `/settings/mandate`.

---

## 1. Entry points & exits

### 1.1 Entry points (where onboarding begins)
| From | Condition | Lands on |
|---|---|---|
| **Post-connect + whitelist pass** (`01-IA` §5 Stage B→C) | First-time user, no mandate yet | `/onboarding` (Step 0 welcome) |
| **Resume** | User abandoned mid-flow (state persisted) | `/onboarding` router → last incomplete step (§7.3) |
| **Edit mandate** | Existing user from `/settings/mandate` (`spec.md` FR-004) | Re-enters at **Step 6 (review)** pre-filled, or full re-run if they choose "start over" |
| **Chat nudge** | User without a mandate asks for recommendations in `/chat` | Deep-link to `/onboarding` with a return-to-chat intent |

### 1.2 Pre-conditions (handled by `(auth)`, not here — `01-IA` §5/§6)
Onboarding assumes: **wallet connected**, **Base network**, **whitelist passed**. If any regress mid-flow (disconnect, wrong network, gate fail), see §7.4. Onboarding **never** asks the user to connect a wallet it doesn't already have — the connect step here is a **reassurance + confirmation** beat, not a re-auth (the actual connector UI lives in `(auth)/connect`). If a user somehow reaches `/onboarding` unconnected, redirect to `/connect?next=/onboarding`.

### 1.3 Exits
- **Complete →** redirect to `/chat` with a primed first message (`01-IA` §5 Stage C): *"Here's your plan — want to fund your vault?"* (verify final wording in `07`).
- **Save & leave (defer):** user can leave any time; progress persists; **"You can change any of this later"** (`07`). No dark-pattern trapping.
- **Withdraw/exit:** even in onboarding the **non-custodial badge + escape hatch are present** (`01-IA` §2, this doc §4) — a user can reach the prove-it panel and the exit hub in ≤1 tap without finishing onboarding.

---

## 2. The onboarding shell (`(onboarding)/layout.tsx`)

A **focused shell** (`01-IA` §1) — primary nav suppressed to keep the user in the funnel — but the **non-custody touchpoints persist** (mandatory, brief §2.2; `01-IA` §0.1).

### 2.1 Persistent shell anatomy (present on every onboarding step)
| Element | Desktop | Mobile | shadcn | Role |
|---|---|---|---|---|
| **Spark logo** | Top-left | Top-left | brand mark (`04` §9) | Brand presence; the spark mark = AI identity. |
| **Non-custodial badge** | Top bar, right | Top bar, right | `Badge`→`Sheet`/`HoverCard` (`04` §11) | THE persistent proof affordance → "prove-it" panel (`01-IA` §2.3). ≤1 tap. |
| **Network pill** | Top bar | Top bar (condensed) | `Badge` ("Base") | Confirms the user is on Base; no chain switcher (non-goal). |
| **Wallet chip** | Top bar | Top bar (condensed) | `DropdownMenu`+`Badge` | Connected address (truncated mono `0x12…ab`); menu → permissions / disconnect. |
| **Progress indicator** | Below top bar, full-width stepper | Compact dots/segment under top bar | custom + `Progress` (`04` §6.5 style) | "Step n of N" — see §3. |
| **AI disclaimer strip** | Under progress | Compact one-line, expandable | `Alert` (info) + `Collapsible` (`04` §3.3) | Persistent; the AI caveat (`07` §3). Always in view; full ≤1 tap on mobile (`07` §3.2). |
| **Save & exit affordance** | Top bar (subtle, `ghost`) | "More"/overflow | `Button` `ghost` | "You can change this later"; never traps. |

> **Carry-everywhere rule:** the **prove-it panel** and a **withdraw/exit path** stay reachable in ≤1 tap *even here* (brief §2.2; `01-IA` AC#3). The badge and the disclaimer-strip "[Exit anytime]" link satisfy this.

### 2.2 Layout model (both canvases — `04` §4.2)
- **Mobile (390px design, 360 min):** single column, **chat-native**, stacked. The conversation reads top→bottom; the active question's input/chips/cards sit at the bottom within thumb reach; the **primary CTA is bottom-anchored**. Overlays (prove-it, "why this?") are **Sheets/Drawers**, not Dialogs.
- **Desktop (1440px design, 1024 min):** a **centered conversational column** (max ~720–760px reading width) on the canvas — *not* a full 12-col data layout (this is a guided wizard, not a dashboard). The progress stepper spans the top; the conversation centers; inline cards/chips render at column width. Overlays = `Dialog`/right `Sheet`. Optional: a faint right-margin **"why we ask" rail** on ≥xl that mirrors literacy tips inline (progressive disclosure for the curious), collapsing into inline tip cards below xl.
- **Responsive transform:** Dialog→Sheet on mobile; the right "why we ask" rail collapses to inline `TipCard`s; the stepper collapses from labeled segments to dots.

---

## 3. Progress indicator (spec)

A persistent, honest progress stepper (Wealthfront/Betterment progressive-disclosure builds trust; brief §4 "celebratory microcopy at completion").

- **Steps (the canonical N=7 sequence, see §5):** 0 Welcome · 1 Connect (reassure) · 2 Experience · 3 Goal · 4 Timeline · 5 Risk scenarios · 6 Mandate review · 7 First-rec preview → Complete. **Stepper convention (stated, use everywhere):** the visible counter counts the **6 INPUT steps** as "Step N of 6" — i.e., Connect=1, Experience=2, Goal=3, Timeline=4, Risk scenarios=5, Mandate review=6. The **Welcome and Completion screens are bookends and are NOT counted** (no "Step 0 of 6", no "Step 7 of 6"). First-rec preview is a post-confirmation payoff beat shown without a counter increment. This is the single convention; do not show alternate numbering.
- **Desktop:** horizontal labeled stepper (completed = filled spark dot + check; current = spark ring; upcoming = muted). Labels short ("Goals", "Risk", "Your plan").
- **Mobile:** compact segmented bar or dots with "Step n of 6" text label (never dots-only — a11y, `04` §10.2).
- **Behavior:** completed steps are **tappable to go back and edit** (reinforces "you're in control"); upcoming steps are not jumpable (answers gate them). Back never loses entered data (§7.3).
- **Color:** spark for progress fill (sanctioned AI/attention usage, `04` §2.3); **never** semantic green for "done" here (green = gains/safe only, `04` §2.4) — use spark fill + a neutral check.
- **Tokens/format:** "Step n of 6" tabular if numeric; sentence case.

---

## 4. Non-custody / trust touchpoints in onboarding (mandatory)

Onboarding is the **first contact** and the moment to establish the trust spine (brief §2.2, §3). These are not optional decoration:

1. **Welcome leads with the non-custodial promise** (§5.0) — *before* any goal/yield talk. Lead with control, not returns (`07` §9.1 #3).
2. **Persistent non-custodial badge** in the shell → prove-it panel ("What SparkPoint can & can't do", `07` §7) reachable on every step.
3. **Connect step is reassurance-forward** (§5.1): *"You own your keys and your account. We never generate a wallet for you or hold your keys."* (`07` §7, verbatim). Frame the initial connection as **read-first** — we read your wallet to personalize; nothing moves without your signature.
4. **AI disclaimer strip** persistent on every step (`07` §3.1/§3.2) — the AI suggests, guardrails check, you sign; capital at risk; SparkPoint can't move your funds. **Risk + custody clauses verbatim, unsoftened.**
5. **"You can change this later"** reassurance on every input step and on the mandate (`07`; brief §11 onboarding requirement).
6. **The mandate explicitly states the control model** (§5.6): *"The AI will only suggest moves that fit this. You approve and sign each one."* (`07` §8 mandate exemplar).
7. **First-rec preview carries the "AI suggestion — you approve & sign" badge** and "Estimates, not guarantees" (§5.7; `07` §2.1, §3.3) — it is a *preview*, never a one-click money-mover (`07` §9.1 #4).
8. **Escape hatch present:** disclaimer-strip "[Exit anytime]" → `/trust/exit`; the user is never trapped to finish (§1.3).

Benchmark register for this trust framing: **Ledger / Trust Wallet** self-custody voice ("Your keys. Your funds. Always.", `07` §2.1) — structural, not promissory.

---

## 5. Step-by-step screens & states

> Each step below specifies: **purpose · entry · anatomy (→ shadcn) · desktop layout · mobile layout · states · microcopy guidance (defer to `07`) · trust touchpoint · benchmark**. All copy is *guidance*; the canonical strings live in `07` and win on wording. All financial figures use tabular numerals (`04` §3.1); no bare APY (`07` §5.2); no return-led surfaces (`07` §9.1 #3).

### 5.0 — Step 0: Welcome + non-custodial promise
- **Route:** `/onboarding` (start).
- **Purpose:** Set the relationship: AI fund manager *that cannot hold your money*. Reduce fear, then invite forward. **Lead with control + non-custody, not yield** (brief §2.2; `07` §9.1 #3).
- **Anatomy:**
  - Spark mark + a calm headline establishing "AI hedge fund, anchored by non-custody" (brief §2.1). Headline leads with self-sovereignty (e.g., voice of *"An AI fund manager that can't hold your money. Let's build your plan."* — finalize via `07`).
  - 3 short **promise chips/lines** drawn from the five guarantees, plain-language (`07` §7): *you own your keys · withdraw anytime, even if we're offline · the AI suggests, you sign*.
  - A subtle **"What SparkPoint can & can't do"** link → prove-it panel (`07` §2.2 "See what we can & can't do").
  - **Primary CTA:** "Get started" (spark, `04` §11 — one primary per view). Secondary `ghost`: "How this works" → `/how-it-works` or the how-it-works sheet.
  - Optional small **time-honesty line:** "Takes about 3 minutes." (supports SC-007; no urgency/FOMO — `07` §9.1 #9).
- **Desktop:** centered hero column; headline `text-h1`/`display`, promise lines as a tight 3-item list or chip row; CTA centered beneath.
- **Mobile:** stacked; headline, promises, CTA bottom-anchored.
- **States:** *Default* (above). *Loading* = brief skeleton if account/mandate-existence check is pending (skeleton, not spinner, `04` §7). *Returning user with partial progress* = a "Resume your plan" variant with a "Start over" secondary (§7.3). *Error* (couldn't load onboarding state) = `Alert` with retry + reassurance that "your funds are safe and untouched" (`07` §6.1) — onboarding has no funds at stake yet, but custody reassurance is cheap and on-brand.
- **Trust touchpoint:** the **entire screen** is the non-custody promise; badge present; disclaimer strip present.
- **Benchmark:** Wealthfront welcome ("conversational, friendly, human, defuse a frightening experience", research §4); Ledger/Trust Wallet self-custody framing (`07` §2.1).

### 5.1 — Step 1: Connect wallet (reassurance + confirmation)
- **Route:** `/onboarding` (or `/onboarding/connect` interstitial); the real connector is `(auth)/connect`. In the common path the wallet is **already connected** from Stage B, so this is a **confirmation + reassurance** beat, not a fresh connect.
- **Purpose:** Make the wallet relationship feel safe before personalization. Explain *why* we read the wallet (to personalize), reassure on custody.
- **Anatomy:**
  - **Connected state (common):** wallet chip showing truncated mono address + Base pill + a `shield-check` reassurance block: *"You own your keys and your account. We never generate a wallet for you or hold your keys."* (`07` §7 verbatim). A plain "why we ask" line: *"We read your wallet to personalize your plan. Nothing moves without your signature."*
  - **Not-yet-connected state (edge):** a single **"Connect wallet"** primary CTA (spark) → routes to `(auth)/connect?next=/onboarding` (do not embed the connector list here; `01-IA` §1 keeps connect in `(auth)`).
  - Inline `TipCard` (optional, dismissable): "What's non-custodial?" → `07` §4.3 canonical definition; deep-links `/learn/[slug]`.
- **Desktop / Mobile:** centered column; reassurance block prominent; CTA single + spark; mobile CTA bottom-anchored.
- **States:**
  - *Default (connected):* confirmation + reassurance + "Continue" primary.
  - *Disconnected:* "Connect wallet" CTA (→ auth).
  - *Wrong network:* inline "Switch to Base" prompt (`01-IA` §6) — not a separate route; block "Continue" until on Base.
  - *Loading:* connecting/verifying skeleton.
  - *Error (connection failed):* `07` §6.1 — "We couldn't connect your wallet. Make sure it's unlocked and on Base, then try again." + "Try again".
  - *Whitelist/geo fail mid-flow:* route to `/unavailable` (`01-IA` §6) which still surfaces withdraw-always.
- **Trust touchpoint:** the **user-owned-keys** guarantee is the spine of this step; "read-first, sign-to-move" framing.
- **Benchmark:** Wise/empathetic copy when asking for sensitive access (research §4); Ledger/Trust Wallet custody voice.

### 5.2 — Step 2: Experience segmentation
- **Purpose:** Branch later **copy density** (not features) — New / Some / Pro (brief §3 competence gradient; research §4 Wealthfront experience segmentation). **Never gate** anything on this answer.
- **Anatomy:** AI turn poses one plain question ("How familiar are you with DeFi / crypto investing?"); answer via a **3-chip ToggleGroup of cards**:
  - **New** ("I'm just getting started") · **Some** ("I've used a few apps") · **Pro** ("I read contracts").
  - Each chip = `Card`/`ToggleGroup` item; selected = **spark ring** (`04` §11 "selected = spark ring"); icon + label + one-line gloss.
  - Helper microcopy: "This just tunes how much detail I show. You can change it anytime." (no condescension — `07` §4.1).
- **Desktop:** 3 cards in a row within the conversation column.
- **Mobile:** 3 stacked full-width chip cards; selection advances (or an explicit "Continue").
- **States:** *Default* (unselected, Continue disabled). *Selected* (spark ring, Continue enabled). *Loading/Saving* between steps = inline skeleton or optimistic advance. No error state beyond persistence failure (toast retry).
- **Trust touchpoint:** disclaimer strip persists; "change anytime" reassurance.
- **Benchmark:** Wealthfront experience-level segmentation (research §4); Cloudscape selectable suggested replies (research §1).

### 5.3 — Step 3: Goal selection (limited chip cards)
- **Purpose:** Pick **one** financial goal from a **deliberately limited** set (mitigates choice paralysis — Wealthfront, research §4). Goal anchors every later recommendation ("tied back to your goal", brief §2.3).
- **Anatomy:** AI turn ("What's your main goal right now?") → a small set of **goal chip cards** (`Card` selectable / `RadioGroup` of cards, single-select):
  - Canonical set (align final labels with `07`): **Grow my savings** · **Steady yield** · **Aggressive growth** · **Reach a target amount** (optionally reveals a target-$ input).
  - Each card: icon, plain title, one-line gloss, **and a risk-tier hint chip** using the §2.5 risk palette (e.g., Steady yield → Risk 1–2 Lower; Aggressive growth → Risk 4–5 Higher) — *hint only*, the real tier is set by scenarios (§5.5). Risk chip always carries **numeric step + label** (never color-only, `04` §10.2).
  - **"Reach a target amount"** selected → reveal an inline `Input` (amount, tabular, `$` prefix) + optional by-when; keep it light.
- **Desktop:** 2×2 grid of cards in the column.
- **Mobile:** stacked full-width cards; single-select; target-amount input expands inline when chosen.
- **States:** *Default* (none selected, Continue disabled). *Selected* (spark ring). *Target-amount sub-state* (input revealed; validate ≥ min, tabular). *Empty/invalid target* (helper text, not a scary error). *Saving* (optimistic). 
- **Microcopy:** plain goal labels; **never lead with a return number** (`07` §9.1 #3) — goal cards describe *intent*, not promised yield. Launch reality: only the Lower-risk Aave vault is live, so higher-risk goals are honestly framed ("we'll rank strategies toward this as more vaults open" — verify `07`).
- **Trust touchpoint:** disclaimer; "you can change this later".
- **Benchmark:** Wealthfront limited-goal set + goal-aligned copy (research §4); Betterment goals-based framing.

### 5.4 — Step 4: Timeline
- **Purpose:** Capture horizon (short / medium / long), a robo-advisor risk-profiling input (research §4 — goals, timeline, risk tolerance).
- **Anatomy:** AI turn ("When might you need this money?") → either:
  - **Chips** (recommended for chat-native simplicity): **< 1 year** · **1–3 years** · **3+ years** (`ToggleGroup`), **or**
  - a **`Slider`** with labeled stops (`04` §11 onboarding `Slider`) if a continuous feel is preferred — but chips are lower-friction on mobile and clearer; **prefer chips, slider optional**.
  - Inline microcopy connecting timeline → risk capacity in plain terms ("Longer horizons can usually take more ups and downs." — verify `07`; honest, no promises).
- **Desktop:** chip row (or slider) inline.
- **Mobile:** stacked chips full-width / slider with large touch target (44px, `04` §4.3).
- **States:** *Default* (none, Continue disabled). *Selected.* *Saving.* No destructive states.
- **Trust touchpoint:** disclaimer; reassurance.
- **Benchmark:** Wealthfront "Path" timeline inputs (research §4); robo-advisor timeline capture.

### 5.5 — Step 5: Risk tolerance via SCENARIO cards (the wedge — not a slider)
- **Purpose:** Capture risk tolerance through **behavioral scenarios**, not abstract self-rating (research §4 best practice; brief §2.3 "scenario-based capture"). This is the differentiator step — design it with care.
- **Anatomy:**
  - One or a short series (1–3) of **scenario `Card`s** (`RadioGroup` of cards). Canonical exemplar (`07` §8): **"Your $1,000 drops to $800 in a week. What do you do?"** → options in plain language: **"Sell to stop the bleeding"** · **"Hold and wait"** · **"Buy more while it's low"**.
  - Each option = a selectable card/row; selected = spark ring. Options map to a **risk-tier weight** that aggregates to a 1–5 tier (the mapping logic is product, not shown raw to the user).
  - Optionally a 2nd scenario (e.g., a tradeoff between a steady small yield vs a volatile larger one) to disambiguate — keep to ≤3 to protect the <5-min target (SC-007).
  - **Inline literacy `TipCard`** the first time a term like "volatility" or "yield" appears (`07` §4 learn-as-you-go; `--info` blue, not green, `04` §2.4). Dismissable, never re-nags.
- **Desktop:** scenario prompt as an AI turn; the 3 option cards stacked or in a row beneath; "Continue" appears after a selection (multi-scenario: auto-advance or a stepper-within-step).
- **Mobile:** scenario prompt, then full-width stacked option cards; one selection advances to the next scenario or to review.
- **States:** *Default* (prompt + unselected options). *Selected* (spark ring). *Multi-scenario progress* (e.g., "Scenario 2 of 2"). *Saving.* *Loading* (if scenarios are fetched). No alarm/error states — scenarios are neutral.
- **Microcopy:** plain, non-leading option phrasing; **never** frame an option as obviously "right" (avoid shame — `07` §4.1). The loss option ("Sell to stop the bleeding") is stated plainly, not judged.
- **Trust touchpoint:** disclaimer; this step *earns* the personalization, reinforcing "AI as fund manager that learns your goals" (brief §2.3).
- **Benchmark:** scenario-based risk profiling (research §4 — "how would you react to a 20% drop?"); Wealthfront/Betterment; **explicitly NOT** a lone abstract risk slider (brief, `07` §9.3 banned: capture risk as scenarios).

### 5.6 — Step 6: Mandate review (adjustable result + "why this profile?")
- **Purpose:** Show the **proposed mandate** back to the user for confirmation (required — `spec.md` FR-002), make it **adjustable** (autonomy = trust), and explain **"why this profile?"** (progressive disclosure). This is the **confirmation gate** of onboarding.
- **Route:** `/onboarding/review` (proposed) → on confirm, writes mandate (→ `/onboarding/mandate` confirmed, or merge into one screen with a confirm action).
- **Anatomy:** a single **mandate summary `Card`**:
  - **Risk tier `Badge`** from the §2.5 risk palette — **numeric step + word label** (e.g., "Lower risk · 1/5") + segmented meter (never color-only). Launch default reality: most users land Risk 1–2.
  - **Adjustable risk control:** a **`Slider`** (1–5) the user can nudge (`04` §11 "Resulting mandate summary: Card + Badge + Slider (adjust)"). Moving it live-updates the tier label, the meter, and the plain summary. This is the *override* affordance — explicitly allowed (`spec.md` FR-002 confirm-before-effect; brief §2.3 "adjustable mandate").
  - **Plain-language mandate paragraph** (`07` §8 exemplar): *"Your plan: Lower risk (1/5), capital preservation first, target steady USDC yield. The AI will only suggest moves that fit this. You approve and sign each one."* — assembled from goal + timeline + tier.
  - **"Why this profile?"** disclosure (`Accordion`/`Popover`, `04` §11) — explains, in plain language, how the scenario answers + timeline mapped to this tier; cites the user's own answers ("You chose to hold through a 20% drop and a 3-year horizon"). Honest, no jargon dump.
  - **Higher-risk warning state:** if the user drags the slider **above** what the live launch vault supports (i.e., above Risk 1–2), surface a **caution `Alert`** (`04` §2.4 amber + icon): plainly note only the Lower-risk Aave vault is live today, and that higher-risk strategies will rank as more vaults open — honest, not a hard block. (This is *information*, not a guardrail-block; no signing here.)
  - **Reassurance line:** "You can change this anytime in Settings." (`07`; brief §11).
  - **Primary CTA:** "Set my plan" / "Save my plan" (`07` §2.2 — **not** "Finish"/"Complete onboarding"). Spark. Secondary `ghost`: "Adjust" (scrolls to slider) or "Back".
- **Desktop:** the mandate card centered; "why this?" expands inline; slider with tabular tier readout.
- **Mobile:** full-width card; slider with 44px thumb; "why this?" as a `Collapsible`/bottom `Sheet`; CTA bottom-anchored.
- **States:**
  - *Default:* proposed mandate shown, summary + tier + slider at the computed value.
  - *Adjusted:* user moved the slider → label/meter/paragraph update live; a subtle "adjusted from suggested" note (honest).
  - *Above-launch-support (warning):* caution `Alert` as above; **not** sign-blocking (no transaction here) — purely informational.
  - *Loading:* skeleton while the mandate is computed (`04` §7).
  - *Saving:* CTA → pending state on "Set my plan" (writes mandate).
  - *Error (save failed):* `07` §6.1 pattern — "Something went wrong saving your plan. Your funds are safe. Try again." + retry; no data lost.
- **Trust touchpoint:** **adjustability + "why this?" = honest autonomy** (brief §2.3); the mandate paragraph restates the **AI-proposes/you-sign** control model; "change anytime."
- **Benchmark:** Wealthfront "personalized risk assessment + adjustable tolerance + 'why this risk score?' FAQ" (research §4); Betterment goal-vs-target framing.

### 5.7 — Step 7: First-recommendation preview (tied to the goal)
- **Purpose:** Pay off the mandate immediately with a **preview** of what the AI would suggest, **tied to the stated goal** (brief §2.3 "tied back to your goal"; `spec.md` US-3 spirit). This previews the relationship; it is **not** an execution.
- **Anatomy:** 1–3 **RecommendationCard previews** (the same card spec as Flow 4/Chat, used read-only here):
  - **"AI suggestion — you approve & sign"** `Badge` (spark-tint, `07` §2.1 verbatim) — mandatory on every rec card.
  - Rank/fit line: "Fits your plan: Lower risk, steady yield."
  - **Net APY** readout — **"{X}% net APY (estimate · see breakdown)"** (`07` §5.2; never bare APY), with the breakdown one tap away (base Aave supply − 0% fee). **Do not lead the card with the number** (`07` §9.1 #3) — lead with fit/why.
  - **Risk chip** from §2.5 (Lower · 1/5 for the launch vault).
  - "Estimates, not guarantees." micro-line (`07` §3.3).
  - **≤2 actions** (OpenAI Apps SDK, `04` §11): primary "Review this move" (routes to simulation+sign via `/confirm` — **never** one-click execute, `07` §2.2/§9.1 #4) and secondary "Not now". A **"Why this?"** disclosure.
  - At launch, the realistic single live option is the **Aave Yield Vault (Risk 1)**; if the goal implies higher risk, the preview honestly shows the closest in-policy option + a note (whitelisted protocols only — `spec.md` FR-016).
- **Desktop:** stacked rec cards in the column; primary CTA per card; a footer "Take me to chat" continues without acting.
- **Mobile:** full-width stacked cards; bottom-anchored "Continue to chat".
- **States:**
  - *Default:* 1–3 preview cards.
  - *Loading:* skeleton cards while recs compute (`04` §7).
  - *Empty / not-enough-context:* honest no-bluff copy (`07` §2.6) — "I don't have enough to suggest a specific move yet — let's head to chat and I'll learn as we go." + "Continue to chat". (Avoids fabricating a rec.)
  - *Above-launch-support:* card honestly notes only the Lower-risk vault is live; offers it + "more strategies as vaults open."
  - *Error (recs unavailable):* `07` §6.1 — degraded copy, "you can still continue to chat and your funds are safe"; never blocks completion.
- **Trust touchpoint:** the AI-suggestion badge + "you approve & sign" + "Review this move" (routes to sign, not execute) makes the **propose→guardrail→sign** model legible on first contact (brief §6; `07` §9.1 #4).
- **Benchmark:** Wealthfront "first recommendation tied to goal" (research §4); Hey Anon/Griffain conversational action cards; OpenAI Apps SDK ≤2-action inline cards.

### 5.8 — Completion (onboarding-complete / celebration)
- **Purpose:** Confirm the mandate is set, give a **brief, non-hypey** celebratory beat (`04` §7 — "one satisfying beat, never confetti/casino"), and route to the hub.
- **Anatomy:**
  - A compact success affordance: a single `--success` check-draw (`04` §7, ≤400ms; respects reduced-motion) + plain headline ("Your plan is set.").
  - One-line recap of the mandate (tier + goal) and the control reminder ("The AI will suggest; you approve and sign.").
  - **Primary CTA:** "Go to chat" / continue → `/chat` primed (`01-IA` §5 Stage C). Secondary: "View my plan" → `/settings/mandate` or the mandate card.
  - Reassurance: "Change any of this anytime in Settings."
- **Desktop / Mobile:** centered; minimal; CTA prominent (bottom-anchored on mobile).
- **States:** *Default* (success). *Reduced-motion* (instant check, opacity cross-fade — `04` §7). *Error on redirect* (rare) = land on `/chat` regardless; mandate already saved.
- **Trust touchpoint:** the recap restates the control model; badge + disclaimer persist into chat.
- **Benchmark:** Acorns/Userpilot celebratory-but-calm completion (research §4); Wealthfront feedback-without-distraction (`04` §7).

---

## 6. Component inventory → shadcn/ui mapping (this flow)

| Onboarding component | shadcn/ui primitive(s) | Notes / `04` ref |
|---|---|---|
| Onboarding shell | `(onboarding)/layout.tsx` + Tailwind | Focused shell; badge + disclaimer persist (`01-IA` §1). |
| Progress stepper | custom + `Progress` style | Spark fill; tappable completed steps; "Step n of 6" (§3). |
| Non-custodial badge → prove-it | `Badge`→`Sheet`(mobile)/`Dialog`/`HoverCard`(desktop) | `04` §11; `01-IA` §2.3. |
| Wallet chip | `DropdownMenu` + `Badge` (Base) | Truncated mono address; menu → permissions/disconnect. |
| AI disclaimer strip | `Alert` (info) + `Collapsible` | Persistent; `07` §3. |
| AI turn / message | custom bubble on `Card` + spark avatar | AI presence styling (`04` §9). |
| Experience / timeline chips | `ToggleGroup` of `Card`/chip items | Selected = spark ring (`04` §11). |
| Goal chip cards | selectable `Card` / `RadioGroup` of cards | Single-select; risk-hint `Badge`. |
| Target-amount input | `Input` (`$`, tabular) | Validated; helper text. |
| Timeline slider (optional) | `Slider` | Prefer chips; slider optional (§5.4). |
| Risk scenario cards | `RadioGroup` of `Card`s | The wedge (§5.5); spark ring selected. |
| Literacy tip | `Card` + `Popover`/`HoverCard` (`TipCard`) | `--info` blue, dismissable (`07` §4.2). |
| Mandate summary | `Card` + risk `Badge` + `Slider` + segmented meter | Adjustable; `04` §11 "Resulting mandate summary". |
| "Why this profile?" | `Accordion` / `Popover` / mobile `Sheet` | Progressive disclosure. |
| Higher-risk caution | `Alert` (warning/amber) + icon | Informational, not sign-blocking (§5.6). |
| First-rec preview | `Card` + `Badge` (AI-suggestion, risk) + ≤2 `Button` + "Why this?" `Popover` | Routes "Review this move" → `/confirm` (never one-click). |
| Primary CTA | `Button` `variant="default"` (spark) | One per view (`04` §11). |
| Secondary / back / skip | `Button` `secondary`/`outline`/`ghost` | Never spark. |
| Completion success | `--success` check (motion `04` §7) + `Card` | Calm beat; reduced-motion fallback. |
| Save/persist failure | `Sonner` toast + `Alert` | `07` §6.1/§6.4. |
| Loading | `Skeleton` | Every async step (`04` §7). |

---

## 7. Cross-cutting states, persistence, and edge cases

### 7.1 The six required states, per step
Every step must ship: **default · empty · loading · success · warning · error** where applicable (brief §4; `04` AC#9). Mapping summary:
- **Loading** = `Skeleton` (never spinner over stale data, never `0` placeholder — `07` §5.5).
- **Empty** = mainly Step 7 (no recs yet) and resume-with-no-progress; use `07` §6.2 invitation pattern.
- **Warning** = Step 6 above-launch-risk caution (amber, informational); risk acknowledgement here is *not* a sign-gate (no transaction in onboarding).
- **Error** = `07` §6.1 (what/why/next-step, no blame, no raw tech, custody reassurance); persistence failures → toast + retry, **never lose entered answers**.
- **Success** = step advance (subtle) and final completion (one beat, `04` §7).

### 7.2 Empty / first-contact specifics
- Step 0 returning-user-with-progress = "Resume" variant (§5.0).
- Step 7 empty = honest "not enough context yet → continue to chat" (§5.7) — **never fabricate a recommendation** (`07` §2.6, §9.1 #4).

### 7.3 Persistence & resume (under-5-min support, SC-007)
- **Every answer persists immediately** (optimistic), so back/forward and abandon/resume never lose data.
- **Resume:** `/onboarding` router lands on the **last incomplete step**; completed steps are editable via the tappable stepper.
- **Back:** preserves all entered data; re-answering downstream steps invalidates only dependent computed values (e.g., changing scenarios recomputes the proposed tier in Step 6) — surfaced honestly ("Your suggested risk updated based on your new answers").
- **Edit-from-Settings:** `/settings/mandate` re-enters at Step 6 (review) pre-filled, or offers a full re-run (`spec.md` FR-004; `01-IA` §4.2.1).

### 7.4 Gating / degraded regressions mid-flow (`01-IA` §6)
- **Disconnect:** redirect `/connect?next=/onboarding`; progress preserved.
- **Wrong network:** inline "Switch to Base" block on Continue (Step 1+).
- **Whitelist/geo fail:** → `/unavailable`, which **still surfaces withdraw-always** (custody never gated, brief §2.2; `01-IA` §6).
- **Backend/AI degraded:** Steps 5–7 (which may need model/recs) degrade gracefully — scenarios can be static; the mandate is computed deterministically where possible; Step 7 falls back to "continue to chat"; **completion is never blocked** by AI availability. Custody/exit unaffected.

### 7.5 Accessibility (required, `04` §10)
- Full **keyboard operability**: stepper, chip groups (`ToggleGroup`/`RadioGroup` roving focus), slider (arrow keys), CTAs, overlays (Esc closes). Tab order logical top→bottom.
- **Visible 2px spark focus ring + offset** on every control (`04` §10.3).
- **Never color-only:** risk tier always carries numeric step + word label + meter; selection state carries a ring + (where dense) a check, not color alone (`04` §10.2).
- **44px touch targets** on mobile (chips, slider thumb, CTAs — `04` §4.3).
- **Reduced motion** honored on progress fill, AI "thinking", completion check (`04` §7).
- **Screen-reader:** AI turns labeled as assistant; the non-custodial badge announces its state; the slider announces tier value + label; charts (none expected here, but any meter) carry `aria-label`.
- **AA contrast** both themes (dark default).

### 7.6 Copy & number conformance (defer to `07`)
- All buttons verb-first, specific (`07` §2.2): "Get started", "Continue", "Set my plan", "Review this move", "Not now". **Banned:** "Finish"/"Complete onboarding" for the mandate CTA, "Confirm/OK/Submit" anywhere, any hype/urgency, emoji (`07` §9.3).
- **No bare APY** anywhere in the preview (`07` §5.2); **no return-led** screens (`07` §9.1 #3); **no guaranteed-returns** language (`07` §9.1 #2).
- Sentence case, second person, present/active voice (`07` §1.4).
- Tabular numerals on any figure (target amount, APY, tier n/5) (`04` §3.1; `07` §5).

---

## 8. Benchmark references (named, per `00`/research)

- **Robo-advisor onboarding (the spine):** **Wealthfront** (conversational/human welcome; experience segmentation; limited goal set; Path timeline; personalized risk assessment + adjustable tolerance + "why this risk score?" FAQ) and **Betterment** (goals-based, goal-vs-target framing) — research §4, brief §2.3.
- **Scenario-based risk capture (not a slider):** robo-advisor risk-profiling best practice ("how would you react to a 20% drop?") — research §4; brief §2.3.
- **Just-in-time literacy:** **Acorns** (embedded basics during setup), **Wise** (empathetic copy for sensitive asks), Userpilot onboarding patterns — research §4; `07` §4.
- **Conversational action cards / ≤2 actions:** **OpenAI Apps SDK** inline cards (≤2 actions), **Cloudscape** gen-AI chat (selectable suggested replies, loading states, disclaimers), **Hey Anon / Griffain** (DeFi-by-conversation) — research §1.
- **Self-custody trust framing:** **Ledger / Trust Wallet** ("you don't have to trust us"; keys never leave you) — research §6; `07` §2.1/§7.
- **Sign-routing (preview → review+sign, never one-click):** **Tenderly** preview + **Rabby** "review before sign" — research §5 (the first-rec "Review this move" routes here, not to execution).

---

## 9. Acceptance criteria (this flow conforms when ALL hold)

1. **Mandate produced & confirmed.** The flow yields a persisted, human-readable mandate (experience, goal, timeline, risk tier 1–5, plain-language paragraph), **shown back for confirmation before it takes effect**, and editable later (`spec.md` FR-002/003/004; SC-007).
2. **Scenario-based risk, not a slider, captures tolerance.** Risk tier is derived from **scenario cards** (the wedge), with the result then **adjustable** via a slider on the review screen and a **"why this profile?"** explanation (brief §2.3; `spec.md` US-3; research §4).
3. **Goals-first, limited set, tied to the goal.** Goal selection uses a deliberately limited chip set; the first-rec preview is explicitly **tied to the stated goal** (brief §2.3; research §4).
4. **Under-5-minute path.** Default happy path is completable in <5 min: ≤6 input steps, chips over free text, persistence/resume, no forced lessons (SC-007; `07` §4.1).
5. **Non-custody visible on first contact.** Welcome leads with the non-custodial promise; the **non-custodial badge + prove-it panel** and a **withdraw/exit path** are reachable in **≤1 tap on every step**, both desktop and mobile (brief §2.2; `01-IA` §0.1/AC#3).
6. **AI authority is honest throughout.** The connect step states user-owned keys; the mandate restates "AI suggests, you approve & sign"; the first-rec preview carries the **"AI suggestion — you approve & sign"** badge and **"Review this move" routes to simulation+sign — never a one-click execute** (`07` §2.1/§2.2/§9.1 #4).
7. **Persistent AI disclaimer.** Full or compact disclaimer visible on every step; risk + custody clauses **verbatim and unsoftened** (`07` §3).
8. **Honest numbers / no return-led surfaces.** No bare APY (all "net APY · estimate · see breakdown"); **no screen leads with a return number**; no guaranteed-returns language; tabular numerals everywhere financial (`07` §5/§9.1; `04` §3.1).
9. **Reassurance + autonomy.** "You can change this later" is present on input steps and the mandate; the mandate is **adjustable** (override allowed) (brief §2.3, §11).
10. **Progress + literacy.** A persistent, honest progress indicator (tappable completed steps) and contextual, non-condescending literacy tip cards (`--info` blue, dismissable) are present (brief §11; `07` §4).
11. **All states, both breakpoints.** Every step ships default/empty/loading/success/warning/error as applicable, at **390px mobile and 1440px desktop**; Dialog→Sheet on mobile; the "why this?" + prove-it overlays adapt (brief §4; `04` AC#9).
12. **Design-system + content conformance.** Token-only color with spark scarcity (≤1 spark CTA/view; spark only on AI presence/progress/focus), strict semantics, risk palette reused with numeric/label fallback, full keyboard + 44px targets + visible spark focus ring + reduced-motion (`04` AC); sentence case, second person, verb-first specific buttons, banned words avoided (`07` AC).
13. **shadcn-mappable.** Every component resolves to a primitive in §6 / `04` §11; inline rec cards honor ≤2 actions (OpenAI Apps SDK).
14. **Degraded-safe completion.** Whitelist/geo/network/backend regressions are handled per `01-IA` §6 **without ever removing the withdraw path**, and AI/backend unavailability never blocks producing/confirming the mandate or reaching chat.

---

## 10. Cross-references

- **Routes:** `01-information-architecture.md` §1 `(onboarding)` segment, §5 Stage C journey, §6 gating/degraded.
- **Shell / persistent trust elements:** `01-IA` §2 (badge, wallet chip, disclaimer strip, prove-it panel).
- **Tokens / palettes / motion / a11y / shadcn map:** `04-design-system.md` (§2 color, §2.5 risk palette, §3 type, §7 motion, §10 a11y, §11 component map).
- **All wording / disclaimer / number formatting / banned phrases:** `07-content-and-tone.md` (§2 motifs, §3 disclaimer, §4 literacy, §5 numbers, §6 error/empty, §8 onboarding exemplars, §9 DOs/DON'Ts).
- **Product/scope source of truth:** `00-brief.md`; `specs/001-sparkpoint-pivot-mvp/spec.md` (FR-001–004 onboarding, SC-007); high-level plan v2.
- **Downstream flows referenced:** Chat (Flow 2), Strategies (Flow 4 — RecommendationCard), Vault (Flow 5), Confirmation (Flow 6 — where "Review this move" routes), Trust Center (prove-it / exit).
