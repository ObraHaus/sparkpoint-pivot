# Phase 1 — Data Model: `0022_recommendations.sql`

Source of truth: `specs/001-.../data-model.md` §7 (E7 recommendations) — simplified to the MVP snapshot
+ lifecycle. The attribution CHAIN reuses columns already created by `0021_execution.sql`
(`intent_bundles.recommendation_id`, `executions.attribution_method`/`intent_log_action_id`); this
migration adds only the `recommendations` table. **No `outcome_logs` table** — outcomes are computed
live (research R5). Conventions: `id UUID DEFAULT gen_random_uuid()`, `CITEXT` lower-cased addresses,
`JSONB`, `TIMESTAMPTZ`. Apply with `PGCLIENTENCODING=UTF8`. Additive, forward-only. Next number **0022**.

---

## Enum (guarded)

| Enum | Values |
|---|---|
| `recommendation_status` | `surfaced`, `acted`, `executed`, `declined`, `rejected` |

## Table `recommendations` (OFFCHAIN snapshot; the attribution anchor)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | = the wire `recId`; written to `intent_bundles.recommendation_id`. |
| `wallet` | `CITEXT NOT NULL` | the wallet the rec was surfaced to / acted on (lower-cased). |
| `dedupe_key` | `TEXT NOT NULL` | `sha256(lower(wallet)|strategy_kind|canonical_json(proposed_action)|policy_version)`. |
| `strategy_kind` | `TEXT NOT NULL` | e.g. `vault_deposit`. |
| `title` | `TEXT NOT NULL` | e.g. "Supply USDC to the Aave Yield Vault". |
| `rationale` | `TEXT NOT NULL DEFAULT ''` | plain-language why (empty for a build-time minimal rec). |
| `proposed_action` | `JSONB NOT NULL` | the ProposedAction snapshot (type/asset/decimals/amount/params). |
| `rank` | `SMALLINT` | ranking vs goal (null for a minimal rec). |
| `mandate_version` | `TEXT` | the mandate version it was scored against (provability; null if unknown). |
| `policy_version` | `TEXT NOT NULL` | the policy version at proposal (`policy@2026.06.0`). |
| `status` | `recommendation_status NOT NULL DEFAULT 'surfaced'` | see lifecycle. |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints/indexes: PK; **`UNIQUE(dedupe_key)`** (idempotent upsert — FR-002);
`(wallet, created_at DESC)`; `(wallet, status)`.

### Lifecycle — `recommendation_status`

```
surfaced ──(user builds a tx from it, /build-tx)──▶ acted ──(signed tx confirms)──▶ executed  (⇒ eligible for an outcome)
surfaced ──(policy rejects at build)──▶ rejected
acted    ──(user declines / wallet rejects / timeout)──▶ declined
```

- **VR-R4** (data-model): only an `executed` recommendation yields an outcome (FR-004/SC-004);
  `surfaced`/`acted`/`declined`/`rejected` do NOT.
- **FR-002**: `UNIQUE(dedupe_key)` ⇒ re-surfacing the same advice upserts one row (no duplicates).

## Reused 0021 columns (populated by this feature — no schema change)

- `intent_bundles.recommendation_id UUID` (0021, plain nullable UUID) — **was always `None`**; now
  written with the resolved rec UUID at `/build-tx` (the FR-039 link). *(No FK to `recommendations` —
  0021 kept it plain; a value that doesn't resolve is honestly unlinked. A FK could be added later.)*
- `executions.attribution_method attribution_method` (`intent_log`|`heuristic_match`, 0021) — **never
  written**; now set to `intent_log` when a rec-linked execution confirms.
- `executions.tx_hash BYTEA` (0021, indexed) — the deposit tx; the join key from an outcome lot → the rec.

## Attribution chain (end-to-end, all reused/live)

```
recommendations(id) ──1:N──▶ intent_bundles.recommendation_id ──1:1──▶ executions(tx_hash, attribution_method='intent_log')
                                                                              │
                                             (deposit tx) ──▶ vault_flows lot ─┘──▶ replay_lots ──▶ realized+unrealized PnL (LIVE)
```

- The link is stored (intent_bundles + executions); the **PnL is computed live** from the indexed flows
  + on-chain share price on each read (no outcome_logs row).

## Validation Rules (enforced)

- **VR-A1** (FR-039/SC-002): every `executed` rec has a stored, on-chain-anchored link
  (`intent_bundles.recommendation_id` + `executions.tx_hash`) — provable, not asserted.
- **VR-A2** (FR-006/SC-003): every PnL figure is reconstructable from chain (flows + share price);
  outcomes are returned only when the share history reconciles (else honest "can't reconcile").
- **VR-A3** (FR-007/SC-005): a blended position attributes per-lot (FIFO) + labels a *share of a shared
  position*; a deposit with no rec link is position-level unattributed — never a fabricated split.
- **VR-A4** (N2): nothing here gates the withdraw/exit path; a rec-store outage fails open (advisory).
- **VR-A5** (N3/N5): no key/signature is stored; the rec store holds only the advice snapshot + the
  lifecycle + the (public) link ids.

## Migration ordering

1. Create the `recommendation_status` enum (guarded `DO $$ … duplicate_object …$$`).
2. `CREATE TABLE recommendations` + `UNIQUE(dedupe_key)` + indexes.

Update `MIGRATIONS.md` (per-migration row + current-state) when applied. Next free number is **0022**.
