---
description: "Task list for the Sparky rebrand"
---

# Tasks: Sparky rebrand

**Input**: `/specs/005-sparky-rebrand/` (spec ✓, plan ✓, checklist ✓)

**Tests**: No unit suite. Verification = Playwright render-compare of the logo, a residual-"SparkPoint" scan, `tsc`/`eslint`/`build`, and a gate/subscribe regression check.

## Phase 1: Logo (Foundational — blocks the visual swap)

- [ ] T001 Recreate the new logo as `apps/web/src/app/icon.svg` (transparent two-lozenge "S": orange + blue, yellow = exact intersection via clip).
- [ ] T002 Verify fidelity — render `icon.svg` via the `/e2e` Playwright chromium → screenshot → compare to `Sparkpoint_icon.jpg`; iterate T001 until faithful (SC-003).
- [ ] T003 Add `apps/web/src/components/ui/SparkLogo.tsx` (the shared logo, size-prop) sourced from the same SVG.

## Phase 2: Swap the mark everywhere (P1 / US2 logo)

- [ ] T004 Point the in-app marks at the new logo: replace the local `SparkMark` in `NewEraLanding.tsx` and the `SparkMark` in `src/lib/icons.tsx` to render `SparkLogo` (covers top bar, footer, splash, and all icon usages). Implements FR-002/004.
- [ ] T005 Update generated images: `apple-icon.tsx` + `opengraph-image.tsx` embed the new logo (data-URL `<img>`), transparent. Implements FR-002/003.

## Phase 3: Rename SparkPoint → Sparky (P1 / US1)

- [ ] T006 Guarded global rename across `apps/web/src`: `SparkPoint → Sparky` while preserving `SparkPoint Pivot`, `SparkPoint Admin`, and file-path refs; `SparkPoint AI → Sparky AI` results naturally. Implements FR-001/006.
- [ ] T007 Metadata/manifest: confirm `layout.tsx` (title default + template, applicationName, authors/creator, og/twitter titles, siteName) and `manifest.ts` (name/short_name) all read "Sparky". Implements FR-005.
- [ ] T008 Decide the few judgment cases: footer copyright + body claims → "Sparky"; keep comments/`SparkPoint Pivot`/file refs. Spot-check `thinking.tsx` → "Sparky AI".

## Phase 4: Validate

- [ ] T009 Scan: `grep -rn "SparkPoint" apps/web/src` shows only legal/entity/internal refs (no user-visible) — SC-001.
- [ ] T010 `tsc --noEmit` + `eslint .` + `next build` green — SC-004.
- [ ] T011 Regression: gate (`/admin`→307, `/`→200) + `/api/subscribe` (invalid→400) still pass; visual check of landing + 1–2 app screens show new logo + Sparky.
- [ ] T012 Run agent-context-update (CLAUDE.md speckit pointer → 005); CHANGELOG entry.

## Dependencies
- T001→T002→T003 (logo first); T004/T005 depend on the logo; T006 (rename) is independent of the logo and can run in parallel; T007/T008 follow T006; Phase 4 last.

## Traceability
| Task | FR / SC |
|---|---|
| T001–T003 | FR-002/003/004 · SC-003 |
| T004–T005 | FR-002/003/004 · SC-002 |
| T006–T008 | FR-001/005/006 · SC-001 |
| T009–T011 | SC-001/004 · FR-007/008 |
