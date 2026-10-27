# Tasks: 060 — Grounding

Ordered, dependency-first. `[P]` = independent of the preceding task.

## Research & specs

- [x] T001 Explore current price usage, curated `as_of`, guidance/recommender APY paths, and
      knowledge seed ingestion. → `research.md`
- [x] T002 Write `spec.md`, `plan.md`, `tasks.md`.

## Price service

- [x] T003 `[P]` Create `data/prices.py`: quote/snapshot models, asset map, env-configurable
      primary + fallback URLs, TTL cache, stale-while-revalidate, hard timeout, breaker, stable
      depeg sanity, USDG only while the peg sanity holds, injectable transport/clock.
- [x] T004 `[P]` Add `get_price_service()` singleton (no import-time network/client).

## Price route

- [x] T005 `[P]` Create `coordinator/prices.py`: narrow price regexes, symbol aliases, SRK
      policy detection/answer, deterministic answer with source + `as of HH:MM UTC` + not-advice,
      honest unavailable text.
- [x] T006 Hook the route into `CoordinatorDag.run_chat` before planner/bridge/curated:
      bounded lookup, broad exception handling, `TextBlock` only. Add optional `prices` field.
- [x] T007 Wire `get_price_service()` in `api/chat.py`'s DAG factory.

## As-of / staleness

- [x] T008 `[P]` Create `coordinator/staleness.py`: parse ISO as-of, date stamp, 48h caveat.
- [x] T009 Apply to `coordinator/curated.py` (answer/list/rate), including per-row as-of in lists.
- [x] T010 Apply to `coordinator/guidance.py` (options, estimate, comparison, no-duration estimate).
- [x] T011 Apply to the live APY answer in `coordinator/dag.py` (per-request UTC stamp).
- [x] T012 Optional recommender as-of: `ProposalContext.as_of`, template rationale suffix, rank
      prompt field.
- [x] T013 Web: `/vault` feature-card as-of label from `lastScanAt ?? asOf ?? updatedAt`.

## Knowledge seed

- [x] T014 Add `knowledge_seed/beta-questions.md` (English) covering Morpho vs Aave, APY, net APY,
      slippage + 0.20% swap fee, NEAR Intents (Nov build), non-custody/signing, daily quota,
      mandates. Cross-link existing docs.
- [x] T015 Extend `aave-v3-supply.md` / `usdc-yield-strategies.md` with accurate Morpho-curated
      vault context and cross-links.

## Tests

- [x] T016 `tests/data/test_prices.py`: cache, SWR, timeout, fallback, breaker, depeg/USDG.
- [x] T017 `tests/coordinator/test_price_route.py`: deterministic answer, SRK policy, no hijack of
      portfolio/APY/commands, unavailable honesty.
- [x] T018 `tests/coordinator/test_staleness.py`: boundary, caveat text, curated + guidance output.
- [x] T019 Extend `tests/knowledge/test_knowledge_seed_content.py` for the new FAQ.
- [x] T020 Run seed/ingestion tests.

## Delivery

- [x] T021 Update `CHANGELOG.md` `[Unreleased]`.
- [x] T022 Add a client-friendly `content_seed/whats-new.json` entry, backdated (not future).
- [x] T023 Run `ruff`, strict `mypy`, full `pytest` (agent); web lint/typecheck/test if touched.
- [x] T024 Commit with trailer, push `feat/060-grounding`.
- [x] T025 Worktree `~/project/sparkpoint-pivot-060-dev` off `origin/develop`, cherry-pick,
      resolve, rerun checks, push `feat/060-grounding-develop`.
