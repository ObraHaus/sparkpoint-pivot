# 02 · Flow 9 — AI Swap (conversational ETH→USDC via Aerodrome, with transparent routing fee)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-level spec for **Flow 9 (AI Swap)** — the conversational, AI-routed token swap (launch scope: **ETH → USDC on Aerodrome, Base**), faithful to the original SparkPoint hub demo's AI-swap proposal, **extended** with the transparent **SparkPoint routing fee (~20 bps)** that is launch revenue. **Production-ready, desktop + mobile equal priority, all states.**
> **What this surface IS:** the **end-to-end swap experience** — (a) entry from chat ("swap ETH for USDC") or from a portfolio/asset action; (b) the **assistant swap-proposal card** (best route via Aerodrome, slippage protection, "you could then deposit to the vault"); (c) the **swap Preview/confirmation**, which **reuses the single confirmation funnel** (`/confirm/[txIntentId]`, Flow 6 — authoritative) with the **balance-change table (ETH out / USDC in)**, expected output + **min received (slippage)**, gas, **simulation status**, the **guardrail checklist**, AND a transparent **"SparkPoint routing fee 0.20% = $X"** line item (+ a **"first N swaps free"** state); (d) signing/pending; (e) success (done message + explorer link + a **"deposit this USDC into the vault?" chaining card**); and (f) failure / revert / slippage-exceeded states. It also specs the optional, visible **"how it works" architecture trace** (intent → policy → Tenderly sim → Aerodrome → outcome log) as a trust/education element.
> **What this surface is NOT:** it does **not** re-implement the sign gate — it **routes into** the shared `/confirm` surface (Flow 6). It does not redefine the chat surface internals (`02-flows/02`), the portfolio rows that link in (`02-flows/03`), the vault deposit it chains to (`02-flows/05`), or the design tokens / canonical strings (`04` / `07`). It is **net-new vs the old hub demo** in exactly one substantive way: the **explicit, honestly-surfaced routing fee** (a *usage* fee, never a custody fee), taken **inside the user-signed swap**.
>
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money"), the five non-custody guarantees, tone, non-goals (no return-led surfaces, no hype). Base only; assets USDC + ETH; Aerodrome swaps.
> - `01-information-architecture.md` — Chat is the hub (`/chat`); **all state changes funnel through `/confirm/[txIntentId]`** (§0.3, §4.2.3); the persistent shell (badge + AI disclaimer strip with [Prove it]/[Exit anytime]); per-route `loading`/`error`/`degraded` requirements.
> - **`02-flows/06-execution-confirmation-simulation.md` — AUTHORITATIVE for the Preview/confirm surface this flow routes into** (two-pane desktop / sticky-sign-bar mobile; balance-change table; guardrail checklist; the friction/acknowledge-before-sign model; signing/pending/success/failure states; the power-user "Details" disclosure). This doc specifies only the **swap-specific** content that surface renders (the ETH→USDC deltas, slippage rows, and the routing-fee line item) and the swap's entry + chaining.
> - `02-flows/02-chat-assistant.md` — the `ActionCard` (swap intent), the inline `ConfirmationCard` mirror, the **tool-step ticker** (intent classification made visible), suggested-prompt chips, the per-turn disclaimer.
> - `02-flows/05-vault-deposit-withdraw.md` — the **chaining target**: after a swap to USDC, "deposit this USDC into the vault?" stages a deposit (`SharesPreview`, `NetApyBreakdown`, caps) → `/confirm`.
> - `04-design-system.md` — tokens (spark = AI presence / primary CTA; strict semantic green/red/amber; risk palette §2.5; **tabular numerals** §3.1/§3.4; **mono** for addresses/hashes/calldata; balance/PnL formatting §3.4; motion incl. success check & blocked shake §7; a11y §10; component→shadcn map §11).
> - `05-trust-and-safety-ux.md` — the **friction-as-safety** model (§7), the **"AI suggestion — you approve & sign"** labeling (§5), the Outcome Log this swap writes to (§8), withdraw-always invariants (§4).
> - `06-component-library.md` — `ActionCard` (§8), `ConfirmationCard` (§9), `GuardrailChecklist` (§13), `SimulationBalanceChangeTable` (§23), `AlertBanner` (§25), `NetApyBreakdown` (§16), `SharesPreview` (§17), `AiSuggestionBadge`, `CitationChip`.
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Especially §2.2 (button verbs: "Review this move" → "Review swap" → "Sign transaction"), §2.4 (confirm/sign copy pattern), §3 (success/error/warning strings), §5 (number/PnL/slippage/fee formatting), §9 (banned/required phrases).
> - `docs/revenue-model/README.md` — **§3 Stream 0A (Aerodrome swap-routing fee).** The fee is **20 bps (15–30 bps governance range)**, **taken inside the user-signed swap** (a fee leg / recipient in the Aerodrome route), **shown explicitly pre-sign**, **never on vault flows or principal**, with a **"first N swaps free"** trust option. This doc renders that requirement honestly in the UI.
> - `09-references.md` — Tenderly (pre-trade sim ★★★), Rabby (sign-disabled-until-acknowledged ★★★), Hey Anon / Griffain (conversational DeFi-by-chat), Aerodrome (the Base liquidity venue).

---

## 0. The swap thesis (constraints on every screen in this flow)

This flow is the product's **first money-out-of-wallet action that is a *swap*** (vs a vault deposit/withdraw) and the **first surface that charges a fee**. Both facts make the trust bar high. Constraints binding every screen:

