# Quickstart — Validating US5 per-advice attribution

Proves the credibility loop end to end. Details in [plan.md](./plan.md), [data-model.md](./data-model.md),
[contracts/outcomes-attribution.md](./contracts/outcomes-attribution.md).

## Prerequisites

- Agent + web running (locally or on alpha). Base Sepolia (84532) vault deployed. Migration
  `0022_recommendations.sql` applied.
- A beta-allowlisted, funded testnet wallet with a USDC allowance to the vault (the deployer works).

## Agent unit / contract tests (fast, no chain)

```bash
cd services/agent
uv run ruff check src && uv run mypy src
uv run pytest tests/db/test_recommendations.py tests/db/test_replay_lots.py \
              tests/api/test_outcomes_attribution.py -q
```

Expect: the rec store upserts idempotently by dedupe_key (no dup on re-surface); `replay_lots` FIFO
attributes realized+unrealized per deposit lot with exact integer math + the reconcile gate; the
outcome endpoints only expose an outcome for an `executed` rec (a surfaced-only rec → no outcome);
attribution is `intent_log`; a blended position is marked `shared:true`.

## Web unit tests

```bash
cd apps/web
pnpm run typecheck:test && pnpm run lint
node --experimental-strip-types --test "src/lib/agent/**/*.test.ts"
pnpm run build
```

Expect: the outcomes view parses the new `recommendations[]` section; the "By recommendation" rows
render title + acted-tx + PnL + label; the honest unattributed/`can't reconcile` states hold.

## End-to-end on alpha (SC-007 — the acceptance bar)

Authenticated via the real SIWE flow with the deployer key:

1. **Surface**: `GET /api/agent/recommendations` → note a rec's `recId` (now a **UUID**) + confirm a
   `recommendations` row was upserted for it.
2. **Act**: `POST /api/agent/build-tx` with `action.recommendationId = <recId>` → confirm the returned
   `intentBundle.recommendationId` is the same UUID **and** the `intent_bundles.recommendation_id` DB
   column is now written (was NULL); the rec status is `acted`.
3. **Execute**: sign + submit (or relay a tx) → confirm the rec status becomes `executed` and
   `executions.attribution_method = 'intent_log'`.
4. **Outcome (open)**: `GET /api/agent/outcomes/{recId}` → an `open` outcome with the acted tx as proof,
   `entryUsd` = the deposit, `unrealizedUsd` marking to the live share price, `attributionMethod:
   'intent_log'`, `reconstructable:true`. And `GET /api/agent/outcomes` now carries a `recommendations[]`
   row for it.
5. **Realize**: withdraw part/all → re-`GET /outcomes/{recId}` → `realizedUsd` now reflects the FIFO-
   realized PnL of that rec's lot; label flips to `win`/`loss` when closed. Every figure recomputes from
   chain (recompute independently to confirm).
6. **Honesty**: a rec surfaced but NOT acted on → `GET /outcomes/{recId}` → `NOT_FOUND` (no outcome). A
   deposit made outside any rec → appears in the position-level `outcomes[]`, not credited to advice.
7. **No regression**: the position-level `/outcomes` ledger + the direct `/exit` path are unchanged (N2).

## Non-custody spot checks

- No response signs, moves funds, or writes on-chain; the rec store holds only the advice snapshot + the
  public link ids (no key/signature).
- A rec-store outage degrades the attribution view (fail-open) — it never blocks the list or the exit.
