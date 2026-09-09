# Tasks: Sparky Memory v2 — Platform-Activity Awareness

**Input**: Design documents from `/specs/028-memory-activity-fold/`
**Prerequisites**: plan.md, research.md, data-model.md, quickstart.md
**Branch**: `feature/028-memory-activity-fold` · all agent paths relative to `services/agent/`

**Tests**: included — the spec's SC-006/SC-007 demand automated assertions, and house convention ships tests with every store/derivation change.

## Phase 1: Setup

*(No setup tasks — no new dependencies, no scaffolding; the feature extends existing modules.)*

## Phase 2: Foundational (blocking prerequisites for every story)

- [ ] T001 Write migration `migrations/0031_user_memory_activity_cursor.sql` — `ALTER TABLE user_memory ADD COLUMN IF NOT EXISTS activity_cursor JSONB`, header per house style (non-custody preamble, SQL_ASCII warning, ordering note "order-insensitive, proven by test", rollback `DROP COLUMN`), single statement.
- [ ] T002 Extend `src/sparkpoint_agent/db/user_memory.py` — read `activity_cursor` in `get` (new `UserMemory.cursor: dict | None`), add `append_with_cursor(owner_eoa, lines, cursor)` (lines-append + cursor write in ONE transaction under the existing FOR UPDATE; `ensure_ascii=False`; `UndefinedColumnError` ⇒ `_warn_fold_column_missing()` once + raise a typed `FoldColumnMissing` for the sink to swallow), and confirm `clear()` does NOT touch the column.
- [ ] T003 Create `src/sparkpoint_agent/activity.py` skeleton — `ActivityEvent` dataclass (data-model §2), `format_line(event) -> str` for every kind/label combination (data-model §3, 120-char clamp via `memory._tidy`), `merge_and_dedup(events) -> list[ActivityEvent]` (tx-hash dedup → via-Sparky wins; chronological order), `plan_fold(events, cursor, first_fold) -> FoldPlan` (K=5 first-fold / ≤10 per fold / cursor-advance rules incl. execs `{ts, deferred}` per research R5/R8).
- [ ] T004 [P] Tests `tests/test_activity.py` — line formats (each kind, yourself/via-Sparky/reverted/approx/no-amount), dedup (flow+exec one line), first-fold K=5, fold cap 10, deferred-pending carry ≤10, cursor-advance-only-past-folded, clamp, non-USDC swap renders no invented symbol.
- [ ] T005 [P] Tests extend `tests/db/test_user_memory.py` — `append_with_cursor` atomicity (fake conn asserts one transaction), cursor round-trip raw UTF-8 (no `\u` escapes), `clear()` keeps cursor, `UndefinedColumnError` ⇒ warn-once + typed error, `get` exposes cursor.

**Checkpoint**: foundation ready — derivation is pure and fully tested before any wiring.

## Phase 3: User Story 1 — Sparky knows about my manual vault actions (P1) 🎯 MVP

**Goal**: an on-chain vault deposit/withdrawal made without chat appears in memory at the next chat turn, labeled "yourself".
**Independent test**: fake flow store returns a deposit → one fold → digest contains the deposit line; second fold adds nothing.

- [ ] T006 [US1] Add `list_flows_since(network_id, vault, owner, after: tuple[int,int] | None, limit)` to `src/sparkpoint_agent/db/vault_flows.py` (ascending `(block_number, log_index) > after`, LIMIT 25; reuses `_LIST_FLOWS` projection).
- [ ] T007 [US1] Create the fold orchestrator in `src/sparkpoint_agent/activity_fold.py` — `fold_activity(owner, account, chain, stores…) -> FoldResult` reading flows (per network with data) since cursor, deriving events via `activity.py`, calling `append_with_cursor`; bounded, fail-open contract documented (raises nothing — returns a `FoldResult` with `folded: int` and `skipped_sources: list[str]`).
- [ ] T008 [US1] Wire the fold into `src/sparkpoint_agent/api/chat.py` `_MemorySink` — new `fold_activity(...)` called once at turn start before the digest read (same fail-open block; `_warn_fold_failure` once per process, name `user_memory_fold_failed`); `_NoopMemorySink` overrides to no-op; dependency wiring passes the stores + chain context.
- [ ] T009 [P] [US1] Tests extend `tests/api/test_chat.py` — fold called once per turn; exploding flow store ⇒ turn streams normally, zero error blocks, warn once; noop sink in existing tests untouched (no test regressions).
- [ ] T010 [P] [US1] Tests `tests/test_activity_fold.py` — orchestrator with fake stores: deposit folds with correct line + cursor advance; empty delta ⇒ no append call; repeat fold ⇒ no duplicates (exactly-once, SC-004).

**Checkpoint**: US1 fully functional — MVP shippable.

## Phase 4: User Story 2 — via-Sparky labeling + executions (P2)

**Goal**: drawer-executed actions are labeled via-Sparky; reverted ones remembered gently; non-vault executions fold as their own lines; pending defer.
**Independent test**: fake exec store + matching flow → ONE via-Sparky line; reverted exec → gentle line; `submitted` exec defers then folds when terminal.

