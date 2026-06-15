# 07 — Content & Tone (Voice, Microcopy, Disclaimers, Number Formatting)

> **Audience:** Claude Design (high-fidelity screen production) and anyone writing strings that ship in the W1–2 mockups. This is the **canonical wording layer** — when a screen needs a label, a button, an empty state, an error, a tip, or a disclaimer, the words come from here.
> **Status:** Authoritative content + tone spec for the design handover. Every flow doc (`01`…`NN`) defers to this file for *voice, microcopy patterns, the AI disclaimer, literacy tone, error/empty copy, and number/PnL formatting*. Where a flow doc shows placeholder copy that conflicts with a rule here, **this doc wins on wording**.
> **Reads-before:** `00-brief.md` §6 (brand & tone summary), §8 (non-goals — the wording bans live here), and `04-design-system.md` §3.4 (financial-number formatting — this doc carries the canonical version forward and extends it).
> **What this doc IS:** voice & tone definition, reusable microcopy patterns, the persistent AI disclaimer wording, financial-literacy tone, error/empty-state copy patterns, number/PnL/APY formatting rules, and a master DOs/DON'Ts list with banned and required phrases.
> **What it is NOT:** flow specs, screen anatomy, or visual tokens (those live elsewhere). It also does **not** write legal/Terms copy — only the in-product strings.
> **Hard rules carried from the brief (non-negotiable, wording-level):** never present APY without a breakdown; never imply or project guaranteed returns; never lead a surface with a return number; always say **"you approve & sign"**; always distinguish **AI proposal → deterministic guardrail → your signature**; always keep the **withdraw-always / exit** framing positive and empowering; never use hype adjectives; honest about risk and losses.

---

## 1. Voice & tone

### 1.1 The voice in one line

> **A competent, candid fund manager who works for you, shows their work, and never pretends.** Confident about the process, never about the outcome. The proof persuades; the prose just gets out of the way.

SparkPoint speaks like a trustworthy professional explaining money to a smart friend who isn't a specialist: **plain, precise, calm, and honest — especially about risk and losses.** The brand's entire credibility rests on *not* sounding like the 2024–25 "AI fund" cohort that over-promised and collapsed. Every sentence either *informs*, *clarifies control*, or *gets out of the way*. If a sentence only exists to impress, cut it.

### 1.2 Five voice principles

1. **Confident about process, humble about outcome.** We are sure about *how* the system works (non-custody, guardrails, signing, simulation) and we say so plainly. We are never sure about *returns* — markets are uncertain and we say that too. Confidence lives in verbs about control ("you sign," "you can always withdraw"), never in adjectives about gains.
2. **Transparent by default.** Show the mechanism. Name what the AI decides vs. what the deterministic policy decides vs. what only the user can do. When something is uncertain, say it's uncertain. When something is blocked, say why. Transparency is the product; the copy is its surface.
3. **Plain language over jargon.** Default to words a crypto-curious newcomer understands. When a DeFi term is unavoidable (APY, shares, slippage, ERC-4626), use it **and** define it inline or via a tooltip — never assume. Power users get the precise term; newcomers get the plain gloss one tap away (progressive disclosure, per `00-brief.md` §3).
4. **Never hypey.** No superlatives, no urgency manufacturing, no emoji in product copy, no exclamation marks in financial contexts, no "🚀/moon/degen/alpha" register. Excitement, if any, is earned by clarity, not punctuation. (Banned-words list: §9.3.)
5. **Honest about risk and losses.** We show losses as plainly as gains, tie them to the recommendation that caused them, and never soften with euphemism. A loss is "a loss," not "a temporary drawdown opportunity." Capital-preservation-first framing throughout (`00-brief.md` §3, §6).

### 1.3 Tone calibration (it shifts by moment, voice stays constant)

Tone is the voice adjusted for context. The voice never changes; the *temperature* does.

| Moment | Tone | Why |
|---|---|---|
| **Onboarding / first contact** | Warm, reassuring, unhurried; lead with "you're in control" and "you can always leave." | Newcomers are wary of "AI fund" hype; reduce fear first (`00-brief.md` §3 primary tier). |
| **Chat / everyday advice** | Direct, conversational, explanatory; a knowledgeable peer. | Primary surface; must feel like a relationship, not a button. |
| **Recommendations** | Measured, reasoned, balanced — always paired with "why" and the trade-off. | Honest autonomy is the trust lever (`00-brief.md` §2.3). |
| **Confirmation / signing** | Precise, factual, slightly more formal; no persuasion, just facts + control. | This is the money moment; persuasion here erodes trust. Mirror Rabby's sober tone. |
| **Errors / blocked actions** | Calm, specific, non-blaming, with a next step. | Never alarm; always actionable (§6). |
| **Losses / bad outcomes** | Plain, accountable, non-defensive; state it, tie it to the recommendation, offer the next decision. | Outcome accountability (`00-brief.md` §2.3). |
| **Literacy / tips** | Friendly, encouraging, never condescending; "here's how this works." | Learn-as-you-go (§4). |
| **Trust / non-custody** | Plain, structural, almost legalistic-confident — facts, not promises. | "Proven, not promised" (`00-brief.md` §2.2). |

