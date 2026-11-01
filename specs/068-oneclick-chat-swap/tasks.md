# Tasks — 068 one-click cross-chain swaps (backend half)

## Backend

- [x] **T6801** Create `sparkpoint_agent/crosschain/` package with shipped `routes.json` and a
  config loader (`CROSSCHAIN_ROUTES_PATH`, `CROSSCHAIN_ENABLED`).
- [x] **T6802** Add the async 1Click client: UA header, optional Bearer key (never logged),
  tokens TTL cache, dry/live quote, deposit submit, status; typed `QuoteUnavailable` /
  transport errors.
- [x] **T6803** Add per-chain address format validation and dry-quote placeholders.
- [x] **T6804** Add the deterministic parser (demo prompts, `from <chain>`, `into native BTC`,
  `on <chain>`, compact/decimal amounts) with same-chain negatives.
- [x] **T6805** Add `CrossChainService` preview/live-quote/status helpers and keyless fee note.
- [x] **T6806** Add `CrossChainQuoteBlock` (`crosschain_quote`) to `coordinator/chat_blocks.py`.
- [x] **T6807** Hook the parser into `CoordinatorDag.run_chat` before the planner and fast read
  path; feature flag off falls through; transport errors answer with friendly text.
- [x] **T6808** Inject the service in `api/chat.py`; persist the new block with the turn.
- [x] **T6809** Add `api/crosschain.py` (`/assets`, `/quote`, `/deposit/submit`, `/status`) with
  account scoping, rate limit, validation, ownership and live-quote persistence; mount it in
  `api/main.py`.
- [x] **T6810** Add `db/crosschain_quotes.py` and migration `0044_crosschain_quotes.sql`; update
  `MIGRATIONS.md`.
- [x] **T6811** Parser tests (demo table, negatives, precision, disabled Tron).
- [x] **T6812** Service tests with `httpx.MockTransport` (preview, fee note, Bearer, Tron, 400,
  transport, live deposit address, tokens cache).
- [x] **T6813** Router tests (assets, dry default, unavailable, validation, live persist,
  ownership, rate limit).
- [x] **T6814** DAG tests: four demo prompts emit `crosschain_quote` without the LLM; Tron
  unavailable; transport fallback; old bridge/same-chain behaviour preserved.
- [x] **T6815** `scripts/oneclick_dry_smoke.py` and one real dry run.
- [x] **T6816** Verify `ruff check`, `ruff format --check`, `mypy`, full `pytest`.

## Phase 2 — frontend (pending)

- [ ] **T6817** Add the `crosschain_quote` member to the shared zod `ChatBlock` union
  (`packages/shared`) with the camelCase fields in `contracts/crosschain-api.md`.
- [ ] **T6818** Render the chat preview card: origin/destination, amount out, USD estimate, ETA,
  slippage, fee note, expiry, and the unavailable state (factual copy; mainnet-funds warning).
- [ ] **T6819** Confirm screen: collect destination/refund addresses, call `POST /crosschain/quote`
  with `dry=false`, show the deposit address/deadline, and never sign.
- [ ] **T6820** Deposit/status UI: submit the origin tx hash, poll `GET /crosschain/status`, show
  PENDING_DEPOSIT / PROCESSING / SUCCESS / REFUNDED / FAILED honestly.
- [ ] **T6821** E2E on the develop environment with the demo prompts (dry quotes only in CI).

## Docs / release

- [x] **T6822** Spec-kit artifacts (`spec.md`, `plan.md`, `tasks.md`, `research.md`,
  `contracts/crosschain-api.md`, `quickstart.md`) and the CLAUDE.md SPECKIT pointer.
- [ ] **T6823** Client-facing release notes (`CHANGELOG.md` + in-app `whats-new.json`) when the
  frontend half ships.
