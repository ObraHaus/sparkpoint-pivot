# Feature Specification: SparkPoint Web App — Faithful UI Build

**Feature Branch**: `002-web-app-ui`

**Created**: 2026-06-22

**Status**: Draft

**Input**: User description: "Build the SparkPoint web app as a FAITHFUL recreation of the approved Claude Design in `docs/design-handover/showcase/`. The current scaffold diverged (generic hero + simplified shell + placeholder screens) and must be replaced so the app matches the design exactly — landing, connect, onboarding, the authenticated app shell + all screens + overlays, and the admin panel."

## Context

The approved high-fidelity design (the **showcase** at `docs/design-handover/showcase/` — `SparkPoint.html`, `app.css`, `tokens.css`, `screens/*.js`, `Spark Core Landing.html`, `flows/Onboarding.html`, `SparkPoint Admin.html`) was reviewed and submitted to the client. An initial web scaffold **diverged** from it: a generic landing, a simplified shell with the wrong navigation, no overlays, placeholder screens, and its own styling. This feature replaces that divergence with a build that **matches the approved design** — its look, layout, components, copy, flows, and behavior — so the running app is the design, faithfully reproduced. **The showcase is the normative source of truth; where this spec and the showcase disagree, the showcase wins.**

> **Out of scope (later features):** real wallet connection, the real AI agent, on-chain calls, and real authentication/authorization. This build uses the design's **mock data** and **simulated** interactions. The admin panel ships without auth (reachable directly, with a visible "no auth yet" notice) until the auth/RBAC feature lands.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public entry → first-run onboarding (Priority: P1)

A first-time visitor arrives at the marketing landing, launches the app, "connects a wallet" (simulated), and is guided through onboarding (goals → risk tolerance → a personalized mandate) before entering the app.

**Why this priority**: It is the front door. Without it, users are dropped into the app with no context, login, or onboarding — the exact defect this feature fixes. It is independently demoable as the complete pre-app journey.

**Independent Test**: Start at `/`, click "Launch app", choose a wallet on Connect, complete every onboarding step, and arrive in the app — with no dead ends and matching the design's screens.

**Acceptance Scenarios**:

