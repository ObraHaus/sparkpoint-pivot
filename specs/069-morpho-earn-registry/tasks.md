# Tasks — 069 Morpho earn registry

## Phase A — backend (done in this branch)

- [x] T001 `earn/` package + `earn.json` (chains, filters, allow/deny, curated defaults, receipts,
  rails, Intents Connect config) and `EARN_CONFIG_PATH` / `EARN_ENABLED` / snapshot env.
- [x] T002 `earn/registry.py`: V1+V2 fetch (separate queries, V2 500/page complexity cap),
  normalization, filters, TTL snapshot, writable + shipped fallback, background `refresh_loop`.
- [x] T003 `earn/rails.py`: direct / oneclick_earn / intents_connect resolution, receipt liveness
  cache, honest notes, approve+deposit step plan as data.
- [x] T004 `earn/service.py`: list/get/resolve + preview (direct hint, dry 1Click receipt quote,
  Intents Connect plan, honest unavailable).
- [x] T005 `api/earn.py`: GET `/earn/vaults`, GET `/earn/vaults/{chain}/{address}`, POST
  `/earn/preview` (dry only), mounted in `api/main.py` with the background refresh task.
- [x] T006 `coordinator/chat_blocks.py`: `EarnVaultsBlock`, `EarnQuoteBlock`; persist both types.
- [x] T007 `earn/parse.py` + DAG hook for list/deposit before the planner, without stealing existing
  vault/deposit or comparative flows.
- [x] T008 `scripts/earn_registry_snapshot.py` (writes `earn/snapshot.json`, prints the reachability
  table) and `scripts/earn_dry_smoke.py` (real dry quotes).
- [x] T009 Tests: registry/filters/fallback, rails gating, service previews, router validation,
  parser positives/negatives, DAG hook.
- [x] T010 Golden eval cases for the chat list/preview route.
- [x] T011 Spec-kit artifacts (`spec.md`, `plan.md`, `research.md`, `contracts/earn-api.md`,
  `quickstart.md`), CLAUDE.md SPECKIT pointer, CHANGELOG entry.

## Phase B — frontend (pending)

- [ ] T012 Add `earn_vaults` / `earn_quote` to the shared zod `ChatBlock` union + fixtures.
- [ ] T013 Web `earn_vaults` list card (name, chain, asset, TVL, net APY, rails; curated first).
- [ ] T014 Web `earn_quote` preview card with the receipt vs native-share label and fee note.
- [ ] T015 Live deposit/withdraw flow (reuse the 068 confirm pattern; no live quote in the agent
  until Phase B defines the confirm path).
- [ ] T016 Client decisions from `research.md` open questions (receipts, Aurora key, chains, filters,
  fee copy).
