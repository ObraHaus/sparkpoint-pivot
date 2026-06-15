# 02 · Flow 7 — Automation / Session Keys (opt-in, scoped, instantly revocable — ERC-4337)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui).
> **Status:** Authoritative screen-level spec for the **Automation / Session-Keys** supporting flow. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **Reads-before (and defers to):** `00-brief.md` (positioning, thesis, the "AI proposes — guardrails + you dispose" model, non-goals); `01-information-architecture.md` (**§1 routes `(app)/automation`, `automation/grant`, `automation/[sessionKeyId]`**; §2 shell; §3 nav placement + `⌘K` "Revoke automation"; §4 flow graph + decision-point ⑤; §5 Stage E "Automate (optional, P3)"; §6 degraded/expired/revoked states); `04-design-system.md` (tokens, spark/semantic/**risk** palettes, type, tabular numbers, **§6.5 caps/usage meters**, motion, a11y, shadcn map §11); `07-content-and-tone.md` (**all wording — buttons §2.2 "Grant scoped access"/"Revoke access", helper §2.3, success/revoke copy §2.5, tooltips, glossary §185 "Session key", trust copy §299, banned words §366**); `05-trust-and-safety-ux.md` (**§5 default per-action signing + "AI suggestion, you approve & sign" labeling; §6 scoped-revocable-automation trust obligations — canonical; §2 prove-it panel automation row; §7 acknowledge-before-sign**); `09-references.md` (**§ AA / session-key benchmarks: ERC-4337 session keys & risk limits, Turnkey 4337→7702, Blofin AA, Rabby, Revoke.cash, Ledger/Trust Wallet**). **Where copy conflicts with `07`, `07` wins; where scope/tone conflicts with the brief, the brief wins; where this touches the prove-it panel/escape hatch/kill-switch, `05` is the source of truth (this doc references, does not re-spec, `/trust/*`); where it touches the sign surface, Flow 6 (`/confirm`) is canonical (this doc references, does not re-spec, signing).**
> **What this doc IS:** goal & entry points; the **enable / grant** screen (exact bounded scope: max $X per tx + per week/cumulative, only these vaults, max slippage, expires in N days, revocable anytime) and the **signed grant**; the **`/automation` status hub** (active grants, usage, expiry); the **`/automation/[sessionKeyId]` detail** with **INSTANT, unilateral revoke that needs no SparkPoint cooperation**; every state (default / empty / loading / success / warning / error + automation-specific: active / near-cap / near-expiry / exhausted / expired / revoked / degraded); component anatomy → shadcn primitives; desktop **and** mobile layout notes; microcopy guidance (deferring to `07`); non-custody/trust touchpoints; named benchmark references; acceptance criteria.
> **What it is NOT:** visual tokens (in `04`), canonical strings (in `07`), the route map (in `01`), the **signing surface** (the grant and any revoke that needs a tx route to **Flow 6 / `/confirm/[txIntentId]`** — **no bespoke sign UI here**), the **prove-it panel / Trust Center / escape hatch / kill-switch** (in `05`), or the per-action signing default's full labeling system (in `05` §5 — inherited here). It does **not** redefine the persistent app shell (`01-IA` §2) — it inherits it.

---

## 0. Goal, scope, and the one-sentence job

**Job:** Let a user **opt in to hands-off auto-rebalancing by granting a single, bounded, on-chain session key** — seeing the **exact scope** (max per-tx, max per-week/cumulative, only these vaults, max slippage, expires in N days) **before** they sign — and **manage and instantly revoke** that grant at any time, **unilaterally, without SparkPoint's cooperation**. This is `spec.md` **US-6 (P3)** and the concrete expression of the **N4 invariant** ("scoped, revocable, time-boxed automation"): power-user convenience that *raises* the trust bar instead of lowering it.

**The non-negotiable framing (brief; `05` §5/§6; `07` §2.2):** **per-action manual signing is the DEFAULT.** Automation is **strictly opt-in**, and the UI must make it obvious that *not* enabling it means **you sign everything**. Enabling automation does not hand the AI custody or open-ended authority — it grants a **narrow, capped, expiring lane**, enforced **on-chain by the `PolicyModule`**, that the AI can never exceed even if compromised. *AI proposes — guardrails + you dispose — and "dispose" can be pre-authorized only within limits you set and can pull back instantly.*

**Hard product/scope facts to encode (`spec.md` FR-028/029/030/031/032, FR-035/036, SC-008; `data-model.md` E10, VR-SK1–4):**
- **Grant = ONE user-signed action.** Arming a session key requires **exactly one user-signed UserOp**, routed through **`/confirm`** (Flow 6) — never a silent toggle (`05` §6; `01-IA` §4 ⑥; `data-model.md` VR-SK3). SparkPoint **never generates or stores the session private key** (`data-model.md` E10 `session_pubkey` note).
- **Scope is bounded on-chain and shown literally before signing** (`data-model.md` E10): **allowlisted targets** (only the launch vault / allowlisted adapters — a subset of the protocol allowlist, `VR-SK4`), **allowlisted function selectors**, **per-tx cap**, **cumulative cap** (surfaced to users as a **per-week** budget + lifetime cap), **max slippage (bps)**, **hard expiry (`valid_until`)**, optional start (`valid_after`). The grant screen renders **every one of these** in plain language; nothing is hidden behind "Automate."
- **The chain is the authoritative enforcer** (`VR-SK1`, SC-008): any automated op exceeding allowlist / selectors / caps / slippage / expiry is **rejected on-chain**, regardless of what the off-chain mirror or UI says. The off-chain policy mirror rejects out-of-scope **first** (defense in depth) but is **never the sole gate**. The UI must communicate that limits are **enforced by the contract, not our app** (`05` §2.5).
- **Revoke is instant, unilateral, and SparkPoint-independent** (`FR-031`, `VR-SK2`, SC-008): revocation is derivable purely from the owner's on-chain revoke tx and requires **no SparkPoint cooperation**; chain state changes at the tx, the mirror flips on indexing. Revoke must be **≤1 tap** from the prove-it panel, `/automation`, `/automation/[sessionKeyId]`, and `⌘K` (`05` §6; `01-IA` §3).
- **Expiry & exhaustion auto-revert to per-action signing** (`FR-032`, `data-model.md` §10.1): at `valid_until` (expired) or when `spent ≥ cumulative_cap` (exhausted), the key stops working on-chain and the user is **back to signing everything**; re-enabling automation is a **new grant (new key)**, never a silent renewal.
- **Automated executions remain accountable** (`05` §5.4): every in-scope automated action is **labeled "Executed under your automation grant"**, links back to the grant, carries a one-tap **[Revoke]**, and still appears in **`/activity`** (Outcome Log) and **`/notifications`** (`01-IA` §4 #6).
- **Automation never touches custody or the escape hatch** (`spec.md` N1/N2; `05` §6): a session key can only **direct strategy within the allowlist** — it has **no path to withdraw funds to any external/SparkPoint address**, and it can **never** affect withdraw-always. The grant screen states this explicitly.
- **Single active grant at launch (one session key).** At launch there is **exactly ONE active automation grant (one session key)**; a **multi-key management UI is deferred post-launch**. The **single-vault launch reality makes one auto-rebalance lane sufficient** — there is no need for parallel keys when there is one allowlisted vault. The hub therefore shows a single active grant and de-emphasizes "add another grant" (§3.2); re-enabling after expiry/exhaustion/revoke is a **new single grant** replacing the prior one, never a fleet of keys.

**Tone for this flow (`07` §1.3, §2.2):** *control-first, empowering, never hype.* Lead with **what stays yours** (you still own your keys; you can revoke instantly; the AI can never exceed these limits), then the convenience. Name the scope; never sell "let the AI trade for you." Revoke is framed as **the user exercising power**, not as "disabling a feature" (`07` §2.2: "Revoke access", never "Disable"). Granting names the scope ("Grant scoped access", never "Enable AI"/"Automate", `07` §366).

---

## 1. Entry points & exits

### 1.1 Entry points (`01-IA` §3, §4, §5 Stage E)
| From | Lands on |
|---|---|
| **Secondary nav** ("Automation", `01-IA` §3 / §1 `/automation`) | `/automation` (status hub) |
| **Prove-it permissions panel** ("Scoped, revocable automation" row → **[Grant]** if none, or per-key **[Revoke]**, `05` §2.2/§6) | `/automation/grant` or `/automation/[sessionKeyId]` |
| **`⌘K` command menu** ("Revoke automation" as a top action; "Grant scoped access") | `/automation/[sessionKeyId]` (revoke) / `/automation/grant` |
| **Settings → Security** (`/settings/security` "revoke sessions, view permissions", `01-IA` §1) | `/automation` or `/automation/[sessionKeyId]` |
| **Chat** ("automate this?" / "stop signing every rebalance", `01-IA` §4 routes-into) | `/automation/grant` (primed scope) |
| **Confirmation success** (after a manual rebalance — optional "tired of signing each one? Grant scoped access") | `/automation/grant` |
| **Notifications** (session key **near expiry**, **near cap**, **expired**, **revoked**, **automated action executed**, `01-IA` §3 / `05` §6) | `/automation` or `/automation/[sessionKeyId]` |
| **Non-custodial badge** ("Auto" chip when ≥1 key active, `05` §1.3) | hover lists keys + **[Revoke]** → `/automation/[sessionKeyId]` |

### 1.2 Exits
- **Grant →** builds a `txIntent` (`action_kind=grant_session_key`) → **`/confirm/[txIntentId]`** (Flow 6: the single shared simulation + guardrail-checklist + **one user signature** surface). **No sign here.** On success → returns to `/automation` (now showing the active key) + `Sonner` toast + `/notifications` entry.
- **Revoke →** the **primary** path is a **direct, owner-only on-chain revoke** (instant, unilateral). Depending on the AA implementation this is either (a) a one-tap revoke that still produces a user-signed `txIntent` → **`/confirm`** (labeled minimal-friction, all-pass), or (b) the self-service on-chain instructions (mirroring `05` §4 Path B) so revoke works **even if SparkPoint is offline**. Either way: revoke needs **no SparkPoint cooperation** and is reachable in ≤1 tap. On success → `/automation/[sessionKeyId]` shows "Revoked" + toast "Access revoked. SparkPoint's AI can no longer act on your behalf. You sign everything from here." (`07` §2.5).
- **Prove-it →** persistent badge → permissions panel (`05` §2); the automation row mirrors active-key state here.
- **Trust Center →** `/trust` (caps dashboard shows session-key caps, `05` §3.4; kill-switch status).
- **Outcome Log →** `/activity` — automated executions appear as entries linked to their grant.
- **Learn →** "What's a session key?" tip → `/learn/[slug]` (`07` §185 glossary).
- **Withdraw / Exit →** always ≤1 tap (shell) — automation **never** gates the escape hatch (`05` §4; `01-IA` §6).

---

## 2. Shell context & layout model (inherits `01-IA` §2)

Automation renders **inside the authenticated app shell** — it does not define its own. Inherited and always present (do not re-spec, do not omit): the **non-custodial badge** → prove-it panel (with its **automation row** + "Auto" chip when active, `05` §1.3/§2.2), the **wallet/connection status** chip (Base), the **AI disclaimer strip** (with **[Prove it]** / **[Exit anytime]**), primary + secondary nav (Automation under Control tier; **Withdraw / Exit** + **Prove-it** pinned, `01-IA` §3), command menu (with **"Revoke automation"**), notifications. **Withdraw/exit + prove-it are ≤1 tap from every screen in this flow** (hard IA rule).

> **Per-route state files (`01-IA` §1):** `/automation`, `/automation/grant`, `/automation/[sessionKeyId]` each ship `loading.tsx` (skeleton) and `error.tsx` (recoverable + "you can still revoke / withdraw" reassurance). The **revoke path must remain reachable and functional in degraded mode** (model it like `05` §4.3 Path B): if SparkPoint's backend is offline, the on-chain revoke instructions still render.

### 2.1 Layout model (both canvases — `04` §4.2)

- **Desktop (1440 design, 1024 min):**
  - **`/automation` (status hub):** a single-spine content column (max ~960–1120px) under the shell. Top = a **state banner / summary** ("You sign every action" when none active · or "Automation active — 1 grant" when active). Below = the **active-grants list** (one **grant `Card`** per key: scope chips + usage meters + expiry countdown + **[Manage]** / **[Revoke]**), then an explanatory **"What automation does / doesn't do"** two-column trust block (CAN/CANNOT, `05` §6), then **[Grant scoped access]** CTA (only the default-empty state leads with this CTA prominently).
  - **`/automation/grant`:** a **focused two-zone** layout. **Left / main:** the **scope builder** — the bounded-scope form (per-tx cap, weekly/cumulative cap, allowed vaults, max slippage, expiry) with inline helper text and "why?" tips. **Right rail (sticky):** a **live "Scope summary" card** that restates the exact grant in plain language as the user edits it ("max $X per move · up to $Y per week · only the Aave Yield Vault · slippage ≤ Z% · expires in N days · revocable anytime"), plus the **[Review & grant]** CTA. This mirrors the deposit-panel pattern (scope on the right, like the action card) so the *consequence* is always in view.
  - **`/automation/[sessionKeyId]` (detail + revoke):** main column = full scope read-out (every on-chain parameter), **usage meters** (per-tx, cumulative/weekly used), **expiry countdown**, **activity list** (automated executions under this key, linked to `/activity`), and the **provenance** (registered tx, `session_pubkey` truncated). A **persistent [Revoke access]** button is pinned top-right of the page header (destructive-styled `AlertDialog`, but empowering copy, `07` §2.2).
- **Mobile (390 design, 360 min):** single column, stacked.
  - **`/automation`:** state banner → active grant `Card`(s) (scope chips + usage meters + countdown, tap → detail) → CAN/CANNOT block (`Accordion`) → bottom-anchored **[Grant scoped access]** (only prominent in the default-empty state).
  - **`/automation/grant`:** scroll order = intro/"opt-in, bounded" framing → scope fields (each with helper + "why?" `Sheet`) → **live Scope summary** (sticky bottom or pinned above the CTA) → bottom-anchored **[Review & grant]**. The scope summary must be visible without scrolling away from the CTA (it is the consequence preview).
  - **`/automation/[sessionKeyId]`:** scope read-out → usage meters → expiry → activity → with a **bottom-anchored, always-visible [Revoke access]** within thumb reach (revoke must never require hunting).
- **Responsive transform:** desktop sticky scope-summary rail → mobile pinned scope summary above the bottom CTA; CAN/CANNOT two-column → stacked `Accordion`; tooltips → tap-`Popover`/`Sheet`; per-key cards stay cards.

> **Don't over-stuff (Zerion critique):** progressive disclosure. The hub shows each key's *summary* (scope chips + meters + countdown); the full on-chain parameter detail, selectors, and reproduce-yourself reads live one tap down on `/automation/[sessionKeyId]` and in the prove-it panel (`05` §2.3).

---

## 3. Section A — Automation status hub (`/automation`)

**Purpose:** Be the honest home for "what (if anything) can act on my behalf right now." It must make the **default (you sign everything)** unmistakable, show **active grants with live usage + expiry**, and put **revoke** ≤1 tap away. Benchmark: **Revoke.cash** (allowance/permission audit + per-row revoke), **ERC-4337 session-key risk-limits** (surface scope/cap/expiry as user-facing controls), **Ledger/Trust Wallet** (calm, control-first framing) (`09`; `05` §6).

### 3.1 Default-empty state — NO automation active (the most common state)
This is the **default** and must be **reassuring, not a prompt to enable** (don't nudge users off the safe path):
- **State banner / hero:** title **"You sign every action."** body **"Automation is off. SparkPoint can't move anything without your signature each time. You can grant a scoped, revocable session key if you'd like hands-off rebalancing — bounded by limits you set."** (`05` §5.3; `07` glossary §185).
- **CAN/CANNOT preview** (two-column, `05` §6): what a grant *would* allow (in-scope rebalances only, within caps/slippage/expiry) vs what it could **never** do (withdraw your funds, exceed your caps, touch non-allowlisted targets, block your withdrawals). The CANNOT column has ≥ visual parity (`05` §0.4).
- **CTA:** **"Grant scoped access"** (single spark CTA) → `/automation/grant`. Secondary: **"How automation works"** → `/learn/[slug]`.
- **shadcn:** `Card` + `Alert` (neutral/info, not warning) + two-column list (`Separator`) + `Button` (spark) + `Badge` (lock icons on CANNOT).

### 3.2 Active state — ≥1 session key live
- **State banner:** **"Automation active"** + count ("1 grant active") + the non-custodial badge mirrors with an "Auto" chip (`05` §1.3).
- **Active-grant `Card`** (one per key — at launch typically one):
  | Element | Detail | shadcn | ref |
  |---|---|---|---|
  | **Title / purpose** | "Auto-rebalance" + status pill (Active / Near cap / Near expiry / Exhausted / Expired / Revoked). | `Card` header + `Badge` (status) | `data-model.md` §10.1 |
  | **Scope chips** | "Only: Aave Yield Vault" · "≤ $X per move" · "≤ $Y per week" · "Slippage ≤ Z%" · "Expires {date}". **Allowlist-only**, tabular figures. | `Badge` row (`.tnum`) | `data-model.md` E10; `05` §6 |
  | **Per-tx cap meter** | (informational; the binding per-move limit). | text (`.tnum`) | `data-model.md` `per_tx_cap_raw` |
  | **Cumulative / weekly usage meter** | **"$X used of $Y this period"** remaining-capacity meter: spark/healthy → **caution amber ≥ ~80%** → **destructive at/over (Exhausted)**. Tabular + accessible text equivalent. | `Progress` (styled, `04` §6.5) | `04` §6.5; `05` §3.4 |
  | **Expiry countdown** | "Expires in {N days}" + absolute date; **amber when near** (e.g., ≤ ~3 days). | text/`Badge` | `data-model.md` `valid_until`; `05` §6 |
  | **Last activity** | "Last auto-rebalance {relative time} · {result}" → `/activity`. | text + link | `05` §5.4 |
  | **Actions** | **[Manage]** → detail · **[Revoke access]** (prominent, destructive-styled, empowering) → revoke flow. | `Button` (manage outline; revoke `AlertDialog`) | `07` §2.2 |
- **"Add another grant"** is deliberately **de-emphasized** at launch (single vault; one auto-rebalance lane is the norm). Do not push multiple keys.

### 3.3 Hub states (full set)
- **Default (empty / none active):** §3.1 — "You sign every action." (reassurance, not a hard sell).
- **Active:** §3.2 — grant card(s) with live meters + countdown.
- **Loading:** `Skeleton` for banner + grant card(s) (never a spinner; never `0` for caps/usage; never imply a key exists while resolving).
- **Success (post-grant return):** the new active grant card appears; `Sonner` toast already fired on `/confirm` — don't re-celebrate (`07` §2.5; `04` §7).
- **Warning:** **near-cap** (amber usage meter + "near your weekly limit"), **near-expiry** (amber countdown + "[Renew]" → new grant). Informational; never blocks revoke or withdraw.
- **Exhausted / Expired / Revoked:** the card shows the terminal status pill + plain explanation ("This grant has expired — you're back to signing every action.") + **[Grant new access]** (new key, never a silent renew). Past activity remains visible.
- **Error:** recoverable `Alert` + retry + reassurance ("Your funds are safe. You can still revoke and withdraw." ) — **revoke + withdraw remain reachable** via the shell + on-chain path.
- **Degraded mode (backend offline):** banner "SparkPoint services are degraded — your custody and control are unaffected." The **on-chain revoke instructions are promoted** (mirroring `05` §4.3); the agent cannot act while degraded, and the user can still revoke unilaterally.

**Microcopy (defer to `07`):** never call the default "off" a deficiency; "You sign every action" is the *safe* state. "Revoke access" not "Disable" (`07` §2.2/§366). Glossary line for "Session key" (`07` §185).

---

## 4. Section B — Enable auto-rebalance / grant scope (`/automation/grant`)

**Purpose:** Show the **EXACT bounded scope** the user is about to authorize, let them tune it within hard ceilings, restate it in plain language, and hand off **one user-signed grant** to `/confirm`. This screen is where "opt-in & bounded" is *made legible*. Benchmark: **ERC-4337 session keys & risk limits** (time/scope-limited keys, on-chain caps — surface as user-facing controls), **Turnkey/Blofin AA** (plain-language scope), **Tenderly/Rabby** (the grant itself is simulated + signed on `/confirm`) (`09`; `05` §6).

### 4.1 Framing header (opt-in & bounded, stated up front)
- **Title:** "Grant scoped access for auto-rebalance" (or `07`-canonical).
- **Sub / promise:** "This lets SparkPoint's AI rebalance **only within the exact limits you set below** — and **only the Aave Yield Vault**. You still own your keys. **Nothing can exceed these limits, even if SparkPoint is compromised** — they're enforced on-chain. **Revoke anytime, instantly, without our help.**" (`05` §6; `07` §299).
- **"AI suggestion — you approve & sign" label** is present (this grant is itself a user-signed action, `05` §5.2).

### 4.2 The bounded-scope builder (every field shown literally)
Each control is a user-facing expression of an **on-chain `PolicyModule` parameter** (`data-model.md` E10). Defaults are conservative; every field has plain helper text and a "why?" tip; all ceilings are **min(user value, on-chain hard ceiling)** (mirrors `data-model.md` VR-M3 mandate-slippage rule).

| Scope field | Maps to (on-chain) | Control | Helper / framing | shadcn |
|---|---|---|---|---|
| **Allowed vaults / targets** | `allowlisted_targets` (⊆ protocol allowlist) | read-only chip(s) at launch (**only the Aave Yield Vault**) — *not* a free-form picker; honest single-vault reality | "Auto-rebalance can only act on the Aave Yield Vault. It can never touch any other contract." | `Badge` (read-only) |
| **Allowed actions** | `allowlisted_selectors` | read-only chip(s) ("rebalance / supply within Aave v3") | "Only rebalancing actions — never a withdrawal to an outside address." | `Badge` (read-only) |
| **Max per move (per-tx cap)** | `per_tx_cap_raw` | `Input` + slider, `$`/USDC, tabular, capped at hard ceiling | "The most a single auto-rebalance can move. Default ${X}." | `Input`/`Slider` (`.tnum`) |
| **Max per week (cumulative budget)** | `cumulative_cap_raw` (surfaced as a weekly budget; the on-chain value is the lifetime cap for the key's term) | `Input` + slider | "The most automation can move in total over this grant — shown as ${Y}/week. When it's used up, automation stops until you grant again." | `Input`/`Slider` (`.tnum`) |
| **Max slippage** | `max_slippage_bps` (floor enforced on-chain) | `Input`/`Slider` in % (bps under the hood), capped at ceiling | "Auto-rebalances that would slip more than this are rejected on-chain." (mirror Flow 6 slippage guardrail) | `Slider`/`Input` |
| **Expires in** | `valid_until` (hard expiry) | preset chips (7 / 14 / 30 days) + date picker; **default a short horizon** | "After this, automation turns off automatically and you're back to signing everything. No auto-renew." | `ToggleGroup` + date `Popover` |
| **Starts** (optional) | `valid_after` | optional — default "now" | usually hidden; advanced disclosure only. | `Popover` |

- **Hard-ceiling clamping:** if a user enters above the protocol hard ceiling, clamp with a plain note ("Max allowed in beta: ${ceiling}") — never silently accept an unenforceable value (`data-model.md` VR-M3; `04` §10.4 disabled/limited via helper + `aria` not color alone).
- **No "unlimited" option, ever.** There is no infinite cap, no never-expires, no all-vaults. (Anti-pattern: unlimited approvals — Rabby/Revoke.cash lesson, `09`.)

### 4.3 The live Scope summary (the consequence, always in view)
A sticky (desktop right rail) / pinned (mobile) **plain-language restatement** that updates as the user edits — this is the single most important comprehension aid:

> **"You're granting SparkPoint's AI permission to auto-rebalance — bounded by these limits, enforced on-chain:**
> · only the **Aave Yield Vault** (no other contract)
> · up to **${X} per move**
> · up to **${Y} per week**, then it stops
> · slippage **≤ Z%** (over that → rejected)
> · **expires {date}** ({N} days) — then you sign everything again
> · **revocable anytime, instantly, without SparkPoint's help**
> · it can **never** withdraw your funds or move money to any outside address."

- **CAN/CANNOT recap** (condensed, `05` §6): the CANNOT line ("can never withdraw / exceed caps / touch other contracts / block your withdrawals") gets equal weight.
- **shadcn:** `Card` (sticky) + `Badge` (lock icons) + `.tnum` figures + `Separator`.

### 4.4 Grant CTA & handoff (one signed action)
- **Primary CTA:** **"Review & grant"** (spark, one per view) → builds `txIntent` (`grant_session_key`) → **`/confirm/[txIntentId]`** (Flow 6). On `/confirm`: the grant is **simulated**, the guardrail checklist runs, the **"AI suggestion — you approve & sign"** banner shows, and the user signs **once** → the on-chain `SessionKeyValidator`/`PolicyModule` is armed (`data-model.md` VR-SK3). **No sign UI here** (`01-IA` §0.3, §4 ⑥; `05` §6).
- **Secondary:** **"Not now"** → back to `/automation` (the safe default).
- **Banned:** "Enable AI", "Let AI trade", "Automate" (hide the scope), "Confirm/OK/Go" (`07` §2.2/§366). Never a one-tap grant that skips review+sign (`07` §90; `01-IA` §0.3).

### 4.5 Grant states (full set)
- **Default:** conservative defaults pre-filled; scope summary reflects them; CTA enabled (a grant with defaults is valid).
- **Editing (valid):** scope summary updates live; CTA enabled.
- **Out-of-bounds entry:** a field over its hard ceiling → clamp + helper ("Max allowed in beta: ${ceiling}"); CTA stays enabled with the clamped value, or disabled with a plain reason if the entry is invalid (e.g., expiry in the past).
- **Loading:** building the `txIntent` / reading hard ceilings → `Skeleton` on the summary + pending CTA (never fabricate caps).
- **Success:** **none here** — success happens on `/confirm` after signing; returning shows the active grant on `/automation` + toast ("Auto-rebalance is on, within your limits. SparkPoint can act only inside this scope — and you can revoke anytime. View grant ↗", `07` §2.5 pattern).
- **Warning:** **kill-switch active** ("New deposits/rebalances are paused — a grant won't act until the pause lifts. Withdrawals are never paused.", `05` §3.4; `07` §9 #7); **degraded mode** (the agent can't act; grant still possible but informational note). Neither removes revoke/withdraw.
- **Error:** build failure → `Alert` + retry + reassurance; insufficient gas for the grant UserOp (informed before handoff); **revoke + withdraw unaffected**; no raw RPC strings (`07` §6.1).

**Microcopy (defer to `07`):** lead with **what stays yours + the limits**, then convenience; name the scope; "Review & grant" → (on `/confirm`) "Sign grant" (`07` §2.2). Never imply the AI gains custody or open authority.

---

## 5. Section C — Session-key detail + INSTANT REVOKE (`/automation/[sessionKeyId]`)

**Purpose:** Show the **full on-chain scope and live usage** of one grant, prove it from chain, and provide an **instant, unilateral revoke that needs no SparkPoint cooperation**. This is the screen that makes "scoped & instantly revocable" *real*. Benchmark: **Revoke.cash** (per-row revoke), **ERC-4337 risk-limits** (scope/usage/expiry as controls), **Ledger/Trust Wallet** (empowering self-custody framing) (`09`; `05` §2.3/§6).

### 5.1 Anatomy
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Header + status pill** | "Auto-rebalance grant" + status (Active / Near cap / Near expiry / Exhausted / Expired / Revoked). | `Card` header + `Badge` | `data-model.md` §10.1 |
| **Persistent [Revoke access]** | **Pinned** top-right (desktop) / bottom-anchored (mobile). Destructive-styled `AlertDialog`, **empowering** copy. Always present while the key is active. | `Button` (destructive) + `AlertDialog` | `07` §2.2; `05` §6 |
| **Full scope read-out** | Every on-chain parameter in plain language: allowed vault(s) + (advanced: selectors), max per move, max per week / cumulative cap, max slippage, expiry, optional start. **Each linkable / reproducible from chain** (prove-it, `05` §2.3). | labeled rows (`.tnum`) + `Accordion` (raw read) | `data-model.md` E10 |
| **Usage meters** | **Cumulative/weekly used** remaining-capacity meter (spark→amber≥80%→destructive at cap) + per-tx cap (informational). Tabular + accessible text. | `Progress` (styled) | `04` §6.5 |
| **Expiry countdown** | "Expires in {N days}" + absolute date; amber when near; on expiry → terminal state. | text/`Badge` | `data-model.md` `valid_until` |
| **Activity under this key** | List of automated executions (date, action, amount, result/PnL) each linked to `/activity/[entryId]`; labeled **"Executed under your automation grant"**. | list/`Table` + link | `05` §5.4 |
| **Provenance / proof** | `session_pubkey` (truncated), `registered_tx_hash` (explorer link), "Controlled on-chain by the PolicyModule — limits enforced by the contract, not our app." + "[See exact permissions]" → prove-it (`05` §2.3). | text + explorer links | `data-model.md` VR-SK1; `05` §2.5 |
| **Re-auth affordance** (terminal states) | If expired/exhausted/revoked: **[Grant new access]** → `/automation/grant` (new key). Never a silent renew. | `Button` | `data-model.md` §10.1 |

### 5.2 The INSTANT REVOKE interaction (the highest-signal trust decision here)
- **Trigger:** **[Revoke access]** (detail header, grant card, prove-it panel, `⌘K`) → `AlertDialog` confirm: **"Revoke auto-rebalance? SparkPoint's AI will immediately stop acting on your behalf. You'll sign every action again. This is instant and doesn't need SparkPoint's cooperation."** Buttons: **"Revoke access"** (destructive, empowering) · "Keep it".
- **Execution (unilateral, SparkPoint-independent):** revoke is an **owner-only on-chain action** (`data-model.md` VR-SK2). The primary path produces a user-signed revoke `txIntent` → **`/confirm`** (minimal-friction, all-pass) OR, where the implementation allows, a direct revoke. **Critically, the screen must ALSO document/link the on-chain self-service revoke** (address + `revokeSessionKey` function + steps), so revoke is possible **even if SparkPoint's frontend/agent is offline** — mirroring the escape-hatch Path B (`05` §4.2/§4.3). Revoke must **never** be gated on backend health.
- **Effect (stated honestly):** at the revoke tx, on-chain state changes **immediately**; the mirror flips on indexing. After revoke: status → **Revoked**, the key can never act again, the user is **back to per-action signing** ("You sign everything from here", `07` §2.5).
- **Verification block:** "Don't trust this UI? Revoke is enforced by the contract — verify on-chain. [See permissions]" (`05` §2.5).

### 5.3 Detail states (full set)
- **Active (default):** full scope + live meters + countdown + persistent revoke + activity.
- **Near-cap / Near-expiry (warning):** amber usage meter / countdown + note ("Auto-rebalance will stop when this week's budget is used" / "Expires in 2 days — grant new access to continue"). Revoke + withdraw unaffected.
- **Exhausted:** "This grant has used its full budget. Automation has stopped — you're back to signing every action." + **[Grant new access]**. Activity retained.
- **Expired:** "This grant expired {date}. Automation is off — you sign everything." + **[Grant new access]** (`data-model.md` §10.1; FR-032).
- **Revoked:** "You revoked this grant {relative time}. SparkPoint's AI can no longer act on your behalf." + revoke tx link + **[Grant new access]**.
- **Loading:** `Skeleton` on scope/meters/activity; **the revoke action + on-chain revoke instructions render immediately** (never gated on read success, mirroring `05` §2.4).
- **Error / read failure:** "We couldn't read this grant's state on-chain right now. This doesn't change your limits — they're enforced by the contract. [Retry] · [Verify on explorer]." **Revoke remains prominent and functional** (`05` §2.4/§4.3); never block revoke or withdraw on a failed read.
- **Degraded mode:** on-chain revoke (Path-B-style) promoted to primary; agent can't act while degraded; banner reassures custody/control unaffected.

**Microcopy (defer to `07`):** revoke copy is **empowering, instant, prominent** ("Revoke access", `07` §2.2); revoke success line `07` §2.5; never under-state the user's power ("Disable" is banned, `07` §366); anchor trust in the contract, not the UI (`05` §2.5).

---

## 6. The "AI suggestion / executed under your grant" labeling (inherited from `05` §5)

This flow **does not re-spec** the labeling system (`05` §5 is canonical) — it specifies the **automation-specific touchpoints**:
- **The grant is a signed action** → carries the **"AI suggestion — you approve & sign"** label on `/automation/grant` and on `/confirm` (`05` §5.2).
- **Automation-eligible actions elsewhere** (chat/strategies/vault): when an action falls within an active key's scope, surface **"Auto-eligible — or sign manually"** with a clear choice; **manual sign always remains offered** (`05` §5.4). The default is never silently bypassed.
- **Automated executions** (in `/activity`, `/notifications`, and the detail activity list): labeled **"Executed under your automation grant"**, linked to the grant, with a one-tap **[Revoke]** — accountability is preserved (`05` §5.4).
- **Notifications:** session key **near-expiry**, **near-cap**, **expired**, **revoked**, and **each automated execution** generate a notification (`01-IA` §3; `05` §6) — the user is never surprised by automated activity.

---

## 7. Cross-cutting states (the six required, per surface)

Every surface ships **default · empty · loading · success · warning · error** where applicable, plus the automation-specific terminal states (active / near-cap / near-expiry / exhausted / expired / revoked / degraded). Flow-specific summary (full per-section states above):
- **Loading** = `Skeleton` at section shape; **never** spinner-over-stale; **never `0`** for caps/usage; **the revoke action + on-chain revoke instructions render immediately** (never gated on read).
- **Empty** = `/automation` default "You sign every action." — an **honest, reassuring** state (the safe default), **not** a hard sell to enable; the prove-it path + escape hatch are always reachable.
- **Success** = reflected post-`/confirm` (grant appears / revoke confirms); `Sonner` toast (grant: "within your limits…"; revoke: "Access revoked… you sign everything from here", `07` §2.5); not re-celebrated on the hub.
- **Warning** = `--caution` amber: near-cap, near-expiry, kill-switch paused, stale data — informational, never removing revoke/withdraw (`04` §2.4).
- **Error** = `07` §6.1 formula (what/why/next-step, no blame, **no raw RPC/revert strings**, reassurance "your funds are safe; you can still revoke and withdraw"); **revoke + withdraw paths never removed** by any error/degraded state (`01-IA` §6).

---

## 8. Non-custody / trust touchpoints in Automation (mandatory)

Automation is the flow most able to *appear* to erode self-sovereignty — so it must over-communicate control:
1. **Opt-in, with the safe default loud.** Per-action signing is the default and is framed as the safe state ("You sign every action"); enabling automation is a deliberate, scoped choice, never a nudge or a default-on toggle (`05` §5.3; `07`).
2. **Exact scope shown before signing.** `/automation/grant` renders **every** on-chain parameter (allowlist, per-tx cap, weekly/cumulative cap, max slippage, expiry) in plain language, restated live in the scope summary; **no "unlimited", no "all vaults", no "never expires"** (`data-model.md` E10; Rabby/Revoke.cash anti-unlimited lesson).
3. **Grant is ONE user-signed action through `/confirm`.** Never a silent toggle; the grant is simulated + guardrail-checked + signed once (`01-IA` §4 ⑥; `05` §6; `data-model.md` VR-SK3). SparkPoint never holds the session key.
4. **Limits are enforced on-chain, not by our app.** Copy anchors trust in the `PolicyModule` contract; the AI **can never exceed scope even if compromised** (`data-model.md` VR-SK1, SC-008; `05` §2.5).
5. **Instant, unilateral revoke — ≤1 tap, SparkPoint-independent.** Revoke is reachable from the badge/prove-it panel, `/automation`, the detail page, and `⌘K`; it works **without SparkPoint's cooperation**, and the on-chain revoke path is documented so it works **even if SparkPoint is offline** (`FR-031`, `VR-SK2`, SC-008; `05` §4/§6).
6. **Expiry & exhaustion auto-revert to signing everything.** No auto-renew; re-enabling is a new, freshly-scoped grant (`FR-032`; `data-model.md` §10.1).
7. **Automation can never touch custody or the escape hatch.** A session key can only **direct strategy within the allowlist** — no withdrawal path to any external/SparkPoint address; withdraw-always is unaffected (`spec.md` N1/N2; `05` §6).
8. **Accountable executions.** Every automated action is labeled, linked to its grant, surfaced in `/activity` + `/notifications`, with a one-tap revoke — the user always sees what acted on their behalf (`05` §5.4).
9. **AI presence is suggestion, not custody.** The grant *delegates a bounded signing lane*, not ownership; the AI never holds keys and never moves money outside the scope (`05` §5; brief).

---

## 9. Component inventory → shadcn/ui mapping (this flow)

| Automation component | shadcn/ui | Notes / ref |
|---|---|---|
| Status hub layout | `Card` column + state `Alert` banner | `/automation` (`05` §6). |
| "You sign every action" empty/default | `Card` + `Alert` (info, not warn) + two-column CAN/CANNOT + spark `Button` | Reassuring default, not a hard sell (`05` §5.3). |
| Active-grant card | `Card` + `Badge` (status) + scope `Badge` chips + `Progress` (usage) + countdown + `Button` | One per key (`data-model.md` E10). |
| Scope chips | `Badge` row (`.tnum`) | "Only Aave Yield Vault / ≤$X per move / ≤$Y per week / ≤Z% slippage / expires {date}". |
| Usage meter (cumulative/weekly) | `Progress` (styled) + `Tooltip` | spark→caution(≥80%)→destructive (`04` §6.5). |
| Expiry countdown | text/`Badge` (amber near-expiry) | `data-model.md` `valid_until`. |
| Scope builder (grant) | `Input` (`.tnum`) + `Slider` + `ToggleGroup` (expiry presets) + date `Popover` | per-tx / weekly / slippage / expiry; clamped to hard ceiling (`data-model.md` VR-M3). |
| Allowed-vault / action chips | `Badge` (read-only) | Single vault at launch; not a free-form picker. |
| Live scope summary | `Card` (sticky desktop / pinned mobile) + `Badge` + `Separator` | The consequence preview; CAN/CANNOT recap (`05` §6). |
| "Why?" / definition tips | `Popover`/`HoverCard` (desktop) / `Sheet` (mobile), `TipCard` (`--info`) | Session-key glossary (`07` §185). |
| Grant CTA | `Button variant=default` (spark) | "Review & grant" → `/confirm` (`07` §2.2). |
| Revoke action | `Button` (destructive) + `AlertDialog` | Empowering copy; instant, unilateral (`07` §2.2; `05` §6). |
| On-chain revoke (degraded) | `Card`/`Accordion` + copy fields + explorer links | Path-B-style, no-frontend (`05` §4.2/§4.3). |
| Detail scope read-out | labeled rows (`.tnum`) + `Accordion` (raw read) | Every on-chain param, reproducible (`05` §2.3). |
| Activity under key | list/`Table` + link → `/activity/[entryId]` | "Executed under your automation grant" (`05` §5.4). |
| Provenance / proof | text + explorer links | `session_pubkey`, `registered_tx_hash` (`data-model.md` E10). |
| Status pills (terminal) | `Badge` | Active/Near-cap/Near-expiry/Exhausted/Expired/Revoked (`data-model.md` §10.1). |
| "AI suggestion — you approve & sign" label | `Badge` (icon) / `Alert` (on `/confirm`) | Inherited from `05` §5.2. |
| Loading | `Skeleton` (banner/cards/scope/meters) | Revoke + on-chain instructions render immediately. |
| Error / degraded | `Alert` (recoverable) + retry; degraded → on-chain revoke promoted | Reassurance; revoke/withdraw never removed (`07` §6.1; `05` §4.3). |
| Toast (post-confirm) | `Sonner` | Grant / revoke success (`07` §2.5). |
| Confirm handoff | `txIntent` → `/confirm/[txIntentId]` | Flow 6; **no sign here** (`01-IA` §0.3). |
| Notifications | `Badge` + `Sheet`/`/notifications` | Near-expiry/near-cap/expired/revoked/executed (`01-IA` §3; `05` §6). |

---

## 10. Accessibility (required, `04` §10)

- **No information by color alone:** session-key status = pill **text + icon** (not color); usage meter = **label + tabular text equivalent** ("82% of this week's auto-rebalance budget used") not just fill; expiry urgency = text ("Expires in 2 days") not just amber.
- **Tabular numerals** on every figure (caps, used/remaining, slippage %, days-to-expiry) — also aids scanning (`04` §3.1, §10.8).
- **Keyboard:** full operability — scope inputs/sliders, expiry `ToggleGroup`/date picker, "why?" popovers, **[Review & grant]**, **[Revoke access]** + its `AlertDialog` (focus-trapped, `Esc` cancels), activity links, prove-it affordance. **Visible 2px spark focus ring + 2px offset** on every control (`04` §10.3/§10.4). The revoke `AlertDialog` confirm receives initial focus on the **non-destructive** option per pattern, but revoke must be reachable in one keyboard path (it is the user's power).
- **Touch:** 44px targets on mobile (sliders' thumb + stepper alternative, chips, CTA, revoke, sheet items, links) (`04` §4.3). The mobile **[Revoke access]** is bottom-anchored in thumb reach.
- **Live updates:** polite `aria-live` *sparingly* on the live scope summary — announce the restated scope on change, don't spam per keystroke (`04` §10.6).
- **Reduced motion:** honor `prefers-reduced-motion` on meter fills, countdown ticks, skeleton shimmer — instant/opacity fallback; no info by motion alone (`04` §7, §10.7).
- **AA contrast** both themes (dark default); risk/semantic/caps tokens pre-tuned; the destructive revoke button meets contrast and is not signalled by color alone (icon + label) (`04` §2/§10.1).

---

## 11. Benchmark references (named, per `09`)

- **Time/scope-limited keys with on-chain caps & expiry — the mechanism, surfaced as user-facing controls:** **ERC-4337 session keys & risk limits** (technorely) → the entire grant scope builder (§4.2), per-tx/cumulative caps + slippage + hard expiry shown literally, enforced on-chain (`09`; `data-model.md` E10).
- **AA / smart-account capability + plain-language scope microcopy:** **Turnkey (4337 → 7702)** + **Blofin (AA explainer)** → grant framing and "limits enforced by the contract" copy (§4.1, §5.1; `09`).
- **Per-row revoke + allowance audit framing (no unlimited approvals):** **Revoke.cash** → the instant per-grant **[Revoke access]** (§5.2), the no-"unlimited" stance (§4.2), and the `/automation` hub as a permission audit (§3) (`05` §2.3/§6; `09`).
- **Friction-as-safety + simulate-before-sign on the grant:** **Rabby** + **Tenderly** → the grant routes through `/confirm` (simulation + guardrail checklist + acknowledge-before-sign), not a silent toggle (§4.4; Flow 6; `05` §7; `09`).
- **Self-custody, control-first voice ("your keys, your funds"; "works even if SparkPoint disappears"):** **Ledger / Trust Wallet** → the empowering grant/revoke framing and the on-chain (no-frontend) revoke path (§4.1, §5.2; `05` §4.4; `09`).
- **"AI suggestion — you approve & sign" conversational-copilot framing:** **Hey Anon / Griffain / Neur** → the labeling on the grant and on automated executions (§6; `05` §5; `09`).

---

## 12. Acceptance criteria (this flow conforms when ALL hold)

1. **Opt-in, with the safe default loud.** `/automation` default-empty state says **"You sign every action"** as a *reassuring* state (not a hard sell); per-action signing is the visible default and the absence of automation is communicated as "you sign everything" (`spec.md` FR-035; `05` §5.3).
2. **Exact bounded scope shown BEFORE signing.** `/automation/grant` renders **every** on-chain parameter — **allowlisted vault(s) only, allowed actions, max per move (per-tx cap), max per week (cumulative cap), max slippage, hard expiry** — in plain language, restated live in a **scope summary**; with **no "unlimited", no "all vaults", no "never expires"** option, and values clamped to the on-chain hard ceiling (`spec.md` FR-029, N4; `data-model.md` E10, VR-M3/SK4; `09`).
3. **Grant is ONE user-signed action through `/confirm`.** Granting builds a `txIntent` (`grant_session_key`) and routes to **`/confirm/[txIntentId]`** (simulation + guardrail checklist + one signature); **no bespoke sign UI here**; SparkPoint never generates/holds the session key (`spec.md` FR-029; `data-model.md` VR-SK3; `01-IA` §0.3/§4 ⑥; `05` §6).
4. **Limits enforced on-chain; AI can never exceed scope.** Copy anchors trust in the `PolicyModule` contract; the design states that out-of-scope ops (allowlist/caps/slippage/expiry) are **rejected on-chain even if SparkPoint is compromised** (`spec.md` FR-030, SC-008; `data-model.md` VR-SK1; `05` §2.5).
5. **Active grants show live scope + usage + expiry.** `/automation` and `/automation/[sessionKeyId]` show **scope chips**, a **cumulative/weekly usage meter** (spark→caution≥80%→destructive at cap, tabular + accessible text), the **per-tx cap**, and an **expiry countdown** (amber near-expiry) (`09`; `data-model.md` E10; `04` §6.5).
6. **INSTANT, unilateral revoke ≤1 tap, SparkPoint-independent.** **[Revoke access]** is reachable in ≤1 tap from the prove-it panel, `/automation`, the detail page, and `⌘K`; revoke is an **owner-only on-chain action needing no SparkPoint cooperation**, the on-chain revoke path is documented so it works **even if SparkPoint is offline**, and revoke is **never gated on backend health/read success** (`spec.md` FR-031, SC-008; `data-model.md` VR-SK2; `05` §4/§6).
7. **Expiry & exhaustion auto-revert to per-action signing.** At `valid_until` (Expired) or `spent ≥ cumulative_cap` (Exhausted) the key stops on-chain and the user is **back to signing everything**; re-enabling is a **new grant (new key)** with **no auto-renew** (`spec.md` FR-032; `data-model.md` §10.1).
8. **Automation never touches custody or the escape hatch.** The grant can only **direct strategy within the allowlist** — the UI states it has **no path to withdraw funds to any external/SparkPoint address** and **never** affects withdraw-always (`spec.md` N1/N2; `05` §6).
9. **Automated executions are accountable.** Each in-scope automated action is **labeled "Executed under your automation grant"**, linked to the grant, surfaced in `/activity` + `/notifications`, with a one-tap **[Revoke]** (`05` §5.4; `01-IA` §4 #6).
10. **All states, every surface.** `/automation`, `/automation/grant`, `/automation/[sessionKeyId]` each ship default · empty ("you sign everything", reassuring) · loading (skeletons; **revoke + on-chain instructions render immediately**, never `0`/spinner over stale) · success (reflect post-confirm; grant/revoke toasts) · warning (near-cap / near-expiry / kill-switch paused / stale, `--caution`) · error (what-why-next + reassurance, **no raw RPC strings**) — plus terminal **Active / Exhausted / Expired / Revoked / degraded** — at **1440px desktop and 390px mobile** (brief §4; `07` §6; `04` AC#9; `data-model.md` §10.1).
11. **Non-custody legible & provable.** Limits-enforced-on-chain stated; **revoke is instant, unilateral, SparkPoint-independent, and degraded-safe**; the detail page links the grant to its on-chain proof (`session_pubkey`, `registered_tx_hash`, "[See exact permissions]" → prove-it); withdraw-always unaffected throughout (`spec.md` SC-008; `05` §2.3/§4/§6).
12. **Design-system + content conformance.** Token-only color (brand/outcome/risk never blur), spark scarcity (≤1 spark CTA/view; spark on AI presence/focus only — **not** on caps/risk), tabular numerals on every figure, full keyboard + 44px targets + visible spark focus ring + reduced-motion + meter text-equivalents, sentence case / second person / verb-first specific buttons (**"Grant scoped access"/"Review & grant"/"Revoke access"**, never "Enable AI"/"Automate"/"Let AI trade"/"Disable"), banned words avoided (`04` AC; `07` AC, §2.2, §366).
13. **shadcn-mappable.** Every component resolves to a primitive/composition in §9 / `04` §11; usage/cap meters via styled `Progress`; revoke via `Button` (destructive) + `AlertDialog`; grant scope via `Input`/`Slider`/`ToggleGroup`/date `Popover`.

---

## 13. Cross-references

- **Routes:** `01-information-architecture.md` §1 `(app)/automation`, `automation/grant`, `automation/[sessionKeyId]`; §3 nav (Automation under Control tier; `⌘K` "Revoke automation"; Withdraw/Exit + Prove-it pinned); §4 flow graph + decision-point ⑤/⑥ (automation wraps `/confirm`); §5 Stage E "Automate (optional, P3)"; §6 expired/revoked/degraded gating; **Hard IA rule** (no state removes the withdraw path).
- **Shell / persistent trust elements:** `01-IA` §2 (badge with "Auto" chip, wallet chip, disclaimer strip, prove-it panel automation row) — inherited, not re-specified here.
- **Default per-action signing / "AI suggestion — you approve & sign" labeling / scoped-revocable-automation trust obligations / acknowledge-before-sign:** `05-trust-and-safety-ux.md` (**§5 labeling — canonical; §6 automation trust obligations — canonical; §2 prove-it panel; §4 escape-hatch Path B (the model the on-chain revoke mirrors); §7 friction**).
- **Signing surface (grant + any tx-revoke route here):** Flow 6 / `/confirm/[txIntentId]` — Tenderly-style simulation + guardrail checklist + one signature; **no bespoke sign UI in this flow**.
- **Tokens / palettes / meters / motion / a11y / shadcn map:** `04-design-system.md` (§2 color, §2.5 risk palette, §3 type/numbers, §6.5 caps/usage meters, §7 motion, §10 a11y, §11 component map).
- **All wording / buttons ("Grant scoped access"/"Revoke access") / helper / success+revoke copy / tooltips / "Session key" glossary / banned phrases:** `07-content-and-tone.md` (§2.2 buttons, §2.3 labels/helper, §2.5 success/revoke, §185 glossary, §299 trust copy, §366 banned).
- **Benchmarks:** `09-references.md` (ERC-4337 session keys & risk limits; Turnkey 4337→7702; Blofin AA; Rabby; Revoke.cash; Ledger/Trust Wallet; Hey Anon/Griffain/Neur).
- **Data shape / invariants:** `specs/001-sparkpoint-pivot-mvp/data-model.md` **E10 (Session Key + Policy Scope — VR-SK1–4)**, §10.1 lifecycle (active/exhausted/expired/revoked), E11 (Execution/Intent — `/confirm` handoff), §16 RPC>subgraph>price authority; `spec.md` US-6, FR-028/029/030/031/032, FR-035/036 (N3/N4), SC-008.
- **Downstream/linked flows:** Confirmation (Flow 6 — where the grant routes; sign happens there), Trust Center (`/trust`, prove-it permissions panel, escape hatch — the canonical home of revoke/exit), Outcome Log (`/activity` — automated executions), Chat (Flow 2 — "automate this?"), Vault (Flow 5 — rebalances a granted key may act on), Notifications (near-expiry/near-cap/expired/revoked/executed).
