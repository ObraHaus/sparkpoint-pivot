# 01 — Information Architecture

> **Handover doc** for Claude Design. This file defines the **sitemap / route map** (Next.js App Router segments), the **global app shell** (persistent non-custodial badge, wallet/connection status, AI disclaimer strip), how the **six core flows + supporting surfaces** connect, **primary vs secondary navigation** for desktop and mobile, and a **user-journey map** from first visit → onboarded → first deposit → ongoing management.
>
> **Scope reminder (authoritative):** Single chain (Base), single launch vault (0-fee Aave Yield Vault, ERC-4626), beta-gated (whitelist + per-user caps + geo-fence), SRK non-essential. Per-action user signing is the **default**; scoped session-key automation is **opt-in**. The protocol can **direct** strategy but has **no code path to take user funds**. Design must make non-custody **visible and provable**, not promised.
>
> **Design thesis to encode in IA:** *AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money.* Two affordances must be reachable from **anywhere** in ≤1 tap: **(1) "prove-it" permissions panel** (what SparkPoint can/cannot do) and **(2) withdraw-always escape hatch** (exit without us).
>
> Stack mapping target: **Next.js (App Router) + TailwindCSS + shadcn/ui**. Routes below are the literal App Router segment plan; component callouts map to shadcn primitives.

---

## 0. IA principles (constraints on every screen)

1. **Non-custody is global, not a page.** The non-custodial badge and the escape hatch live in the **app shell**, present on every authenticated route — never buried in settings.
2. **Chat is the home/hub.** The Chat AI Assistant is the primary surface and the connective tissue; structured cards in chat **deep-link into** the dedicated flows (Portfolio, Strategies, Vault, Confirmation) and back.
3. **Every state-changing path funnels through one Confirmation surface.** Deposit, withdraw, swap, and rebalance all converge on the same Execution Confirmation pattern (simulation + guardrail checklist + user sign). No bespoke per-flow signing UI.
4. **Two-tier nav.** Primary nav = the daily loop (Chat, Portfolio, Vault, Strategies). Secondary nav = trust/control surfaces (Trust Center, Automation, Outcome Log, Literacy, SRK, Settings, Notifications).
5. **Gated-by-default.** Most routes require: connected wallet **and** whitelist pass **and** geo pass. The IA must define what unconnected / not-whitelisted / geo-blocked users see at each route (see §3 and §8).
6. **Withdraw-always survives degraded mode.** If agents/frontend are degraded, the IA must still route users to a working withdraw path (and surface the on-chain self-service exit). Custody and exit are never gated on our backend being healthy.

---

## 1. Route map (Next.js App Router)

App Router segment plan. Convention notes:
- `(group)` = **route group** (organizational, not in the URL).
- `[param]` = dynamic segment.
- `layout.tsx` defines persistent shell for a group; `loading.tsx` / `error.tsx` / `not-found.tsx` define states.
- **Marketing/public** shell (`(public)`) is distinct from the **authenticated app** shell (`(app)`).

