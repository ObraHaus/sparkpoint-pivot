# Implementation Plan: Landing-only construction gate

**Branch**: `003-landing-only-gate` (git: `feature/landing-only-gate`) | **Date**: 2026-06-26 | **Spec**: ./spec.md

**Input**: Feature specification from `specs/003-landing-only-gate/spec.md`

## Summary

Add a per-deployment **construction gate** to `apps/web` so the public sees only the marketing landing (`/`) while every other route shows a branded, noindex **Coming soon** page — without removing or rebuilding any app code. The gate is a single **Next.js `middleware.ts`** (the app has none today) that, when locked, allows a tiny **allow-list** (`/`, Next static/image internals, favicon, robots) and **redirects everything else** to `/coming-soon`. It is toggled by an environment variable (`SITE_LOCKED`), read **fail-closed**, so `develop` runs fully open for team preview and the `main`-based public deployment runs landing-only — same artifact, config-only difference. A `NEXT_PUBLIC_SITE_LOCKED` mirror keeps the landing's Connect CTA from dead-ending. Launch is a config flip (`SITE_LOCKED=false`), no code revert.

## Technical Context

**Language/Version**: TypeScript 5 · Node 22 · React 19

**Primary Dependencies**: Next.js 16 (App Router, Turbopack) — **Edge middleware** (built-in, no new dependency); next-themes/three/wagmi unaffected. No new packages.

**Storage**: None. Gate state is deployment configuration (env vars), not data.

**Testing**: `tsc --noEmit` + `eslint` + `next build` gates (must stay green); a **request-level gate matrix** run against `next build && next start` with `SITE_LOCKED=true` (curl every gated route + its `.rsc`/RSC-header/segment-prefetch shapes → all redirect; `/` + assets → 200); plus an OFF-state smoke (all routes still render). See `quickstart.md`.

**Target Platform**: Modern web browsers; served by `next start` (Node server) behind Coolify Nixpacks (dev/staging) and, for this feature, a public `main` deployment.

**Project Type**: Web frontend (single app, `apps/web`) — no backend in scope.

**Performance Goals**: Middleware adds a single string/Set check per app-route request (negligible); the matcher skips static assets entirely. When `SITE_LOCKED` is off, middleware short-circuits to a pass-through.

**Constraints**: Server-side enforcement (cannot be bypassed client-side or via RSC/data payloads); **fail-closed** on missing/unparseable config; the landing (`/`) and all its assets (Three.js chunks, Geist `woff2` fonts under `/_next/static/media`, favicon) MUST keep loading; no change to any existing screen; keep `tsc`/`eslint`/`build` green.

**Scale/Scope**: 1 new middleware file, 1 new route (`/coming-soon`), 1 new `robots.ts`, 1 small edit to the landing CTA, env-var docs. Gates ~36 existing routes by default allow-listing exactly one.

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1.*

| Principle (constitution v1.2.0) | Assessment |
|---|---|
| I. Non-Custodial by Construction (NON-NEGOTIABLE) | **PASS / N/A** — a route-reachability gate over a mock-data UI. Touches no funds, keys, vault, or session-key path; no custody surface exists here, so no invariant (N1–N5) can be affected. The withdraw-always escape hatch is a contract/UI concern unrelated to this gate. |
| II. AI proposes, deterministic policy + user disposes | **PASS / N/A** — no AI and no execution path involved; the gate only decides which routes are reachable. |
| III. Provable, not promised | **PASS** — the gate makes an honest claim ("under construction") instead of exposing a half-built product as if ready; the Coming soon page states the real status. |
| IV. Security & bounded blast radius | **PASS (reinforces)** — server-side, fail-closed, default-deny allow-list narrows the public surface to one route; documented residual (compiled client code in static bundle) is explicitly bounded and accepted for mock data. No new attack surface (no auth secrets, no new deps). |
| V. Conservative, transparent launch | **PASS (reinforces)** — deliberately narrow public exposure (landing only) until the product is ready; the opposite of over-exposing. |
| VI. Spec-Driven Development (NON-NEGOTIABLE) | **PASS** — delivered via this Spec Kit feature: spec → clarify → plan (this gate) → tasks → implement; artifacts kept cross-consistent. |
| VII. Simplicity & YAGNI (NON-NEGOTIABLE) | **PASS** — the minimal mechanism (one middleware + one page + a config flag). Heavier options (separate landing-only build, reverse-proxy allow-list, Basic Auth) were considered and rejected as over-engineered for a temporary curtain (see `research.md`). No speculative generality. |