1. **Conversational first, faithful to the hub demo.** A user types a goal ("swap ETH for USDC") and the assistant **classifies the intent as `swap`**, proposes the **best route on Base (Aerodrome, highest liquidity)** with **slippage protection built in**, and offers to **preview** — exactly the original hub flow. The card is a *proposal*, never an execution.
2. **One sign gate, no bespoke swap signing UI (`01` §0.3; `06`).** The swap Preview/confirmation **is** the shared `/confirm/[txIntentId]` surface (Flow 6). This flow builds a `txIntent` and routes there; it does **not** ship its own sign experience. The inline chat `ConfirmationCard` is a *mirror* with "Open full confirmation."
3. **Nothing is signed unsimulated (`06` §0.2).** A **Tenderly-style pre-trade simulation** of the exact swap calldata **always** precedes the signature — expected output, **min received** at the slippage cap, gas, and the predicted balance deltas. "Simulating…" gates the gate. No blind signing, ever.
4. **The fee is honestly surfaced, never hidden (revenue-model §3 / §4 constraint 2 & 4; `07` §9).** The **"SparkPoint routing fee: 0.20% = $X"** is an **explicit line item in the Preview/confirmation**, shown **before the user signs**, framed as a **usage fee on a service you chose** (executing a swap) — **not** a custody fee, **not** a vault/principal fee. When the user is within their **first N free swaps**, the line item reads **"$0.00 (first {n} swaps free)"** with the original fee struck through, so the value is still visible. A swap that hides or mis-frames the fee fails review.
5. **Slippage protection is a guardrail, made literal.** The route carries a **max slippage**; the Preview shows **expected output** and the **minimum received** at that cap, and the guardrail checklist has a **"✓ Slippage under your max ({x}%)"** row. If the simulated price impact would breach the cap, the swap is **blocked** with a remedy (raise the cap / reduce size), never an override.
6. **AI proposes — guardrails + you dispose (`05` §5).** The verbatim **"AI suggestion — you approve & sign"** label is on the proposal card and the confirm banner; the control reminder **"Nothing moves until you sign. You can cancel now with no effect."** is always present. The AI never has the final word.
7. **It chains, honestly (hub demo).** After a successful ETH→USDC swap, the assistant offers to **put that USDC to work** — a follow-up **"Deposit this USDC into the vault?"** chaining card (or "Supply to Aave"). The offer is a *suggestion* that itself routes back through `/confirm`; it never auto-deposits.
8. **Custody and exit are never gated by this flow (`05` §4).** Swapping is optional and additive; it never touches the **withdraw-always** path. The shell's [Exit anytime] stays ≤1 tap away throughout. The routing fee mechanism never impairs the escape hatch.
9. **Fact-only, sober tone (`07` §1.3, §2.4).** No persuasion, no "great rate!", no urgency. Plain proposal → preview → costs (incl. the fee) → guardrails → control reminder → sign. Success may have **one** `--success` check-draw beat — never confetti.
10. **Launch reality.** Base only; the launch swap is **ETH → USDC via Aerodrome** (highest liquidity, slippage-protected route). The reverse and other Base pairs are designed as the same anatomy but the live default is ETH→USDC. Beta caps apply to the *resulting* deposit if the user chains into the vault, **not** to the swap itself (swaps are not vault flows).

---

## 1. Goal & entry points

### 1.1 Goal

Let a user **swap ETH for USDC conversationally** — the AI finds the best Base route (Aerodrome), explains it plainly with slippage protection, and previews it — then **route the user through the shared sign gate** where they see **exactly what leaves and arrives** (ETH out / USDC in), **what it costs (gas + the transparent routing fee)**, **how slippage protects them (expected vs minimum received)**, and **the guardrails it passed** — and let them **sign deliberately** (or cancel freely). On success, **prove it** (explorer link + receipt) and **chain forward** ("deposit this USDC into the vault?"). A newcomer should feel *safe and never surprised by a fee*; a power user should be able to *verify the route, the min-received math, the fee leg, and the calldata*.

The one-sentence job: **turn "swap ETH for USDC" into an AI-proposed, slippage-protected, fee-transparent, guardrail-checked, user-signed Aerodrome swap — then offer to put the USDC to work — with zero blind signing and zero hidden cost.**

### 1.2 Entry points

| From | Trigger | What happens |
|---|---|---|
| **Chat — natural language** (`/chat`, `02`) | User types "swap ETH for USDC", "convert my ETH to stablecoins", "I want USDC", etc. | Assistant **classifies intent → `swap`**, runs the tool-step ticker (read wallet → find route → check slippage), and renders the **swap-proposal `ActionCard`** (§3). Primary "Review swap" → `/confirm` via a swap `txIntent`. |
| **Chat — suggested-prompt chip** (`02` §6) | Chip e.g. "Swap ETH → USDC" | Same as above; chip **sends** for the unambiguous intent. |
| **Portfolio / asset action** (`02-flows/03` `PositionRow`) | An ETH holding's **"Swap"** action (row action or overflow `DropdownMenu`) | Opens chat primed with the swap intent **and** the asset/amount staged → renders the swap-proposal card with the amount pre-filled. (Mirrors the row's "Ask AI" pattern, but for swap.) |
| **Asset detail** (`/portfolio/positions/[id]`) | "Swap this for USDC" | Stages the position's balance into a swap intent → proposal card. |
| **Vault deposit, insufficient USDC** (`02-flows/05`) | User wants to deposit but holds ETH, not USDC | The deposit surface offers **"Swap ETH → USDC first?"** → this flow → then **chains back** to the staged deposit (§7). |
| **Chaining back from a prior swap** (§7) | Post-swap "Deposit this USDC into the vault?" declined, then reconsidered | The chaining card persists in-thread; re-openable. |

> **The swap `txIntent` always routes to `/confirm/[txIntentId]` (`01` §4.2.3).** There is no separate swap-sign route. An expired/invalid `txIntentId` → the `not-found` state (Flow 6 §7.K).

### 1.3 Pre-conditions & what's decided upstream

By the time a swap proposal renders:
- **Intent is classified `swap`** by the assistant (Hermes agent), and the **deterministic policy layer has already filtered** it (`spec.md` FR-008) — only **allowlisted venues (Aerodrome)** and in-policy routes can produce a swap `txIntent`. The user **never sees a signable out-of-policy swap**.
- **Asset/amount** are set (typed, or staged from a portfolio/asset entry). The proposal card lets the user **edit the amount inline** (re-quotes the route), but composition happens here, not on the confirm surface.
- **Wallet connected + Base + whitelist + geo** handled at the app boundary (`01` §6). A regress mid-flow shows the relevant gated render; **withdraw-always stays reachable**.
- **Fee state** (within first-N-free vs standard 20 bps) is known from the user's swap history and rendered honestly (§4, §6).

---

## 2. The flow at a glance (happy path, both breakpoints)

