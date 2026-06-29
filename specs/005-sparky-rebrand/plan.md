# Implementation Plan: Sparky rebrand

**Branch**: `005-sparky-rebrand` (git: `feat/sparky-rebrand`) | **Date**: 2026-06-29 | **Spec**: ./spec.md

**Input**: Feature specification from `specs/005-sparky-rebrand/spec.md`

## Summary

Rebrand the app face from **SparkPoint → Sparky** ("Sparky AI" in prose) and swap the spark-mark for the **new two-lozenge logo** on every surface (in-app brand mark, favicon, apple-icon, OG image, PWA manifest, titles/metadata). Because no raster image tooling exists in the environment, the logo is **recreated as a vector SVG** (transparent by construction, crisp at all sizes) and **verified for fidelity** by rendering it with the Playwright chromium already in `/e2e` and comparing to `Sparkpoint_icon.jpg`. The name change is a **guarded global rename** (protecting the legal/internal `SparkPoint Pivot` project name + file references). No layout/visual redesign; no regression to the gate or subscribe.

## Technical Context

**Language/Version**: TypeScript 5 · React 19 · Next 16. **No new dependencies.**

**Tooling note**: No ImageMagick/Pillow/sharp/ffmpeg/pip available → the logo is authored as **SVG** (also the best favicon/inline-mark format). Visual verification uses the **Playwright chromium in `/e2e`** (render the SVG → screenshot → compare to the original).

**Testing**: `tsc` / `eslint` / `next build`; a Playwright render-compare of the recreated logo vs the supplied icon; a grep/scan for residual user-visible "SparkPoint"; re-verify the gate + `/api/subscribe`.

**Constraints**: logo transparent (no white box) on dark + light; crisp ≈13px → OG 1200×630; preserve `SparkPoint Pivot` / file refs / comments / docs; no visual redesign; keep all gates green.

**Scope/Scale**: 1 new logo SVG (+ a `SparkLogo` component replacing `SparkMark`), 4 metadata routes updated, layout/manifest metadata, and a guarded rename across ~45 files.

## Constitution Check (v1.2.0)

| Principle | Assessment |
|---|---|
| I. Non-custodial · II. AI-proposes · III. Provable | **PASS / N/A** — a name + logo change; no funds/keys/AI/chain path; claims/guarantees copy unchanged except the brand noun. |
| IV. Security & blast radius | **PASS** — no new surface, deps, or secrets; pure presentational change. |
| V. Conservative launch | **PASS** — branding only. |
| VI. Spec-Driven Development | **PASS** — this speckit feature. |
| VII. Simplicity & YAGNI | **PASS** — one shared SVG logo + a guarded rename; no redesign, no new deps. Client-brand change is a sanctioned divergence (CLAUDE.md). |

**Gate result: PASS** — no violations; Complexity Tracking not required.

## Project Structure

```text
specs/005-sparky-rebrand/  — spec.md, plan.md, checklists/requirements.md, tasks.md
apps/web/
├── src/app/icon.svg                      # REPLACE — new logo (favicon)
├── src/app/apple-icon.tsx                # EDIT — render new logo
├── src/app/opengraph-image.tsx           # EDIT — new logo + "Sparky" wordmark
├── src/app/manifest.ts                    # EDIT (rename) — name/short_name → Sparky
├── src/app/layout.tsx                     # EDIT (rename) — title/og/twitter/applicationName → Sparky
├── src/components/ui/SparkLogo.tsx        # NEW — the shared logo SVG component (replaces SparkMark usages)
├── src/components/screens/landing/NewEraLanding.tsx  # EDIT — SparkMark→SparkLogo + wordmark rename
└── (guarded rename SparkPoint→Sparky across apps/web/src — shell, screens, chat, admin, overlays, ui, app/*)
```

**Structure Decision**: Introduce one **`SparkLogo`** SVG component as the single source of the mark; replace the local `SparkMark` (landing) + the `SparkMark` in `lib/icons.tsx` to render it, so every in-app usage updates at once. The favicon (`icon.svg`) is the same SVG; the generated `apple-icon`/`opengraph-image` embed it as a data-URL `<img>` (as today). The name change is mechanical (guarded global replace).

## Approach

1. **Build the logo SVG** — recreate the two overlapping rounded-lozenge "S" (orange + blue, yellow intersection via a clip so the overlap is exact), transparent background. **Verify** by rendering it through `/e2e`'s Playwright (screenshot) and comparing to `Sparkpoint_icon.jpg`; iterate until faithful (SC-003).
2. **Wire the mark** — add `SparkLogo`; point `SparkMark` (landing local + `lib/icons.tsx`) at it so top bar / footer / splash / any icon usage shows the new logo. Set `icon.svg` to the logo; update `apple-icon`/`opengraph-image` to embed it.
3. **Rename** — guarded global `SparkPoint → Sparky` across `apps/web/src` (protect `SparkPoint Pivot`, `SparkPoint Admin`, and file-path refs); `SparkPoint AI → Sparky AI` falls out naturally. Update `layout.tsx` + `manifest.ts` names.
4. **Validate** — `tsc`/`eslint`/`build`; grep for residual visible "SparkPoint"; re-verify gate + subscribe; visual check of landing + a couple of app screens.

## Complexity Tracking

> No constitution violations — not required.
