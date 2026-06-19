# 03 — Screen & State Inventory (the complete production checklist)

> **Handover doc** for Claude Design. This is the **exhaustive, numbered inventory** of every screen, overlay, card, and state the designer must produce for the W1–2 "Live Wireframe & UI/UX Finalization" milestone — **high-fidelity, production-ready, all states, desktop + mobile equal priority**.
>
> **Reads-before (authoritative):** `00-brief.md` (scope/positioning), `01-information-architecture.md` (route map §1, shell §2, nav §3, flow graph §4, **gating/degraded states §6**), the six flow specs in `02-flows/` (`01`–`08`), `04-design-system.md` (tokens/components), `05-trust-and-safety-ux.md` (trust surfaces), `07-content-and-tone.md` (**all canonical strings — wins on any conflict**), `09-references.md` (benchmarks). This doc **indexes** those; for per-screen anatomy/copy/benchmarks, follow the cross-reference to the owning flow spec.
>
> **How to read this inventory**
> - Every entry has a **number**, a **route** (or "overlay/shell" if not a route), and the **state set** it must ship.
> - **Standard six states** = `default · empty · loading · success · warning · error` (per brief §4; `04` AC#9). Not every screen needs all six; each entry lists the **applicable** states explicitly, plus any **surface-specific** states (e.g., `blocked`, `stale/degraded`, `revoked`, `not-found`).
> - **DT** = needs a **desktop** layout (1440px design canvas, 1024 min). **MO** = needs a **mobile** layout (390px design canvas, 360 min). Almost everything is **DT + MO** (equal priority); the few exceptions are noted.
> - **Overlays** (Sheet/Dialog/Popover/Drawer) are counted as their own screens because they need designed states; on mobile, `Dialog → Sheet/Drawer` (`04` §4.2).
> - "States reflected from `/confirm`" means the screen does **not** itself sign — success is the post-confirmation reflected state.
>
> **Hard global rules that touch every screen** (`01` §0, `05` §0): the **non-custodial badge → prove-it panel** and a **withdraw/exit path** are **≤1 tap** from every authenticated screen; **no gating/error/degraded state ever removes the withdraw path**; **all state-changing actions funnel to `/confirm`** (no bespoke sign UI); **tabular numerals** on all financials; **semantic color never alone** (always + icon + label); **WCAG AA**, dark-first.

---

## Inventory summary (counts)

| Area | Screens / overlays / states-as-screens |
|---|---|
| 0. Global shell & cross-cutting | 1–14 **+ 5a (network switcher) + 14a (theme toggle)** (16) |
| 1. Public / marketing | 15–24 **+ 15a (Spark Core landing)** (11) |
| 2. Connection & gating | 25–30 (6) |
| 3. Onboarding (Flow 1) | 31–40 (10) |
| 4. Chat AI Assistant (Flow 2) | 41–57 **+ 53a (bridge `ActionCard`)** (18) |
| 5. Portfolio (Flow 3) | 58–64 (7) |
| 6. Strategy Recommendations (Flow 4) | 65–72 (8) |
| 7. Vault Deposit / Withdraw (Flow 5) | 73–82 (10) |
| 8. Execution & Simulation (Flow 6) | 83–93 **+ 93a (confirm/bridge)** (12) |
| **8-bis. Bridge — Multi-Network (Flow 12)** | **93b–93f (Bridge surface · selectors+flip · route/fee/ETA+caps+custody explainer) (5)** |
| 9. Automation / Session Keys (Flow 7) | 94–101 (8) |
| 10. Trust & Safety | 102–113 (12) |
| 11. SRK / Literacy / Outcomes / Settings / Notifications | 114–137 (24) |
| 12. AI Swap (Flow 9) | 138–142 (5) |
| 13. Subscriptions / Premium AI tier (Flow 10) | 143–153 (11) |
| 14. Fee Transparency / Revenue Surfaces (Flow 11) | 154–161 (8) |
| 15. Admin / Stakeholder Panel (separate surface) | 162–174 (13) |
| **TOTAL** | **184 numbered screens/overlays** (174 base + 9 client-directed multi-network/bridge additions: #5a, #15a, #53a, #93a, #93b–93f; + #14a theme-toggle control) |

> **Read the count as "designed artifacts," not "routes."** It includes route screens, the global shell variants, overlays/sheets/panels, and the in-chat structured cards — each of which the designer must produce with its full state set. Routes alone number ~40 (see `01` §1); the rest are overlays, cards, and shell/gating/degraded variants that each demand their own high-fidelity treatment.
>
> **§12–§15 are the additive design surfaces** (#138–174): the **AI Swap** flow (Flow 9), the **Subscriptions / Premium AI tier** (Flow 10), the **Fee Transparency / Revenue Surfaces** (Flow 11), and the **Admin / Stakeholder Panel** (a separate, separately-gated surface). They reuse the same state discipline; the swap, premium-pay, and fee line item all funnel through `/confirm` (§8) — only their *contextual* screens are counted here, not a second sign UI.
>
> **The client-directed multi-network / bridge increment** (`docs/INCREMENT-multi-network.md`; Flow 12) adds **lettered artifacts** rather than renumbering the base inventory: the persistent **network switcher** (#5a, shell), the **Spark Core marketing landing** (#15a, with the Ember/Plasma/Constellation flavor left as an **open client choice**), the chat **bridge `ActionCard`** (#53a), the **confirm/bridge** sign-gate variant (#93a), and the **Bridge surface** (§8-bis, #93b–93f). The bridge runs the **single** `/confirm` gate — no second sign UI; in-chat confirm (#57) is the **same** `ConfirmFlow` mounted inline. **Fully self-custodial** terminology is canonical user-facing (the badge, #3). **Scope flag (logged):** the Sui-side account/vault architecture (non-EVM/Move) + the bridge mechanism/provider are a **follow-on increment** (single canonical route; no fabricated Sui contract spec).

---

## 0. Global shell & cross-cutting (overlays + shell variants present on every `(app)` route)

> Source: `01` §2 (shell anatomy), `05` §1–§2 (badge + prove-it), `04` §11. These are **shell-level** artifacts reused across all authenticated routes — design once, fully stated.

1. **Authenticated app shell — desktop** (`(app)/layout.tsx`). Top bar (logo · primary nav Chat/Portfolio/Vault/Strategies · non-custodial badge · wallet chip · ⌘K · bell · avatar) + AI disclaimer strip + collapsible secondary nav rail + route-content region. The **avatar `DropdownMenu` carries the theme toggle** (sun/moon + "Light mode/Dark mode" + `Switch`, **between "Learn" and "Log out"** — #14a). **States:** default · disclaimer-collapsed (on scroll) · secondary-nav-collapsed · light-theme. **DT.**
2. **Authenticated app shell — mobile.** Condensed top bar (logo · badge · wallet chip · bell) + one-line expandable AI disclaimer + bottom tab bar (Chat·Portfolio·Vault·Strategies, Chat center) + "More" drawer. The **avatar/account menu carries the same theme toggle** (#14a). **States:** default · disclaimer-expanded · More-drawer-open (Withdraw/Exit + Prove-it pinned top) · light-theme. **MO.**
3. **"Fully self-custodial" badge** (top-bar element + desktop `HoverCard`; label reads **"Fully self-custodial"** — the canonical user-facing term; "non-custodial" is its technical synonym; asserts non-custody on the **active network**). **States:** default/nominal (green) · degraded (amber) · kill-switch-active/paused (amber + "Paused") · automation-active (green + "Auto" chip) · loading/connection-resolving (muted pulse) · wrong-network (amber). Never red. (`05` §1.3; `01` §2; `docs/DESIGN-UPDATE-HANDOFF.md` terminology.) **DT + MO.**
4. **"Prove-it" permissions panel** (badge-triggered `Sheet` — desktop right / mobile bottom). Five guarantees as live checkable rows + two-column CAN/CANNOT matrix + pinned [Withdraw/Exit] + [See full Trust Center]. **States:** default (reads succeed) · loading (skeleton rows; exit/revoke never gated) · stale/refresh-needed (amber stamp) · read-error/RPC-down (warning banner, withdraw stays functional). (`05` §2.) **DT + MO.**
5. **Wallet / connection status menu** (`DropdownMenu` from the wallet chip; address shown **per active network**). Copy address, view on explorer, switch wallet, disconnect, "View exact permissions". **States:** connected · wrong-network ("Switch to Base or Sui") · pending/connecting · disconnected. **DT + MO.**
5a. **Network switcher (persistent shell control)** (`DropdownMenu` + `Badge`, top bar **next to the wallet pill**; **multi-network — Base "Live" / Sui "Fast-follow"**). Active-network indicator (network glyph/name) + a menu of the **two** networks, each with its **per-network wallet address** (mono) + active check + "Move assets between networks" → `#/bridge`; persistent "Switching never moves your funds and never changes what SparkPoint can do." **Switching re-scopes the view + updates the address — no transaction, no signature, no fund movement.** **States:** default (active network) · switching (pill/address pending; never a blocking spinner) · loading/connection-resolving (muted pulse; never a `0x…` placeholder) · warning (wrong-network "Switch to Base or Sui"; stale per-network balance "as of {time}") · error (per-network read fail → last-known + custody reassurance; switching + withdraw still function). Network chrome is categorical, **never** semantic green/red, **never** the risk palette. (`01` §2; Flow 12 §2.) **DT + MO.**
6. **Command menu (`⌘K`)** (`Command` in `Dialog`). Top actions: Withdraw now · Prove it · Revoke automation; jump-to-route search. **States:** default (recent/top actions) · query-typed · no-results. **DT + MO.**
7. **AI disclaimer strip** (`Alert` info, pinned by shell + `Collapsible`). **States:** full (desktop) · compact one-line (mobile/scroll) · expanded-from-compact. Risk + custody clauses verbatim, unsoftened (`07` §3). **DT + MO.**
8. **Notifications bell preview** (`Popover` desktop / `Sheet` mobile). Unread count, recent rows, "Mark all read", "See all". **States:** default (items) · empty/caught-up · loading · all-read. **DT + MO.** (Full center = #135.)
9. **Global toast host** (`Sonner`). Reused everywhere. **Variants:** success (tx confirmed · View tx ↗) · blocked/error (+ "Nothing moved — funds untouched") · neutral (signature cancelled) · info. **DT + MO.**
10. **Global loading skeleton pattern** (per-route `loading.tsx`). Skeleton shapes per surface; never spinner-over-stale, never `0` placeholder. (`04` §7; `07` §5.5.) **DT + MO.**
11. **Global recoverable error pattern** (per-route `error.tsx`). What/why/next-step, no blame, no raw tech, **custody reassurance** ("your funds are safe and untouched"), retry, and "withdraw is still available". (`07` §6.1; `01` §1.) **DT + MO.**
12. **Global 404 / not-found** (`not-found.tsx`, root + public). **State:** default not-found + route-home. **DT + MO.**
13. **Degraded-mode global banner** (backend/agent/RPC unhealthy). "Some SparkPoint services are degraded — your custody and exit are unaffected." Withdraw/prove-it elevated. (`01` §6; `05` §1.3.) **DT + MO.**
14. **Theme variants — dark (default) + light (supported).** Both AA; **every screen has a light and a dark variant** (mock the system in dark, then prove the light variant — it is a real supported theme, not just a token-swap proof). The active theme is a single class on the root `<html>` (`.dark`/`.light`); it is **persisted in `localStorage` under `sp-theme`** (`"light"`|`"dark"`, default `"dark"`) and applied before first paint (no FOUC). Brand/spark-gradient, semantic (gain/loss/caution/info), and risk colors stay **theme-independent**; only surfaces/neutrals/borders/text flip. **The Spark Core marketing landing (#15a) is dark-only by design** and shows no toggle. The toggle itself lives in three places — **app user-avatar menu** (#1/#2), **admin side-nav** (#174), **onboarding header** (#31) — each writing `sp-theme` so they stay in sync. (`04` §2.1, §10.1, and `04` → "Theming — light & dark mode".) **DT + MO.**
14a. **Theme toggle control (app — user-avatar menu).** In the avatar `DropdownMenu`, **between "Learn" and "Log out"**: sun/moon icon + label **"Light mode" / "Dark mode"** + a `Switch`; writes `sp-theme`. Mirrors the onboarding (#31) and admin (#174) toggles and the Appearance setting (#134). **States:** dark-active · light-active · (reduced-motion: instant swap, no transition). **DT + MO.**

---

## 1. Public / marketing surfaces (`(public)` — no wallet required)

> Source: `01` §1 `(public)`, §5 Stage A. Slim public header + footer (AI disclaimer in footer). The public `/trust` is the **no-account-data** mirror.

15. **Landing `/`** — "AI hedge fund" headline anchored by **native non-custody** (canonical copy "**fully self-custodial**"); primary CTA Connect/Enter; [Join waitlist] for non-whitelisted. **States:** default · loading (above-fold) · (region-aware CTA variant). **DT + MO.**
15a. **Spark Core marketing landing** (animated "Spark Core" hero — the signature **blue→cyan→gold→coral** brand gradient + AI bloom, on the deep indigo-navy base; brand/AI-presence moment, **not** semantic color). The **animation flavor (Ember / Plasma / Constellation) is an OPEN CHOICE intentionally left for the CLIENT to pick** — design all three flavor treatments; do not hard-select one. Leads with control + **fully self-custodial**, never a number. **States:** default (flavor TBD — produce Ember · Plasma · Constellation variants) · loading (above-fold) · reduced-motion (static/opacity fallback, no info by motion) · (region-aware CTA). (`04` §2.3 brand gradient; `docs/INCREMENT-multi-network.md` / `docs/DESIGN-UPDATE-HANDOFF.md`.) **DT + MO.**
16. **How it works `/how-it-works`** — "AI proposes / you dispose" explainer. **States:** default · loading. **DT + MO.**
17. **Public Trust overview `/trust`** — public mirror: guarantees + audits + on-chain addresses, **no account data** (`05` §3.7). **States:** default · loading. **DT + MO.**
18. **Security `/security`** — guarantees + audits public mirror. **States:** default · loading. **DT + MO.**
19. **Legal — Terms `/legal/terms`.** **States:** default. **DT + MO.**
20. **Legal — Privacy `/legal/privacy`.** **States:** default. **DT + MO.**
21. **Legal — Risk disclosures `/legal/risk`.** **States:** default. **DT + MO.**
22. **Waitlist `/waitlist`** — capture interest (beta-gated). **States:** default · submitting · success (joined) · error (submit failed). **DT + MO.**
23. **Public shell header/footer** (slim public chrome). **States:** default. **DT + MO.**
24. **Cookie/consent + region notice** (if applicable, public boundary). **States:** default · dismissed. **DT + MO.**

---

## 2. Connection & gating (`(auth)` interstitials + degraded/gating renders) — `01` §1, §5 Stage B, §6

25. **Connect wallet `/connect`** — WalletConnect v2 / Coinbase / injected; confirm Base; smart-account established/detected; "no keys generated or held by us". **States:** default (choose connector) · connecting/pending · success (connected → continue) · wrong-network ("Switch to Base") · error (connection failed, retry). **DT + MO.**
26. **Verify whitelist `/verify`** — beta whitelist check after connect. **States:** loading (checking) · pass (→ continue) · fail (→ `/unavailable` or `/waitlist`) · error (check failed, retry). **DT + MO.**
27. **Unavailable `/unavailable`** — geo-blocked / not-whitelisted dead-end that **still surfaces the on-chain withdraw-always escape hatch** for existing users (`01` §6; `05` §4.3). **States:** not-whitelisted · geo-blocked · (both keep Path-B exit documented + functional). **DT + MO.**
28. **Wrong-network inline prompt** (blocking inline, not a route — appears in shell/wallet chip). "Switch to Base; withdrawals unaffected." **States:** default (prompt) · switching · error. **DT + MO.**
29. **Disconnected redirect interstitial** — app routes redirect to `/connect?next=…`; public + trust remain viewable. **States:** default (redirect notice). **DT + MO.**
30. **Auth/gating shell** (`(auth)/layout.tsx`, minimal shell; badge still present). **States:** default. **DT + MO.**

---

## 3. Onboarding (Flow 1, `(onboarding)`) — `02-flows/01-onboarding.md`

> Focused shell (primary nav suppressed; **badge + disclaimer persist**). 6 counted input steps + welcome/complete bookends; persistent honest stepper. All copy → `07`.

31. **Onboarding shell** (`(onboarding)/layout.tsx`): logo · badge · network pill · wallet chip · progress stepper · AI disclaimer · save-&-exit · **theme toggle** (a small sun/moon **icon button, top-right of the header**; writes `sp-theme`, in sync with the app #14a and admin #174 toggles). **States:** default · stepper-collapsed (mobile dots) · light-theme. **DT + MO.**
32. **Step 0 — Welcome + non-custodial promise** `/onboarding`. **States:** default · loading (account/mandate check) · returning-with-progress (Resume + Start over) · error (couldn't load state). **DT + MO.**
33. **Step 1 — Connect (reassurance + confirmation)** `/onboarding` (or `/onboarding/connect`). **States:** default-connected (reassurance + Continue) · disconnected (Connect CTA) · wrong-network (Switch to Base) · loading (connecting) · error (connection failed) · whitelist/geo-fail mid-flow (→ `/unavailable`). **DT + MO.**
34. **Step 2 — Experience segmentation** (New/Some/Pro `ToggleGroup` cards). **States:** default (unselected, Continue disabled) · selected · saving · persistence-error (toast retry). **DT + MO.**
35. **Step 3 — Goal selection** (limited chip cards; "Reach a target" reveals input) `/onboarding/goals`. **States:** default · selected · target-amount sub-state · empty/invalid target (helper) · saving. **DT + MO.**
36. **Step 4 — Timeline** (chips, slider optional). **States:** default · selected · saving. **DT + MO.**
37. **Step 5 — Risk scenarios** (the wedge; `RadioGroup` of scenario cards, 1–3) `/onboarding/risk`. **States:** default (prompt + options) · selected · multi-scenario progress ("Scenario 2 of 2") · loading (if fetched) · saving. **DT + MO.**
38. **Step 6 — Mandate review** (adjustable risk slider + "why this profile?") `/onboarding/review` → `/onboarding/mandate`. **States:** default (proposed) · adjusted (live update + "adjusted from suggested") · above-launch-support **warning** (amber, informational, not sign-blocking) · loading (computing) · saving · error (save failed). **DT + MO.**
39. **Step 7 — First-recommendation preview** (read-only RecommendationCards; "AI suggestion — you approve & sign"; "Review this move" → `/confirm`). **States:** default (1–3 cards) · loading (skeleton cards) · empty/not-enough-context (honest → continue to chat) · above-launch-support (honest single live option) · error (recs unavailable, still continue). **DT + MO.**
40. **Onboarding complete / celebration** → `/chat` primed. **States:** default (success beat) · reduced-motion (instant) · error-on-redirect (land on chat anyway). **DT + MO.**

---

## 4. Chat AI Assistant (Flow 2) — `02-flows/02-chat-assistant.md`

> Primary surface/hub. Desktop = chat column + optional thread list + collapsible context side panel; mobile = chat-native single column + bottom-anchored composer. The six structured cards are counted individually (each needs its own anatomy + state set).

41. **Chat — desktop layout** `/chat`, `/chat/[threadId]` (3 regions: thread list · chat column · context side panel mirroring mandate/portfolio/automation). **States:** default (settled thread) · side-panel-collapsed. **DT.**
42. **Chat — mobile layout** (single column; composer above bottom tabs; chips as horizontal scroll row). **States:** default · keyboard-focused (composer floats, tabs hide). **MO.**
43. **Empty state / first open / new thread** (hero greeting + suggested-prompt chips). **DT + MO.**
44. **Primed first message (post-onboarding)** (mandate-aware opener + chips). **DT + MO.**
45. **Thinking / tool-step state** (streamed tool-step ticker; spark "thinking" motion; reduced-motion fallback; collapses after). **DT + MO.**
46. **Streaming answer state** (token-by-token; cards render with skeleton fields; Stop available). **DT + MO.**
47. **Settled answer state** (prose + cards + thumbs + citations + follow-up chips). **DT + MO.**
48. **Warning / acknowledge-required (in-chat)** (amber caution banner previewing the `/confirm` ack friction). **DT + MO.**
49. **Error & retry states** (generation failed · AI/agent unavailable/degraded · network/RPC unreachable · no-data/can't-answer · stale-data) — each inline `Alert` + retry; input never lost; custody reassurance. **DT + MO.**
50. **Composer** (`Textarea` + send/stop). **States:** empty (send disabled) · typing · streaming (Stop) · send-failed (input retained + retry) · degraded (disabled + reassurance copy). **DT + MO.**
51. **Suggested-prompt chips** (empty set · contextual follow-ups; send-vs-populate indicated). **States:** default · populate-vs-send variant. **DT + MO.**
52. **Card — `RecommendationCard`** (rank, AI-suggestion badge, net APY+breakdown, risk chip, fit, projected, sources, "Why this?", ≤2 actions). **States:** loading · default · warning (above-plan) · error (rate unavailable). **DT + MO.**
53. **Card — `ActionCard`** (deposit/withdraw/swap/**bridge** intent; editable amount; caps preview; → `/confirm`). **States:** loading · default · warning (cap near / above-plan) · **blocked** (cap reached / not-whitelisted / sim would revert) · error. **DT + MO.**
53a. **Card — `ActionCard` (bridge variant)** (the chat **bridge intent** — "bridge"/"sui"/"cross-chain"/"move to …"; from→to network chip Base→Sui; asset + amount; route/fee/ETA preview; **per-network/per-bridge caps**; verbatim custody note "You'll sign a lock/burn on Base; the USDC arrives in your own wallet on Sui — fully self-custodial on both networks"; "Review bridge" → **inline confirm/bridge** §7.6 / `#/confirm/bridge`; "Edit" → `#/bridge`). **States:** loading (route/fee/ETA skeleton) · default · warning (near per-network/per-bridge cap / elevated-or-stale route) · **blocked** (over cap / route unavailable / not-allowlisted — remedy, no override) · error ("Couldn't load a bridge route. Your funds are safe. Try again."). (`02` §7.2-bis; Flow 12 §6.) **DT + MO.**
54. **Card — `PortfolioSnapshotCard`** (net worth, PnL+window, mini allocation, risk read, vault position; read-only). **States:** loading · default · empty (no positions) · error. **DT + MO.**
55. **Card — `TipCard`** (financial-literacy, `--info` blue; "How this works"; dismissable). **States:** default · dismissed (no re-nag). **DT + MO.**
56. **Card — `OutcomeCard`** (realized PnL of a past rec; win/loss symmetric; proof link). **States:** loading · default-win · default-loss · pending/settling · error. **DT + MO.**
57. **Card — `ConfirmationCard` (in-chat inline confirm — the SAME `ConfirmFlow` gate mounted in the thread, NOT a preview/mirror)** (chat-initiated deposit/swap/**bridge** render the full gate inline — **no navigation**: pre-trade **simulation reveal** → balance changes (simulated; **bridge** = out-on-source / in-on-destination, per-row network labels) → guardrail checklist → **acknowledgement checkbox that gates the Sign button** → "Nothing moves until you sign" → Sign → success (tx hash); always offers "Open full confirmation" → the `/confirm/[intent]` route). The **sign-disabled-until-acknowledged invariant + guardrail/simulation gate are identical (1:1) to the route**; non-custody (**fully self-custodial**) unchanged. **States:** simulating · passed · warning/needs-ack · blocked (no sign) · signing/pending · success · failure/retry. (Client-directed UX-surface change, logged — `docs/DESIGN-UPDATE-HANDOFF.md` §2; `02` §7.6; `06` §0.1/§3-ter.) **DT + MO.**

> Also design the **citation source popover/sheet** ("Based on {source}" + timestamp + link) and **thumbs-down follow-up** (chips + optional text) as overlay variants of #47 (states: default · submitted · dismissed). **Thread switcher** (rail desktop / `Sheet` mobile) states: default · empty (no prior threads) · loading.

---

## 5. Portfolio Overview (Flow 3) — `02-flows/03-portfolio.md`

> Desktop 12-col dashboard; mobile single-column stacked. Read-only — every action routes to `/confirm`. The **risk panel** is the differentiator.

58. **Portfolio overview — desktop** `/portfolio` (hero band · allocation + sticky risk panel · positions table). **States (overview as a whole):** default · empty ("Nothing here yet / Explore the vault", not `$0.00`) · loading (section skeletons) · success (reflects prior confirm) · warning (stale / drift / concentration) · error (recoverable + custody reassurance + degraded banner). **DT.**
59. **Portfolio overview — mobile** (hero → risk panel → allocation → stacked position cards). Same state set as #58. **MO.**
60. **Net-worth hero band** (figure + PnL change w/ window + over-time area chart + range toggle + "as of"). **States:** default · empty (idle-balance-only is NOT empty) · loading · success (tween) · warning (stale) · error. **DT + MO.**
61. **Risk panel** (score n/5 + meter · concentration · protocol exposure · drift-vs-target · act-on-risk CTA · literacy tip). **States:** default · warning (over-threshold concentration / above-plan drift) · empty/no-mandate ("set your plan", never fake target) · empty/no-positions · loading · error/stale ("risk read unavailable; funds safe"). **DT + MO.**
62. **Allocation donut + view switcher** (Asset / Strategy / Risk tier; legend; "<3% → Other"). **States:** default · single-position (clean ring) · loading · empty (part of global empty) · error ("No data yet"). **DT + MO.**
63. **Positions table / cards** (per-position rows w/ inline Add · Withdraw · Ask AI). **States:** default · loading (skeleton rows) · empty (global empty) · partial/stale (per-row "as of") · error (row fails gracefully). **DT + MO.**
64. **Single-position detail** `/portfolio/positions/[id]` (realized+unrealized PnL split, cost basis, accrued yield, shares for vault, history ledger w/ "View tx ↗", risk contribution, linked recommendation). **States:** default · loading · empty-history · not-found · error/stale (withdraw remains). **DT + MO.**

---

## 6. Strategy Recommendations (Flow 4) — `02-flows/04-strategy-recommendations.md`

> Ranked vs the mandate; "why this?" mandatory; allowlist-only; acceptance → `/confirm`.

65. **Ranked list — desktop** `/strategies` (page header + mandate context bar + filter bar + stacked StrategyCards). **DT.**
66. **Ranked list — mobile** (compact mandate bar + Filters Sheet trigger + stacked cards). **MO.**
67. **Ranked-list states** (applies to #65/#66): A default · B empty-no-mandate ("Set my plan") · C empty-nothing-to-suggest · D empty-filters-exclude-all ("Clear filters") · E loading · F warning-above-plan (amber on the card) · G stale/degraded ("may be out of date") · H error (couldn't load). **DT + MO.**
68. **`StrategyCard`** (rank badge, AI-suggestion badge, title+thesis, net APY+breakdown, risk chip, fit-to-goal meter, projected, sources, compare checkbox, ≤2 actions + "Why this?"). **States:** loading · default · warning (above-plan) · error. **DT + MO.**
69. **Recommendation detail / "why this?"** `/strategies/[recId]` (rationale narrative · fit-to-goal detail · sourced data · 4-dimension risk rationale · guardrails-passed checklist · outcome link if acted · ≤2 actions). **States:** default · loading · warning/above-plan · **blocked/no-longer-valid** (no sign offered) · stale · error · not-found/expired · outcome-pending. **DT + MO.**
70. **Filters & sort** (Risk/Asset/Protocol/Min-APY facets + Sort; active-filter chips). **Desktop:** inline `DropdownMenu`/`Popover` per facet. **Mobile:** bundled bottom `Sheet` with count badge. **States:** default · active-filters · no-results. **DT + MO.**
71. **Compare view — desktop** (2–3 columns × dimension rows; mandate anchor; Fit row headline; above-plan flags). **States:** default · min-selection (<2) · max (3, further disabled) · loading · above-plan-present · error (a column fails). **DT.**
72. **Compare view — mobile** (full-screen `Sheet`; segmented switcher or swipeable columns). Same state set as #71. **MO.**

---

## 7. Vault Deposit / Withdraw (Flow 5) — `02-flows/05-vault-deposit-withdraw.md`

> Single Aave Yield Vault (`spvUSDC`, **0% on principal / 0 management + active 10% profit-only HWM performance fee on yield**, non-upgradeable). `/vault` = vault detail (degenerate one-vault case). No signing here — Deposit/Withdraw build `txIntent` → `/confirm`. Withdraw co-equal with Deposit; "Exit anytime" on both panels.

73. **Vault detail — desktop** `/vault` (left: header + net-APY hero + "where funds go" + history + audits; right sticky: Deposit|Withdraw action card + caps meter + "your position"). **DT.**
74. **Vault detail — mobile** (header → APY hero → your position → action card (bottom-anchored CTA) → caps → allocation → history → audits → exit link). **MO.**
75. **Vault-detail states** (applies to #73/#74): default · empty/pre-deposit invitation (exit still documented) · loading (section skeletons) · success (reflect post-confirm) · warning (near-cap / kill-switch paused / stale) · error (recoverable; withdraw reachable). **DT + MO.**
76. **Vault discovery card** (single-vault summary card if reached via a "vaults" cross-link; not a marketplace). **States:** default · loading · caps-reached (status chip) · kill-switch-active (paused chip) · error. **DT + MO.**
77. **"Your position" sub-panel** (shares · share price · underlying value · realized yield · provenance · Add/Withdraw/View-in-portfolio · "who can withdraw → you only"). **States:** default · no-position (→ invitation) · loading · stale/error (withdraw still works). **DT + MO.**
78. **Deposit panel** `/vault/deposit` (amount input · %/Max chips · live shares preview · est. yield · caps meter · non-custody line · "Review deposit"). **States:** default (empty, CTA disabled) · filled/valid · loading (building intent / share price / caps) · success (none — reflected post-confirm) · warning (near-cap · kill-switch paused · stale) · error (insufficient USDC / gas / below-min / build failure). **DT + MO.**
79. **Withdraw panel** `/vault/withdraw` (by-amount/by-shares toggle · input · %/Max · redemption preview incl. the 10% profit-only performance fee on yield above the HWM (0% on principal) · constraints · "Exit anytime" link · "Review withdrawal"). **States:** default (has position) · empty (no position; exit still documented) · loading (Path-B renders immediately) · success (reflected post-confirm) · warning (constraint / stale / kill-switch note) · error (in-app fails → "withdraw on-chain"). **DT + MO.**
80. **Withdraw — degraded-mode variant** (`/vault/withdraw` degraded `route` requirement): promotes on-chain Path B; "withdraw never depends on us". **States:** degraded-default · loading. **DT + MO.**
81. **Caps meter (shared component)** (per-user + vault TVL; "why caps?"). **States:** default · near-limit (amber ≥80%) · at-cap ("Cap reached — new deposits paused; withdrawals unaffected") · loading · read-error (last-known + retry). **DT + MO.**
82. **Caps-reached & kill-switch (deposit-blocking, withdraw-preserving) states** (full treatment on detail + deposit panel): caps-reached (disabled deposit + "still withdraw / waitlist") · kill-switch-active ("new deposits paused, withdrawals never paused" + working withdraw path). **DT + MO.**

---

## 8. Execution Confirmation & Simulation (Flow 6) — `02-flows/06-execution-confirmation-simulation.md`

> The single shared sign gate `/confirm/[txIntentId]`. Tenderly-style sim + guardrail checklist + sign-disabled-until-acks. Reached only contextually (never browsed). Each lifecycle state is a designed screen.

83. **Confirm surface — desktop** `/confirm/[txIntentId]` (two-pane: left "what happens" / right "decision rail" with gated Sign). **DT.**
84. **Confirm surface — mobile** (single column stacked + sticky bottom sign bar; overlay = bottom `Sheet`). **MO.**
85. **Confirm overlay variant** (`Dialog` desktop / `Sheet` mobile when opened from chat/panel, with scrim). **States:** default. **DT + MO.**
86. **A. Simulating (loading)** — skeleton results, "Simulating…", Sign disabled. **DT + MO.**
87. **B. Success — simulation passed (ready to sign)** — green banner, all guardrails ✓, Sign enabled (one deliberate action). **DT + MO.**
88. **C. Warning — acknowledge-before-sign** — amber banner + specific ack checkboxes + counter; Sign disabled until all checked. (Includes caps-near-limit warn variant.) **DT + MO.**
89. **D. Blocked — cannot proceed (no override)** — red banner + offending guardrail row + **remedy** (reduce amount / lower slippage / Edit); Sign never enables. (Includes kill-switch-paused-deposit framed as paused-not-failed.) **DT + MO.**
90. **E. Signing / pending** — "Waiting for your signature…" → "Submitting…" → "Confirming on Base…" + tx-hash chip; bundle = progress stepper. **DT + MO.**
91. **F. Success — confirmed receipt** — plain non-celebratory + check-draw; result summary + tx hash/explorer + link-back-to-originating-rec + "See it in portfolio/activity". **DT + MO.**
92. **G/H/I error family** — failure/retry (on-chain revert/submission fail) · user-rejected (neutral "Nothing moved") · simulation-error ("won't sign blind", retry) · not-found/expired txIntent · degraded/withdraw-protection (elevate Path B). **DT + MO.**
93. **Approvals + bundled multi-step preview** (exact-default vs unlimited-flagged approval control; ordered per-step bundle with per-step simulated deltas; signature model stated up front). **States:** default (exact) · unlimited-selected (+ack) · already-approved (step dropped) · per-step block. **DT + MO.**
93a. **Confirm/bridge variant (Base ↔ Sui)** `#/confirm/bridge` (the bridge runs **this same gate**, §3-ter: headline naming **source→destination network**; balance-change table **out-on-source / in-on-destination** with per-row network labels; bridge fee + ETA estimate-framed; guardrail checklist = **allowlisted-route + per-network cap + per-bridge cap + policy + simulation**; **"Sign bridge"** gated on acks; **"Bridge initiated — track it ↗"** success with source tx hash + tracking link; **fully self-custodial** — sign lock/burn on source, receive in own wallet on destination, never custodied in transit; "Details" reconciles both legs on-chain). Reached from `#/bridge` or the chat bridge intent (chat-initiated → renders inline #57). **States:** A simulating · B passed/ready-to-sign · C warning/acknowledge (near per-network/per-bridge cap, elevated/stale route) · D blocked (over cap / route unavailable / not-allowlisted — remedy, no override) · E signing/pending · F success (bridge initiated + tracking) · G/H/I error family · expired txIntent. **Scope flag (logged):** Sui-side account/vault architecture (non-EVM/Move) + the bridge mechanism/provider are a **follow-on increment** — single canonical route, no fabricated Sui contract spec. (`06` §3-ter; Flow 12 §5.) **DT + MO.**

> Also design the **power-user "Details" accordion** (raw deltas / decoded events / calldata / addresses in mono + explorer) as an expandable state of #83/#84.

---

## 8-bis. Bridge (Multi-Network, Flow 12) — `02-flows/12-bridge-multinetwork.md`

> **Client-directed multi-network increment** (supersedes "Base only"): **Base at launch (live), Sui as the designated fast-follow** (no third network). The persistent **network switcher** is in §0 (#5a). The dedicated **Bridge** surface (`#/bridge`) builds a bridge `txIntent` → **`#/confirm/bridge`** (#93a) — **no signing here**. **Fully self-custodial:** sign a lock/burn on the source, receive in your **own** wallet on the destination, **never custodied in transit**; **withdraw-always holds on every network**. **Scope flag (logged):** the Sui-side account/vault architecture (non-EVM/Move) + the bridge mechanism/provider are a **follow-on increment** (single canonical route, no fabricated Sui contract spec).

93b. **Bridge surface — desktop** `#/bridge` (centered single-purpose card: title + custody promise · From block [source network + asset picker USDC/ETH + amount + Max] · **flip control** · To block [destination network + est. received] · route/fee/ETA preview · **"how custody is preserved" explainer** · per-network/per-bridge caps meter · "Review bridge" → `#/confirm/bridge` · "Exit anytime" → `/trust/exit`). **DT.**
93c. **Bridge surface — mobile** (stacked, same order; network/asset selectors open as `Sheet`; explainer/"why caps?" as `Sheet`/`Popover`; **bottom-anchored "Review bridge" CTA** + "Exit anytime" link). **MO.**
93d. **Bridge-surface states** (applies to #93b/#93c): default (active network = source; asset USDC; empty amount; CTA disabled; custody explainer present) · empty/unfilled (invitation, not error; route/fee/ETA show the basis) · loading (route/fee/ETA quoting — **never `0`**, en-dash + "(calculated at simulation)"; custody explainer + "Exit anytime" render immediately) · success (none here — reflected post-confirm; "Bridge initiated… Track it ↗" toast already fired) · warning (near per-network/per-bridge cap · stale route/ETA · wrong-network · "Sui fast-follow" note) · error (insufficient asset / source gas / **route unavailable** "Couldn't load a bridge route. Your funds are safe and untouched." — no raw provider/RPC strings; withdraw unaffected on every network). **DT + MO.**
93e. **Asset / network selectors + flip control** (asset picker USDC/ETH; From/To network selectors Base/Sui with Live/Fast-follow status chips; same-network guard; the **flip** swaps source↔destination + re-quotes). **States:** default · open (menu/`Sheet`) · asset-unavailable-on-network (disabled + reason) · flipping (re-quote). **DT + MO.**
93f. **Route / fee / ETA preview + per-network/per-bridge caps + "how custody is preserved" explainer** (single canonical route; bridge fee itemized or en-dash-until-sim; source gas; est. received; ETA estimate-framed; caps meter healthy→caution(≥80%)→destructive with text equivalent + "why caps?"; explainer = the three legs + "who can move it in transit → no one but you" + both-network explorer links + withdraw-always note). **States:** default · quoting (skeleton; explainer renders immediately) · near-cap (amber) · at-cap (CTA disabled + "Max you can bridge now: {remaining}") · stale ("as of {time}") · read-error (last-known + retry; claims stand). **DT + MO.**

> The bridge **sign gate** is **not** a second sign UI — it is the shared Flow 6 gate (confirm/bridge variant #93a); the **chat bridge intent** is the bridge `ActionCard` (#53a) → inline confirm (#57). Bridge surface ships `loading.tsx`/`error.tsx` ("withdraw is still available on every network").

---

## 9. Automation / Session Keys (Flow 7) — `02-flows/07-automation-session-keys.md`

> Opt-in, scoped, instantly revocable. Per-action signing is the loud default. Grant = one signed action → `/confirm`. Revoke = instant, unilateral, SparkPoint-independent.

94. **Automation status hub — desktop** `/automation` (state banner + active-grant cards + CAN/CANNOT block + [Grant scoped access]). **DT.**
95. **Automation status hub — mobile** (stacked; bottom-anchored CTA only when empty-default). **MO.**
96. **Hub states** (applies to #94/#95): default-empty ("You sign every action" — reassuring, not a hard sell) · active (≥1 grant, live meters/countdown) · loading · success (post-grant) · warning (near-cap / near-expiry / kill-switch paused) · terminal (Exhausted / Expired / Revoked) · error · degraded (on-chain revoke promoted). **DT + MO.**
97. **Active-grant card** (title/status pill · scope chips · per-tx cap · usage meter · expiry countdown · last activity · [Manage]/[Revoke]). **States:** active · near-cap · near-expiry · exhausted · expired · revoked · loading. **DT + MO.**
98. **Grant / scope builder — desktop** `/automation/grant` (left: bounded-scope fields; right sticky: live scope summary + [Review & grant]). **DT.**
99. **Grant / scope builder — mobile** (fields → pinned scope summary → bottom-anchored CTA). **MO.**
100. **Grant states** (applies to #98/#99): default (conservative defaults) · editing/valid · out-of-bounds entry (clamp + helper) · loading (reading hard ceilings) · success (none — reflected post-confirm) · warning (kill-switch paused / degraded) · error (build failure / insufficient gas). **DT + MO.**
101. **Session-key detail + INSTANT REVOKE** `/automation/[sessionKeyId]` (full scope read-out · usage meters · expiry · activity-under-key · provenance/proof · pinned [Revoke access] + `AlertDialog` · on-chain revoke instructions for degraded mode). **States:** active/default · near-cap/near-expiry (warning) · exhausted · expired · revoked · loading (revoke renders immediately) · error/read-failure (revoke stays functional) · degraded (Path-B revoke promoted). **DT + MO.**

---

## 10. Trust & Safety — `05-trust-and-safety-ux.md`

> The non-custodial badge (#3) and prove-it panel (#4) are counted in §0. This section covers the Trust Center hub, the prove-it full page, and the escape hatch.

102. **Trust Center hub — desktop** `/trust` (sticky anchor nav + stacked sections + pinned [Withdraw/Exit]). **DT.**
103. **Trust Center hub — mobile** (stacked/accordion + sticky bottom [Prove it] + [Withdraw/Exit]). **MO.**
104. **Trust Center — Self-custody guarantees section** (five expandable guarantee cards: claim + on-chain mechanism + verified state + evidence link). **States:** default · loading · stale/read-error. **DT + MO.**
105. **Trust Center — Caps dashboard section** (per-user cap · vault/TVL cap · per-tx cap · session-key caps; meters + "why caps?"). **States:** default · near-limit (amber) · at-cap · loading · read-error. **DT + MO.**
106. **Trust Center — Kill-switch status section** (state pill inactive/active · CAN/CANNOT scope always shown · controller/multisig transparency · when-active reassurance + [Withdraw now]). **States:** inactive/nominal · active/paused (co-located working withdraw) · loading · read-error. **DT + MO.**
107. **Trust Center — Audits & risk ratings section** (audit list w/ [Read report] · "no audit yet" honesty · risk score + rationale · bug-bounty). **States:** default (audits present) · pending ("audit in progress") · unaudited-component (explicit) · loading · error (degrade to static). **DT + MO.**
108. **Prove-it full page `/trust/permissions`** (contract registry · live permission read table w/ raw-call accordions · allowance audit w/ per-row [Revoke approval] → `/confirm` · "reproduce this yourself" block). **States:** default · loading (exit/revoke never gated) · stale/refresh · read-error/RPC-down (withdraw stays prominent) · allowance-empty ("no standing approvals"). **DT + MO.**
109. **Self-custody guarantees page `/trust/guarantees`** (narrative + status version of the five guarantees). **States:** default · loading · stale/error. **DT + MO.**
110. **Escape-hatch hub `/trust/exit` — desktop** (Path A in-app + Path B on-chain no-frontend instructions + verification block + support note). **DT.**
111. **Escape-hatch hub `/trust/exit` — mobile.** **MO.**
112. **`/trust/exit` states** (applies to #110/#111): default (has position, Path A primary) · no-position/empty (Path B still documented) · loading (Path B renders immediately) · degraded (Path B promoted to primary) · kill-switch-active (paused; "withdrawals are not") · geo-blocked/not-whitelisted (Path B fully functional) · error (in-app path fails → Path B). **DT + MO.**
113. **Approval-management / allowance audit interaction** (`Table` of standing ERC-20 approvals; unlimited flagged amber; per-row revoke → `/confirm`). **States:** default (listed) · none ("no standing approvals") · loading · read-error · post-revoke (row "Revoked"). **DT + MO.**

---

## 11. SRK · Literacy · Outcome Log · Settings · Notifications — `02-flows/08-srk-literacy-outcomes-settings.md`

### SRK utility (`/srk`) — low-prominence, non-essential

114. **SRK page — desktop** `/srk` (Optional badge · balance card · "what SRK does" tabs · persistent non-essential `--info` callout · FAQ). **DT.**
115. **SRK page — mobile** (Optional badge → balance → accordion utilities → pinned non-essential callout → FAQ). **MO.**
116. **SRK states** (applies to #114/#115): default-connected-holds · default-connected-zero ("you don't need it") · empty/not-connected · loading · stale/degraded · error (balance load fail; funds/withdraw unaffected). **No price/buy/market state, by design.** **DT + MO.**

### Financial-literacy (`/learn`, `/learn/[slug]`, injected TipCard)

117. **Learn hub — desktop** `/learn` (search + category filter + `LessonCard` grid by category: Basics/Yield/Risk & safety/Custody & control). **DT.**
118. **Learn hub — mobile** (pinned search + category chips/accordion + stacked LessonCards). **MO.**
119. **Learn hub states** (applies to #117/#118): default · empty/no-results ("try a different search" + clear) · loading (skeleton grid) · degraded (still readable). **DT + MO.**
120. **Lesson detail `/learn/[slug]`** (3-layer disclosure: definition → why-it-matters-to-you → optional "Go deeper" accordion; related lessons; "back to where you were"; custody lessons link to live `/trust` proof). **States:** default · loading (skeleton text) · not-found (bad slug → browse all). **DT + MO.**
121. **Contextual `TipCard`** (canonical injected unit; info tone marker · plain title · ≤2-sentence body · single "How this works" · dismiss). **States:** default · dismissed (no re-nag). (Also rendered inside chat/portfolio/strategy/confirm.) **DT + MO.**

### Outcome Log (`/activity`, `/activity/[entryId]`) — the accountability surface

122. **Outcome Log list — desktop** `/activity` (summary strip · filter bar · outcome table). **DT.**
123. **Outcome Log list — mobile** (summary strip · Filters Sheet · stacked OutcomeCard rows). **MO.**
124. **Outcome Log list states** (applies to #122/#123): A default (entries) · B empty-no-history ("No moves yet") · C empty-filter-excludes-all (clear) · D loading · E pending/settling rows · F stale/degraded · **G net-negative summary shown plainly** (honesty test) · H error. **DT + MO.**
125. **Outcome Log filters** (Outcome All/Wins/Losses/Pending — "Losses" first-class · Asset · Protocol · Time · Sort). Desktop inline / mobile `Sheet`. **States:** default · active-filters · no-results. **DT + MO.**
126. **Outcome entry detail — desktop** `/activity/[entryId]` (left: realized PnL + sparkline + "what happened" + on-chain-proofed timeline + realized/unrealized attribution; right: original-advice link w/ AI-suggestion badge + position link + actions). **DT.**
127. **Outcome entry detail — mobile** (stacked: PnL headline → what happened → advice link → position link → timeline accordion → actions). **MO.**
128. **Outcome entry detail states** (applies to #126/#127): default-win · default-loss · pending/settling · loading · stale · not-found/expired (→ all activity) · error. **DT + MO.**

### Settings (`/settings` + sub-routes)

129. **Settings index — desktop** `/settings` (section nav tabs + active-section form panel). **DT.**
130. **Settings index — mobile** (list of sections → each opens its own sub-screen; sticky Save per sub-screen). **MO.**
131. **Settings — Account `/settings/account`** (connected wallet · smart account "sole owner/admin signer" · disconnect · beta status + caps meter). **States:** default · disconnect-confirm (custody/withdraw unaffected) · loading · stale · error. **DT + MO.**
132. **Settings — Plan & goals `/settings/mandate`** (current mandate · adjustable risk (scenario re-take/slider) · goals · "Save my plan" → re-runs review/confirm). **States:** default · editing/dirty (unsaved-changes guard) · saving · success ("Plan saved…") · validation-error · save-error · loading. **DT + MO.**
133. **Settings — Notifications `/settings/notifications`** (channels toggles · alert types + thresholds: drift/cap/big-move/kill-switch/outcome). **States:** default · editing/dirty · saving · success · error · loading. **DT + MO.**
134. **Settings — Appearance `/settings/appearance`** (theme Dark/Light/System + live preview; tabular always). **States:** default · changed (live preview) · saved. **DT + MO.**
135. **Settings — Security `/settings/security`** (active session keys + instant [Revoke access] `AlertDialog` · on-chain permissions → prove-it · withdraw/exit). **States:** default · revoke-confirm-dialog · post-revoke (mirrored to `/automation`) · loading · error. **DT + MO.**

### Notifications center (`/notifications`)

136. **Notifications center — desktop** `/notifications` (header + Mark-all-read + Adjust-thresholds + type filter + day-grouped rows w/ deep-links). **DT.**
137. **Notifications center — mobile** + **states (applies to both)**: default (has notifications) · empty/caught-up · empty/filter-excludes-all · loading · all-read · degraded ("may be delayed"; kill-switch/withdraw messaging unaffected) · error. **All alert types designed:** drift · cap-approaching · big-move · kill-switch event · transaction result · guardrail blocked · session-key expiry · outcome updated. **MO** (desktop = #136).

> Bell preview (`Popover`/`Sheet`) = #8 in §0. Toasts (`Sonner`) = #9 in §0; design success / blocked-or-error (+ "Nothing moved — funds untouched") / neutral-cancelled / info variants.

---

## 12. AI Swap (Flow 9) — `02-flows/09-ai-swap.md`

> Conversational ETH→USDC via **Aerodrome** on Base, reached from chat (no standalone route). The proposal lives in chat; the Preview/confirm **reuses Flow 6** (`/confirm`, #83–93) — only the swap-specific renderings are counted here. The net-new requirement is the **transparent ~20 bps routing fee** (range 15–30; optional first-N-free), surfaced honestly as a usage fee inside the user-signed swap (never a custody fee). **All state-changing signs funnel to `/confirm`.**

138. **Swap proposal card** (`ActionCard`, swap variant, in chat — faithful to the hub demo: Aerodrome · ETH→USDC · risk chip · expected out · routing-fee preview · "Preview the swap" → builds `txIntent` → `/confirm`). **States:** loading/routing (tool-step ticker; output/fee/min-received skeletons; no sign yet) · default/re-quoting (edit amount re-quotes) · warning (above-plan / large size / stale quote) · blocked (route not allowlisted / cap reached) · error (quote failed). **DT + MO.**
139. **Routing-fee line item & states** (the net-new honest fee surfacing, rendered in the proposal and in `/confirm` Cost & outcome; cross-ref §14/Flow 11 S1). **States:** standard ("SparkPoint routing fee · 0.20% · $X" + ⓘ usage-fee explainer) · **first-N-free** (struck rate + "$0.00 — first {n} free, {k} left") · loading/quoting ("— (calculated at simulation)", Sign disabled) · uncomputable/partial-sim (en-dash, Sign disabled). **DT + MO.** (Never collapsed behind a tap on mobile.)
140. **Swap Preview / confirm — swap-specific renderings** (reflected through Flow 6 `/confirm` #83–93; the swap payload: ETH−/USDC+ table · expected + minimum received · gas + explicit routing fee + net). **States:** C simulating · D passed/ready-to-sign · E warning/acknowledge (elevated-slippage ack: "price could move…I might receive as little as {X} USDC") · F blocked (slippage-cap exceeded / route not allowlisted — remedy only, no override) · G signing/pending (single sig for native ETH; wrap step enumerated if required). **DT + MO.**
141. **Swap success receipt + chaining card** (success: "Swap confirmed · received ≈ {Y} USDC · routing-fee-paid re-statement · View tx ↗"; **chaining card** = the hub-demo "put this USDC to work" offer → deposit into vault / supply to Aave). **States:** success · chaining-card-default · chaining-card-dismissed · outcome-written (→ `/activity`). **DT + MO.**
142. **Swap failure family + "How it works" trace** (swap-critical errors: **I slippage-exceeded-at-execution** ("prices moved past your cap, the swap was stopped to protect you — nothing moved") · J on-chain revert · K user-rejected (no fee charged) · L simulation-error (no blind sign) · M degraded (defer swap; withdraw stays elevated) · N expired `txIntent` · O insufficient-ETH helper) **+ the optional collapsed "How it works" SWAP-path architecture trace** (9-step plain-language trace; step ⑤ "you sign — nothing moves before this"; step ⑧ annotates the fee-leg; re-openable from the receipt). **States (trace):** collapsed (default) · expanded. **DT + MO.**

---

## 13. Subscriptions / Premium AI tier (Flow 10) — `02-flows/10-subscriptions-premium-srk.md`

> **Freemium.** The **free tier is fully capable** (assistant · portfolio · basic recs · the Aave Yield Vault deposit/earn/withdraw · swaps · withdraw-always · non-custodial — **no SRK**). **Premium is optional**, paid in **SRK** (the token's real utility), and **never gates the vault, deposits, or withdrawals**. Routes under `/premium/*`; the pay step funnels to `/confirm` (Flow 6). Surfaces A→K. Persistent non-essential callout; **no dark patterns** (cancel is one tap).

143. **Feature matrix — desktop** `/premium` (eyebrow "Optional — the free tier is fully capable" · plan toggle Monthly/Annual · **Free card** ($0, full free list) · **Premium card** ("{N} SRK/{term} ≈ $X" + "Everything in Free, plus:" + RiskChip-tiered advanced list · spark "Upgrade to premium") · persistent non-essential `AlertBanner` · "What counts as premium?" `Accordion`). **DT.**
144. **Feature matrix — mobile** (stacked matrix; free-first; sticky upgrade bar). Same state set as #145. **MO.**
145. **Feature-matrix states** (applies to #143/#144): default-free (spark upgrade live) · default-premium ("Your plan" + Manage, no second upsell) · empty/not-connected (fully readable; "Connect wallet to upgrade", no pressure) · loading (free list renders immediately; only SRK price/USD skeleton; never `0`/blank price) · warning (SRK price stale, "as of {time}") · error (price unavailable → "the free tier is unaffected · [Retry]", never block free). **DT + MO.**
146. **Upsell entry (inline, non-nagging)** (the only "push", only on **explicit touch** of a premium-only feature; dismissable `--info`/spark-subtle `Card` or quiet "Premium" `Badge` + tooltip; mirrors `TipCard` — dismiss persists, never re-nags; **banned:** modal-on-open/countdown/"limited"/"unlock now"/FOMO greying). **States:** default (offered) · dismissed (persists) · already-premium (no upsell). **DT + MO.**
147. **Plan select / upgrade** `/premium/upgrade` (plan + term + price recap · renewal-date preview · **auto-renew `Switch` default OFF** = "you re-sign each term"; if on = scoped/capped/revocable allowance · "what you're getting" recap · non-essential callout persists · spark [Continue to payment]). **States:** default · loading (price skeleton) · warning (annual selected, pro-rata note) · error (price unavailable → retry; free unaffected). **DT + MO.**
148. **Pay-with-SRK** `/premium/pay` (plan price "{N} SRK ≈ $X" ⓘ · **your SRK balance** read from chain · sufficiency check · **payment method `RadioGroup`: ● SRK default / ○ USDC fallback** (flag) · "what you'll sign" bundle = ① approve exact {N} SRK → ② pay · non-custodial reminder · [Review & sign] → `/confirm`). **States:** default (enough SRK) · **not-enough-SRK** (calm `--caution`: "need {Δ} more · [Get SRK]", sign disabled — normal state, never red failure) · loading (balance/price skeleton; withdraw/prove-it still reachable) · warning (SRK price moved, re-confirm) · error (balance read failed → "funds & free tier unaffected · [Retry] · [Verify ↗]", never pay blind) · not-connected ("Connect wallet to pay"). **DT + MO.**
149. **Subscription confirmation (receipt)** (post-`/confirm`; plain non-celebratory: "Premium is active until {renewal date} · Paid {N} SRK ≈ $X · View tx ↗" · what unlocked w/ deep-links · **non-essential reassurance restated** · `Sonner` mirror). **States:** success · pending (Flow 6 stepper) · partial (approve signed, pay pending — never "subscribed" until pay confirms). **DT + MO.**
150. **Manage subscription** `/premium/manage` (also `/settings` → Subscription) (plan summary + status pill · renewal + auto-renew state (off = "you'll re-sign" / on = scoped allowance + [Manage renewal access] → revoke via `/confirm`) · premium-usage `CapsMeter` rows · payment method + last tx ↗ · **[Cancel premium] always one tap** · non-essential reassurance). **States:** active (default) · auto-renew-on (allowance + revoke) · near-renewal (info, never threat) · canceled-but-active-until-date (+ [Resubscribe]) · loading · error ("vault & withdrawals unaffected · [Retry]", never block core). **DT + MO.**
151. **Cancel / downgrade** (sober neutral `AlertDialog`, **equally-weighted** [Cancel premium] / [Keep premium] — no pre-checked stay, no dimmed cancel, no retention maze; honest proration on annual↔monthly; "no silent charge" reinforced). **States:** confirm-dialog · success (canceled, active-until-date) · already-on-free (n/a) · error ("premium stays as-is; vault unaffected · [Retry]"). **DT + MO.**
152. **Acquire SRK hand-off** `/premium/get-srk` (premium-scoped; "to pay you need {N} SRK ({Δ} more)" · **honest acquisition routes only** (no price prediction / no "buy now to save" / no token theater) · stablecoin-fallback reminder ("pay in USDC instead", keeps SRK optional even for premium) · non-essential reminder). **States:** default (options) · already-enough (→ back to payment) · loading · error ("free tier & vault unaffected · [Retry]") · fallback-active (lead with USDC). **DT + MO.**
153. **Lapsed / expired + free-tier/empty** (graceful downgrade — the trust-critical state: term ends/renewal unsigned → calm `--info` banner "you're on the free tier now — fully capable · vault/deposits/yield/withdrawals never affected · [Renew premium]"; **no "account locked" ever**; lapsing never blocks deposit/withdraw/core help/escape hatch; premium-only features re-show the quiet "Premium" badge, no data destroyed; **free-tier/empty** = `/premium` shows the matrix with free celebrated, `/premium/manage` for non-subscriber redirects to matrix — free is a *complete state*, never an error). **States:** just-lapsed · long-lapsed (clean free, no nag) · auto-renew-failed (calm, core untouched) · default-free (matrix, no pressure). **DT + MO.**

---

## 14. Fee Transparency / Revenue Surfaces (Flow 11) — `02-flows/11-fee-transparency.md`

> **"We only earn when you earn — never on your principal, never by taking custody."** Five fee surfaces, one honesty standard: the same fee reads consistently pre-sign, on the receipt, on `/fees`, and in the portfolio. **Launch reality:** swap routing fee ~0.20%; **vault = 0% on principal / 0 management + active 10% profit-only HWM performance fee on yield (explicit, never blank)**; premium = a subscription payment (not a vault fee); performance fee = **active at launch, disclosed transparently.** The line item & receipt are renderings inside Flow 6/9 (#83–93, #138–142); only the dedicated fee surfaces are newly counted.

154. **Fee line item — cross-surface disclosure & states** (the SparkPoint-fee line in `/confirm` Cost & outcome, always itemized rate **and** USD, always pre-sign, never folded into "net"; cross-ref #139/Flow 9 §4). **States:** default-swap ("routing fee · 0.20% · $X") · default-vault ("SparkPoint performance fee: 10% of yield, profit-only, HWM — 0% on your principal" → ⓘ "only on yield above your high-water mark; never on your principal") · first-N-free (struck rate + $0.00 + remaining) · loading/quoting ("— (calculated at simulation)", Sign disabled) · uncomputable/partial-sim (en-dash, Sign disabled) · premium-payment ("n/a — subscription payment, not a vault fee"). **DT + MO** (never collapsed on mobile).
155. **"Fees & how we make money" page — desktop** `/fees` (leads with control + 0% on principal, never a number; four plain questions: what's free · what we charge today & why · what's optional (premium) · how the performance fee works (profit-only, HWM, 0% on principal); each w/ "how it's collected" + "verify it"; + the honesty chart). **DT.**
156. **"Fees & how we make money" page — mobile** (stacked sections, free-first). Same state set as #157. **MO.**
157. **`/fees` states** (applies to #155/#156): default (connected, has activity — honesty chart populated) · pre-deposit/no-activity (sections render; chart shows "You've paid $0 in fees" + flat baseline as an **EmptyState** invitation, never a dead `$0.00`) · public/pre-connect (`(public)/fees` mirror — no account data; "Connect to see your own fees") · loading (static sections render immediately; chart/account skeleton) · stale ("as of {time}"; policy text never stale) · read-error ("claims still stand — these fees live in the contracts, not this app · [Retry] · [Verify ↗]", never hide the page) · degraded (custody/exit unaffected; verify links work; withdraw elevated). **DT + MO.**
158. **"We only earn when you earn" honesty chart** (Recharts; user real **yield vs fees-paid** over time — the thesis visualized). **States:** default (populated) · empty ("You've paid $0 in fees" + flat user-yield baseline) · loading (skeleton) · stale · read-error (claims stand; figures retry). **DT + MO.**
159. **Per-action receipt fee line** (post-sign proof closing the honesty loop; in Flow 6 §F success + `/activity/[entryId]`). **States:** default (fee paid, shown + tx) · no-fee (deposit or withdraw with no yield above HWM — explicit "$0.00 (0% on your principal — none deducted)", never blank) · vault-withdraw ("Performance fee: $X — 10% of realized yield, profit-only, 0% on principal") · first-N-free ($0.00 + struck original) · subscription (price, "not a vault fee") · loading (fee-value skeleton; rest of receipt renders) · error ("fee as disclosed pre-sign: $X" + retry, never a fabricated number). **DT + MO** (toast carries headline only, not fee detail).
160. **Performance-Fee Disclosure component (active at launch on the Aave vault)** (reusable; ships live disclosing **10% profit-only / HWM / 0% on principal** (configurable on-chain, hard-capped 20%, timelocked, ratified by amendment v1.1.0); the same component scales to future opt-in advanced vaults; the user-facing twin of admin HWM-status #168; calm/semantic, **never red, never spark**). **States:** **active (default — what ships)** (explains profit-only + high-water-mark + never-on-principal + 10% rate (timelocked, hard-capped 20%); **"0% on your principal" prominent**; live HWM read · recipient · cumulative fees · net-of-everything APY) · below-HWM ("no fee right now…we only earn when you're back in profit") · loading · read-error ("enforced on-chain, not by this app"; never blocks withdrawal). **DT + MO.**
161. **Fees in portfolio & Outcome Log (fee-aware states)** (net-of-everything PnL; "fees paid to date" legible; vault rows show the profit-only performance fee / 0% on principal; per `03` / `05` §8 / `08` §C). **States:** default (fees legible in net) · vault-row-no-fee ("$0.00 — no yield above HWM; 0% on principal", explicit) · loading · stale ("as of {time}") · error (figures retry; PnL never silently drops a fee). **DT + MO.**

---

## 15. Admin / Stakeholder Panel (separate, separately-gated surface) — `../admin-panel/design-spec.md` (+ `../admin-panel/README.md`)

> **Not part of the end-user `(app)`.** A **secret, admin-only** surface under an unguessable base path, **SSO + 2FA + allowlist** (no wallet-connect), **READ-ONLY OVER FUNDS** (no key custody, builds no transactions; only *displays* the pause-only kill-switch status). Audiences = **Ops / Stakeholder / Client**, RBAC-scoped. Centerpiece = a graphical **Revenue dashboard**. **Desktop-first** (tablet/phone responsive, but DT is primary). Un-allowlisted requests get a **404, never these screens**. 12 admin screens A0–A11; each ships the standard states + admin-specific ones (`no-permission (404)` · `step-up-required` · `partial-source-error` · `confirm-change (audited)` · `export-mode`).

162. **A0 — Login (SSO / 2FA)** `/login` (centered card; SSO button (only spark CTA) · 2FA challenge (TOTP/WebAuthn) · audited-access note; **no forgot-password / sign-up / wallet-connect**; "Signing in gives you a window, not a lever"). **States:** default · 2FA-challenge · error (no account enumeration) · locked-out/rate-limited · denied (generic, secrecy-preserving). **DT** (responsive).
163. **A1 — Overview / Home** `/` (north-star KPIs for Super-Admin/Ops, curated → Stakeholder). **States:** loading · empty (pre-launch) · error · partial-source-error. **DT** (responsive).
164. **A2 — User analytics** `/users` (user KPIs, funnel, cohorts). **States:** loading · empty · error · **no-permission (404)**. **DT** (responsive).
165. **A3 — Per-user drilldown** `/users/[ref]` (observe one user, step-up-gated; read-only). **States:** loading · empty · error · no-permission · **step-up-required**. **DT** (responsive).
166. **A4 — Usage / product analytics** `/usage` (AI & product mechanics). **States:** loading · empty · error · no-permission. **DT** (responsive).
167. **A5 — TVL & vault analytics** `/tvl` (the money view). **States:** loading · empty (no deposits) · error. **DT** (responsive).
168. **A6 — Revenue dashboard (CENTRAL — the centerpiece)** `/revenue` (graphical: revenue by stream over time · cumulative · trajectory/forecast · MRR/ARR · per-user/per-vault · **HWM status** · fee-vs-TVL · the **"we only earn when you earn" user-yield-vs-protocol-revenue** view — the admin twin of the user-facing honesty chart #158 / perf-fee disclosure #160). **States:** loading · **empty/pre-revenue** · error · partial-source-error. **DT** (responsive).
169. **A7 — System / ops health** `/system` (health & guardrails; displays pause-only kill-switch status, builds nothing). **States:** loading · healthy-empty · error (monitoring-down) · no-permission. **DT** (responsive).
170. **A8 — Stakeholder / Client Overview** `/overview` (curated narrative; default for Stakeholder/Client; SA/Ops preview). **States:** loading · empty (launching-Sept) · error · **export-mode**. **DT** (responsive).
171. **A9 — Admin management** `/admin/users` (Super-Admin manages admins/roles). **States:** loading · error · no-permission. **DT** (responsive).
172. **A10 — Non-custodial config** `/admin/config` (whitelist invites, feature flags — directs, never custodies). **States:** loading · error · no-permission · **confirm-change (audited)**. **DT** (responsive).
173. **A11 — Admin audit log** `/admin/audit` (forensics; every admin action). **States:** loading · empty · error · **step-up-required** · no-permission. **DT** (responsive).
174. **Admin shell + responsiveness + non-custody touchpoints** (the admin shell on every screen: secret-path chrome · RBAC-scoped nav · env badge · "read-only over funds" posture made visible; the **read-only/no-custody banner** the surface restates; tablet/phone responsive transforms). The **left side-nav carries the theme toggle pinned at its bottom, styled like a nav item** (sun/moon + Light/Dark; writes `sp-theme`, in sync with the app #14a and onboarding #31 toggles — admin honors the same dark-default + light-supported contract, `04` → "Theming"). **States:** default · RBAC-scoped (nav/sections vary by role) · degraded/partial-source · responsive (tablet · phone) · light-theme. **DT** primary (tablet + phone responsive).

---

## Coverage map — every `01` route accounted for

- **(public):** `/` #15 · **Spark Core landing #15a** (animated; flavor Ember/Plasma/Constellation = open client choice) · `/how-it-works` #16 · `/trust` #17 · `/security` #18 · `/legal/*` #19–21 · `/waitlist` #22.
- **(auth):** `/connect` #25 · `/verify` #26 · `/unavailable` #27.
- **(onboarding):** `/onboarding` (+ goals/risk/review/mandate) #31–40.
- **(app) primary:** `/chat`, `/chat/[threadId]` #41–57 (+ bridge `ActionCard` #53a) · `/portfolio`, `/portfolio/positions/[id]` #58–64 · `/strategies`, `/strategies/[recId]` #65–72 · `/vault`, `/vault/deposit`, `/vault/withdraw` #73–82 · `/confirm/[txIntentId]` #83–93 (+ confirm/bridge `#/confirm/bridge` #93a) · **`/bridge` (`#/bridge`) #93b–93f (Flow 12, multi-network)**.
- **(app) shell (multi-network):** the persistent **network switcher** (Base/Sui, active indicator, per-network wallet address) #5a — present on every `(app)` route (`01` §2).
- **(app) supporting:** `/trust`, `/trust/permissions`, `/trust/guarantees`, `/trust/exit` #102–113 · `/automation`, `/automation/grant`, `/automation/[sessionKeyId]` #94–101 · `/activity`, `/activity/[entryId]` #122–128 · `/learn`, `/learn/[slug]` #117–121 · `/srk` #114–116 · `/notifications` #136–137 · `/settings` (+ account/mandate/notifications/appearance/security) #129–135.
- **(app) additive surfaces:** **AI Swap** (in-chat; Preview reuses `/confirm`) #138–142 · `/premium` (+ `/premium/upgrade`, `/premium/pay`, `/premium/manage`, `/premium/get-srk`; pay reuses `/confirm`) #143–153 · `/fees` (+ `(public)/fees` mirror; line item & receipt reflected via `/confirm` #83–93) #154–161.
- **Admin / Stakeholder Panel** (a **separate, separately-gated surface**, not part of `(app)`): `/login` · `/` · `/users` · `/users/[ref]` · `/usage` · `/tvl` · `/revenue` · `/system` · `/overview` · `/admin/users` · `/admin/config` · `/admin/audit` (under the secret base path) #162–174 — spec: `../admin-panel/design-spec.md`.
- **Per-route state files** (`loading.tsx`/`error.tsx`/`not-found.tsx`/degraded) covered by the global patterns #10–13 plus per-screen state sets above; the **degraded-mode variants** required for `/vault/withdraw` (#80), `/trust/exit` (#112), and `/confirm` (#92) are called out explicitly.

---

## Production reminders (per screen, every screen)

1. **Both breakpoints** unless explicitly DT-only or MO-only.
2. **All listed states**, each with on-spec copy from `07` (which wins on any wording conflict).
3. **Non-custody ≤1 tap:** badge → prove-it (#4) and a withdraw/exit path reachable; never removed by any error/degraded state.
4. **Single confirm funnel:** any state-changing action routes to `/confirm` (#83–93); no bespoke sign UI.
5. **`Dialog → Sheet/Drawer` on mobile;** 44px touch targets; thumb-reachable primaries; visible 2px spark focus ring.
6. **Numbers:** tabular numerals everywhere financial; net APY never bare (breakdown ≤1 tap); PnL = sign + color + icon + window; en-dash = unknown, `$0.00` = real zero; no `0`-as-loading; stale labeled "as of {time}".
7. **Color discipline:** spark scarcity (≤1 spark CTA/view; spark = AI presence/primary/focus only); strict semantics; risk palette is its own system (never green/red); semantic state never color-only.
8. **Reduced-motion** honored; AA contrast both themes; charts have text/table alternatives.

---

## Cross-references

- **Routes / shell / nav / gating / degraded / flow graph:** `01-information-architecture.md` §1, §2, §3, §4, §6.
- **Per-screen anatomy, copy, benchmarks, acceptance:** the owning flow spec in `02-flows/` (`01` onboarding · `02` chat · `03` portfolio · `04` strategies · `05` vault · `06` confirmation · `07` automation · `08` SRK/literacy/outcomes/settings/notifications · `09` AI swap · `10` subscriptions/premium · `11` fee transparency · **`12` multi-network + bridge**).
- **Multi-network + bridge (network switcher, Bridge surface, confirm/bridge, chat bridge intent, fully-self-custodial framing, per-network/per-bridge caps, the Sui/bridge-mechanism follow-on flag):** `02-flows/12-bridge-multinetwork.md` + `06` §3-ter (the sign-gate variant) + `02` §7.2-bis/§7.6 (chat intent + inline confirm) + `docs/INCREMENT-multi-network.md`.
- **Trust surfaces (badge, prove-it, Trust Center, escape hatch, friction model, outcome accountability):** `05-trust-and-safety-ux.md`.
- **Tokens, components, charts, motion, a11y, shadcn map:** `04-design-system.md`.
- **All canonical wording / number & PnL & APY formatting / banned & required phrases:** `07-content-and-tone.md` — **wins on any conflict.**
- **Benchmarks:** `09-references.md`.