- [ ] T011 [US2] Add `list_by_account_since(smart_account_address, after_ts, ids, limit)` to `src/sparkpoint_agent/db/executions.py` (rows newer than `after_ts` UNION rows in `ids` — the deferred set; LIMIT 25).
- [ ] T012 [US2] Extend `activity_fold.py` — read executions keyed by `account.account` (research R1), map statuses (terminal-success `confirmed|indexed`; `reverted` → gentle line; skip-forever `built|policy_rejected|declined|dropped`; pending → deferred set, cap 10), tx-hash normalize (BYTEA → lower hex no-0x) and merge into dedup.
- [ ] T013 [P] [US2] Tests extend `tests/test_activity_fold.py` — via-Sparky labeling over a matching flow; exec-only kinds fold standalone; reverted line; pending deferred across two folds then folds exactly once; status skip set never folds.

**Checkpoint**: US1+US2 — attribution complete.

## Phase 5: User Story 3 — swaps + faucet claims (P3)

**Goal**: /swap swaps (any indexed network) and faucet claims fold as lines.
**Independent test**: fake swap rows on two networks + a faucet probe timestamp → correct lines; probe timeout ⇒ source skipped, cursor unchanged.

- [ ] T014 [US3] Add `list_for_swapper(network_id, from_address, after: tuple[int,int] | None, limit)` to `src/sparkpoint_agent/db/swap_fees.py` (research R2; ascending, LIMIT 25).
- [ ] T015 [US3] Create `src/sparkpoint_agent/chain/faucet_probe.py` — keyless `eth_call` `nextClaimAt(owner)` + `cooldown()` on the SrkFaucet (address from env/address-book; Base Sepolia RPC), **hard 3s total budget**, returns `last_claim_ts | None`; any failure ⇒ `None` (research R3).
- [ ] T016 [US3] Extend `activity_fold.py` — swap events (notional = fee×500, `approx=True`, USDC-vs-unknown token render per data-model §3 note) + faucet claim (fold when `last_claim_ts > cursor.faucet`); wire probe + swap store through `api/chat.py` dependencies.
- [ ] T017 [P] [US3] Tests `tests/chain/test_faucet_probe.py` — happy path math (nextClaimAt − cooldown), RPC error ⇒ None, timeout budget respected (fake transport sleeping > budget).
- [ ] T018 [P] [US3] Tests extend `tests/test_activity_fold.py` — swap line per network, approx labeling, non-USDC token no-symbol render; faucet line folds once (cursor advances), probe-None skips source without cursor change.

**Checkpoint**: all activity sources folding.

## Phase 6: User Story 4 — invariants: visible, clearable, honest (P1, invariant-bearing)

**Goal**: prove the inherited guarantees hold with activity lines present.
**Independent test**: the boundary/fail-open/clear tests below pass; Settings shows the new disclosure.

- [ ] T019 [US4] Extend `tests/coordinator/test_memory_boundary.py` — seed the digest with ACTIVITY-shaped lines (incl. a hostile one) and assert policy verdicts byte-identical with/without them; assert activity lines appear in sparky prose context and classifier context only.
- [ ] T020 [US4] Add the all-sources-down test to `tests/api/test_chat.py` — every store + probe raising ⇒ turn streams, digest = v1 content, exactly one warning (SC-006 second half).
- [ ] T021 [US4] Update the Settings memory disclosure string in `apps/web/src/app/(app)/settings/page.tsx` (MEMORY_DISCLOSURE gains "including your recent platform activity — deposits, withdrawals, swaps, and faucet claims") + adjust its existing web test if it pins the copy.

**Checkpoint**: constitutional guarantees proven.

## Phase 7: Polish & Cross-Cutting

- [ ] T022 [P] Living docs — `MIGRATIONS.md` row for 0031 (pending, ordering note, rollback); `CHANGELOG.md` Unreleased bullets (behavior + the two new store queries); client-facing entry in `services/agent/content_seed/whats-new.json` ("Sparky now notices what you do on the platform — even outside chat"; slug stable; honest about Clear semantics).
- [ ] T023 Full gates — `uv run python -m pytest`, `ruff check .`, `mypy src/sparkpoint_agent` (strict), web `pnpm test` + `typecheck:test` + `tsc --noEmit`; fix fallout.
- [ ] T024 Commit(s) + push branch + open PR to develop with deploy notes (apply 0031 before/with redeploy; no new env; coordinator live-validation matrix from quickstart §2).

## Dependencies & Execution Order

- Phase 2 blocks everything (T001–T005; T004/T005 parallel after T001–T003).
- US1 (T006–T010) after Phase 2 — **MVP**; T009/T010 parallel after T008.
- US2 (T011–T013) after US1's orchestrator exists (T007); T013 parallel after T012.
- US3 (T014–T018) after T007; independent of US2 (parallel opportunity: T014/T015 while US2 in review); T017/T018 parallel after T016.
- US4 (T019–T021) after the fold is wired (T008); T019/T020/T021 all parallel.
- Phase 7 last; T022 parallel with T023 prep.

## Implementation Strategy

Single implementer (this session). Build strictly in phase order — the MVP checkpoint after Phase 3 is a genuine fallback ship-point if anything goes sideways. Commit at each checkpoint. The pure-derivation-first ordering (T003/T004 before any wiring) keeps the risky logic testable without a database, mirroring how 027's `memory.py` was built.