```
app/
├── layout.tsx                      # Root layout: theme (dark-first), fonts (tabular numerals),
│                                   #   Web3 + wallet providers, toast/Sonner host, a11y landmarks
├── globals.css
├── not-found.tsx                   # 404
│
├── (public)/                       # PUBLIC SHELL — no wallet required, marketing + entry
│   ├── layout.tsx                  #   slim public header + footer; AI disclaimer in footer
│   ├── page.tsx                    # "/"  Landing — "AI hedge fund" headline, NON-CUSTODY anchor,
│   │                               #        primary CTA: Connect / Enter app
│   ├── how-it-works/page.tsx       # "/how-it-works" — AI proposes / you dispose explainer
│   ├── trust/page.tsx              # "/trust" — PUBLIC trust overview (no account data); links
│   │                               #        to audits, non-custody guarantees, on-chain addresses
│   ├── security/page.tsx           # "/security" — guarantees + audits (public mirror)
│   ├── legal/
│   │   ├── terms/page.tsx          # "/legal/terms"
│   │   ├── privacy/page.tsx        # "/legal/privacy"
│   │   └── risk/page.tsx           # "/legal/risk" — risk disclosures
│   └── waitlist/page.tsx           # "/waitlist" — beta is gated; capture interest
│
├── (auth)/                         # CONNECTION + GATING (interstitials, minimal shell)
│   ├── layout.tsx
│   ├── connect/page.tsx            # "/connect" — wallet connect (WalletConnect / Coinbase / injected)
│   ├── verify/page.tsx             # "/verify" — whitelist (beta) check after connect
│   └── unavailable/page.tsx        # "/unavailable" — geo-fenced / not-whitelisted dead-end,
│                                   #        BUT still surfaces on-chain withdraw-always escape hatch
│
├── (onboarding)/                   # FLOW 1 — chat-driven goals + risk → mandate
│   ├── layout.tsx                  #   focused shell (badge present, primary nav suppressed)
│   └── onboarding/
│       ├── page.tsx                # "/onboarding" — start / resume (router into steps)
│       ├── goals/page.tsx          # "/onboarding/goals"
│       ├── risk/page.tsx           # "/onboarding/risk" — scenario-based risk tolerance
│       ├── review/page.tsx         # "/onboarding/review" — proposed mandate preview
│       └── mandate/page.tsx        # "/onboarding/mandate" — confirmed, human-readable mandate
│
└── (app)/                          # AUTHENTICATED APP SHELL — full nav, badge, disclaimer strip
    ├── layout.tsx                  #   App shell (see §2): top bar + primary nav + disclaimer strip
    │
    ├── chat/                       # FLOW 2 — Chat AI Assistant (PRIMARY / default authed surface)
    │   ├── page.tsx                # "/chat" — newest/active thread
    │   └── [threadId]/page.tsx     # "/chat/[threadId]" — a specific conversation
    │
    ├── portfolio/                  # FLOW 3 — Portfolio Overview
    │   ├── page.tsx                # "/portfolio" — PnL, risk panel, allocation
    │   └── positions/[id]/page.tsx # "/portfolio/positions/[id]" — position detail
    │
    ├── strategies/                 # FLOW 4 — Strategy Recommendations
    │   ├── page.tsx                # "/strategies" — ranked vs mandate, "why this?"
    │   └── [recId]/page.tsx        # "/strategies/[recId]" — recommendation detail + rationale
    │
    ├── vault/                      # FLOW 5 — Vault Deposit / Withdraw (single Aave Yield Vault)
    │   ├── page.tsx                # "/vault" — overview: net APY, shares, caps meter, your position
    │   ├── deposit/page.tsx        # "/vault/deposit"
    │   └── withdraw/page.tsx       # "/vault/withdraw" — withdraw-always entry (manual path)
    │
    ├── confirm/                    # FLOW 6 — Execution Confirmation (shared by ALL state changes)
    │   └── [txIntentId]/page.tsx   # "/confirm/[txIntentId]" — Tenderly-style sim + guardrail
    │                               #        checklist + sign (sign disabled until acks)
    │
    ├── trust/                      # SUPPORTING — Trust Center (account-aware)
    │   ├── page.tsx                # "/trust" — caps dashboard, kill-switch status, whitelist, audits
    │   ├── permissions/page.tsx    # "/trust/permissions" — "PROVE-IT" panel: exact on-chain perms
    │   ├── guarantees/page.tsx     # "/trust/guarantees" — 5 self-custody guarantees
    │   └── exit/page.tsx           # "/trust/exit" — self-service exit / withdraw-always hub
    │
    ├── automation/                 # SUPPORTING — Automation / session keys (opt-in)
    │   ├── page.tsx                # "/automation" — status, active grants
    │   ├── grant/page.tsx          # "/automation/grant" — scope + cap + expiry grant
    │   └── [sessionKeyId]/page.tsx # "/automation/[sessionKeyId]" — detail + INSTANT REVOKE
    │
    ├── activity/                   # SUPPORTING — Outcome Log (wins AND losses)
    │   ├── page.tsx                # "/activity" — outcome log tied to originating recommendation
    │   └── [entryId]/page.tsx      # "/activity/[entryId]" — entry detail (rec → position → PnL)
    │
    ├── learn/                      # SUPPORTING — Financial-literacy hub
    │   ├── page.tsx                # "/learn" — tip library / hub
    │   └── [slug]/page.tsx         # "/learn/[slug]" — article / lesson
    │
    ├── srk/                        # SUPPORTING — SRK utility (non-hypey, non-essential)
    │   └── page.tsx                # "/srk" — informational; nothing core is gated on SRK
    │
    ├── notifications/              # SUPPORTING — Notifications center
    │   └── page.tsx                # "/notifications"
    │
    └── settings/                   # SUPPORTING — Settings
        ├── page.tsx                # "/settings" — index
        ├── account/page.tsx        # "/settings/account" — smart account, connected wallet
        ├── mandate/page.tsx        # "/settings/mandate" — edit goals / risk (re-runs mandate)
        ├── notifications/page.tsx  # "/settings/notifications" — channels + thresholds
        ├── appearance/page.tsx     # "/settings/appearance"
        └── security/page.tsx       # "/settings/security" — revoke sessions, view permissions
```

