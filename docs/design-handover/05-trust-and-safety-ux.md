# 05 — Trust & Safety UX (Native Non-Custody, Visible & Provable)

> **Handover doc** for Claude Design. This file specifies how SparkPoint makes **native non-custody** *visible and provable* in the UI — the trust spine the entire product rides on. It covers: the **persistent non-custodial badge** + tap-through **"prove-it" permissions panel**; the **Trust Center hub** (five self-custody guarantees, caps dashboard, pause-only multisig kill-switch status, audits & risk ratings); the **always-available self-service / escape-hatch withdrawal**; **default per-action signing**; the **"AI suggestion, you approve & sign"** labeling system; **friction-as-safety** (sign disabled until alerts acknowledged — Rabby pattern); and the **outcome log** as an accountability surface.
>
> **Read first:** `00-brief.md` (positioning, five guarantees, tone) and `01-information-architecture.md` (routes, app shell, badge/disclaimer-strip placement). This doc *deepens* the trust surfaces sketched in `01 §2.2–2.4`, `§3`, and the routes under `(app)/trust/*`, `(app)/automation/*`, `(app)/activity/*`. Where this doc and `01` disagree on placement, `01` wins; this doc is authoritative on **anatomy, states, copy, and acceptance criteria** for the trust surfaces.
>
> **Authoritative scope:** Single chain (Base), single launch vault (0-fee Aave Yield Vault, ERC-4626), beta-gated (whitelist + per-user caps + geo-fence). Per-action user signing is the **default**; scoped, instantly-revocable session-key automation is **opt-in**. The protocol can **direct** strategy but has **no code path to take, move, or withhold user funds**. Multisig/timelock governs **pause only**, never fund movement.
>
> **Stack mapping target:** Next.js (App Router) + TailwindCSS + shadcn/ui. Component callouts map to shadcn primitives. **Do not write code.**

---

## 0. Principles for every trust surface (constraints on every screen here)

1. **Provable, not promised.** Every guarantee in the UI must be backed by an inspectable on-chain artifact: a contract address, a permission set, a read-only call result, a verified-source link, an explorer link, an audit PDF. A claim with no "verify on-chain" affordance is a bug.
2. **One tap from anywhere.** The **prove-it permissions panel** and the **withdraw-always escape hatch** are reachable in **≤1 tap** from every authenticated screen (badge, disclaimer strip, `⌘K`, mobile More drawer). This is a hard IA invariant (`01 §0`).
3. **Custody and exit never depend on our backend.** The escape hatch must be designed to work in **degraded mode** — when the SparkPoint frontend/agent is offline. Withdraw paths render the **on-chain, no-frontend** instructions and addresses regardless of backend health.
4. **Two truthful columns, always.** Trust copy is framed as **"What SparkPoint CAN do"** vs **"What SparkPoint CANNOT do"** — never a one-sided reassurance. The CANNOT column is the differentiator; give it equal or greater visual weight.
5. **Status, not slogans.** Trust surfaces show **live state** (a status dot, a remaining-capacity meter, a "last verified" timestamp, a kill-switch state) rather than static marketing prose. Trust is a dashboard, not a paragraph.
6. **Friction is a feature, scoped to risk.** Signing friction (acknowledge-before-sign) is applied **proportional to risk severity** and never gratuitously. Low-risk routine confirmations stay fast; elevated-risk actions gate the sign button (Rabby pattern). See `04-execution-confirmation` for the full confirm surface; this doc specifies the *acknowledgement/friction model*.
7. **Accountability is permanent.** The outcome log records **wins and losses with equal prominence**, tied to the originating recommendation, and is never editorialized to hide losses. Honesty here is the credibility ballast for the bold hedge-fund claim.
8. **Semantic color is load-bearing.** Green = safe/nominal/allowed/gain; red = blocked/loss/forbidden-capability; amber = caution/near-limit/degraded. The **"CANNOT"** capabilities are styled as a *reassuring* state (a struck-through or lock-icon list), not as red alarms — red is reserved for *user* loss/blocked, not for "the thing we're glad can't happen." (See §1.3 for the exact treatment.)

---

## 1. The persistent non-custodial badge

### 1.1 Goal & entry points

**Goal:** A permanent, glanceable signal that funds are self-custodied and all non-custody invariants are nominal — and a **one-tap doorway** to the proof. This is *the* persistent trust affordance.

**Placement (from `01 §2.2`):** App-shell top bar, right cluster, immediately left of the wallet/connection chip. Present on **every authenticated route** (including the onboarding shell and the focused confirm shell). Never in a footer, never dismissible.

**Entry points:** Always visible in shell. Also surfaced as a `⌘K` action ("Prove it"). The badge is the canonical trigger for the **prove-it permissions panel** (§2).

### 1.2 Anatomy

