---
description: "Task list for the SparkPoint Web App — Faithful UI Build"
---

# Tasks: SparkPoint Web App — Faithful UI Build

**Input**: Design documents from `specs/002-web-app-ui/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ui-contracts.md ✓, quickstart.md ✓
**Normative source of truth**: `docs/design-handover/showcase/` — where this list and the showcase disagree, **the showcase wins**.

**Tests**: Not requested as TDD. A single Playwright **smoke** task (route-load + entry-flow + theme-persist) is included in Polish per plan.md's testing note; per-story test phases are intentionally omitted.

**Organization**: Tasks grouped by user story (spec.md priorities). The **P1 MVP = US1 + US2 + US3 + US7** (entry → shell → core money screens → theme/responsive fidelity) — the faithful scaffold the client expects.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]** = parallelizable (different files, no incomplete-task dependency)
- **[Story]** = US1..US7 (user-story phases only)
- All paths are under `apps/web/` unless noted.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the target structure and remove the diverged scaffold artifacts that will be rebuilt.

- [X] T001 Read & catalog the showcase source-of-truth so every task ports rather than re-derives: `docs/design-handover/showcase/{tokens.css, app.css, SparkPoint.html, Spark Core Landing.html, SparkPoint Admin.html, flows/Onboarding.html, screens/*.js}` — record per-route markup/classes/copy and the `SP.data` shape.
- [X] T002 Verify/add runtime deps in `apps/web/package.json` (`next-themes`, `lucide-react`, `recharts`; `wagmi`/`viem` present but inert) and run `pnpm install`.
- [X] T003 [P] Remove diverged components to be rebuilt: delete `apps/web/src/components/{screen-stub.tsx, app-shell.tsx, admin-shell.tsx, theme-toggle.tsx}` (keep `providers.tsx`, `spark-mark.tsx`, `lib/wagmi.ts`, `lib/utils.ts` for revision).
- [X] T004 Create the target source tree (empty dirs/index barrels): `apps/web/src/components/{shell,overlays,admin,ui,screens}/` and `apps/web/src/lib/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The visual system + shared state/atoms/overlay framework every screen depends on.

**⚠️ CRITICAL**: No user-story screen work can begin until this phase is complete.

- [X] T005 Port `tokens.css` verbatim-faithfully into `apps/web/src/app/tokens.css` (color/type/spacing/radius/elevation + `--risk-1..5`), reconciling the existing `.light`/`.dark` token sets so both themes resolve.
- [X] T006 Port `app.css` (shell + atom classes `.appshell/.topbar/.brand/.primnav/.pill/.iconbtn/.avatar-btn/.disclaimer/.layout/.railnav/.navlink/.main/.page/.pagehead/.card/.stat/.riskmeter/.riskchip/.seg/.tbl/.field/.input/.switch/.scrim/.sheet/.dialog/.toast/.proveitem/.cancan/.empty/.guard/.tabbar` + the `@media max-width:1023px` rules) into `apps/web/src/app/globals.css` and import `tokens.css`.
- [X] T007 Collect each `screens/*.js` `<style>` block into co-located `apps/web/src/components/screens/*.css` (or appended sections of `globals.css`), preserving class names.
- [X] T008 [P] Create `apps/web/src/lib/mock-data.ts` — the single typed `SP.data` mirror (wallet, networks [Base/Sui both live], bridgeAssets, mandate, netWorth, pnl, idleUSDC, vault [`netApy 3.87`/`supplyApy 4.3`/`perfFee 10`/HWM], allocation, series1M, apyHist, recs, outcomes, notifications, txs, sessionKey=null) per `contracts/ui-contracts.md`.
- [X] T009 [P] Create `apps/web/src/lib/nav.ts` — PRIMARY (chat/portfolio/vault/strategies) + SECONDARY rail (bridge/trust/automation/outcomes/fees/premium/learn/srk/settings) + Withdraw/Exit config and the design→route map.
- [X] T010 [P] Create `apps/web/src/lib/network.tsx` — client context for active network (Base/Sui, default base) + mock session (per-network wallet address).
- [X] T011 [P] Revise `apps/web/src/lib/utils.ts` — `cn()`, `money()/fmt()` (tabular numerals), `riskTier()` lookup (0..5 → label + `--risk-*`).
- [X] T012 Verify theme wiring in `apps/web/src/components/providers.tsx` (next-themes `attribute="class"`, `storageKey="sp-theme"`, `defaultTheme="dark"`, no FOUC) and `apps/web/src/app/layout.tsx` (`suppressHydrationWarning` on `<html>`, fonts).
- [X] T013 [P] Create `apps/web/src/components/ui/icon.tsx` — map the design's inline lucide-style icon set (spark/chat/portfolio/vault/shieldcheck/key/wallet/command/bell/door/pause/flask/zap/activity/coins/book/sliders/sun/moon/…) to `lucide-react`.
- [X] T014 [P] Revise `apps/web/src/components/ui/spark-mark.tsx` — brand spark-mark, faithful coral→gold→blue gradient.
- [X] T015 [P] Create UI atoms in `apps/web/src/components/ui/` — `pill.tsx`, `risk-chip.tsx`, `risk-meter.tsx`, `stat.tsx`, `seg.tsx`, `guard-item.tsx`, `card.tsx` — emitting the ported design classes.
- [X] T016 Create `apps/web/src/components/overlays/OverlayProvider.tsx` — client context (`openProveIt/openWalletMenu/openNetworkMenu/openNotifications/openCommandPalette/toast`) + single portal mount + `Sheet`/`Dialog`/scrim primitives + `Toaster`, with the design's open/dismiss transitions (bottom-sheet on mobile). Overlay *contents* land in US2.

**Checkpoint**: Visual system, mock data, contexts, atoms, and the overlay framework are ready — user stories can begin.

---

## Phase 3: User Story 1 - Public entry → first-run onboarding (Priority: P1) 🎯 MVP

**Goal**: A first-time visitor goes landing → connect (simulated) → onboarding → into the app, with no dead ends, matching the design.

**Independent Test**: Start at `/`, "Launch app", pick a wallet on Connect, complete every onboarding step, arrive in Chat.

- [X] T017 [US1] Reproduce the **Spark Core marketing landing** (dark-only, faithful static rendition incl. chapters/gradient; honor reduced-motion) in `apps/web/src/app/page.tsx` + `apps/web/src/components/screens/landing/` from `Spark Core Landing.html`, with a "Launch app" → `/connect`.
- [X] T018 [P] [US1] Build the **Connect** screen in `apps/web/src/app/(public)/connect/page.tsx` from `screens/public.js` — simulated Coinbase/WalletConnect/MetaMask options that proceed to onboarding.
- [X] T019 [P] [US1] Build the **verify** screen in `apps/web/src/app/(public)/verify/page.tsx` from `screens/public.js`.
- [X] T020 [US1] Build the **onboarding focused layout** (brand spark-mark + "Fully self-custodial" + theme toggle + "Save & exit") in `apps/web/src/app/onboarding/layout.tsx` from `flows/Onboarding.html`.
- [X] T021 [US1] Build the **onboarding stepped flow** (welcome → goal → risk tolerance → mandate → first-recommendation preview → "Enter SparkPoint") with step indicator + back/forward + Save&exit in `apps/web/src/app/onboarding/page.tsx`; "Enter" → `/chat`; writes the chosen mandate into the mock session.

**Checkpoint**: The full pre-app journey works end-to-end and matches the design.

---

## Phase 4: User Story 2 - The authenticated app shell & overlays (Priority: P1)

**Goal**: The faithful shell frames every screen; every control and overlay matches the design and opens/closes correctly.

**Independent Test**: From any `(app)` route, exercise every nav target, pill, switcher, and overlay.

- [X] T022 [US2] Build the **AppShell** layout composing the shell + the OverlayProvider mount in `apps/web/src/app/(app)/layout.tsx`.
- [X] T023 [P] [US2] Build **TopBar** in `apps/web/src/components/shell/TopBar.tsx` (brand spark-mark; self-custodial pill→Prove-it; network switcher trigger; wallet pill; ⌘K button; bell+unread count; avatar button).
- [X] T024 [P] [US2] Build **PrimaryNav** (Chat/Portfolio/Vault/Strategies + active state) in `apps/web/src/components/shell/PrimaryNav.tsx`.
- [X] T025 [P] [US2] Build **DisclaimerStrip** ("The AI proposes. Guardrails check it. You sign it." + Prove it / How we make money / Exit anytime links) in `apps/web/src/components/shell/DisclaimerStrip.tsx`.
- [X] T026 [P] [US2] Build **TrustRail** ("Trust & control": Bridge, Trust Center, Automation, Outcome Log [badge], Fees, Premium, Learn, SRK, Settings + distinct Withdraw/Exit) in `apps/web/src/components/shell/TrustRail.tsx`.
- [X] T027 [P] [US2] Build **MobileTabBar** (Chat/Portfolio/Vault/Strategies/More) + the **More** sheet (secondary rail items + Withdraw/Exit + Prove-it) in `apps/web/src/components/shell/MobileTabBar.tsx`.
- [X] T028 [US2] Build **ProveItSheet** (Can/Can't columns + five structural guarantees + links to permissions/exit) in `apps/web/src/components/overlays/ProveItSheet.tsx`.
- [X] T029 [P] [US2] Build **WalletMenu** (address + copy/view/permissions/switch/disconnect) in `apps/web/src/components/overlays/WalletMenu.tsx`.
- [X] T030 [P] [US2] Build **NetworkMenu** (Base/Sui both live, active checked, switch updates active-network + wallet address, "Bridge assets between networks" shortcut) in `apps/web/src/components/overlays/NetworkMenu.tsx`.
- [X] T031 [P] [US2] Build **NotificationsSheet** (unread markers, count drives bell badge) in `apps/web/src/components/overlays/NotificationsSheet.tsx`.
- [X] T032 [P] [US2] Build **CommandPalette** (⌘K — searchable actions/screens, bound to keyboard + the TopBar button) in `apps/web/src/components/overlays/CommandPalette.tsx`.
- [X] T033 [P] [US2] Build **AvatarMenu** (account/settings/mandate/learn + light/dark theme toggle row + log out) in `apps/web/src/components/overlays/AvatarMenu.tsx`.
- [X] T034 [US2] Register all overlays + toasts in `OverlayProvider` and wire every TopBar/rail trigger to them (depends on T016, T028–T033).

**Checkpoint**: The shell + all six overlays render and behave faithfully on desktop and mobile.

---

## Phase 5: User Story 3 - Core money screens: Chat, Portfolio, Vault (Priority: P1)

**Goal**: The core loop (understand → decide → act) — Chat, Portfolio, Vault, and the simulation-backed confirm gate.

**Independent Test**: Open Chat/Portfolio/Vault; run a vault deposit and withdraw; each routes through the trust gate ending in success.

- [X] T035 [US3] Build the shared **ConfirmFlow** (simulation → balance-changes table → guardrail checklist → **ack-gated, disabled Sign** → signing → success/receipt; "nothing moves until you sign") parameterized by `intent` and `mount` ('route'|'inline') in `apps/web/src/components/ui/ConfirmFlow.tsx` from `screens/confirm.js`.
- [X] T036 [US3] Mount ConfirmFlow at the route in `apps/web/src/app/(app)/confirm/[intent]/page.tsx`.
- [X] T037 [US3] Build **Chat** (assistant + structured recommendation/action/snapshot/tip/outcome cards + tool-step "thinking"; chat-initiated deposit/swap/bridge renders ConfirmFlow **inline in the thread**) in `apps/web/src/app/(app)/chat/page.tsx` + `apps/web/src/components/screens/chat/` from `screens/chat.js`.
- [X] T038 [US3] Build **Portfolio** (net worth + over-time chart [Recharts], risk panel, allocation by asset/strategy/risk tier, positions table) in `apps/web/src/app/(app)/portfolio/page.tsx` from `screens/portfolio.js`.
- [X] T039 [P] [US3] Build the **position detail** view in `apps/web/src/app/(app)/portfolio/[positionId]/page.tsx`.
- [X] T040 [US3] Build **Vault** (Aave Yield Vault: net-APY breakdown incl. **10% performance fee over a high-water mark**, net 3.87% vs 4.3% gross, shares, caps, TVL) in `apps/web/src/app/(app)/vault/page.tsx` from `screens/vault.js`.
- [X] T041 [US3] Build the Vault **deposit** + **withdraw** panels (live shares preview, caps-reached state, withdraw-always framing) in `apps/web/src/app/(app)/vault/deposit/page.tsx` and `apps/web/src/app/(app)/vault/withdraw/page.tsx`, routing state changes through ConfirmFlow.

**Checkpoint**: The product's core money loop is fully functional through the trust gate. **MVP-functional with US1 + US2 + US7.**

---

## Phase 6: User Story 7 - Theme & responsive fidelity (Priority: P1, cross-cutting)

**Goal**: One persisted light/dark theme and faithful layout at 390px + 1440px across all built surfaces.

**Independent Test**: Toggle theme from app/onboarding (and admin once built); reload → persists, no flash; view screens at 390px and 1440px.

- [ ] T042 [US7] Verify theme parity + persistence (single `sp-theme` key, default dark, **no flash before first paint**) across the avatar menu and the onboarding header; landing stays dark-only. (Re-verified for admin in US6.)
- [ ] T043 [US7] Responsive QA pass on the P1 surfaces (landing/connect/onboarding/shell/chat/portfolio/vault) at **390px** (rail→bottom tab bar, sheets/dialogs from bottom, no horizontal overflow) and **1440px** (rail + top nav); fix divergences in the ported CSS.
- [ ] T044 [US7] Fidelity audit: **tabular numerals** on all financial figures + the brand spark-mark gradient correct everywhere.

**Checkpoint**: The P1 app is a faithful, responsive, themed match of the design — ready for side-by-side review.

---

## Phase 7: User Story 4 - Strategies, Trust Center, Bridge & confirm variants (Priority: P2)

**Goal**: Ranked strategies, the Trust Center (prove-it / withdraw-always exit / automation), and Base↔Sui bridge.

**Independent Test**: Open Strategies, Trust Center (+permissions/exit/automation), Bridge; run a swap and a bridge through the gate.

- [X] T045 [P] [US4] Build **Strategies** (recommendations ranked vs the mandate + "why this?" rationale) in `apps/web/src/app/(app)/strategies/page.tsx` from `screens/strategies.js`.
- [X] T046 [US4] Build **Trust Center** + **permissions** + **exit** in `apps/web/src/app/(app)/trust/page.tsx`, `trust/permissions/page.tsx`, `trust/exit/page.tsx` from `screens/trust.js`.
- [X] T047 [US4] Build **Automation / session-key** screens (scope/cap/expiry grant; instant revoke; none-granted default) in `apps/web/src/app/(app)/automation/page.tsx` and `automation/grant/page.tsx` from `screens/trust.js`.
- [X] T048 [P] [US4] Build **Bridge** (Base↔Sui, fully-self-custodial framing) in `apps/web/src/app/(app)/bridge/page.tsx` from `screens/bridge.js`, routing through `confirm/bridge`.
- [X] T049 [US4] Verify ConfirmFlow **variants** (swap / premium / bridge) render the same simulation→guardrails→ack→sign→success structure (extends T035).

**Checkpoint**: Trust + growth surfaces complete; all confirm variants verified.

---

## Phase 8: User Story 5 - Supporting surfaces (Priority: P2)

**Goal**: Fees, Premium, Outcome Log, Learn, SRK, Settings, Notifications.

**Independent Test**: Navigate to each from the rail / More sheet / avatar menu; confirm a faithful match.

- [X] T050 [P] [US5] Build **Fees** ("we only earn when you earn"; active performance fee; 0% on principal) in `apps/web/src/app/(app)/fees/page.tsx` from `screens/fees.js`.
- [X] T051 [P] [US5] Build **Premium** (SRK-paid freemium; free tier fully capable; vault never gated) in `apps/web/src/app/(app)/premium/page.tsx` (+ `premium/pay`) from `screens/premium.js`.
- [X] T052 [P] [US5] Build **Outcome Log** (past recs with realized PnL — wins and losses — tied to originating rec) in `apps/web/src/app/(app)/outcomes/page.tsx` from `screens/support.js`.
- [X] T053 [P] [US5] Build **Learn** in `apps/web/src/app/(app)/learn/page.tsx` from `screens/support.js`.
- [X] T054 [P] [US5] Build **SRK** in `apps/web/src/app/(app)/srk/page.tsx` from `screens/support.js`.
- [X] T055 [P] [US5] Build **Settings** (risk profile, goals, alerts, wallet, theme) in `apps/web/src/app/(app)/settings/page.tsx` from `screens/support.js`.
- [X] T056 [P] [US5] Build **Notifications** screen in `apps/web/src/app/(app)/notifications/page.tsx` from `screens/support.js`.

**Checkpoint**: Full end-user screen inventory complete.

---

## Phase 9: User Story 6 - Admin / stakeholder panel (Priority: P3)

**Goal**: The distinct, observe-only admin panel reachable at `/admin` (no auth yet), with the revenue dashboard centerpiece and the pause-only kill-switch.

**Independent Test**: Open `/admin`; switch "View as" roles; visit each screen; confirm nothing can move funds.

- [X] T057 [US6] Build **AdminShell** layout (distinct shell — NOT the app shell; "Observe-only · read-only over funds" chip; "View as" role switcher Super-Admin/Ops/Stakeholder/Client; "scaffold — no auth/RBAC yet" banner; own theme toggle) in `apps/web/src/app/admin/layout.tsx` + `apps/web/src/components/admin/AdminShell.tsx` from `SparkPoint Admin.html`.
- [X] T058 [P] [US6] Build admin **Overview** in `apps/web/src/app/admin/page.tsx`.
- [X] T059 [P] [US6] Build admin **Users** in `apps/web/src/app/admin/users/page.tsx`.
- [X] T060 [P] [US6] Build admin **Usage** in `apps/web/src/app/admin/usage/page.tsx`.
- [X] T061 [P] [US6] Build admin **TVL** in `apps/web/src/app/admin/tvl/page.tsx`.
- [X] T062 [US6] Build admin **Revenue** — the graphical dashboard centerpiece (revenue by stream over time, cumulative, trajectory, realized vs projected) with Recharts in `apps/web/src/app/admin/revenue/page.tsx` + `apps/web/src/components/admin/RevenueDashboard.tsx`.
- [X] T063 [P] [US6] Build admin **System** in `apps/web/src/app/admin/system/page.tsx`.
- [X] T064 [US6] Build admin **Kill-switch** (pause-only · 2-of-3 multisig · never blocks withdrawals · propose-and-sign only; **no fund-moving control**) in `apps/web/src/app/admin/killswitch/page.tsx`.
- [X] T065 [P] [US6] Build admin **Config** in `apps/web/src/app/admin/config/page.tsx`.
- [X] T066 [P] [US6] Build admin **Audit** in `apps/web/src/app/admin/audit/page.tsx`.
- [X] T067 [US6] Wire the **role switcher** to adjust visible sections/nav per role (cosmetic; no real authorization).

**Checkpoint**: Admin panel complete; all routes present; no control can move user funds.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Lock fidelity, verify scope boundaries, keep the gates green.

- [ ] T068 [P] Add a Playwright **smoke** test in `apps/web/tests/smoke.spec.ts` — every route loads (SC-009), the entry flow completes (SC-002), theme persists across reload (SC-004).
- [X] T069 Direct-navigate + reload **every** route (not just via in-app links) and confirm no runtime/console errors (SC-009); confirm out-of-scope wallet/AI/chain/auth are clearly non-functional and never block navigation (FR-028).
- [ ] T070 **Side-by-side parity review** of every in-scope screen vs `docs/design-handover/showcase/` (SC-006) — fix any "major divergence" (layout/components/copy/tokens) before sign-off.
- [X] T071 Keep gates green: `pnpm -C apps/web lint && pnpm -C apps/web build` (+ `tsc`); resolve any OH Defender findings.
- [X] T072 [P] Update living docs — `CHANGELOG.md` entry for the faithful UI build — and run the `quickstart.md` validation checklist.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)** → no deps.
- **Foundational (P2)** → after Setup; **BLOCKS all user stories** (visual system, mock data, contexts, atoms, overlay framework).
- **US1 / US2 / US3 / US7 (all P1)** → after Foundational. US3 depends on US2's AppShell to host screens; US7 cross-cuts and is verified after US1–US3 (and re-verified after US6).
- **US4 / US5 (P2)** → after Foundational; reuse US2 shell + US3 ConfirmFlow.
- **US6 (P3)** → after Foundational; independent shell.
- **Polish** → after all desired stories.

### Story dependencies
- **US1** independent (own public/onboarding layouts).
- **US2** independent (shell), but US3/US4/US5 screens render inside its AppShell.
- **US3** needs US2 (AppShell) + Foundational; ConfirmFlow (T035) reused by US4.
- **US7** cross-cutting — needs at least US1–US3 surfaces to verify.
- **US6** independent of the app shell.

### Within a story
- Shell/layout before the screens it hosts; ConfirmFlow before the flows that mount it; the OverlayProvider framework (T016) before overlay contents (T028–T034).

---

## Parallel Opportunities

- **Setup**: T003 [P] alongside reading tasks.
- **Foundational**: T008, T009, T010, T011, T013, T014, T015 [P] (distinct files); T005→T006→T007 are sequential (same/related CSS).
- **US2**: T023–T027 (shell pieces) and T029–T033 (overlay contents) are [P]; T034 integrates after.
- **US5**: T050–T056 all [P] (independent screen files).
- **US6**: T058–T061, T063, T065, T066 [P] (independent admin pages).
- **Cross-story**: once Foundational is done, US1, US2, US6 can proceed in parallel by different developers; US3 starts once US2's AppShell exists.

### Parallel example — Foundational
```bash
Task: "Create lib/mock-data.ts (T008)"
Task: "Create lib/nav.ts (T009)"
Task: "Create lib/network.tsx (T010)"
Task: "Create ui/icon.tsx lucide map (T013)"
Task: "Create ui atoms pill/risk-chip/stat/seg/guard-item/card (T015)"
```

### Parallel example — US5 supporting screens
```bash
Task: "Fees (T050)"  Task: "Premium (T051)"  Task: "Outcomes (T052)"
Task: "Learn (T053)"  Task: "SRK (T054)"  Task: "Settings (T055)"  Task: "Notifications (T056)"
```

---

## Implementation Strategy

### MVP first (P1 = US1 + US2 + US3 + US7)
1. Phase 1 Setup → Phase 2 Foundational (CRITICAL — blocks everything).
2. US1 (entry/onboarding) → US2 (shell + overlays) → US3 (chat/portfolio/vault + confirm gate) → US7 (theme/responsive fidelity).
3. **STOP & VALIDATE** against the showcase (quickstart.md) → this is the faithful scaffold to show the client.

### Incremental delivery
4. Add US4 (strategies/trust/bridge) → US5 (supporting surfaces) → US6 (admin) → re-run US7 fidelity for the new surfaces.
5. Polish (smoke test, parity review, green gates, docs).

---

## Notes
- The showcase is normative; **port markup/classes/copy, do not redesign or simplify** (this is the exact failure being corrected).
- Out of scope (stub/mock, non-blocking): real wallet connect, real AI agent, on-chain calls, real auth/RBAC.
- Commit per task or logical group (Conventional Commits + the Co-Authored-By trailer); confirm before any push/PR/merge.
- Keep `tsc`/`eslint`/`build` green throughout.