```
Chat: "swap ETH for USDC"
      │
      ▼
[Tool-step ticker]  Reading your wallet… → Finding the best route on Base… → Checking slippage…
      │
      ▼
[Swap-proposal ActionCard]  ETH → USDC via Aerodrome · slippage-protected · "you could then deposit to the vault"
      │  "Review swap"  (builds swap txIntent)            "Not now"
      ▼
[/confirm/[txIntentId] — the shared sign gate (Flow 6), swap-shaped]
   • Headline: "You're swapping 0.1 ETH for ≈ 312.40 USDC on Aerodrome."
   • Simulation status banner (green / amber / red)
   • Balance-change table: − 0.1 ETH out · + ≈312.40 USDC in · − gas
   • Expected output + Minimum received (at max slippage)
   • Cost & outcome: gas · SparkPoint routing fee 0.20% = $X (or "first N free") · net USDC received
   • Guardrail checklist: route allowlisted (Aerodrome) · slippage under max · policy · simulation
   • [optional] "How it works" architecture trace (intent → policy → Tenderly → Aerodrome → log)
   • Control reminder → Sign (gated)
      │  sign
      ▼
[Signing / pending]  Waiting for signature → Submitting → Confirming on Base… (tx hash appears)
      │
      ▼
[Success receipt]  "Swap confirmed. You received ≈ 312.40 USDC. View transaction ↗"
      │
      ▼
[Chaining card]  "Deposit this USDC into the Aave Yield Vault?"  → /confirm (deposit)   ·  "Supply to Aave"  ·  "Not now"
```

Failure branches (each specced in §8): user-rejected · slippage-exceeded (block or post-sign revert) · on-chain revert · simulation error · degraded mode.

---

## 3. The swap-proposal card (`ActionCard`, swap variant) — faithful to the hub demo

The assistant's proposal renders as the `ActionCard` swap variant (`06` §8; `02` §7.2) inline in chat. It is an **intent preview**, not an execution. **≤2 footer actions.**

### 3.1 Anatomy

| Part | Content | Rules / shadcn |
|---|---|---|
| **Ai-suggestion badge** | Verbatim **"AI suggestion — you approve & sign"** | Never shortened (`07` §2.1). Spark-tinted `Badge`. |
| **Header** | Action label **"Swap"** + the pair chip **ETH → USDC** | `Badge` (action type) + pair glyph. |
| **Route line (the hub-demo proposal)** | **"Best swap route on Base: ETH → USDC via Aerodrome (highest liquidity). Slippage protection is built into the route."** | Plain, sober (`07` §1.3). "Aerodrome" carries a `CitationChip` ("Based on Aerodrome liquidity · {ts}"). |
| **Amount (editable)** | "Swap **{0.1} ETH**" — inline-editable `Input` (token); editing **re-quotes** the route (loading → updated output). | `Input` + `.tnum`. Helper: "You hold {balance} ETH." Editing never executes in-card. |
| **Estimated result** | **"You'd receive ≈ {312.40} USDC"** + price-impact + **max slippage** (labeled estimate). | `.tnum`; "≈" + "estimate". Slippage shown as "Max slippage {0.5}%". |
| **Routing-fee preview (transparent)** | A quiet line: **"Includes a SparkPoint routing fee of 0.20% (≈ ${X}). Shown in full before you sign."** — or, if eligible, **"Your first {n} swaps are free — no routing fee on this one."** | Honest pre-disclosure so the fee is **not** a surprise at confirm. `text-sm muted`; struck-through fee on the free state. |
| **Chaining hint (the hub-demo offer)** | **"USDC you can then deposit into the vault or supply to Aave."** | One quiet line; the *actual* offer appears post-success (§7). Sets expectation early. |
| **Footer (≤2)** | primary **"Review swap"** (→ `/confirm` via swap `txIntent`; `07` §2.2 — never "Swap now"/"Do it") · secondary **"Not now"** | `Button` ×2. Primary is the one spark element. |

### 3.2 States (proposal card)

| State | Treatment | Copy |
|---|---|---|
| **Loading** (routing) | Skeleton on output/fee/slippage; route line + amount render immediately (known). Tool-step ticker above ("Finding the best route on Base…"). Never `0` as placeholder. | — |
| **Default** | Full proposal; "Review swap" enabled. | As §3.1. |
| **Re-quoting** (amount edited) | Output/fee/min-received skeleton briefly; primary disabled until re-quote resolves. | "Updating the route…" |
| **Warning** (elevated slippage / large size) | Caution `AlertBanner` in card: heads-up that the route's expected slippage is near the max; the **ack happens at `/confirm`**, not here. Primary still routes to confirm (which gates the sign). | "Heads up: this size may move the price near your slippage cap. You'll be asked to acknowledge before signing." |
| **Blocked** (route unavailable / would breach max slippage / not allowlisted) | Destructive `AlertBanner`; **no primary "Review swap"** — only a remedy. | "Blocked by your guardrails: this swap would move the price past your slippage cap. Reduce the amount or raise your cap to continue." |
| **Error** (quote failed) | "Couldn't load a route right now. Your funds are safe. Try again." + retry; input retained. | `07` §6.1. |

> **Trust note:** the proposal card never signs and never hides the fee — it *pre-discloses* it. The authoritative fee, min-received, and guardrail checks are re-derived live at `/confirm`.

---

## 4. The routing fee — honest surfacing (the net-new requirement)

The **SparkPoint routing fee** is launch revenue (revenue-model Stream 0A) and **must be surfaced honestly, never hidden** (`07` §9.1 bans hidden/misleading fees; revenue-model §4 constraints 2 & 4). It is a **usage fee on a swap you chose**, **taken inside the user-signed swap** (a fee leg/recipient in the Aerodrome route) — **non-custodial by construction**, and it **never touches the vault or principal**.

### 4.1 Where the fee appears (every place, consistently)

1. **Proposal card (pre-disclosure, §3.1):** "Includes a SparkPoint routing fee of 0.20% (≈ ${X})…" so the fee is known *before* the user even opens the preview.
2. **Preview/confirmation — Cost & outcome block (authoritative, §6):** an **explicit line item**:
   **"SparkPoint routing fee · 0.20% · ${X}"** with an **ⓘ** affordance → "A usage fee for routing this swap. It's taken inside this swap — SparkPoint never holds your funds. It never applies to the vault or your deposits."
3. **Balance-change table (§6):** the fee is reflected in the **net USDC received** (and, in the power-user "Details," shown as its own fee-leg delta so the math reconciles).
4. **Success receipt (§7):** the confirmed receipt re-states the fee paid ("Routing fee: ${X}") so it's provable after the fact, with the on-chain tx as proof.

### 4.2 Fee states

