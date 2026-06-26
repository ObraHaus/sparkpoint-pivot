# Feature Specification: Landing-only construction gate

**Feature Branch**: `003-landing-only-gate` (git: `feature/landing-only-gate`)

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "Merge develop to main to deploy the landing page, but don't let anyone access anything but the landing page since the rest is still under construction."

## Context

The web app (`apps/web`) is a faithful UI build on mock data (feature `002-web-app-ui`): a public marketing **landing** at `/` plus the full app behind it — the wallet entry flow (`/connect`, `/onboarding`, `/verify`), the authenticated app (Chat, Portfolio, Vault, Strategies, Trust Center, etc.), and the observe-only Admin panel. The app is **not ready for users** — it is mock data with no real wallet/AI/chain/auth.

The client wants to put the **landing page** in front of the public now, while keeping everything else **inaccessible** until it ships. The same codebase must still be fully browsable by the team/client on a non-public environment so build progress can be reviewed. This feature adds a **construction gate**: a per-deployment switch that, when on, exposes only the landing and turns every other route into a friendly "coming soon" page; when off, the whole app is reachable (today's behavior). Flipping the switch off is how the app eventually launches — no code change or revert.

> **Out of scope (unchanged by this feature):** real wallet/AI/chain/auth, the app screens' content, and the design. This feature only governs *reachability* of routes; it does not modify any screen. It is a temporary launch curtain, not an authentication/authorization system (real auth is a later feature).

## Clarifications

### Session 2026-06-26

- Q: Where does the public landing actually deploy? → A: A **gated deployment built from `main`** (merge `develop` → `main`, deploy with the gate ON). `develop` stays the ungated full-app preview for the team. (Production-on-Coolify was previously "reserved only"; this gated landing is the first public deploy — operator approved the `main` merge for this.)
- Q: What does a public visitor see at a gated route? → A: A **branded "Coming soon" page** (noindex), not a silent redirect or a bare 404.
- Q: How hidden must the under-construction app be? → A: **Block navigation.** Pages, their data payloads, and direct URLs must be unreachable. It is an accepted residual that compiled client code for gated screens still ships in the public static bundle (a determined developer could read mock-data strings); fully removing gated code from the public build is explicitly **not** required for this curtain over mock data.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public sees only the landing (Priority: P1) 🎯 MVP

A member of the public visits the gated public deployment. The marketing landing renders fully. Every other route — typed directly, followed from a link, or prefetched — does not reveal the under-construction app; instead it lands on a branded "Coming soon" page. The landing has no control that dead-ends into a gated screen.

**Why this priority**: This is the entire purpose — show the world the landing without exposing the unfinished product. It is independently demoable as the complete public experience.

**Independent Test**: On a deployment with the gate ON, load `/` (the animated landing renders), then attempt `/chat`, `/vault`, `/admin`, `/connect`, `/confirm/anything`, `/portfolio/anything` — each shows the "Coming soon" page and none renders app content or returns app data.

**Acceptance Scenarios**:

1. **Given** the gate is ON, **When** a visitor loads `/`, **Then** the New Era landing renders completely (animation, fonts, copy, and styling all intact).
2. **Given** the gate is ON, **When** a visitor navigates to any non-landing route (`/connect`, `/onboarding`, `/verify`, any app screen, any `/admin/*`), **Then** they are taken to a branded "Coming soon" page and no app screen content is shown.
3. **Given** the gate is ON, **When** a client requests a gated route's **data payload** (e.g. a router prefetch / partial-render request for `/admin`), **Then** the under-construction screen's content is not returned.
4. **Given** the gate is ON, **When** a visitor requests an unknown or dynamic gated path (`/confirm/x`, `/portfolio/123`, a misspelled route), **Then** it is gated by default (Coming soon), never served.
5. **Given** the gate is ON, **When** a visitor uses the landing's call-to-action, **Then** it does not dead-end into a gated route — it is hidden, relabeled, or points at the "Coming soon" page.
6. **Given** the gate is ON, **When** a search-engine crawler requests gated routes, **Then** those responses are marked not-to-index.

---

### User Story 2 - Team previews the full app off-stage (Priority: P1)

The team and client open the non-public preview environment (the `develop` deployment) and browse the entire app — every screen, overlay, and the admin panel — exactly as today, with no password and no friction.

**Why this priority**: Build review must continue while the public sees only the landing. If the gate could not be turned off per environment, the team would lose its preview. Independently testable on the ungated environment.

**Independent Test**: On a deployment with the gate OFF, confirm `/chat`, `/vault`, `/admin`, and the entry flow all render their full content exactly as before this feature.

**Acceptance Scenarios**:

1. **Given** the gate is OFF, **When** any route is visited, **Then** the app behaves exactly as it did before this feature (no Coming soon page, no redirects).
2. **Given** the same single codebase/build artifact, **When** it is deployed to two environments configured differently, **Then** one can be public-landing-only and the other fully open — with no code difference between them.

---

### User Story 3 - Launch by flipping the switch (Priority: P2)

When the app is ready, an operator turns the gate off on the public deployment and the full app goes live — without reverting code or shipping a special build.

**Why this priority**: Removes launch-day risk and code churn. Important but not needed for the initial landing-only deploy, so P2.

**Independent Test**: On the gated public deployment, change only the gate configuration to OFF, redeploy, and confirm every previously gated route now serves its real content.

**Acceptance Scenarios**:

1. **Given** the public deployment is gated, **When** the operator sets the gate to OFF and redeploys, **Then** all routes become publicly reachable with no code change.
2. **Given** the gate mechanism remains in the codebase after launch, **When** it is OFF, **Then** it has no effect on behavior or meaningful effect on performance.

### Edge Cases

- **Configuration missing/ambiguous**: if the gate setting is absent or unparseable on a public-facing deployment, the system MUST treat the site as **gated** (fail closed), never accidentally expose the full app.
- **Landing assets**: the landing's own scripts, styles, fonts, and favicon MUST remain reachable when gated, or the landing breaks. The gate MUST NOT degrade the landing.
- **Data/partial-render requests**: gated routes MUST be unreachable via their data/partial-render request shapes, not only their full-page HTML.
- **Dynamic & unknown routes**: anything that is not explicitly the landing (or a required asset) MUST be gated by default — including dynamic routes and not-found paths.
- **CTA dead-end**: the landing's "connect" action targets a gated route; while gated it MUST NOT leave the visitor on a broken/looping click.
- **Crawlers/SEO**: gated routes MUST signal not-to-index so the unfinished app is not indexed; the landing itself indexes normally.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose **only the landing route** (`/`) and the assets it needs to render, to the public when the gate is ON.
- **FR-002**: The system MUST make every non-landing route — the entry flow (`/connect`, `/onboarding`, `/verify`), all authenticated app screens, and all `/admin/*` screens — **unreachable** by the public when the gate is ON, by **default allow-listing** the landing rather than enumerating routes to block.
- **FR-003**: A gated request MUST result in a **branded "Coming soon" page** that is marked **not-to-index**, rather than a silent redirect or a bare error.
- **FR-004**: Gating MUST be enforced **server-side**, before any gated screen renders or returns data, so it cannot be bypassed by disabling client scripts, requesting before hydration, or requesting a route's data/partial-render payload directly.
- **FR-005**: The gate MUST be **toggleable per deployment via configuration only** — no code change, no separate build — so `develop` can be fully open while the `main`-based public deployment is landing-only.
- **FR-006**: When the gate configuration is **missing or unparseable on a public deployment**, the system MUST **fail closed** (treat the site as gated).
- **FR-007**: When the gate is **OFF**, the application MUST behave exactly as before this feature (no gating, no redirects, no Coming soon page).
- **FR-008**: The landing's call-to-action MUST NOT dead-end into a gated route while the gate is ON (hidden, relabeled, or pointed at the Coming soon page).
- **FR-009**: Turning the gate **OFF** MUST make all routes publicly reachable again with **no code revert** and no special build.
- **FR-010**: The gate's configuration keys, the per-environment matrix (local / `develop` / public-`main`), and the launch (un-gate) procedure MUST be documented in the living docs.
- **FR-011**: The feature MUST NOT alter any existing screen's content, layout, or copy; it governs route **reachability** only.

### Key Entities

- **Gate state**: a per-deployment on/off setting (and a client-visible mirror used only to keep the landing's CTA from dead-ending). Not user data; deployment configuration.
- **Coming soon page**: a minimal, brand-consistent, not-indexed page shown for all gated routes, with a link back to the landing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a gated deployment, **100% of non-landing routes** (every entry-flow, app, admin, dynamic, and unknown path tested) resolve to the Coming soon page and return **no** app-screen content or data payload.
- **SC-002**: On a gated deployment, the landing at `/` renders with **full visual fidelity** (animation, fonts, styling, copy) — indistinguishable from today's landing.
- **SC-003**: Switching a deployment between gated and open requires **changing only configuration** (zero code changes) and is verified on both `develop` (open) and the `main` public deploy (gated).
- **SC-004**: With the gate configuration absent on a public deploy, the site is **gated** (fail-closed), confirmed by test.
- **SC-005**: With the gate OFF, an automated check shows app routes behave **identically** to the pre-feature baseline (typecheck/lint/build green; every route still reachable).
- **SC-006**: The landing's CTA performs a **non-dead-end** action while gated (no broken or looping click), confirmed manually.

## Assumptions

- The public landing is served from a **deployment built off `main`** with the gate ON; `develop` runs the same artifact with the gate OFF for team/client preview. (Per COOLIFY.md, the public Coolify app does not exist yet and will be created as part of deployment; the operator has approved the `develop` → `main` merge for this.)
- "Block navigation" is the agreed security bar: pages and their data are unreachable, but the **compiled client code** of gated screens may still be present in the public static bundle (accepted residual for a curtain over mock data). If true code-confidentiality is later required, that is a separate "landing-only build" feature.
- The landing is **asset-light** and self-contained; gating non-landing routes does not remove anything the landing depends on.
- This is a **temporary launch curtain**; it stays dormant (OFF) in the codebase after launch and adds no meaningful runtime cost when OFF.
- No real authentication exists yet; the gate is **not** a substitute for it and protects no sensitive data (the app is mock data).