**Per-route state files (designer must provide states for each):** every `(app)` segment ships `loading.tsx` (skeleton), `error.tsx` (recoverable error + "withdraw is still available" reassurance), and where relevant `not-found.tsx`. The **vault/withdraw**, **trust/exit**, and **confirm** routes must additionally define a **degraded-mode** variant (see §6, §8).

### Notable IA decisions

- **Two `trust` routes by design.** `(public)/trust` = marketing-grade, **no account data**; `(app)/trust` = account-aware Trust Center with the live "prove-it" panel and exit hub. The persistent badge in the app shell deep-links to `(app)/trust/permissions`.
- **`/confirm/[txIntentId]` is a single shared surface.** Deposits, withdrawals, swaps, and rebalances create a `txIntent` and route here. This guarantees a uniform guardrail checklist + simulation + sign experience and one place to enforce "sign disabled until alerts acknowledged."
- **`/vault/withdraw` and `/trust/exit` are distinct but linked.** `/vault/withdraw` is the normal in-app manual withdraw (still funnels to `/confirm`). `/trust/exit` is the **escape-hatch hub** that ALSO documents/links the **on-chain, no-frontend** withdraw path (works even if SparkPoint is offline). Both are reachable in ≤1 tap from the shell.
- **Onboarding is its own shell** (`(onboarding)`) to keep the user focused, but the non-custodial badge is still present.

### Route reconciliation (design names → canonical `plan.md` names — plan.md wins for the build)

The design route labels above are organizational; where they diverge from `specs/001-sparkpoint-pivot-mvp/plan.md` (and `08-deliverables-and-handoff.md` §5.1), **the `plan.md` route names are authoritative and win for the build.** Map:

| Design (this doc) | Canonical (`plan.md`) | Note |
|---|---|---|
| `(app)/strategies/` (+ `[recId]`) | `app/app/strategy/` (+ `[recId]`) | Flow 4. Singular `strategy` is canonical. |
| `(app)/activity/` (+ `[entryId]`) | `app/app/outcomes/` (+ `[entryId]`) | Outcome Log. `outcomes` is canonical. |
| `(app)/trust/exit/` | public `app/exit/` | Withdraw-always escape hatch is a **PUBLIC, backend-independent** route in `plan.md` (see decoupling note below), not an `(app)` child. |
| `(app)/trust/` + `(app)/trust/permissions/` | public `app/trust/` + `app/trust/permissions/` | Trust hub + "prove-it" are **PUBLIC, backend-independent** routes in `plan.md`. |
| `/confirm/[txIntentId]` (Flow 6 surface) | `ExecutionDrawer` chokepoint + `/confirm` | The single signing chokepoint in `plan.md` is the `ExecutionDrawer` component; `/confirm` is its routed surface. Same funnel either way. |
| `(app)/portfolio/positions/[id]` | `app/app/portfolio/` + `[positionId]` | Position detail. Same flow; param naming per `plan.md`. |

Other route names (`onboarding`, `chat`, `vault`, `automation`, `settings`, `srk`) already match `plan.md`. This table is a naming map only — it does not change the sitemap, flow graph, or any acceptance criterion above.

### Decoupling note (exit + permissions are backend-/agent-independent)

Per `plan.md` (§Project Structure, §Architecture, N2/SC-003), the **exit + "prove-it" permissions surfaces are architecturally DECOUPLED from the authenticated app shell and the agent service**: `app/trust/`, `app/trust/permissions/`, and `app/exit/` are **PUBLIC routes with no app-shell or agent data dependency** — they read chain state **directly via RPC** (bundled ABIs + Alchemy/Viem), never through `services/agent` or authenticated/indexer state. This is what makes the **withdraw-always invariant (N2 / SC-003)** hold with **everything else offline**: the self-service exit and the permissions/"prove-it" reads work even if the app shell and agent are down. Design must not couple these screens to authenticated/agent state. (Within the app, the persistent badge and disclaimer-strip still *link to* these surfaces in ≤1 tap per §2; the surfaces themselves do not depend on the app shell to function.)

---