| State | Treatment | Copy (canonical pattern) |
|---|---|---|
| **Standard fee** | Line item shown with rate + USD; reflected in net. | **"SparkPoint routing fee · 0.20% · $0.62"** |
| **First-N-free** | Rate struck through; value `$0.00`; a quiet eligibility note + remaining count. The original value stays **visible** (struck) so the user sees what they'd otherwise pay. | **"SparkPoint routing fee · ~~0.20% ($0.62)~~ · $0.00 — first {n} swaps free ({k} left)"** |
| **Last free swap** | Same as free, with a gentle, non-pushy note that the next swap carries the standard fee. | "This is your last free swap. Future swaps include a 0.20% routing fee, always shown before you sign." |
| **Governance band note (optional ⓘ)** | The ⓘ explainer may note the fee is a set rate within a published range. | "Routing fee is 0.20% (set within a published 0.15–0.30% range)." |
| **Fee unavailable to compute** (quote partial) | Never show a confident wrong fee; show en-dash + "fee shown before you sign" and **disable Sign** until the sim resolves the exact fee. | "Routing fee · — (calculated at simulation)" |

### 4.3 Fee honesty rules (acceptance-bearing)

- The fee is **always itemized** (rate **and** USD), **always pre-sign**, **never** folded silently into "output."
- The fee is **framed as a usage fee**, **never** as a custody, vault, deposit, withdrawal, management, or yield fee.
- The line item is **never** styled as a loss/alarm (it's a sober cost row, `--muted-foreground` label + `.tnum` value), and **never** styled as spark (it's not a CTA).
- The free state **still shows the value the user is not paying** (struck), so "free" is provable, not vague.
- **Vault flows show "SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal"** (Flow 6; a deposit confirm shows $0.00) — this swap routing fee must never bleed into the vault confirm. The two are distinct and both honest.

---

## 5. Layout — desktop vs mobile (this flow's two surfaces)

This flow renders across **two surfaces**, each already specced at both breakpoints elsewhere; here we note the swap-specific layout.

### 5.1 The proposal (in chat) — `04`/`02` breakpoints

- **Desktop (1440px):** the swap `ActionCard` sits inline in the chat column (~560–620px), with portfolio/snapshot side panels untouched. Tool-step ticker resolves above it.
- **Mobile (390px):** full-width card in the single chat column; amount `Input` is ≥44px; the chaining hint wraps to its own line; "Review swap" is a full-width primary.

### 5.2 The Preview/confirmation — reuses Flow 6 (`06` §2)

The swap confirm **is** the Flow 6 surface; the swap-specific content slots into its named regions:

```
DESKTOP /confirm/[txIntentId] (two-pane, from 06 §2.1)
┌──────────────────────────────────────────────┬───────────────────────────────────┐
│ LEFT — WHAT HAPPENS                            │ RIGHT — DECISION RAIL              │
│ ◦ Headline: "You're swapping 0.1 ETH for       │ ┌ GUARDRAIL CHECKLIST ──────────┐ │
│   ≈ 312.40 USDC on Aerodrome."                  │ │ ✓ Route allowlisted (Aerodrome)│ │
│   [AI suggestion — you approve & sign]          │ │ ✓ Slippage under your max (0.5%)│ │
│ ◦ Simulation status: ✅ passed (or amber/red)  │ │ ✓ Policy approved              │ │
│ ◦ BALANCE-CHANGE TABLE                          │ │ ✓ Simulation passed            │ │
│   Asset   Dir   Amount      USD                 │ └────────────────────────────────┘ │
│   ETH     −out  0.1000     −$500.00             │ ┌ COST & OUTCOME ───────────────┐ │
│   USDC    +in   312.40     +$312.40             │ │ Expected output  ≈ 312.40 USDC │ │
│   ETH gas −out  0.000018   −$0.05               │ │ Minimum received 310.84 USDC   │ │
│ ◦ Expected vs Minimum received (slippage)       │ │   (at 0.5% max slippage)       │ │
│ ◦ [How it works ▾] architecture trace (§9)      │ │ Network fee ≈ $0.05 (gas)       │ │
│                                                 │ │ SparkPoint routing fee 0.20% $X│ │
│                                                 │ │ Net USDC received  ≈ 311.78    │ │
│                                                 │ └────────────────────────────────┘ │
│                                                 │ ◦ CONTROL REMINDER · ACTIONS       │
│                                                 │ [ Review & sign ] (spark, gated)   │
│                                                 │ [ Edit ] [ Cancel ]                │
└──────────────────────────────────────────────┴───────────────────────────────────┘
```

```
MOBILE /confirm (single column + sticky sign bar, from 06 §2.2)
┌───────────────────────────────┐
│ ● Non-custodial · Base · ✕     │
│ AI suggestion—approve&sign ▾   │
├───────────────────────────────┤
│ Swap 0.1 ETH → ≈ 312.40 USDC   │
│ via Aerodrome                  │
├───────────────────────────────┤
│ ✅ Simulation passed           │
├───────────────────────────────┤
│ BALANCE CHANGES                │
│ ETH   − 0.1000   −$500.00      │
│ USDC  + 312.40   +$312.40      │
│ gas   − 0.000018 −$0.05        │
├───────────────────────────────┤
│ Expected ≈ 312.40 USDC         │
│ Min received 310.84 (0.5% cap) │
│ Routing fee 0.20% · $X         │
│ Net ≈ 311.78 USDC              │
├───────────────────────────────┤
│ GUARDRAILS ✓✓✓✓                │
│ [How it works ▾]               │
│ "Nothing moves until you sign" │
├───────────────────────────────┤
│ ▟ [Review & sign] (spark) · ✕  │
└───────────────────────────────┘
```

- The **expected vs minimum-received** pair is the slippage story made legible — both `.tnum`, the minimum carrying the cap ("at {x}% max slippage").
- The **routing-fee line** sits in **Cost & outcome** (right rail desktop / inline mobile), reflected in **Net USDC received**.
- The **"How it works" trace** is a collapsed disclosure (left column desktop / inline accordion mobile), default-collapsed (§9).
- All Flow 6 **responsive transform rules carry** (two-pane → stacked; right-rail Sign → sticky bottom bar; Dialog → bottom Sheet when opened as an overlay from chat).

---

## 6. The Preview/confirmation content (swap-specific) — what Flow 6 renders for a swap

The shared confirm surface (Flow 6 §3) is authoritative for anatomy/states; below is the **swap-specific** content for each region.

