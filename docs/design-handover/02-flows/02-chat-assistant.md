# 02 — Flow 2: Chat AI Assistant (Primary Surface)

> **Handover doc** for Claude Design. This file specifies the **Chat AI Assistant** — the product's primary surface and connective hub. It covers: the composer, suggested-prompt chips, streamed tool-step reasoning, the six structured cards (`RecommendationCard`, `ActionCard`, `PortfolioSnapshotCard`, `TipCard`, `OutcomeCard`, `ConfirmationCard`), sourced-citation popovers, thumbs feedback, the persistent AI disclaimer, and every conversational state (empty / thinking / streaming / success / warning / error / retry). Desktop (chat + side panels) and mobile (chat-native single column) are **equal-priority**.
>
> **Reads-before (authoritative, in order):**
> - `00-brief.md` — positioning, thesis, five non-custody guarantees, tone, non-goals.
> - `01-information-architecture.md` — Chat is the hub (`/chat`, `/chat/[threadId]`); cards deep-link into flows; all state changes funnel through `/confirm/[txIntentId]`; the persistent shell (badge, wallet status, AI disclaimer strip) wraps this surface.
> - `04-design-system.md` — tokens (spark accent = AI presence; semantic green/red/amber; risk palette; tabular numerals; AI "thinking" motion §7), and the component→shadcn map §11.
> - `07-content-and-tone.md` — **canonical wording wins on conflict.** All chat strings, the AI disclaimer (§3), the trust motifs (§2.1), button verbs (§2.2), and number formatting (§5) come from there.
> - `09-references.md` §1 — the named chat benchmarks (OpenAI Apps SDK ★★★, Cloudscape ★★★, Hey Anon ★★, Bankr/Griffain ★) and their canonical links.
>
> **What this doc is NOT:** it does not redefine the global shell (see `01` §2), the design tokens (see `04`), the canonical microcopy rules (see `07`), or the Confirmation flow internals (see Flow 6 / `/confirm`). It specifies the **in-chat** experience and how cards connect outward.
>
> **Scope reminder (carry into every screen):** Base only; single Aave Yield Vault (Risk 1 / Lower); SRK non-essential and never surfaced as a gate; beta-gated (whitelist + per-user caps + geo-fence); per-action signing is the default; the AI **proposes**, deterministic guardrails **check**, the **user signs**. The chat may *suggest* anything, but **nothing money-moving executes from chat** — acceptance always routes to `/confirm`.

---

## 0. The chat thesis (constraints on every chat screen)

1. **Chat is the hub, not a chatbot toy.** It is the default authenticated landing (`/chat`) and the connective tissue between Portfolio, Strategies, Vault, and Confirmation. Cards in chat **deep-link into** those flows and the user returns to chat.
2. **Structured cards over prose — always.** Any *actionable* or *data-bearing* assistant output renders as a typed card (the six below), never a wall of text. Prose is for explanation and conversation only. (OpenAI Apps SDK; Cloudscape.)
3. **≤2 actions per card.** One primary (spark) + at most one secondary. Card actions live at the card footer. No nested tabs, no deep drill-ins inside a card. (OpenAI Apps SDK rule.)
4. **The AI never has final authority — and the UI says so on every turn.** The persistent AI disclaimer is always in view; every recommendation/action card carries the **"AI suggestion — you approve & sign"** badge; money-moving acceptance always routes to simulation + signing at `/confirm`. There is **no one-click money-mover in chat.**
5. **Autonomy is honest, never opaque.** Tool-step reasoning ("Reading your wallet → Checking Aave rates → Simulating") is shown while the AI works. Numbers the AI cites carry a **source affordance**. The AI never fakes progress or asserts a live figure without a citation.
6. **Read-only renders without confirmation; data-changing always confirms.** A `PortfolioSnapshotCard` or `TipCard` is informational and needs no gate. A `RecommendationCard`/`ActionCard` that would move funds always routes through the `ConfirmationCard` / `/confirm` gate. (OpenAI Apps SDK.)
7. **Withdraw + prove-it are ≤1 tap away even here.** The shell's non-custodial badge, wallet status, and AI disclaimer strip persist above the chat (see `01` §2). The chat surface never hides the escape hatch.

---

## 1. Goal & entry points

### 1.1 Goal

Give the user a single conversational surface to **ask questions, understand their position, receive ranked recommendations, learn DeFi concepts in context, see how past advice performed, and initiate (but never finalize) actions** — with the AI's reasoning, sources, and the non-custody guarantees legible throughout. The chat must *feel like a relationship with a candid fund manager* (07 §1.1), not a command line.

### 1.2 Entry points (from `01` §4.3)

| Entry | Behavior |
|---|---|
| **Primary nav → "Chat"** | Desktop top-bar item; mobile center bottom-tab (default/center-weighted). Opens newest/active thread (`/chat`). |
| **Post-onboarding redirect** | After mandate confirmation → `/chat` with a **primed first assistant message** referencing the new mandate (see §5.2). |
| **Default authenticated landing** | First authed destination after connect+verify if onboarding already complete. |
| **"Ask AI" affordances on every flow** | Portfolio risk panel, Strategy "why this?", Vault, position detail each expose an "Ask AI" action that opens chat **pre-seeded** with context (e.g., "Explain my portfolio risk"). |
| **Command menu (`⌘K`)** | "Ask AI…" jumps to chat with the typed query staged in the composer. |
| **Notification deep-link** | A notification ("rate moved", "session key expiring") can open chat with the relevant card already rendered. |

### 1.3 Threads

- `/chat` = newest/active thread; `/chat/[threadId]` = a specific past conversation.
- A **thread switcher** lists prior conversations (title = first user message or AI-generated summary, relative timestamp). Desktop: left of the chat column or in a `Sheet`; mobile: a `Sheet` from a top-bar control.
- "New chat" is always available. Threads persist; the mandate and portfolio context carry across all threads (mandate is the spine, `01` §4.2).

---

## 2. Layout — desktop vs mobile

Both breakpoints are first-class (`00` §4, `04` §4.2). The chat column is the through-line at both sizes.