**Gate result: PASS** — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/003-landing-only-gate/
├── spec.md              # WHAT/WHY + clarifications
├── plan.md              # This file
├── research.md          # Phase 0 — approach comparison + adversarial findings baked into the design
├── quickstart.md        # Phase 1 — run + the request-level gate matrix to verify
├── contracts/
│   └── gate-contract.md  # Phase 1 — allow-list, gated set, env matrix, response shapes
└── tasks.md             # Phase 2 (/speckit-tasks)
```

(No `data-model.md`: the feature introduces no data entities — gate state is env configuration.)

### Source Code (apps/web)

```text
apps/web/
├── middleware.ts                              # NEW — the gate (project root of the web app, sibling of next.config.ts)
└── src/
    ├── app/
    │   ├── coming-soon/page.tsx               # NEW — branded, noindex "Coming soon" server page (no client providers / no Three.js)
    │   ├── robots.ts                          # NEW — when locked, Disallow: / except "/"; keeps the gated app out of crawlers
    │   └── page.tsx                           # unchanged (landing entry)
    └── components/screens/landing/
        └── NewEraLanding.tsx                  # EDIT — guard goConnect() so the CTA never dead-ends into gated /connect when locked
```

**Structure Decision**: Single Next.js app under `apps/web`. The gate is a **root `middleware.ts`** (Next 16 auto-detects it; runs in the Edge runtime before routing) — the one true choke point for all ~36 routes, so no per-route edits and any future route is gated by default. The Coming soon page is an ordinary App Router route inside the allow-list. The only existing-file edit is the landing CTA guard, which is cosmetic (the middleware is the real enforcement).

## Architecture of the gate (how the design satisfies the spec)

The design encodes the findings of the Phase 0 adversarial review (`research.md`) directly:

1. **Choke point + default-deny allow-list (FR-001/002, edge cases).** `middleware.ts` keys on `request.nextUrl.pathname` and allows only: exact `/`, `/coming-soon`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, and prefix `/_next/static`, `/_next/image`. **Everything else → redirect to `/coming-soon`.** Allow-listing (not a denylist of known routes) is what makes the dynamic routes `/confirm/[intent]` and `/portfolio/[positionId]`, unknown/misspelled paths, and any future route gated by default.
2. **Server-side, payload-proof enforcement (FR-004).** Middleware runs before render, so gated pages never execute. Because App Router serves RSC/prefetch payloads as **same-pathname** requests (and `.rsc` / `.segment.rsc` suffixed paths), keying on `pathname` — and never allow-listing by the `RSC` / `Next-Router-Prefetch` header or `?_rsc=` query — gates the data payloads too. The matcher excludes only true static infra by **prefix** (not by file-extension), so `/chat.rsc` is *not* mistaken for a static asset.
3. **Fail-closed toggle (FR-005/006).** `const LOCKED = (process.env.SITE_LOCKED ?? '').toLowerCase() !== 'false'` — anything other than an explicit `"false"` locks the site, so a missing/typo'd value on a public deploy stays gated. The value must be present in each app's **build** environment (Next inlines it for Edge middleware; Coolify injects per-app env at build). `develop` sets `SITE_LOCKED=false` (open); the public `main` app sets `SITE_LOCKED=true`.
4. **No-op when open (FR-007/009).** If `!LOCKED`, middleware returns `NextResponse.next()` immediately — behaviorally identical to having no middleware. Launch = set `SITE_LOCKED=false` and redeploy.
5. **Redirect, not rewrite (edge cases).** Gated routes get a `307` redirect to `/coming-soon` with `x-robots-tag: noindex, nofollow`. Redirect (not rewrite) avoids handing the App Router the wrong RSC flight on a soft navigation. The Coming soon page is a plain server component that pulls **no** gated chunks.
6. **CTA never dead-ends (FR-008).** A client-readable `NEXT_PUBLIC_SITE_LOCKED` mirror (a client component can't read the server-only `SITE_LOCKED`) makes the landing's `goConnect()` route to `/coming-soon` (and/or relabel) when locked, instead of bouncing off the gated `/connect`.
7. **SEO (FR-003, edge cases).** `robots.ts` emits `Disallow: /` for everything but `/` when locked; the Coming soon page sets `metadata.robots = { index: false }`; the landing indexes normally.

## Complexity Tracking

> No constitution violations — not required.
