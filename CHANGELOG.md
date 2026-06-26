# Changelog

All notable changes to **SparkPoint Pivot** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Status:** the **web app build has begun** (`apps/web`) — a faithful UI recreation of the approved design (every screen, shell, overlays, confirm gate, admin panel) on mock data; backend/agent/chain/auth + deployment are the next features. The Spec-Driven-Development planning artifacts and the design handover remain the source of truth. Build window: Jun 1 – Sep 4, 2026.

> **Note on this project:** SparkPoint Pivot is an **ObraHaus client product**, not part of the ObraHaus Apps Ecosystem. It is hosted in the ObraHaus GitHub org *for now* (ownership may transfer to the client later). It therefore **does not** use obrahaus-console SSO (it uses **wallet auth**), **does not** route AI through obrahaus-governor (it calls **Anthropic / an OpenAI-compatible API directly**), and uses its **own brand** (cobalt / gold / coral), not the OH Primary design system. These are sanctioned client-project divergences — see DEVELOPMENT.md.

## [Unreleased]

### Added
- **Landing-only construction gate** (Spec Kit feature `specs/003-landing-only-gate/`) — a per-deployment switch that publicly serves **only** the marketing landing (`/`) while every other route (the entry flow, all app screens, all `/admin/*`) redirects to a branded, `noindex` **Coming soon** page, so the landing can go public while the rest stays under construction.
  - **Mechanism** — a single Next.js `apps/web/middleware.ts` (the app's first) enforces a server-side, default-deny **allow-list** (`/`, `/_next/static`, `/_next/image`, favicon, robots/sitemap; everything else → `307 /coming-soon`). Keyed on `pathname`, so RSC / `.rsc` / segment-prefetch payloads to gated routes are gated too (verified: no flight-body leak); redirect-not-rewrite to stay RSC-safe.
  - **Toggle** — env-driven and **fail-closed**: `SITE_LOCKED` anything-but-`"false"` (incl. unset) locks the site; `develop` runs `SITE_LOCKED=false` (full app for team/client preview), the public `main` deploy runs `SITE_LOCKED=true`. Same artifact, config-only difference; launch = set it `false` and redeploy (no code revert). `NEXT_PUBLIC_SITE_LOCKED` mirrors it so the landing's Connect CTA points at `/coming-soon` instead of dead-ending.
  - **New files** — `middleware.ts`, `src/app/coming-soon/page.tsx`, `src/app/robots.ts`; the only existing-code edit is the landing CTA guard. No screen content changed. Typecheck / lint / production build green; gate matrix (locked, open, fail-closed) verified via `next start`.

### Changed
- **Faithful UI rebuild of `apps/web`** (Spec Kit feature `specs/002-web-app-ui/`) — **replaced** the prior diverged scaffold (generic hero + simplified shell + placeholder screens) with a **1:1 recreation of the approved Claude Design** (`docs/design-handover/showcase/`). The earlier scaffold *re-derived* a simplified UI in Tailwind; this rebuild **ports the design's own assets** instead (root cause of the client-flagged mismatch).
  - **Visual system** — `tokens.css` + `app.css` + each screen's `<style>` ported into the global stylesheet so the design's component classes exist verbatim; light/dark via **next-themes** (`sp-theme`, no flash; default theme set below); marketing landing dark-only; tabular numerals; brand spark-mark (coral→gold→blue).
  - **Shell** — TopBar (brand, Chat/Portfolio/Vault/Strategies, "Fully self-custodial" pill, Base/Sui switcher, wallet pill, ⌘K, notifications, avatar+theme), non-custody disclaimer strip, "Trust & control" rail + Withdraw/Exit, mobile bottom tabs + More sheet.
  - **Overlays** — `OverlayProvider` (portal): Prove-it sheet (Can/Can't + 5 guarantees), wallet menu, Base/Sui network menu, notifications sheet, ⌘K command palette, toasts.
  - **Screens** — public landing/connect/verify, onboarding (stepped mandate), chat (structured cards + tool-step thinking + inline confirm), portfolio (+ position detail), vault (net-APY breakdown incl. 10% perf fee/HWM + deposit/withdraw), strategies, the shared confirm gate (`confirm/[intent]`: sim → balance changes → guardrails → ack-gated sign → success), Trust Center (+permissions/exit), automation, bridge (Base↔Sui), fees, premium (+pay), outcomes, learn, srk, settings, notifications.
  - **Admin panel** — distinct observe-only shell at `/admin` (no auth yet, clearly labeled), "View as" role switcher, and overview/users/usage/tvl/**revenue dashboard**/system/**kill-switch** (pause-only · 2-of-3 · never blocks withdrawals)/config/audit.
  - **Mock data** — single `lib/mock-data.ts` mirroring the design's `SP.data`; wallet/AI/chain/auth remain simulated (later features).
  - 37 routes; typecheck / lint / production build all green.
- **Landing rebuilt as the animated "Spark Core"** — replaced the earlier (wrong-source) hero with a faithful port of `Spark Core Landing.html`: a fixed `<canvas>` particle core morphing through 6 scroll chapters, Ember/Plasma/Constellation flavor switcher, intro splash, progress dots, and per-chapter graphic cards (canvas engine ported into a React effect; dark-only; reduced-motion honoured; no GSAP dependency). Synced the two design files that changed in the latest handoff (Spark Core bg `#04070E`; onboarding header is now dark-only — theme toggle removed). Pixel diff vs the showcase: ~0.1%.
- **Admin scaffold notice is now dismissible** — the "no authentication yet" banner has an × ; once closed, `/admin` matches the showcase 1:1.
- **Parity harness** (`/e2e`, Playwright) — serves the approved showcase and diffs every screen (visual + DOM-text + interactions), incl. the admin panel, across desktop/mobile + light/dark. Verdict + per-screen report in `docs/parity/`. Confirms the scaffold is a faithful 1:1 recreation of the design.
- **Light is now the default theme** for the app and admin panel (`defaultTheme="light"`); the marketing landing remains dark-only (its dark palette is route-scoped to `.new-era-root`, independent of the theme default). Light/dark toggle + `sp-theme` persistence unchanged. (Investigated a reported "broken light mode" on app pages — verified via the parity harness, a 22-route luminance scan, computed styles, and the runtime toggle that light mode renders correctly across all app screens + overlays, matching the design within 1–5%.)
- **Landing upgraded to the "New Era" WebGL design** — replaced the 2D-canvas **Spark Core** landing with a single **Three.js** particle field (additive points + `UnrealBloom`) that morphs through six scroll-driven poses, with centred text panels crossfading over one fixed scene. Copy is unchanged; the visual engine, choreography, and layout are new. Pose → section mapping: **corona ring** → hero, **starfield** → 01 Sparky proposes, **spiral galaxy** (new pose) → 02 Guardrails check, **DNA helix** → 03 You sign, **wave/terrain** → 04 Aave Yield Vault, **gather → burst → white footer** → 05 Fully self-custodial (proof grid + CTAs). Adds `three`/`@types/three`; the Ember/Plasma/Constellation flavor switcher and the per-section graphic cards are removed; reduced-motion / no-WebGL fall back to a stacked, fully-legible scroll. New files `NewEraLanding.tsx` + `new-era.css` replace `SparkCoreLanding.tsx` + `spark-core.css`. Source of the visual language: a client "New Era" study built in Open Design (Three.js). Verified across all six poses (typecheck / lint / production build green; WebGL renders, no console errors). *Note:* the landing now intentionally **diverges** from the legacy `Spark Core Landing.html` showcase, so the `e2e` landing-parity entry is no longer a 1:1 target.
- **New Era landing — iterated to final.** Re-added the per-section graphic cards (Sparky chat · guardrail checklist · sign pad · vault chart) **integrated into the crossfade panels**, plus a vertical scroll-dot indicator; replaced the sign-pad line with a realistic **animated cursive signature**; tuned the palette/contrast (darker near-black field, on-glyph halos so copy stays legible over the bloom).
- **Landing light mode + theme toggle** (client request: **light is the default**, dark is the opt-in "full experience"; persisted as `sp-landing-theme`). Light mode is an **"ink-on-light"** render of the same poses (normal blending, bloom off). Adds a first-load **SparkPoint splash** (fades on mount) and a remembered, bottom-right **dark-mode nudge** toast.
- **`prefers-reduced-motion` respected** on the landing — renders the calm static fallback by default, with a remembered **"Play animation"** opt-in popup; the two bottom-right popups are stacked so they never overlap.
- **Mobile-friendly landing** — portrait camera pull-back so the poses fit; fixed a device-mode scroll bug (globals' `overflow-x:hidden` <1023px had turned `<body>` into a scroll container, freezing `window.scrollY`) via `overflow-x:clip`; reduced-motion nav scrolls with the page; mobile nav shows the full "Fully self-custodial" badge and drops the redundant Connect button.
- **Entry-flow theming + mobile** — a shared light/dark **`ThemeToggle`** on `/connect`, `/verify`, and `/onboarding` (wired to next-themes / `sp-theme`). Mobile: centred the connect/verify card and dropped the redundant top-right Connect; onboarding gained side margins, **full-width balanced option buttons**, and a looping **header badge rotator** (Fully self-custodial → Base network → wallet) so the network + address context fits.
- **Real wallet brand logos** on `/connect` — Coinbase / WalletConnect / MetaMask from `public/wallets/` (via `next/image`).
- **Admin panel link** in the app **profile (avatar) menu** → opens `/admin`.

## [0.1.0] - 2026-06-18

Initial planning baseline. Spec-Driven-Development artifacts and design handover, no application code.

### Added
- **Constitution v1.2.0** (`.specify/memory/constitution.md`) — core principles (non-custodial by construction; AI proposes, deterministic policy + the user disposes; provable not promised; conservative, transparent launch). Ratified 2026-06-15.
  - **v1.1.0** amendment — ratified the launch performance fee (0 management, 0 on principal, profit-only high-water-mark performance fee, default 10%, ≤20% cap).
  - **v1.2.0** amendment — **multi-network scope**: Base (launch) + Sui (designated fast-follow), connected by a fully self-custodial bridge; networks beyond Base + Sui out of scope. The non-EVM Sui account/vault stack and the bridge mechanism are a separate follow-on technical design. Adopted "fully self-custodial" as the canonical user-facing trust term.
- **Spec Kit launch feature** `specs/001-sparkpoint-pivot-mvp/` — `spec.md` (WHAT/WHY), `plan.md` (HOW / architecture), `research.md` (Phase 0 decisions), `data-model.md` (Phase 1 entities), `contracts/` (API + smart-contract interfaces), `quickstart.md` (end-to-end validation), `tasks.md` (dependency-ordered, story-grouped tasks).
- **High-level plan** `docs/high-level-plan/` — foundational product/strategy plan (v1, v2 "Natively Non-Custodial", and PDFs).
- **Design handover** `docs/design-handover/` — brief for Claude Design (web-app flows & UI) plus the live showcase; establishes the SparkPoint brand (cobalt / gold / coral).
- **Revenue model** — single 0-management / profit-only performance-fee Aave Yield Vault (0% management, 0% on principal, 10% performance fee on yield above a high-water mark; net-of-everything yield).
- **Living docs** — this `CHANGELOG.md`, plus `DEPLOYMENT.md`, `COOLIFY.md`, `DEVELOPMENT.md`, `MIGRATIONS.md` (ObraHaus playbook §7), tailored to the pre-build reality.

### Changed
- _N/A — initial entry._

### Fixed
- _N/A — initial entry._

### Database
- No migrations yet — Postgres + pgvector schema is planned (see MIGRATIONS.md). The migration history table is seeded empty.

### Infrastructure
- No services deployed. Dev/staging will run on **OH Coolify** (Proxmox homelab); client **production** will run later on the client's own infra/domain (likely sparkpoint.io), TBD. See DEPLOYMENT.md / COOLIFY.md (everything marked *planned — not yet deployed*).

[Unreleased]: https://github.com/ObraHaus/sparkpoint-pivot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ObraHaus/sparkpoint-pivot/releases/tag/v0.1.0