### 2.1 Desktop (1440px design canvas) — chat + side panels

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL (from 01 §2): top bar [logo · Chat·Portfolio·Vault·Strategies …  │
│   ● Non-custodial ▸ · Wallet 0x12…ab ▸ · ⌘K · 🔔 · avatar]                     │
│ AI DISCLAIMER STRIP — "AI suggestion. You approve & sign. SparkPoint never     │
│   holds your funds. [Prove it] [Exit anytime]"                                 │
├──────────┬──────────────────────────────────────────────┬─────────────────────┤
│ SECONDARY│  THREAD LIST   │  CHAT COLUMN (primary)        │ CONTEXT SIDE PANEL  │
│ NAV RAIL │  (collapsible) │  ┌─────────────────────────┐  │ (collapsible)       │
│ (01 §2)  │  • Today        │  │ message stream (scroll)  │  │ • Mandate summary    │
│          │  • Funding plan  │  │  user / AI bubbles       │  │   (risk 1/5 chip)    │
│          │  • Risk Qs       │  │  structured cards inline │  │ • Portfolio snapshot │
│          │  + New chat      │  │  tool-step ticker        │  │   (net worth, PnL)   │
│          │                  │  └─────────────────────────┘  │ • Quick links:       │
│          │                  │  [ suggested-prompt chips ]   │   Portfolio·Vault·   │
│          │                  │  ┌─────────────────────────┐  │   Strategies·Trust   │
│          │                  │  │ COMPOSER  [textarea] [↑] │  │ • Active session key │
│          │                  │  └─────────────────────────┘  │   status + Revoke    │
│          │                  │  AI disclaimer (compact link) │  │                      │
└──────────┴──────────────────┴───────────────────────────────┴──────────────────┘
```

- **Three flexible regions:** (a) optional thread list, (b) the chat column (always primary, gets the most width), (c) an optional **context side panel** that mirrors live state (mandate chip, portfolio snapshot, quick deep-links, active automation status). The side panel is **read-mirror, not a second composer** — never duplicate the composer's inputs (OpenAI Apps SDK).
- **Cards render inline in the stream**, max width ~560–620px so they stay scannable; they do **not** expand to full column width like a dashboard.
- The context side panel is **collapsible**; collapsing it widens the chat column. On `lg` (1024–1280) the side panel collapses by default; on `xl`/`2xl` it can show.
- The **persistent shell** (badge, wallet, disclaimer strip) is owned by `01` §2 — do not redesign it here; chat lives in the route-content area beneath it.

### 2.2 Mobile (390px design canvas) — chat-native single column

```
┌───────────────────────────────┐
│ TOP BAR (condensed):          │
│ [logo] … [● badge][wallet][🔔]│
│ AI DISCLAIMER (1 line ▾)      │
├───────────────────────────────┤
│  CHAT STREAM (scroll)         │
│   user / AI bubbles           │
│   structured cards (full-w)   │
│   tool-step ticker            │
│                               │
│   …                           │
├───────────────────────────────┤
│ [ suggested-prompt chips → ]  │  ← horizontal scroll row
│ ┌───────────────────────────┐ │
│ │ COMPOSER [textarea]   [↑] │ │
│ └───────────────────────────┘ │
│ AI disclaimer (compact link)  │
├───────────────────────────────┤
│ BOTTOM TAB BAR (01 §2):       │
│ [Chat•][Portfolio][Vault][Strat]│
└───────────────────────────────┘
```

- **Single column.** No side panels — context (mandate, portfolio snapshot) is delivered **as cards in the stream** on demand, or via the "More" drawer / bottom tabs.
- **Cards go (near) full-width** (with the standard mobile `p-4` gutter), stacked.
- **Composer is bottom-anchored, above the bottom tab bar**, thumb-reachable. It floats above the keyboard when focused (the tab bar may hide while typing).
- **Suggested-prompt chips** sit in a **horizontally scrollable row** directly above the composer.
- **Thread switcher** and any card that would be a desktop side-panel/Popover becomes a **bottom `Sheet`/`Drawer`** (citations, "why this?", thread list) per the `04` §4.2 Dialog→Drawer rule.
- The **compact AI disclaimer** (07 §3.2) sits as a one-line strip in the shell header (chevron-expandable); a second compact link near the composer is acceptable but the mandatory clauses must remain reachable in ≤1 tap.

### 2.3 Responsive transform rules (carry everywhere)

| Desktop | → Mobile |
|---|---|
| Context side panel (mandate/portfolio mirror) | Cards in stream + bottom tabs + "More" drawer |
| Citations source `Popover` | Bottom `Sheet` (source list) |
| "Why this?" `Popover`/`Accordion` (inline) | Bottom `Sheet` or inline `Accordion` expand |
| Thread list rail | Thread `Sheet` from top-bar control |
| Cards ~560–620px max-width inline | Near-full-width, `p-4` gutter |
| Hover affordances (thumbs, citation hint) | Always-visible tap targets (≥44px, `04` §4.3) |

---

## 3. The composer

The persistent input. **One per surface** — never duplicate it in a side panel (OpenAI Apps SDK).

### 3.1 Anatomy

| Part | Spec | shadcn |
|---|---|---|
| **Text input** | Multi-line auto-grow `Textarea` (1 line → max ~5 lines, then scroll). Placeholder: *"Ask about your wallet, or tell me your goal…"* (07 voice; sentence case). | `Textarea` |
| **Send button** | Spark primary, icon (`arrow-up` / `send`), right-aligned inside or beside the input. The **one** spark element here (AI-presence + primary action). Disabled when input empty or while a response is streaming (becomes **Stop** during stream — see §6.3). | `Button size="icon" variant="default"` |
| **Attach context (optional, low-prominence)** | A ghost affordance to attach "my portfolio" / "this position" context where entered from a deep-link; not a file uploader. | `Button variant="ghost" size="icon"` |
| **Helper / state line** | Below input, `text-xs muted`: char/limit only if near a cap; otherwise the **compact AI disclaimer link** lives here. | `text` |

### 3.2 Behavior & states

- **Submit:** `Enter` sends; `Shift+Enter` newline (desktop). Mobile: explicit send button (return = newline). Keyboard-completable end-to-end (`04` §10.4).
- **Send disabled** when empty; **becomes "Stop"** (square icon) while the assistant streams, allowing the user to halt generation (§6.3).
- **Input retained on error.** If send fails, the user's text is **not lost** — it stays in (or is restored to) the composer with a retry (07 §6.1, no dead ends).
- **Focus ring:** 2px spark `--ring` + offset (`04` §10.3).
- **Degraded mode (AI unavailable):** composer is disabled with helper copy: *"SparkPoint's AI is temporarily unavailable. You can still view your portfolio and withdraw anytime — your funds never depend on us being online."* (07 §6.1). Withdraw/prove-it remain reachable via the shell.

---

## 4. Suggested-prompt chips

Reduce blank-canvas anxiety and teach what the assistant can do (Cloudscape; `09` §1).

### 4.1 Anatomy & placement

- **Chips** = small pill buttons; spark-tint on hover/active to signal AI presence (`04` §2.3, §11). Sentence case, verb-led where possible.
- **Placement:** (a) prominently in the **empty state** (§5.1), (b) in a row **directly above the composer** at all times (desktop static row; mobile horizontal-scroll), and (c) **contextually after an assistant answer** as follow-ups.
- **Two behaviors** (Cloudscape): a chip either **sends immediately** (one-shot intents like "Show my portfolio") or **populates the composer** for the user to edit (open-ended like "Find lower-risk yield…"). Indicate populate-vs-send subtly (an arrow glyph for "populates"); default to **send** for unambiguous intents.

### 4.2 Canonical chip sets (content from 07; never lead with a return number)

**Empty / first-open chips** (newcomer-safe, control-first):
- "Show my portfolio"
- "What's my plan?" (surfaces mandate)
- "Find steady, lower-risk yield"
- "Explain net APY"
- "How do you keep my funds safe?" (→ prove-it framing)
- "How did past advice do?" (→ Outcome log)

**Contextual follow-ups** (rendered after relevant answers):
- After a `RecommendationCard`: "Why this?", "Compare options", "What's the risk?"
- After a `PortfolioSnapshotCard`: "Where's my risk concentrated?", "Improve my yield"
- After a `TipCard`: "Tell me more", "How does this affect me?"
- After an `OutcomeCard`: "See the original advice", "What changed?"

> **Banned:** chips that imply guaranteed returns or lead with a yield number ("Earn 4.2%!" is forbidden — 07 §9.1). Frame around control, understanding, and risk posture.

---

## 5. Conversation states (the message stream)

The stream uses distinct **user** and **AI** turns (Cloudscape message structure). AI turns carry the **spark avatar** + a faint `--spark-subtle` left border/chip (`04` §9); user turns are neutral (right-aligned or distinct bubble). Long AI content may stack bubbles (avatar on first only). All financial figures tabular (`04` §3.1, 07 §5).

### 5.1 Empty state (first open / new thread)

- **Hero greeting** (07 §6.2 canonical): title **"Hi — I'm SparkPoint's AI."** Body: *"Tell me your goal, or ask me anything about your wallet. I suggest; you approve and sign."*
- **Spark avatar** present; calm, single accent.
- **Suggested-prompt chips** prominent (§4.1 empty set).
- **Persistent AI disclaimer** in view (full on desktop footer strip via shell; compact near composer on mobile).
- **No fake history**, no skeletons. Empty is an invitation, not a failure (07 §6.2).
- shadcn: `Card`/plain section + spark `Avatar` + chip `Button`s.

### 5.2 Primed first message (post-onboarding)

- After mandate confirmation, the AI opens with a context-aware turn referencing the mandate, e.g.: *"Your plan: lower risk (1/5), capital-preservation-first, steady USDC yield. Want to fund your vault, or look at it first?"* — followed by chips ("Review deposit", "Show the vault", "Not yet").
- Carries the AI-suggestion framing; the deposit chip routes to Vault → `/confirm`, never one-click.

### 5.3 Thinking / tool-step state (the autonomy-honesty moment)

While the AI works, show **streamed tool-step reasoning** so the model's actions are legible (`00` §5 motif; `04` §7 "AI thinking"; 07 §2.6). This is the sanctioned brand motion.

- **Tool-step ticker:** a vertical/inline list of present-continuous steps that appear and resolve in order:
  - "Reading your wallet…" → ✓ "Read your wallet"
  - "Checking current Aave rates…" → ✓
  - "Scanning the Base vault…" → ✓
  - "Simulating this move…" → ✓
- **Step anatomy:** spark dot (pulsing while active, `--spark-glow` halo, opacity 0.4↔1 ~1s loop) → resolves to a `--success` check when done; label `text-sm`; optional inline result chip ("4.3% net APY").
- **Honesty rules (07 §2.6):** steps are **real**, present-continuous, never faked progress; never assert a live number here without it later carrying a citation.
- **Placement:** within the in-progress AI turn, above the eventual answer/card. Steps may collapse into a "Showed 4 steps ▾" disclosure once the answer arrives, so the thread stays clean.
- **Reduced motion (`04` §7):** falls back to a **static spark dot + text label**; steps still appear/resolve, just without pulse/halo. No info conveyed by motion alone.
- **Stop affordance:** the composer's Stop button halts mid-stream (§6.3).
- shadcn: custom step list on `Card`/inline + spark dot; `Skeleton` only for any card scaffold that's still loading data.

### 5.4 Streaming answer state

- Text **streams token-by-token** into the AI bubble; a subtle caret/cursor indicates active generation.
- **Cards appear when their data is ready** — a card may render with internal `Skeleton` placeholders for fields still resolving (e.g., APY pending), then fill in (tabular numbers never reflow width, `04` §3.1).
- **Stop** remains available until the turn completes.
- Citations attach as their referenced numbers stream in (§9).

### 5.5 Settled answer state (default)

- Final prose + any structured card(s).
- **Per-turn affordances** on AI turns: **thumbs up/down** (§10), **citation chips** where numbers are cited (§9), optional **copy** and **"regenerate"** (ghost, low-prominence).
- **Contextual follow-up chips** beneath the turn (§4.1).
- The persistent disclaimer remains in view.

### 5.6 Warning / acknowledge-required state (in-chat)

When the AI proposes something **above the user's risk plan**, or a guardrail will require acknowledgement, the relevant card surfaces a **caution** banner *before* the user reaches `/confirm` (so expectations are set in chat). Amber `--caution` + alert-triangle + text (`04` §2.4; never color alone):
- Copy (07 §6.3): *"Heads up: this move is higher-risk than your plan ({your tier} → {move tier}). You'll be asked to acknowledge before signing."*
- The card's primary action still routes to `/confirm`, where the full guardrail checklist + sign-disabled-until-acknowledged lives (Flow 6). Chat **previews** the friction; it does not replace it.

### 5.7 Error & retry states

Calm, specific, never blaming; raw technical strings never exposed (07 §6.1). Map to inline `Alert` within the AI turn + a retry action.

| Situation | In-chat copy (07 §6.1) | Action |
|---|---|---|
| **Generation failed / timeout** | "Something interrupted that response. Your funds are safe — nothing was acted on." | **"Try again"** (re-runs the last user turn; input preserved) |
| **AI/agent unavailable (degraded)** | "SparkPoint's AI is temporarily unavailable. You can still view your portfolio and **withdraw anytime** — your funds never depend on us being online." | Links: "View portfolio", "Withdraw" |
| **Network/RPC unreachable** (data fetch in a step) | "We couldn't reach Base right now. Your funds are safe and untouched. Try again in a moment." | "Retry" |
| **No-data / can't answer well** | "I don't have enough to answer that well yet. Here's what would help: {…}" (never bluff, 07 §2.6) | suggested next steps as chips |
| **Stale data** | step/card labeled "as of {time}"; *"This may be out of date — I won't act on stale data."* (07 §5.5; no execution on stale data, `01` §6) | "Refresh" |

- **Retry pattern:** a failed AI turn shows an `Alert` (destructive for hard errors, info for degraded) with a single clear retry; the **user's original message is never lost** (07 §6.1). Retrying re-streams tool-steps (§5.3).
- **Custody reassurance is mandatory** on any action-related failure: *"Nothing moved — your funds are untouched."* (07 §6.1) — the chat is where custody anxiety spikes; address it inline.

---

## 6. Global chat interaction details

### 6.1 Read-only vs data-changing (the confirm gate)

Per OpenAI Apps SDK and `01` §0.3:
- **Read-only outputs** (`PortfolioSnapshotCard`, `TipCard`, `OutcomeCard`, explanatory prose) render **without** any confirmation.
- **Data-changing outputs** (`RecommendationCard`, `ActionCard` whose primary action moves funds) **never execute in chat.** Their primary action creates a `txIntent` and routes to `/confirm/[txIntentId]` (or renders the in-chat `ConfirmationCard` mirror that itself only signs via the confirm gate, §7.6). **There is no one-click money-mover in chat** (07 §9.1).

### 6.2 Deep-link & return pattern

- Cards deep-link **out** to dedicated flows (`/strategies/[recId]`, `/vault`, `/portfolio/positions/[id]`, `/confirm/[txIntentId]`) and the user returns to the **same thread**, scroll position preserved.
- Returning from a completed `/confirm` drops a **success turn** into the thread (e.g., an `OutcomeCard` seed or a confirmation toast echo) so the conversation reflects what happened.

### 6.3 Stop / interrupt

- While streaming (steps or tokens), the send button is a **Stop** (square). Stopping **preserves partial output** and leaves the turn marked "stopped" with a "Continue / Try again" affordance. No funds are ever affected by stopping (read/sim only).

### 6.4 Accessibility (from `04` §10)

- Distinct user/AI turns are programmatically labeled (role/author); spark avatar carries `aria-label="SparkPoint AI"`.
- Tool-steps announced **politely** (`aria-live="polite"`), not spammed per token.
- Cards are keyboard-navigable; ≤2 actions are reachable in tab order; the (disabled) primary on a gated card communicates state via `aria-disabled` + helper text, not color alone.
- Citation popovers/sheets keyboard-openable; thumbs are toggle buttons with labels.
- Reduced-motion disables pulse/glow/stream-caret animation; content still resolves.
- All numbers tabular; semantic state always color + icon + text.

---

## 7. Structured cards — the card system

All six are `Card` compositions (`CardHeader` / `CardContent` / `CardFooter`) with **≤2 actions in the footer** (OpenAI Apps SDK; `04` §11). Shared anatomy first, then per-card.

### 7.0 Shared card anatomy (applies to all)

| Slot | Rule |
|---|---|
| **Header** | Card title (`text-h3`/`text-sm` label), and — on **recommendation/action cards** — the mandatory **"AI suggestion — you approve & sign"** `Badge` (spark-tinted, `04` §9; 07 §2.1, verbatim, never shortened). |
| **Content** | Data-dense but clean; tabular numerals; semantic colors strict; risk via the risk palette + numeric step/label. Progressive disclosure for depth (e.g., "Why this?" expander). |
| **Footer (actions)** | **≤2 actions.** One primary (spark) + one optional secondary (`outline`/`ghost`). Verb-first, specific copy (07 §2.2). Money-moving primary always routes to `/confirm` (never one-click). |
| **Per-turn affordances** | Thumbs up/down (§10) on AI turns; citation chips on cited numbers (§9). |
| **States** | Each card defines: **loading** (skeleton fields), **default**, **success/updated**, **warning** (acknowledge-required, §5.6), **error** (data unavailable → graceful "couldn't load {field}" with retry). |
| **Width** | Desktop inline ~560–620px max; mobile near-full-width `p-4`. |

> **Verbatim trust strings (07 §2.1) — reuse exactly:** "AI suggestion — you approve & sign"; APY always "{X}% net APY" with breakdown ≤1 tap; "Estimates, not guarantees." appended to any yield-referencing card (07 §3.3).

---

### 7.1 RecommendationCard

**Purpose:** a strategy proposal ranked against the user's mandate, with plain-language rationale. The visible "fund manager" intelligence (FR-014/015/016; SC-005). Read-only to view; its action routes to review+sign.

**Anatomy:**
- **Header:** rank badge (e.g., "Best fit" / "#1 vs your goal"); **"AI suggestion — you approve & sign"** badge.
- **Content:**
  - **One-line thesis:** what & why, plain (07 §8 example): *"Aave's USDC rate rose to 4.3% net APY. Moving your idle USDC in could earn more, at the same low risk."*
  - **Net APY** readout: **"{X}% net APY"** + a **breakdown disclosure** (07 §5.2: "= 4.7% Aave supply rate − 10% SparkPoint performance fee (profit-only, HWM)"); never bare APY.
  - **Risk chip:** risk-palette tier + numeric `n/5` + label (launch vault = Risk 1 / Lower; `04` §2.5).
  - **"Fit to your goal" line:** ties to mandate (07: "fits your plan").
  - **Projected outcome / estimate** (clearly labeled estimate; *"Estimates, not guarantees."*; never lead with it, never project APY — 07 §5.2/§9.1).
  - **Sources:** citation chips for the cited rate/TVL/etc. (§9).
  - **"Why this?"** progressive disclosure (rationale, the trade-off, which guardrails it satisfies) — `Popover` (desktop) / `Sheet` (mobile) / inline `Accordion`.
- **Footer (≤2):** **primary "Review this move"** (07 §2.2 — always routes to `/confirm` via a `txIntent`; never "Accept"/"Do it") + secondary **"Not now"** (07 §2.2; never "Reject").

**States:** loading (APY/risk skeleton) · default · warning (above-plan → caution banner §5.6) · error (rate unavailable → "Couldn't load the current rate. Try again." retry).

**Non-custody/trust:** AI-suggestion badge; acceptance never one-click; "Estimates, not guarantees."; rationale exposes guardrail-fit. **Benchmarks:** OpenAI Apps SDK (≤2 actions, confirm-gate), Strategy/robo-advisor "tie to your goal".

**shadcn:** `Card` + `Badge` (rank, AI-suggestion, risk) + `Accordion`/`Popover` ("why this?") + `Button` ×2.

---

### 7.2 ActionCard

**Purpose:** a concrete deposit / withdraw / swap **intent** the user expressed or the AI proposes (e.g., "deposit 500 USDC"). It is an *intent preview*, not an execution.

**Anatomy:**
- **Header:** action type label ("Deposit" / "Withdraw" / "Swap"); **"AI suggestion — you approve & sign"** badge (when AI-proposed).
- **Content:**
  - **Asset(s) + amount** with ticker (tabular): "Deposit 500 USDC".
  - **Target:** the Aave Yield Vault / Aave v3 / Aerodrome (allowlisted only; FR-027).
  - **Estimated result:** "≈ {shares} spvUSDC" with fiat equiv beneath (07 §5.4); or for swap, est. output + price impact + max slippage (labeled estimate).
  - **Net APY** (for deposit) with breakdown; **caps context** preview where relevant ("Beta cap: ${used} of ${cap} used", 07 §2.3).
  - **Editable amount** affordance (inline) — but editing routes to the proper flow/confirm, not an in-card execute.
- **Footer (≤2):** primary **"Review deposit"** / **"Review withdrawal"** / **"Review this move"** (→ `/confirm`) + secondary **"Edit"** (opens the relevant flow screen with the amount staged).

**States:** loading · default · warning (cap near/over → "You're near your beta cap" caution; or above-plan) · **blocked** (cap reached / not-whitelisted / sim would revert → destructive, with 07 §6.1 reason, e.g. "Blocked by your guardrails: this would exceed your beta cap.") · error.

**Non-custody/trust:** every state-changing action funnels to `/confirm` (single funnel, `01` §0.3); withdraw action is the **escape hatch** in card form and must always be reachable; never imply the AI executes.

**shadcn:** `Card` + `Badge` + `Input` (inline amount) + `Button` ×2 + caps `Progress` (preview).

---

### 7.3 PortfolioSnapshotCard

**Purpose:** an at-a-glance read of the user's position, inline in chat (read-only; no confirm). Mirrors Portfolio (Flow 3) in miniature.

**Anatomy:**
- **Header:** "Your portfolio" + "as of {time}" (07 §5.5 if not live).
- **Content:**
  - **Net worth** (tabular, full precision) + **PnL** with window label, sign + color + arrow (07 §5.3): "+$312.40 (+2.8%, 1M)".
  - **Mini allocation** (small donut or stacked bar) — by asset and/or risk tier (risk palette; `04` §6.3).
  - **Risk read:** portfolio risk tier `n/5` + drift-vs-plan note ("On plan" / "Slightly above your plan").
  - **Vault position:** shares held + value + accrued yield (FR-012).
- **Footer (≤2):** primary **"Open portfolio"** (→ `/portfolio`) + secondary **"Improve my yield"** (→ chips/Strategies) — both read-only/navigational, no signing.

**States:** loading (skeleton) · default · **empty** (no positions → 07 §6.2: "Nothing here yet" + "Explore the vault") · error ("Couldn't load your portfolio. Your funds are safe. Retry.").

**Non-custody/trust:** read-only, no confirmation needed; honest PnL incl. losses; stale labeled. **Benchmarks:** Zerion/DeBank/Zapper (clean snapshot) + our stronger risk read.

**shadcn:** `Card` + Recharts `PieChart` (mini) + `Badge` (risk) + `Button` ×2.

---

### 7.4 TipCard (financial literacy)

**Purpose:** contextual, learn-as-you-go education when a term/concept first appears (FR-007). `--info` blue tone, **never green** (07 §4; `04` §2.4).

**Anatomy:**
- **Header (title):** the term/question, plain: "What's net APY?" / "What are vault shares?"
- **Content:** ≤2 sentences — plain definition → why it matters to you (07 §4.2/§4.3 canonical glossary; reuse the same wording everywhere). Info icon, blue accent.
- **Footer (≤1):** **"How this works"** → `/learn/[slug]`. **Dismissable; never re-nags after dismiss** (07 §4.2).

**States:** default · dismissed (collapses, doesn't reappear for that term). No loading/error (static content).

**Non-custody/trust:** education frames *so the user can hold us accountable* (07 §4.1, empowering frame), not blind trust. Non-condescending (no "simply/just/easy", 07 §4.1).

**shadcn:** `Card` (info variant) + `Button variant="ghost"`; or `HoverCard`/`Popover` when triggered from an inline term.

---

### 7.5 OutcomeCard

**Purpose:** show the realized PnL of a **past acted-on recommendation**, tied to the advice that caused it (FR-039/040/041; SC-010). The accountability loop — **wins and losses shown symmetrically** (`00` §9; 07 §5.3).

**Anatomy:**
- **Header:** "Outcome" + the originating recommendation reference + date ("from the Jun 2 rebalance recommendation").
- **Content:**
  - **Realized PnL:** signed + colored + arrow + window (07 §8 loss example): *"−$88.10 (−0.7%, 1M)"* — **a loss reads as plainly as a gain**; no euphemism, no flattering window (07 §5.3, §9.1).
  - **Plain cause line:** "The rate dropped after the move." (non-defensive, 07 §1.3 losses tone).
  - **Proof:** "View transaction ↗" (07 §5.5/§2.5 — proof, not promise).
- **Footer (≤2):** primary **"See the original advice"** (→ `/strategies/[recId]` / `/activity/[entryId]`) + secondary **"What changed?"** (asks the AI to explain).

**States:** loading · default (win) · default (loss) · pending ("Outcome still settling — realized PnL updates over time", 07 §5.5 estimate framing) · error.

**Non-custody/trust:** honesty is the trust mechanism; never hide a loss, never default to a flattering range; always link to the originating rec and on-chain proof.

**shadcn:** `Card` + `Badge` (gain/loss semantic) + `Button` ×2 + explorer link.

---

### 7.6 ConfirmationCard (in-chat mirror of the confirm gate)

**Purpose:** the **inline, in-chat** confirmation surface that mirrors `/confirm` (Flow 6) so the user can review-and-sign without leaving the thread — but it is the **same gate**, not a shortcut. Renders only for data-changing actions, post-simulation, pre-sign (OpenAI Apps SDK: data-changing → inline confirm with inputs+outputs + explicit Confirm). **Full Flow-6 spec is authoritative; this is its chat embodiment.**

**Anatomy (mirrors 07 §2.4 confirmation pattern + `04` confirmation mapping):**
- **Header:** "Confirm: {action}" (no AI-suggestion badge needed here — this is the money moment; tone is precise/factual, 07 §1.3).
- **Content, top→bottom (07 §2.4):**
  1. **What you're about to do** — one plain sentence: *"You're depositing 500 USDC into the Aave Yield Vault. You'll receive ≈ 498.2 spvUSDC."*
  2. **Balance-change table** — simulation result; each asset in/out with USD value and direction (− out / + in), gas line; tabular; semantic +/− (Tenderly benchmark; `04` §11). No persuasion prose.
  3. **Guardrail checklist** — each item plain + binary, semantic icon (`04` §2.4): "✓ Within your beta cap", "✓ Slippage under your max", "✓ Allowlisted protocol", "✓ Simulation passed" — or "⚠ Requires your acknowledgement: {reason}".
  4. **Control reminder:** *"Nothing moves until you sign. You can cancel now with no effect."* (07 §2.4).
- **Footer (≤2):** primary **"Review & sign"** → after acks, **"Sign deposit"** / **"Sign transaction"** (07 §2.2). **Sign is disabled until all required acks are checked** (Rabby pattern; `04` §10.4; helper: "Acknowledge the {n} item(s) above to enable signing."). Secondary **"Open full confirmation"** (→ `/confirm/[txIntentId]`) and/or **"Cancel"** (cancel = neutral, "Nothing moved").

**States (mirror Flow 6):**
- **Simulating** — tool-step "Simulating this move…" + skeleton table (§5.3).
- **Passed** — green "Simulation passed — no risks detected" banner; checklist all ✓; sign enabled after any acks.
- **Warning / needs-ack** — amber items + ack `Checkbox`(es); **sign disabled** until checked (07 §6.3; `04` §7 blocked-shake on attempted sign).
- **Blocked** — destructive: revert predicted / cap exceeded / slippage exceeded / out-of-policy → **no sign offered** (FR-023, FR-025, deterministic policy rejects before signature, FR-008); plain reason (07 §6.1).
- **Signing / pending** — wallet prompt; pending spinner state; Stop not applicable (user is in wallet).
- **Success** — 07 §2.5 pattern: *"Deposit confirmed. You now hold {shares} spvUSDC (≈ ${value}). View transaction ↗"* + "See it in your portfolio"; drops back into the thread (§6.2).
- **Failure/retry** — 07 §6.1: "The transaction didn't go through, so nothing moved. {reason}. You can review and try again." + custody reassurance.

**Non-custody/trust (the trust gate):** simulation before any signature (SC-002); guardrail checklist visible; **sign disabled until acknowledged**; out-of-policy never offered for signing; cancel always safe; user signs (SC-001). This card is where "AI proposes — guardrails check — you sign" is fully realized inline. **Always offers "Open full confirmation"** so the user can escalate to the full `/confirm` surface.

**shadcn:** `Card` + `Table` (balance-change) + `Alert` (sim banner) + `Checkbox` (acks) + `Button` (disabled-until-acks) + `AlertDialog` (final sign moment if escalated).

---

## 8. Card-to-flow connection matrix

How each card links outward (from `01` §4).

| Card | Primary action → | Secondary → | Writes to |
|---|---|---|---|
| `RecommendationCard` | `/confirm/[txIntentId]` (via txIntent) — "Review this move" | "Not now" (dismiss); "Why this?" → `/strategies/[recId]` | On accept+sign → Outcome log entry (`/activity/[entryId]`) linked to `recId` |
| `ActionCard` | `/confirm/[txIntentId]` — "Review deposit/withdrawal" | "Edit" → `/vault/deposit`·`/withdraw` (amount staged) | Same as above on execution |
| `PortfolioSnapshotCard` | `/portfolio` — "Open portfolio" | "Improve my yield" → Strategies/chips | — (read-only) |
| `TipCard` | `/learn/[slug]` — "How this works" | dismiss | — |
| `OutcomeCard` | `/strategies/[recId]` or `/activity/[entryId]` — "See the original advice" | "What changed?" (AI explains) | — |
| `ConfirmationCard` | sign here (gated) or `/confirm/[txIntentId]` — "Open full confirmation" | "Cancel" | On sign → tx + Outcome log + `/notifications` |

---

## 9. Sourced citations

Build trust that numbers are **sourced, not hallucinated** (Cloudscape; 07 §2.6). Mandatory wherever the AI asserts a live figure (APY, TVL, rate, audit reference).

- **Inline citation chip:** small numbered/marker chip attached to the cited value (e.g., the net APY in a `RecommendationCard`). Spark-tinted, low-prominence.
- **Source popover (desktop) / source sheet (mobile):** tapping a chip opens **"Based on {source}"** with the source name, the value as fetched, a **timestamp** ("as of {time}", 07 §5.5), and a **link** (explorer / verified-source / data provider). Multiple sources → a small list.
- **Expandable "Sources" list** per AI turn (Cloudscape): a turn-level disclosure listing all sources cited in that answer.
- **Rules (07):** never assert a live number without a source affordance (07 §2.6); on-chain claims link to explorer/verified-source (`05` §1 "provable, not promised"); stale sources labeled, never presented as live (07 §5.5).
- **shadcn:** citation chip = interactive `Badge`; `Popover` (desktop) / `Sheet` (mobile); turn-level `Accordion` "Sources".

---

## 10. Thumbs feedback

Per-AI-turn feedback that also feeds the outcome/accountability loop (Cloudscape; `09` §1).

- **Placement:** subtle thumbs-up / thumbs-down on each settled AI turn (recommendations especially).
- **Behavior (Cloudscape):** selecting one **disables the opposite** after submit (toggle, single choice); state persists with the turn.
- **Thumbs-down follow-up (optional):** opens a small, dismissable dialog/sheet — *"What was off?"* with quick chips ("Not relevant", "Wrong number", "Too risky for me", "Other") + optional free text. Never required; never blocking.
- **Tone:** neutral, not pestering; respects dismissal.
- **shadcn:** `Toggle`/`ToggleGroup` (thumbs) + optional `Popover`/`Sheet` (follow-up) + `Badge`/chip reasons.
- **Accessibility:** labeled toggle buttons; state announced; keyboard operable.

---

## 11. The persistent AI disclaimer (in chat)

Owned canonically by 07 §3 and the shell (`01` §2; `04` §3.3). In the chat surface specifically:

- **Always in view** during AI interaction — **never hidden behind a tap** on an advice surface (07 §3.4).
- **Desktop:** the shell's full disclaimer strip sits above chat; a compact link may also sit under the composer.
- **Mobile:** compact version (07 §3.2) — *"AI suggests — you approve & sign. Not financial advice. Capital at risk. SparkPoint can't move your funds."* — as a one-line strip (chevron to full) and/or under the composer. The **full version reachable in ≤1 tap** (07 §3.4).
- **Per-card disclaimer:** the **"AI suggestion — you approve & sign"** badge on every recommendation/action card *is* the per-card disclaimer (07 §3.3) — never omitted to save space; **"Estimates, not guarantees."** appended on yield-referencing cards.
- **Style:** `text-xs muted` — present, legible, never shouting; risk + custody clauses verbatim and unsoftened (07 §3.4). The custody clause ("SparkPoint can never move or withhold your funds") is mandatory in the full version.
- **shadcn:** `Alert` (info, pinned via shell) + `Collapsible` for compact↔full.

---

## 12. Microcopy quick-reference (defer to 07 for canon)

Reuse exactly; 07 wins on any conflict.

- **Empty greeting:** "Hi — I'm SparkPoint's AI." / "Tell me your goal, or ask me anything about your wallet. I suggest; you approve and sign." (07 §6.2)
- **AI-suggestion badge (verbatim, every rec/action card):** "AI suggestion — you approve & sign" (07 §2.1)
- **Yield caveat (yield cards):** "Estimates, not guarantees." (07 §3.3)
- **APY:** "{X}% net APY" + breakdown ≤1 tap (e.g., "= 4.7% Aave supply rate − 10% SparkPoint performance fee (profit-only, HWM)") — never bare (07 §5.2)
- **Tool-steps:** "Reading your wallet…", "Checking current Aave rates…", "Scanning the Base vault…", "Simulating this move…" (07 §2.6)
- **Citations:** "Based on {source}" + timestamp + link (07 §2.6)
- **Buttons:** "Review this move" / "Review deposit" / "Review withdrawal" (primary, → `/confirm`); "Not now" / "Edit" / "Open portfolio" / "How this works" / "See the original advice" (secondary). Never "Accept/Confirm/OK/Do it" on money actions (07 §2.2)
- **Confirmation:** "You're depositing ${amount}. You'll receive ≈ {shares} spvUSDC. Nothing moves until you sign." + "Sign deposit" (disabled until acks) (07 §2.4)
- **Success:** "Deposit confirmed. You now hold {shares} spvUSDC (≈ ${value}). View transaction ↗" (07 §2.5)
- **Tx-failure reassurance (mandatory):** "Nothing moved — your funds are untouched." (07 §6.1)
- **Degraded:** "SparkPoint's AI is temporarily unavailable. You can still view your portfolio and withdraw anytime — your funds never depend on us being online." (07 §6.1)
- **Loss (OutcomeCard):** "−$88.10 (−0.7%, 1M) · from the Jun 2 rebalance recommendation. The rate dropped after the move. View tx ↗" (07 §8)
- **Uncertainty / no-data:** "I can't be sure {X} — here's what I do know:" / "I don't have enough to answer that well yet. Here's what would help: {…}" (07 §2.6)
- **Banned:** bare APY; "guaranteed/risk-free/you'll earn"; leading with a return number; emoji/hype; "Accept/Confirm" on money buttons; one-click money-movers; raw RPC/revert strings (07 §9).

---

## 13. shadcn/ui mapping (this flow)

| Chat element | shadcn/ui primitive(s) |
|---|---|
| Message stream / turns | custom bubbles on `Card` + spark `Avatar` (AI) |
| Composer | `Textarea` + `Button size="icon"` (send/stop) |
| Suggested-prompt chips | `Button size="sm" variant="outline"` / interactive `Badge` (spark-tint hover) |
| Tool-step ticker ("thinking") | custom step list + spark dot (motion `04` §7); `Skeleton` for pending card fields |
| Structured cards (all six) | `Card` (+ `CardHeader/Content/Footer`) + `Badge` + `Button` ×≤2 |
| "Why this?" / depth disclosure | `Popover` (desktop) / `Sheet` (mobile) / `Accordion` |
| Citation chip → source | interactive `Badge` → `Popover` (desktop) / `Sheet` (mobile); turn-level `Accordion` "Sources" |
| Thumbs feedback | `Toggle`/`ToggleGroup` + optional `Popover`/`Sheet` follow-up |
| Balance-change table (ConfirmationCard) | `Table` (tabular, semantic +/−) |
| Guardrail checklist + acks | list rows + semantic icons + `Checkbox` + `Alert` |
| Sim result / warning / blocked banners | `Alert` (success / warning / destructive) |
| Final sign moment (escalated) | `AlertDialog` |
| Card empty/error within stream | `Card` + Lucide icon + microcopy + retry `Button` |
| Mini allocation (PortfolioSnapshotCard) | Recharts `PieChart` (donut) + `Legend` |
| Caps preview (ActionCard) | styled `Progress` |
| Thread list / switcher | `ScrollArea` list (desktop rail) / `Sheet` (mobile) |
| Context side panel (desktop) | `Card` stack (mandate/portfolio mirror) + `Collapsible` |
| Toasts (tx/sign echo) | `Sonner` |
| AI disclaimer | `Alert` (info, shell-pinned) + `Collapsible` |

---

## 14. Benchmarks honored (this flow)

| Pattern | Benchmark (canonical link in `09` §1) | How we apply it |
|---|---|---|
| Structured cards over prose; **≤2 actions**; read-only renders free, data-changing shows inline confirm with inputs+outputs + explicit Confirm | **OpenAI Apps SDK — UI guidelines (★★★)** | The whole card system; `ConfirmationCard` inline gate; no nested nav inside cards; no duplicate composer |
| Distinct user/AI bubbles + avatars; **suggested-prompt chips**; **inline citations + source popovers + Sources list**; explicit loading; error + "try again"; **thumbs up/down (disable opposite)**; persistent **AI disclaimer** | **Cloudscape — gen-AI chat (★★★)** | §3–§5, §9, §10, §11 |
| "DeFi by conversation" — natural-language multi-step ops as confirmable actions | **Hey Anon (★★)** | `ActionCard` intent → confirm gate; chat-first DeFi |
| Chat-command-with-confirmable-action ergonomics | **Bankr / Griffain (★)** | Composer + card ergonomics — but we **reject** Bankr's agent-generated-wallet custody anti-pattern; user owns keys, signs every move |
| Pre-trade simulation + balance-change preview; **sign disabled until acknowledged** | **Tenderly + Rabby** (`09` §5) | `ConfirmationCard` balance-change table, guardrail checklist, sign-gated-on-acks |

---

## 15. Acceptance criteria (Flow 2 — Chat AI Assistant)

A design satisfies this flow doc when **all** hold:

1. **Both breakpoints, full-fidelity.** Desktop (chat + optional thread list + collapsible context side panel) and mobile (chat-native single column, bottom-anchored composer, bottom tabs) are both designed; the desktop side panel **mirrors** state and never duplicates the composer.
2. **All conversational states designed.** Empty (with chips), primed-first-message (post-onboarding), thinking/tool-step, streaming, settled, warning/acknowledge-required, error, retry, degraded-mode — each with on-spec copy (07) and the persistent disclaimer in view.
3. **Composer is single & resilient.** One composer per surface; Stop replaces Send while streaming; the user's text is never lost on error; degraded-mode disables it with the canonical reassurance copy + reachable withdraw.
4. **Suggested-prompt chips present** in empty state, above the composer, and contextually after answers; none lead with a return number or imply guaranteed yield; send-vs-populate behavior indicated.
5. **Tool-step transparency is real and honest.** "Reading your wallet → Checking Aave rates → Scanning the vault → Simulating" steps render with spark "thinking" motion, resolve to checks, collapse after; reduced-motion fallback provided; no faked progress.
6. **All six cards specified with anatomy + ≤2 actions + states.** `RecommendationCard`, `ActionCard`, `PortfolioSnapshotCard`, `TipCard`, `OutcomeCard`, `ConfirmationCard` each have header/content/footer, ≤2 footer actions, and loading/default/success/warning/error variants.
7. **Confirm gate enforced.** Read-only cards render without confirmation; every data-changing card routes to `/confirm` (or the in-chat `ConfirmationCard` mirror that signs only via the gate); **no one-click money-mover exists in chat**; out-of-policy actions are never offered for signing.
8. **Trust motifs verbatim.** "AI suggestion — you approve & sign" on every rec/action card; "Estimates, not guarantees." on yield cards; net APY never bare and always with breakdown ≤1 tap; custody/risk disclaimer clauses unsoftened and always in view.
9. **Citations present.** Every AI-asserted live figure carries a source affordance ("Based on {source}" + timestamp + link), with a turn-level Sources list; on-chain claims link to explorer/verified-source; stale data labeled, never shown as live.
10. **Thumbs feedback** on AI turns (selecting one disables the opposite), with an optional non-blocking thumbs-down follow-up.
11. **ConfirmationCard mirrors Flow 6.** Plain "what you're about to do" → balance-change table → guardrail checklist → control reminder → **Sign disabled until acks**; simulating/passed/warning/blocked/signing/success/failure states; "Open full confirmation" escalation; cancel always safe; custody reassurance on failure.
12. **Card-to-flow links resolve.** Every card's ≤2 actions deep-link per §8 and return to the same thread with scroll preserved; accepted recommendations write to the Outcome log linked to the originating `recId`.
13. **Honest outcomes.** `OutcomeCard` shows wins and losses symmetrically, tied to the originating recommendation, with on-chain proof link; no flattering default window; no euphemism.
14. **Maps to shadcn + accessible.** Every element resolves to the §13 map; cards honor ≤2 actions; visible 2px spark focus ring; full keyboard operability incl. the sign flow; tool-steps announced politely; numbers tabular; no color-only signals; reduced-motion honored; Dialog→Sheet/Drawer on mobile.
15. **Non-custody reachable here too.** The shell's non-custodial badge → prove-it panel and a withdraw/exit path remain ≤1 tap from the chat surface; nothing in chat hides the escape hatch.

---

## 16. Cross-references

- **Shell, routes, hub role, single-confirm-funnel, gating/degraded states:** `01-information-architecture.md` (§0, §2, §4, §6).
- **Tokens, spark = AI presence, semantic + risk palettes, AI "thinking" motion, ≤2-action card mapping:** `04-design-system.md` (§2, §7, §9, §11).
- **All canonical wording, the AI disclaimer, trust motifs, button verbs, error/empty/warning copy, number/PnL/APY/shares formatting:** `07-content-and-tone.md` (§2, §3, §5, §6, §8, §9) — **wins on any conflict.**
- **Confirmation/simulation/sign internals:** Flow 6 (`/confirm`) handover doc (this card system embeds its in-chat mirror).
- **Strategy recommendations detail, Portfolio detail, Vault deposit/withdraw, Outcome log:** Flows 3–5 and the Outcome-log supporting-surface docs (cards deep-link into these).
- **Benchmark links (OpenAI Apps SDK, Cloudscape, Hey Anon, Bankr/Griffain; Tenderly/Rabby):** `09-references.md` §1 (and §5).
- **Requirements traced:** FR-005–008 (chat + reasoning + literacy + policy-gate), FR-014–016 (recommendations), FR-039–041 (outcome log); SC-001/002/005/010.
