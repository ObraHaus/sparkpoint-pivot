# Implementation Plan: SparkPoint Web App — Faithful UI Build

**Branch**: `002-web-app-ui` | **Date**: 2026-06-22 | **Spec**: ./spec.md

**Input**: Feature specification from `specs/002-web-app-ui/spec.md`

## Summary

Rebuild the SparkPoint web app in the existing `apps/web` (Next.js App Router + TypeScript + Tailwind v4) as a **faithful, 1:1 recreation of the approved Claude Design** (`docs/design-handover/showcase/`). The prior scaffold re-derived a simplified UI and diverged; this plan **ports the design's assets** instead — its `tokens.css` + `app.css` + per-screen CSS become the visual system, and `window.SP`'s behaviors (hash routing, the shell, overlays, theme, mock data) are recreated as idiomatic React. Every screen, overlay, and flow from the showcase is reproduced; wallet/AI/chain/auth remain mocked (separate later features).

## Technical Context

**Language/Version**: TypeScript 5 · Node 22 · React 19

**Primary Dependencies**: Next.js 16 (App Router) · TailwindCSS v4 · next-themes (theme, `sp-theme`) · lucide-react (icons; the design's inline lucide-style paths map to it) · Recharts (charts: net-worth/APY/allocation/admin revenue) · wagmi/viem present from the scaffold but **inert** in this build (no real connection)

**Storage**: None. All screen data comes from an in-repo **mock-data module** mirroring the design's `SP.data` (no backend/DB/chain).

**Testing**: Manual visual parity vs the showcase (primary, per SC-006) + Playwright smoke (every route loads, the entry flow completes, theme persists) + `tsc`/`eslint` gates.

**Target Platform**: Modern web browsers; responsive desktop (~1440px) + mobile (~390px).

**Project Type**: Web frontend (single app, `apps/web`) — no backend in scope.

**Performance Goals**: Instant client-side route transitions; no flash of the wrong theme on load; smooth at 60fps for the design's transitions.

**Constraints**: Must match the design's look/layout/copy (the showcase is normative); light/dark via a single `sp-theme` class on `<html>`; tabular numerals on financials; no horizontal overflow at 390px; no real wallet/AI/chain/auth (mocked/stubbed); keep `tsc`/`eslint`/`build` green.

**Scale/Scope**: ~25 routes/screens (public landing/connect/verify, onboarding, ~16 app screens, ~9 admin screens) + ~6 overlays + the shared shell. Replaces the prior scaffold pages.

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1.*

| Principle (constitution v1.2.0) | Assessment |
|---|---|
| I. Non-Custodial by Construction | **PASS** — UI-only build with mock data touches no funds; it faithfully *presents* the guarantees (Prove-it sheet, withdraw-always exit, "Fully self-custodial" framing). No invariant can be violated because there is no custody surface here. |
| II. AI proposes, deterministic policy + user disposes | **PASS** — the confirm gate (simulation → guardrails → **acknowledgement-gated Sign**) is reproduced; nothing "executes" without the user action, mirroring the rule in UI form. |
| III. Provable, not promised | **PASS** — Prove-it permissions, the honest perf-fee/HWM disclosure, and the Outcome Log (wins *and* losses) are reproduced. Mock figures are clearly sample data. |
| IV. Security & bounded blast radius | **PASS / N/A in UI** — no real execution; the kill-switch is shown read-only/pause-only-framed in admin; no fund-moving control exists. |
| V. Conservative, transparent launch | **PASS** — the Vault screen shows 0% on principal + the 10% profit-only HWM performance fee; Fees screen shows "we only earn when you earn". |
| VI. Spec-Driven Development | **PASS** — built via this speckit feature (spec → plan → tasks → implement). |
| VII. Simplicity & YAGNI | **PASS** — faithful port, no scope beyond the design; Base+Sui only; no real backend. |

**Gate result: PASS** — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/002-web-app-ui/
├── plan.md              # This file
├── research.md          # Phase 0 — porting decisions
├── data-model.md        # Phase 1 — mock-data entities
├── quickstart.md        # Phase 1 — run + visual-parity validation
├── contracts/           # Phase 1 — route map, component inventory, mock-data shape
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (apps/web)

```text
apps/web/src/
├── app/
│   ├── layout.tsx                 # root: Providers (theme, overlays, session/network), fonts
│   ├── globals.css                # tokens + ported app.css + collected per-screen CSS
│   ├── page.tsx                   # marketing landing (Spark Core) — public, dark-only
│   ├── (public)/
│   │   ├── connect/page.tsx        # simulated wallet connect
│   │   └── verify/page.tsx         # verify step
│   ├── onboarding/
│   │   ├── layout.tsx              # focused onboarding shell (brand + self-custodial + theme + Save&exit)
│   │   └── page.tsx                # stepped flow (welcome→goal→risk→mandate→first-rec→enter)
│   ├── (app)/
│   │   ├── layout.tsx              # AppShell (TopBar + DisclaimerStrip + TrustRail + MobileTabBar + overlays mount)
│   │   ├── chat/ portfolio/ (portfolio/[positionId]/) vault/ (vault/deposit, vault/withdraw)
│   │   ├── strategies/ confirm/[intent]/ trust/ (trust/permissions, trust/exit, automation, automation/grant)
│   │   ├── bridge/ fees/ premium/ (premium/pay) outcomes/ learn/ srk/ settings/ notifications/
│   └── admin/
│       ├── layout.tsx             # AdminShell (ops bar + role switcher + observe-only chip + "no auth" banner)
│       └── overview|users|usage|tvl|revenue|system|killswitch|config|audit/page.tsx
├── components/
│   ├── shell/                     # TopBar, PrimaryNav, TrustRail, MobileTabBar, DisclaimerStrip, AppShell
│   ├── overlays/                  # OverlayProvider (+portal), ProveItSheet, WalletMenu, NetworkMenu,
│   │                              # NotificationsSheet, CommandPalette (⌘K), Toaster, Sheet, Dialog
│   ├── admin/                     # AdminShell, RoleSwitcher, revenue/usage charts
│   ├── ui/                        # SparkMark, Icon (lucide map), Pill, RiskChip/RiskMeter, Stat, Seg,
│   │                              # GuardItem, Card atoms, ConfirmFlow (shared trust gate)
│   └── screens/                   # screen bodies (imported by the route page.tsx files)
└── lib/
    ├── mock-data.ts               # the single SP.data mirror (typed)
    ├── nav.ts                     # PRIMARY / SECONDARY nav config + route map
    ├── theme.ts / network.tsx     # theme helpers; active-network (Base/Sui) + mock-session context
    └── utils.ts                   # cn(), money()/fmt() tabular formatters, riskTier()
```

**Structure Decision**: Single Next.js app under `apps/web` with **route groups** mirroring the design's route classes — `(public)` (landing/connect/verify), `onboarding` (own focused layout), `(app)` (the authenticated shell + screens), and `admin` (its own shell). The design's global behaviors become React: routing → App Router segments; overlays → an `OverlayProvider` context rendering into a portal; theme → next-themes; active network + mock session → a small client context; `SP.data` → `lib/mock-data.ts`. The prior diverging scaffold pages are replaced.

## Architecture of the port (how the design maps to React)

1. **Visual system (verbatim port).** `tokens.css` (already in `globals.css`) + the design's **`app.css`** (shell + atoms: `.topbar/.railnav/.pill/.card/.tbl/.seg/.sheet/.dialog/.toast/.guard/.riskchip/.proveitem/.stat/.empty/...`) are brought into the app's global CSS faithfully, plus each screen's own `<style>` collected into the global sheet (or co-located CSS). React components emit the **same class names + markup** as the design, so the look matches by construction. `.light`/`.dark` from tokens drive the theme; the design classes are theme-agnostic (token-driven).
2. **Shell.** `AppShell` reproduces `SparkPoint.html`'s `shellHTML`: TopBar (SparkMark brand, PrimaryNav = Chat/Portfolio/Vault/Strategies, the self-custodial pill, network switcher, wallet pill, ⌘K, notifications bell+count, avatar), DisclaimerStrip (exact copy + Prove it / How we make money / Exit anytime), TrustRail ("Trust & control": Bridge, Trust Center, Automation, Outcome Log, Fees, Premium, Learn, SRK, Settings + Withdraw/Exit), and MobileTabBar (Chat/Portfolio/Vault/Strategies/More).
3. **Overlays.** An `OverlayProvider` (client context + a single portal mount) exposes `openProveIt / openWalletMenu / openNetworkMenu / openNotifications / openCommandPalette / toast`, reproducing the design's sheet/dialog/menu/toast markup + the scrim + open/dismiss transitions; ⌘K bound to the keyboard.
4. **Theme.** next-themes (`attribute="class"`, `storageKey="sp-theme"`, `defaultTheme="dark"`, no FOUC) — already wired; the avatar-menu row, the onboarding header, and the admin toggle all call `setTheme`.
5. **State/data.** `lib/mock-data.ts` is the typed single source (mirrors `SP.data`); a small client context holds the active network (Base/Sui) + mock session; screens read from these. Charts via Recharts; icons via a lucide map matching the design's icon set.
6. **Screens.** One component per screen reproducing the design's exact markup/classes/copy from `screens/*.js`, `flows/Onboarding.html`, `Spark Core Landing.html`, and `SparkPoint Admin.html`. The confirm gate is a shared `ConfirmFlow` rendered both at `confirm/[intent]` and inline in chat (two mount points, one component).

## Complexity Tracking

> No constitution violations — not required.
