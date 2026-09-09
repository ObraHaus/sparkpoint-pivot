# Tasks: Sparky's daily self-authoring

**Feature**: `specs/034-self-authoring` · **Branch**: `feature/034-self-authoring`

Ordered so that every phase leaves the tree green. The pure logic lands before anything that touches
the network, because the guarantees this feature makes — an empty allowlist permits nothing, a held
finding blocks a claim, a figure without a chain is not publishable — are properties of pure
functions, and that is the only way they stay true when the fetchers change.

## Phase 1: Setup

- [ ] T001 Create migration `services/agent/migrations/0035_self_authoring.sql` per data-model.md (5 tables + audit + 3 indexes), with the reasoning in the header comment
- [ ] T002 Create the package skeleton `services/agent/src/sparkpoint_agent/selfauthor/__init__.py`

## Phase 2: Foundational — the pure core (blocks everything else)

- [ ] T003 [P] `selfauthor/evidence.py` — `Evidence` shape, `PLAUSIBLE_APY_BPS` bounds, `is_plausible()`, `describe_chain()`; a figure without a chain id is not publishable
- [ ] T004 [P] `selfauthor/allowlist.py` — `normalise_domain()`, `is_permitted(url, domains)`; empty list permits nothing, https only, exact-or-dot-suffix host match, no cross-host redirect
- [ ] T005 [P] `selfauthor/claims.py` — `Claim`/`Finding` shapes, `withhold_contradicted(claims, held_topics)`; returns kept + withheld so the omission can be recorded
- [ ] T006 [P] `selfauthor/documents.py` — the six `DOCUMENTS` definitions (slug, title, which evidence each needs) and `render_document()`; six is a ceiling enforced in code
- [ ] T007 [P] `selfauthor/settings.py` — `SelfAuthorSettings` dataclass + `DEFAULTS` (disabled, manual, 336h, empty prose list) + `merge_patch()`
- [ ] T008 [P] Tests for T003–T007 in `services/agent/tests/selfauthor/` — one file per module, each pinning the property, not the implementation

## Phase 3: US3 — an admin controls what Sparky may read (P1)

- [ ] T009 `services/agent/src/sparkpoint_agent/db/self_authoring.py` — the store: settings get/put (+audit), run open/close, evidence insert, document upsert/list/delete, finding insert/list/resolve. All jsonb via `ensure_ascii=False`
- [ ] T010 [P] `services/agent/tests/db/test_self_authoring_store.py` — store behaviour against a fake connection, including the settings audit snapshot
- [ ] T011 `selfauthor/sources.py` — the fetchers: chain reads (84532), DeFiLlama, Morpho, own corpus, answer gaps (classification only), allowlisted prose. Every fetch records an evidence row, including refusals
- [ ] T012 [P] `services/agent/tests/selfauthor/test_sources.py` — a refused fetch is recorded not dropped; prose is stored with attribution; an implausible figure is rejected; answer-gap evidence carries no user text

## Phase 4: US2 — the corpus stays the size it is (P1)

- [ ] T013 `selfauthor/selfcheck.py` — `GOLDEN_QUESTIONS` (withdraw, fees, vault APY, custody, product) with expected sources; `check(corpus)` returns pass/fail + which regressed
- [ ] T014 [P] `services/agent/tests/selfauthor/test_selfcheck.py` — a document that displaces an expected source fails the check; a harmless document passes
- [ ] T015 `selfauthor/run.py` — the orchestrator: lock → settings → fetch → write → self-check → publish/rollback → record. Never raises
- [ ] T016 [P] `services/agent/tests/selfauthor/test_run.py` — no evidence ⇒ no document; no change ⇒ no new claims; self-check failure ⇒ nothing published; second concurrent run declines; a run never reads self-authored material as input

## Phase 5: US1 — the assistant answers from a self-authored document (P1)

- [ ] T017 `selfauthor/writer.py` — the LLM pass: evidence in, document markdown + claims out. Prose evidence is delimited and passed in the USER turn, never the system prompt
- [ ] T018 [P] `services/agent/tests/selfauthor/test_writer.py` — prose evidence never reaches a system message; a run with a dead model writes nothing; every rendered figure names its chain
- [ ] T019 Wire publishing to `ingest_note(source=slug, source_kind='self_authored')` and pruning on unpublish
- [ ] T020 [P] `services/agent/tests/selfauthor/test_publish_is_idempotent.py` — re-publishing the same text writes no new chunks

## Phase 6: US4 + US5 — publishing control and held findings (P2)

- [ ] T021 `services/agent/src/sparkpoint_agent/api/admin_self_authoring.py` — the five endpoints from contracts/admin-api.md
- [ ] T022 Register the router in `api/main.py` and add the daily loop (`pg_try_advisory_lock`, 30-min due-check, background task, cancelled on shutdown) mirroring 033's `_index_changelog`
- [ ] T023 [P] `services/agent/tests/api/test_admin_self_authoring.py` — settings validation rejects a URL in the domain list by name; run returns skipped_locked; document publish/unpublish; finding release
- [ ] T024 [P] `services/agent/tests/selfauthor/test_constitution_boundary.py` — policy verdicts byte-identical with and without self-authored chunks; nothing on the withdraw path; persona untouched

## Phase 7: The console

- [ ] T025 `apps/web/src/lib/selfauthor/settings.ts` — pure normalisation/validation of both lists, shared by the form
- [ ] T026 [P] `apps/web/src/lib/selfauthor/settings.test.ts` — leaf-module tests (no `@/` value imports)
- [ ] T027 `apps/web/src/components/admin/SelfAuthoredPanel.tsx` — replaces the 032 mockup: settings form, six documents, held findings with count + oldest age, run history with outcomes
- [ ] T028 Web BFF routes proxying the five admin endpoints, owner derived server-side
- [ ] T029 Point `/admin/knowledge` at the real panel and delete `SelfAuthoredPreview.tsx`

## Phase 8: Ship

- [ ] T030 Living docs: `MIGRATIONS.md`, `CHANGELOG.md`, `content_seed/whats-new.json` (the gate needs both surfaces)
- [ ] T031 Full gates: pytest + ruff + mypy + web tests + tsc + typecheck:test + eslint + next build
- [ ] T032 Apply migration 0035 to develop, deploy agent + web, verify healthy
- [ ] T033 Live: enable via the console, trigger the first run, verify the quickstart's SC table
- [ ] T034 Live e2e: ask the assistant a market question and confirm the "not yet reviewed" citation

## Dependencies

- Phase 2 blocks everything (the pure core is what the rest is tested against).
- T009 blocks T011, T015, T021.
- T013 blocks T015 (the run cannot publish without the check).
- T017 blocks T019.
- Phase 7 depends on T021.
- T032 gates T033/T034.

## Parallel opportunities

T003–T007 are five independent modules. T008/T010/T012/T014/T016/T018/T020/T023/T024/T026 are test
files with no shared state. Everything marked [P] can run concurrently within its phase.

## MVP

Phases 1–5 (T001–T020) deliver the whole point: a run that fetches, writes six documents, proves it
did no harm, and publishes something the assistant can answer from. Phases 6–7 make it operable,
which decisions 4, 7 and 9 require before it can be considered done.