| Region (Flow 6) | Swap content |
|---|---|
| **AI-suggestion banner** | Verbatim "AI suggestion — you approve & sign." |
| **Headline** | **"You're swapping {0.1} ETH for ≈ {312.40} USDC on Aerodrome."** (What + amount + venue in one sentence; `.tnum`; never lead with a gain.) |
| **Simulation status banner** | green "Simulation passed — no risks detected" / amber (elevated slippage, near cap, stale price) / red (would breach max slippage, route reverts) — see §8. |
| **Balance-change table** (`SimulationBalanceChangeTable`, `06` §3 / `23`) | Rows: **ETH − out** (`--loss` direction) · **USDC + in** (`--gain` direction) · **ETH gas − out**. Token + USD, signed/colored, true minus `−` (U+2212), right-aligned tabular. In the power-user "Details," the **routing-fee leg** appears as its own delta so net reconciles. |
| **Expected vs minimum received** | **"Expected output ≈ {312.40} USDC"** and **"Minimum received {310.84} USDC (at {0.5}% max slippage)"** — the slippage protection, made explicit. The minimum is what's guaranteed-or-revert. |
| **Approvals** | **ETH is native — no ERC-20 approval needed** for ETH→USDC, so the approvals section is typically **absent**. (For a future ERC-20→USDC swap it would render exact-by-default with unlimited flagged, per Flow 6 §4.) If the route requires wrapping, show it as a bundle step (`06` §3-bis). |
| **Cost & outcome** | **Network fee (gas)** ≈ $ (+ native) · **SparkPoint routing fee · 0.20% · ${X}** (or first-N-free state, §4) with the ⓘ usage-fee explainer · **Net USDC received ≈ {value}**. **No projected APY here** (this is a swap, not a yield surface); if the user is on the deposit-chain path, the *vault's* net APY appears later, on the deposit confirm. |
| **Guardrail checklist** (`GuardrailChecklist`, `06` §3 / `13`) | **"✓ Route allowlisted (Aerodrome)"** · **"✓ Slippage under your max ({0.5}%)"** · **"✓ Policy approved"** · **"✓ Simulation passed"**. Each with a "what's this?" `Tooltip`. (Caps rows are **absent** — caps apply to vault deposits, not swaps; this is itself an honesty signal.) Warn rows carry the specific ack (§8). |
| **Control reminder** | Verbatim "Nothing moves until you sign. You can cancel now with no effect." |
| **Sign CTA (gated)** | "Review & sign" → after any acks, **"Sign transaction"** (`07` §2.2). Disabled (keyboard-focusable, `aria-disabled`, helper) until acks checked + sim passed; **impossible** when blocked. |
| **Power-user "Details"** | raw deltas (incl. the fee leg) · decoded Aerodrome swap event · calldata (mono) · router + fee-recipient addresses (mono, copy + explorer). Lets a skeptic reconcile the min-received and the fee. |

> **Microcopy (reuse verbatim, `07`):** "AI suggestion — you approve & sign"; "Simulation passed — no risks detected"; "Nothing moves until you sign. You can cancel now with no effect."; "Minimum received {x} USDC (at {y}% max slippage)"; the fee line + ⓘ explainer (§4.1); the success/error strings in §8.

---

## 7. Success + the chaining card ("deposit this USDC into the vault?")

### 7.1 Success receipt (swap)

Reuses Flow 6 §7.F (plain, specific, non-celebratory; one `--success` check-draw beat — never confetti):

- **Done message:** **"Swap confirmed. You received ≈ {312.40} USDC. View transaction ↗"**
- **Receipt anatomy:** result summary (`.tnum`) · **tx hash + explorer link** (mono) · **routing fee paid: ${X}** (or "first-N-free — $0.00 fee") re-stated for provability · **link back to the originating chat turn / portfolio entry** · **"See it in your portfolio"** (the USDC now in-wallet) · Outcome Log entry written (`05` §8). Toast mirror (`Sonner`): "Swap confirmed · View tx ↗".

### 7.2 The chaining card (the hub-demo "put it to work" offer)

Immediately under the success receipt, the assistant offers to **chain** — faithful to the hub demo ("after a swap to USDC, the assistant offers to deposit that USDC into the vault or supply to Aave"). This is an **`ActionCard` (deposit variant)**, a *suggestion*, not an auto-action.

**Anatomy:**
- **Ai-suggestion badge** (verbatim).
- **Header:** "Put your USDC to work?"
- **Body:** **"You now hold ≈ {312.40} USDC. You could deposit it into the Aave Yield Vault and start earning — {X}% net APY (estimate · see breakdown). Withdraw anytime."** (`NetApyBreakdown`, never bare; "Estimates, not guarantees."). A `SharesPreview` line: "Deposit ≈ 312 USDC → receive ≈ {shares} spvUSDC."
- **Caps preview:** a `CapsMeter` ("Beta cap: ${used} of ${cap}") — **this is where caps re-enter**, because the deposit *is* a vault flow.
- **Footer (≤2):** primary **"Review deposit"** (→ `/confirm` via a **deposit** `txIntent`; full deposit confirm shows **"SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal"**, $0.00 on this deposit, `06`) · secondary **"Supply to Aave"** (alternate target, allowlisted) — with **"Not now"** available as a quiet dismiss (keeps the USDC in-wallet, no penalty).

**States:** loading (APY/shares skeleton) · default · **above-cap** (the deposit would exceed the beta cap → blocked at the deposit confirm, with the swap already done and the USDC safely in-wallet; the card says "Your USDC is in your wallet. Depositing the full amount would exceed your beta cap — deposit less, or hold." — **the swap success is never retroactively undone**) · "Not now" dismiss (collapses; re-openable from the thread).

> **Trust note (critical):** chaining is **two separate signed actions** — the swap (done) and the deposit (a fresh `txIntent` → its own sign). The UI must **never** imply the deposit happened as part of the swap, and the swap's success stands on its own regardless of whether the user chains. The deposit confirm carries **0% on principal** (the vault's profit-only performance fee shows $0.00 on a deposit), distinct from the swap's routing fee — both shown honestly.

---

## 8. States (the full swap lifecycle)

Each designed at **both breakpoints** with copy from `07`. The Preview/confirm states defer to Flow 6 §7; below are the **swap-specific** renderings.

**A. Proposal — loading / routing**
- Tool-step ticker ("Reading your wallet…" → "Finding the best route on Base…" → "Checking slippage…", `02` §5.3); proposal card skeletons on output/fee/min-received. Sign not reachable (no `txIntent` yet).

**B. Proposal — default / re-quoting**
- Full proposal; editing the amount re-quotes (skeleton on output/fee). "Review swap" builds the `txIntent` → `/confirm`.