## 2. Global app shell (`(app)/layout.tsx`)

The authenticated shell is identical across all core + supporting surfaces. Three non-custody/trust elements are **persistent and global**.

### 2.1 Anatomy (desktop)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR                                                                        │
│ [Spark logo]   [Primary nav: Chat · Portfolio · Vault · Strategies]            │
│                       [● Non-custodial ▸] [Wallet 0x12…ab ▸] [⌘K] [🔔] [avatar]│
├──────────────────────────────────────────────────────────────────────────────┤
│ AI DISCLAIMER STRIP  — "AI suggestion. You approve & sign. SparkPoint never    │
│                         holds your funds. [Prove it] [Exit anytime]"  (dismiss?)│
├───────────────┬────────────────────────────────────────────────────────────────
│ SECONDARY NAV │  ROUTE CONTENT (the active flow)                                │
│ (left rail,   │                                                                 │
│  collapsible) │                                                                 │
│  Trust Center │                                                                 │
│  Automation   │                                                                 │
│  Outcome Log  │                                                                 │
│  Learn        │                                                                 │
│  SRK          │                                                                 │
│  Settings     │                                                                 │
└───────────────┴────────────────────────────────────────────────────────────────
```

### 2.2 Persistent global elements (must appear on every `(app)` route)

| Element | Where | Behavior | shadcn mapping | Non-custody role |
|---|---|---|---|---|
| **Non-custodial badge** | Top bar, right cluster, left of wallet status | Status dot (green = non-custodial, all invariants nominal). Tap → opens **"prove-it" permissions panel** (see below). | `Badge` trigger → `Popover`/`Sheet`; `HoverCard` for desktop summary | THE persistent proof affordance. ≤1 tap to "what we can/can't do." |
| **Wallet / connection status** | Top bar, right cluster | Shows connected address (truncated) + network (Base) + smart-account state. Tap → menu: copy address, view on explorer, switch wallet, disconnect, **"View exact permissions"** (→ `/trust/permissions`). Surfaces wrong-network / disconnected / pending states. | `DropdownMenu` + `Badge` (network) | Reinforces user-owned keys; entry to permissions + disconnect. |
| **AI disclaimer strip** | Full-width, directly under top bar | Persistent (not a one-time toast). Copy: *"AI suggestion — you approve & sign. SparkPoint never holds your funds."* with two inline links: **[Prove it]** (→ permissions panel) and **[Exit anytime]** (→ `/trust/exit`). Collapsible to a thin line on scroll; never fully removable. | `Alert` (info variant) pinned; `Collapsible` for compact form | Encodes "AI proposes, you dispose" + escape hatch on every screen. |
| **Command menu** | `⌘K` | Jump to any route/flow; "Withdraw now", "Prove it", "Revoke automation" as top actions. | `Command` (cmdk) | Fast path to exit + permissions from anywhere. |
| **Notifications** | Bell icon | Unread count; opens `/notifications` or a `Sheet` preview. | `Sheet` + `Badge` | Surfaces guardrail blocks, caps near-limit, session-key expiry, outcome updates. |

### 2.3 The "prove-it" permissions panel (global, badge-triggered)

Opens as a **`Sheet`** (mobile bottom sheet, desktop right sheet) from the non-custodial badge. Summarizes the **five non-custody guarantees** as live, checkable claims, then links into the full Trust Center:

- **No admin withdrawal** — "Only you can send funds out." (link: on-chain proof)
- **Withdraw-always** — "Exit anytime, even if we're offline." → **[Withdraw now]** (→ `/trust/exit`)
- **You own your keys** — "We never hold or generate your wallet."
- **Scoped, revocable automation** — shows active session keys + **[Revoke]** (→ `/automation`)
- **Non-upgradeable, pause-only** — "We can pause new deposits; we can never move your money."

Each row links to its on-chain evidence in `/trust/permissions`. **This panel is the single most important trust touchpoint** and must be reachable in one tap from every authenticated screen.

### 2.4 Mobile shell

- **Top bar (condensed):** [logo] … [● badge] [wallet chip] [🔔]. Tapping the badge opens the **bottom sheet** prove-it panel.
- **AI disclaimer strip:** condensed to one line with a chevron to expand; persists.
- **Primary nav → bottom tab bar** (4 tabs): **Chat · Portfolio · Vault · Strategies**. Chat is the default/center-weighted tab.
- **Secondary nav → "More" / hamburger** (`Sheet` drawer): Trust Center, Automation, Outcome Log, Learn, SRK, Settings, Notifications — with **Withdraw / Exit** pinned to the top of the drawer for one-tap reach.
- **Persistent "Exit" reach:** the prove-it sheet and the More drawer both expose **Withdraw / Exit** at the top, so the escape hatch is ≤1 tap on mobile too.

---

## 3. Navigation model — primary vs secondary

### 3.1 Primary navigation (the daily loop)

The four surfaces a user touches every session.

| Order | Label | Route | Why primary |
|---|---|---|---|
| 1 | **Chat** | `/chat` | Primary surface + hub; default authed landing. |
| 2 | **Portfolio** | `/portfolio` | "How am I doing?" — PnL, risk, allocation. |
| 3 | **Vault** | `/vault` | The product: deposit/withdraw, net APY, shares, caps. |
| 4 | **Strategies** | `/strategies` | The "fund manager" intelligence; ranked recs. |

**Desktop:** horizontal nav in the top bar. **Mobile:** bottom tab bar (Chat center/default).

> **Confirmation (`/confirm`) is intentionally NOT in primary nav.** It is reached contextually from any action (chat card, vault deposit/withdraw, accepted strategy). It is a *transient* destination, not a *navigable* place.

### 3.2 Secondary navigation (trust + control + support)

| Label | Route | Group |
|---|---|---|
| **Trust Center** | `/trust` | Trust |
| **Automation** | `/automation` | Control |
| **Outcome Log** | `/activity` | Trust (proof loop) |
| **Learn** | `/learn` | Support |
| **SRK** | `/srk` | Support (non-essential) |
| **Notifications** | `/notifications` | Support |
| **Settings** | `/settings` | Control |

**Desktop:** collapsible left rail. **Mobile:** "More" drawer. **Pinned in both regardless of nav tier:** **Withdraw / Exit** (escape hatch) and **Prove it** (permissions), because non-custody affordances must never be more than one tap away.

### 3.3 Utility / always-on (not "nav" but always reachable)

- Non-custodial badge → prove-it panel
- Wallet status menu → permissions / disconnect
- Command menu (`⌘K`)
- AI disclaimer strip links → Prove it / Exit anytime

---

## 4. How the six core flows + supporting surfaces connect

### 4.1 Flow graph (who links to whom)

```
                         ┌───────────────────────────┐
            (first run)  │  (1) ONBOARDING            │
   Connect ─▶ Verify ───▶│  goals → risk → MANDATE    │──┐ produces mandate
                         └───────────────────────────┘  │
                                                          ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  (2) CHAT AI ASSISTANT  — primary hub  (/chat)                        │
   │   emits structured cards: Recommendation · Action · Confirmation       │
   └───┬───────────────┬───────────────────┬───────────────┬──────────────┘
       │ "see portfolio"│ "show strategies" │ "deposit/withdraw"            │ "explain / prove it"
       ▼               ▼                   ▼               ▼               ▼
 (3) PORTFOLIO    (4) STRATEGIES      (5) VAULT       (6) CONFIRM     TRUST CENTER
  /portfolio       /strategies         /vault          /confirm        /trust
   │ risk panel     │ "why this?"        │ deposit/      │ sim + guardrail │ prove-it
   │ position detail│ accept rec ───────▶│ withdraw ────▶│ checklist + SIGN │ permissions
   │                │                    │               │   │             │ caps / kill-switch
   ▼                ▼                    ▼               ▼   │             ▼
   └──────────────▶ OUTCOME LOG (/activity) ◀────────────────┘         AUTOMATION (/automation)
        every acted-on recommendation logs an entry (win OR loss),       grant/revoke session keys
        updated with realized PnL, linked back to the originating rec.