| Element | Detail | shadcn primitive |
|---|---|---|
| **Status dot** | Live invariant health. Green = all invariants nominal (default). Amber = degraded mode / kill-switch active (pause-only) / session key near expiry. Never red — custody invariants are structural and cannot fail; red on this badge would falsely imply funds at risk. | colored dot inside `Badge` |
| **Label** | Desktop: "Non-custodial". Mobile/condensed: shield/lock glyph only, label hidden ≥sm hidden. | `Badge` (outline/secondary variant) |
| **Caret / affordance** | Small chevron signaling "tap to open". | inline icon |
| **Desktop hover summary** | On hover (pointer devices only): a compact `HoverCard` with the 5 guarantees as one-line checks + "Tap to see proof". | `HoverCard` |
| **Trigger behavior** | Click/tap opens the **prove-it panel**: desktop = right `Sheet`; mobile = bottom `Sheet`. | `Sheet` |

### 1.3 States

| State | Trigger | Visual | Copy |
|---|---|---|---|
| **Default / nominal** | All invariants nominal | Green dot, "Non-custodial" | Hover: "SparkPoint can't hold, move, or lose your money. Tap to prove it." |
| **Degraded mode** | Frontend/agent backend unhealthy | Amber dot; tooltip explains exit still works | "Some SparkPoint services are degraded. Your funds are unaffected — and you can still withdraw on-chain. Tap to exit." |
| **Kill-switch active (pause-only)** | Multisig has paused new deployments | Amber dot + small "Paused" sub-label | "New deposits/rebalances are paused. Withdrawals are never paused. Tap for status." |
| **Automation active** | ≥1 live session key | Green dot + small "Auto" chip | Hover lists active session keys + "[Revoke]". |
| **Loading (connection resolving)** | Wallet/network resolving | Dot in muted/neutral with subtle pulse | "Checking your connection…" — badge remains tappable; opens panel in its own loading state. |
| **Wrong network** | Connected to non-Base chain | Amber dot; panel cross-links wallet chip's switch-network action | "You're not on Base. Switch network to manage funds — withdrawals are unaffected." |

**Treatment note for the "CANNOT" list elsewhere:** when listing capabilities SparkPoint lacks (e.g., "Cannot withdraw to its own address"), render as a **lock icon + muted strike or "✕ (good)"** in a reassuring neutral/green frame — *not* red. Red is reserved for user-facing loss/blocked states.

### 1.4 Non-custody / trust touchpoints

The badge **is** the touchpoint. Its mere persistence is the message; its tap-through is the proof. The amber-but-never-red rule encodes the core truth: *services can degrade, custody cannot*.

### 1.5 Acceptance criteria

- [ ] Badge renders on 100% of authenticated routes, including onboarding and confirm shells.
- [ ] Badge is reachable and the prove-it panel opens in **≤1 tap** from any authenticated screen, desktop and mobile.
- [ ] Status dot never shows red; degradation/pause shows amber with an exit-still-works message.
- [ ] Hover summary (desktop) shows all five guarantees; tap opens the full panel.
- [ ] Keyboard accessible (focusable, `Enter`/`Space` opens panel); panel is focus-trapped; `Esc` closes. WCAG AA contrast on dot + label.

---

## 2. The "prove-it" permissions panel (badge-triggered)

### 2.1 Goal & entry points

**Goal:** In one tap, show the user **exactly what SparkPoint can and cannot do with their funds on-chain right now**, each claim linked to verifiable on-chain evidence, plus the two privileged escape affordances (withdraw-always, revoke-automation). This is **the single most important trust touchpoint** (`01 §2.3`).

**Entry points:** Non-custodial badge (canonical); AI disclaimer strip "[Prove it]" link; `⌘K` "Prove it"; wallet chip menu "View exact permissions"; deep-links to the full page `(app)/trust/permissions`.

**Form:** `Sheet` — desktop right-side, mobile bottom. The Sheet is a **summary + drill-down**; the full evidence lives at `/trust/permissions`.

### 2.2 Anatomy — the two-column truth + five guarantees

**Header:** "What SparkPoint can — and can't — do with your money." Sub: connected address (truncated) + "on Base" + a "Last verified on-chain: <relative time>" stamp with a refresh affordance.

**Section A — The five guarantees (each a `Card`/row with status + evidence link):**

| Guarantee | One-liner | Live state shown | Evidence / action |
|---|---|---|---|
| **No admin withdrawal** | "Only you can send funds to an outside address." | ✓ verified (read-only check of vault permissions) | "[View on-chain proof]" → `/trust/permissions` row |
| **Withdraw-always** | "Exit anytime — even if SparkPoint is offline." | ✓ available now | **[Withdraw now]** → `/trust/exit` (primary action in panel) |
| **You own your keys** | "We never hold or generate your wallet." | ✓ user is sole admin signer | "[View signer set]" → permissions detail |
| **Scoped, revocable automation** | "Auto-rebalance only within limits you set — revoke instantly." | List of active session keys (or "None active") | per key: scope chips + **[Revoke]** → `/automation/[id]` |
| **Non-upgradeable, pause-only** | "We can pause new deposits; we can never move your money." | Vault: non-upgradeable ✓; kill-switch: <Active/Inactive> | "[View kill-switch status]" → `/trust` |