1. **Given** a visitor on the marketing landing, **When** they choose "Launch app", **Then** they reach the Connect screen (the design's landing/connect, not a generic hero).
2. **Given** the Connect screen, **When** they pick a wallet option (Coinbase / WalletConnect / MetaMask), **Then** a simulated connection proceeds to onboarding.
3. **Given** onboarding, **When** they move through welcome → goal → risk tolerance → mandate → first-recommendation preview, **Then** a progress indicator advances and they can go back/forward, finishing with an "Enter SparkPoint" action that lands them in the app (Chat).
4. **Given** the onboarding "Save & exit" control, **When** chosen, **Then** they return to the landing without losing the ability to restart.

---

### User Story 2 - The authenticated app shell & overlays (Priority: P1)

A signed-in user sees the faithful app shell and can reach everything through it.

**Why this priority**: The shell is the frame every screen lives in; its navigation, trust affordances, and overlays are core to the product identity. Independently testable by navigating the shell with no screen content built out.

**Independent Test**: From any app route, exercise every shell control and confirm each nav target, pill, switcher, and overlay matches the design and opens/closes correctly.

**Acceptance Scenarios**:

1. **Given** the app shell, **When** rendered on desktop, **Then** it shows the top bar (brand spark-mark; primary nav Chat / Portfolio / Vault / Strategies; a "Fully self-custodial" pill; a Base/Sui network switcher; a wallet pill; a ⌘K button; a notifications bell with unread count; an avatar button), the non-custody disclaimer strip ("The AI proposes. Guardrails check it. You sign it." + "Prove it / How we make money / Exit anytime" links), and a left "Trust & control" rail (Bridge, Trust Center, Automation, Outcome Log, Fees, Premium, Learn, SRK, Settings, and a distinct Withdraw / Exit item).
2. **Given** the "Fully self-custodial" pill (or "Prove it" link), **When** clicked, **Then** the Prove-it sheet opens showing the Can / Can't columns and the five structural guarantees, with links to permissions and exit.
3. **Given** the network switcher, **When** opened, **Then** Base and Sui are listed (both live), the active one is checked, switching updates the active-network indicator and wallet address, and a "Bridge assets between networks" shortcut is offered.
4. **Given** the avatar menu, **When** opened, **Then** it contains account/settings/mandate/learn items, a light/dark theme toggle row, and a log-out item.
5. **Given** the wallet pill, the notifications bell, and the ⌘K button, **When** each is activated (⌘K also via the keyboard shortcut), **Then** the corresponding overlay (wallet menu / notifications sheet / command palette) opens and can be dismissed, and toasts appear for transient confirmations.
6. **Given** a viewport under 1024px, **When** the shell renders, **Then** the rail is replaced by a bottom tab bar (Chat / Portfolio / Vault / Strategies / More) and the "More" sheet exposes the rail's secondary destinations.

---

### User Story 3 - Core money screens: Chat, Portfolio, Vault (Priority: P1)

The user reads their portfolio, converses with the assistant, and deposits into / withdraws from the Aave Yield Vault through the simulation-backed confirm gate.

**Why this priority**: These three screens + the confirm gate are the product's core loop (understand → decide → act). Independently demoable as the primary value even before the secondary screens exist.

**Independent Test**: Open Chat, Portfolio, and Vault; trigger a vault deposit and a withdraw; confirm each routes through the trust gate (simulation → balance changes → guardrail checklist → acknowledgement-gated sign → success) and matches the design.

**Acceptance Scenarios**:

1. **Given** Chat, **When** opened, **Then** it shows the assistant with structured cards (recommendation / action / snapshot / tip / outcome) and tool-step "thinking", per the design; a chat-initiated deposit/swap/bridge renders the confirm flow **inline in the thread** (same trust gate as the route).
2. **Given** Portfolio, **When** opened, **Then** it shows net worth + an over-time chart, a risk panel, allocation (by asset/strategy/risk tier), and a positions table with a position-detail view.
3. **Given** Vault, **When** opened, **Then** it shows the Aave Yield Vault with a net-APY breakdown that includes the **10% performance fee over a high-water mark** (net 3.87% vs 4.3% gross), shares, caps, and deposit/withdraw panels with a live shares preview.
4. **Given** any state-changing action (deposit/withdraw), **When** initiated, **Then** the confirm gate shows the pre-trade simulation, a balance-changes table, a guardrail checklist, and a **Sign button disabled until the acknowledgement is checked**, ending in a success state with a receipt; nothing moves until the user signs.
5. **Given** the withdraw path, **When** used, **Then** the design's "withdraw-always" framing is present (exit is always available).

---

### User Story 4 - Strategies, Trust Center, Bridge & confirm variants (Priority: P2)

The user reviews ranked strategies, inspects the Trust Center (prove-it / withdraw-always exit / automation), and bridges assets between Base and Sui.

**Why this priority**: High-value trust and growth surfaces that deepen the experience but are not required for the core loop demo.

**Independent Test**: Open Strategies, the Trust Center (and its permissions/exit/automation sub-screens), and Bridge; run a swap and a bridge through the confirm gate.

**Acceptance Scenarios**:

1. **Given** Strategies, **When** opened, **Then** recommendations are ranked against the user's mandate with a "why this?" rationale.
2. **Given** the Trust Center, **When** opened, **Then** it presents the prove-it permissions, the withdraw-always self-service exit, and automation/session-key management (grant scope/cap/expiry; instant revoke).
3. **Given** Bridge, **When** opened, **Then** the user can move an asset Base↔Sui with the design's fully-self-custodial framing, routed through a `confirm/bridge` gate.
4. **Given** the confirm gate, **When** reached via swap / premium / bridge entry points, **Then** the matching variant renders with the same simulation → guardrails → ack → sign → success structure.

---

### User Story 5 - Supporting surfaces (Priority: P2)

The user reaches Fees, Premium, Outcome Log, Learn, SRK, Settings, and Notifications.

**Why this priority**: Completes the app's screen inventory and the transparency/monetization story; not required for the core demo.

**Independent Test**: Navigate to each supporting screen from the rail / More sheet / avatar menu and confirm it matches the design.

**Acceptance Scenarios**:

1. **Given** Fees, **When** opened, **Then** it presents "we only earn when you earn" with the active performance fee and 0% on principal.
2. **Given** Premium, **When** opened, **Then** it presents the freemium tiers with premium payable in SRK (free tier fully capable; vault never gated).
3. **Given** the Outcome Log, **When** opened, **Then** past recommendations are listed with their realized PnL (wins and losses) tied to the originating recommendation.
4. **Given** Settings / Learn / SRK / Notifications, **When** opened, **Then** each matches the design.

---

### User Story 6 - Admin / stakeholder panel (Priority: P3)

An operator or stakeholder opens the admin panel to observe users, usage, TVL, the revenue dashboard, system health, the kill-switch, config, and the audit log.

**Why this priority**: Internal/stakeholder surface, valuable but separate from the end-user product and shipped without auth in this build.

**Independent Test**: Open `/admin` directly; switch "View as" roles; visit each admin screen; confirm the revenue dashboard and kill-switch match the design and that nothing can move funds.

**Acceptance Scenarios**:

1. **Given** the admin panel at `/admin`, **When** opened, **Then** it uses its own distinct shell (not the app shell), shows a persistent "Observe-only · read-only over funds" indicator, a "View as" role switcher (Super-Admin / Ops / Stakeholder / Client), and a clear "scaffold — no authentication/authorization yet" banner.
2. **Given** the Revenue screen, **When** opened, **Then** the graphical revenue dashboard is the centerpiece (revenue by stream over time, cumulative, trajectory, with realized vs projected distinguished).
3. **Given** the Kill-switch screen, **When** opened, **Then** it is framed pause-only · 2-of-3 multisig · never blocks withdrawals · propose-and-sign only, with no control that can move user funds.
4. **Given** any admin screen, **When** the role is changed, **Then** the visible navigation/sections adjust per role.

---

### User Story 7 - Theme & responsive fidelity (Priority: P1, cross-cutting)

Every surface honors one persisted light/dark theme and is faithful at both desktop and mobile breakpoints.

**Why this priority**: A cross-cutting guarantee that the whole app matches the design's visual system; if it fails, no screen "matches".

**Independent Test**: Toggle the theme from the app (avatar menu), admin (its toggle), and onboarding (header); reload; confirm persistence and no flash; view representative screens at 390px and 1440px.

**Acceptance Scenarios**:

1. **Given** any surface, **When** the theme is toggled, **Then** it switches between light and dark, persists across reloads (shared key), and there is no flash of the wrong theme on load (default dark).
2. **Given** the marketing landing, **When** viewed, **Then** it remains dark by design.
3. **Given** any screen at 390px and at 1440px, **When** rendered, **Then** the layout adapts faithfully (desktop rail + top nav / mobile bottom tabs + bottom sheets) with no horizontal overflow.
4. **Given** financial figures anywhere, **When** rendered, **Then** they use tabular numerals, and the brand spark-mark uses the design's gradient.

### Edge Cases

- **No-flash theme**: the saved theme must apply before first paint (no light-then-dark flash); default is dark when none is saved.
- **Caps reached** (Vault): the deposit panel reflects a caps-reached state.
- **Simulation predicts a problem** (Confirm): the gate shows a warning/blocked state and the Sign button stays disabled until acknowledged.
- **Automation revoked / none granted**: the Prove-it sheet and Automation screen reflect the no-active-session-key default and instant revocation.
- **Network switch**: switching Base↔Sui updates the active-network indicator and the displayed wallet address consistently across the shell.
- **Mobile right-cluster overflow**: on small screens the network/wallet pills collapse (surfaced in Connect/Settings and the avatar menu) while the self-custodial affordance remains reachable.
- **Admin without auth**: `/admin` is reachable directly and clearly labels that auth/RBAC is not yet implemented.
- **Direct deep links / reload** on any in-app route render the shell + screen correctly (not just via in-app navigation).

## Requirements *(mandatory)*

### Functional Requirements — Entry & onboarding

- **FR-001**: The app MUST present a marketing landing as the public entry, faithful to the design's "Spark Core" landing, with a clear path to launch the app.
- **FR-002**: The app MUST provide Connect and verify screens faithful to the design, offering simulated wallet options (Coinbase / WalletConnect / MetaMask) that proceed into onboarding.
- **FR-003**: The app MUST provide an onboarding flow (welcome → goal → risk tolerance → mandate → first-recommendation preview → enter app) with a step indicator, back/forward navigation, and a "Save & exit" path.
- **FR-004**: Completing onboarding MUST land the user in the app (Chat).

### Functional Requirements — App shell, navigation & overlays

- **FR-005**: The app MUST render the authenticated shell faithful to the design: top bar, primary nav (Chat / Portfolio / Vault / Strategies), the non-custody disclaimer strip, the left "Trust & control" rail (Bridge, Trust Center, Automation, Outcome Log, Fees, Premium, Learn, SRK, Settings, Withdraw/Exit), and a mobile bottom tab bar with a "More" sheet.
- **FR-006**: The top bar MUST include the "Fully self-custodial" pill, the Base/Sui network switcher, the wallet pill, the ⌘K command-palette trigger, the notifications bell with unread count, and the avatar button.
- **FR-007**: The app MUST provide the Prove-it sheet (Can / Can't columns + five structural guarantees + links to permissions and exit), opened from the self-custodial pill and the "Prove it" link.
- **FR-008**: The app MUST provide the wallet menu, the network-switcher menu (Base/Sui + bridge shortcut), the notifications sheet, the ⌘K command palette (searchable actions/screens, openable via keyboard), and toast notifications — all matching the design.
- **FR-009**: All navigation targets MUST resolve to the correct screen with active-state styling, on both the desktop rail/top-nav and the mobile tabs/More sheet.

### Functional Requirements — Screens

- **FR-010**: Chat MUST render the assistant with the design's structured cards and tool-step thinking, and MUST render chat-initiated deposit/swap/bridge confirmations inline in the thread (same trust gate as the route).
- **FR-011**: Portfolio MUST render net worth + over-time chart, risk panel, allocation, positions table, and a position-detail view.
- **FR-012**: Vault MUST render the Aave Yield Vault with a net-APY breakdown including the 10% performance fee over a high-water mark (net 3.87% vs 4.3% gross), shares, caps, and deposit + withdraw panels with a live shares preview; the withdraw path MUST surface withdraw-always.
- **FR-013**: Strategies MUST render recommendations ranked against the mandate with a "why this?" rationale.
- **FR-014**: The Confirm trust gate MUST render simulation → balance-changes → guardrail checklist → acknowledgement-gated Sign → success, with variants for deposit / withdraw / swap / premium / bridge; the Sign control MUST be disabled until the acknowledgement is satisfied.
- **FR-015**: The Trust Center MUST render the prove-it permissions, the withdraw-always self-service exit, and automation/session-key management (scope/cap/expiry; instant revoke).
- **FR-016**: Bridge MUST render a Base↔Sui transfer with the fully-self-custodial framing, routed through the confirm gate.
- **FR-017**: Fees, Premium (SRK freemium), Outcome Log (realized PnL per recommendation), Learn, SRK, Settings, and Notifications screens MUST each be rendered faithful to the design.

### Functional Requirements — Admin panel

- **FR-018**: The admin panel MUST be reachable directly at `/admin`, use a distinct shell (not the app shell), and display a clear "no authentication/authorization yet" notice.
- **FR-019**: The admin panel MUST show a persistent "Observe-only · read-only over funds" indicator and a "View as" role switcher (Super-Admin / Ops / Stakeholder / Client) that adjusts the visible sections.
- **FR-020**: The admin panel MUST include Overview, Users, Usage, TVL, Revenue (graphical dashboard centerpiece), System, Kill-switch, Config, and Audit screens.
- **FR-021**: The Kill-switch screen MUST be framed pause-only · 2-of-3 multisig · never blocks withdrawals · propose-and-sign only, and MUST expose no control capable of moving user funds.

### Functional Requirements — Theme, responsiveness & fidelity

- **FR-022**: The app MUST support light and dark themes, persisted under a single shared key, defaulting to dark, applied before first paint (no flash); the toggle MUST be reachable from the app (avatar menu), the admin panel, and onboarding, and stay in sync across them.
- **FR-023**: The marketing landing MUST remain dark-only by design.
- **FR-024**: Every surface MUST be responsive and faithful at mobile (~390px) and desktop (~1440px) breakpoints, with no horizontal overflow, using the design's responsive patterns (rail+top-nav → bottom tabs+sheets).
- **FR-025**: The visual system MUST reproduce the design's tokens and component styles (the design's color/type/spacing/radius/elevation tokens and component classes), with tabular numerals on financial figures and the design's brand spark-mark.
- **FR-026**: The app MUST reproduce the design's copy/content (headings, labels, microcopy) for the screens and overlays in scope.

### Functional Requirements — Data & scope boundaries

- **FR-027**: The app MUST use mock/sample data faithful to the design (wallet, networks, mandate, portfolio, vault, recommendations, outcomes, notifications, transactions, bridge balances) for all screens.
- **FR-028**: Wallet connection, the real AI agent, on-chain transactions, and real authentication/authorization MUST be simulated or stubbed (out of scope for this build) and clearly non-functional where applicable, without blocking navigation.
- **FR-029**: Every route MUST load without errors on direct navigation and reload (not only via in-app links).

### Key Entities *(UI/mock data)*

- **User / Wallet**: the signed-in user and their (mock) wallet address; per-network address.
- **Network**: Base and Sui (id, name, live flag, color, wallet); an active selection.
- **Mandate**: the onboarding result (risk tier, goal, timeline, experience).
- **Portfolio / Position**: net worth, PnL, allocation, and holdings incl. the vault position.
- **Vault**: the Aave Yield Vault (net/gross APY, performance fee, high-water mark, shares, share value, caps, TVL).
- **Recommendation**: a ranked suggestion (rank, title, thesis, APY, risk, fit).
- **Outcome**: a past recommendation's realized result (gain/loss, amount, %, window, cause, date).
- **Notification / Transaction**: activity items and the (mock) tx history.
- **Session Key / Automation**: optional scoped/revocable automation grant (default none).
- **Bridge Transfer**: a Base↔Sui movement (asset, amount, from/to network, status).
- **Admin Role**: the "View as" role governing admin section visibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the screens in the design's screen inventory have a corresponding, reachable screen in the app (every `screens/*.js` surface, landing, onboarding, and admin screen).
- **SC-002**: A new user can complete the full entry journey — landing → connect → onboarding → app — with zero dead ends or broken links.
- **SC-003**: Every shell control and every overlay (Prove-it, wallet, network, notifications, ⌘K, toasts, avatar/theme) opens and dismisses correctly on desktop and mobile.
- **SC-004**: Theme toggles between light and dark, persists across a reload, shows no flash of the wrong theme, and stays consistent across app / admin / onboarding.
- **SC-005**: Every screen renders without horizontal overflow and remains usable at 390px and 1440px.
- **SC-006**: In a side-by-side review against the showcase, each in-scope screen is judged a faithful match (layout, components, copy, tokens) — reviewer sign-off with no "major divergence" findings.
- **SC-007**: Every state-changing action funnels through the confirm gate with a Sign control that cannot be activated until the acknowledgement is satisfied (verified on deposit/withdraw/swap/bridge/premium).
- **SC-008**: The admin panel is reachable at `/admin`, exposes all admin screens and the role switcher, and contains no control that can move user funds.
- **SC-009**: Every route loads without runtime errors on direct navigation and on reload.

## Assumptions

- The **showcase** (`docs/design-handover/showcase/`) is the normative source of truth; where this spec and the design disagree, the design wins.
- The app is built in the existing web project (`apps/web`); the prior diverging scaffold is replaced/superseded by this faithful build.
- All data is **mock/sample** data drawn from the design; there is no backend, wallet, AI, or chain in this build.
- **Out of scope** (separate later features): real wallet connection, the real AI agent, on-chain transactions, and real authentication/authorization (the admin panel is unauthenticated in this build, clearly labeled).
- The light/dark theme, the multi-network (Base/Sui) framing, and the active performance fee follow the current constitution (v1.2.0) and the design.
- The marketing "Spark Core" landing is reproduced as a faithful static rendition (its rich animation may be approximated); it remains dark-only.
