# 02 · Flow 12 — Multi-Network + Bridge (the network switcher, the Base ↔ Sui Bridge, and the bridge sign gate)

> **Audience:** Claude Design (high-fidelity screen production) and the build team (Next.js App Router + TailwindCSS + shadcn/ui + Recharts + Lucide).
> **Status:** Authoritative screen-level spec for **Flow 12 (Multi-Network + Bridge)** — the client-directed multi-network increment. W1–2 "Live Wireframe & UI/UX Finalization" milestone — production-ready, high-fidelity, **desktop + mobile equal priority**, all states.
>
> **Client-directed scope/principle amendment (logged, not silent):** the original handover docs (00–08) scoped the product **"Base only"** and listed cross-chain as **out of scope**. The client later directed the product to be **MULTI-NETWORK** — **Base at launch (live), Sui as the designated fast-follow** — with a **persistent network switcher** in the authenticated shell and a dedicated **Bridge** surface (`#/bridge`, Base ↔ Sui). This note **supersedes "Base-only at launch"** for network scope (`docs/INCREMENT-multi-network.md`; `docs/DESIGN-UPDATE-HANDOFF.md`). **Networks beyond Base + Sui remain OUT OF SCOPE.** This flow specs the **product / UX / non-custody** level only.
> **Critical discipline (client-directed, logged):** **Sui is NON-EVM (Move-based)** — it does **not** use ERC-4337 / ERC-4626 / Solidity. This doc must **not fabricate a Sui contract spec or a concrete bridge route**. The **Sui-side account/vault architecture** AND the **bridge mechanism/provider/route-selection** are explicitly **flagged as a separate follow-on increment to be designed**. The existing **Base/EVM contract spec stays intact**.
> **Terminology (client-mandated):** the canonical user-facing trust term is **"fully self-custodial"** (it replaces "non-custodial" in user-facing copy and the persistent trust badge). "Non-custodial / self-custodial" remain accurate **technical** descriptors in architecture text.
>
> **Reads-before (and defers to, in order):**
> - `00-brief.md` — positioning, thesis ("AI proposes — deterministic guardrails + you dispose — and the protocol never holds your money"), the non-custody guarantees, tone, non-goals.
> - `01-information-architecture.md` — §1 the route `(app)/bridge` (`#/bridge`) + the shell **network switcher** + wallet pill (§2 shell anatomy, the `[◆ Network: Base ▾]` element + the network-switcher row); §3 nav (Bridge in secondary nav + ⌘K); §4 flow graph; §6 gating/degraded; the per-route `loading.tsx` / `error.tsx` requirement.
> - `04-design-system.md` — tokens (**CLIENT-DIRECTED BRAND: cobalt blue + gold + coral, signature blue→cyan→gold→coral gradient, deep indigo-navy base**; the old orange "spark" accent is **STALE**); risk palette **violet→magenta** §2.5; **tabular numerals** §3.1/§3.4; **Geist Sans + Geist Mono** §3; **mono** for addresses/hashes/calldata; caps meter §6.5; motion §7; a11y §10; shadcn map §11. `tokens.css` is the **source of truth** for token values.
> - `05-trust-and-safety-ux.md` — §1 persistent proof affordances; §2 prove-it; §3.3 caps semantics (now **per-network / per-bridge**); §3.4 pause-only kill-switch; **§4 the escape-hatch / withdraw-always — canonical `/trust/exit`** (now invariant on **every network**); §7 the friction/acknowledge-before-sign model the bridge sign gate enforces.
> - `07-content-and-tone.md` — **canonical wording wins on any conflict.** Especially §2.2 (button verbs: "Review bridge" → "Sign bridge"; never "Send"/"Transfer now"), §2.4 (confirmation/signing copy), §3 (success/error/warning strings), §5 (number/amount formatting), §7 (trust copy), §9 (banned/required phrases).
> - `02-flows/06-execution-confirmation-simulation.md` — **the single shared sign gate (Flow 6) and its `confirm/bridge` variant (§3-ter)** — this flow **routes into** it and does **not** re-implement it.
> - `02-flows/02-chat-assistant.md` — **§7.2-bis the chat Bridge `ActionCard`** and **§7.6 the in-chat inline confirm** — this flow's chat bridge intent **defers to** those.
> - `09-references.md` — §5 simulation/sign gate (Tenderly / Rabby); bridge-UX patterns (named in §9).
>
> **What this doc IS:** the **multi-network shell control** (the persistent network switcher: Base/Sui, active indicator, per-network wallet address); the **Bridge surface** (`#/bridge`): asset picker (USDC/ETH), from/to network selectors with a **flip** control, amount + max, route/fee/ETA preview, and a **"how custody is preserved" explainer**; how Bridge **builds a bridge `txIntent` and hands off** to the confirm/bridge sign gate; the **chat bridge intent**; **per-network + per-bridge caps**; the **fully-self-custodial** non-custody touchpoints; every state (default / empty / loading / success / warning / error); desktop **and** mobile; component → shadcn/ui mapping; acceptance criteria.
> **What it is NOT:** visual tokens (`04`), canonical strings (`07`), the route map/shell anatomy (`01` — inherited, not re-specified), **the signing surface itself** (that is **Flow 6 / `#/confirm/bridge`** — every state-changing action here routes there; **no signing happens in this flow**), the chat surface internals (`02`), or the on-chain no-frontend escape hatch (`05` §4 / `/trust/exit` — this doc references, does not re-spec). **It does not define a Sui contract spec or a real bridge route — those are a flagged follow-on increment.** Where copy conflicts with `07`, `07` wins; where scope/tone conflicts with the brief, the brief wins; where it touches the escape hatch, `05` §4 is the source of truth.

---

## 0. Goal, scope, and the one-sentence job

**Job:** Let a whitelisted user **operate across more than one network and move assets between them — fully self-custodially — without ever handing SparkPoint their funds.** Two surfaces carry this: (1) a **persistent network switcher** in the authenticated top bar that makes "which network am I on, and what's my address here?" answerable in one glance and switchable in one tap; and (2) a dedicated **Bridge** surface that takes an asset + amount + a from→to network pair, previews the route/fee/ETA, explains exactly **how custody is preserved in transit**, and **builds a bridge `txIntent`** that runs the **same simulation + guardrail-checklist + you-sign gate** as every deposit, withdraw, and swap. The user **signs a lock/burn on the source network** and **receives funds in their own wallet on the destination network**; **SparkPoint never custodies funds in transit.**