**Section B — Two-column capability matrix (condensed):**

- **CAN (green/neutral, with check):** read your wallet; propose strategies; simulate trades; route a transaction *for you to sign*; execute in-scope auto-rebalances *only if you granted a session key*; pause new deployments (multisig).
- **CANNOT (lock icon, reassuring):** withdraw to a SparkPoint address; move funds without your signature; exceed your session-key caps/allowlist/slippage; block your withdrawals; upgrade the vault to change custody; access your keys.

**Footer of panel:** persistent **[Withdraw / Exit]** and **[See full Trust Center]** (`/trust`). On mobile these are pinned at the bottom of the sheet.

### 2.3 The full page — `/trust/permissions` (drill-down evidence)

The Sheet summarizes; this page **proves**. Anatomy:

- **Contract registry block:** all relevant addresses (vault, policy module, kill-switch multisig, your smart account) with: copy button, explorer link, **verified-source** badge, and (where applicable) a "non-upgradeable" / "proxy: none" attestation.
- **Live permission read:** a table generated from on-chain reads — "Who can move funds out? → **You only**", "Can the admin upgrade the vault? → **No (non-upgradeable)**", "Active spend allowances → <list/none>", "Active session keys → <scope, cap-used/cap, expiry>". Each row shows the **raw call** it derived from (expandable `Accordion`) so an advanced user can reproduce it.
- **Allowance audit:** any ERC-20 approvals the user's account has granted (to the vault/router), with **[Revoke approval]** per row (routes through `/confirm`). Mirrors Revoke.cash framing.
- **"Reproduce this yourself" block:** copyable read-call snippets / explorer "read contract" deep links so a skeptic can verify without trusting our UI.

### 2.4 States (panel + page)

| State | Trigger | Treatment |
|---|---|---|
| **Default** | On-chain reads succeed | Full matrix + green checks + "Last verified just now". |
| **Loading** | Reads in flight | `Skeleton` rows per guarantee; header stamp shows "Verifying on-chain…". Withdraw/Exit + Revoke actions remain enabled (never gated on read success). |
| **Stale / refresh-needed** | Last read > threshold or user taps refresh | Amber "Last verified <X> ago — [Refresh]". Claims still shown but stamped stale. |
| **Read error / RPC down** | On-chain read fails | Warning banner: "We couldn't verify on-chain right now. This doesn't change what SparkPoint can do — these limits are enforced by the contracts, not our app. [Retry] · [Verify yourself on explorer]". **Withdraw-always remains prominent and functional.** Never block exit on a failed read. |
| **Automation present** | ≥1 session key | Section A automation row expands to per-key cards (scope, cap-used meter, expiry countdown, **[Revoke]**). |
| **Degraded mode** | Backend unhealthy | Banner: "SparkPoint services are degraded — your custody and exit are unaffected." Escape-hatch CTA elevated. |

### 2.5 Microcopy guidance

- Lead with the user's power: "**Only you** can move your funds." Avoid hedge words on structural facts.
- For the CANNOT list, phrase as relief, not fear: "SparkPoint **cannot** withdraw to its own address." not "Beware — funds could be drained."
- On read errors, anchor trust in the contracts, not the UI: "These limits live in the contracts, not this app."
- Never claim "audited = safe"; claim "independently audited — read the report" with a link.

### 2.6 Non-custody / trust touchpoints

This panel is the proof spine. Every guarantee row must terminate in a **verifiable artifact**; a row without an evidence link fails review.

### 2.7 Acceptance criteria

- [ ] All five guarantees present in the panel, each with a live state and an evidence link.
- [ ] Two-column CAN/CANNOT matrix present; CANNOT column has ≥ visual parity with CAN.
- [ ] **[Withdraw / Exit]** and **[Revoke]** (when applicable) are reachable from within the panel without leaving it for an unrelated screen.
- [ ] `/trust/permissions` exposes contract addresses with explorer + verified-source links and at least one "reproduce yourself" affordance.
- [ ] A failed on-chain read **never** hides or disables the escape hatch; it shows the contracts-enforce-this reassurance + retry + self-verify.
- [ ] Panel works in degraded mode (renders the no-frontend exit instructions).

---

## 3. The Trust Center hub — `/trust`

### 3.1 Goal & entry points

**Goal:** The account-aware home for everything trust/control: the five self-custody guarantees, the caps dashboard, the pause-only kill-switch status, audits & risk ratings, and links to the prove-it panel, automation, and exit hub. (There is also a **public** `(public)/trust` mirror with *no account data* for pre-connect users — `01 §3.x`. This section specs the **authenticated** hub.)

**Entry points:** badge, disclaimer strip, wallet menu, secondary nav, footer, `⌘K`, notifications (e.g., "caps near limit", "kill-switch active").