**C. Preview — simulating (loading)** *(Flow 6 §7.A)*
- "Simulating…" banner; skeleton balance-change table + cost block; **the routing-fee line shows "— (calculated at simulation)"** until resolved; Sign disabled. Headline renders immediately (known from the `txIntent`).

**D. Preview — passed (ready to sign)** *(Flow 6 §7.B)*
- Green banner; full ETH−/USDC+ table; expected + minimum received; gas + **routing fee (explicit)** + net; all guardrail rows ✓; Sign enabled (one deliberate action).

**E. Preview — warning (acknowledge-before-sign)** *(Flow 6 §7.C; `05` §7)*
- **Elevated slippage:** amber banner + a **specific ack**: **"I understand the price could move and I might receive as little as {310.84} USDC."** Sign disabled until checked. (Also covers near-cap on the *chained deposit*, stale price, large size.) Counter "Acknowledge 1 of 1 to continue."

**F. Preview — blocked (slippage would be exceeded / route not allowlisted)** *(Flow 6 §7.D; `05` §7.2)*
- Red banner + the offending guardrail row(s); **Sign never enables**; remedy only: **"Reduce amount" / "Raise slippage cap" / "Edit"**. Copy: **"Blocked by your guardrails: this swap would move the price past your {0.5}% slippage cap. Reduce the amount or raise your cap to continue."** Brief shake on a blocked sign attempt (`04` §7). **No override.**

**G. Signing / pending** *(Flow 6 §7.E)*
- "Waiting for your signature in your wallet…" → "Submitting your transaction…" → "Confirming on Base…" with the tx hash (mono, copy + explorer) on broadcast. ETH→USDC is a **single signature** (native ETH, no approval) — no bundle stepper unless the route requires a wrap step (then enumerate it up front). "Open wallet" / "Cancel" until broadcast.

**H. Success — confirmed (receipt + chaining)** *(§7)*
- "Swap confirmed. You received ≈ {312.40} USDC. View transaction ↗" + routing-fee-paid re-statement + explorer + "See it in your portfolio" + the **chaining card** (§7.2). Outcome Log written.

**I. Slippage-exceeded at execution (post-sign revert)** — the swap-critical failure
- If the price moved past the cap **between sign and inclusion**, the tx reverts **by design** (the min-received guard fired). Sober destructive `AlertBanner`: **"Prices moved more than your slippage cap, so the swap was stopped to protect you. Nothing moved — your ETH is untouched. You can raise your cap or try again."** (`07` §6.1 "slippage exceeded" + custody reassurance). "Try again" re-runs simulation (state C) before re-offering Sign. Logged honestly to `/activity`.

**J. On-chain revert / submission failure** *(Flow 6 §7.G)*
- "The swap didn't go through, so nothing moved. {plain reason if known}. Your funds are safe and untouched. [Try again]." Never blame, never raw revert strings (raw available in "Details"). Logged.

**K. User rejected the signature** *(Flow 6 §7.H)*
- Neutral: **"You cancelled the signature. Nothing moved."** Return to ready-to-sign (D/E); no side effects; **no fee charged** (the fee only exists inside a signed, included swap).