```

### 4.2 Key connective rules

1. **Mandate is the spine.** `(1) Onboarding` produces the human-readable **mandate** stored on the account. `(4) Strategies` ranks **vs the mandate**; `(3) Portfolio`'s risk panel reads against it; Chat references it. Editing it lives at `/settings/mandate` (re-runs the review/confirm steps).
2. **Chat is the hub; cards deep-link.** Chat **Recommendation cards** link to `/strategies/[recId]`. Chat **Action cards** (deposit/withdraw/swap) create a `txIntent` → `/confirm/[txIntentId]`. Chat **Confirmation cards** mirror the confirm surface inline but always offer "open full confirmation." (≤2 actions per card — OpenAI Apps SDK convention.)
3. **All state changes converge on `/confirm`.** Vault deposit/withdraw, accepted strategy, chat action, and automation-proposed rebalance all build a `txIntent` and route to `/confirm/[txIntentId]`. Sign happens **only** here (or inline mirror), and **only after** guardrail acks.
4. **Acceptance writes to Outcome Log.** Accepting a recommendation (via `/strategies/[recId]` or a chat card) → executes via `/confirm` → creates an **Outcome Log** entry (`/activity/[entryId]`) linked to the originating `recId`, updated over time with realized PnL. Losses are shown as plainly as wins.
5. **Trust Center is reachable from everywhere** (badge, disclaimer strip, secondary nav, wallet menu). `/trust/permissions` (prove-it) and `/trust/exit` (escape hatch) are the two privileged children.
6. **Automation wraps `/confirm`, not bypasses it conceptually.** Granting a session key (`/automation/grant`) is itself a signed action routed through `/confirm`. In-scope automated actions then execute under the on-chain policy; each still appears in `/activity` and `/notifications`. **Revoke** is instant from `/automation/[sessionKeyId]` and from the prove-it panel.
7. **Learn is contextual, not just a destination.** `/learn` is the hub, but literacy **tip cards** are injected contextually in Chat, the Portfolio risk panel, the Strategy "why this?", and the Confirmation guardrail checklist. Each tip can deep-link to `/learn/[slug]`.
8. **SRK is a dead-end branch by design.** `/srk` is informational and links **nothing core** to itself. No core flow may depend on it.

### 4.3 Cross-surface entry-point matrix (where each surface is reached from)

| Surface | Reached from |
|---|---|
| Chat `/chat` | Primary nav; post-onboarding redirect; default authed landing; "Ask AI" affordances on every flow |
| Portfolio `/portfolio` | Primary nav; chat "see portfolio"; vault position; notifications |
| Strategies `/strategies` | Primary nav; chat recommendation card; portfolio risk panel ("improve this"); notifications |
| Vault `/vault` | Primary nav; chat action card; strategy "accept"; portfolio allocation |
| Confirm `/confirm/[id]` | **Only** contextually — from vault deposit/withdraw, accepted strategy, chat action, automation grant/rebalance |
| Trust Center `/trust` | Non-custodial badge; disclaimer strip; wallet menu; secondary nav; footer; command menu |
| Automation `/automation` | Secondary nav; prove-it panel; settings/security; chat ("automate this?") |
| Outcome Log `/activity` | Secondary nav; recommendation detail ("track outcome"); notifications; portfolio position |
| Learn `/learn` | Secondary nav; contextual tip cards across all flows |
| SRK `/srk` | Secondary nav; footer only (kept low-prominence) |
| Notifications `/notifications` | Bell icon; deep links from alerts |
| Settings `/settings` | Avatar menu; secondary nav; "Edit mandate" from Strategies/Portfolio |

---

## 5. User-journey map (first visit → onboarded → first deposit → ongoing)

### Stage A — First visit (unauthenticated, public shell)
- **Entry:** `/` (landing). Headline: AI hedge fund; anchored by **NATIVE NON-CUSTODY**.
- **Goal:** establish trust + convert to connect. Public Trust (`/trust`), How-it-works, Security all reachable **before** connecting.
- **CTA:** "Connect wallet" → `/connect`. Beta-gated, so a **[Join waitlist]** path (`/waitlist`) exists for non-whitelisted visitors.
- **Exit/branch:** geo-fence may apply at the app boundary, not the marketing site.

### Stage B — Connect + gate (auth shell)
- `/connect` — choose wallet (WalletConnect v2 / Coinbase Wallet / injected); confirm **Base** network; smart account established/detected (ERC-4337). **No keys generated or held by us** (state this on-screen).
- `/verify` — whitelist (beta) check. **Pass →** continue. **Fail →** `/unavailable` (or `/waitlist`).
- `/unavailable` — geo-blocked or not-whitelisted. **Still surfaces** the on-chain **withdraw-always** path for any existing user (custody/exit never gated).

### Stage C — Onboarding → mandate (onboarding shell, Flow 1)
- `/onboarding` → `goals` → `risk` (scenario-based, Wealthfront/Betterment style) → `review` (proposed mandate) → `mandate` (confirmed, human-readable).
- **Output:** a stored mandate that personalizes Strategies, Portfolio risk, and Chat.
- **Trust touchpoint:** badge present throughout; "you can change this anytime in Settings."
- **Redirect on complete →** `/chat` with a primed first message ("Here's your mandate — want to fund your vault?").

### Stage D — First deposit (Flows 5 → 6)
- From Chat (action card) **or** `/vault` (overview shows net APY, shares-you'd-get, caps meter).
- `/vault/deposit` — enter USDC amount; preview shares + net APY; per-user cap + vault cap surfaced.
- → `/confirm/[txIntentId]` — **Tenderly-style pre-trade simulation** (expected balances, fees, slippage) + **guardrail checklist** (caps ok, allowlist ok, slippage ok, simulation ok). **Sign disabled until every alert acknowledged** (Rabby pattern). User signs.
- **Success →** `/vault` updates (your shares, position), toast + `/notifications` entry, and the deposit is reflected in `/portfolio`.
- **Failure/blocked →** clear reason on `/confirm` (e.g., would exceed cap, sim predicts revert); never a silent failure; withdraw path unaffected.

### Stage E — Ongoing management (loop across Flows 2–6 + supporting)
- **Monitor:** `/portfolio` (PnL, risk panel) and `/vault` (accruing yield, shares).
- **Decide:** `/strategies` ranks recs vs mandate with "why this?"; or ask in `/chat`.
- **Act:** accept rec / deposit / withdraw / swap → `/confirm` → sign.
- **Prove:** non-custodial badge → prove-it panel → `/trust/permissions`; review caps + kill-switch in `/trust`.
- **Automate (optional, P3):** `/automation/grant` (scope + cap + expiry) → signed via `/confirm`; **revoke instantly** anytime.
- **Account for results:** `/activity` outcome log shows each acted-on rec's realized PnL — **wins and losses** — linked back to the rec.
- **Exit anytime:** `/vault/withdraw` (normal) or `/trust/exit` (escape-hatch hub, incl. on-chain no-frontend path). One tap from the shell.

### Journey diagram

```
 PUBLIC            GATE                 ONBOARD              FUND                   MANAGE (loop)
 /  ──connect──▶  /connect ─pass─▶  /onboarding ──▶  /vault/deposit ──▶  ┌─▶ /portfolio ─▶ /strategies ─┐
 │                /verify  ─fail─▶  goals→risk→        │                  │     │              │          │
 │                  │              review→MANDATE       ▼                  │     ▼              ▼          │
 │                  ▼                   │           /confirm  (sim +      │  /chat (hub) ──▶ /confirm ──┐ │
 │             /unavailable             ▼           guardrails + SIGN)    │     │                       │ │
 │             (still shows         /chat (primed) ──┘                     │     ▼                       │ │
 │              withdraw-always)                                           │  /activity (outcome log)    │ │
 │                                                                         │     │                       │ │
 └─────────────────── prove-it / withdraw-always reachable on EVERY authed screen ◀──────────────────────┘ │
                                          (badge · disclaimer strip · /trust/exit)  ◀──────────────────────┘