**The one-sentence job:** **turn "I want my USDC on Sui" into a previewed, guardrail-checked, user-signed bridge — out on the source, into your own wallet on the destination — with zero custody in transit and withdraw-always on every network.**

**Hard product/scope facts to encode (`docs/INCREMENT-multi-network.md`; `01` §1/§2; `06` §3-ter):**
- **Multi-network, phased.** The product is **multi-network**: **Base at launch (live)**, **Sui as the designated fast-follow network**. **Both are presented in the design** (Base "Live", Sui "Fast-follow"). **Networks beyond Base + Sui are out of scope** — do **not** render a network marketplace, a "more chains soon" catalog, or any chain the increment doesn't name.
- **Persistent network switcher.** A top-bar control (next to the wallet pill, `01` §2) shows the **active network** (Base / Sui) with an **active-network indicator**, and switching updates the indicator **and the displayed per-network wallet address**, and re-scopes per-network views. **Switching never moves funds and never changes what SparkPoint can / can't do** (`01` §2).
- **Dedicated Bridge surface** (`#/bridge`): asset picker (**USDC / ETH**), **from / to** network selectors with a **flip** control, **amount + Max**, a **route / fee / ETA preview**, and a **"how custody is preserved" explainer**. The CTA **builds a bridge `txIntent` → `#/confirm/bridge`** (Flow 6, §3-ter). **No signing here.**
- **The bridge runs the ONE trust gate.** The **single simulation-backed confirmation + guardrail checklist + you-sign** gate applies to bridge actions **exactly like swaps and deposits** (`06` §0.1, §3-ter). There is **no bespoke bridge sign UI**.
- **FULLY SELF-CUSTODIAL bridging (must hold in the build).** The user **signs a lock/burn on the SOURCE network**; funds are **received in the USER'S OWN wallet on the DESTINATION network**; **SparkPoint NEVER custodies funds in transit.** The design copy states this explicitly — **keep it true.**
- **Withdraw-always (N2) on every network.** The withdraw-always invariant holds on **Base *and* Sui** — a bridge, a destination-network state, or any cap/pause **never** gates the escape hatch (`05` §4). A withdraw `txIntent` on either network is never cap- or pause-blocked. **Proof status (encode honestly):** withdraw-always (N2) and the self-service self-custody exit are **PROVEN today on Base** (ERC-4626 redeem + the prove-it permissions read, backend-independent). On **Sui** they are a **design requirement** that the follow-on Sui (non-EVM / Move) custody increment MUST satisfy before the Sui self-custody claim is treated as demonstrated — the Sui self-service exit path and permissions read are **to-be-designed**. The product **commits to fully-self-custodial parity on Sui**; it is a **commitment pending that increment, not a shipped Base-equivalent proof**. Do not present the Sui withdraw-always / self-custody guarantee as already proven.
- **Per-network + per-bridge caps** are shown in the design and **wire to real policy-layer limits** (`05` §3.3). They are *protective current limits*, never failures (`07` §2.3).
- **No signing here.** Bridge builds the `txIntent` and **hands off**; the route/fee/ETA preview here is a **convenience estimate**, re-simulated authoritatively on `#/confirm/bridge` (`06` §0.2).

**Tone for this flow (`07` §1.3):** sober, capital-preservation-first, control-first. Lead with **custody + where-the-funds-go + the two networks**, then the route economics. No hype, no urgency, no "fast bridging!" theater. Honest about the launch reality (Base live, Sui fast-follow) and about what is a **flagged follow-on** (the Sui-side architecture + the real bridge mechanism). *Movement is shown, never sold.*

> **Scope flag (client-directed, logged — repeated wherever the bridge mechanism could be over-specified):** only the **product / UX / non-custody** level is specified here. The **Sui-side account/vault architecture** (non-EVM / Move-based — **no ERC-4337/4626/Solidity**) and the **bridge mechanism / provider / route-selection** are a **separate follow-on increment to be designed**. The design shows a **single canonical route** and the existing **Base/EVM contract spec stays intact**. **Do not fabricate** a Sui contract spec or a concrete bridge route.

---

## 1. Entry points & exits

### 1.1 Entry points (`01` §3, §4.3)
| From | Lands on |
|---|---|
| **Secondary nav / ⌘K** ("Bridge", `01` §3) | `#/bridge` |
| **Network switcher** (top bar) → "Move assets to {other network}" affordance | `#/bridge` (pre-staged from→to) |
| **Chat bridge intent** (`ActionCard` bridge variant, `02` §7.2-bis: "bridge", "sui", "cross-chain", "move to …") | builds a bridge `txIntent` → **inline confirm/bridge in the thread** (`02` §7.6), **or** "Edit" → `#/bridge` to stage amount/networks first |
| **Portfolio** (a position on a network the user wants to move) — cross-link | `#/bridge` (asset + source network pre-filled) |
| **Notifications** (e.g. "your bridge has arrived on Sui", "per-network cap near limit") | `#/bridge` or the originating activity entry |

### 1.2 Exits (where Bridge sends you)
- **Review bridge →** builds a bridge `txIntent` → **`#/confirm/bridge`** (Flow 6 §3-ter: simulation → balance changes out-on-source / in-on-destination → guardrail checklist → ack-gated sign → "Bridge initiated" success + tracking link). **No sign here.**
- **Chat-initiated →** the same gate renders **inline in the chat thread** (`02` §7.6) — no navigation; "Open full confirmation" deep-links the `#/confirm/bridge` route.
- **Withdraw-always / escape hatch →** **`/trust/exit`** (canonical, `05` §4) — reachable ≤1 tap from the Bridge surface and the shell, **on every network**.
- **Prove-it →** persistent **"Fully self-custodial"** badge → permissions panel (`05` §2); plus an in-context "Who can move these funds in transit? → **No one but you**" affordance in the custody explainer (§4.5).
- **Learn →** "What is a bridge?" / "How is custody preserved?" tip cards → `/learn/[slug]` (`07` §4.3).
- **Ask AI →** "Ask about bridging" → `/chat` primed with the bridge in context (Flow 2).

---

## 2. The persistent network switcher (shell control — inherits `01` §2)

**Purpose:** Make the active network **unmistakable** and switchable in one tap, and make each network's **own wallet address** legible — without ever implying that switching networks (or the act of switching) moves funds or changes custody. This is a **shell-level control present on every `(app)` route**, not a Bridge-only element (`01` §2 the `[◆ Network: Base ▾]` top-bar element). The Bridge surface inherits it; this section specs it because it is the multi-network spine.