### 3.2 Layout

**Desktop:** two-column. Left = sticky in-page nav / anchor list (Guarantees · Caps · Kill-switch · Audits · Permissions · Exit). Right = stacked `Card` sections. A persistent **[Withdraw / Exit]** button pinned top-right of the page header.

**Mobile:** single column, `Accordion` or stacked cards, with a sticky bottom bar holding **[Prove it]** and **[Withdraw / Exit]**.

### 3.3 Section: Self-custody guarantees panel

Re-states the five guarantees as **expandable cards**, each with: the plain claim, the on-chain mechanism in one sentence, current verified state, and an evidence link (shared with §2.3). This is the *narrative + status* version; the prove-it panel is the *fast* version. Map: `Card` + `Accordion` + status `Badge`.

Required cards: **No-admin-withdrawal · Withdraw-always · You own your keys (revoke-anytime for automation) · Scoped & instantly-revocable automation · Non-upgradeable, pause-only governance.** Benchmark framing: **Ledger / Trust Wallet** self-custody language — calm, structural, first-person-user ("your keys, your funds").

### 3.4 Section: Caps dashboard (remaining-capacity meters)

**Goal:** Make beta caps legible and reassuring (caps protect users), and show **remaining capacity** at a glance. Benchmark: **Morpho/Gauntlet, Yearn, Beefy** caps meters.

**Anatomy — one `Card` per cap, each a labeled `Progress` meter:**

| Cap | Meter shows | Tabular figures | Near-limit behavior |
|---|---|---|---|
| **Your per-user deposit cap** | used / your cap | "$X,XXX of $Y,YYY used" | Amber fill ≥ ~80%; helper "You're near your cap." |
| **Protocol / vault cap (TVL)** | vault TVL / vault cap | "$X.XXM of $Y.YYM" | Amber near limit; "Vault is filling — deposits may pause." |
| **Per-tx cap** (if applicable) | max per transaction | static value | n/a |
| **Session-key caps** (if automation active) | per-tx + cumulative used / granted | per key | cross-links `/automation/[id]` |

All meters use **tabular numerals**, semantic fill (green→amber as capacity shrinks), and an accessible text equivalent ("82% of your deposit cap used"). Each meter has a "why caps?" `Tooltip`/`HoverCard`: "Beta caps limit how much is exposed while we prove the system."

**States:** default; near-limit (amber); **at-cap** (full red-amber bar + "Cap reached — new deposits paused. Withdrawals are unaffected. [Join waitlist for higher cap]"); loading (`Skeleton` bars); read-error (show last-known with stamp + retry).

### 3.5 Section: Pause-only multisig kill-switch status

**Goal:** Show the kill-switch state honestly and make unmistakably clear it is **pause-only** — it can halt *new* deposits/rebalances and can **never** block withdrawals.

**Anatomy:** a status `Card` with:
- **State pill:** "Inactive — system nominal" (green) / "Active — new deployments paused" (amber).
- **Scope statement (always shown, both states):** two-line CAN/CANNOT — "Can: pause new deposits & rebalances. **Cannot: block your withdrawals, move your funds, or change custody.**"
- **Controller transparency:** "Controlled by a <n-of-m> multisig" with signer addresses (explorer links) and any timelock parameter; "Governs **pause only**." Map: `Accordion` for signer detail.
- **When active:** a prominent reassurance row + **[Withdraw now]** — withdrawing must be demonstrably available while paused.

**States:** **inactive/nominal** (green, default); **active/paused** (amber banner at top of Trust Center + on badge; exit CTA elevated); **loading**; **read-error** (last-known state + "limits enforced on-chain" reassurance + retry). Acceptance: in the **active** state the design must still present a working withdraw path on the same screen.

### 3.6 Section: Audits & risk ratings

**Goal:** Third-party credibility, honestly framed. Benchmark institutional vault transparency (**Morpho/Gauntlet, Yearn, Beefy** audit/curator badges) + Ledger/Trust Wallet candor.

**Anatomy:**
- **Audit list:** per audit — auditor name + logo, scope, date, status (Passed / Findings resolved), and a **[Read report]** link (PDF/external). `Card` list with `Badge` status.
- **"No audit yet" honesty:** if a component is unaudited at beta, **say so plainly** ("This component has not yet been independently audited") rather than omitting — omission reads as concealment.
- **Risk ratings:** the vault's risk score + a one-line rationale (links to the deeper risk panel in the Portfolio/Vault docs), plus any external curator/risk-curation references. Use the consistent **3–5 step risk palette** from the brief.
- **Bug-bounty / disclosure:** link to responsible-disclosure contact if present.

**States:** default (audits present); **pending** (amber "Audit in progress — expected <date>"); **unaudited component** (explicit, neutral, never hidden); loading; error (links degrade gracefully to a known-good static page).

### 3.7 Trust Center acceptance criteria

