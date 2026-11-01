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

## Phase B — frontend (done in this branch)

- [x] T012 Add `earn_vaults` / `earn_quote` to the shared zod `ChatBlock` union + five fixtures
  (`earn-vaults-list`, `earn-vaults-unavailable`, `earn-quote-preview-oneclick`,
  `earn-quote-unavailable`, `earn-quote-direct`), with a shared TS test and an agent-side parity
  test that regenerates the same JSON from the real dataclasses.
- [x] T013 Web `earn_vaults` list card: name, chain badge, asset, compact TVL, net APY (Morpho),
  rail chips (Direct · 1Click Earn live/no liquidity · Intents Connect needs key), snapshot age,
  Preview follow-up and an external “View on Morpho” link.
- [x] T014 Web `earn_quote` preview card with the receipt vs native-share label, fee note, ETA,
  expiry hint, honest unavailable state and a read-only Intents Connect step list. Deliberately
  non-signable: no confirm/send button in Phase B.
- [x] T014a Format helpers + unit tests (`apps/web/src/lib/earn/format.ts`), live-blocks/chat wiring,
  mocked-agent Playwright spec (`apps/web/e2e/pw/earn-chat.spec.ts`) and What's New/CHANGELOG copy.

## Phase C — live earn execution (pending)

- [ ] T015 Live 1Click Earn deposit via the 068 confirm flow (explicit acknowledgement, live quote,
  user-signed origin transfer, status polling, receipt-vs-share disclosure).
- [ ] T016 Withdraw/redeem path for a Morpho position (native share and 1Click receipt), reusing the
  existing withdraw/exit guarantees (withdrawals never gated).
- [ ] T017 Intents Connect execution behind the flag + Aurora key, using the read-only approve+deposit
  step plan the preview already renders.
- [ ] T018 Client decisions from `research.md` open questions (receipts, Aurora key, chains, filters,
  fee copy) before any live path ships.
