# Tasks: 017 — P1 data surfaces

**Scope**: `apps/web` + `services/agent`. No migration. Detailed per-cluster specs: scratchpad `f017/{realized-pnl,apy-cards,fees-chart}.md`.

## Definition of Done (feature 006)
- [ ] `CHANGELOG.md` bullets + `whats-new.json` client entries (realized PnL, live APY, honest fees).
- [ ] agent `ruff`/`mypy`/`pytest` + web `test`/`typecheck`/`typecheck:test`/`lint`/`build` green; `changelog-required` green.
- [ ] Go-live: set `AAVE_POOL_ADDRESS`/`AAVE_RESERVE_USDC_ADDRESS` on the alpha agent; redeploy agent + web.

## Phase 2: US1 — realized PnL + denser series (P1)
- [ ] T010 `services/agent/.../db/vault_flows.py` — `BasisResult` + `replay_basis` (avg-cost, reconcile gate).
- [ ] T011 [P] `services/agent/tests/db/test_vault_flows.py` — replay cases (deposit-only, withdrawal realized, unreconciled, empty, dust).
- [ ] T012 `services/agent/.../api/portfolio.py` — `_pnl_usd` coherent triple; `_value_series` pre-event re-mark; fetch flows once in `get_portfolio` + `_position_detail`; `PositionDetail.realizedPnlUsd`; wire `Pnl.realizedUsd`.
- [ ] T013 [P] `services/agent/tests/api/test_portfolio.py` — realized-from-withdrawal, null-when-incomplete, densified series, updated fixtures.
- [ ] T014 NEW `apps/web/src/lib/agent/portfolioPnl.ts` + `.test.ts`; rewire `useAgent.ts` (add realizedUsd + per-position realizedPnlUsd).
- [ ] T015 `apps/web/src/app/(app)/portfolio/page.tsx` + `[positionId]/page.tsx` — realized chip/stat + fix "net deposited" copy.

## Phase 3: US2 — honest live Aave APY (P1)
- [ ] T020 NEW `apps/web/src/lib/chain/aaveApy.ts` + `.test.ts` (RAY→APY, apyLabel).
- [ ] T021 NEW `apps/web/src/lib/chain/useAaveSupplyApy.ts` (inline view ABI read).
- [ ] T022 `apps/web/src/app/(app)/vault/page.tsx` — drop `AAVE_SUPPLY_APY_BPS=430`; live APY + honest labels + gate the mock apyHist sparkline.
- [ ] T023 `apps/web/src/lib/chain/vaultConfirmModel.ts` (+ .test.ts) + `useVaultConfirm.tsx` — grossApyBps/testnet ctx; honest netApyText.
- [ ] T024 `apps/web/src/lib/agent/recView.ts` (+ .test.ts) + `strategies/page.tsx` — `apyKnown`; three-way ≈0%/no-yield/estimate render.
- [ ] T025 `apps/web/src/components/screens/chat/cards.tsx` — wire live APY OR add an explicit "Example" mock badge (no unlabeled 4.3%).
- [ ] T030 NEW `services/agent/.../chain/aave_rate.py` (`AavePoolReader` + `supply_apy_bps_from_ray`) + `services/agent/tests/chain/test_aave_rate.py`.
- [ ] T031 `services/agent/.../config.py` — `AAVE_POOL_ADDRESS`/`AAVE_RESERVE_USDC_ADDRESS` env (allowlist, no key-material) + `AgentConfig` fields.
- [ ] T032 `services/agent/.../api/recommendations.py` — best-effort gross read → MarketData(gross/projected/fee); `services/agent/tests/api/test_recommendations.py` extend. Add the two envs to `.env.example`.

## Phase 4: US3 — /fees on-chain proof panel (P2)
- [ ] T040 `apps/web/src/app/(app)/fees/page.tsx` — delete fabricated `HonestyBars` (`yld`/`rev`); add live `totalAssets`/`highWaterMark`/`convertToAssets` reads; render a provable share-price-vs-HWM statement + the user's real position; honest StatusTag. (Small pure helper + test if warranted.)

## Phase 5: Validation & housekeeping
- [ ] T050 agent `ruff`+`mypy`+`pytest` (vault_flows, portfolio, aave_rate, recommendations) green.
- [ ] T051 web `test` + `tsc -p tsconfig.json` + `tsc -p tsconfig.test.json` + `eslint` + `next build` green.
- [ ] T052 `CHANGELOG.md` + `whats-new.json`.
- [ ] T053 Commit per cluster; PR → develop; resolve Defender; merge; set Aave envs + redeploy agent + web via the RWD token; validate live (APY on /vault, realized PnL, /fees panel).

## Dependencies
- A, B, C independent (mostly distinct files; B touches vaultConfirmModel + recView shared with earlier features — sequence within-file edits). Do per-phase, test each, commit. Validation last.