### 2.1 Anatomy → shadcn
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Network pill (trigger)** | Top bar, right cluster, **next to the wallet pill**; shows a **network glyph + active network name** (e.g. "◆ Base") and a small caret. **Active-network indicator** = a colored network dot/glyph (Base vs Sui are visually distinct — use the categorical brand-neutral chrome, **not** semantic green/red and **not** the risk palette). | `DropdownMenu` trigger + `Badge` (active network) | `01` §2 (network switcher row) |
| **Network menu** | On tap: a short list of the **two** networks — **Base** (status chip "Live") and **Sui** ("Fast-follow") — each row showing the network name, its **per-network wallet address** (truncated, mono), and an active check on the current one. Selecting a network **switches the active network**. | `DropdownMenu` items + `Badge` (status) + mono address | `01` §2 |
| **Per-network wallet address** | The wallet pill's truncated address re-renders to the **address on the now-active network** (`01` §2 wallet status "per active network"). Each menu row also shows its network's address so the user sees both before switching. | mono (`Geist Mono`) | `01` §2 |
| **"Switching is safe" reassurance** | A persistent micro-line in the menu: **"Switching networks never moves your funds and never changes what SparkPoint can do."** | `text-xs muted` | `01` §2; `07` §7 |
| **"Move assets" affordance** | An optional menu footer action **"Move assets between networks"** → `#/bridge` (pre-stages from = active network). | `DropdownMenu` item → `#/bridge` | §1.1 |

### 2.2 Behavior & invariants
- **Switching re-scopes, never moves.** Selecting a network updates the **active-network indicator**, the **per-network wallet address**, and re-scopes per-network views (balances, positions). It is a **view/context switch** — **no transaction, no signature, no fund movement** (`01` §2). Copy must never imply otherwise.
- **Custody claim is per-active-network.** The **"Fully self-custodial"** badge (`05` §1; `01` §2) asserts non-custody on the **active network**; the prove-it panel reflects the active network's permissions. Withdraw-always is asserted on **whichever** network is active (and on the other — `05` §4 holds everywhere).
- **Wrong-network** (a network outside Base/Sui, or a chain mismatch) surfaces as the shell wrong-network prompt ("Switch to Base or Sui; withdrawals unaffected") — never a dead end; withdraw stays reachable (`01` §6).
- **Honesty about phase.** Base reads **"Live"**; Sui reads **"Fast-follow"** (designated, presented in the design). Do **not** present any third network. If Sui surfaces a "designed, not yet live" affordance, say so plainly rather than faking liveness.