- [ ] All five guarantees, caps dashboard, kill-switch status, and audits/ratings present on `/trust`.
- [ ] Every cap renders as a remaining-capacity meter with tabular numerals + accessible text equivalent + "why caps?" explainer.
- [ ] Kill-switch status states its **pause-only** scope in BOTH active and inactive states, and the **active** state co-locates a working withdraw CTA.
- [ ] Audits section links real reports; unaudited components are disclosed, not omitted.
- [ ] **[Prove it]** and **[Withdraw / Exit]** are reachable from the Trust Center header (desktop) and sticky bottom bar (mobile).
- [ ] Public mirror `(public)/trust` shows guarantees + audits + addresses with **no account-specific data**.

---

## 4. Always-available self-service / escape-hatch withdrawal

### 4.1 Goal & entry points

**Goal:** Guarantee the user can **always exit** — first via the normal in-app path, and critically via an **on-chain, no-frontend** path that works even if SparkPoint's frontend and agent are entirely offline. "Trust us to stay up" is never required.

**Two distinct-but-linked routes (`01 §1, §3`):**
- **`/vault/withdraw`** — normal in-app manual withdraw (by amount or by shares), funnels to `/confirm`.
- **`/trust/exit`** — the **escape-hatch hub**: documents and links the **on-chain self-service** withdrawal (addresses + steps that bypass our UI) in addition to the normal path.

**Entry points (≤1 tap from anywhere):** badge prove-it panel **[Withdraw now]**; disclaimer strip "[Exit anytime]"; `⌘K` "Withdraw now"; mobile More drawer (pinned top); wallet menu; Trust Center header; **`/unavailable`** (geo-blocked/not-whitelisted users still get the on-chain exit, `01 §3`).

### 4.2 `/trust/exit` — anatomy

- **Reassurance header:** "You can always get your money out. Here's how — with or without SparkPoint."
- **Path A — Withdraw in-app (recommended, easiest):** card summarizing current vault position (shares + redeemable value, net of nothing — 0-fee), **[Withdraw now]** → `/vault/withdraw` → `/confirm`.
- **Path B — Withdraw on-chain without SparkPoint (escape hatch):** step-by-step, tool-agnostic instructions to redeem ERC-4626 shares directly via a block explorer "write contract" tab or any wallet:
  - vault contract **address** (copy + explorer link),
  - the **function to call** (`redeem`/`withdraw`) with plain-language parameter help,
  - "how to find your share balance",
  - explicit note: **no SparkPoint approval, signature, or uptime required**.
- **Verification block:** "Don't trust these instructions? Verify the contract is non-upgradeable and that only you can withdraw — [see permissions]."
- **Support note:** clarify that even support/multisig cannot block this path.

> **Architectural decoupling (why Path B always works — `plan.md` N2/SC-003):** the exit + "prove-it" permissions surfaces (`/exit`, `/trust`, `/trust/permissions`) are **backend-independent PUBLIC routes** that are **architecturally DECOUPLED from the authenticated app shell and the agent service** — they have **no app-shell or agent data dependency** and **read chain state directly via RPC** (bundled ABIs + Alchemy/Viem). This is the design fact behind withdraw-always: Path B (and the permissions reads) render and function with **the app shell and agent entirely offline**. Designers must not couple these screens to authenticated/agent/indexer state; the on-chain instructions, addresses, and the revoke/exit affordances must hold when everything else is down.

### 4.3 States

| State | Treatment |
|---|---|
| **Default (has position)** | Both paths shown; Path A primary, Path B always present below. |
| **No position / empty** | "You have nothing deposited right now." Path B still documented (so users learn the exit exists *before* depositing). |
| **Loading** | Position card `Skeleton`; on-chain instructions (Path B) render immediately — never gated on backend. |
| **Degraded mode (backend offline)** | Banner: "SparkPoint is having problems — but your exit isn't affected." **Path B is promoted to primary**; Path A may show "may be unavailable" but is attempted. |
| **Kill-switch active (paused)** | Explicit: "Deposits are paused. Withdrawals are not. Use either path below." |
| **Geo-blocked / not-whitelisted (`/unavailable`)** | Frontend deposit features blocked, but **Path B on-chain exit is fully documented and functional** for any existing position. |
| **Error (in-app path)** | If `/vault/withdraw` or `/confirm` errors, surface "You can still withdraw on-chain — here's how" pointing to Path B. |

### 4.4 Microcopy guidance

- Frame exit as a **right and a routine**, not an emergency: "Exit anytime." Avoid panic framing.
- Be explicit about independence: "This works even if SparkPoint disappears."
- Never imply the user needs our permission, our keys, our servers, or our cooperation.

### 4.5 Non-custody / trust touchpoints

The escape hatch is the *physical proof* of withdraw-always. Designing Path B to render in degraded mode is the highest-signal trust decision in the product.

### 4.6 Acceptance criteria

