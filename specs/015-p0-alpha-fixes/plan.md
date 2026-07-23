# Implementation Plan: P0 Alpha Fixes (015)

**Branch**: `feat/015-p0-alpha-fixes` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-07-23

## Summary

Six frontend-only fixes that close known Phase-2 acceptance gaps found in the Jul-23 alpha audit. No agent, contract, DB, or migration change. Each fix follows the repo's established "pure module + thin wiring + node:test" pattern: extract the logic into a dependency-free `lib/` module (unit-tested under `node --experimental-strip-types`), then wire it into the existing hooks/pages. Live reads reuse the existing `useReadContracts`/BFF transport; the deposit gate reuses the existing `useVaultConfirm` → `ConfirmFlow` shared surface so both mount points change from one edit.

## Technical Context

- **Language/stack**: TypeScript, Next.js App Router (`apps/web`), React 19, wagmi/viem, @tanstack/react-query, `@sparkpoint/shared` (SoT policy/addresses/ABIs/schemas).
- **Tests**: `node:test` pure-function units (`node --experimental-strip-types --test "src/**/*.test.ts"`); agent `pytest`/`ruff`/`mypy` run unchanged to confirm the contracts the web depends on.
- **Transport**: same-origin BFF `/api/agent/*` (GET/POST only, session-derived `x-owner`); direct-RPC via wagmi for on-chain reads.
- **Scope guard**: `apps/web` only. `GET /mandate`, `GET /recommendations` (+`citations`), and `CapRegistry` reads all already exist.

## Constitution Check

| Principle | Impact | Verdict |
|---|---|---|
| I — Non-custodial by construction (N1–N5) | No fix touches custody, signing authority, or the withdraw/exit path. Mandates are advisory config; caps are display-only; the confirm gate keeps fail-closing every signature and honors N2 (withdraw never beta/pause/cap-gated). | ✅ PASS |
| II — AI proposes, policy + user dispose | `signable ⟺ policy.status === "approved"` is preserved on rec cards and the confirm gate; nothing new becomes signable. | ✅ PASS |
| III — Provable, not promised | US4 renders the canonical fee disclosure verbatim + an honest live-% accrued-fee line (no fabricated $); US5 shows live on-chain caps; US2 shows the real persisted mandate; US3 shows real citations. This principle is *strengthened*. | ✅ PASS |
| IV — Security & bounded blast radius | Guardrail checklist + pre-trade preview + caps remain; US6 makes the routed confirm run the *same* gate (no weaker path). Deposit stays beta-gated. | ✅ PASS |
| V — Conservative, transparent launch | Fee disclosure (0% mgmt / 0% principal / profit-only HWM) is now shown at the point of signing. | ✅ PASS |
| VI — Spec-driven | This spec/plan/tasks set precedes implementation; tasks trace to FRs. | ✅ PASS |
| VII — Simplicity & YAGNI | Minimal diffs; reuse of existing hooks/constants/transport; no new endpoints, schema, or contracts. | ✅ PASS |

**Gate result: PASS — no complexity deviations to track.**

## Project Structure

### Documentation (this feature)
- `specs/015-p0-alpha-fixes/spec.md` · `plan.md` · `tasks.md` · `checklists/requirements.md`

### Source Code (repository root) — all under `apps/web`
```
apps/web/src/
  lib/agent/
    mandateDraft.ts        (NEW, US1)   + mandateDraft.test.ts
    mandate.ts             (NEW, US2)   + mandate.test.ts
    recView.ts             (NEW, US3)   + recView.test.ts
    useAgent.ts            (EDIT, US1/US2/US3 — add useMandate; import recView/mandateDraft)
  lib/policy/
    feeCopy.ts             (NEW, US4)   + feeCopy.test.ts
    liveCaps.ts            (NEW, US5)   + liveCaps.test.ts
  lib/chain/
    vaultConfirmModel.ts   (EDIT, US4 — managementFeeRow + withdrawFeeNote) + .test.ts (extend)
    useVaultConfirm.tsx    (EDIT, US4/US5 — disclosure, receiptFeeLine, live cap)
    useVault.ts            (EDIT, US5 — CapRegistry reads)
    confirmParams.ts       (NEW, US6)   + confirmParams.test.ts
  components/
    NonCustodyBadge.tsx    (EDIT, US4/US5 — re-export feeCopy; pass liveCaps)
    ui/ConfirmFlow.tsx     (EDIT, US4 — disclosure + receiptFeeLine fields)
    CapsMeter.tsx          (EDIT, US5 — liveCaps prop)
  app/(app)/
    onboarding/page.tsx    (EDIT, US1)
    settings/page.tsx      (EDIT, US2 — MandateTab)
    chat/page.tsx          (EDIT, US2 — rail card)
    portfolio/page.tsx     (EDIT, US2 — drift row)
    strategies/page.tsx    (EDIT, US3 — chip + expander + usingMock)
    confirm/[intent]/page.tsx (EDIT, US6) + RouteConfirm.tsx (NEW, US6)
```

## Approach notes

- **Pure-module discipline**: every new `lib/` module stays free of React/CSS/runtime `@/`|`@sparkpoint` imports (type-only imports are erased by the strip-types runner). This keeps `*.test.ts` runnable and matches `lib/portfolio/derive.ts`.
- **One-edit-two-surfaces**: US4's disclosure/receipt flow through the shared `useVaultConfirm().onchain`, so route + chat-inline both update; US6 reuses that same hook so the routed gate is byte-identical to the inline gate.
- **Fail-soft everywhere**: caps fall back to the mirror; mandate/rec reads degrade to honest states; confirm params fail safe to "no amount". No fix can blank a screen or crash a card.
- **Instant-reflect (US1↔US2)**: after a successful `confirmMandate`, invalidate the `["agent","mandate"]` query so Settings/rail reflect the new plan immediately (makes the choose→save→see loop demoable in one session).

## Complexity Tracking

No constitution deviations. No new dependencies. No schema/contract/migration changes.
