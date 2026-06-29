# Feature Specification: Sparky rebrand (name + logo + favicon/metadata)

**Feature Branch**: `005-sparky-rebrand` (git: `feat/sparky-rebrand`)

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "Update the branding to Sparky — app name 'Sparky' ('Sparky AI' in sentences), a new shared logo (provided icon, white background removed), and refresh the favicon + metadata. Use the same logo for SparkPoint and Sparky."

## Context

The app currently presents as **"SparkPoint"** with a spark-mark logo. The client is rebranding the **app face to "Sparky"** (the AI assistant; "Sparky AI" in prose) and adopting a **new logo** — a geometric two-lozenge "S" mark (orange + blue with a yellow overlap), supplied as `Sparkpoint_icon.jpg` (on a white background that must be dropped). The new logo is shared across the brand.

> **Scope (clarified 2026-06-29):** **Full app-face → Sparky.** Every user-visible "SparkPoint" name becomes "Sparky" (or "Sparky AI" where it reads as the assistant), the new logo replaces the spark-mark **everywhere** (favicon, apple-icon, OG image, PWA manifest, AND the in-app brand mark in the top bar / footer / intro splash). **"SparkPoint" remains only as the underlying legal/product entity** in docs, the constitution, the repo name, and internal code comments/file references (e.g., `SparkPoint Pivot`, `SparkPoint Admin.html`). **Out of scope:** any layout/visual redesign beyond the name + logo swap; renaming the repository, docs, or constitution; the chat/AI behavior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent Sparky brand across the app (Priority: P1) 🎯 MVP

A visitor sees a single, consistent brand — "Sparky" with the new logo — on the landing, in the app shell, chat, confirm flows, and admin; no stray "SparkPoint" name remains in the UI.

**Why this priority**: Mixed branding looks broken/untrustworthy on a public product. This is the whole point.

**Independent Test**: Load the landing and key app screens; confirm the wordmark, intro splash, top bar, footer, and body copy say "Sparky" (or "Sparky AI"), with the new logo — and a UI scan finds no user-visible "SparkPoint".

**Acceptance Scenarios**:

1. **Given** the landing, **When** it loads, **Then** the intro splash, top-bar wordmark, and footer show "Sparky" with the new logo (not the old spark-mark / "SparkPoint").
2. **Given** any app surface (chat, confirm flow, admin, onboarding), **When** the product is named in copy, **Then** it reads "Sparky" (or "Sparky AI" where it denotes the assistant).
3. **Given** the whole app, **When** scanned for user-visible text, **Then** no "SparkPoint" appears except legitimate legal/entity/internal references (comments, file paths, repo/project name).

### User Story 2 - New logo as favicon + metadata + social (Priority: P1)

The new logo appears as the browser-tab favicon, the iOS/PWA icon, and the social-share (OpenGraph) image, with the page/app titled "Sparky".

**Why this priority**: The favicon/title/social card are the most public brand touchpoints.

**Independent Test**: Check `/icon`, `/apple-icon`, `/opengraph-image`, `/manifest.webmanifest`, and the `<title>`/OG meta — all show the new logo and the "Sparky" name; the logo has a transparent background (no white box).

**Acceptance Scenarios**:

1. **Given** the favicon/app-icon/OG routes, **When** requested, **Then** they render the **new logo** (transparent background — no white box) and the title/name is "Sparky".
2. **Given** the browser tab and PWA install, **When** shown, **Then** the title/short-name is "Sparky".

### Edge Cases

- **Logo on dark vs light** — the logo's background must be transparent so it sits cleanly on the dark landing field, the light app, and the OG dark card (no white rectangle).
- **Inline mark at small sizes** — the brand mark renders crisply from ~13px (top bar) up to the large intro splash (favours a vector logo).
- **Legal/entity references** — "SparkPoint Pivot" (project), "SparkPoint Admin.html" (design file), constitution/docs, and code comments are NOT user-facing and stay "SparkPoint".
- **"SparkPoint AI"** (chat label) → "Sparky AI".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every **user-visible** occurrence of the product name "SparkPoint" MUST become "Sparky" (or "Sparky AI" where it denotes the assistant) across landing, shell, chat, confirm flows, onboarding, admin, and metadata.
- **FR-002**: The **new logo** MUST replace the previous spark-mark on ALL surfaces: the in-app brand mark (top bar, footer, intro splash), the favicon, the apple-icon, the OpenGraph image, and the PWA manifest icon.
- **FR-003**: The logo MUST render with a **transparent background** (the supplied white background removed) so it sits cleanly on dark and light backgrounds.
- **FR-004**: The logo MUST be **crisp at all sizes** used (≈13px inline → large splash → 1200×630 OG).
- **FR-005**: The browser-tab **title** and **PWA name/short-name** MUST be "Sparky".
- **FR-006**: "SparkPoint" MUST be **preserved** in non-user-facing contexts: code comments, file-path references, the `SparkPoint Pivot` project name, docs, and the constitution.
- **FR-007**: No layout, spacing, or visual redesign beyond the name text + logo swap; screens otherwise unchanged.
- **FR-008**: The construction gate, the Mailjet subscribe, and all existing behavior MUST keep working (no regression).

### Key Entities

- **Brand mark (logo)**: the new two-lozenge "S" (orange `#F47B3F`-ish, blue `#4577E6`-ish, yellow overlap), transparent background, used at every size.
- **Brand name**: "Sparky" (display) / "Sparky AI" (prose for the assistant).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A UI scan of the running app finds **zero** user-visible "SparkPoint" (only legal/entity/internal references remain).
- **SC-002**: `/icon` · `/apple-icon` · `/opengraph-image` · `/manifest.webmanifest` and the in-app mark all render the **new logo** with a transparent background; the `<title>` and manifest name are "Sparky".
- **SC-003**: The recreated logo is **visually faithful** to the supplied icon (verified by rendering it and comparing to `Sparkpoint_icon.jpg`).
- **SC-004**: `tsc` / `eslint` / `next build` green; the gate + subscribe flows still pass their checks (no regression).

## Assumptions

- No raster image tooling is available in the environment, so the logo is **recreated as a vector SVG** (faithful to the supplied asset, verified by rendering) — which also yields the crispest favicon + inline mark. (If the client prefers the exact raster asset, they can supply a pre-cut transparent PNG later; the SVG is a drop-in.)
- "Sparky" is used as the brand/display name; "Sparky AI" where a sentence refers to the assistant. The legal entity remains "SparkPoint" in docs.
- This is a client-brand change (sanctioned client-project divergence — the project owns its brand per CLAUDE.md).