- [ ] Escape hatch reachable in **≤1 tap** from every authenticated screen, desktop and mobile.
- [ ] `/trust/exit` documents an **on-chain, no-frontend** withdrawal path (addresses + function + steps) that does not depend on SparkPoint's backend.
- [ ] Path B (on-chain) renders even when position/in-app data fails to load and in **degraded mode**.
- [ ] Empty-state users still see the escape-hatch documentation (exit is shown *before* deposit).
- [ ] `/unavailable` (geo/whitelist-blocked) still surfaces a working on-chain exit for existing positions.
- [ ] Kill-switch "active" state explicitly affirms withdrawals are not paused and provides a working path.

---

## 5. Default per-action signing & the "AI suggestion, you approve & sign" labeling system

### 5.1 Goal

Make it unmistakable, on **every** state-changing surface, that: (a) the AI only **proposes**, (b) the **user approves and signs**, and (c) signing is **per-action by default** (delegated automation is opt-in, scoped, and revocable). This encodes the design thesis — *AI proposes — guardrails + you dispose*.

### 5.2 The labeling system (reusable component)

A small, consistent **"AI suggestion — you approve & sign"** affordance attached to **every** AI-originated recommendation/action card and to the confirm surface. Anatomy:

- **Spark/AI glyph + label:** "AI suggestion" with the brand spark accent denoting AI presence.
- **Action clause:** "— you approve & sign." Optionally an `info` `Tooltip`: "SparkPoint proposes. Nothing happens until you sign. SparkPoint never holds your funds."
- **Placement:** persistent header chip on action/recommendation cards (Chat, Strategies), and a banner on `/confirm`. Mirrors the global disclaimer strip (`01 §2.2`) but scoped to the specific action.
- **shadcn:** `Badge` (with icon) for the chip; `Alert` for the confirm-surface banner; `Tooltip`/`HoverCard` for the explainer.

**Rule:** No state-changing card or screen may render **without** this label. A "do X" button that lacks the "you approve & sign" framing fails review.

### 5.3 Per-action signing as the default

- The **default** path for deposit, withdraw, swap, accepted strategy, and even *granting* a session key is **one explicit user signature per action**, routed through `/confirm/[txIntentId]` (`01 §6, §7`).
- Automation (§6) is the **only** way to reduce per-action signing, and it is opt-in, capped, time-boxed, and revocable. The UI must make it obvious that **not** enabling automation = you sign everything.

### 5.4 States (label behavior)

| State | Treatment |
|---|---|
| **Default** | Label present on card/confirm; sign is an explicit, deliberate action. |
| **Automation-eligible action** | If the action is within an active session key's scope, show "Auto-eligible — or sign manually" with a clear choice; default still surfaces manual sign. |
| **Automated execution (post-grant)** | When an in-scope action executes under a session key, it is labeled "Executed under your automation grant" with a link to the grant and **[Revoke]** — accountability preserved. |

### 5.5 Acceptance criteria

- [ ] Every AI-originated action/recommendation card and the confirm surface carries the "AI suggestion — you approve & sign" label.
- [ ] Per-action signing is the visible default; the absence of automation is communicated as "you sign everything".
- [ ] Automated executions are labeled and linked back to their grant with an instant **[Revoke]**.

---

## 6. Scoped, instantly-revocable automation (trust touchpoints)

> Full automation flow (grant scope/cap/expiry, management) is specified in the Automation handover doc (`(app)/automation/*`, `01 §1, §6`). This section specs only the **trust-surface obligations**.

- **Grant is itself a signed action** routed through `/confirm` — never a silent toggle. The grant screen must show the exact on-chain scope: **allowlisted targets, per-tx cap, cumulative cap, max slippage, hard expiry**.
- **Instant, unilateral revoke** is the headline affordance: reachable from the prove-it panel, `/automation`, `/automation/[id]`, and `⌘K`. Revoke must be communicated as working **without SparkPoint's cooperation**.
- **Scope is always visible:** active session keys appear as cards with scope chips, **cap-used meters** (tabular), and an **expiry countdown**. Near-expiry/near-cap → amber + notification.
- **States:** none active (default, "You sign every action"); active (per-key cards + revoke); near-expiry (amber); near-cap (amber); revoked (success confirmation + "you're back to signing every action"); expired (auto-reverts to per-action, noted).
- **Acceptance:** [ ] Granting shows full scope and is user-signed; [ ] Revoke is ≤1 tap from the prove-it panel and confirms within the UI; [ ] active scope + caps + expiry are always inspectable.

---

## 7. Friction-as-safety: acknowledge-before-sign (Rabby pattern)

> The full Execution Confirmation surface (Tenderly-style simulation, guardrail checklist, sign) is specified in the Execution Confirmation handover doc. This section specs the **friction/acknowledgement model** that the confirm surface enforces.

### 7.1 Goal

Convert risk into **deliberate, informed consent**: the **Sign** button is **disabled until the user has acknowledged every active alert**. Friction is scaled to risk severity, never gratuitous. Benchmark: **Rabby** ("sign disabled until acknowledged") and **Tenderly** preview.

