# 02 · Flow 6 — Execution Confirmation & Pre-Trade Simulation (the trust gate)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui).
> **Status:** Authoritative screen-level spec for **Flow 6 (Execution Confirmation & Simulation)** of the six core flows. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
> **What this surface IS:** the **single shared sign gate** that every state-changing action funnels through (`01` §0.3, §6) — route `/confirm/[txIntentId]`. It renders a **Tenderly-style pre-trade simulation** (balance-change table + approvals + gas + projected outcome), a **deterministic guardrail checklist**, and a **Sign action that is disabled until every active alert is acknowledged** (Rabby). It also specs the **bundled multi-step preview** (approve → swap → deposit), the **signing/pending/success/failure** states, and the **approval-management** surface.
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money"), the five non-custody guarantees, tone, non-goals. Design goal §7.6: *"Make signing safe."*
> - `01-information-architecture.md` — §0.3 the **single-confirm-funnel** rule; §1 the route `(app)/confirm/[txIntentId]`; §2 the persistent shell (badge + AI disclaimer strip); §4.2.3 "all state changes converge on `/confirm`, sign happens only here"; §4.2.4 "acceptance writes to the Outcome Log"; §6 degraded/caps/session-key states; the per-route `loading.tsx`/`error.tsx`/**degraded-mode** requirement for `confirm`.
> - `04-design-system.md` — tokens (spark = AI presence/primary CTA; strict semantic green/red/amber; risk palette §2.5; **tabular numerals** §3.1/§3.4; **mono** for addresses/hashes/calldata §3.1; balance/share/PnL formatting §3.4; caps meter §6.5; motion incl. success check & blocked shake §7; elevation/scrim for the focused sign moment §5; a11y incl. "Sign keyboard-focusable-but-disabled until acks" §10.4; component→shadcn map §11 — the Tenderly-style confirmation row).
> - `05-trust-and-safety-ux.md` — **§7 (friction-as-safety / acknowledge-before-sign)** is the authoritative friction/acknowledgement model this surface enforces; §5 the "AI suggestion — you approve & sign" labeling system; §3.4 caps semantics; §3.5 pause-only kill-switch; §8 the Outcome Log this surface writes to; §2.3/§6 the approval-management (Revoke.cash) framing.
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Especially §2.4 (the confirmation/signing copy pattern), §2.2 (button verbs: "Review & sign" → "Sign transaction"/"Sign deposit"/"Sign withdrawal"), §3 (success/error/warning/rejected strings), §5 (number/PnL/APY/shares formatting), §9 (banned/required phrases).
> - `09-references.md` — §5 simulation/sign gate (**Tenderly ★★★**, **Rabby ★★★**), §3 caps/vault transparency (Yearn/Beefy/Morpho/Gauntlet), §6 account-abstraction/session keys (bundled execution; the grant-as-signed-action).
>
> **What this doc is NOT:** visual tokens (`04`), canonical strings (`07`), the route map/shell (`01`), the chat surface internals (`02`), the strategy/vault surfaces that *route into* `/confirm` (Flows 4/5), the full automation grant flow (Automation doc; this doc covers only the grant *as a tx through `/confirm`*), or the on-chain no-frontend escape hatch (`05` §4 / `/trust/exit`). This surface **never re-implements** those; it is the convergence point they all funnel into.

---

## 0. The confirmation thesis (constraints on every screen in this flow)

This is **the money moment** and the structural climax of the whole trust story. Everything else in the product (chat, strategies, vault, onboarding) leads here, and here the thesis becomes literal: **the AI proposed, the deterministic guardrails checked, and now — only now — the user disposes by signing.** Constraints binding every screen:

1. **One gate, no bespoke signing UI (`01` §0.3, §4.2.3).** Deposit, withdraw, swap, accepted strategy, ERC-20 approval, and the automation grant **all build a `txIntent` and route here**. There is exactly one sign experience; no flow ships its own. The inline chat `ConfirmationCard` (`02`) is a *mirror* of this surface, not a second implementation, and always offers "Open full confirmation."
2. **Nothing is signed unsimulated (`spec.md` FR-021, SC-002; `05` §7.3).** A pre-trade simulation **always** precedes the signature request — for **100%** of state-changing actions. If we cannot simulate, we **do not let the user sign blind**. "Simulating…" gates the gate.
3. **Sign is disabled until every active alert is acknowledged (Rabby; `05` §7; `04` §10.4).** Warnings produce **specific** acknowledgement checkboxes; the spark **Sign** button is `disabled` (keyboard-focusable, `aria-disabled`, with an explaining helper/tooltip) until all are checked. Friction is **scaled to risk** — all-pass routine actions stay fast (one deliberate sign), elevated-risk actions gate.
4. **Blocks cannot be overridden (`spec.md` FR-023/025; `05` §7.2).** A guardrail **block** (exceeds cap, non-allowlisted target, slippage over max, simulation predicts revert) makes signing **structurally impossible** — not merely acknowledgeable. The UI offers a **remedy** ("reduce the amount", "lower slippage", "try again"), never an "override" / "ignore all funds at risk" path. Out-of-policy AI proposals are rejected **before** they ever reach this surface (`spec.md` FR-008) — the user never sees a signable out-of-policy action.
5. **The AI never has the final word (`05` §5; `07` §2.1).** The verbatim **"AI suggestion — you approve & sign"** banner is present on this surface; the control reminder *"Nothing moves until you sign. You can cancel now with no effect."* (`07` §2.4) is always shown. Cancelling is always free and never penalized.
6. **Custody and exit are never gated on this surface's health (`05` §0.3, §4; `01` §6).** A failed simulation, a backend outage, a degraded RPC — none of these may block the **withdraw-always** path. The persistent shell's [Exit anytime] stays ≤1 tap away; a *withdrawal* `txIntent` that fails to simulate still surfaces the on-chain no-frontend exit (`/trust/exit` Path B).
7. **Fact-only, sober tone (`07` §2.4, §1.3 "confirmation/signing" register).** No persuasion, no hype, no celebration-before-the-fact. Plain headline → balance changes → approvals → costs → guardrails → control reminder → sign. Mirror Rabby's sobriety. Success may have **one** satisfying beat (a `--success` check-draw, `04` §7) — never confetti.
8. **Provable, not promised (`05` §0.1).** Every figure is sourced or on-chain-derived; the success state terminates in a **tx hash + explorer link**; the receipt **links back to the originating recommendation** (writing/linking the Outcome Log entry, `05` §8; `spec.md` FR-039).
9. **Launch reality (`spec.md` Assumptions).** Base only; assets USDC + ETH (Aave v3) and Aerodrome swaps; the single Aave Yield Vault (`spvUSDC` shares, **Risk 1/5**). The vault is **0% on principal / 0 management with an active 10% profit-only, high-water-mark performance fee on realized yield** — the confirmation must show "**SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal**" explicitly so "net" is legible (deposit = $0.00; withdraw itemizes any accrued fee). Beta-gated: per-user cap + vault cap are live guardrail checks here.

---

## 1. Goal & entry points

### 1.1 Goal

Give the user, **before any signature**, a deterministic, legible, honest preview of **exactly what will happen on-chain** — what leaves their wallet, what arrives, what they're approving, what it costs, and how the result is projected — plus a **visible checklist of the deterministic guardrails** the action passed, and then let them **sign deliberately** (or cancel freely). The surface must make a crypto-curious newcomer feel *safe* (plain headline, "nothing moves until you sign," remedy-not-override) and let a DeFi-native power user *verify* (raw balance deltas, calldata, approval scope, per-step bundle traces, explorer-reproducible figures).

The one-sentence job: **turn an AI-proposed, guardrail-checked transaction into an informed, deliberate, user-signed execution — or a free cancel — with zero blind signing.**

### 1.2 Entry points (all build a `txIntent` → `/confirm/[txIntentId]`; `01` §4.2.3, §4.3)

| From | Action that creates the `txIntent` | Notes |
|---|---|---|
| **Vault deposit panel** (`/vault/deposit`, Flow 5) | "Review deposit" | The most common path; deposit into the Aave Yield Vault → `spvUSDC` shares. |
| **Vault / escape withdraw** (`/vault/withdraw`, Flow 5 / `05` §4 Path A) | "Review withdrawal" | Withdraw/redeem; **never** blocked by caps or kill-switch. |
| **Strategy detail / card** (`/strategies/[recId]`, Flow 4) | "Review this move" | Carries `recId` so the receipt links the Outcome Log entry (`05` §8). |
| **Chat ActionCard** (deposit/withdraw/swap intent, `02`) | "Review this move" / "Review deposit" | Inline `ConfirmationCard` mirrors this surface; "Open full confirmation" deep-links here. |
| **Aerodrome swap** (from chat, `spec.md` FR-020) | "Review swap" | Swap preview = balance-change table + price impact + max slippage + approvals. |
| **ERC-20 approval** (standalone or as bundle step) | "Review approval" | The approvals section is first-class; **exact-amount** offered by default (§4). |
| **Automation grant** (`/automation/grant`, P3; `05` §6) | "Review & sign" | The session-key grant **is itself a signed tx routed here** (`01` §4.2.6) — scope/cap/expiry shown as the "what you're authorizing" payload. |
| **Approval-management → Revoke** (`/trust/permissions`, `05` §2.3) | "Review revocation" | Per-row "Revoke approval" routes through `/confirm` (Revoke.cash framing). |
| **Notifications deep-link** | reopen a pending/failed `txIntent` | e.g. "your transaction needs attention". |

> **`/confirm` is NOT in primary nav (`01` §6).** It is a **transient, contextual destination** — reached from an action, never browsed to. A `txIntent` is short-lived; an expired/invalid `txIntentId` → `not-found` state (§7.K).

### 1.3 Pre-conditions & what's already been decided upstream

By the time the user lands here:
- The **deterministic policy layer has already filtered out-of-policy proposals** (`spec.md` FR-008) — only allowlisted protocols (Aave v3, Aerodrome) and in-policy actions can produce a `txIntent`. This surface **re-verifies** authoritatively (the strategy/vault surfaces only *previewed* the guardrails) and **re-simulates live** (`04` flow note: "`/confirm` re-simulates live").
- The **amount/asset/target** are set (from the originating panel/card). This surface lets the user **edit upstream** ("Edit" / "Back") but is not the place to *compose* the action — it confirms it.
- **Wallet connected + Base network + whitelist + geo** are handled at the app boundary (`01` §6). A regress mid-flow shows the relevant gated/degraded render here, but **withdraw-always stays reachable**.

---

## 2. Layout — desktop vs mobile

Both breakpoints first-class (`00` §4; `04` §4.2). `/confirm` runs in a **focused shell** (`01` §2 notes the confirm shell still carries the badge + disclaimer strip): chrome is minimized to keep attention on the sign moment, but the **non-custodial badge** and the **AI disclaimer strip with [Prove it] / [Exit anytime]** remain present (a hard IA invariant, `05` §1.1).

### 2.1 Desktop (`/confirm/[txIntentId]`, 1440px canvas) — two-pane

The Tenderly two-panel idiom (`09` §5): **asset/outcome on the left (what happens to your money), technical/decision on the right (approvals, guardrails, sign).**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FOCUSED SHELL: [SparkPoint mark]   ● Non-custodial ▸ · 0x12…ab (Base) ▸ · ✕   │
│ AI DISCLAIMER STRIP — "AI suggestion — you approve & sign. SparkPoint never     │
│   holds your funds. [Prove it] [Exit anytime]"                                  │
├────────────────────────────────────────────┬───────────────────────────────────┤
│ LEFT — WHAT HAPPENS (primary, ~58%)         │ RIGHT — DECISION RAIL (~42%)        │
│                                             │                                     │
│ ◦ HEADLINE (plain-language)                 │ ┌ GUARDRAIL CHECKLIST ───────────┐ │
│   "You're depositing 500 USDC into the      │ │ ✓ Within your beta cap          │ │
│    Aave Yield Vault and will receive        │ │ ✓ Within the vault cap          │ │
│    ≈ 498.21 spvUSDC."                        │ │ ✓ Slippage under your max (0.5%) │ │
│   [① AI suggestion — you approve & sign]    │ │ ✓ Allowlisted protocol (Aave v3)│ │
│                                             │ │ ✓ Policy approved · Simulation ✓│ │
│ ◦ SIMULATION STATUS BANNER                  │ └─────────────────────────────────┘ │
│   ✅ "Simulation passed — no risks detected"│  (amber/red alert banner here when  │
│   (or amber/red alert variant — §5)         │   warns/blocks present; acks live    │
│                                             │   inside it — §6)                    │
│ ◦ BALANCE-CHANGE TABLE (Tenderly-style)     │ ┌ COST & OUTCOME ────────────────┐ │
│   Asset      Direction   Amount      USD    │ │ Network fee  ≈ $0.03 (gas)      │ │
│   USDC        − out      500.00    −$500.00 │ │ SparkPoint fee   0%  ⓘ          │ │
│   spvUSDC     + in       498.21    +$500.00 │ │ Net to vault     $500.00        │ │
│   ETH (gas)   − out      0.000012   −$0.03  │ │ Projected (est.) +$21/yr @4.3%  │ │
│                                             │ │   "Estimates, not guarantees."  │ │
│ ◦ APPROVALS  (when present — §4)            │ └─────────────────────────────────┘ │
│   "Approve Aave to spend USDC"              │                                     │
│   Amount: [ Exact: 500 USDC ✓ ] [Unlimited ⚠]│ ◦ CONTROL REMINDER                  │
│                                             │   "Nothing moves until you sign.    │
│ ◦ BUNDLE (multi-step) — collapsed steps     │    You can cancel now, no effect."  │
│   ① Approve → ② Swap → ③ Deposit  (§3)      │                                     │
│                                             │ ─ ACTIONS ─                         │
│ ◦ DETAILS (power-user, collapsed Accordion) │ [ Review & sign ] (spark, gated)    │
│   raw deltas · decoded events · calldata    │ [ Edit ]   [ Cancel ]               │
│   contract addrs (mono) · explorer links    │   helper: "Acknowledge 1 item to    │
│                                             │            enable signing." (if any) │
└────────────────────────────────────────────┴───────────────────────────────────┘
```

- **Left column = "what happens to your money"**: headline, simulation status banner, balance-change table, approvals, bundle steps, and a collapsed power-user "Details" accordion (raw deltas, decoded events, calldata, contract addresses in mono with explorer links).
- **Right rail = "the decision"**: the **guardrail checklist** (always visible), the **alert banner + acknowledgement checkboxes** when warns/blocks exist, the **cost & outcome** block, the **control reminder**, and the **single spark `Sign` CTA** + Edit/Cancel. The right rail's Sign is the *only* spark element on the surface (`04` §2.3).
- **Scrim/elevation:** if `/confirm` opens as an overlay from chat or a panel (rather than a full route), it uses the Dialog/Sheet scrim (`04` §5) — `bg-black/60` + `backdrop-blur-sm` — to focus the moment. As a full route it uses the focused shell.

### 2.2 Mobile (390px canvas) — single column, stacked, sticky sign bar

```
┌───────────────────────────────┐   ┌───────────────────────────────┐   ┌───────────────────────────────┐
│ ● Non-custodial ▸ · Base · ✕  │   │ (warn variant)                │   │ (signing/pending)             │
│ AI suggestion—approve&sign ▾  │   │ ⚠ Heads up banner             │   │  ◌ spark pulse                │
├───────────────────────────────┤   │ "Slippage could reach 0.9%…"  │   │  "Waiting for your signature  │
│ You're depositing 500 USDC    │   │ ☐ I understand slippage could │   │   in your wallet…"            │
│ → ≈ 498.21 spvUSDC            │   │   be up to 0.9%               │   │  [Open wallet]  [Cancel]      │
├───────────────────────────────┤   ├───────────────────────────────┤   ├───────────────────────────────┤
│ ✅ Simulation passed          │   │ Balance changes (table)       │   │ (success)                     │
├───────────────────────────────┤   │ Approvals (exact/unlimited)   │   │ ✅ Deposit confirmed          │
│ BALANCE CHANGES               │   │ Cost & outcome                │   │ You hold 498.21 spvUSDC       │
│ USDC      − 500.00  −$500.00  │   │ Guardrails ✓✓⚠✓✓             │   │ (≈ $500.00)                   │
│ spvUSDC   + 498.21  +$500.00  │   │ "Nothing moves until you sign"│   │ View transaction ↗            │
│ gas       − 0.000012 −$0.03   │   ├───────────────────────────────┤   │ See it in your portfolio →    │
├───────────────────────────────┤   │ ▟ sticky bottom sign bar:     │   │ From: "Move idle USDC…" rec → │
│ APPROVALS · Exact 500 ✓       │   │ [Acknowledge 1 to continue]   │   ├───────────────────────────────┤
│ COST  fee 0% · gas $0.03      │   │ → [Sign deposit] (enabled)    │   │ ▟ [Done]  [View in activity]  │
│ GUARDRAILS ✓✓✓✓✓             │   └───────────────────────────────┘   └───────────────────────────────┘
├───────────────────────────────┤
│ "Nothing moves until you sign │  Sections collapse to Accordions where dense (Details, Bundle steps,
│  — cancel now, no effect."    │  Approvals advanced). Guardrail checklist + alert/acks are NEVER collapsed.
├───────────────────────────────┤
│ ▟ sticky bottom sign bar:     │  The sticky bottom bar is thumb-reachable (04 §4.2/§4.3): it holds the
│ [Review & sign] (spark) ·[✕]  │  helper + the single spark Sign CTA, gated until acks complete.
└───────────────────────────────┘
```

- **Single column, stacked sections** in reading order: headline + AI-suggestion chip → simulation status → balance-change table → approvals → cost & outcome → guardrail checklist → (alert + acks if any) → control reminder → **sticky bottom sign bar**.
- **The guardrail checklist and any alert + acknowledgement checkboxes are never collapsed** (they gate the sign and must be seen). Power-user "Details" and the bundle step traces collapse into `Accordion`s.
- **Sticky bottom action bar** holds the disabled-state helper + the spark **Sign** CTA, with **Cancel** reachable (icon/secondary). The overlay form on mobile is a **`Sheet` (bottom)**, not a `Dialog` (`04` §4.2 transform rule).

### 2.3 Responsive transform rules (carry everywhere)

| Desktop | → Mobile |
|---|---|
| Two-pane (what-happens left / decision rail right) | Single column, stacked; decision items inline in reading order |
| Sign CTA in right rail | Sign CTA in **sticky bottom bar** (thumb zone) |
| Overlay = `Dialog` (scrim + scale-in) | Overlay = bottom `Sheet` (slide-up) |
| "Details" / "Bundle steps" inline-expandable | `Accordion` collapsibles |
| Approvals exact/unlimited toggle inline | Same control, full-width; "what's this?" → `Sheet` |
| Hover affordances (calldata copy hints, source tooltips) | Always-visible ≥44px tap targets (`04` §4.3) |
| Guardrail checklist as a right-rail card | Guardrail checklist as a full-width section (still never collapsed) |

---

## 3. The `ConfirmationCard` / confirm surface — component anatomy

The surface composes a `Card` (full route) or `Dialog`/`Sheet` (overlay) from these named parts. The inline chat `ConfirmationCard` (`02`) is the compact mirror of the same anatomy (≤2 actions; "Open full confirmation" to reach this surface).

| Part | Content | Rules / benchmark | shadcn |
|---|---|---|---|
| **AI-suggestion banner** | Verbatim **"AI suggestion — you approve & sign"** | Never shortened (`07` §2.1, §5.2 of `05`). Spark-tinted (`04` §9). Present on every confirm surface; on `/confirm` rendered as a banner (`05` §5.2). | `Alert`/`Badge` (spark-subtle) |
| **Headline** | Plain-language: *"You're depositing 500 USDC into the Aave Yield Vault and will receive ≈ 498.21 spvUSDC."* (deposit) / *"You're withdrawing 200 USDC from the Aave Yield Vault (redeeming ≈ 199.10 spvUSDC)."* / *"You're swapping 0.1 ETH for ≈ 312.40 USDC on Aerodrome."* | What + amount + result in one sentence; shares explicit (ERC-4626). Tabular numerals. Never lead with a return number (`07` §9). | `text-h2` + prose |
| **Simulation status banner** | **green "Simulation passed — no risks detected"** / **amber** caution / **red** blocked (§5). | The headline trust signal of the sim. Color + icon + text (never color-alone, `04` §10.2). When loading → "Simulating…" (§7.A). | `Alert` (success/warning/destructive) |
| **Balance-change table** | One row per asset in/out, **+ native gas row**: asset · direction (− out / + in) · amount (token, tabular) · USD value (signed, colored) | Modeled on **Tenderly** asset-change view (`09` §5). `−` = `--loss` direction, `+` = `--gain` direction; **USD via priced source** (`07` §2.6 source affordance). True minus `−` U+2212 (`07` §5.4). Right-aligned tabular. Shares row uses the `{shares} spvUSDC ≈ ${value}` pattern (`07` §5.6). | `Table` |
| **Approvals section** | List of token approvals this action requires: "Approve {spender} to spend {token}", with an **amount control**: **default = exact amount** (e.g. "Exact: 500 USDC"), with an explicit **"Unlimited" option flagged with an amber caution** (icon + "Unlimited — not recommended"). | **Flag unlimited; offer exact** (`spec.md`/brief; Rabby/Revoke.cash, `09` §5). Default selection is **exact** for the action's amount. If no approval needed, section is absent (not an empty placeholder). | `Card` + `RadioGroup`/`ToggleGroup` + `Badge` (caution) |
| **Bundle / multi-step preview** | For compound actions, an ordered, numbered list of steps, **each with its own simulated result**: e.g. **① Approve USDC (exact) → ② Swap ETH→USDC on Aerodrome → ③ Deposit USDC to vault**. Each step shows status (✓ simulated / will run), its balance delta, and (advanced) its calldata. | **Bundled simulation** validating each intermediate step (**Tenderly bundled sim**, `09` §5/§6). The headline summarizes the *net* effect; the bundle shows the *path*. One signature where the stack supports batching (AA), or sequential signs clearly enumerated where not (§3 below). | `Accordion`/`Stepper` + per-step `Table` |
| **Cost & outcome** | **Network fee (gas)** ≈ $ (and native units) · **SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal** (ⓘ "Only on realized yield above your high-water mark; deposit = $0.00; never on principal") · **net result** · **projected outcome** (est. $/yr at current net APY) + **"Estimates, not guarantees."** | Honest yield (`07` §5.2, §9.1): net only, breakdown ≤1 tap, never projected APY itself — projection is a clearly-labeled derived $ estimate. Gas in USD + native, tabular. | `Card` + `Tooltip`/`Popover` (breakdown) |
| **Guardrail checklist** | The deterministic checks, each with a pass/warn/block state + plain label: **"✓ Within your beta cap" · "✓ Within the vault cap" · "✓ Slippage under your max ({x}%)" · "✓ Allowlisted protocol ({Aave v3 / Aerodrome})" · "✓ Policy approved" · "✓ Simulation passed"** | This is the **"guardrails + you dispose"** made literal (`05` §7.2; brief §5). Caps semantics from `05` §3.4; pass=`--success`+check, warn=`--caution`+alert-triangle, block=`--destructive`+slash/lock (`04` §2.4). Each item has a "what's this?" `Tooltip` (literacy, `07` §4.3). Warn items carry the ack checkbox (§6). | list rows + semantic icons + `Tooltip`; `Checkbox` per warn-ack |
| **Control reminder** | **"Nothing moves until you sign. You can cancel now with no effect."** | Verbatim (`07` §2.4 step 4). Always present, near the Sign CTA. | `text-sm muted` |
| **Sign CTA (primary, gated)** | **"Review & sign"** then, after acks, **"Sign deposit" / "Sign withdrawal" / "Sign transaction"** (verb matches the action, `07` §2.2) | **One spark primary per view** (`04` §11). **Disabled** (keyboard-focusable, `aria-disabled`, helper text) until every warn-ack is checked and the sim has passed; **impossible** (never enabled) when a block is present (§6). | `Button variant="default"` (spark) + `Tooltip` (disabled reason) |
| **Edit / Cancel** | "Edit" (→ back to the originating panel preserving inputs) · "Cancel" (free, no effect) | Cancelling is fine and neutral (`07` §3 "You cancelled… Nothing moved."). | `Button variant="outline"/"ghost"` |
| **Power-user "Details" (collapsed)** | raw balance deltas, decoded emitted events, calldata (mono), contract addresses (mono, truncated + copy + explorer), access-list/storage on request | Tenderly technical breakdown (`09` §5); progressive disclosure (`00` §3 — never forced on the newcomer, always reachable by the expert). Mono per `04` §3.1. | `Accordion` + `Table` + copy `Button` |

> **Trust strings (reuse verbatim, `07`):** "AI suggestion — you approve & sign"; "Simulation passed — no risks detected"; "Nothing moves until you sign. You can cancel now with no effect."; "Estimates, not guarantees." (on yield-referencing outcome); "Acknowledge the {n} item(s) above to enable signing." (disabled-Sign helper); the success/error strings in §7 (from `07` §3).

---

## 4. Approvals (flag unlimited · offer exact)

ERC-20 approvals are a first-class, high-trust sub-surface (their misuse is a primary DeFi loss vector — Rabby/Revoke.cash, `09` §5; `05` §2.3).

- **Default to exact.** The approval amount control **defaults to the exact amount the action needs** (e.g. "Exact: 500 USDC"). This is selected on arrival; the user does not have to opt into safety.
- **Unlimited is flagged, never default.** An "Unlimited" option is available (some users prefer it to avoid re-approving) but is rendered with an **amber caution** (icon + "Unlimited — you'd let {spender} spend this token without a per-tx limit. Exact is safer."). Selecting Unlimited **adds an acknowledgement** to the guardrail flow (§6) — it does not silently proceed.
- **Spender legibility.** Show *who* is being approved in plain language ("Aave v3 (allowlisted)") with the contract address (mono, truncated, copy + explorer) one tap deeper. Only allowlisted spenders can appear (`spec.md` FR-027).
- **Pre-existing approval reuse.** If the user already has a sufficient exact/standing approval, the approvals section says so ("Already approved — no new approval needed") and the bundle drops the approve step.
- **Approval-management cross-link.** A quiet "Manage approvals" link → `/trust/permissions` allowance audit (§8), so a user can review/revoke standing approvals.

---

## 3-bis. Bundled multi-step preview (approve → swap → deposit)

Compound actions (e.g., "swap ETH→USDC then deposit to the vault" = approve → swap → deposit) render as a **bundled simulation** (Tenderly bundled sim, `09` §5/§6):

- **Net headline + step path.** The headline summarizes the *net* effect ("You're swapping 0.1 ETH and depositing the resulting ≈ 312 USDC into the Aave Yield Vault, receiving ≈ 311 spvUSDC."); the **Bundle** block enumerates the ordered steps, each with its own simulated balance delta and status.
- **Per-step status.** Each step shows ✓ simulated (with its delta) or a per-step warn/block. **A block on any step blocks the whole bundle** (and names which step), with a remedy.
- **Signature model (honest about the path).**
  - Where the smart-account stack supports **batched execution** (ERC-4337/EIP-7702, `09` §6), the bundle can be **one signature**; the surface says "One signature runs all {n} steps."
  - Where steps must be sequential signatures, the surface **enumerates them up front** ("This needs {n} signatures: ① approve, ② swap, ③ deposit") and shows a **progress stepper** during signing (§7.E) so the user is never surprised by a second wallet prompt.
- **Guardrails apply to the whole bundle** (the net effect against caps, every hop against the allowlist, the swap leg against slippage). The checklist reflects the bundle, not just one leg.

---

## 5. The simulation status banner (green / amber / red)

The single most-scanned element. Color + icon + text, always (`04` §10.2). Maps to `Alert` success/warning/destructive (`04` §11).

| Banner | Trigger | Treatment | Effect on Sign |
|---|---|---|---|
| **Green — "Simulation passed — no risks detected"** | Sim succeeded; all guardrails pass; balances as expected | `--success` + check; calm | **Enabled** after the (single) deliberate sign — low friction, routine actions stay fast (`05` §7.3). |
| **Amber — caution / acknowledge-required** | Sim succeeded but a guardrail **warns**: slippage elevated (near max), unlimited approval selected, **above-plan risk** (move riskier than the mandate), near-cap, partial/uncertain sim, **price/data slightly stale** | `--caution` + alert-triangle; lists each warn with a **specific ack checkbox** (§6) | **Disabled until every ack is checked** (Rabby; `05` §7.3). Counter: "Acknowledge {n} of {m} to continue." |
| **Red — blocked** | A guardrail **blocks**: exceeds per-user/vault cap, target **not allowlisted**, slippage **over** max, **simulation predicts revert** | `--destructive` + slash/lock; states the reason + a **remedy** | **Impossible** — Sign never enables; only "Edit"/"reduce amount"/"lower slippage"/"Cancel" (`05` §7.2). Brief shake on a blocked attempt (`04` §7). |

- **Never recolor the whole surface red on a *down* projection** (a lower-yield estimate is not an alarm). Red is reserved for *blocked/loss*, amber for *acknowledge*, per `04` §2.4 / `05` §0.8.
- **The banner and the checklist agree.** The banner is the *summary*; the checklist is the *itemization*. A red banner has at least one red checklist row; an amber banner has at least one amber row with an ack.

---

## 6. Friction-as-safety: the acknowledgement model (Rabby) — authoritative ref: `05` §7

This surface **enforces** the friction model `05` §7 specifies. Restated for screen production:

- **Warn → ack checkbox.** Every warn-state guardrail produces a **specific** acknowledgement: *"I understand slippage could be up to 0.9%."* / *"I understand I'm approving an unlimited spend."* / *"I understand this move is higher-risk than my plan (Risk 1 → Risk 3)."* (`05` §7.4 — acks are specific, never "I accept the risks"). Each maps the verb **"I understand"** (`07` §2.2). shadcn: `Checkbox` per ack, inside the amber `Alert`.
- **Sign gating.** **Sign is `disabled` until every active warn-ack is checked.** It remains **keyboard-focusable** with `aria-disabled` + an actionable helper/tooltip ("Acknowledge the slippage warning to continue." / "Acknowledge the {n} item(s) above to enable signing."), per `04` §10.4 and `07` §2.4 step 5. A counter shows progress ("Acknowledge 2 of 3 to continue").
- **Block → no override.** Block-state guardrails make Sign **impossible** (not acknowledgeable). The surface offers a **remedy**, never an "ignore"/"override"/"sign anyway" path (`05` §7.2; `spec.md` FR-023/025). Copy frames it as protection: *"Blocked by your guardrails: {plain reason}. Adjust the amount or your limits to continue."* (`07` §3 / §6.1).
- **Simulation must succeed first.** While "Simulating…" or on **sim error**, Sign is disabled — **never sign an unsimulated or failed-simulation action** (`05` §7.3, §7.5): *"We couldn't simulate this — we won't ask you to sign blind. [Retry]."*
- **Friction scales to severity.** All-pass → one deliberate sign, no checkboxes (don't over-gate routine deposits). Acks appear **only** for real warns. This is a hard rule (`05` §7.5): routine flows must not be cluttered with ceremonial acknowledgements.

---

## 7. States (the full sign lifecycle)

Every state below must be designed at **both breakpoints** with copy from `07`. Map to `01`'s `loading.tsx` / `error.tsx` / **degraded-mode** route requirements for `confirm`.

**A. Simulating (loading) — the gate's gate**
- Trigger: `txIntent` opened; pre-trade sim in flight.
- Treatment: **`Skeleton`** placeholders for the balance-change table, cost block, and projected outcome; the simulation status banner shows **"Simulating…"** with the AI/spark "thinking" affordance (spark dot pulse + optional tool-step ticker: *"Simulating this move…"*, `04` §7; `07` §3.4). **Sign disabled.** Guardrail checklist may render the static/known checks (caps, allowlist) as they resolve, with the simulation row pending. **No `0` placeholders; no spinner-over-stale** (`04` §6.1, §7; `07` §5.5).
- The headline (what you're about to do) can render immediately (it's known from the `txIntent`); only the *results* skeleton.

**B. Success — simulation passed (default, ready to sign)**
- Green banner "Simulation passed — no risks detected"; full balance-change table; approvals = exact; cost & outcome populated; **all guardrail rows ✓**; control reminder; **Sign enabled** (one deliberate action). One spark element (Sign).

**C. Warning — acknowledge-before-sign**
- Amber banner + each warn as a row with a **specific ack checkbox** (§6). Sign **disabled** until all checked; counter + helper present. The rest of the preview is fully shown (the user decides with full information). Above-plan risk warns carry the mandate context ("your plan: Risk 1/5") inline.

**D. Blocked — cannot proceed (no override)**
- Red banner + the offending guardrail row(s) red with the reason; **Sign never enables**; primary affordance becomes the **remedy** ("Reduce amount" / "Lower slippage" / "Edit") + "Cancel". Caps-block copy: *"Blocked by your guardrails: this would exceed your beta cap ($X of $Y used). Reduce the amount to continue."* (`07` §3; `05` §3.4). **Withdrawals are never blocked here** (a withdraw `txIntent` cannot hit a cap/kill-switch block — `spec.md` FR-026; if a withdraw path errors, route to the escape hatch, §7.J).

**E. Signing / pending**
- After "Sign": **"Waiting for your signature in your wallet…"** (wallet prompt open) → on sign → **"Submitting your transaction…"** → **"Confirming on Base…"** with the tx hash appearing (mono, truncated, copy + explorer) as soon as it's broadcast. Spark "thinking"/pending affordance (motion-gated). **For sequential-signature bundles (§3-bis):** a **progress stepper** ("Step 2 of 3 — swap") so each wallet prompt is expected. "Cancel" / "Open wallet" available until broadcast; after broadcast, the action is in-flight (no false cancel).

**F. Success — confirmed (receipt)**
- **Plain, specific, non-celebratory** (`07` §3.3) with **one** `--success` check-draw beat (`04` §7, never confetti):
  - Deposit: *"Deposit confirmed. You now hold 498.21 spvUSDC (≈ $500.00). View transaction ↗"* + "See it in your portfolio".
  - Withdraw: *"Withdrawal confirmed. $200.00 is back in your wallet. View transaction ↗"*
  - Swap: *"Swap confirmed. You received ≈ 312.40 USDC. View transaction ↗"*
  - Revoke (approval/automation): *"Access revoked. SparkPoint's AI can no longer act on your behalf. You sign everything from here."* / *"Approval revoked."*
- **Receipt anatomy:** result summary (tabular) · **tx hash + explorer link** · **link back to the originating recommendation** ("From: 'Move idle USDC into the Aave Yield Vault' →" → `/strategies/[recId]`) when `recId` present · **"See it in your portfolio" / "View in activity"** (the Outcome Log entry just created/linked, `05` §8; `spec.md` FR-039). Toast mirror (`Sonner`): "Deposit confirmed · View tx ↗" (`07` §3.6).

**G. Failure / retry (on-chain revert or submission failure)**
- After a *signed* tx fails on-chain or fails to submit: a sober `Alert` (destructive) — *"The transaction didn't go through. {plain reason if known, e.g. 'the price moved past your slippage cap'}. Your funds are safe and untouched. [Try again]"* (`07` §3.1, §6.1 — never blame, never raw tech, always fund-safety reassurance). "Try again" re-runs simulation (state A) before re-offering Sign. The failure is logged to `/activity` honestly (`05` §8) if it was an acted-on recommendation.

**H. User rejected the signature (wallet declined / timed out)**
- Neutral, non-error: **"You cancelled the signature. Nothing moved."** (`07` §3, "Transaction rejected by user"). Return to the ready-to-sign state (B/C) so they can sign or cancel; **no side effects** (`spec.md` FR-024). Wallet timeout = same neutral framing + "Open wallet" / "Try again".

**I. Simulation error (couldn't simulate)**
- *"We couldn't simulate this right now — we won't ask you to sign blind. Your funds are safe. [Retry] · [Verify on explorer]"* (`05` §7.5; `07` §6.1). **Sign stays disabled.** Never offer a "sign without simulation" path.

**J. Degraded mode / withdraw-protection**
- Backend/agent or RPC degraded (`01` §6; `05` §0.3): a banner *"Some SparkPoint services are degraded — your custody and exit are unaffected."* For **non-withdraw** intents, simulation may be unavailable → state I (no blind sign). For **withdraw** intents, the surface **elevates the escape hatch**: *"You can still withdraw on-chain — here's how"* → `/trust/exit` Path B (the no-frontend redeem), per `05` §4.3. **A degraded confirm surface never blocks the withdraw-always path.**

**K. Not-found / expired `txIntent`**
- Invalid/expired `txIntentId`: *"This transaction request has expired. Start again from where you were."* + a route back to the originating surface (vault/strategy/chat). No partial/blind state. (`01` per-route `not-found`.)

**L. Caps near-limit (warn, not block)**
- If the deposit is **near** (not over) a cap, an **amber** caps row + ack ("I understand I'm near my beta cap — $X of $Y used") and a caps meter (`04` §6.5; `05` §3.4) inline; sign gated on the ack. Distinguish clearly from the **at-cap block** (state D).

**M. Kill-switch active (pause-only) during a *new-deployment* intent**
- If the multisig has paused new deployments (`05` §3.5): a **deposit/rebalance** intent shows *"New deposits are paused right now. Withdrawals are never paused."* — the action is **blocked** (state D, but framed as paused-not-failed) with a route to the escape hatch and "notify me when deposits reopen". A **withdraw** intent is **unaffected** and proceeds normally.

---

## 8. Approval-management screen (`/trust/permissions` allowance audit) — this flow's standing-permission surface

> The full permissions panel/page lives in `05` §2.3. This flow owns the **allowance-management interaction** because every revoke routes through `/confirm`.

- **Where:** the **Allowance audit** block of `/trust/permissions` (reached from the prove-it panel, the confirm surface's "Manage approvals" link, or `⌘K`). Mirrors **Revoke.cash** framing (`05` §2.3, §6; `09` §5).
- **Anatomy:** a `Table` of the user's standing ERC-20 approvals — token · spender (plain name + mono address + explorer) · **approved amount (exact / Unlimited — Unlimited flagged amber)** · last used · **[Revoke approval]** per row.
- **Revoke = a signed tx through `/confirm`.** "Revoke approval" builds a `txIntent` → this confirm surface (state B/E/F), with the empowering success string *"Approval revoked."* (`07` §3.3 — revoke copy is positive, the user exercising control; `04` §11 destructive-but-empowering).
- **States:** default (approvals listed) · **none** ("No standing approvals — you'll approve exactly what's needed, when needed.") · loading (`Skeleton` rows) · read-error (last-known + "limits are enforced on-chain, not by this app" + retry + self-verify, `05` §2.4) · post-revoke (row updates to "Revoked").
- **Trust note:** Unlimited approvals are surfaced here as the primary thing to clean up; the screen nudges toward exact without shaming.

---

## 9. Non-custody & trust touchpoints (this flow)

This surface **is** the trust gate — the place where "AI proposes — guardrails + you dispose — and the protocol never holds your money" stops being a slogan and becomes a click.

- **Persistent shell (`01` §2; `05` §1):** the non-custodial **badge → prove-it panel** and the **AI disclaimer strip with [Prove it] / [Exit anytime]** are present on the focused confirm shell — exit and "what we can/can't do" stay ≤1 tap away even mid-sign.
- **"AI suggestion — you approve & sign" banner (`05` §5; `07` §2.1):** verbatim, on every confirm surface. The user is signing *their* action, not approving the AI's authority.
- **Simulation-before-signature, always (`spec.md` SC-002):** no blind signing; "We won't ask you to sign blind" on sim failure.
- **Guardrail checklist made literal (`05` §7; brief §5):** the deterministic policy's checks are *shown* (caps, vault cap, slippage, allowlist, policy, simulation) — proof the AI was wrapped before the human signs.
- **Friction-as-safety (Rabby, `09` §5):** Sign disabled until alerts acknowledged; **blocks cannot be overridden** — friction shown as protection, not punishment.
- **Performance-fee honesty (`07` §5.2):** "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal" rendered explicitly so "net" is provable, not promised.
- **Provable receipt (`05` §8):** success terminates in a **tx hash + explorer link** and links back to the **originating recommendation** + the **Outcome Log** entry (wins *and* losses recorded honestly).
- **Withdraw-always is never gated here (`spec.md` FR-026, SC-003; `05` §4):** caps and the kill-switch can block *new deposits* on this surface but can **never** block a withdrawal; a degraded confirm surface elevates the on-chain no-frontend exit. **Withdrawals never hit a cap/pause block by construction.**
- **Approvals safety (Revoke.cash/Rabby):** exact-by-default, unlimited flagged + acknowledged, standing approvals manageable/revocable.
- **Cancelling is free (`07` §3):** "Nothing moves until you sign. You can cancel now with no effect." — no dark-pattern friction on leaving.

---

## 10. shadcn/ui mapping (this flow)

| Confirm element | shadcn/ui primitive(s) |
|---|---|
| Confirm surface (full route) | `Card` (+ `CardHeader/Content/Footer`) in the focused shell |
| Confirm surface (overlay from chat/panel) | `Dialog` (desktop) / `Sheet` (mobile bottom) + scrim (`04` §5) |
| AI-suggestion banner | `Alert` (spark-subtle) / `Badge` (icon) |
| Headline | `text-h2` + prose |
| Simulation status banner | `Alert` — `success` / `warning` / `destructive` variants |
| Balance-change table (Tenderly-style) | `Table` (right-aligned tabular; +/− semantic colored; gas row; shares row) |
| Approvals (exact/unlimited) | `Card` + `RadioGroup`/`ToggleGroup` + `Badge` (amber caution on Unlimited) |
| Bundle / multi-step preview | `Accordion`/stepper + per-step `Table`; progress stepper during sequential signing |
| Cost & outcome (gas, profit-only performance fee — 10% of yield, 0% on principal, projected) | `Card` + `Tooltip`/`Popover` (breakdown) |
| Guardrail checklist | list rows + semantic Lucide icons (`check`/`alert-triangle`/`slash`/`lock`) + `Tooltip` (literacy) |
| Acknowledgement checkboxes (warns) | `Checkbox` per warn, inside the amber `Alert` |
| Caps meter (near-limit) | styled `Progress` (`04` §6.5) |
| Control reminder | `text-sm muted` |
| Primary Sign CTA (gated) | `Button variant="default"` (spark) `disabled` + `aria-disabled` + `Tooltip` (disabled reason) |
| Edit / Cancel | `Button variant="outline"/"ghost"` |
| Final-sign extra-confirm (if used) | `AlertDialog` (sober, not scary) |
| Power-user "Details" (raw deltas / events / calldata / addresses) | `Accordion` + `Table` + copy `Button` (mono) + explorer-link `Button` |
| Signing / pending | spark "thinking" affordance + tx-hash chip (mono) + progress stepper (bundles) |
| Success receipt | `Card` + `--success` check (`04` §7) + tx/explorer link + "From: {rec}" link + "View in portfolio/activity" |
| Failure / sim-error / rejected | `Alert` (destructive/neutral) + "Try again"/"Open wallet"/"Retry" `Button` |
| Toast mirrors | `Sonner` ("Deposit confirmed · View tx ↗", "Signature cancelled") |
| Approval-management (allowance audit) | `Table` + `Badge` (Unlimited=amber) + "Revoke approval" `Button` → `/confirm` |
| Degraded / escape-hatch elevation | `Alert` (warning) + link to `/trust/exit` Path B |
| Not-found / expired txIntent | `not-found` `Card` + route-back `Button` |

---

## 11. Benchmarks honored (this flow)

| Pattern | Benchmark (canonical link in `09`) | How we apply it |
|---|---|---|
| Pre-trade **simulation / transaction preview**: asset & balance changes → USD, accurate gas, predicted revert with human-readable reason, approval footprint, decoded events/calldata; two-panel layout; **bundled simulations** per step | **Tenderly — transaction preview (★★★)** `09` §5 | The balance-change table, cost/gas block, "simulation passed/blocked" banner, power-user details, and the approve→swap→deposit bundle preview |
| **Sign disabled until alerts acknowledged**; flag risky/unlimited approvals; risk framed as protection; "process the alert before signing" | **Rabby (★★★)** `09` §5 | The acknowledgement model (§6): specific ack checkboxes, gated Sign, no-override blocks, exact-vs-unlimited approval flagging |
| Net-of-fees figure with breakdown; **never projected APY** | **Yearn / Beefy / Morpho (★★/★★★)** `09` §3 | "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal", net result, projected $ estimate clearly labeled "Estimates, not guarantees." |
| Caps / remaining-capacity legibility | **Morpho/Gauntlet, Yearn, Beefy (★★/★★★)** `09` §3 | Caps guardrail rows + near-cap amber meter; at-cap block with withdraw-unaffected reassurance |
| **Allowance audit + per-row revoke** | **Revoke.cash** `09` §5 (`05` §2.3, §6) | The approval-management screen; revoke routed through `/confirm` |
| **Batched/bundled execution + session-key scope** as a signed action | **ERC-4337 / EIP-7702 (★★)** `09` §6 | One-signature bundles where supported; the automation **grant** confirmed here with full scope shown |
| Calm self-custody framing at the money moment | **Ledger / Trust Wallet** `09` (trust) | "Nothing moves until you sign"; cancel-is-free; withdraw-always elevated in degraded mode |

---

## 12. Acceptance criteria (Flow 6 — Execution Confirmation & Simulation)

A design satisfies this flow doc when **all** hold:

1. **Both breakpoints, full-fidelity.** The confirm surface is designed at **1440px desktop** (two-pane: what-happens / decision rail) and **390px mobile** (single column + sticky bottom sign bar; overlay = bottom `Sheet`), and the inline chat mirror references this surface (≤2 actions + "Open full confirmation").
2. **All states designed.** Simulating(loading) · success-passed(ready) · warning(acknowledge-before-sign) · blocked(no-override) · signing/pending(incl. bundle stepper) · success/receipt · failure/retry · user-rejected · simulation-error · degraded/withdraw-protection · not-found/expired · caps-near-limit · kill-switch-active(deposit) — each with on-spec copy from `07` §3.
3. **Single confirm funnel.** Deposit, withdraw, swap, accepted strategy, ERC-20 approval, automation grant, and revoke all route here via a `txIntent`; **no bespoke per-flow sign UI** exists (`01` §0.3; SC-001).
4. **No blind signing.** A pre-trade **simulation precedes 100% of signature requests**; "Simulating…" and "couldn't simulate — won't sign blind" gate the Sign; there is **no path to sign an unsimulated or failed-simulation action** (FR-021/023; SC-002; `05` §7.5).
5. **Tenderly-style preview complete.** The surface shows a **balance-change table** (assets in/out + native gas, token + USD, signed/colored, tabular), **approvals** (exact default, **unlimited flagged**), **gas + performance fee (10% of yield, profit-only, HWM — 0% on principal) + net + projected outcome** (estimate-framed), and a power-user details disclosure (raw deltas/events/calldata/addresses in mono with explorer links).
6. **Guardrail checklist present and literal.** Within-beta-cap · within-vault-cap · slippage-under-max · allowlisted-protocol · policy-approved · simulation-passed each render with pass/warn/block state (icon + text, never color-alone) and a "what's this?" tooltip; the banner and checklist agree.
7. **Friction model correct (Rabby).** Warns → **specific** ack checkboxes; **Sign disabled** (keyboard-focusable, `aria-disabled`, actionable helper/counter) until **all** acks checked; **blocks make Sign impossible** with a **remedy, never an override**; friction **scales to severity** (all-pass = one deliberate sign, no ceremonial acks) (`05` §7; SC-001).
8. **Approvals safety.** Exact amount is the **default** selection; Unlimited is **flagged amber + requires an ack**; spender is plain-language + allowlisted-only; pre-existing approvals are reused (approve step dropped); a "manage approvals" path exists.
9. **Bundled multi-step preview.** Compound actions (approve→swap→deposit) show an ordered, **per-step simulated** bundle; the signature model (one batched sig vs enumerated sequential sigs) is stated up front and reflected in the signing stepper; a block on any step blocks the bundle with the offending step named.
10. **Honest costs & yield.** "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal" explicit; gas in USD + native (tabular); any projected outcome is a **labeled $ estimate** with **"Estimates, not guarantees."**; **no projected APY**, no return-led framing (`07` §5; `00` non-goals).
11. **Provable receipt + outcome loop.** Success terminates in a **tx hash + explorer link**, links back to the **originating recommendation** (when `recId` present), and to the **Outcome Log** entry it creates/updates — wins and losses recorded honestly (FR-039–041; SC-010; `05` §8).
12. **Withdraw-always never gated.** Caps/kill-switch can **block new deposits** here (with withdraw-unaffected reassurance) but can **never** block a withdrawal; a **degraded** confirm surface elevates the on-chain no-frontend exit (`/trust/exit` Path B); no failure on this surface removes the ≤1-tap exit (FR-026, SC-003; `05` §4).
13. **Trust motifs verbatim & non-custody reachable.** "AI suggestion — you approve & sign" banner; "Nothing moves until you sign. You can cancel now with no effect."; "Simulation passed — no risks detected"; the shell's non-custodial badge → prove-it and a withdraw/exit path remain ≤1 tap from the surface; cancelling is neutral and free.
14. **Maps to shadcn + accessible.** Every element resolves to the §10 map; one spark primary (Sign) per view; **visible 2px spark focus ring**; the **entire sign flow is keyboard-completable**, with Sign focusable-but-disabled until acks (announced via `aria-disabled` + helper, not color alone); balance/PnL/share/gas never color-only (sign + icon + label); all financials tabular; mono for addresses/hashes/calldata; reduced-motion honored (success check & blocked shake degrade to opacity/state); `Dialog`→`Sheet` on mobile.

---

## 13. Cross-references

- **Shell, the `(app)/confirm/[txIntentId]` route, the single-confirm-funnel rule (§0.3), per-route `loading`/`error`/`not-found`/degraded requirements, the "acceptance writes the Outcome Log" rule, entry-point/gating matrices:** `01-information-architecture.md` (§0, §1, §2, §4, §6).
- **Tokens, spark = AI presence/primary CTA, semantic + risk palettes, balance/share/PnL/gas formatting, caps meter, success-check & blocked-shake motion, scrim/elevation for the focused sign moment, a11y incl. "Sign focusable-but-disabled until acks", the Tenderly-style confirmation row in the component map:** `04-design-system.md` (§2, §3, §5, §6.5, §7, §10, §11).
- **The authoritative friction/acknowledge-before-sign model, the "AI suggestion — you approve & sign" labeling system, caps semantics, pause-only kill-switch, the allowance-audit/revoke framing, and the Outcome Log this surface writes to:** `05-trust-and-safety-ux.md` (§2.3, §3.4, §3.5, §4, §5, §6, §7, §8).
- **All canonical wording — the confirmation/signing copy pattern, button verbs ("Review & sign" → "Sign deposit/withdrawal/transaction"), success/error/warning/rejected strings, number/PnL/APY/shares formatting, banned/required phrases:** `07-content-and-tone.md` (§2.2, §2.4, §3, §5, §9) — **wins on any conflict.**
- **The surfaces that route into `/confirm`:** Chat `ActionCard`/`ConfirmationCard` mirror (`02-flows/02-chat-assistant.md`); Strategy "Review this move" (`02-flows/04-strategy-recommendations.md`); Vault deposit/withdraw (`02-flows/05-vault-deposit-withdraw.md`); Automation grant (Automation supporting doc).
- **Benchmark links (Tenderly, Rabby, Revoke.cash, Yearn/Beefy/Morpho/Gauntlet, ERC-4337/7702):** `09-references.md` (§3, §5, §6).
- **Requirements traced:** FR-008 (policy gate before sign), FR-021 (pre-trade simulation), FR-022 (per-action signature), FR-023 (block on predicted revert/over-slippage), FR-024 (no submit on decline/reject), FR-025 (block over-cap before signing), FR-026 (pause-only never blocks withdrawals), FR-027 (allowlist only), FR-039–041 (outcome-log linkage); SC-001 (100% user-signed), SC-002 (100% simulated before sign), SC-003 (withdraw-always incl. kill-switch), SC-009 (cap-breaching deposits blocked, withdrawals unaffected), SC-010 (outcome entries).
