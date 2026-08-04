# Tasks: Chat history you can actually navigate

## Phase 1: The pure core (blocks everything)

- [ ] T001 `apps/web/src/lib/chat/historyGroups.ts` — buckets, order, labels, counts, local-midnight boundary
- [ ] T002 [P] `historyGroups.test.ts` — the date cases that are trivial as data and awful in a browser

## Phase 2: The API (US2 + US3)

- [ ] T003 `services/agent/src/sparkpoint_agent/db/conversations.py` — `offset`, `q` (ILIKE inside the ownership scope), and a `total` count
- [ ] T004 `services/agent/src/sparkpoint_agent/api/conversations.py` — `?offset=` and `?q=`, `total` in the response
- [ ] T005 [P] `services/agent/tests/api/test_conversations_paging.py` — paging, search, and that the ownership predicate survives both

## Phase 3: The sidebar (US1)

- [ ] T006 Keep the timestamps the API already sends instead of narrowing to `{id, title}`
- [ ] T007 Render groups with counts and sticky headings; each row gains its time of last activity
- [ ] T008 [P] Web: the row is still keyboard-openable (FR-020) — 039 made it so, do not regress it

## Phase 4: Paging + search (US2, US3)

- [ ] T009 "Show N older conversations" — appends, never replaces; hidden when everything is loaded
- [ ] T010 Search box, debounced, server-backed; empty-result and clear-restores behaviour
- [ ] T011 [P] Failure handling: a failed page or search says so and leaves the list intact

## Phase 5: Ship

- [ ] T012 Living docs: `CHANGELOG.md` + `content_seed/whats-new.json` (the gate needs both)
- [ ] T013 All gates: pytest, ruff, mypy, web tests, tsc, typecheck:test, eslint, next build
- [ ] T014 PR (not a direct push — the changelog gate only runs on PRs), CI, merge, deploy
- [ ] T015 Live browser verification of every success criterion

## Dependencies

T001 blocks T007. T003 blocks T004 blocks T009/T010. T012–T015 last.

## MVP

T001–T008: the grouping, which is the headline ask. T009–T011 are what stop it being confidently
wrong, and were made non-optional by the client's decision on the cap.