**L. Simulation error (couldn't simulate)** *(Flow 6 §7.I)*
- "We couldn't simulate this swap right now — we won't ask you to sign blind. Your funds are safe. [Retry] · [Verify on explorer]." Sign stays disabled. Never a "sign without simulation" path.

**M. Degraded mode** *(Flow 6 §7.J; `05` §0.3)*
- Banner: "Some SparkPoint services are degraded — your custody and exit are unaffected." Swap simulation may be unavailable → state L (no blind sign). The swap is **optional**, so degraded mode simply defers it; **withdraw-always stays elevated and reachable**.

**N. Not-found / expired swap `txIntent`** *(Flow 6 §7.K)*
- "This swap request has expired. Start again from chat." + route back to `/chat` (the originating thread). Quotes are short-lived; expiry is expected and framed neutrally.

**O. Insufficient ETH (for amount + gas)**
- Proposal/preview surfaces a plain helper: "You don't have enough ETH to swap {amount} and cover gas. Try a smaller amount." — a remedy, not an error wall; "Use max" affordance offered (leaves a gas buffer).

---

## 9. The optional "How it works" architecture trace (trust/education)

A **collapsed, opt-in disclosure** on the swap Preview (and re-openable from the success receipt) that shows the **real path** the swap takes — the hub demo's trust/education element, made honest. Default-collapsed (never forced on a newcomer); one tap to expand (`00` §3 progressive disclosure). It is **descriptive, not interactive** — it explains, it does not add steps.

### 9.1 The SWAP path (rendered as an ordered, plain-language trace)

```
[How it works ▾]   The SWAP path — what actually happens when you sign

①  You (chat)            "swap ETH for USDC"
②  Hermes Agent          classifies intent → swap
③  Policy Layer          validates: Aerodrome whitelisted · within execution limits · slippage ≤ your max
④  Tenderly              simulates the swap calldata → expected output, min received, gas, no revert
⑤  Your wallet           you sign the UserOp  ← nothing moves before this
⑥  EntryPoint (ERC-4337) bundles the signed UserOp
⑦  SparkPointAccount     PolicyModule check passes (allowlist + caps + slippage)
⑧  Aerodrome             swaps ETH → USDC (routing fee leg taken inside this swap)
⑨  Outcome Log (Postgres) records the result — win or loss, tied to this swap
```

- **Each node = one plain row** (icon + label + one-line plain gloss). Step ⑤ carries the spark **"you sign"** affordance and the note **"nothing moves before this"** — the trace visually centers the user's signature as the hinge.
- **Step ③ (Policy Layer)** names the exact guardrails (allowlist, execution limits, slippage) — it mirrors the guardrail checklist, reinforcing that the deterministic layer wrapped the AI *before* the human signs.
- **Step ⑧ (Aerodrome)** is where the **routing fee leg** is annotated — "the SparkPoint routing fee is taken here, inside your signed swap," reinforcing §4's non-custodial framing.
- **Step ⑨ (Outcome Log)** links to `/activity` — the accountability loop.

### 9.2 Treatment

- **shadcn:** `Accordion` (collapsed by default) containing a vertical `Stepper`/ordered list; semantic Lucide icons per node; mono for any contract names/addresses shown; a `Tooltip` "what's this?" on the technical nodes (EntryPoint, SparkPointAccount, PolicyModule) for literacy.
- **Color discipline:** this is **education/info** — use `--info`/neutral framing, **not** green (it's not a "gain") and **not** spark except on the "you sign" hinge (AI/CTA presence). Never alarmist.
- **Both breakpoints:** desktop = left column under the slippage rows; mobile = an inline `Accordion` above the sticky sign bar. Reduced-motion: no animated draw; instant expand.
- **Honesty:** the trace shows the *real* services (no faked steps); if a step is skipped (e.g., no approval needed for native ETH), it is **not** shown as happening. The trace must match what the simulation and guardrail checklist say.

---

## 10. Non-custody, fee-transparency & trust touchpoints (this flow)

- **AI proposes, you dispose:** the proposal card and confirm banner carry the verbatim **"AI suggestion — you approve & sign"**; acceptance is never one-click — it **always** routes to the sign gate (`05` §5; `07` §9.1).
- **One sign gate, no blind signing:** the swap reuses `/confirm` (Flow 6); a **Tenderly-style simulation precedes 100%** of swap signatures; "Simulating…" and "couldn't simulate — won't sign blind" gate the Sign (`spec.md` SC-002).
- **Slippage protection is visible and enforced:** expected **and** minimum-received are shown; the guardrail row + the on-chain min-received guard mean a price move past the cap **reverts to protect the user** (state I) — friction shown as protection.
- **Fee transparency (the net-new trust bar):** the routing fee is **itemized, pre-sign, USD + rate, framed as a usage fee**, never hidden, never mis-labeled as custody/vault; the **first-N-free** state still shows the value not charged; the receipt re-states the fee paid; **vault flows carry the distinct profit-only performance fee (10% of yield, HWM — 0% on principal)** and are clearly separate from the routing fee (`07` §9.1; revenue-model §4).
- **Non-custodial by construction:** the fee is taken **inside the user's own signed swap** (a fee leg/recipient) — SparkPoint never holds, moves, or withholds funds; the "How it works" trace makes this literal (step ⑧).
- **The architecture trace = provable, not promised:** the optional trace shows the real intent → policy → Tenderly → Aerodrome → Outcome Log path, centered on the user's signature; it educates without persuading.
- **Provable receipt + outcome loop:** success terminates in a **tx hash + explorer link**, writes the **Outcome Log** entry, and links back to the originating chat turn — wins and losses recorded honestly (`05` §8).
- **Withdraw-always never gated:** swapping is additive and optional; nothing here touches the escape hatch; [Exit anytime] stays ≤1 tap away; a failed/degraded swap never blocks withdrawal.
- **Cancelling is free, and rejecting costs nothing:** "Nothing moves until you sign. You can cancel now with no effect." — and a rejected signature charges **no fee** (state K).

---

## 11. shadcn/ui mapping (this flow)

| Element | shadcn/ui primitive(s) |
|---|---|
| Swap-proposal card | `ActionCard` = `Card` + `Badge` (action + AiSuggestion) + `Input` (editable amount) + `CitationChip` + `Button` ×2 |
| Tool-step ticker (intent → swap) | custom step list + spark dot (`04` §7); `Skeleton` for pending fields |
| Routing-fee pre-disclosure (card) | `text-sm muted` line; struck-through value on first-N-free |
| Preview/confirmation (the sign gate) | **Flow 6** `ConfirmationCard` = `Card`/`Dialog`/`Sheet` (overlay from chat) |
| Simulation status banner | `AlertBanner` (`Alert` success/warning/destructive) |
| Balance-change table (ETH−/USDC+/gas) | `SimulationBalanceChangeTable` (`Table`, `.tnum`, semantic +/−, true minus) |
| Expected vs minimum received | labeled rows (`.tnum`) in Cost & outcome |
| Routing-fee line item + ⓘ explainer | row (`.tnum`) + `Tooltip`/`Popover` (usage-fee explainer) |
| Guardrail checklist (route/slippage/policy/sim) | `GuardrailChecklist` = list rows + Lucide icons + `Tooltip` + `Checkbox` (warn-acks) |
| Acknowledgement (elevated slippage) | `Checkbox` inside the amber `Alert` |
| "How it works" architecture trace | `Accordion` (collapsed) + `Stepper`/ordered list + Lucide icons + `Tooltip` + mono addresses |
| Control reminder | `text-sm muted` |
| Sign CTA (gated) | `Button variant="default"` (spark) `disabled` + `aria-disabled` + `Tooltip` |
| Edit / Cancel | `Button variant="outline"/"ghost"` |
| Signing / pending | spark "thinking" affordance + tx-hash chip (mono) |
| Success receipt | `Card` + `--success` check + tx/explorer link + fee-paid re-statement + "See in portfolio" |
| Chaining card ("deposit this USDC?") | `ActionCard` (deposit) = `Card` + `NetApyBreakdown` + `SharesPreview` + `CapsMeter` + `Button` ×2 → `/confirm` (deposit, 0% on principal; profit-only performance fee shows $0.00 on deposit) |
| Slippage-exceeded / revert / sim-error | `AlertBanner` (destructive/neutral) + "Try again"/"Open wallet"/"Retry" |
| Toast mirrors | `Sonner` ("Swap confirmed · View tx ↗", "Signature cancelled") |
| Power-user "Details" (deltas / fee leg / calldata / addresses) | `Accordion` + `Table` + copy `Button` (mono) + explorer-link `Button` |

---

## 12. Acceptance criteria (Flow 9 — AI Swap)

A design satisfies this flow doc when **all** hold:

1. **Faithful to the hub demo.** A typed "swap ETH for USDC" classifies intent → `swap` (visible tool-step), yields an Aerodrome **best-route** proposal card with **slippage protection** and the **"you could then deposit to the vault"** hint, and a **"Review swap"** that routes to the sign gate — matching the original hub flow's conversational shape.
2. **Both breakpoints, all states.** Proposal (loading/default/re-quoting/warning/blocked/error) and Preview (simulating/passed/warning/blocked/signing/success/slippage-exceeded/revert/rejected/sim-error/degraded/not-found/insufficient-ETH) are each designed at **1440px desktop** and **390px mobile**, with copy from `07`.
3. **Single confirm funnel — no bespoke swap sign UI.** The swap builds a `txIntent` and routes to **`/confirm/[txIntentId]` (Flow 6)**; the in-chat `ConfirmationCard` is a mirror with "Open full confirmation"; there is **no separate swap signing experience** (`01` §0.3).
4. **No blind signing.** A **Tenderly-style pre-trade simulation** of the swap precedes the signature; "Simulating…" and "couldn't simulate — won't sign blind" gate Sign; there is **no path to sign an unsimulated swap** (SC-002).
5. **Balance-change + slippage complete.** The Preview shows the **ETH out / USDC in (+ gas)** balance-change table (token + USD, signed/colored, tabular, true minus), plus **expected output** and **minimum received at the max-slippage cap** as explicit, distinct figures.
6. **Routing fee surfaced honestly (the net-new requirement).** The **"SparkPoint routing fee · 0.20% · $X"** line item is present, **pre-sign**, **itemized (rate + USD)**, **framed as a usage fee** (ⓘ explainer: taken inside the swap, never custody, never the vault), and **reflected in net USDC received**; the **first-N-free** state shows `$0.00` with the struck original value and remaining count; the receipt re-states the fee paid. The fee is **never** hidden, never mis-labeled, never styled as a CTA or an alarm.
7. **Routing fee distinct from the vault performance fee.** Nothing in this flow implies a fee on principal or custody; the **chained deposit confirm shows the vault's profit-only performance fee ("10% of yield, HWM — 0% on your principal", $0.00 on a deposit)** (Flow 6), clearly separate from the swap's routing fee.
8. **Guardrail checklist correct for a swap.** Rows: **route allowlisted (Aerodrome) · slippage under max · policy approved · simulation passed**, each color + icon + text with a "what's this?" tooltip; **caps rows are absent** (swaps aren't vault flows) — and this is itself honest; a price move past the cap **blocks** (no override) or **reverts to protect** (post-sign), with a remedy.
9. **Friction scales to severity (Rabby).** All-pass swaps are one deliberate sign; **elevated slippage** produces a **specific ack** ("I understand I might receive as little as {x} USDC") that gates Sign; **blocks** are uncheckable with a remedy, never an override.
10. **Chaining is honest and separate.** On success, a **"Deposit this USDC into the vault?"** chaining card (deposit variant, `NetApyBreakdown` + `SharesPreview` + caps) offers to put the USDC to work via a **fresh deposit `txIntent` → `/confirm`** (and a "Supply to Aave" alternate); the swap success stands alone; the deposit is never implied to be part of the swap; "Not now" is free.
11. **"How it works" trace present and truthful.** An optional, default-collapsed **intent → policy → Tenderly sim → Aerodrome → Outcome Log** trace renders the real path, centers the user's signature ("nothing moves before this"), annotates the fee leg at Aerodrome, uses info/neutral (not green, not alarm), and matches the simulation + checklist (no faked steps).
12. **Provable receipt + outcome loop.** Success terminates in a **tx hash + explorer link**, writes the **Outcome Log** entry, links back to the originating chat turn, and re-states the fee paid — wins and losses logged honestly (`05` §8; FR-039–041).
13. **Trust motifs verbatim & non-custody reachable.** "AI suggestion — you approve & sign"; "Nothing moves until you sign. You can cancel now with no effect."; "Simulation passed — no risks detected"; the shell's non-custodial badge → prove-it and a withdraw/exit path remain ≤1 tap from every screen in this flow; a rejected signature charges **no fee** and has no side effects.
14. **Maps to shadcn + accessible.** Every element resolves to §11; one spark primary (Sign/Review swap) per view; visible 2px spark focus ring; the whole swap flow is keyboard-completable with Sign focusable-but-disabled until acks; financials tabular; mono for addresses/hashes/calldata/the fee-recipient; semantic state always color + icon + text; reduced-motion honored (success check & blocked shake degrade); `Dialog`→`Sheet` on mobile.

---

## 13. Cross-references

- **The sign gate this flow routes into (authoritative for the Preview/confirm anatomy + states):** `02-flows/06-execution-confirmation-simulation.md` (§2 layout, §3 anatomy, §5 simulation banner, §6 friction model, §7 states).
- **The chat surface, the swap `ActionCard`, the inline `ConfirmationCard` mirror, tool-step ticker, suggested-prompt chips:** `02-flows/02-chat-assistant.md` (§5.3, §7.2, §7.6).
- **The chaining target (vault deposit, `SharesPreview`, `NetApyBreakdown`, caps, 0% on principal + profit-only performance fee):** `02-flows/05-vault-deposit-withdraw.md`.
- **The portfolio/asset entry point ("Swap" row action):** `02-flows/03-portfolio.md` (`PositionRow`).
- **Components:** `ActionCard` (`06` §8), `ConfirmationCard` (`06` §9), `GuardrailChecklist` (`06` §13), `SimulationBalanceChangeTable` (`06` §23), `AlertBanner` (`06` §25), `NetApyBreakdown` (`06` §16), `SharesPreview` (`06` §17), `CapsMeter` (`06` §14), `AiSuggestionBadge`/`CitationChip` (`06` §6/§7).
- **Tokens, spark = AI presence/CTA, semantic palette, tabular numerals, mono, motion, a11y, component→shadcn map:** `04-design-system.md` (§2, §3, §7, §10, §11).
- **Friction-as-safety, "AI suggestion — you approve & sign" labeling, Outcome Log, withdraw-always:** `05-trust-and-safety-ux.md` (§4, §5, §7, §8).
- **Canonical wording — button verbs, confirm/sign pattern, success/error/warning strings, number/PnL/slippage/fee formatting, banned/required phrases:** `07-content-and-tone.md` (§2.2, §2.4, §3, §5, §6.1, §9) — **wins on any conflict.**
- **The routing-fee requirement (rate, range, "first N swaps free," usage-fee framing, non-custodial mechanics, vault-flows-excluded):** `docs/revenue-model/README.md` (§3 Stream 0A; §4 constraints; §5.2.0 spec-FR note).
- **Benchmarks:** Tenderly (pre-trade sim), Rabby (sign-disabled-until-acknowledged), Hey Anon / Griffain (conversational DeFi), Aerodrome (Base venue) — `09-references.md` (§1, §5).
- **Requirements traced:** FR-008 (policy gate before sign), FR-020 (Aerodrome swaps), FR-021 (pre-trade simulation), FR-022 (per-action signature), FR-023 (block on predicted revert / over-slippage), FR-024 (no submit on decline/reject), FR-027 (allowlist only), the **new swap-fee FR** (revenue-model §5.2.0 — fee + mandatory pre-sign disclosure + "first N free" + vault-flows excluded), FR-039–041 (outcome-log linkage); SC-001 (100% user-signed), SC-002 (100% simulated before sign).
