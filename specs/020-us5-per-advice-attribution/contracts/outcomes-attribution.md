# Phase 1 — Interface Contract: US5 attribution surfaces

Concrete request/response shapes. Money = base-unit integer strings or decimal USD strings; camelCase +
`ConfigDict(extra="forbid")` byte-parity where a model is shared. All are **read/derive** (no signing).

---

## `GET /recommendations` (changed) — recId is now a persisted UUID

- Behavior change: at surface time, each cleared rec is upserted into `recommendations` (by
  `dedupe_key`) and `recId` = the persisted **UUID** (was `rec_{strategy_kind}`);
  `proposedAction.recommendationId` echoes it. Fail-open: a store outage → the old ephemeral id.
- Response shape unchanged otherwise (§3.4). The web passes `recId` through unchanged.

## `GET /recommendations/{recId}` (changed) — store read

- `recId` is a UUID → read the persisted rec (title/rationale/proposedAction/status). `NOT_FOUND` for an
  unknown id. (Was a stateless recompute-by-strategy-kind, which a UUID can't match.)

## `GET /outcomes` (augmented) — add `recommendations[]`

**Response 200** (`OutcomesResponse`, extended):
```jsonc
{
  "asOfBlock": 0, "asOf": "…", "stale": false, "reconciles": true,
  "netRealizedUsd": "…", "wins": 1, "losses": 0,
  "outcomes": [ /* existing per-WITHDRAWAL rows (position-level) — unchanged */ ],
  "recommendations": [                      // NEW — one per ACTED-ON (executed) rec
    {
      "recId": "…uuid…",
      "title": "Supply USDC to the Aave Yield Vault",
      "strategyKind": "vault_deposit",
      "actedTxHash": "0x…",                 // the deposit tx (on-chain proof of acting on the advice)
      "entryBlock": 0,
      "entryUsd": "100.00",                 // the deposit's cost (its lot)
      "realizedUsd": "0.00",                // FIFO-realized on this rec's lot (signed)
      "unrealizedUsd": "0.25",              // current mark of the lot's remaining shares − remaining cost
      "label": "open",                      // open | win | loss | flat
      "attributionMethod": "intent_log",    // explicit link (never heuristic in the MVP)
      "shared": false,                       // true ⇒ part of a position blended across ≥2 lots (honest)
      "reconstructable": true
    }
  ]
}
```
- `recommendations[]` is populated only when `reconciles` (else `[]`, honest). Each row's PnL is
  computed LIVE from `replay_lots` (FIFO) + the on-chain share price — never cached.

## `GET /outcomes/{recId}` (new) — one recommendation's outcome detail

**Response 200** (`RecommendationOutcomeResponse`):
```jsonc
{
  "recId": "…uuid…",
  "title": "…", "rationale": "…", "strategyKind": "vault_deposit",
  "proposedAction": { "type": "vault_deposit", "asset": "0x…", "decimals": 6, "amount": "100000000" },
  "status": "executed",
  "actedTxHash": "0x…", "entryBlock": 0,
  "entryUsd": "100.00", "realizedUsd": "0.00", "unrealizedUsd": "0.25",
  "realizedApyBps": 0,                       // annualized realized return for the advice (null while open/flat)
  "label": "open",
  "attributionMethod": "intent_log",
  "shared": false,
  "reconstructable": true, "asOfBlock": 0
}
```
- **Errors**: `NOT_FOUND` (unknown recId, or a rec not yet `executed` → no outcome yet), `DATA_STALE`
  (chain/index outage → the honest degraded state).

## Non-custody / honesty invariants (contract-level)

- Pure read/derive: no request here signs, moves funds, or writes on-chain (N1/N3/N5).
- `reconstructable:false` / `reconciles:false` → the honest "can't reconcile" state, never a guessed
  number. `attributionMethod` is only ever `intent_log` (the explicit link); non-linked flows are shown
  in the position-level `outcomes[]`, not falsely credited. `shared:true` marks a blended-position slice.
- Nothing gates the withdraw/exit path (N2).

## New pydantic models (`api/portfolio.py`) — byte-parity with the web view

`RecommendationOutcomeRow` (the `recommendations[]` item) + `RecommendationOutcomeResponse` (the detail),
both `ConfigDict(extra="forbid")` + camelCase, mirrored in `apps/web/src/lib/agent/outcomesView.ts`.