### 1.4 Person, tense, register

- **Second person ("you")** for the user; **first person plural ("we" / "SparkPoint")** for the protocol/team; **"the AI" / "SparkPoint's AI"** for the model — never "I" (the assistant is a labeled tool, not a persona pretending to be human). In chat, the assistant may use a light first-person ("I looked at your wallet…") **only** when paired with the AI-presence styling and the persistent disclaimer; never let it imply a human or imply authority to act alone.
- **Present tense, active voice.** "You sign every transaction," not "Transactions will be signed by the user." Active voice keeps agency visible — critical for the non-custody story.
- **Sentence case** for all UI text (headings, buttons, labels, menu items). No Title Case, no ALL CAPS except the design-system's tracked eyebrow/badge labels (`04-design-system.md` §3.2). Tooltips, helper text, and microcopy: sentence case, terminal period only on full sentences (no period on labels/buttons/chips).
- **Reading level:** target roughly 8th–9th grade for retail-facing copy; technical precision is fine for the progressively-disclosed depth layers, but the *surface* stays plain.

---

## 2. Microcopy patterns (reusable)

These are the repeated string patterns. Use the canonical version; do not reinvent per screen. Tokens in `{braces}` are runtime values.

### 2.1 The recurring trust motifs (verbatim — reuse exactly)

These strings are **brand-load-bearing**; ship them word-for-word so users learn them by repetition (`00-brief.md` §5).

| Motif | Canonical string | Where it appears |
|---|---|---|
| **AI-suggestion label** | **"AI suggestion — you approve & sign"** | Badge on every recommendation/action card. Never shorten to "AI suggestion" alone; the "you approve & sign" half is the point. |
| **Non-custody badge** | **"Non-custodial"** (badge) → opens **"What SparkPoint can & can't do"** (panel title) | Persistent shell badge → "prove-it" panel. |
| **Withdraw-always** | **"Withdraw anytime — even if SparkPoint is offline"** | Exit affordance, Trust Center, degraded-mode banner. |
| **Kill-switch honesty** | **"Pause only — this can never block your withdrawals"** | Kill-switch status. Never call it "stop" or "lock." |
| **Self-custody one-liner** | **"Your keys. Your funds. Always."** | Trust Center header, onboarding reassurance. (Borrowed register from Ledger / Trust Wallet — `00-brief.md` §10.) |
| **AI vs. policy vs. you** | **"The AI proposes. Guardrails check it. You sign it."** | How-it-works, confirmation context, onboarding. The thesis in three beats. |
| **Net APY honesty** | **"{X}% net APY"** + always a breakdown link/disclosure | Every APY readout. Never a bare APY (§5.2, §9.1). |

### 2.2 Buttons & actions (verb-first, specific, never vague)

Buttons say exactly what happens. The user should know the consequence before clicking. **One primary (spark) action per view** (`04-design-system.md` §11).