### 7.2 The guardrail checklist + alert acknowledgement

On `/confirm/[txIntentId]`, the **deterministic guardrail checklist** renders each check with a pass/warn/block state:

| Check | Pass (green ✓) | Warn (amber) | Block (red) |
|---|---|---|---|
| **Caps** | within caps | near cap | exceeds cap → cannot proceed |
| **Allowlist** | target allowlisted | — | target not allowlisted → blocked |
| **Slippage** | within max | elevated | exceeds max → blocked |
| **Simulation** | sim succeeded, balances as expected | partial/uncertain | sim failed/reverts → blocked |

- **Warn** items produce **acknowledgement checkboxes** ("I understand <specific risk>"); each must be checked to enable **Sign**.
- **Block** items make **Sign impossible** (not merely acknowledgeable) — the action is structurally disallowed by guardrails; the UI offers a remedy (e.g., "reduce amount", "lower slippage") rather than a way to override.
- **shadcn:** `Checkbox` per ack; `Alert` per warn/block; `Button` (Sign) with `disabled` until all acks satisfied; `Tooltip` on the disabled Sign button explaining what remains.

### 7.3 States

| State | Sign button | Treatment |
|---|---|---|
| **All pass, no warns** | Enabled | Low-friction; one deliberate sign. Routine actions stay fast. |
| **Warns present** | Disabled until all acks checked | Each warn shows a specific ack checkbox; a counter "Acknowledge 2 of 3 to continue". |
| **Block present** | Disabled (uncheckable) | "This can't proceed: <reason>. <remedy>." No override path. |
| **Simulation loading** | Disabled | "Simulating…" `Skeleton` preview; Sign waits for sim. |
| **Simulation error** | Disabled | "We couldn't simulate this — not signing blind. [Retry]." Never let the user sign an unsimulated/unknown action. |
| **Post-sign pending** | n/a | tx submitted state → success/failure → writes Outcome Log (§8). |

### 7.4 Microcopy guidance

- Acks are **specific**, not generic: "I understand slippage could be up to X%." not "I accept the risks."
- Disabled-Sign tooltip is actionable: "Acknowledge the slippage warning to continue."
- Blocks are framed as protection: "Your guardrails stopped this — here's why."

### 7.5 Acceptance criteria

- [ ] **Sign** is disabled until **every** active warn is individually acknowledged.
- [ ] **Block** states make signing impossible and offer a remedy, never an override.
- [ ] Friction scales to severity: all-pass actions require only one deliberate sign; routine flows are not over-gated.
- [ ] The user can never sign an **unsimulated** or **failed-simulation** action.
- [ ] Disabled Sign always explains what remains (tooltip/inline).

---

## 8. The outcome log as an accountability surface — `/activity`

### 8.1 Goal & entry points

**Goal:** A permanent, honest ledger of what the AI recommended and **how it actually turned out** — **wins AND losses with equal prominence** — each entry tied back to its originating recommendation. This is the credibility ballast for the "AI fund manager" claim: we show our work, including when we're wrong.

**Entry points:** secondary nav ("Outcome Log"); recommendation detail "track outcome"; notifications (outcome updates); portfolio position; `⌘K`.

**Data linkage (`01 §4, §6`):** accepting a recommendation → executes via `/confirm` → creates an Outcome Log entry (`/activity/[entryId]`) linked to the originating `recId`, **updated over time** with realized PnL.

### 8.2 Layout

**Desktop:** filterable table/timeline. Columns: date, action, originating recommendation (linked, with "why this?"), amount, **realized PnL (tabular, green/red)**, status, tx (explorer link). Filters: all / wins / losses / by strategy / by date. A summary header: realized PnL to date, win/loss count — **neither hidden nor spun**.

**Mobile:** stacked entry `Card`s (date, action, PnL chip, status), tap → detail. Filters in a `Sheet`.

### 8.3 Entry detail — `/activity/[entryId]`

