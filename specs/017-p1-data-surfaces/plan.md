# Implementation Plan: 017 — P1 data surfaces

**Branch**: `feat/017-p1-data-surfaces` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-07-23

## Summary
Three independent clusters, all no-migration: (A) realized PnL + denser series (agent `vault_flows.py` avg-cost replay + `portfolio.py` rewire; web pure `portfolioPnl.ts` + `useAgent` + UI copy); (B) honest live Aave APY (agent `aave_rate.py` reader + config + recommender MarketData; web pure `aaveApy.ts` + `useAaveSupplyApy` hook + vault/strategies/confirm/chat wiring — mirrored TS/Python conversion); (C) `/fees` on-chain proof panel (web-only, replaces fabricated bars with live share-price-vs-HWM + user position). Detailed per-cluster specs in scratchpad `f017/`.

## Technical Context
- Web: Next.js `apps/web`; wagmi/viem view reads; `node:test` pure units.
- Agent: FastAPI `services/agent`; `pytest`/`ruff`/`mypy`; keyless view reads via the existing `JsonRpcTransport`.
- Two public agent env vars (`AAVE_POOL_ADDRESS`, `AAVE_RESERVE_USDC_ADDRESS`) — runtime config, unset ⇒ honest null.

## Constitution Check
| Principle | Impact | Verdict |
|---|---|---|
| I Non-custody | All reads view-only + keyless; no withdraw/exit/custody path touched; ~0% testnet deposit still signable. | ✅ |
| II Policy disposes | `signable ⟺ policy approved` preserved on rec cards. | ✅ |
| III Provable, not promised | Replaces fabricated 4.3% + fabricated fee bars + `realizedUsd=None` with real on-chain-derived figures; honest ≈0%/—/null everywhere; fixes the unrealized double-count. **Core of the feature.** | ✅ |
| IV/V Security/Conservative | No new attack surface; APY read is a view call; honest fee disclosure. | ✅ |
| VI Spec-driven | This spec/plan/tasks precede code. | ✅ |
| VII Simplicity/YAGNI | Reuse existing indexed flows / stores / patterns; no migration; the public fee-revenue endpoint is deferred (business-disclosure). | ✅ |

**Gate: PASS.** No deviations. The public `/fees/proof` protocol-revenue endpoint is deliberately NOT built (operator business-disclosure decision) — the honest on-chain fallback is built instead.

## Project Structure
```
# A — realized PnL
services/agent/src/sparkpoint_agent/db/vault_flows.py        (BasisResult + replay_basis)
services/agent/src/sparkpoint_agent/api/portfolio.py         (_pnl_usd, _value_series, get_portfolio, _position_detail)
services/agent/tests/db/test_vault_flows.py (NEW) + tests/api/test_portfolio.py (extend)
apps/web/src/lib/agent/portfolioPnl.ts (NEW) + .test.ts + useAgent.ts + portfolio pages (copy/realized chip)
# B — APY
services/agent/src/sparkpoint_agent/chain/aave_rate.py (NEW) + config.py + api/recommendations.py
services/agent/tests/chain/test_aave_rate.py (NEW) + tests/api/test_recommendations.py (extend)
apps/web/src/lib/chain/aaveApy.ts (NEW) + .test.ts + useAaveSupplyApy.ts (NEW)
apps/web/src/app/(app)/vault/page.tsx + lib/chain/{useVaultConfirm.tsx,vaultConfirmModel.ts(+test)} + strategies/page.tsx + lib/agent/recView.ts(+test) + components/screens/chat/cards.tsx
# C — fees
apps/web/src/app/(app)/fees/page.tsx (+ a small pure helper if warranted)
```

## Approach notes
- Pure-module discipline: `portfolioPnl.ts`, `aaveApy.ts` are dependency-free (unit-tested); hooks/pages own the runtime reads.
- Mirrored conversion (RAY→APY) in TS + Python — both carry a "keep in sync" docstring + their own tests.
- Fail-closed everywhere: unreconciled history ⇒ null PnL; unreadable/unconfigured APY ⇒ null/"—"; RPC outage ⇒ existing stale path.
- Honesty-preserving copy: update "net deposited" → "avg cost of held shares"; "illustrative APY" → "live Aave supply rate (≈0% on testnet)".

## Complexity Tracking
No deviations, no new deps, no schema/migration. Business-disclosure (`/fees/proof` public revenue) deferred by choice.
