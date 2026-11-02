# Tasks — 072 multi-chain portfolio (backend + evals)

## Artifacts
- [x] T001 `spec.md`, `plan.md`, `research.md`, `tasks.md`, `contracts/portfolio-api-072.md`,
  `quickstart.md`
- [x] T002 README/CLAUDE SPECKIT pointer → 072 plan; CHANGELOG bullet

## Service
- [x] T010 `portfolio/config.py` — Base/Ethereum/Solana/Morpho env, limits, no key material
- [x] T011 `portfolio/models.py` — section/row/overview, totals, camelCase wire
- [x] T012 `portfolio/pricing.py` — 060 PriceService adapter, stables at $1 par
- [x] T013 `portfolio/rpc.py` — EVM `eth_getBalance`/`eth_call`, Solana `getTokenAccountsByOwner`
- [x] T014 `portfolio/balances.py` — native + USDC/USDT/WETH/cbBTC, per-chain status, non-zero rows
- [x] T015 `portfolio/morpho.py` — one aliased GraphQL request, 069 registry join, receipts
- [x] T016 `portfolio/kamino.py` — owner-linked Solana only; `not_linked` copy; share rows
- [x] T017 `portfolio/rhea.py` — adapter over 071 `rhea_positions`
- [x] T018 `portfolio/swaps.py` — `crosschain_quotes` history, bounded status refresh, linked-address
  extraction
- [x] T019 `portfolio/service.py` — concurrent sections, per-source timeout, short cache, factory
- [x] T020 `db/crosschain_quotes.py` — `list_for_owner` (read-only, owner-scoped)
- [x] T021 `portfolio/text.py` + `portfolio/chat.py` — deterministic prose, detector, block builder

## API
- [x] T030 `api/multichain_portfolio.py` — `GET /portfolio/multichain`, session wallet only,
  wallet/address params rejected, 120/h limiter
- [x] T031 wire into `api/main.py`; `GET /portfolio` untouched

## Chat
- [x] T040 `PortfolioOverviewBlock` in `coordinator/chat_blocks.py`
- [x] T041 DAG route after 068/069/070/071; `portfolio=None` keeps the pre-072 path
- [x] T042 wire the service in `api/chat.py`

## Evals
- [x] T050 `evals/model.py` — `portfolio` mode, `focus`, `sections` expectations
- [x] T051 `evals/portfolio_fixtures.py` — ready/degraded/empty, `EvalPortfolioService`
- [x] T052 `evals/fixtures.py` — build the service when `case.portfolio`
- [x] T053 `evals/assertions.py` — route + focus + section-status assertions
- [x] T054 `golden.yaml` — portfolio-100…108 + 2 precedence negatives (109/110)
- [x] T055 071 vague NEAR-yield eval already present (`near-95-vague-near-yield`) — no duplicate

## Scripts / fixtures / tests
- [x] T060 `scripts/portfolio_smoke.py` — public address, public endpoints, ≤25 calls, no DB
- [x] T061 `packages/shared/tests/fixtures/portfolio/*.json` ready/degraded/empty
- [x] T062 `tests/portfolio/` — balances/morpho/kamino/rhea/swaps/service/API/chat/fixtures
- [x] T063 full agent suite (12 pre-existing vault_reader failures excepted), golden + crosschain +
  earn suites, ruff, ruff format, mypy, smoke

## Verification (recorded in research.md)
- [x] `uv run pytest -q tests/portfolio tests/evals tests/crosschain tests/earn` (plus the full
  suite run for the final report)
- [x] `uv run python -m evals.run --mode offline`
- [x] `uv run ruff check src tests scripts evals`
- [x] `uv run ruff format --check <touched files>`
- [x] `uv run mypy src`
- [x] `uv run python scripts/portfolio_smoke.py` (16 calls)
