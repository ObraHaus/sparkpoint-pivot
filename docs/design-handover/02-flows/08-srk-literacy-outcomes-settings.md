# 02 · Supporting Surfaces — SRK · Financial-Literacy · Outcome Log · Settings · Notifications

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui).
> **Status:** Authoritative screen-level spec for the **supporting surfaces** bundle: **SRK utility** (`/srk`), **Financial-literacy hub + contextual TipCards** (`/learn`, `/learn/[slug]`, plus the injected `TipCard`), **Outcome Log** (`/activity`, `/activity/[entryId]` — the accountability surface), **Settings** (`/settings` + sub-routes), and **Notifications / alerts** (`/notifications` + bell preview + toasts). W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — guardrails + you dispose"), five non-custody guarantees, tone, non-goals; **SRK is non-essential** and **the outcome log is the accountability surface**.
> - `01-information-architecture.md` — §1 routes (`/srk`, `/learn`, `/learn/[slug]`, `/activity`, `/activity/[entryId]`, `/settings`, `/settings/{account,mandate,notifications,appearance,security}`, `/notifications`); §2 persistent shell (non-custodial badge, AI disclaimer strip, bell, secondary nav); §4.2 the **mandate is the spine**, **acceptance writes to the Outcome Log via `/confirm`** (§4.2.4), **Learn is contextual not just a destination** (§4 note 7), **SRK is a dead-end branch by design** (§4 note 8); §6 gating/degraded states (none remove the withdraw path).
> - `04-design-system.md` — tokens; **`--info` (blue) for literacy, never green** (§2.4); risk palette §2.5; PnL sign+color+icon convention (§2.4, §3.4); tabular numerals (§3.1/§3.4); caps meter (§6.5); motion (§7); a11y (§10); component→shadcn map (§11, esp. Outcome log, Settings, SRK, Literacy, Notifications rows).
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Trust motifs (§2.1), button verbs (§2.2), the literacy tip-card pattern + glossary (§4), PnL/APY/number formatting (§5), error/empty/warning copy (§6), the loss exemplar (§8), banned/required phrases (§9).
> - `02-flows/02-chat-assistant.md` — the **`TipCard`** (§7.4) and **`OutcomeCard`** (§7.5) are the in-chat seeds of two surfaces here; this doc is their full-surface expansion. Anatomy and copy must stay consistent.
> - `02-flows/04-strategy-recommendations.md` — the Outcome Log links **back** to the originating `recId` (`/strategies/[recId]`), and a rec's detail links **forward** to its `/activity/[entryId]`. The loop is bidirectional; keep both ends consistent.
> - `09-references.md` — §2 portfolio trackers' shared gap (no PnL accountability / no time-based alerting — *our* opening); §4 robo-advisor "on/off track" + just-in-time literacy (Wealthfront/Betterment/SmartDev); §6 non-custody vocabulary (Ledger/Trust Wallet); §8 competitor intel (out-position token-subsidy theater — directly relevant to SRK framing).
>
> **What this doc IS:** for each of the five surfaces — goal & entry points; step-by-step screens and STATES (default / empty / loading / success / warning / error, plus surface-specific states); key UI components and their anatomy; desktop **and** mobile layout; content & microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria; shadcn/ui mapping.
> **What it is NOT:** visual tokens (`04`), canonical strings (`07`), the IA/route map (`01`), the chat surface internals (`02` — only the `TipCard`/`OutcomeCard` seeds are referenced), the Confirmation/sign internals (Flow 6 / `/confirm`), the Trust Center / Automation surfaces (their own docs — Settings *links into* them, never re-implements), or the Onboarding mandate capture (Flow 1 — `/settings/mandate` *re-runs* it, doesn't redefine it).

---

## 0. Shared constraints (apply to every surface in this doc)

1. **Non-custody is global, not a page (`01` §0.1).** All five surfaces render inside the authenticated shell: persistent **non-custodial badge → prove-it panel**, the **AI disclaimer strip** ([Prove it] / [Exit anytime]), wallet/network status, the **bell**, and a **withdraw/exit path ≤1 tap away**. No surface here gates, hides, or delays the withdraw path — including degraded/stale states (`01` §6).
2. **Honest over flattering — symmetrically.** The Outcome Log shows **wins AND losses** with equal prominence, each tied to the recommendation that caused it; never default to a flattering time-window; never hide red (`00` §9; `07` §5.3, §9.1). This is the spine of the accountability surface and the deliberate out-positioning of the collapsed "AI fund" cohort (`09` §8).
3. **SRK is non-essential, by design and by tone.** Nothing core may depend on SRK (`spec.md` FR-045/046, SC-013; `01` §4 note 8). The SRK surface is low-prominence (secondary/footer only, `01` §1/§4.4), explicitly labels itself as optional, and uses the **calm, non-hypey, no-token-theater** voice (`07` §1.4, §9.3) — the antithesis of the subsidized-APY register we out-position (`09` §8, Giza/ARMA).
4. **Literacy is `--info` blue, never green (`04` §2.4).** Education is not "gain." Tip cards and the hub use the info tone; literacy never implies returns; lessons themselves state uncertainty (`07` §4.1).
5. **Numbers to `07` §5, always.** Tabular numerals everywhere financial; PnL = sign + color + icon + time-window; net APY only with breakdown ≤1 tap; en-dash = unknown, `$0.00` = real zero; no `0`-as-loading; stale labeled "as of {time}" (`07` §5; `04` §3.4, §6.1).
6. **`Dialog → Sheet/Drawer` on mobile (`04` §4.2).** Every overlay (filters, detail, source popovers, bell preview, confirm-dialogs) becomes a bottom `Sheet`/`Drawer` on mobile; tap targets ≥44px; primary actions thumb-reachable.
7. **Settings is control, not custody.** Settings can edit *preferences and plan*; it can **never** be where custody is granted/altered silently. Anything that changes on-chain authority (revoke a session key, change the smart-account signer) routes through the appropriate signed/confirmed surface and is mirrored in `/trust` and `/automation` (`01` §4 notes 1, 6).
8. **No surface here is a dead end.** Every empty state is an invitation with one next action; every error is what/why/next-step with fund-safety reassurance on any tx-adjacent failure (`07` §6).

---

# A. SRK utility (`/srk`)

## A.1 Goal & entry points

### A.1.1 Goal
Tell the user **plainly what SRK is, what it does, what they hold, and how to earn/use it — while making unmistakably clear that SRK is optional and the vault + assistant work fully without it** (`spec.md` FR-045/046; `00` §SRK constraint). The surface must *inform without enticing*: no price talk, no APY-of-token theater, no urgency, no "buy now." Success is a user who understands SRK and feels **no pressure** to hold it.

The one-sentence job: **explain a non-essential utility token honestly enough that nobody feels they must own it to use SparkPoint.**

### A.1.2 Entry points (`01` §1, §4.3, §4.4)
| From | Behavior | Lands on |
|---|---|---|
| **Secondary nav → "SRK"** | Desktop left rail (low-prominence) / mobile "More" drawer; also footer link. | `/srk` |
| **Footer "SRK"** | Low-prominence footer link (kept deliberately quiet, `01` §4.4). | `/srk` |
| **Command menu (`⌘K`)** | "SRK". | `/srk` |
> **No core flow links to SRK** (`01` §4 note 8). There is intentionally **no** entry from Chat/Portfolio/Vault/Strategies/Confirm that *requires* or *promotes* SRK. A passing definition `TipCard` in chat may link here, but never as a gate.

### A.1.3 Pre-conditions
- Authenticated shell as elsewhere. **No whitelist/cap interaction** — SRK is informational; viewing it never affects core access. If a user is degraded/geo-gated, the SRK page is non-critical and may show the standard gated render, but **this never blocks withdraw**.

## A.2 Layout

### A.2.1 Desktop (`/srk`, 1440px)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL + AI DISCLAIMER STRIP (01 §2)                                      │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│ SECONDARY│ PAGE HEADER                                                          │
│ NAV RAIL │  H1 "SRK"   ·  eyebrow/badge "Optional — not needed to use SparkPoint"│
│ (01 §2)  │  subhead "What SRK is, what you hold, and how to use it. The vault    │
│          │  and assistant work fully without it."                               │
│          │ ┌──────────────── BALANCE CARD (only if connected) ───────────────┐  │
│          │ │ Your SRK     1,250 SRK     ·  [How to use ▾]                     │  │
│          │ │ (no fiat price shown by default — see A.4)                       │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
│          │ ┌── WHAT SRK DOES (Tabs or stacked Cards) ────────────────────────┐  │
│          │ │ [What it is] [What it does] [How to earn] [How to use] [FAQ]     │  │
│          │ │  • plain explainer per tab; each utility item = Card row +       │  │
│          │ │    "available now / planned (deferred)" Badge                    │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
│          │ ┌── NON-ESSENTIAL CALLOUT (info Alert, persistent) ───────────────┐  │
│          │ │ ℹ "You never need SRK to deposit, earn yield, or withdraw.       │  │
│          │ │    Holding SRK changes nothing about your custody or safety."    │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```

### A.2.2 Mobile (390px)
- Single column: header + the **"Optional"** badge → balance card (if connected) → utilities as an `Accordion` (one section per "what it is / does / earn / use / FAQ") → the persistent non-essential `--info` `Alert` pinned near the top so it's read first. No sticky CTA (there is no money CTA here by design).

### A.2.3 Responsive transform
| Desktop | → Mobile |
|---|---|
| Utility `Tabs` | `Accordion` sections |
| Balance card inline "How to use ▾" `Popover` | `Sheet` |
| Multi-column FAQ | stacked `Accordion` |

## A.3 Components & anatomy

| Element | Content | Rules | shadcn |
|---|---|---|---|
| **"Optional" eyebrow/badge** | "Optional — not needed to use SparkPoint" | Always present in the header; this is the surface's defining frame. | `Badge` (neutral/`--info`, **not** spark) |
| **Balance card** | "Your SRK: {amount} SRK" (+ "How to use ▾") | Tabular; **no fiat price by default** (A.4). En-dash if unknown; `0 SRK` if a real zero with "You don't hold any SRK — and you don't need to." | `Card` + `Badge` |
| **Utility rows** | each SRK use = title + one plain sentence + **status badge** ("Available now" / "Planned" / "Deferred") | Honest about what's live vs roadmap (`spec.md` Assumptions: SRK v2 utility/governance deferred). Never imply a deferred benefit is live. | `Card` rows + `Badge` (status) |
| **"How to earn"** | plain steps (if any earn mechanic is live) or "Not available in beta yet." | If nothing is earnable in beta, say so plainly — no fake quests/points theater. | `Card`/list |
| **"How to use"** | where SRK applies (e.g., fee discounts/governance/access — **only those that are real**), each with a status badge | The launch vault is **0-fee**, so a "fee discount" utility must be honestly framed (e.g., "Not applicable — the vault is already 0-fee."). Never invent a benefit. | `Card`/list |
| **Non-essential callout** | "You never need SRK to deposit, earn yield, or withdraw. Holding SRK changes nothing about your custody or safety." | Persistent `--info` `Alert`; this is the trust payload of the page. | `Alert` (info) |
| **FAQ** | plain Q→A (Is SRK required? No. Does SRK affect my custody? No. Can I use the vault without it? Yes.) | Reinforces non-essentiality. | `Accordion` |

## A.4 States (SRK)
- **Default (connected, holds SRK):** balance shown; utilities listed with status badges; non-essential callout pinned.
- **Default (connected, zero SRK):** `0 SRK` + "You don't hold any SRK — and you don't need to." No "buy"/"acquire" CTA (no price/market surface in beta; `09` §8 out-positioning).
- **Empty (not connected):** balance card replaced by "Connect your wallet to see your SRK balance." (still no pressure); utilities/FAQ remain readable. CTA "Connect wallet" (`07` §2.2).
- **Loading:** skeleton for balance + utility rows; no `0`-as-loading (`04` §6.1).
- **Stale/degraded:** "as of {time}" on balance; the page is non-critical, withdraw unaffected.
- **Error (couldn't load balance):** "We couldn't load your SRK balance right now. This doesn't affect your funds or your ability to withdraw." + "Retry" (`07` §6.1 — fund-safety reassurance).
- **No "price" / "buy" state by design.** There is **no** market/price/chart/"buy SRK" surface in the beta build; if product later adds one, it lives off this page and stays non-hypey. (Banned register: §9.3 hype/urgency.)

## A.5 Microcopy (SRK) — defer to `07`
- Header: "SRK" + "Optional — not needed to use SparkPoint."
- Non-essential callout (verbatim intent): "You never need SRK to deposit, earn yield, or withdraw. Holding SRK changes nothing about your custody or safety."
- Status badges: "Available now" / "Planned" / "Deferred" / "Not applicable (the vault is 0-fee)".
- Zero state: "You don't hold any SRK — and you don't need to."
- **Banned here (esp.):** any price/"to the moon"/urgency/FOMO/"don't miss"/"stake to earn X% APY" register (`07` §9.3). No emoji. No projected token returns.

## A.6 Non-custody / trust touchpoints (SRK)
- The page's **entire job** reinforces a trust claim: SparkPoint isn't a token-pump; the product stands without SRK (out-position the subsidized-yield cohort, `09` §8).
- Shell non-custody affordances present as everywhere; the non-essential callout explicitly ties SRK to **zero custody impact**.

## A.7 Benchmarks (SRK)
| Pattern | Benchmark (`09`) | Application |
|---|---|---|
| Out-position token-incentive theater; honesty over hype | **Giza/ARMA, competitor intel (`09` §8)** | SRK framed as optional, no price/APY theater, no urgency |
| Plain consumer-grade token/utility explanation | **Trust Wallet glossary tone (`09` §6 / `07` §4)** | Plain "what it is / does" definitions, jargon defined inline |

## A.8 Acceptance criteria (SRK)
1. Designed at **1440px + 390px**, all states (default-holds / default-zero / not-connected / loading / stale / error).
2. The **"Optional — not needed to use SparkPoint"** frame is present in the header and reinforced by a persistent non-essential `--info` callout.
3. **No core dependency, no entry that requires SRK**; the page is low-prominence (secondary/footer) (`01` §4 note 8; FR-045, SC-013).
4. **No price/buy/market surface, no token-yield theater, no urgency** anywhere; voice is calm and honest (`07` §9.3; `09` §8).
5. Utilities carry honest **status badges** (live vs deferred); a 0-fee-vault "fee discount" is framed honestly, never as a live benefit.
6. Balance is tabular, fiat price suppressed by default; zero vs unknown handled per `07` §5.5; withdraw-always reachable.

---

# B. Financial-literacy hub + contextual TipCards (`/learn`, `/learn/[slug]`, injected `TipCard`)

## B.1 Goal & entry points

### B.1.1 Goal
Make users **competent enough to judge SparkPoint's recommendations, not blindly trust them** (`07` §4.1 empowering frame). Two halves: (1) a **hub/library** (`/learn`) of plain, progressively-disclosed lessons; (2) **contextual `TipCard`s** injected at the moment a concept is first needed (chat, portfolio risk panel, strategy "why this?", confirmation checklist — `01` §4 note 7). Learning is **just-in-time, never a gate** (no flow is blocked behind a lesson).

The one-sentence job: **teach the concept the user needs, exactly when they need it, in plain language, so they can hold us accountable.**

### B.1.2 Entry points (`01` §4.3, §4 note 7)
| From | Behavior | Lands on |
|---|---|---|
| **Secondary nav → "Learn"** | Left rail / "More" drawer. | `/learn` (hub) |
| **Contextual `TipCard` → "How this works"** | Injected in chat (`02` §7.4), portfolio risk panel (Flow 3), strategy "why this?" (Flow 4), confirm checklist (Flow 6). | `/learn/[slug]` (the relevant lesson) |
| **Inline term `Tooltip`/`HoverCard` → "Learn more"** | Any defined jargon (APY, shares, slippage, guardrails…). | `/learn/[slug]` |
| **Command menu (`⌘K`)** | "Learn about {term}". | `/learn` search or `/learn/[slug]` |
| **Search within `/learn`** | Filter/search the library. | `/learn` filtered |

### B.1.3 Pre-conditions
- Literacy is **never gated** (no wallet/whitelist required to read a lesson; the hub may render even when degraded). It never blocks a flow.

## B.2 The contextual `TipCard` (the injected unit — full spec carried from `02` §7.4)
This is the same component used in chat/portfolio/strategy/confirm; specify it once here as the canonical anatomy. It is **read-only** (no confirmation gate; `02` §6).

| Slot | Content | Rules | shadcn |
|---|---|---|---|
| **Tone marker** | left `--info` rule / info icon | `--info` (blue), **never green** (`04` §2.4) — education ≠ gain. | icon + border |
| **Title** | the term/question, plain | e.g. "What's net APY?" / "What are vault shares?" (`07` §4.2). | `text-h4`/`CardHeader` |
| **Body** | ≤2 sentences: **plain definition → why it matters to you** | Never condescend ("simply/just/easy/obviously" banned, `07` §4.1/§9.3). Honest when teaching yield (rates change, principal at risk). | `text-sm` |
| **Footer (≤1 action)** | **"How this works"** → `/learn/[slug]` | **Dismissable; never re-nags after dismiss** (`07` §4.2). One action only. | `Button variant="link"` + dismiss `×` |

> **Canonical tip exemplar (`07` §4.2, shares):** "Shares (spvUSDC) are your slice of the vault. As the vault earns, each share is worth more — your count stays the same, its value grows. You can redeem shares for USDC anytime."

## B.3 The hub (`/learn`)

### B.3.1 Layout — desktop
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL + AI DISCLAIMER STRIP                                              │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│ SECONDARY│ H1 "Learn"  ·  subhead "Plain explanations so you can judge every move"│
│ NAV RAIL │ [ Search lessons … ]   [Category ▾: Basics · Yield · Risk · Custody]  │
│          │ ┌── CATEGORY: The basics ─────────────────────────────────────────┐  │
│          │ │ [What is APY?] [What are shares?] [What is slippage?] …          │  │
│          │ │  (LessonCard grid: title + 1-line teaser + ~time + read state)   │  │
│          │ ├── CATEGORY: Risk & safety ──────────────────────────────────────┤  │
│          │ │ [What are guardrails?] [Non-custodial — what it means for you] … │  │
│          │ ├── CATEGORY: Custody & control ──────────────────────────────────┤  │
│          │ │ [Withdraw-always] [Session keys] [Kill-switch (pause-only)] …    │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```
- Lessons grouped by **category** (Basics / Yield / Risk & safety / Custody & control); each is a `LessonCard` (title + 1-line teaser + est. read time + optional "read" check). Search + category filter at top.

### B.3.2 Layout — mobile
- Single column; search pinned; categories as collapsible `Accordion` sections or a horizontal category chip row; `LessonCard`s stacked full-width.

### B.3.3 Lesson detail (`/learn/[slug]`)
- **Three-layer progressive disclosure (`07` §4.1):** (1) **plain definition** up top; (2) **why it matters to you** (personalized framing — e.g., "for your lower-risk plan, this means…"); (3) **optional depth** in an `Accordion` ("Go deeper"). Related lessons + "back to where you were" link (preserves the originating context if entered from a TipCard). On-style diagrams allowed but calm (no hype).
- **Cross-links:** a custody/risk lesson links to the relevant **Trust Center** panel ("See this on your account ▸" → `/trust/...`) so theory connects to proof.

## B.4 States (literacy)
- **Hub default:** categories populated; search idle.
- **Hub empty (search/filter no results):** "No matches" / "Try a different search." + "Clear search" (`07` §6.2).
- **Hub loading:** skeleton `LessonCard` grid.
- **Lesson default:** three layers present; related links.
- **Lesson loading:** skeleton text blocks.
- **Lesson not-found (bad slug):** "We couldn't find that lesson. Browse all lessons." → `/learn`.
- **TipCard default / dismissed:** default shows; once dismissed it does **not** re-nag (persisted per term, `07` §4.2).
- **Degraded:** hub still readable (static-ish content); never blocks a flow; withdraw unaffected.

## B.5 Microcopy (literacy) — defer to `07` §4
- Hub header: "Learn" + "Plain explanations so you can judge every move."
- TipCard titles: "What's net APY?", "What are vault shares?", "What is slippage?", "What are guardrails?", "What does non-custodial mean for you?" (use the §4.3 glossary definitions verbatim so a term reads the same everywhere).
- Empowering line (somewhere on the hub): "The more you understand, the better you can hold us accountable." (`07` §4.1).
- **Banned:** condescension ("simply/just/easy/obviously/don't worry"), green tone, any implication of guaranteed returns inside a lesson (`07` §4.1, §9.1/§9.3).

## B.6 Non-custody / trust touchpoints (literacy)
- The **custody/control category** is itself a trust surface: lessons on withdraw-always, non-custodial, session keys, kill-switch (pause-only) — using the canonical glossary (`07` §4.3) and **linking to the live proof** in `/trust` (`05`).
- TipCards in the confirm checklist (Flow 6) explain guardrails *at the sign moment* — literacy reinforces, never replaces, the deterministic gate.

## B.7 Benchmarks (literacy)
| Pattern | Benchmark (`09`) | Application |
|---|---|---|
| Just-in-time education embedded at point of need (Acorns-style) | **SmartDev fintech literacy (`09` §4, ★)** | Contextual `TipCard` injection; never gate a flow |
| "Why this risk score?" inline FAQ; tooltips + reassurance | **Wealthfront onboarding (`09` §4, ★★★)** | Inline term tooltips → lesson; three-layer disclosure |
| Plain consumer-grade custody framing | **Ledger / Trust Wallet (`09` §6)** | Custody-category lessons; canonical glossary (`07` §4.3) |

## B.8 Acceptance criteria (literacy)
1. Designed at **1440px + 390px**: hub, lesson detail, and the injected `TipCard`, all states.
2. **`--info` (blue), never green**; no condescension; honest-when-teaching (`07` §4; `04` §2.4).
3. **TipCard:** info tone marker, plain title, ≤2-sentence body (definition → personal relevance), single "How this works" action, **dismissable and non-re-nagging** (`07` §4.2; `02` §7.4).
4. **Three-layer progressive disclosure** on lesson pages (definition → why it matters to you → optional depth).
5. **Never a gate:** no flow is blocked behind a lesson; the hub renders even degraded (`01` §4 note 7).
6. Custody/risk lessons use the **canonical glossary** and **link to live proof** in `/trust`.
7. Maps to shadcn (§E) + AA: keyboard-navigable cards/search/accordions; focus rings; reduced-motion.

---

# C. Outcome Log — the accountability surface (`/activity`, `/activity/[entryId]`)

## C.1 Goal & entry points

### C.1.1 Goal
Hold the AI accountable: show **every recommendation the user acted on, labeled with its realized PnL over time — winners AND losers — each tied to the originating recommendation** (`spec.md` FR-039–041, SC-010; `00` §9). This is the **proof loop closed** (`01` §4 note 4, §4.2.4): acceptance → `/confirm` → an Outcome Log entry that updates with realized PnL. It is the deliberate fix for the tracker gap (weak/absent PnL accountability, no time-based view; `09` §2) and the structural answer to the collapsed "AI fund" cohort (`09` §8).

The one-sentence job: **make the AI's track record visible and honest — losses as plainly as wins — linked to the advice that caused each.**

### C.1.2 Entry points (`01` §4.3)
| From | Behavior | Lands on |
|---|---|---|
| **Secondary nav → "Outcome Log"** | Left rail / "More" drawer. | `/activity` (list) |
| **Chat `OutcomeCard` → "See in your activity"** | In-chat realized-PnL seed (`02` §7.5). | `/activity/[entryId]` |
| **Strategy detail → "See in your activity"** | From `/strategies/[recId]` outcome link (Flow 4 §4.1). | `/activity/[entryId]` |
| **Portfolio position → "Track outcome"** | From a position row (Flow 3). | `/activity/[entryId]` |
| **Notification deep-link → "Outcome updated"** | A realized-PnL update alert. | `/activity/[entryId]` |
| **Confirmation success → "See it in your activity"** | After signing an acted-on rec (`07` §2.5). | `/activity/[entryId]` (newly created) |
| **Command menu (`⌘K`)** | "Show my activity / outcomes". | `/activity` |

### C.1.3 Pre-conditions
- Requires connected wallet (entries are per-account). Degraded/stale: show last-known entries stamped "as of {time}", never present settling PnL as final; withdraw unaffected (`01` §6).

## C.2 Layout

### C.2.1 Desktop (`/activity`, 1440px)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL SHELL + AI DISCLAIMER STRIP                                              │
├──────────┬─────────────────────────────────────────────────────────────────────┤
│ SECONDARY│ H1 "Outcome Log"  ·  subhead "Every move you made on our advice —      │
│ NAV RAIL │   wins and losses — tied to the recommendation behind it."           │
│          │ ┌── SUMMARY STRIP (honest, not a brag) ───────────────────────────┐  │
│          │ │ Acted-on moves: 12  ·  Net realized: +$214.30 (+1.4%, all-time)  │  │
│          │ │ Wins 8 · Losses 4   ·   (range: All ▾)                           │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
│          │ ┌── FILTER BAR ───────────────────────────────────────────────────┐  │
│          │ │ [Outcome ▾: All·Wins·Losses·Pending] [Asset ▾] [Protocol ▾]      │  │
│          │ │ [Time ▾: 1M·3M·1Y·All]  ·  Sort: Newest ▾  ·  active chips ✕…    │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
│          │  OUTCOME TABLE (rows; tabular; right-aligned numbers)                 │
│          │ ┌────────────────────────────────────────────────────────────────┐   │
│          │ │ Date │ Move (rec title) │ Protocol/Asset │ Realized PnL │ Status │   │
│          │ │ Jun 2 │ Rebalance into… │ Aave · USDC   │ −$88.10 ▼     │ Closed │   │
│          │ │       │  (−0.7%, 1M)    │               │ (−0.7%,1M)    │        │   │
│          │ │ May 9 │ Move idle USDC… │ Aave · USDC   │ +$312.40 ▲    │ Open   │   │
│          │ │ …                                                            … │   │
│          │ └────────────────────────────────────────────────────────────────┘   │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```
- **Summary strip:** acted-on count, **net realized PnL with window**, win/loss split — framed factually, **not** as a brag; net loss shown as plainly as net gain (`07` §5.3). Range selector affects the summary + (optionally) the table.
- **Outcome table:** one row per acted-on recommendation; columns = Date · Move (rec title, links to `/strategies/[recId]`) · Protocol/Asset · **Realized PnL** (signed, colored, icon, window) · Status (Open / Closed / Pending-settling). Row → `/activity/[entryId]`.
- **Filters:** Outcome (All/Wins/Losses/Pending) · Asset · Protocol (Aave v3 / Aerodrome only) · Time · Sort. **"Losses" filter is first-class** (never buried) — the surface must make it trivial to see the losers.

### C.2.2 Desktop entry detail (`/activity/[entryId]`)
```
┌──────────┬─────────────────────────────────────────────────────────────────────┐
│ SECONDARY│ ← Back to Outcome Log                                                │
│ NAV RAIL │ Move title  ·  Status badge (Open/Closed/Pending)                     │
│          │ ┌─────────────────────────────────┬──────────────────────────────┐  │
│          │ │ LEFT (primary)                   │ RIGHT RAIL                   │  │
│          │ │ • REALIZED PnL (large, signed,   │ • THE ORIGINAL ADVICE        │  │
│          │ │   colored, icon, window)         │   rec title + "AI suggestion │  │
│          │ │   + small PnL-over-time sparkline│   — you approve & sign" badge│  │
│          │ │ • WHAT HAPPENED (plain ¶):       │   "See the original advice ▸"│  │
│          │ │   the move · the result · why    │   → /strategies/[recId]      │  │
│          │ │   (honest, non-defensive)        │ • THE POSITION               │  │
│          │ │ • TIMELINE: recommended →        │   current value, cost basis, │  │
│          │ │   signed → executed → updates    │   accrued yield; link to     │  │
│          │ │   (each with on-chain proof ↗)   │   /portfolio position        │  │
│          │ │ • ATTRIBUTION: realized vs        │ ─ ACTIONS ─                  │  │
│          │ │   unrealized, fees, window        │ [View transaction ↗]         │  │
│          │ │                                  │ [Ask the AI about this]      │  │
│          │ └─────────────────────────────────┴──────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```
- **Left = the outcome story** (realized PnL headline + sparkline; plain "what happened" incl. the honest reason for a loss; on-chain-proofed timeline; realized-vs-unrealized attribution). **Right = the link back to the advice** (originating rec with the AI-suggestion badge + "See the original advice") and the **link to the live position**, plus proof/ask actions.

### C.2.3 Mobile (390px)
- **List:** summary strip → **filter `Sheet`** (count badge) with "Losses" prominent → stacked **`OutcomeCard` rows** (date, move title, signed-colored PnL + window, status) rather than a wide table; tap → detail.
- **Detail:** single column stacked (PnL headline + sparkline → what happened → original advice link → position link → timeline `Accordion` → actions); on-chain proof links inline.

### C.2.4 Responsive transform
| Desktop | → Mobile |
|---|---|
| Outcome `Table` | stacked `OutcomeCard` rows |
| Inline filter bar | "Filters" → bottom `Sheet` + count badge; active chips scroll-row |
| Detail two-pane (story + advice/position rail) | single column; advice/position links as stacked cards |
| Timeline inline | `Accordion` |

## C.3 The `OutcomeCard` / row — anatomy (carried from `02` §7.5)
| Slot | Content | Rules | shadcn |
|---|---|---|---|
| **Date** | relative + absolute on hover | (`07` §5.6). | `text-sm muted` + `Tooltip` |
| **Move title** | the originating rec's title, **links to `/strategies/[recId]`** | Always tied to the rec (FR-039). | link |
| **Protocol / asset** | Aave v3 / Aerodrome · USDC / ETH | Allowlist only. | `Badge`/text |
| **Realized PnL** | **signed + colored + icon + window**: `+$312.40 (+2.8%, 1M)` / `−$88.10 (−0.7%, 1M)` | Sign+color+icon **always together**, never color alone (`04` §10.2; `07` §5.3). True minus `−` U+2212. Tabular. **Losses never hidden/softened.** | `Badge`/text (gain/loss) |
| **Status** | Open / Closed / **Pending (settling)** | "Pending" when PnL still settling: "Outcome still settling — realized PnL updates over time." (`07` §5.5). Never show settling as final. | `Badge` |
| **Realized vs unrealized** | labeled when both could be meant | Never let unrealized read as banked (`07` §5.3). | label |

## C.4 States (Outcome Log)
- **A. Default (entries present):** summary + filters + table/cards; wins and losses interleaved by sort; "Losses" reachable in one filter click.
- **B. Empty (no history):** "No moves yet" / "Every recommendation you act on — wins and losses — will be logged here, tied to the advice that caused it." (`07` §6.2). No CTA required (or a soft "Explore strategies").
- **C. Empty (filter excludes all):** "No matches" / "Try a different filter." + "Clear filters"; active chips remain so the user sees why (`07` §6.2).
- **D. Loading:** skeleton summary + skeleton rows; no `0`-as-loading.
- **E. Pending/settling entries:** such rows carry the "Pending" status + "updates over time" note; summary excludes unsettled PnL from "realized" or labels it clearly.
- **F. Stale/degraded:** "as of {time}" stamps; "Refresh"; never present stale PnL as live; withdraw unaffected (`01` §6).
- **G. Net-negative summary:** if all-time net realized is a loss, **show it plainly** (`−$X (−y%, all-time)`, `--loss` + icon) — do **not** switch to a flattering window to hide it (`07` §5.3, §9.1). This is the honesty test of the whole surface.
- **H. Error:** "We couldn't load your activity right now. Your funds are safe and untouched. Try again." + "Retry" (`07` §6.1).
- **I. Detail — not-found/expired entryId:** "We couldn't find that entry. See all your activity." → `/activity`.

## C.5 Microcopy (Outcome Log) — defer to `07`
- Header: "Outcome Log" + "Every move you made on our advice — wins and losses — tied to the recommendation behind it."
- Summary: "Acted-on moves: {n} · Net realized: {signed PnL, window} · Wins {w} · Losses {l}."
- The loss exemplar (verbatim pattern, `07` §8): "−$88.10 (−0.7%, 1M) · from the Jun 2 rebalance recommendation. The rate dropped after the move. View tx ↗ · See the original advice."
- Filters: "Outcome: All / Wins / Losses / Pending"; "Time: 1M / 3M / 1Y / All".
- Pending: "Outcome still settling — realized PnL updates over time." (`07` §5.5).
- Empty/error per §C.4 (from `07` §6).
- **Banned:** "drawdown opportunity / temporary dip" for a loss; flattering default windows; hiding red (`07` §9.1/§9.3).

## C.6 Non-custody / trust touchpoints (Outcome Log)
- **Accountability is the trust mechanism (`00` §9; `09` §8).** Honest, symmetric PnL tied to the rec is the product's credibility loop; this surface must read as *self-auditing*, not promotional.
- **On-chain proof everywhere:** every entry's transaction(s) link to the explorer ("View transaction ↗", `07` §2.5) — proof, not promise.
- **Bidirectional link to the advice:** each entry → `/strategies/[recId]` (the originating rec, with its AI-suggestion badge), and each rec detail → its `/activity/[entryId]` (Flow 4 §4.1). The loop is visible from both ends.
- Shell non-custody affordances present; withdraw-always reachable even when an outcome is a loss (no friction added to exit).

## C.7 Benchmarks (Outcome Log)
| Pattern | Benchmark (`09`) | Application |
|---|---|---|
| Per-position **performance attribution** (how each contributes to returns) | **Zerion (`09` §2, ★★)** — but fix its weak/clutter PnL with explicit defs + progressive disclosure | Realized-vs-unrealized labeled; tooltip'd PnL; entry detail attribution |
| Fill the shared tracker gap: **no PnL accountability, no time-based view** | **Zapper/DeBank/Zerion comparison (`09` §2, ★)** | Time filters, win/loss split, outcome-over-time updates |
| Goals-based "on/off track" honesty | **Betterment (`09` §4, ★★)** | Outcome read against the mandate; honest framing |
| Out-position collapsed "AI fund" cohort with transparent results | **Competitor intel (`09` §8)** | Symmetric wins/losses; on-chain proof; no yield theater |

## C.8 Acceptance criteria (Outcome Log)
1. Designed at **1440px + 390px**: list (table) and entry detail; all states (default / empty-no-history / empty-filter / loading / pending / stale / **net-negative** / error / not-found).
2. **Every entry is tied to its originating recommendation** (`recId` link both directions) and shows **realized PnL with sign + color + icon + window** (FR-039–041; `07` §5.3).
3. **Wins and losses are symmetric**; the "Losses" filter is first-class; **net-negative summaries are shown plainly** (no flattering window, no hidden red) (`07` §5.3, §9.1).
4. **On-chain proof** ("View transaction ↗") on every entry; the link to the live position and to the original advice both present (FR-039; `07` §2.5).
5. **Pending/settling** outcomes labeled, never shown as final; realized vs unrealized labeled (`07` §5.3/§5.5).
6. Tabular numerals; en-dash vs `$0.00`; no `0`-as-loading; stale labeled (`07` §5; `04` §6.1).
7. Maps to shadcn (§E) + AA; withdraw-always reachable; PnL never color-only.

---

# D. Settings (`/settings` + `/settings/{account, mandate, notifications, appearance, security}`)

## D.1 Goal & entry points

### D.1.1 Goal
Give the user a single, calm place to **edit their plan (mandate), goals, notification thresholds, view/manage their connected wallet & smart account, manage automation/permissions, and switch theme** — **without ever silently changing custody**. Anything that touches on-chain authority routes through the proper signed/confirmed surface and is mirrored in `/trust` and `/automation` (`01` §4 notes 1, 6). Editing the mandate **re-runs the review/confirm step** so the spine stays consistent (`01` §4.2.1, §6 note 5).

The one-sentence job: **let the user adjust preferences and plan safely, with custody-affecting changes always explicit, signed where required, and mirrored in the trust surfaces.**

### D.1.2 Entry points (`01` §4.3)
| From | Behavior | Lands on |
|---|---|---|
| **Avatar menu → "Settings"** | Top-bar avatar. | `/settings` (index) |
| **Secondary nav → "Settings"** | Left rail / "More" drawer. | `/settings` |
| **Strategies / Portfolio → "Edit plan"** | From the mandate context bar (Flow 4 §3.4 / Flow 3). | `/settings/mandate` |
| **Prove-it panel / Trust Center → "Manage permissions"** | From the non-custodial badge panel. | `/settings/security` (→ links to `/automation`, `/trust`) |
| **Notification → "Adjust thresholds"** | From an alert. | `/settings/notifications` |
| **Command menu (`⌘K`)** | "Settings / edit plan / theme". | relevant sub-route |

### D.1.3 Pre-conditions
- Authenticated. Mandate edit requires the mandate spine; theme works always. Custody-affecting controls (revoke session key, view permissions) require the connected account and route to signed/proof surfaces.

## D.2 Layout

### D.2.1 Desktop (`/settings`, 1440px) — `Tabs` (or section nav) + form panel
```
┌──────────┬─────────────────────────────────────────────────────────────────────┐
│ SECONDARY│ H1 "Settings"                                                        │
│ NAV RAIL │ [ Account · Plan & goals · Notifications · Appearance · Security ]    │
│          │ ┌──────────────── ACTIVE SECTION PANEL ───────────────────────────┐  │
│          │ │ (form controls; one primary save per section; helper text)       │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```
- Left section nav (`Tabs` vertical) ↔ right form panel. **One primary (spark) save per section** (`07` §2.2). Unsaved-changes guard on navigate away.

### D.2.2 Mobile (390px)
- `/settings` index = a **list of sections** (rows → sub-routes), each opening its own screen (avoids cramped tabs); sticky "Save" per sub-screen; back returns to index. (Mobile favors a settings *list* over horizontal tabs, `04` §4.2.)

### D.2.3 Sections & anatomy

**(1) Account — `/settings/account`** (smart account + connected wallet)
| Element | Content | Rules | shadcn |
|---|---|---|---|
| Connected wallet | address (mono, truncated `0x12…ab`, copy), network "Base" pill, connection status | "You own your keys and your account. We never hold them." (`07` §7). | `Card` + `Badge` + copy |
| Smart account | account address + "You are the sole owner/admin signer." | Structural fact, not a promise (FR-028/035; `07` §7). Links to `/trust/permissions` for the exact on-chain scopes. | `Card` + link |
| Disconnect | "Disconnect wallet" | Disconnecting the app **never** affects custody/withdraw (on-chain exit remains). Empowering copy. | `Button` (secondary) |
| Beta status | whitelist status + per-user cap ("Beta cap: ${used} of ${cap} used") | Neutral, not punitive (`07` §2.3). | `Card` + caps meter (`04` §6.5) |

**(2) Plan & goals — `/settings/mandate`** (risk profile + goals edit → re-runs mandate)
| Element | Content | Rules | shadcn |
|---|---|---|---|
| Current mandate | "Your plan: Lower risk (1/5), capital preservation first, steady USDC yield." | Risk tier from the **risk palette** (`04` §2.5); the spine (`01` §4.2.1). | `Card` + `Badge` (risk tier) |
| Risk tolerance | adjustable (scenario re-take or slider) | Edits **re-run the mandate review/confirm** (Flow 1; `01` §6 note 5). Prefer scenario-based over abstract self-rating (`09` §4 robo-advisor). | `RadioGroup` of scenario cards / `Slider` |
| Goals | capital preservation / steady yield / timeline | Plain language; drives Strategies ranking, Portfolio risk panel, Chat (`01` §4.2.1). | `Form` controls |
| Save | "Save my plan" → review → confirm | Verb per `07` §2.2; change reflected in subsequent recommendations (FR-004). | `Button` (spark) |

**(3) Notifications — `/settings/notifications`** (channels + thresholds) — see §E.3 detail
| Element | Content | Rules | shadcn |
|---|---|---|---|
| Channels | in-app (always), email/push (if available) toggles | Honest about what's available in beta. | `Switch` |
| Alert types + thresholds | drift, cap-approaching (%), big-move (%), kill-switch, outcome-updates — each with on/off + threshold | Thresholds plain ("Alert me when my beta cap is {80%} used"). Tabular. | `Switch` + `Slider`/`Input` |

**(4) Appearance — `/settings/appearance`** (theme)
| Element | Content | Rules | shadcn |
|---|---|---|---|
| Theme | **Dark (default)** / Light / System | **Dark-first** (`04` §2.1); both AA (`04` §10.1). Live preview. | `RadioGroup`/`Tabs` |
| (Optional) density/number format | if offered, keep tabular always | Tabular numerals non-negotiable (`04` §3.1). | `RadioGroup` |

**(5) Security — `/settings/security`** (sessions, permissions)
| Element | Content | Rules | shadcn |
|---|---|---|---|
| Active session keys | list: scope, caps, expiry, "Revoke access" | **Revoke is instant, unilateral, prominent, empowering** (FR-031; `07` §2.2). `AlertDialog` confirm, but copy is empowering not scary (`04` §11). Mirrors/links `/automation`. | `Card` rows + `Button` (destructive) + `AlertDialog` |
| On-chain permissions | "See exactly what SparkPoint can & can't do" | Links to the **prove-it panel / `/trust/permissions`** (`01` §2; `05`). Does not re-implement it. | link → prove-it |
| Withdraw / exit | "Withdraw everything" / self-service exit | Always present; routes to `/trust/exit` / withdraw (`01` §0.6). | `Button` |

## D.3 States (Settings)
- **Default:** sections render current values; no unsaved changes.
- **Editing / dirty:** "Save" enabled; **unsaved-changes guard** on navigate-away ("Discard changes?").
- **Saving:** button loading; on success a `Sonner` toast "Plan saved" / "Settings saved".
- **Success (mandate):** "Plan saved. The AI will rank moves to fit it. You approve and sign each one." (`07` §8 mandate framing).
- **Validation error:** inline field error, plain, non-blaming (`07` §6.1); never raw tech.
- **Save error:** "We couldn't save that just now. Try again." + retry; nothing custody-affecting changed.
- **Loading:** skeletons for current values.
- **Revoke flow (security):** `AlertDialog` → on confirm, instant revoke + success toast "Access revoked. SparkPoint's AI can no longer act on your behalf. You sign everything from here." (`07` §2.5); mirrored in `/automation` + prove-it.
- **Disconnect:** confirm + reassurance that custody/withdraw is unaffected.
- **Degraded:** theme still works; mandate/security reads may be stale-labeled; withdraw/revoke paths unaffected (`01` §6).

## D.4 Microcopy (Settings) — defer to `07`
- Section labels: "Account", "Plan & goals", "Notifications", "Appearance", "Security".
- Buttons: "Save my plan", "Save", "Revoke access", "Withdraw everything", "Disconnect wallet" (`07` §2.2 — never "Disable" for revoke; "Revoke access" is the empowering verb).
- Account custody lines (verbatim intent, `07` §7): "You own your keys and your account. We never generate a wallet for you or hold your keys."
- Caps: "Beta cap: ${used} of ${cap} used" (neutral, `07` §2.3).
- Theme labels: "Dark (default) / Light / System".
- **Banned:** "Disable AI/automation" (use "Revoke access"); custody framed as a promise; hype (`07` §9.3).

## D.5 Non-custody / trust touchpoints (Settings)
- **Account** states user-owned keys/sole-signer as **structural fact** and links to the exact on-chain scopes in `/trust/permissions` (FR-028/035/037; `07` §7).
- **Security** hosts **instant, unilateral, prominent Revoke** (FR-031), links to the prove-it panel, and keeps **Withdraw everything** present — Settings is a place to *exercise* control, not a place custody can be quietly weakened.
- **Mandate edit re-runs review/confirm** so plan changes never bypass the spine (`01` §6 note 5).
- Disconnecting the app explicitly **does not** affect on-chain custody or withdraw-always.

## D.6 Benchmarks (Settings)
| Pattern | Benchmark (`09`) | Application |
|---|---|---|
| Adjustable risk tolerance + "why this risk score?" + scenario capture | **Wealthfront / robo-advisor (`09` §4, ★★★/★★)** | `/settings/mandate` scenario re-take + adjustable tolerance; re-runs mandate |
| Plain self-custody / key-ownership framing | **Ledger / Trust Wallet (`09` §6)** | Account section custody copy; link to live permissions |
| Instant, user-controlled revoke (spend-limit/whitelist control vocabulary) | **Ledger smart-wallet safety (`09` §6) / Rabby revoke (`09` §5)** | `/settings/security` instant revoke; prominent, empowering |

## D.7 Acceptance criteria (Settings)
1. Designed at **1440px + 390px**: index + all five sub-sections (Account, Plan & goals, Notifications, Appearance, Security), all states.
2. **Mandate edit re-runs review/confirm**; changes reflect in subsequent recommendations (FR-004; `01` §6 note 5).
3. **Custody is never silently changed:** account states user-owned keys as structural fact + links to live permissions; **Revoke is instant/unilateral/prominent/empowering** (FR-028/031/035); withdraw-always present.
4. **Dark-first theme** with Light/System, both AA (`04` §2.1, §10.1).
5. Notification thresholds editable and plainly worded; tabular; neutral caps framing.
6. Unsaved-changes guard; calm validation/save errors (no raw tech, no blame); success toasts per `07` §2.5.
7. Maps to shadcn (§E) + AA: keyboard-completable forms; focus rings; `Switch`/`RadioGroup`/`Slider`/`Select` accessible; destructive revoke via `AlertDialog`.

---

# E. Notifications / alerts (`/notifications`, bell preview, toasts)

## E.1 Goal & entry points

### E.1.1 Goal
Surface the events that matter — **drift vs target risk, cap approaching, big move, kill-switch event, plus transaction/sign results, guardrail blocks, session-key expiry, and outcome updates** — calmly, specifically, and **without manufacturing urgency** (`07` §1.4). Notifications are the **time-based alerting** layer the trackers lack (`09` §2, §4) and route the user to the right surface to act. Toasts handle ephemeral tx/sign feedback; the center (`/notifications`) is the durable log.

The one-sentence job: **tell the user what changed and where to act, honestly and without alarm — never blocking the withdraw path.**

### E.1.2 Entry points (`01` §2, §4.3)
| From | Behavior | Lands on |
|---|---|---|
| **Bell icon (shell)** | Unread `Badge` count; opens a **`Sheet`/`Popover` preview** of recent alerts. | preview → `/notifications` |
| **Bell → "See all"** | Full list. | `/notifications` |
| **Toast (`Sonner`) → action** | tx/sign result, blocked, "Retry"/"View tx ↗". | relevant surface / explorer |
| **Notification row → deep-link** | each alert links to its surface (drift → Portfolio risk panel / Strategies; cap → Vault/Settings; kill-switch → `/trust`; outcome → `/activity/[entryId]`). | the relevant route |
| **Settings → thresholds** | "Adjust thresholds". | `/settings/notifications` |

### E.1.3 Pre-conditions
- In-app notifications always available authenticated; email/push only if configured. **No notification ever blocks withdraw**; a kill-switch alert explicitly reassures withdrawals remain open (`07` §2.1; `01` §6).

## E.2 Layout

### E.2.1 Bell preview (`Sheet` mobile / `Popover` desktop)
- Header "Notifications" + "Mark all read"; recent items (icon + title + 1-line + relative time + unread dot); footer "See all" → `/notifications`. Each item deep-links.

### E.2.2 Center (`/notifications`)
```
┌──────────┬─────────────────────────────────────────────────────────────────────┐
│ SECONDARY│ H1 "Notifications"  ·  [Mark all read]  ·  [Adjust thresholds ▸]      │
│ NAV RAIL │ [ Filter ▾: All · Alerts · Transactions · Outcomes · System ]        │
│          │ ┌── NOTIFICATION ROWS (grouped by day) ───────────────────────────┐  │
│          │ │ ⚠ Drift — your mix moved above your plan (1/5 → reads 2/5).      │  │
│          │ │    "Review" → /strategies (pre-filtered)        · 2h ago  •unread│  │
│          │ │ ◴ Cap approaching — beta cap 82% used.                           │  │
│          │ │    "See your cap" → /settings/account            · 5h ago       │  │
│          │ │ ▲ Big move — your ETH position +6.2% (today).                    │  │
│          │ │    "View portfolio" → /portfolio                 · 1d ago       │  │
│          │ │ ⏸ Kill-switch — new deposits paused. Withdrawals are NOT         │  │
│          │ │    affected — you can withdraw anytime. "Details" → /trust  · 2d │  │
│          │ │ ✓ Outcome updated — your May 9 move is now +$312.40 (+2.8%,1M).  │  │
│          │ │    "See it" → /activity/[entryId]                · 3d ago       │  │
│          │ └──────────────────────────────────────────────────────────────────┘  │
└──────────┴─────────────────────────────────────────────────────────────────────┘
```
- Rows grouped by day; each = semantic icon (never color-only) + title + plain 1-line + **deep-link action** + relative time (absolute on hover) + read/unread. Filter by type. "Mark all read".

### E.2.3 Mobile
- Bell → bottom `Sheet` preview; `/notifications` = stacked rows; filter as a chip row or small `Sheet`; same deep-links.

### E.2.4 Responsive transform
| Desktop | → Mobile |
|---|---|
| Bell `Popover` preview | bottom `Sheet` preview |
| Inline filter | chip row / small `Sheet` |
| Day-grouped table-ish rows | stacked rows |

## E.3 Alert types & anatomy
| Type | Trigger | Copy intent | Tone/icon | Deep-link |
|---|---|---|---|---|
| **Drift** | mix drifts above target risk (vs mandate; `09` §4 "on/off track") | "Your mix moved above your plan ({tier}→reads {tier}). Review your options." | `--caution` amber + alert-triangle | `/strategies` (pre-filtered) / Portfolio risk panel |
| **Cap approaching** | per-user/vault cap nears (threshold, default ~80%) | "Beta cap {x}% used. You can still withdraw anytime." | `--caution` + clock; **never punitive** (`07` §2.3) | `/settings/account` / `/vault` |
| **Big move** | position moves > threshold (% , windowed) | "Your {asset} position {±x}% ({window})." | `--gain`/`--loss` + triangle (sign+icon, not color-only) | `/portfolio` |
| **Kill-switch event** | pause armed/lifted | "New deposits paused. **Withdrawals are not affected — you can withdraw anytime.**" / "Deposits resumed." | `pause` icon, **never "stop/lock"** (`07` §2.1, §4.3) | `/trust` |
| **Outcome updated** | realized PnL of an acted-on rec changes | "Your {date} move is now {signed PnL, window}." (wins **and** losses) | gain/loss icon | `/activity/[entryId]` |
| **Transaction result** | tx success/failure (toast + entry) | success "Deposit confirmed · View tx ↗"; failure "Couldn't reach Base · Retry" + "Nothing moved — your funds are untouched." | semantic; fund-safety reassurance on failure (`07` §6.1) | explorer / surface |
| **Guardrail blocked** | policy blocked a proposed action | "Blocked by your guardrails: {plain reason}." | `--destructive` + alert (`07` §6.1) | the originating surface |
| **Session-key expiry** | session key near/at expiry | "Your automation expires {when}. Re-authorize if you want it to continue." | neutral/`--caution` | `/automation` |

- **Toasts (`Sonner`):** ephemeral, ≤1 line, semantic, with proof/retry link; the durable copy lives in `/notifications` (`07` §6.4; `04` §7).

## E.4 States (Notifications)
- **Default (has notifications):** grouped rows; unread dots; filter idle.
- **Empty (caught up):** "You're all caught up" / "Transaction results and important alerts will appear here." (`07` §6.2).
- **Empty (filter excludes all):** "No matches" / "Try a different filter." + "Clear filter".
- **Loading:** skeleton rows.
- **All-read:** unread badge cleared; rows show read styling.
- **Degraded:** new alerts may be delayed; a subtle "may be delayed" note; **kill-switch/withdraw messaging unaffected** (`01` §6).
- **Error (couldn't load):** "We couldn't load your notifications. Your funds are safe. Try again." + "Retry".

## E.5 Microcopy (Notifications) — defer to `07`
- Header: "Notifications"; "You're all caught up" (empty).
- Kill-switch (verbatim intent, `07` §2.1): "Pause only — this can never block your withdrawals." / row: "New deposits paused. Withdrawals are not affected — you can withdraw anytime."
- Cap: "Beta cap {x}% used. You can still withdraw anytime." (neutral, `07` §2.3, §6.1).
- Tx failure (verbatim intent): "Nothing moved — your funds are untouched." (`07` §6.1).
- Outcome update: reuse PnL format (sign+color+icon+window, `07` §5.3).
- **Banned:** urgency/FOMO/countdowns, "stop/lock funds" for kill-switch, raw tech strings, exclamation marks on financial figures (`07` §9.1/§9.3).

## E.6 Non-custody / trust touchpoints (Notifications)
- **Kill-switch alerts always reassure withdrawals are unaffected** (pause-only; `07` §2.1, §4.3) — the alert is itself a trust moment.
- **Transaction-failure toasts/entries reassure funds didn't move** (`07` §6.1) — addresses custody anxiety at the spike.
- **Cap alerts pair the limit with "you can still withdraw anytime."**
- No notification gates or delays withdraw; the shell's exit path is reachable from `/notifications` like everywhere (`01` §6).

## E.7 Benchmarks (Notifications)
| Pattern | Benchmark (`09`) | Application |
|---|---|---|
| **Time-based alerting** the trackers lack | **Zapper/DeBank/Zerion gap (`09` §2, ★)** | Drift / cap / big-move / outcome alerts — our differentiator |
| "On/off track" drift language | **Betterment (`09` §4, ★★)** | Drift alert framed vs the mandate target |
| Sober tx/sign result feedback + explorer proof | **Tenderly/Rabby (`09` §5)** | Tx toasts with "View tx ↗"; blocked = plain reason |
| Plain pause-only / withdraw vocabulary | **Ledger/Trust Wallet (`09` §6) / `07` §2.1** | Kill-switch + cap alerts reassure withdraw |

## E.8 Acceptance criteria (Notifications)
1. Designed at **1440px + 390px**: bell preview (`Popover`/`Sheet`), center (`/notifications`), and toast (`Sonner`) patterns; all states (default / empty-caught-up / empty-filter / loading / all-read / degraded / error).
2. **All required alert types** designed: drift, cap-approaching, big-move, kill-switch event, plus tx-result, guardrail-blocked, session-key-expiry, outcome-updated.
3. **Kill-switch alerts reassure withdrawals are unaffected**; **tx-failure reassures funds didn't move**; cap alerts pair with withdraw-anytime (`07` §2.1, §6.1).
4. **No manufactured urgency**; semantic icons never color-only; PnL/big-move = sign+color+icon+window; tabular (`07` §9.3; `04` §10.2; `07` §5.3).
5. Each alert **deep-links to the right surface** to act; thresholds editable in `/settings/notifications`.
6. **No notification blocks/delays withdraw** (`01` §6); withdraw path reachable from this surface.
7. Maps to shadcn (§E.9) + AA; keyboard-operable; reduced-motion (no alarming animation).

---

## E.9 shadcn/ui mapping (all five surfaces)

| Element | shadcn/ui primitive(s) |
|---|---|
| **SRK** balance / utilities / FAQ | `Card` + `Tabs`/`Accordion` + `Badge` (status, "Optional") + `Alert` (info, non-essential callout) |
| **SRK** "How to use" disclosure | `Popover` (desktop) / `Sheet` (mobile) |
| **Literacy** hub `LessonCard` grid + search/filter | `Card` grid + `Input` (search) + `Select`/chip filters + `Skeleton` |
| **Literacy** lesson (3-layer) | prose + `Accordion` ("Go deeper") + related-link `Card`s |
| **Literacy** contextual `TipCard` | `Card`/`Alert` (info tone) + `Button variant="link"` ("How this works") + dismiss `×` (`HoverCard`/`Popover` for inline term defs) |
| **Outcome Log** list | `Table` (desktop) / stacked `OutcomeCard` (mobile) + `Badge` (gain/loss/status) |
| **Outcome Log** summary strip | `Card` + tabular figures + range `Select`/`ToggleGroup` |
| **Outcome Log** filters | `DropdownMenu`/`Select` per facet (desktop) / `Sheet` (mobile) + removable chip `Badge`s |
| **Outcome Log** entry detail | `Card` (two-pane) + Recharts mini sparkline + `Accordion` (timeline) + explorer links + `Badge` (AI-suggestion on the rec link) |
| **Settings** section nav + panels | `Tabs` (desktop) / settings-list rows (mobile) + `Form` |
| **Settings** controls | `Input`, `Switch`, `Select`, `RadioGroup` (scenario/theme), `Slider` (risk/thresholds) |
| **Settings** mandate risk tier | `Badge` (risk palette §2.5) + `RadioGroup` of scenario `Card`s / `Slider` |
| **Settings** caps | `Progress` (caps meter, `04` §6.5) |
| **Settings** revoke / disconnect | `Button` (destructive) + `AlertDialog` (empowering copy) |
| **Settings** unsaved-changes guard | `AlertDialog` |
| **Notifications** bell | bell + unread `Badge` + `Popover` (desktop) / `Sheet` (mobile) preview |
| **Notifications** center rows | list rows + semantic icons (`04` §2.4) + `Badge` (type/unread) + deep-link `Button`/links + day grouping |
| **Notifications** filters | `Select`/chip filters |
| **Toasts** (all surfaces) | `Sonner` (semantic; proof/retry link) |
| **Empty / error / stale** (all) | empty-state `Card` + Lucide icon + microcopy + CTA; `Alert` (destructive/warning/info) |
| **Loading** (all) | `Skeleton` |

---

## F. Global acceptance criteria (this bundle)

A design satisfies this handover when **all** hold:

1. **All five surfaces, both breakpoints, all states.** SRK, Literacy (hub + lesson + TipCard), Outcome Log (list + detail), Settings (index + 5 sub-sections), Notifications (bell + center + toasts) — each designed at **1440px desktop** and **390px mobile**, with every state listed in §§A–E and on-spec copy from `07`.
2. **SRK is provably non-essential.** "Optional — not needed to use SparkPoint" framing + persistent non-essential callout; low-prominence placement; **no core dependency, no price/buy/yield-theater, no urgency** (FR-045/046, SC-013; `09` §8).
3. **Literacy is just-in-time, `--info`, never a gate.** Contextual `TipCard` (info tone, ≤2-sentence definition→relevance, single "How this works", dismissable/non-re-nagging) + a 3-layer hub; no flow blocked behind a lesson; custody lessons link to live proof (`01` §4 note 7; `07` §4; `04` §2.4).
4. **Outcome Log is honest and accountable.** Every entry tied to its originating `recId` (both directions), realized PnL = sign+color+icon+window, **wins and losses symmetric**, **net-negative shown plainly**, on-chain proof on every entry, pending/settling labeled (FR-039–041, SC-010; `07` §5.3, §9.1).
5. **Settings never weakens custody silently.** User-owned keys stated as structural fact + linked to live permissions; mandate edit re-runs review/confirm; **revoke is instant/unilateral/prominent/empowering**; dark-first theme; withdraw-always present (FR-004/028/031/035; `01` §6 note 5).
6. **Notifications are calm, deep-linking, and never block withdraw.** All required alert types (drift, cap, big-move, kill-switch, + tx/blocked/expiry/outcome); kill-switch + tx-failure + cap alerts carry the withdraw/fund-safety reassurance; no urgency; semantic icons not color-only; each routes to the right surface (`09` §2/§4; `07` §2.1, §6.1).
7. **Non-custody reachable from every surface.** Shell badge → prove-it, AI disclaimer strip, and a withdraw/exit path ≤1 tap away on all five surfaces; no degraded/stale/error state removes the withdraw path (`00`; `01` §0.1, §6).
8. **Numbers + a11y to spec.** Tabular numerals everywhere financial; PnL/APY/shares/caps per `07` §5; en-dash vs `$0.00`; no `0`-as-loading; stale labeled; full keyboard operability; visible spark focus rings; AA contrast both themes; reduced-motion honored; `Dialog→Sheet/Drawer` on mobile (`04` §3, §6, §10).
9. **Maps to shadcn.** Every element resolves to the §E.9 map.

---

## G. Cross-references

- **Routes, shell, secondary nav, gating/degraded, mandate spine, proof-loop, SRK isolation, Learn-is-contextual:** `01-information-architecture.md` (§1, §2, §4 notes 1/4/6/7/8, §6).
- **Tokens, `--info` literacy tone, risk palette, PnL convention, caps meter, tabular numerals, motion, a11y, component map (Outcome log / Settings / SRK / Literacy / Notifications rows):** `04-design-system.md` (§2, §3, §6, §7, §10, §11).
- **All canonical wording — trust motifs, button verbs, literacy tip pattern + glossary, PnL/APY/number formatting, error/empty/warning copy, the loss exemplar, banned/required phrases:** `07-content-and-tone.md` (§2, §4, §5, §6, §8, §9) — **wins on any conflict.**
- **The in-chat `TipCard` and `OutcomeCard` seeds (kept consistent here):** `02-flows/02-chat-assistant.md` (§7.4, §7.5).
- **The bidirectional rec↔outcome link (Strategies ⇄ Outcome Log):** `02-flows/04-strategy-recommendations.md` (§4.1 outcome link; this doc §C).
- **Mandate capture that `/settings/mandate` re-runs:** `02-flows/01-onboarding.md`.
- **Trust Center / prove-it permissions / withdraw-exit that Settings & Notifications link into (never re-implement):** `05-trust-and-safety-ux.md` / `/trust`.
- **Automation / session keys that `/settings/security` mirrors:** the Automation surface doc / `/automation`.
- **Benchmark links (tracker PnL/alerting gap; Wealthfront/Betterment/SmartDev; Ledger/Trust Wallet; Tenderly/Rabby; competitor intel):** `09-references.md` (§2, §4, §5, §6, §8).
- **Requirements traced:** FR-004 (mandate edit), FR-007 (contextual literacy), FR-028/031/035 (account/keys/revoke), FR-039–041 (outcome log), FR-045/046 (SRK non-essential); SC-010 (outcome entries), SC-013 (works without SRK); plus the global non-custody invariants (N1–N5) surfaced read-only here.