| Intent | Use | Don't use |
|---|---|---|
| Sign a transaction | **"Review & sign"** → (in the sheet, after acks) **"Sign transaction"** | "Confirm", "OK", "Submit", "Go" |
| Deposit | **"Review deposit"** → **"Sign deposit"** | "Deposit now", "Invest" |
| Withdraw | **"Review withdrawal"** → **"Sign withdrawal"** | "Cash out", "Take profits" |
| Exit fully | **"Withdraw everything"** | "Exit", "Quit", "Leave" (too ambiguous in a money app) |
| Connect wallet | **"Connect wallet"** | "Get started" (for the wallet step specifically) |
| Set the mandate | **"Set my plan"** / **"Save my plan"** | "Finish", "Complete onboarding" |
| Accept a recommendation | **"Review this move"** (always routes to simulation+sign, never one-click) | "Accept", "Do it", "Apply" |
| Decline a recommendation | **"Not now"** / **"Skip"** | "Reject", "No" (too curt) |
| Grant automation | **"Grant scoped access"** | "Enable AI", "Let AI trade", "Automate" (hides the scope) |
| Revoke automation | **"Revoke access"** (positive, instant, prominent) | "Disable" (under-states the user's power) |
| Learn more | **"How this works"** / **"What's this?"** | "Learn more" (generic), "?" alone |
| Open prove-it panel | **"See what we can & can't do"** | "Permissions", "Details" |
| Acknowledge an alert | **"I understand"** (checkbox/ack) | "Dismiss", "Got it" (too casual for a guardrail) |

**Button rules:** verb-first; ≤3 words where possible; never label a money-moving button with a one-tap finality that skips simulation — **acceptance always routes to review+sign** (`01-information-architecture.md` §0.3). Destructive-styled buttons (`AlertDialog`) are reserved for *revoke / full exit*, and even then the **copy is empowering, not scary** (`04-design-system.md` §11) — these are the user exercising control.

### 2.3 Labels, units & helper text

- **Pair every figure with its unit and, where it could mislead, its basis.** "4.2% net APY" not "4.2%"; "{shares} spvUSDC ≈ ${value}" not a bare share count (`04-design-system.md` §3.4).
- **Helper text under inputs** states the constraint plainly: "Max {amount} (your beta cap)", "You'll receive ≈ {shares} spvUSDC", "Min withdrawal {amount}".
- **Caps & beta limits** are framed as *current limits*, not failures: "Beta cap: ${used} of ${cap} used" — neutral, not punitive.
- **Tooltips/definitions** (per `04-design-system.md` §11 `Tooltip`/`HoverCard`) follow the pattern: **plain definition first, then why it matters to you.** Example for APY: *"Annual percentage yield — your yearly return if the current rate held and earnings compounded. Rates change, so this is an estimate, not a promise."*

### 2.4 Confirmation/signing copy pattern

The confirmation surface (`Flow 6`) is fact-only. Pattern, top to bottom:

1. **What you're about to do** — one plain sentence: "You're depositing ${amount} into the Aave Yield Vault. You'll receive ≈ {shares} spvUSDC."
2. **Balance changes** — the simulation table; no prose persuasion (Tenderly benchmark).
3. **Guardrail checklist** — each item plain and binary: "✓ Within your beta cap", "✓ Slippage under your max", "⚠ Requires your acknowledgement: {reason}".
4. **The control reminder** — "Nothing moves until you sign. You can cancel now with no effect."
5. **Sign** — disabled until required acks are checked; disabled-state helper: "Acknowledge the {n} item(s) above to enable signing." (Rabby pattern, `04-design-system.md` §10.4.)

### 2.5 Success copy pattern

Plain, specific, with the proof and the next step — never celebratory hype (no confetti language; `04-design-system.md` §7).

- Pattern: **{what happened}, {the proof}, {next step}.**
- Deposit: "Deposit confirmed. You now hold {shares} spvUSDC (≈ ${value}). View transaction ↗" + "See it in your portfolio".
- Withdraw: "Withdrawal confirmed. ${amount} is back in your wallet. View transaction ↗"
- Revoke: "Access revoked. SparkPoint's AI can no longer act on your behalf. You sign everything from here."
- Always offer the **on-chain proof link** ("View transaction ↗") — proof, not promise.

### 2.6 In-chat assistant patterns

- **Thinking/tool-step:** "Reading your wallet…", "Checking current Aave rates…", "Simulating this move…" — present-continuous, honest about the step (`04-design-system.md` §7 "AI thinking"). Never fake progress.
- **Citations:** "Based on {source}" with a link; never assert a live number without a source affordance.
- **Uncertainty:** "I can't be sure {X} — here's what I do know:" Lead with the limit, then the substance.
- **No-data / can't-help:** "I don't have enough to answer that well yet. Here's what would help: {…}" — never bluff.
- **Every assistant turn** sits with the AI-presence styling and the persistent disclaimer in view (§3).

---

## 3. The persistent AI disclaimer

Per `00-brief.md` §5 and `04-design-system.md` §3.3, a persistent, readable-but-not-shouting AI disclaimer is required wherever the AI gives advice or proposes action. It renders as `text-xs` `--muted-foreground` in the chat footer / below the AI surface and is **always in view** during AI interaction (`04-design-system.md` §4.2 — disclaimer strip in the shell).

### 3.1 Canonical full disclaimer (persistent strip)

> **SparkPoint's AI is a tool, not a licensed advisor.** It suggests; deterministic guardrails check every suggestion; **you approve and sign every transaction.** Nothing here is financial advice or a guarantee of returns. Crypto carries risk, including loss of principal. **SparkPoint can never move or withhold your funds.**

### 3.2 Compact disclaimer (space-constrained / mobile chat footer)

> **AI suggests — you approve & sign. Not financial advice. Capital at risk. SparkPoint can't move your funds.**

### 3.3 Inline per-card micro-disclaimer

Every recommendation/action card carries the **"AI suggestion — you approve & sign"** badge (§2.1) — this *is* the per-card disclaimer; do not omit it to save space. For recommendations that reference yield/returns, append the one-liner: *"Estimates, not guarantees."*

### 3.4 Disclaimer rules

- **Never hide it behind a tap** on AI-advice surfaces; the full or compact version is always visible (compact is acceptable on mobile, full reachable in ≤1 tap via "More").
- **Never soften the risk clauses.** "Loss of principal" and "capital at risk" stay verbatim; do not euphemize to "market exposure."
- **Never let the disclaimer contradict a louder claim.** If a card implies certainty anywhere, the card is wrong, not the disclaimer (§9).
- **Tone:** factual and calm, not a scary wall — it's `text-xs muted`, present and legible, never a modal or a blocker (`04-design-system.md` §3.3).
- **The custody clause is mandatory** in the full version: "SparkPoint can never move or withhold your funds" — this is the structural truth, stated as fact (`00-brief.md` §2.2).

---

## 4. Financial-literacy tone (learn-as-you-go)

Per `00-brief.md` §3 (crypto-curious primary tier) and §9 (literacy hub + contextual tips), education is woven in, not walled off. Literacy content uses the **`--info` tone (blue), never green** (`04-design-system.md` §2.4 — don't tint education as "gain").

### 4.1 Principles

1. **Learn-as-you-go, not a course.** Teach the concept *at the moment it's needed* (contextual tip cards), in one or two plain sentences, with a "more" link to the hub for the curious. Never gate a flow behind a lesson.
2. **Never condescend.** Assume intelligence, not knowledge. "Here's how shares work" — not "Don't worry, this is easy!" Avoid "simply", "just", "easy", "obviously" (they shame the confused).
3. **Plain definition → why it matters to you → optional depth.** Three layers, progressively disclosed.
4. **Honest, even when teaching.** When explaining APY or yield, the lesson itself states the uncertainty: rates change, past ≠ future, principal can be lost.
5. **Empowering frame.** Education exists so the user can *judge our recommendations*, not blindly trust them — say so. "The more you understand, the better you can hold us accountable."

### 4.2 Tip-card pattern

- **Title:** the term or question, plain. "What's net APY?" / "What are vault shares?"
- **Body:** ≤2 sentences, definition + personal relevance.
- **Action:** "How this works" → literacy hub; dismissable; never re-nags after dismiss (respect the user).
- **Tone example (shares):** *"Shares (spvUSDC) are your slice of the vault. As the vault earns, each share is worth more — your share count stays the same, its value grows. You can redeem shares for USDC anytime."*

### 4.3 Term glossary tone (sample canonical definitions)

Reuse these as the tooltip/hub definitions so the same term reads the same everywhere:

| Term | Plain definition (canonical) |
|---|---|
| **Net APY** | "Your estimated yearly return after all costs, if the current rate held and earnings compounded. Rates change — it's an estimate, not a promise." |
| **Shares (spvUSDC)** | "Your slice of the vault. The count stays fixed; its USDC value grows as the vault earns. Redeem anytime." |
| **Slippage** | "How much the price can move against you between now and when the trade lands. We cap it so you can't be surprised." |
| **Non-custodial** | "Your funds stay in your control. SparkPoint can direct strategy but has no way to take, move, or hold your money." |
| **Guardrails** | "Deterministic rules that check every AI suggestion — caps, limits, allowlists — before you're ever asked to sign." |
| **Session key (automation)** | "A scoped, time-limited permission you grant for hands-off rebalancing — bounded by caps and limits, and revocable by you instantly." |
| **Kill-switch** | "An emergency pause on *new* deployments. It can never block your withdrawals." |

---

## 5. Number, PnL, APY & currency formatting rules

This section is the **canonical extension** of `04-design-system.md` §3.4. All financial figures use **tabular numerals** (`.tnum`, `04-design-system.md` §3.1) and right-align in tables.

### 5.1 Currency & amounts

- **Fiat:** `$1,234.56` — comma thousands, 2 decimals for balances/PnL. Always the `$` prefix; the app is USD-denominated at launch.
- **Abbreviation (dense cells only):** `$1.23M`, `$45.6K`, `$1.2B` — one decimal; **full precision on hover/tap** (`04-design-system.md` §3.4). The net-worth hero shows full precision, not abbreviated.
- **Crypto amounts (USDC):** `1,234.56 USDC` — token ticker as suffix, not symbol. Match decimals to the asset's meaningful precision (USDC: 2 in UI, full on tap).
- **Zero / empty value:** `$0.00`, never blank, never "—" for a real zero (reserve en-dash for *unknown/not-applicable*, §5.5).
- **Never** invent precision the data doesn't have; never pad fake decimals on an estimate without labeling it an estimate.

### 5.2 APY (the most-regulated number — strict)

- **Format:** one decimal + the word **"net"** + "APY": **"4.2% net APY"**. Never a bare "4.2%".
- **Breakdown is mandatory** (`00-brief.md` §8, §9.1 below). Every APY is accompanied by, or one tap from, its breakdown: base supply rate, any incentives (stated separately and honestly), minus fees (0-fee at launch, so state "0% fee" explicitly), = net. Pattern: *"4.2% net APY = 4.2% Aave supply rate − 0% SparkPoint fee."*
- **Never gross-first.** If a gross figure must appear, it appears *after* and *labeled* as gross; the lead number is always net.
- **Never projected/extrapolated.** Show current and historical only; no "could earn", no annualized-from-a-good-week (`04-design-system.md` §6.4 honesty rule).
- **Always estimate-framed:** APY is a rate, not a return. Pair with "rates change" wherever it leads a surface.
- **Range, not point, when honest:** where the rate is volatile, "≈ 4.0–4.4% net APY (30-day range)" is preferable to a false-precise single number.

### 5.3 PnL (gains & losses — symmetric, honest)

- **Format:** absolute + percent, signed, colored, with directional triangle: **`+$312.40 (+2.8%)`** gain / **`−$88.10 (−0.7%)`** loss (`04-design-system.md` §2.4, §3.4).
- **Sign + color + icon, always together** (never color alone — AA, `04-design-system.md` §10.2): gain = `--gain` + up-triangle + `+`; loss = `--loss` + down-triangle + `−` (true minus `−`, U+2212, not hyphen); flat = `--muted-foreground` + en-dash, no sign.
- **Losses are shown as plainly as gains.** No hiding red, no "unrealized" softening that obscures a real loss, no defaulting the time-range to a flattering window. The outcome log shows **both wins and losses** (`00-brief.md` §9), each tied to its originating recommendation.
- **Time-basis labeled:** PnL always states its window — "+2.8% (1M)", "−0.7% (today)". A naked PnL is ambiguous and therefore banned.
- **Realized vs. unrealized:** label explicitly when both could be meant; never let unrealized read as banked.

### 5.4 Shares (ERC-4626)

- **Format:** `1,024.5031 spvUSDC` (share ticker), with a **fiat equivalent beneath** in `--muted-foreground`: `≈ $1,031.20` (`04-design-system.md` §3.4).
- Always make clear the share count is fixed and value floats (literacy, §4.3) on first encounter / hover.

### 5.5 The en-dash, unknown, and loading

- **`—` (en-dash, `--muted-foreground`)** = unknown / not-applicable / no-data-yet. **Not** zero (zero is `$0.00`).
- **Loading** = skeleton shimmer, never a spinner over a stale number, never `0` as a placeholder for "loading" (`04-design-system.md` §6.1, §7).
- **Stale data** must be labeled: "as of {time}" or a subtle stale indicator — never present old as live.

### 5.6 Dates, times, addresses

- **Relative for recency** ("2 min ago", "yesterday"), **absolute on hover** ("Jun 15, 2026, 14:32 UTC"). Timestamps in UTC with the label, or local with a clear tz indicator — pick one and be consistent.
- **Addresses / hashes:** mono font, truncated middle `0x1234…abcd`, full on hover/tap, with copy affordance (`04-design-system.md` §3.1, §8).

---

## 6. Error & empty-state copy patterns

Every state from the brief (default / empty / loading / success / warning / error) needs copy. Loading = skeletons (no copy or "Loading…" only if unavoidable). Below are the patterns for the copy-bearing states. Map to `Alert` / empty-state `Card` / `Sonner` toast (`04-design-system.md` §11).

### 6.1 Error copy pattern (the formula)

> **{What happened, plainly} + {why, if known} + {what you can do next}.** Calm, specific, never blaming the user, never raw technical strings exposed.

- **No blame:** "We couldn't reach the network" — not "You did something wrong" / "Invalid input."
- **No naked tech:** never surface a raw RPC error, stack trace, or revert string to the user; translate it. (A "Details" disclosure for power users may show the raw string.)
- **Always a next step:** retry, adjust, wait, or contact — never a dead end.
- **Custody reassurance on failure:** when a *transaction* fails, reassure: "Nothing moved — your funds are untouched." (This is the moment custody anxiety spikes; address it.)

| Situation | Copy |
|---|---|
| Network/RPC unreachable | "We couldn't reach Base right now. Your funds are safe and untouched. Try again in a moment." + "Retry" |
| Transaction rejected by user | "You cancelled the signature. Nothing moved." (neutral — cancelling is fine) |
| Transaction reverted on-chain | "The transaction didn't go through, so nothing moved. {Plain reason if known}. You can review and try again." + "Review again" |
| Guardrail blocked the action | "Blocked by your guardrails: {plain reason, e.g. 'this would exceed your beta cap'}. Adjust the amount or your limits to continue." (red `--destructive`, `04-design-system.md` §2.4) |
| Slippage exceeded | "Prices moved more than your slippage cap, so we stopped the trade to protect you. You can raise your cap or try again." |
| Cap reached | "You've reached your beta cap (${cap}). You can still withdraw anytime. New deposits open as caps lift." |
| Not whitelisted / geo-blocked | "SparkPoint's beta isn't open to you yet. You can join the waitlist." — **and**, if they hold funds, always surface withdraw-always (`01-IA` §0.6). |
| Wallet connection failed | "We couldn't connect your wallet. Make sure it's unlocked and on Base, then try again." + "Try again" |
| AI/agent unavailable (degraded) | "SparkPoint's AI is temporarily unavailable. You can still view your portfolio and **withdraw anytime** — your funds never depend on us being online." |
| Generic unknown | "Something went wrong on our end. Your funds are safe. Try again, or contact support if it persists." |

### 6.2 Empty-state copy pattern (the formula)

> **{What's empty, neutrally} + {why that's normal/what it means} + {the one next action}.** Empty is an invitation, never a failure. Map to empty-state `Card` + Lucide icon + microcopy + optional CTA (`04-design-system.md` §6.1, §11).

| Surface | Title | Body | CTA |
|---|---|---|---|
| Portfolio (no funds) | "Nothing here yet" | "Once you deposit, your balance, yield, and risk show up here." | "Explore the vault" |
| Chat (first open) | "Hi — I'm SparkPoint's AI." | "Tell me your goal, or ask me anything about your wallet. I suggest; you approve and sign." | (suggested-prompt chips) |
| Outcome log (no history) | "No moves yet" | "Every recommendation you act on — wins and losses — will be logged here, tied to the advice that caused it." | — |
| Notifications | "You're all caught up" | "Transaction results and important alerts will appear here." | — |
| Strategy recs (none yet) | "No recommendations yet" | "Once I understand your goal and see your wallet, I'll rank strategies here with the reasons behind each." | "Set my plan" |
| Vault (pre-deposit) | "Aave Yield Vault" | "Conservative, capital-preservation-first yield on USDC. {X}% net APY (estimate). Non-custodial — withdraw anytime." | "Review deposit" |
| Search/filter no results | "No matches" | "Try a different filter." | "Clear filters" |

### 6.3 Warning state copy

Warnings (`--caution` amber, `04-design-system.md` §2.4) are for **acknowledge-required** moments, not errors. Pattern: state the risk plainly + what acknowledging means.

- "Heads up: this move is higher-risk than your plan ({your tier} → {move tier}). Acknowledge to continue, or adjust your plan." → ack checkbox "I understand this is above my risk plan."
- Sign stays disabled until acknowledged (`04-design-system.md` §10.4).

### 6.4 Toast (Sonner) copy

Short, semantic, with proof link where relevant: "Deposit confirmed · View tx ↗" / "Signature cancelled" / "Couldn't reach Base · Retry". ≤1 line; the detail lives in the surface, not the toast.

---

## 7. Trust & non-custody copy (proven, not promised)

Per `00-brief.md` §2.2, the five structural guarantees must be *stated as fact*, in plain language, never as marketing promises. Tone: structural-confident, almost legalistic in its certainty about the mechanism.

| Guarantee | Canonical user-facing copy |
|---|---|
| No-admin-withdrawal | "We have no way to send your funds anywhere but back to you. There's no admin withdrawal — not by us, not by anyone." |
| Withdraw-always escape hatch | "You can withdraw directly on-chain, even if SparkPoint's app and AI are completely offline." |
| User-owned keys | "You own your keys and your account. We never generate a wallet for you or hold your keys." |
| Scoped, revocable automation | "Any automation you grant is scoped, capped, time-limited, and revocable by you instantly — without our help." |
| Non-upgradeable custody | "The vault is single-purpose and non-upgradeable. Any pause control governs pausing only — never your funds." |

- **Prove-it panel framing:** title "What SparkPoint can & can't do", two columns — **"Can"** (direct strategy, suggest moves, simulate, pause new deployments) and **"Can't"** (move your funds, withdraw to itself, change the rules, stop you withdrawing). Plain verbs; the "Can't" column is the trust payload.
- **Never** phrase custody as a promise ("we promise we won't…") — phrase it as a structural impossibility ("we have no code path to…"). Promises are what the failed cohort made; structure is what we offer.

---

## 8. Worked microcopy examples (per core flow)

Reference strings showing the voice in situ. These are exemplary, not exhaustive — flow docs may add, but must not contradict the rules above.

- **Onboarding (scenario card):** "Your $1,000 drops to $800 in a week. What do you do?" → options in plain language ("Sell to stop the bleeding" / "Hold and wait" / "Buy more while it's low"). Result: "Based on your answers, here's your plan — capital-preservation-first. You can adjust it anytime."
- **Mandate summary:** "Your plan: **Lower risk (1/5)**, capital preservation first, target steady USDC yield. The AI will only suggest moves that fit this. You approve and sign each one."
- **Chat recommendation card:** Badge "AI suggestion — you approve & sign". Body: "Aave's USDC rate rose to 4.3% net APY. Moving your idle USDC in could earn more, at the same low risk. Estimates, not guarantees." Actions: "Review this move" / "Not now". "Why this?" disclosure.
- **Vault deposit:** "Deposit USDC into the Aave Yield Vault. {X}% net APY (estimate · see breakdown). You'll receive ≈ {shares} spvUSDC. Withdraw anytime." Helper: "Max ${cap} (your beta cap)."
- **Confirmation:** "You're depositing ${amount}. You'll receive ≈ {shares} spvUSDC. Nothing moves until you sign." + guardrail checklist + "Sign deposit" (disabled until acks).
- **Outcome log (a loss):** "−$88.10 (−0.7%, 1M) · from the Jun 2 rebalance recommendation. The rate dropped after the move. View tx ↗ · See the original advice." — stated plainly, tied to its cause, no excuse.

---

## 9. DOs & DON'Ts (master list)

### 9.1 DON'Ts — never (these are brief-level bans, `00-brief.md` §6, §8)

1. **Never present APY without a breakdown.** No bare "4.2%". Always net, always with the supply-rate/incentive/fee disclosure one tap away (§5.2).
2. **Never imply or project guaranteed returns.** No "you'll earn", "guaranteed", "risk-free", "safe returns", projected/extrapolated APY, or annualized-from-a-good-window numbers. Yield is always an estimate; principal is always at risk (§5.2, §9.3).
3. **Never lead a surface with a return number.** Lead with control, transparency, risk posture — *then* show yield (`00-brief.md` §8 — no return-projection-led surfaces).
4. **Never imply the AI can act alone or has final authority.** Every recommendation carries "AI suggestion — you approve & sign"; acceptance always routes to simulation + signing; never a one-click money-mover that skips review (§2.2).
5. **Never blur AI vs. policy vs. user.** Always distinguish what the AI proposes, what the deterministic guardrails check, and what only the user can do/sign (`00-brief.md` §6, §7.2).
6. **Never frame custody as a promise or imply we hold funds.** No "we'll keep your funds safe", "we manage your money", "trust us". State structural impossibility, not promises (§7).
7. **Never make the kill-switch sound like it can stop withdrawals.** It's pause-only; say so (§2.1, §4.3).
8. **Never hide or soften the AI disclaimer or the risk clauses.** "Capital at risk", "loss of principal" stay verbatim and visible (§3).
9. **Never use hype, urgency, or casino register.** No emoji in product copy, no exclamation marks on financial figures, no countdowns/FOMO, no "🚀/moon/degen/alpha/printing/aping" (§9.3).
10. **Never expose raw technical errors** (RPC strings, reverts, stack traces) as user copy; translate them (§6.1).
11. **Never present old data as live**, never use `0` as a loading placeholder, never invent precision (§5.5).
12. **Never condescend in literacy copy** ("simply", "just", "easy", "obviously", "don't worry") (§4.1).
13. **Never color a number by sign without also using sign + icon** (AA, `04-design-system.md` §10.2).
14. **Never hide a loss** or default to a flattering time-window; show wins and losses symmetrically (§5.3).

### 9.2 DOs — always

1. **Always say "you approve & sign"** on every recommendation, and route acceptance through review + simulation + signature (§2.1, §2.2).
2. **Always show net APY with a breakdown** and frame it as an estimate (§5.2).
3. **Always lead with control and transparency**, let proof persuade (§1.1).
4. **Always pair semantic color with icon + text/sign** (§5.3).
5. **Always state the basis/time-window** on any PnL or rate (§5.2, §5.3).
6. **Always offer a next step** in errors and an action in empty states (§6).
7. **Always reassure on transaction failure** that funds didn't move (§6.1).
8. **Always keep withdraw/exit framing positive and ever-present** (§2.1, §7).
9. **Always use plain language first, define jargon inline** (§1.2.3, §4).
10. **Always distinguish AI proposal → guardrail → your signature** (§2.1, §7).
11. **Always use tabular numerals, sentence case, second person, active voice** (§1.4, §5).
12. **Always state custody as structural fact** ("no code path to…"), never as a promise (§7).

### 9.3 Banned words/phrases vs. preferred

| Banned (hype / misleading / custodial) | Preferred (plain / honest / self-sovereign) |
|---|---|
| guaranteed / risk-free / safe returns / can't lose | "estimate", "capital at risk", "aims to", "historically" |
| you'll earn / will earn / projected returns | "could earn (estimate)", "current rate is", "if the rate held" |
| best / #1 / revolutionary / unbeatable / next-gen | (omit; let the mechanism speak) |
| 🚀 / moon / degen / ape / alpha / printing / WAGMI | (no slang, no emoji in product copy) |
| we manage / we hold / let us handle / trust us | "you direct, you sign", "you stay in control" |
| simply / just / easy / obviously / don't worry | (omit; explain plainly without minimizing) |
| confirm / OK / submit (on money buttons) | "Review & sign", "Sign deposit", specific verbs (§2.2) |
| cash out / take profits / exit (ambiguous) | "Withdraw", "Withdraw everything" |
| enable AI / let AI trade / automate | "Grant scoped access" (names the scope) |
| stop / lock funds (for kill-switch) | "Pause new deployments (never blocks withdrawals)" |
| drawdown opportunity / temporary dip (for a loss) | "a loss", "down ${x} (−y%, {window})" |
| 4.2% (bare) | "4.2% net APY (estimate · see breakdown)" |

---

## 10. Acceptance criteria (content conformance)

A screen/string conforms to this content spec when **all** hold:

1. **Voice intact.** Confident about process, humble about outcome; plain, transparent, non-hypey; honest about risk and losses (§1). No banned words/phrases (§9.3).
2. **Trust motifs verbatim.** "AI suggestion — you approve & sign", "Non-custodial" → "What SparkPoint can & can't do", "Withdraw anytime…", "Pause only — never blocks withdrawals" appear word-for-word where the flow calls for them (§2.1).
3. **AI disclaimer present.** Full or compact persistent disclaimer visible on every AI-advice surface; risk + custody clauses verbatim and unsoftened; every recommendation card carries the AI-suggestion badge (§3).
4. **APY rule satisfied.** No bare APY anywhere; every APY is net, estimate-framed, with a breakdown ≤1 tap away; no projections (§5.2, §9.1).
5. **No guaranteed/led-with returns.** No guarantee language; no surface leads with a return number; capital-preservation-first framing (§9.1).
6. **Authority is honest.** AI proposes / guardrails check / user signs is distinguished in copy; acceptance routes to review+sign; no one-click money-movers; no implication the AI acts alone (§2.2, §9.1).
7. **Custody as structure, not promise.** Custody copy states structural impossibility ("no code path to…"); kill-switch shown as pause-only; withdraw-always positive and ever-present (§7, §2.1).
8. **Numbers formatted to spec.** Tabular; currency/PnL/shares per §5; PnL = sign + color + icon + window; en-dash for unknown vs. `$0.00` for zero; no fake precision; no stale-as-live (§5).
9. **Errors & empties to pattern.** Errors = what/why/next-step, no blame, no raw tech, fund-safety reassurance on tx failure; empties = neutral + invitation + one action; warnings gate signing until acknowledged (§6).
10. **Literacy non-condescending.** Learn-as-you-go tip pattern; `--info` (blue) not green; plain definition → personal relevance → optional depth; no shaming words (§4).
11. **Mechanics of style.** Sentence case, second person / present / active voice, verb-first specific buttons, jargon defined inline (§1.4, §2.2).
12. **Both breakpoints carry it.** Compact disclaimer + microcopy fit mobile without dropping the mandatory clauses; full versions reachable in ≤1 tap (§3.2, `00-brief.md` §4).
