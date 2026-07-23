# Tasks: 016 — Phase-3 register + P1 quick wins

**Scope**: `apps/web` + docs. No agent/contract/DB/migration change.

## Definition of Done (feature 006)
- [ ] `CHANGELOG.md` — dev bullets (Added/Changed/Docs) under `## [Unreleased]`.
- [ ] `services/agent/content_seed/whats-new.json` — client entries for the user-visible changes (Trust card, settings persistence, honest bell badge).
- [ ] `changelog-required` CI green; `pnpm --filter web test` + `build` + `tsc` + `eslint` green.

## Phase 1: Setup
- [ ] T001 Branch `feat/016-phase3-gates-p1-quickwins` off latest develop; `pnpm install --frozen-lockfile` clean.

## Phase 2: US1 — Phase-3 deferral register (P1)
- [ ] T010 NEW `docs/phase-3-deferred.md` — 8 rows (why / current-state+disclosure / gate / tracking).
- [ ] T011 EDIT cross-links: `docs/ops/known-limitations.md`, `docs/orchestration/GATES.md`, `docs/architecture-as-built.md`.
- [ ] T012 EDIT `docs/orchestration/wave-state.json` — enrich the P3 entry (deferred_register + deferred_items[8]); keep valid JSON.
- [ ] T013 NEW `apps/web/test/phase3-deferred.doc.test.ts` — anti-rot: register exists + 8 anchors; cited paths exist; wave-state P3 has 8 items + valid JSON. (Confirm the web test glob covers `test/**`; else place under `src/lib/`.)

## Phase 3: US2 — honest-badge sweep (P1)
- [ ] T020 EDIT `apps/web/src/components/overlays/OverlayProvider.tsx` — import StatusTag; add `mock` badge atop `NotificationsBody`.
- [ ] T021 EDIT `apps/web/src/app/admin/page.tsx` + `admin/tvl/page.tsx` — relabel chart provenance footers to a static "sample data" (drop the false "RPC + subgraph · 42s ago").

## Phase 4: US3 — Trust whitelisted-protocols card (P2)
- [ ] T030 NEW `apps/web/src/lib/policy/whitelistedProtocols.ts` — pure group-by-target from allowlist × resolve; protocolLabel/actionLabel.
- [ ] T031 [P] NEW `apps/web/src/lib/policy/whitelistedProtocols.test.ts` — grouping, fail-closed drop, empty, exclude-vault, labels.
- [ ] T032 EDIT `apps/web/src/app/(app)/trust/page.tsx` — derive WHITELISTED (exclude vault) from getPolicyConstants+resolveTargetRef; render the card (hidden when empty).

## Phase 5: US4 — settings persistence (P2)
- [ ] T040 NEW `apps/web/src/lib/settings/prefs.ts` — NotifPrefs/DisplayPrefs, keys, defaults, coerce*, displayAttrs.
- [ ] T041 [P] NEW `apps/web/src/lib/settings/prefs.test.ts` — coercion (partial/corrupt/domain), defaults, displayAttrs.
- [ ] T042 NEW `apps/web/src/lib/settings/usePrefs.ts` — useNotifPrefs/useDisplayPrefs on useLocalState.
- [ ] T043 NEW `apps/web/src/components/PrefsEffect.tsx` + mount in `providers.tsx` — stamp data-density/data-reduced-motion on <html>.
- [ ] T044 EDIT `apps/web/src/app/(app)/settings/page.tsx` — controlled Switch; keyed NOTIF_ROWS; wire density/reduce-motion; honest StatusTag.
- [ ] T045 EDIT `apps/web/src/components/screens/support.css` + `app/globals.css` — compact density + reduce-motion CSS.

## Phase 6: Validation & housekeeping
- [ ] T050 `pnpm --filter web test` (new units + doc test) + `build` + `tsc` + `eslint` green.
- [ ] T051 `CHANGELOG.md` bullets + `whats-new.json` client entries.
- [ ] T052 Commit per cluster; PR → develop; resolve Defender; merge; redeploy via watcher; smoke `/trust` + `/settings` + bell drawer live.

## Dependencies
- Clusters A–D are independent (different files). Do per-phase, run its unit test, commit. T050–T052 last.