- **Originating recommendation:** the rec card snapshot + its "why this?" reasoning at the time (so the AI's thesis is on record).
- **What happened:** executed action, amounts, **realized PnL** (and unrealized if still open), timeline.
- **Verification:** tx hash(es) + explorer links — every claim is on-chain checkable.
- **Honest labeling:** losses are labeled plainly ("Loss: -$X") in red, with the rec that produced them visible. No euphemisms.

### 8.4 States

| State | Treatment |
|---|---|
| **Default** | Populated log, wins and losses interleaved chronologically; summary header with realized PnL + W/L count. |
| **Empty** | "No outcomes yet. When you act on a recommendation, it'll be tracked here — wins and losses." Encourage, don't hide the loss possibility. |
| **In-progress / open position** | Entry shows "Outcome pending — currently <unrealized PnL>"; updates over time. |
| **Loading** | `Skeleton` rows/cards. |
| **Error** | Last-known entries + "couldn't refresh outcomes" + retry; explorer links still work. |
| **Loss-heavy period** | UI must NOT soften or reorder to bury losses; summary reflects reality. (This is an explicit anti-requirement.) |

### 8.5 Microcopy guidance

- Equal candor for both: "Win: +$X" / "Loss: -$X" — same prominence, semantic color only.
- Always tie outcome to thesis: "Recommended because <reason> · Result: <PnL>."
- Frame the log as accountability, not marketing: "We log every outcome — including the ones that went against you."

### 8.6 Non-custody / trust touchpoints

The outcome log proves the *behavioral* side of trust (the AI is accountable), complementing the *structural* side (non-custody). Every entry is on-chain verifiable via tx links.

### 8.7 Acceptance criteria

- [ ] Wins and losses appear with **equal prominence**; losses are never hidden, deprioritized, or euphemized.
- [ ] Every entry links to its **originating recommendation** (with the original "why this?") and to the **on-chain tx**.
- [ ] Realized PnL uses tabular numerals and strict semantic color (green/red); summary header shows honest aggregate + W/L count.
- [ ] Open positions show pending/unrealized state and update over time.
- [ ] Empty state names the loss possibility rather than only promising upside.

---

## 9. Cross-surface acceptance criteria (trust spine as a whole)

- [ ] **≤1 tap, everywhere:** prove-it permissions panel AND withdraw-always escape hatch reachable in one tap from every authenticated screen, on desktop and mobile.
- [ ] **Provable everywhere:** every guarantee/claim terminates in an inspectable on-chain artifact (address, read result, audit, explorer link). No unbacked reassurance.
- [ ] **Custody/exit survive degraded mode:** prove-it panel, Trust Center exit references, and `/trust/exit` Path B all render and function when the backend is offline.
- [ ] **Pause-only is unambiguous:** kill-switch UI states pause-only scope in both states and never implies withdrawals can be blocked.
- [ ] **Caps are reassuring, not alarming:** caps render as remaining-capacity meters with explainers; at-cap states affirm withdrawals are unaffected.
- [ ] **Consent is deliberate:** per-action signing is the default and labeled; Sign is gated behind acknowledgement of all warns; blocks cannot be overridden.
- [ ] **Accountability is permanent:** outcome log shows wins and losses equally, each tied to its recommendation and tx.
- [ ] **Color discipline:** badge never red; CANNOT-capabilities styled as reassurance (lock/neutral), not alarm; red reserved for user loss/blocked.
- [ ] **A11y:** all trust surfaces meet WCAG AA; status conveyed by text+icon, not color alone; sheets/dialogs focus-trapped and keyboard-operable; meters have text equivalents; financials use tabular numerals.

---

## 10. Benchmark references (named)

- **Rabby** — visible-risk friction; **Sign disabled until alerts acknowledged** (§7).
- **Tenderly** — pre-trade simulation / balance-change preview feeding the guardrail checklist (§7; full spec in Execution Confirmation doc).
- **Ledger / Trust Wallet** — self-custody framing and calm, structural "your keys, your funds" language (§1, §3.3, §4).
- **Morpho / Gauntlet, Yearn, Beefy** — institutional vault transparency: caps meters, audit/curator badges, risk ratings (§3.4, §3.6).
- **Revoke.cash** — allowance/permission audit + per-row revoke framing (§2.3, §6).
- **Hey Anon / Griffain / Neur** — conversational copilot framing for the "AI suggestion — you approve & sign" labeling (§5; UX-polish-converts lesson from the plan).

---

## 11. shadcn/ui component map (quick reference)

| Surface | Primary primitives |
|---|---|
| Non-custodial badge | `Badge`, `HoverCard`, dot indicator, `Sheet` (trigger) |
| Prove-it panel | `Sheet`, `Card`, `Accordion`, `Badge`, `Button`, `Tooltip` |
| `/trust/permissions` | `Table`, `Accordion`, `Badge` (verified), copy `Button`, `Alert` (read-error) |
| Trust Center | `Tabs`/anchor nav, `Card`, `Accordion`, `Progress` (caps), `Badge` (kill-switch/audit), `Tooltip` |
| Caps dashboard | `Progress`, `Card`, `Tooltip`/`HoverCard`, tabular numerals |
| Kill-switch status | `Card`, `Badge` (state pill), `Accordion` (signers), `Alert` (active), `Button` (withdraw) |
| Audits & ratings | `Card`, `Badge`, external-link `Button` |
| Escape hatch (`/trust/exit`) | `Card`, `Alert` (degraded), `Button`, copy fields, `Accordion` (on-chain steps) |
| "AI suggestion — sign" label | `Badge` (icon), `Alert` (confirm banner), `Tooltip` |
| Acknowledge-before-sign | `Checkbox`, `Alert` (warn/block), `Button` (disabled Sign), `Tooltip` |
| Outcome log | `Table` (desktop) / `Card` list (mobile), `Tabs`/filters, `Badge` (win/loss), `Sheet` (filters mobile) |
