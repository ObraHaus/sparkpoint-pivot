# Tasks — 050 Vault page redesign

Legend: `[x]` done · `[ ]` not started

## Phase 1 — Agent (live-only public board + history)

- [x] **T501** `public_board` live-only: approved+wrapped+wrapperAddress filter; hero precedence
      (pinned-live → rec pick live → top-score live); alternates ∩ live; honest "nothing wrapped yet" note.
- [x] **T502** Migration `0041_curated_vault_apy_history.sql` + `PgCurationStore.upsert_scan_vaults`
      appends history + `apy_history()` read (fail-open on an unapplied DB).
- [x] **T503** `list_curated` passes history through `public_board`/`_hydrate`; chat inherits the rule.
- [x] **T504** Tests: filter/hero/note cases, history store + migration conventions, fixtures wrapped.

## Phase 2 — Web (Option C board)

- [x] **T601** `model.ts`: `ApyPoint` + `apyHistory` on `CurationVault`.
- [x] **T602** `lib/curation/boardV2.ts` pure helpers + `boardV2.test.ts`.
- [x] **T603** `CuratedBoard.tsx` rewrite: feature card, card grid, infinite scroll (batches + spinner +
      terminal message), empty/loading/error states, deposit-rail CTAs unchanged.
- [x] **T604** `AdminInFlightPanel`: admin-session-only, admin endpoints, counts, deep link; hidden for
      public sessions and on any failure.
- [x] **T605** `vault.css` styles on existing tokens (light/dark).

## Phase 3 — Disclosure & verification

- [x] **T701** Both changelogs (repo `CHANGELOG.md` + `services/agent/content_seed/whats-new.json`).
- [x] **T702** Full checks: agent ruff/mypy/pytest; web tests/tsc/eslint.
- [ ] **T703** Operator: apply migration 0041 to the beta DB; deploy; verify the public payload contains
      only wrapped vaults and the admin panel shows for the operator session.
