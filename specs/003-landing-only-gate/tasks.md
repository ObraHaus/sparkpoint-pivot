---
description: "Task list for the landing-only construction gate"
---

# Tasks: Landing-only construction gate

**Input**: Design documents from `/specs/003-landing-only-gate/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, contracts/gate-contract.md ✓, quickstart.md ✓

**Tests**: No unit tests requested. Verification is the request-level **gate matrix** in `quickstart.md` (run against `next start`), plus the `tsc`/`eslint`/`build` gates. These appear as explicit verification tasks below.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 (traces to spec user stories)
- All paths are under `apps/web/` unless noted.

---

## Phase 1: Setup

**Purpose**: Configuration scaffolding the gate reads.

- [ ] T001 [P] Add gate keys to `apps/web/.env.example` (`SITE_LOCKED`, `NEXT_PUBLIC_SITE_LOCKED`) with comments, and create a gitignored `apps/web/.env.local` for local dev (`SITE_LOCKED=false`, `NEXT_PUBLIC_SITE_LOCKED=false`). Per `contracts/gate-contract.md`.

---

## Phase 2: Foundational (the gate mechanism — BLOCKS all stories)

**Purpose**: The middleware choke point + the Coming soon target + crawler rules. No user story behaves correctly until these exist.

**⚠️ CRITICAL**: This phase implements the security boundary (FR-004) and must match `contracts/gate-contract.md` exactly.

- [ ] T002 [US1] Create `apps/web/middleware.ts`: fail-closed `LOCKED` read (`SITE_LOCKED !== 'false'`), pathname **allow-list** (exact `/`, `/coming-soon`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`; prefix `/_next/static`, `/_next/image`), else **307 redirect** to `/coming-soon` with `x-robots-tag: noindex, nofollow`; `NextResponse.next()` when not locked; `config.matcher` excluding static infra **by prefix only** (`["/((?!_next/static|_next/image|favicon.ico).*)"]`). Implements FR-001/002/004/006/007, invariants I-1/I-2/I-4.
- [ ] T003 [P] [US1] Create `apps/web/src/app/coming-soon/page.tsx`: minimal brand-consistent server component, no client providers / no Three.js, `metadata.robots = { index:false, follow:false }`, link back to `/`. Implements FR-003.
- [ ] T004 [P] [US1] Create `apps/web/src/app/robots.ts`: when locked, allow only `/` and disallow the rest; permissive when open. Implements FR-003 / SEO edge case.

**Checkpoint**: gate mechanism present; stories can be verified.

---

## Phase 3: User Story 1 — Public sees only the landing (P1) 🎯 MVP

**Goal**: Public reaches only `/`; everything else → Coming soon; landing renders fully; CTA never dead-ends.

**Independent Test**: `quickstart.md` gate-ON matrix (groups 1–3) + fail-closed check.

- [ ] T005 [US1] Edit `apps/web/src/components/screens/landing/NewEraLanding.tsx`: guard `goConnect()` (and the ~4 CTA call sites) so that when `process.env.NEXT_PUBLIC_SITE_LOCKED` is truthy it routes to `/coming-soon` (and/or relabels) instead of `/connect`. Cosmetic only — middleware is the real gate. Implements FR-008, SC-006.
- [ ] T006 [US1] Verify gate-ON: run `quickstart.md` groups 1–3 against a `SITE_LOCKED=true` `next build && next start` — landing + assets 200; every gated route incl. `.rsc`/RSC-header/segment/`_rsc` shapes 307→`/coming-soon` with no flight body. Confirms SC-001, SC-002, I-2, I-3.
- [ ] T007 [US1] Verify fail-closed: unset `SITE_LOCKED`, build+serve, confirm `/admin` is gated (307). Confirms SC-004, I-1.

**Checkpoint**: US1 fully functional and verified — the MVP (public landing-only) is demoable.

---

## Phase 4: User Story 2 — Team previews the full app off-stage (P1)

**Goal**: Same artifact, gate OFF ⇒ full app, no code difference.

**Independent Test**: `quickstart.md` gate-OFF baseline smoke.

- [ ] T008 [US2] Verify gate-OFF: `SITE_LOCKED=false` build+serve; confirm `/`, `/chat`, `/vault`, `/admin`, `/connect`, `/confirm/x` all 200 and render full content (no Coming soon, no redirects). Confirms SC-005, I-4.
- [ ] T009 [P] [US2] Document the per-environment matrix (local / `develop` open / public-`main` locked) in `COOLIFY.md` (env vars section) so the same image toggles per app. Implements FR-010.

**Checkpoint**: US1 (locked) and US2 (open) both verified on the same build.

---

## Phase 5: User Story 3 — Launch by flipping the switch (P2)

**Goal**: Un-gate at launch via config only.

- [ ] T010 [P] [US3] Document the launch (un-gate) procedure in `DEPLOYMENT.md`: set `SITE_LOCKED=false` (+ `NEXT_PUBLIC_SITE_LOCKED=false`) on the public app and redeploy; no code revert. Implements FR-009/010.

---

## Phase 6: Polish & cross-cutting

- [ ] T011 [P] Add a `CHANGELOG.md` `[Unreleased]` entry describing the construction gate (env-toggled middleware + Coming soon page) and the per-env matrix.
- [ ] T012 [P] Update the `CLAUDE.md` `<!-- SPECKIT START -->` pointer to `specs/003-landing-only-gate/plan.md` (current active feature).
- [ ] T013 Final gates: `npx tsc --noEmit` + `npx eslint .` + `npx next build` all green; route table still lists all routes. Confirms FR-011, SC-005.

---

## Dependencies & Execution Order

- **Setup (T001)** → first.
- **Foundational (T002–T004)** → blocks all stories. T003/T004 are [P] (different files); T002 is the core.
- **US1 (T005–T007)** → after Foundational. T006/T007 are verification (need the build).
- **US2 (T008–T009)** → after Foundational; independent of US1's CTA edit.
- **US3 (T010)** → docs; any time after Foundational.
- **Polish (T011–T013)** → last; T013 is the final gate.

### Parallel opportunities

- T003 + T004 together (different new files).
- T009 + T010 + T011 + T012 together (different doc files).

## Traceability

| Task | FR / SC |
|---|---|
| T002 | FR-001/002/004/006/007 · I-1/I-2/I-4 |
| T003 | FR-003 |
| T004 | FR-003 (SEO) |
| T005 | FR-008 · SC-006 |
| T006 | SC-001/002 · I-2/I-3 |
| T007 | SC-004 · I-1 |
| T008 | SC-005 · I-4 |
| T009/T010 | FR-005/009/010 |
| T013 | FR-011 · SC-005 |

## Notes

- The only edit to existing code is T005 (landing CTA); all other code is new files (FR-011 / I-5).
- Commit after Foundational and after each story; **confirm before any push/PR/merge** (per CLAUDE.md).