```

---

## 6. Connection / gating / degraded states (IA-level)

The IA must define what renders at each route under non-happy-path conditions. These are **architecture-level** states; visual treatments are specified in later flow docs.

| Condition | What the IA does | Escape hatch preserved? |
|---|---|---|
| **Wallet disconnected** | App routes redirect to `/connect` (preserve intended route as `?next=`). Public + Trust remain viewable. | Public `/trust` + on-chain exit docs visible. |
| **Wrong network** | Top-bar wallet status shows "Switch to Base"; blocking inline prompt, not a separate route. | Yes — exit instructions remain. |
| **Not whitelisted (beta)** | `/verify` → `/unavailable`; app routes blocked. | **Yes** — `/unavailable` surfaces withdraw-always for existing users. |
| **Geo-blocked** | App boundary blocks `(app)` + `(onboarding)`; routes to `/unavailable`. | **Yes** — withdraw-always preserved (N2). |
| **Agents/backend degraded** | Chat, Strategies, Portfolio show **stale/unavailable** banners; **no execution on stale data**. `/vault` + `/confirm` may warn. | **Yes** — `/vault/withdraw` and `/trust/exit` keep a working manual + on-chain path. |
| **Caps reached (per-user / vault)** | `/vault/deposit` and `/confirm` block deposit with a clear reason; withdraw unaffected. | Yes — withdraw always available. |
| **Session key expired/revoked** | `/automation` reflects status; pending automated `txIntent` fails cleanly; user keeps full manual control. | Yes. |
| **Kill-switch active (pause-only)** | New deposits paused with a banner + `/trust` status; **withdrawals never blocked**. | **Yes — guaranteed** (N2, N5). |

**Hard IA rule:** no gating, error, or degraded state may remove the user's ability to reach a withdraw path. `/trust/exit` and the on-chain self-service exit are always reachable.

---

## 7. Component → shadcn/ui mapping (IA-level shell)

| IA element | shadcn/ui primitive(s) |
|---|---|
| App shell layout | `layout.tsx` + Tailwind grid; `Separator` |
| Top bar nav (desktop) | `NavigationMenu` / Tailwind nav + `Button` (ghost) |
| Bottom tab bar (mobile) | custom Tailwind tab bar (icon `Button`s) |
| Secondary nav rail | `Collapsible` + `ScrollArea` + nav list |
| Non-custodial badge | `Badge` (trigger) → `Sheet` (prove-it) / `HoverCard` (desktop hint) |
| Prove-it permissions panel | `Sheet` (right desktop / bottom mobile) + `Accordion` (per-guarantee) |
| Wallet / connection status | `DropdownMenu` + `Badge` (network) + `Avatar` |
| AI disclaimer strip | `Alert` (info) pinned + `Collapsible` |
| Command menu | `Command` (cmdk) inside `Dialog` |
| Notifications | `Sheet` preview + `Badge` count; `/notifications` list |
| Toasts (success/blocked) | `Sonner` / `Toast` |
| Confirmation surface scaffold | `Card` + `Checkbox` (guardrail acks) + `Button` (disabled until acks) + `AlertDialog` for final sign |
| Loading states | `Skeleton` per `loading.tsx` |
| Errors | `Alert` (destructive) per `error.tsx` |

---

## 8. Acceptance criteria (IA)

A design satisfies this IA doc when:

1. **Sitemap completeness.** Every route in §1 has a designed screen (or an explicit "inherits shell / state-only" note), and every one of the six core flows + every supporting surface (Trust Center, Automation, Outcome Log, Learn, SRK, Settings, Notifications) maps to a route here.
2. **Persistent non-custody shell.** The non-custodial badge, wallet/connection status, and AI disclaimer strip appear on **100% of `(app)` routes** in both desktop and mobile shells.
3. **One-tap proof + exit.** From any authenticated screen, the **prove-it permissions panel** and a **withdraw/exit path** are each reachable in **≤1 tap** (badge, disclaimer strip, command menu, and mobile drawer/sheet all expose them).
4. **Single confirmation funnel.** Deposit, withdraw, swap, accepted-strategy, and automation grant all route through `/confirm/[txIntentId]`; **no flow has a bespoke sign UI**, and sign is disabled until guardrail acks complete.
5. **Mandate spine.** Onboarding produces a mandate that visibly drives Strategies ranking, Portfolio risk panel, and Chat; editing it is reachable from Settings and re-runs review/confirm.
6. **Proof loop closed.** Every acted-on recommendation has a path to an Outcome Log entry (`/activity/[entryId]`) linked to its `recId`, with realized PnL shown for both wins and losses.
7. **Two-tier nav defined for both platforms.** Primary nav = Chat/Portfolio/Vault/Strategies (top bar desktop, bottom tabs mobile). Secondary = Trust/Automation/Outcome Log/Learn/SRK/Settings/Notifications (left rail desktop, drawer mobile), with Withdraw/Exit + Prove-it pinned in both.
8. **Gating + degraded states mapped.** Disconnected, wrong-network, not-whitelisted, geo-blocked, caps-reached, backend-degraded, and kill-switch-active each have a defined route/render per §6, and **none remove the withdraw path**.
9. **SRK isolation.** `/srk` is low-prominence (footer/secondary only) and no core flow depends on it.
10. **shadcn mappability.** Every shell element maps cleanly to a shadcn/ui primitive per §7; nothing in the shell requires a primitive outside the documented set without a noted exception.

---

## 9. Cross-references

- Flow specs (separate handover docs) cover screen-level states, anatomy, and microcopy for: Onboarding (Flow 1), Chat (Flow 2), Portfolio (Flow 3), Strategies (Flow 4), Vault (Flow 5), Confirmation (Flow 6), and supporting surfaces.
- Authoritative product/scope source: `docs/high-level-plan/` (v2 — Native Non-Custodial), `specs/001-sparkpoint-pivot-mvp/spec.md`, and `.specify/memory/constitution.md` (non-custody invariants N1–N5; six guardrails).
