---
description: "Task list for the Mailjet newsletter subscribe integration"
---

# Tasks: Mailjet newsletter subscribe

**Input**: Design documents from `/specs/004-mailjet-subscribe/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/subscribe-contract.md ✓, quickstart.md ✓

**Tests**: No unit-test suite requested. Verification = the request matrix in `quickstart.md` (against `next start`) + `tsc`/`eslint`/`build`, and Playwright smoke on develop per playbook §3.7. These appear as explicit verification tasks.

## Format: `[ID] [P?] [Story] Description` — all paths under `apps/web/`.

---

## Phase 1: Setup

- [ ] T001 [P] Add `MAILJET_WIDGET_SUBSCRIBE_URL` to `apps/web/.env.example` (with the public default + a note that it's not a secret). Per `contracts/subscribe-contract.md`.

## Phase 2: Foundational (BLOCKS all stories)

- [ ] T002 [US1] Create `apps/web/src/app/api/subscribe/route.ts`: `POST` handler — parse `{email}`, server-side validate (FR-004 / I-2), POST form-encoded `email`+`consent` to `MAILJET_WIDGET_SUBSCRIBE_URL`, map upstream 2xx→`{ok:true}` (already-subscribed → success-like, FR-009), else `{ok:false,error:"provider"}` (502); `400 {ok:false,error:"invalid_email"}` on bad input; `405` for non-POST. No secret read/returned (I-1/I-3). Confirm the exact `consent` value + success body with one controlled test submit (research.md open detail). Implements FR-001/002/007/009.
- [ ] T003 [US3] Edit `apps/web/middleware.ts`: add `"/api/subscribe"` to `ALLOW_EXACT` so the POST isn't 307'd while the gate is on. Implements FR-006 / I-5.

**Checkpoint**: subscribe endpoint exists + reachable gated and ungated.

## Phase 3: User Story 1 — Subscribe succeeds (P1) 🎯 MVP

- [ ] T004 [US1] Edit `apps/web/src/components/screens/landing/NewEraLanding.tsx`: make the email input controlled; on submit `POST {email}` to `/api/subscribe`; on `{ok:true}` show the success / "check your inbox to confirm" copy (reuse `.fsub-done`). Replaces the prior local-only confirm. Implements FR-001/011, FR-008 (visual unchanged).
- [ ] T005 [US1] Verify (quickstart "Route behavior"): a valid email → `200 {ok:true}` and a **pending** contact + confirmation email in Mailjet (use a test inbox). Confirms SC-001, I-4.

**Checkpoint**: a real email subscribes end-to-end.

## Phase 4: User Story 2 — Clear feedback on every outcome (P1)

- [ ] T006 [US2] In `NewEraLanding.tsx`, complete the state machine: `idle | submitting | success | error`; client-validate email pre-submit (inline message, no request — FR-004); disable control while submitting (no double-submit); on failure show a friendly retryable error and **preserve the entered email** (FR-005). Reuse existing classes; add a small `.fsub-error` style in `new-era.css` if needed.
- [ ] T007 [US2] Verify (quickstart): invalid email → 400 + inline message; simulated provider failure → friendly error + input preserved + retry; in-flight control disabled. Confirms SC-002, I-4.

## Phase 5: User Story 3 — Works gated (P2)

- [ ] T008 [US3] Verify (quickstart "Gate ON"): with `SITE_LOCKED=true`, `/` 200, `/admin` 307, **`/api/subscribe` POST → 200 (not 307)**. Confirms SC-003, I-5.

## Phase 6: Polish & cross-cutting

- [ ] T009 [P] [US2] Add consent microcopy near the form ("We'll only email launch updates. Unsubscribe anytime.") in `NewEraLanding.tsx`. Implements FR-010.
- [ ] T010 [P] Add a `CHANGELOG.md` `[Unreleased]` entry (Mailjet subscribe integration).
- [ ] T011 Final gates: `npx tsc --noEmit` + `npx eslint .` + `npx next build` green; `grep -ri 'MJ_APIKEY\|MJ_SECRET\|api.*secret' apps/web/src` empty (SC-004 / I-1).
- [ ] T012 Run `/speckit-agent-context-update` (refresh the `CLAUDE.md` SPECKIT pointer → `specs/004-mailjet-subscribe/plan.md`).

---

## Dependencies & Execution Order

- **Setup (T001)** → first.
- **Foundational (T002, T003)** → block the stories. T002 is the core route; T003 is independent (different file) so [P] with T002.
- **US1 (T004–T005)** → after Foundational. T004 (form) depends on T002 (route).
- **US2 (T006–T007)** → builds on T004 (same file — sequential, not [P]).
- **US3 (T008)** → after T002/T003; verification only.
- **Polish (T009–T012)** → last; T009 same file as T004/T006 (sequential), T010/T011/T012 independent.

## Traceability

| Task | FR / SC |
|---|---|
| T002 | FR-001/002/007/009 · I-1/I-2/I-3 |
| T003 | FR-006 · I-5 |
| T004 | FR-001/011 · FR-008 |
| T005 | SC-001 · I-4 |
| T006 | FR-003/004/005 |
| T007 | SC-002 · I-4 |
| T008 | SC-003 · I-5 |
| T009 | FR-010 |
| T011 | SC-004 · I-1 |

## Notes

- Only existing-file edits: `middleware.ts`, `NewEraLanding.tsx`, `new-era.css` (minor), `.env.example`, `CHANGELOG.md`. New file: `api/subscribe/route.ts`. No new deps.
- Commit after Foundational and after each story; **PR targets `develop`**; stop at develop-green (prod is a separate batched deploy).