### 2.3 Network-switcher states
- **Default:** active network shown (Base at launch); menu lists Base (Live) + Sui (Fast-follow) with per-network addresses.
- **Switching:** brief pending affordance on the pill + address (skeleton/muted), then re-scoped view; **never a blocking spinner over the whole app**.
- **Loading (address/connection resolving):** muted pulse on the pill (mirrors the badge's connection-resolving state, `05` §1.3); **never `0x…` placeholder garbage** — show a skeleton until the real per-network address resolves.
- **Warning:** wrong-network (amber inline prompt, "Switch to Base or Sui"); stale per-network balance ("as of {time}"). Informational; withdraw never removed.
- **Error:** per-network read failure → last-known address + "couldn't refresh — your funds are safe and untouched"; **switching and withdraw still function** (`07` §6.1; `05` §4).

---

## 3. Shell context & layout model for the Bridge surface (inherits `01` §2)

The Bridge renders **inside the authenticated app shell** — it does **not** define its own. Inherited and always present (do not re-spec, do not omit): the **"Fully self-custodial" badge** → prove-it panel; the **network switcher** (§2); the **wallet / connection status** pill (per active network); the **AI disclaimer strip** (with **[Prove it]** / **[Exit anytime]**); primary nav; secondary nav (with **Bridge** present, and **Withdraw / Exit** pinned); ⌘K; notifications. **Withdraw/exit + prove-it are ≤1 tap from this surface, on every network** (hard IA rule, `01` §0; `05` §1.2).

> **Per-route state files (`01` §1):** `#/bridge` ships `loading.tsx` (skeleton) and `error.tsx` (recoverable + "withdraw is still available on every network" reassurance).

### 3.1 Layout model (both canvases — `04` §4.2)
- **Desktop (1440 design, 1024 min):** a **focused, centered single-purpose card** (≈ 560–640px), like a swap/bridge widget (`09` §9 bridge-UX), under the shell:
  - **Top:** surface title "Bridge" + a one-line custody promise ("Move assets between networks — you stay in control the whole way.").
  - **From block:** **source network selector** + asset picker (USDC/ETH) + the source balance + the **amount input** with **Max**.
  - **Flip control** (centered, between From and To): swaps source ↔ destination in one tap.
  - **To block:** **destination network selector** + the asset (same asset on the destination) + the **estimated amount received**.
  - **Route / fee / ETA preview** (below the To block): canonical route, bridge fee (itemized, if any), source-network gas, est. time-to-arrival.
  - **"How custody is preserved" explainer** (an always-present, expandable trust block).
  - **Per-network / per-bridge caps meter.**
  - **Primary CTA "Review bridge"** + the **"Exit anytime"** withdraw-always link beneath.
- **Mobile (390 design, 360 min):** single column, stacked, same order: title + custody promise → From (network + asset + amount + Max) → flip → To (network + est. received) → route/fee/ETA → custody explainer (collapsible) → caps meter → **bottom-anchored "Review bridge" CTA** → "Exit anytime" link. Network/asset selectors open as **Sheets**; the custody explainer and "why caps?" are **Sheets/Popovers**, not Dialogs. CTA in thumb reach.
- **Responsive transform:** desktop dropdown selectors → mobile **Sheets**; the centered card spans full width with comfortable padding; tooltips → tap-`Popover`; the explainer `HoverCard`/`Accordion` → `Sheet`.

> **Don't over-stuff (progressive disclosure):** the surface shows route/fee/ETA *summaries*; the full route detail, the custody mechanics, and the cap rationale are one tap down via `Accordion`/`Popover`/`Sheet`. **Never** show a multi-route picker (the design shows a single canonical route — the real route-selection is a flagged follow-on, §0).

---

## 4. Section A — The Bridge surface (`#/bridge`)

**Purpose:** Compose a fully-self-custodial cross-network move: pick the **asset**, set **from → to** networks (with a **flip**), enter an **amount** (with **Max**), see an honest **route / fee / ETA preview**, understand **how custody is preserved**, and **build the bridge `txIntent` → `#/confirm/bridge`** (Flow 6). **No signing here** — the preview is a convenience estimate; `#/confirm/bridge` re-simulates authoritatively.

### 4.1 Asset picker (USDC / ETH)
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Asset selector** | The bridgeable asset: **USDC** or **ETH** (the increment's `SP.data.bridgeAssets`). Token glyph + symbol; the same asset is bridged on both sides (USDC→USDC, ETH→ETH). | `DropdownMenu`/`Select` (desktop) / `Sheet` (mobile) + `Badge` | `docs/INCREMENT-multi-network.md` |
| **Per-network balance** | Beneath the asset: "You hold {balance} {asset} on {source network}" (tabular). | `text-xs muted` (`.tnum`) | `07` §5.1 |
| **Asset availability honesty** | If an asset isn't bridgeable on a chosen network, say so plainly and disable it with a reason (never a silent missing option). | helper text + `aria-disabled` | `07` §6.1 |

### 4.2 From / To network selectors + the flip control
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Source (From) network** | Selector defaulting to the **active network** (from the §2 switcher). Options = **Base / Sui** (no third network). Shows the network glyph + name + (status chip Live/Fast-follow). | `DropdownMenu`/`Select` + `Badge` | §2; `01` §2 |
| **Destination (To) network** | The **other** network. Selecting a source auto-sets a sensible destination; both are explicit and editable. Same Base/Sui constraint. | `DropdownMenu`/`Select` + `Badge` | §0 |
| **Flip control** | A centered **flip** button between From and To that **swaps source ↔ destination** (and re-quotes route/fee/ETA). Clear icon (swap-vertical), 44px touch target, visible focus ring. | `Button` (icon, ghost) | `09` §9 (swap/bridge flip idiom) |
| **From → To summary** | A persistent plain-language line: **"{amount} {asset} · {source} → {destination}"** (tabular), so the move is legible at a glance. | text (`.tnum`) | `07` §5.1 |

- **Same-network guard:** From and To can never be the same network — selecting a destination equal to the source flips the source (or disables the duplicate with a reason). The flip is the fast path.

### 4.3 Amount + Max
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Amount input** | The asset amount to bridge; symbol affixed; **tabular**; mobile numeric keypad; validates ≥ min and **≤ min(source balance, per-network remaining cap, per-bridge cap)**. | `Input` (`.tnum`) | `07` §5.1; `04` §3.4 |
| **Max / % chips** | **25% · 50% · Max** quick-fills from the source-network balance, **clamped to the binding cap** (Max = min(balance, per-network remaining, per-bridge remaining); ETH leaves gas headroom on the source). | `Button size=sm` / `ToggleGroup` | `07` §2.3 |
| **Balance + cap helper** | "Balance: {amount} {asset} on {source}" + "Max you can bridge now: {amount} ({binding cap})". | `text-xs muted` (`.tnum`) | `07` §2.3 |

### 4.4 Route / fee / ETA preview
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Route** | The **single canonical route** (the increment shows one route; **no multi-route picker** — real route-selection is a flagged follow-on, §0). Plain: "Route: {source} → {destination} (canonical)." | `Card`/rows + `Badge` (route) | `docs/INCREMENT-multi-network.md`; §0 |
| **Bridge fee** | Itemized, **if any** — rate and/or absolute, tabular, honest ("Bridge fee: {x}"); **never folded into "net"** (`07` §5). If zero/uncomputable until simulation, show an **en-dash** + "(calculated at simulation)", not a fabricated `0`. | rows (`.tnum`) + ⓘ `Popover` | `07` §5; `06` §3-ter |
| **Source-network gas** | "Network fee (gas) on {source}: ≈ ${x}" (estimate-framed). | rows (`.tnum`) | `06` §3-ter |
| **Est. amount received** | "You receive ≈ {amount} {asset} on {destination}" (tabular; estimate-framed). | rows (`.tnum`) | `07` §5.1 |
| **ETA / time-to-arrival** | "Est. arrival: ≈ {time}" — a **labeled estimate** ("Estimates, not guarantees.", `07` §3.3). Never a countdown/urgency device. | `text-xs muted` | `06` §3-ter; `07` §3.3 |

> **Hard rule:** every fee/received/ETA figure is **estimate-framed, tabular, and a convenience preview** here — the authoritative numbers come from the simulation on `#/confirm/bridge` (`06` §0.2). No urgency, no FOMO, no "best route!" theater.

### 4.5 The "how custody is preserved" explainer (the highest-signal trust block)
**Purpose:** Answer "where is my money while it's bridging, and who can touch it?" — **before** the user commits. An **always-present, expandable** block stating the fully-self-custodial mechanics in plain language:
- **The promise (plain, verbatim intent):** **"You'll sign a lock/burn on {source}; the {asset} arrives in your own wallet on {destination}. SparkPoint never holds your funds in transit — fully self-custodial on both networks."** (`02` §7.2-bis; `06` §3-ter).
- **The three legs, plainly:** ① you **sign a lock/burn on the source** (you authorize, nothing moves before your signature); ② the canonical route carries it cross-network; ③ the funds **arrive in your own wallet on the destination** — **not** a SparkPoint-held account.
- **Who can move it in transit? → No one but you.** Micro-affordance → prove-it (`05` §2). Source + destination contract addresses are **linkable to the relevant explorer** on each network (provable, not asserted — `05` §1.1).
- **Withdraw-always note:** "You can withdraw on **either** network at any time — even if SparkPoint is offline." → `/trust/exit` (`05` §4).
- **Honest follow-on flag (light, user-appropriate):** the surface does not over-promise a specific provider; the deep mechanism is being finalized (the **bridge mechanism/provider is a flagged follow-on**, §0) — copy stays at the *what-happens-to-your-money* level, which is **true regardless** of provider.
- **shadcn:** `Card` + `Accordion` (desktop) / `Sheet` (mobile) + `Badge` (network) + explorer links.

### 4.6 Per-network + per-bridge caps (in context)
**Purpose:** Make beta caps **legible and reassuring** (caps protect users) and show **remaining capacity** before the user commits (`05` §3.3). Two meters where relevant:
- **Per-network cap** — "how much you can hold/move on {network}" ("$X used / $Y" or "{x}/{y} {asset}").
- **Per-bridge cap** — "how much you can bridge in this action / window" ("$X of $Y").
- **Fill semantics (`04` §6.5):** healthy → **caution amber ≥ ~80%** → **destructive at/over cap ("Cap reached")**. Always **tabular**; always an **accessible text equivalent** ("82% of your per-network cap used") — never color alone, never the brand accent.
- **"Why caps?"** `Tooltip`/`HoverCard`: "Beta caps limit how much is exposed while we prove the system, on each network." (`05` §3.3).
- **Caps wire to real policy-layer limits** (`docs/INCREMENT-multi-network.md`).
- **shadcn:** `Progress` (styled, `04` §6.5) + `Tooltip`/`HoverCard`.

### 4.7 Primary CTA + withdraw-always
| Element | Detail | shadcn | ref |
|---|---|---|---|
| **Primary CTA** | **"Review bridge"** (**one** brand-cobalt CTA per view) → builds a bridge `txIntent` → `#/confirm/bridge`. → (on confirm) **"Sign bridge"**. **Never "Send" / "Transfer now" / "Bridge now"** (banned one-tap money-mover framing, `07` §2.2). | `Button variant=default` | `07` §2.2; `06` §1.2 |
| **Withdraw-always link** | Beneath the CTA, always present: **"Exit anytime — on Base or Sui, even if SparkPoint is offline."** → `/trust/exit`. | text + link → `/trust/exit` | `05` §4; `07` §7 |
| **Disclaimer** | If the bridge arrived from an AI suggestion (chat/portfolio): inline "AI suggestion — you approve & sign"; the action itself: "Nothing moves until you sign." | `Badge`/`text-xs` | `07` §2.1, §3.3 |

### 4.8 Caps logic (pre-emptive; the BLOCK lives on `#/confirm/bridge`)
- The Bridge surface reads caps **fresh from policy/chain** and **pre-emptively warns** as the amount approaches/exceeds the **per-network** or **per-bridge** cap.
- **If the entered amount would breach a cap:** the **"Review bridge" CTA is disabled** with a plain, non-punitive reason and a one-tap "set to max allowed": *"This is above your {per-network / per-bridge} cap. Max you can bridge now: {remaining} {asset}."* The **authoritative block** is re-checked and rendered on `#/confirm/bridge` (`06` §5/§6) — the surface just prevents a doomed handoff.
- **Caps are protective, framed as current limits**, never failures (`07` §2.3, §6.1).

### 4.9 Bridge-surface states (the six)
- **Default:** active network as source, the other as destination, asset = USDC, empty amount; CTA disabled (no amount); caps meter at current fill; route/fee/ETA show the basis ("— until you enter an amount"). Custody explainer present.
- **Filled (valid):** route/fee/ETA + est. received update live; CTA **"Review bridge"** enabled.
- **Loading:** **route/fee/ETA quoting** → `Skeleton` on the preview rows + a pending CTA; per-network/per-bridge caps read; **never `0` for fee/received/ETA** — use en-dash + "(calculated at simulation)". The custody explainer and withdraw-always link render **immediately** (never gated on a quote).
- **Success:** there is **no success here** — success happens on `#/confirm/bridge` after signing; returning shows the move reflected (post-confirm) + a `Sonner` toast already fired on confirm ("Bridge initiated… Track it ↗"); don't re-celebrate (`07` §2.5).
- **Warning:** **near-cap** (amber meter + note); **stale route/fee/ETA** (labeled estimate; authoritative on confirm); **wrong-network** (switch source via §2; withdraw unaffected); **destination is the fast-follow network** (honest "Sui is the designated fast-follow" note where the design needs it). All informational; none remove withdraw.
- **Error:** insufficient asset ("You don't have enough {asset} on {source}. Balance: {amount}." — not scary, `07` §6.1); insufficient source gas (informed before handoff); **route unavailable / couldn't quote** ("Couldn't load a bridge route right now. Your funds are safe and untouched. Try again." — never a raw RPC/provider string, `07` §6.1, §9.1 #10); amount below min ("Min bridge {amount}." helper); **withdraw unaffected on every network**.

**Microcopy (defer to `07`):** "Review bridge" → (on confirm) "Sign bridge"; never a one-tap money-mover that skips review (`07` §2.2, §9.1 #4). Lead with custody + the two networks, then route economics. The custody promise is stated in full on the surface.

---

## 5. Section B — The confirm / bridge sign gate (`#/confirm/bridge`) — referenced, not re-specced

> This flow **does not re-implement** the sign gate. The bridge runs the **single shared `ConfirmFlow`** gate — **Flow 6 / `06` §3-ter** is canonical. This section specs only **how Bridge hands off to it** and the **bridge-specific content** the designer must produce *as part of Flow 6* so the handoff is complete.

**Handoff:** "Review bridge" (or the chat bridge `ActionCard`) **builds a bridge `txIntent`** and routes to the gate — the **standalone `#/confirm/bridge` route** for non-chat entry, or **inline in the chat thread** for chat-initiated intents (`02` §7.6). **Same component, same gate, two mount points; the sign-disabled-until-acknowledged invariant is identical (1:1).**

**The gate's bridge content (mirrors `06` §3-ter — produce there, listed here for completeness):**
1. **Simulation reveal first** — a pre-bridge simulation **always** precedes the signature ("Simulating…" gates the gate; `06` §0.2). Nothing is signed unsimulated.
2. **Balance changes — out on source / in on destination.** The balance-change `Table` shows **{asset} − out ({source})** and **{asset} + in ({destination})** and **gas − out ({source})**, with **per-row network labels** so it's unmistakable which chain each delta lands on (`06` §3-ter). Signed/colored deltas, true minus `−`, right-aligned tabular.
3. **Guardrail checklist** — **"✓ Allowlisted route" · "✓ Within your per-network cap" · "✓ Within the bridge cap" · "✓ Policy approved" · "✓ Simulation passed"**, each with a "what's this?" tooltip (`06` §3-ter). A cap/route **block** makes Sign structurally impossible with a **remedy** (reduce amount / switch network / try again) — never an override (`06` §0.4, §5).
4. **Acknowledgement-gated sign** — any **warn** (near a per-network/per-bridge cap, elevated/stale route) produces a **specific ack checkbox**; the brand-cobalt **Sign** button is disabled (keyboard-focusable, `aria-disabled`, explaining helper) until **every** active ack is checked **and** the sim passed (Rabby; `05` §7; `06` §6). Control reminder verbatim: "Nothing moves until you sign. You can cancel now with no effect."
5. **"Sign bridge"** — the gated CTA (`07` §2.2).
6. **"Bridge initiated" success** — *"Bridge initiated. Your {amount} {asset} is on the way to your wallet on {destination}. Track it ↗"* + the **source-network tx hash** (mono, copy + explorer) + a **tracking link**; the receipt is provable (source now, destination on arrival); an **Outcome / activity entry** is written (`06` §3-ter; `05` §8).
7. **Cost & outcome** — source gas · bridge fee (itemized, if any) · net received on destination · est. time-to-arrival (estimate-framed). **No vault performance fee** here (a bridge is not a vault flow); **no projected APY.**

**Non-custody on the gate (fully self-custodial — must hold):** the user **signs a lock/burn on the source**; funds **arrive in their own wallet on the destination**; **SparkPoint never custodies funds in transit.** The confirm copy states this and the power-user "Details" lets a skeptic reconcile **both legs on-chain** (decoded lock/burn + mint/release events, source + destination addresses in mono + explorer links).

> **Scope flag (client-directed, logged):** only the **product / UX / non-custody** level is specified — the **Sui-side account/vault architecture** (non-EVM/Move) and the **bridge mechanism/provider/route-selection** are a **flagged follow-on increment**; the gate shows a **single canonical route** and **no fabricated Sui contract spec** (`06` §3-ter; §0).

---

## 6. Section C — The chat bridge intent — referenced, not re-specced

> The chat bridge intent is owned by **Flow 2 / `02` §7.2-bis (bridge `ActionCard`) + §7.6 (in-chat inline confirm)**. This section specs only how **this flow connects to it**.

- **Trigger:** the user expresses cross-network movement — **"bridge", "sui", "cross-chain", "move to Sui/Base"** (`02` §7.2-bis). The assistant classifies the intent as `bridge`, runs the tool-step ticker ("Reading your balances on Base… → Checking the Sui route… → Simulating the bridge…"), and renders the **bridge `ActionCard`** (from→to network chip, asset + amount, route/fee/ETA preview, and the verbatim custody note).
- **Custody note (verbatim, `02` §7.2-bis):** *"You'll sign a lock/burn on Base; the USDC arrives in your own wallet on Sui. SparkPoint never holds your funds in transit — fully self-custodial on both networks."*
- **Hand-off:** the card's "Review bridge" → the **inline confirm/bridge** in the thread (`02` §7.6) running the **same trust gate** (simulation → balance changes out-source/in-destination → guardrail checklist → ack-gated sign → "Bridge initiated" + tracking link), **without leaving `/chat`**; "Edit" → `#/bridge` with amount/networks staged; "Not now" dismisses safely.
- **Seeded example:** a "Bridge USDC to Sui" example thread exists (`02`; `docs/INCREMENT-multi-network.md`) — the designer should produce its card + inline-confirm states.
- **Trust:** the bridge intent runs the **single** simulation + guardrail + you-sign gate **exactly like** swaps/deposits; **withdraw-always holds on every network**; the user signs on the source and receives on the destination in **their own wallet** — **fully self-custodial**, never custodied in transit (`02` §7.2-bis).

---

## 7. Cross-cutting states (the six required, per surface)

Every surface ships **default · empty · loading · success · warning · error** where applicable (brief §4; `04` AC#9; `07` §6). Flow-specific summary (full per-section states above):
- **Loading** = `Skeleton` at section shape; **never** spinner-over-stale; **never `0`** for fee/received/ETA/amount (use en-dash + "(calculated at simulation)", `07` §5.5). The **custody explainer + withdraw-always link render immediately** (never gated on a quote).
- **Empty** = the unfilled Bridge surface (no amount) is an **invitation**, never an error — route/fee/ETA show the basis, the custody explainer is fully present. The network switcher's "no other network funds" case stays honest (don't fake a destination balance).
- **Success** = reflected **post-confirm** (the move reflected, the `Sonner` "Bridge initiated… Track it ↗" toast already fired); not re-celebrated here (`07` §2.5).
- **Warning** = `--caution` amber: near-cap, stale route/ETA, wrong-network, fast-follow-network note — informational, never removing withdraw (`07` §6.3; `04` §2.4).
- **Error** = `07` §6.1 formula (what / why / next-step, no blame, **no raw RPC/provider/revert strings**, custody reassurance "your funds are safe and untouched"); the **withdraw path is never removed by any error/degraded state, on any network** (`01` §6; `05` §4).

---

## 8. Non-custody / trust touchpoints in Multi-Network + Bridge (mandatory)

Bridging is the moment where "fully self-custodial across networks" must be **visible and provable**:

1. **Persistent shell affordances** (inherited, `01` §2): the **"Fully self-custodial" badge** → prove-it panel; the **network switcher** (asserts custody on the active network, switching never moves funds); the disclaimer strip with **[Prove it]** / **[Exit anytime]**; wallet menu → "View exact permissions". ≤1 tap to proof + exit, on **every network**, desktop and mobile.
2. **Fully self-custodial bridging, stated and provable.** The user **signs a lock/burn on the source**; funds **arrive in their own wallet on the destination**; **SparkPoint never custodies funds in transit.** Stated on the Bridge surface (§4.5), on the confirm gate (§5), and in chat (§6); the gate's "Details" reconciles **both legs on-chain** (source + destination addresses + decoded events).
3. **Withdraw-always on every network.** The **"Exit anytime"** link → `/trust/exit` sits on the Bridge surface and the shell; the withdraw-always invariant (N2) holds on **Base *and* Sui**; **never gated** by caps, kill-switch, backend health, a bridge in transit, or whitelist/geo (`05` §4; `01` §6).
4. **Switching networks never moves funds and never changes custody** — stated in the switcher menu; the badge re-asserts per active network (`01` §2).
5. **The single sign gate.** Bridge **builds a `txIntent` and routes to `#/confirm/bridge`** (Flow 6) — the live route/fee/ETA preview is a convenience estimate re-simulated authoritatively; **no bespoke bridge sign UI** (`06` §0.1; §0.2).
6. **Caps framed as protection, never failure** — per-network/per-bridge caps are *current limits that protect users* (`07` §2.3, §9.1 #7).
7. **Honest about phase + follow-on.** Base "Live", Sui "Fast-follow"; **no third network**; the **Sui-side architecture and the real bridge mechanism/provider are flagged as a follow-on** — copy stays at the truthful what-happens-to-your-money level (§0).
8. **AI is suggestion, not actor** — the chat bridge intent **proposes**; the AI never bridges funds; the user signs (`02` §7.2-bis; `07` §9.1 #4).

---

## 9. Component inventory → shadcn/ui mapping (this flow)

| Component | shadcn/ui | Notes / ref |
|---|---|---|
| Network switcher (pill + menu) | `DropdownMenu` + `Badge` (active network) + mono address | Persistent shell control; Base "Live" / Sui "Fast-follow" (`01` §2). |
| Active-network indicator | network glyph/dot (categorical chrome, **not** semantic, **not** risk palette) | Base vs Sui visually distinct (`04` §2.4 discipline). |
| Per-network wallet address | mono (`Geist Mono`), truncated + copy | Re-renders on switch (`01` §2; `04` §3). |
| Bridge surface layout | centered `Card` (desktop) / stacked (mobile) | Single-purpose bridge widget (`09` §9). |
| Asset picker (USDC/ETH) | `DropdownMenu`/`Select` (desktop) / `Sheet` (mobile) + `Badge` | `SP.data.bridgeAssets`. |
| From / To network selectors | `DropdownMenu`/`Select` + `Badge` (Live/Fast-follow) | Base/Sui only; no third network (§0). |
| Flip control | `Button` (icon, ghost) | Swaps source↔destination + re-quotes (`09` §9). |
| Amount input | `Input` (`.tnum`, symbol affix) | Validated; mobile numeric keypad (`07` §5.1). |
| Max / % chips | `Button size=sm` / `ToggleGroup` | Clamped to binding cap; ETH leaves gas headroom. |
| Route / fee / ETA preview | `Card`/rows (`.tnum`) + `Badge` (route) + ⓘ `Popover` | Single canonical route; estimate-framed; en-dash until sim (`06` §3-ter). |
| "How custody is preserved" explainer | `Card` + `Accordion` (desktop) / `Sheet` (mobile) + explorer links | Fully-self-custodial mechanics, both legs (§4.5). |
| Per-network / per-bridge caps meter | `Progress` (styled) + `Tooltip`/`HoverCard` | healthy→caution(≥80%)→destructive; tabular + text equiv (`04` §6.5; `05` §3.3). |
| Primary CTA ("Review bridge") | `Button variant=default` (one brand-cobalt CTA) | Routes to `#/confirm/bridge`; never "Send"/"Bridge now" (`07` §2.2). |
| Withdraw-always / "Exit anytime" link | text/`Button` (link) → `/trust/exit` | On the Bridge surface + shell, every network (`05` §4). |
| Prove-it micro-affordance | text/link → `Sheet` (permissions) | "Who can move these in transit? → No one but you" (`05` §2). |
| AI-suggestion badge / tip cards | `Badge` / `Popover` `TipCard` (`--info` blue) | If AI-sourced; "What is a bridge?" (`07` §2.1, §4.2). |
| Confirm/bridge handoff | bridge `txIntent` → `#/confirm/bridge` (Flow 6 §3-ter) | **No sign here** (`06` §0.1). |
| Toast (post-confirm) | `Sonner` | "Bridge initiated… Track it ↗" — fired on confirm (`07` §2.5). |
| Loading | `Skeleton` (route/fee/ETA rows) | Custody explainer + exit link render immediately (`04` §7). |
| Error / degraded | `Alert` (recoverable) + retry | Custody reassurance; no raw provider strings; withdraw never removed (`07` §6.1; `05` §4). |

> **Brand note (client-directed, `04` §2.3):** all "accent/CTA/AI-presence" uses are the **cobalt + gold + coral** brand (signature **blue→cyan→gold→coral** gradient for brand/AI moments only), on the **deep indigo-navy** base; the old **orange "spark"** accent is **STALE**. Risk (if it ever appears here) is the **violet→magenta** scale. **`tokens.css` is the source of truth.**

---

## 10. Accessibility (required, `04` §10)

- **No information by color alone:** the active-network indicator pairs the network **glyph + name** (not color alone); caps fill = label + tabular text equivalent ("82% of your per-network cap used"); fee/received/ETA carry labels, never color (`04` §10.2, §10.6). Network chrome is **not** semantic green/red and **not** the risk palette.
- **Tabular numerals** on every figure (amount, balance, fee, received, ETA, caps) — `Geist Sans` tabular figures (`04` §3.1, §10.8).
- **Keyboard:** full operability — network switcher (open/select), asset/network selectors, **flip** control, %/Max chips, amount input, custody-explainer `Accordion`, caps "why?", "Review bridge", "Exit anytime". Esc closes overlays; logical tab order top→bottom. **Visible 2px brand (cobalt) focus ring + 2px offset** on every control (`04` §10.3/§10.4). The disabled "Review bridge" CTA (cap breach) is **keyboard-focusable-but-disabled**, reason via `aria-disabled` + helper text, not color alone (`04` §10.4).
- **Touch:** 44px targets on mobile (switcher, selectors, flip, chips, CTA, sheet items, links) (`04` §4.3).
- **Live updates:** polite `aria-live` *sparingly* on the live route/fee/ETA preview — announce the result, don't spam per keystroke (`04` §10.6).
- **Reduced motion:** honor `prefers-reduced-motion` on number tweens, flip animation, skeleton shimmer — instant/opacity fallback; no info by motion alone (`04` §7, §10.7).
- **AA contrast** both themes (dark default, deep indigo-navy base); brand/semantic/network/caps tokens per `tokens.css` (`04` §2/§10.1).

---

## 11. Acceptance criteria (this flow conforms when ALL hold)

1. **Multi-network honesty.** The product presents **Base (Live)** and **Sui (Fast-follow)** — **no third network**, no "more chains soon" catalog; the scope amendment (multi-network supersedes "Base only") is **logged, not silent** (`docs/INCREMENT-multi-network.md`; §0).
2. **Persistent network switcher.** A top-bar control (next to the wallet pill) shows the **active network**, an **active-network indicator**, and the **per-network wallet address**; switching **re-scopes the view and updates the address** but **never moves funds and never changes custody** (stated in copy) — at 1440px desktop and 390px mobile (`01` §2).
3. **Bridge surface complete.** `#/bridge` has an **asset picker (USDC/ETH)**, **from/to network selectors with a flip control**, **amount + Max**, a **route/fee/ETA preview** (single canonical route, estimate-framed, en-dash until sim — never `0`), a **"how custody is preserved" explainer**, **per-network + per-bridge caps**, and a **"Review bridge" CTA** → `#/confirm/bridge` — desktop + mobile (§4).
4. **Fully self-custodial bridging, stated and provable.** Every bridge surface states: the user **signs a lock/burn on the source**, funds **arrive in their own wallet on the destination**, **SparkPoint never custodies funds in transit** — and the confirm "Details" reconciles **both legs on-chain** (`06` §3-ter; §4.5/§5).
5. **The one trust gate, no bespoke sign UI.** Bridge **builds a `txIntent` → `#/confirm/bridge`** (Flow 6 §3-ter) — the same **simulation reveal → balance changes out-source/in-destination → guardrail checklist → ack-gated sign → "Bridge initiated" + tracking link** as deposits/swaps; chat-initiated renders **inline** (`02` §7.6); **no flow ships its own sign UI** (`06` §0.1).
6. **Sign disabled until acknowledged.** Any warn (near per-network/per-bridge cap, elevated/stale route) produces a **specific ack** that **gates the cobalt Sign button**; a cap/route **block** makes Sign **impossible** with a **remedy** (no override) (`05` §7; `06` §5/§6).
7. **Withdraw-always on every network.** The **"Exit anytime" → `/trust/exit`** link is on the Bridge surface and the shell; withdraw-always (N2) holds on **Base *and* Sui**; **never gated** by caps, kill-switch, backend health, a bridge in transit, or whitelist/geo (`05` §4; `01` §6).
8. **Caps in context + blocked before signing.** **Per-network + per-bridge** caps appear with **healthy→caution(≥80%)→destructive** fill (tabular + text equivalent + "why caps?"); a cap-breaching amount is **pre-emptively warned and the CTA disabled with a plain reason**, with the **authoritative block re-rendered on `#/confirm/bridge`**; caps **wire to real policy-layer limits** (`05` §3.3; `06` §5/§6).
9. **Chat bridge intent.** "bridge / sui / cross-chain / move to …" classifies as `bridge`, renders the bridge `ActionCard` (from→to chip, route/fee/ETA, verbatim custody note), and hands off to the **inline** confirm/bridge — same gate, no navigation (`02` §7.2-bis, §7.6; §6).
10. **All states, every surface.** Network switcher and Bridge each ship default · empty (invitation, custody explainer present) · loading (skeleton route/fee/ETA; **never `0`/spinner over stale**; explainer + exit render immediately) · success (reflected post-confirm) · warning (near-cap / stale / wrong-network / fast-follow note, `--caution`) · error (what-why-next + custody reassurance, **no raw provider/RPC strings**) — at both breakpoints (brief §4; `07` §6; `04` AC#9).
11. **Scope discipline (Sui non-EVM / bridge mechanism).** This flow stays at the **product/UX/non-custody** level; it **flags the Sui-side account/vault architecture (non-EVM/Move — no ERC-4337/4626/Solidity) AND the bridge mechanism/provider/route-selection as a separate follow-on increment**; it shows a **single canonical route** and **fabricates neither a Sui contract spec nor a concrete route**; the **Base/EVM contract spec stays intact** (§0).
12. **Terminology.** User-facing trust copy uses **"fully self-custodial"** (the persistent badge reads "Fully self-custodial"); "non-custodial / self-custodial" appear only as **technical** descriptors (`docs/DESIGN-UPDATE-HANDOFF.md`; `07`).
13. **Design-system + content conformance.** Token-only color (**cobalt/gold/coral** brand + signature gradient for brand/AI only; the old orange is **stale**; risk = violet→magenta; deep indigo-navy base), brand-accent scarcity (≤1 cobalt CTA/view — "Review bridge"), **Geist Sans/Mono** with tabular numerals on every figure, full keyboard + 44px targets + visible cobalt focus ring + reduced-motion, sentence case / second person / verb-first buttons ("Review bridge" / "Sign bridge", never "Send"/"Bridge now"/"Transfer"), banned words avoided; **`tokens.css` wins on values** (`04` AC; `07` AC, §2.2, §9).
14. **shadcn-mappable.** Every component resolves to a primitive/composition in §9 / `04` §11; caps via styled `Progress`; selectors via `DropdownMenu`/`Select`/`Sheet`; the bridge sign gate via the shared Flow 6 `ConfirmFlow`.

---

## 12. Cross-references

- **Routes / shell / network switcher / nav / gating / degraded:** `01-information-architecture.md` §1 `(app)/bridge` (`#/bridge`) + the shell network switcher + wallet pill; §2 shell anatomy (the `[◆ Network: Base ▾]` element, the network-switcher + wallet-status rows); §3 nav (Bridge in secondary nav + ⌘K; Withdraw/Exit pinned); §4 flow graph; §6 gating/degraded (wrong-network, withdraw-always).
- **The sign gate (canonical) + the confirm/bridge variant:** `02-flows/06-execution-confirmation-simulation.md` §0 (the trust thesis + the bridge scope flag), §1.2 (entry points incl. the Bridge surface), **§3-ter (confirm/bridge — out on source / in on destination, balance changes, guardrails, "Sign bridge", "Bridge initiated" + tracking)**, §5 (banner), §6 (acknowledgement model), §7 (signing/pending/success/failure).
- **Chat bridge intent + in-chat inline confirm:** `02-flows/02-chat-assistant.md` **§7.2-bis (bridge `ActionCard`)**, **§7.6 (in-chat inline confirm)**, §7.5 (the card→confirm→outcome table).
- **Escape hatch / withdraw-always (canonical, every network) / caps / kill-switch / prove-it:** `05-trust-and-safety-ux.md` §1 (proof affordances), §2 (prove-it), §3.3 (caps — per-network/per-bridge), §3.4 (pause-only kill-switch), **§4 (`/trust/exit` — source of truth for the on-chain exit, now invariant on every network)**, §7 (friction/acknowledge-before-sign).
- **Tokens / brand (cobalt/gold/coral + gradient; orange STALE) / risk palette (violet→magenta) / type (Geist) / numbers / caps meter / motion / a11y / shadcn map:** `04-design-system.md` §2 (color), §2.3 (brand accent), §2.5 (risk palette), §3 (type/numbers), §6.5 (caps meter), §7 (motion), §10 (a11y), §11 (component map); **`tokens.css` = source of truth for values.**
- **All wording / amount & fee & ETA formatting / caps & withdraw framing / tooltips / error+empty+warning copy / banned phrases / "fully self-custodial" terminology:** `07-content-and-tone.md` (§2 motifs/buttons, §3 success/error/warning, §4 literacy, §5 numbers, §7 trust copy, §9 DOs/DON'Ts) — **wins on any wording conflict.**
- **The increment + the change log:** `docs/INCREMENT-multi-network.md` (multi-network + bridge scope, the deferred/follow-on list), `docs/DESIGN-UPDATE-HANDOFF.md` (terminology + the in-chat confirm + brand notes), `docs/DESIGN-DELIVERY-NOTES.md` (prototype map).
- **Inventory:** `03-screen-inventory.md` (the network switcher, Bridge, confirm/bridge, and in-chat inline-confirm screens/states).
