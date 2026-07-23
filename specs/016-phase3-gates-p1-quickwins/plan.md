# Implementation Plan: 016 — Phase-3 register + P1 quick wins

**Branch**: `feat/016-phase3-gates-p1-quickwins` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-07-23

## Summary
Four small, independent clusters: (A) the Phase-3 deferral register + cross-links + an anti-rot doc test; (B) honest-badge sweep — one missing badge (bell drawer) + de-fake admin sample-data provenance; (C) Trust Center whitelisted-protocols card (pure lib from the real allowlist); (D) settings preference persistence (localStorage via `useLocalState`, density/reduce-motion made real). Frontend + docs only.

## Technical Context
- TypeScript, Next.js App Router (`apps/web`); wagmi/viem; `@sparkpoint/shared` SoT.
- Tests: `node:test` pure units under `node --experimental-strip-types`; new logic → dependency-free `lib/` modules with type-only `@sparkpoint`/`@/` imports.
- No agent/contract/DB/migration change; `GET /trust` is public RPC-only; settings prefs never hit the BFF.

## Constitution Check
| Principle | Impact | Verdict |
|---|---|---|
| I Non-custody (N1–N5) | Trust card read-only; prefs cosmetic; badges informational — no custody/withdraw/exit path touched. | ✅ |
| II Policy disposes | Nothing new becomes signable; the Trust card *displays* the on-chain allowlist. | ✅ |
| III Provable, not promised | Register makes deferrals auditable + honestly disclosed; Trust card shows the real allowlist join (no fabricated venue, no Morpho-mock mislabel); bell-drawer badge + admin de-fake remove silent mocks. **Strengthened.** | ✅ |
| IV/V Security/Conservative | Whitelist card reinforces the closed-set story; no new attack surface. | ✅ |
| VI Spec-driven | This spec/plan/tasks precede code. | ✅ |
| VII Simplicity/YAGNI | Reuse `useLocalState`/`StatusTag`/existing card patterns; localStorage (not a backend); no new deps. | ✅ |

**Gate: PASS.**

## Project Structure (all under apps/web unless docs)
```
docs/phase-3-deferred.md                        (NEW, US1)
docs/ops/known-limitations.md                   (EDIT xlink, US1)
docs/orchestration/GATES.md                     (EDIT xlink, US1)
docs/orchestration/wave-state.json              (EDIT P3 entry, US1)
docs/architecture-as-built.md                   (EDIT xlink, US1)
apps/web/test/phase3-deferred.doc.test.ts       (NEW anti-rot test, US1)
apps/web/src/components/overlays/OverlayProvider.tsx  (EDIT bell badge, US2)
apps/web/src/app/admin/{page,tvl}.tsx           (EDIT provenance de-fake, US2)
apps/web/src/lib/policy/whitelistedProtocols.ts (NEW + .test.ts, US3)
apps/web/src/app/(app)/trust/page.tsx           (EDIT card, US3)
apps/web/src/lib/settings/prefs.ts              (NEW + .test.ts, US4)
apps/web/src/lib/settings/usePrefs.ts           (NEW, US4)
apps/web/src/components/PrefsEffect.tsx          (NEW, US4)
apps/web/src/components/providers.tsx           (EDIT mount PrefsEffect, US4)
apps/web/src/app/(app)/settings/page.tsx        (EDIT wire prefs, US4)
apps/web/src/components/screens/support.css + app/globals.css  (EDIT density/motion CSS, US4)
```

## Approach notes
- Pure-module discipline: `whitelistedProtocols.ts` + `prefs.ts` are dependency-free (type-only `@sparkpoint` imports), unit-tested; pages own the runtime `getPolicyConstants`/`useLocalState` reads.
- Fail-closed everywhere: Trust card drops unresolved targets + hides when empty; prefs coerce partial blobs; badges never gate.
- The anti-rot doc test asserts the register's cited paths exist + `wave-state.json` P3 has 8 items — so a future rename forces a doc update.

## Complexity Tracking
No deviations, no new deps, no schema/contract change.
