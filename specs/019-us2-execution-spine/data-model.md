# Phase 1 — Data Model: `0021_execution.sql`

Source of truth: `specs/001-sparkpoint-pivot-mvp/data-model.md` §11 (E11 `intent_bundles` +
`executions`, §11.1 lifecycle), §12 (E12 `simulation_results`), + the VR rules. This file pins the
**as-built** column choices for the 0021 migration, reconciled with the FK-referent + circular-FK
traps (research R5). Conventions (data-model sec.0): money = `NUMERIC(78,0)` raw base units; times
`TIMESTAMPTZ`; addresses `CITEXT` lower-cased; tx/userop hashes `BYTEA`; JSON via `JSONB`; PK =
`UUID DEFAULT gen_random_uuid()`. **No key/signature/signed payload is ever stored (N3/VR-A3).**

Apply with `PGCLIENTENCODING=UTF8` (header comment carries em-dashes). Additive, forward-only.

---

## Enums (guarded with `DO $$ … duplicate_object …$$`)

| Enum | Values |
|---|---|
| `policy_verdict` | `approved`, `rejected`, `blocked_simulation`, `blocked_cap`, `blocked_slippage`, `blocked_allowlist` |
| `execution_status` | `built`, `policy_rejected`, `declined`, `submitted`, `confirmed`, `indexed`, `reverted`, `dropped` |
| `action_kind` | `deposit`, `withdraw`, `swap`, `rebalance` |
| `signing_mode` | `per_action_user_signature`, `session_key` |
| `attribution_method` | `intent_log`, `heuristic_match` |

## Table `intent_bundles` — the unsigned proposal (OFFCHAIN)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | **= the `intent_action_id`** minted at build time (US5 attribution anchor). |
| `recommendation_id` | `UUID NULL` | **plain (no FK)** — `recommendations` table absent. Link hint to the outcome ledger. |
| `user_id` | `UUID NULL` | **plain (no FK)** — `users` linkage optional; identity is the address. |
| `smart_account_address` | `CITEXT NOT NULL` | lower-cased; the connected owner (== account today). |
| `chain_id` | `BIGINT NOT NULL` | the request chain (84532 on testnet). |
| `kind` | `TEXT NOT NULL` | the `ActionType` wire string (`vault_deposit` / `vault_withdraw` / `vault_redeem`). |
| `steps` | `JSONB NOT NULL` | ordered unsigned steps `{chainId, opType, to, value, data, label}` — **calldata only, signature never present**. |
| `policy_verdict` | `policy_verdict NOT NULL` | from `evaluate()`; `approved` iff signable. |
| `policy_version` | `TEXT NOT NULL` | e.g. `policy@2026.06.0`. |
| `policy_reasons` | `JSONB NOT NULL` | `[{code, message}]` (the per-step trace / rejection reasons). |
| `simulation_result_id` | `UUID NULL` | FK→`simulation_results(id)` added via **`ALTER`** after both tables exist. **Required for `approved`** (VR-X2) — enforced in app + a partial CHECK is not expressible across the circular FK, so app-invariant + test. |
| `exec_mode` | `signing_mode NOT NULL DEFAULT 'per_action_user_signature'` | testnet = per-action. |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | short TTL; a stale bundle must be re-simulated/rebuilt. |
| `is_session_key_path` | `BOOLEAN NOT NULL DEFAULT false` | always false until US6. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Indexes: PK; `(smart_account_address, created_at DESC)`; `(recommendation_id) WHERE recommendation_id IS NOT NULL`.

## Table `simulation_results` — the pre-trade preview (OFFCHAIN)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `intent_bundle_id` | `UUID NOT NULL REFERENCES intent_bundles(id)` | target created first → inline FK ok. |
| `simulator` | `TEXT NOT NULL` | provider: `viem_eth_call` (vault path) / `anvil_fork` (future). |
| `sim_block` | `BIGINT NOT NULL` | freshness anchor (`asOfBlock`). |
| `will_revert` | `BOOLEAN NOT NULL` | |
| `revert_reason` | `TEXT NULL` | decoded `Error(string)` if any. |
| `expected_out_raw` | `NUMERIC(78,0) NULL` | `sharesOut` (deposit) / `assetsOut` (withdraw). |
| `expected_fees_raw` | `NUMERIC(78,0) NULL` | tx-time protocol fee = 0 (profit-only perf fee is share dilution). |
| `price_impact_bps` | `INT NULL` | swaps only (null on vault path). |
| `estimated_slippage_bps` | `INT NULL` | swaps only. |
| `balance_deltas` | `JSONB NOT NULL DEFAULT '[]'` | rendered in the drawer (viem leg → `[]`; enrichment later). |
| `passed` | `BOOLEAN NOT NULL` | composite: `NOT will_revert AND (slippage within max OR n/a)`. |
| `raw_sim_ref` | `TEXT NULL` | external sim id if any (null for viem). |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Index: `(intent_bundle_id)`.

## Table `executions` — the result over ONCHAIN-DERIVED truth (append-mostly)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `intent_bundle_id` | `UUID NOT NULL REFERENCES intent_bundles(id)` | |
| `smart_account_address` | `CITEXT NOT NULL` | |
| `action_kind` | `action_kind NOT NULL` | deposit / withdraw (swap/rebalance later). |
| `signing_mode` | `signing_mode NOT NULL DEFAULT 'per_action_user_signature'` | |
| `status` | `execution_status NOT NULL DEFAULT 'submitted'` | see lifecycle below. |
| `userop_hash` | `BYTEA NULL` | null on eoa_call. |
| `tx_hash` | `BYTEA NULL` | the on-chain proof (the *event* of having signed — VR-X1). |
| `block_number` | `BIGINT NULL` | |
| `gas_used` | `NUMERIC(78,0) NULL` | |
| `realized_amounts` | `JSONB NULL` | actual in/out from the receipt. |
| `reverted_reason` | `TEXT NULL` | |
| `intent_log_action_id` | `BYTEA NULL` | on-chain IntentLog correlation (future). |
| `attribution_method` | `attribution_method NULL` | `intent_log` \| `heuristic_match` (for US5). |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints/indexes: PK; **`UNIQUE (intent_bundle_id)`** (durable submit de-dup, research R6);
`(smart_account_address, created_at DESC)`; `(tx_hash) WHERE tx_hash IS NOT NULL`.

### `execution_status` lifecycle (data-model §11.1)

```
built ──▶ policy_rejected            (policy REJECT — no signature ever offered)
      ──▶ declined                   (user declines / wallet rejects / timeout — no tx)
      ──▶ submitted ──▶ confirmed ──▶ indexed      (write/refresh the outcome ledger — US5)
                    ──▶ reverted                    (on-chain revert)
                    ──▶ dropped                      (dropped / replaced)
```

This feature writes `submitted` on relay and advances to `confirmed`/`reverted` on status poll.
`built`/`policy_rejected` are represented by the `intent_bundles.policy_verdict` (a rejected build
persists a bundle row with a non-`approved` verdict and writes NO `executions` row).

## Validation Rules (enforced)

- **VR-X1** (SC-001/FR-022): no `executions` row reaches `submitted` without a recorded user-signature
  event (a byte-matched signed payload / a tx hash). **No signature/key is ever stored** — only the
  tx/userop hash. Enforced in `submit-signed-tx` (byte-match + reject null signature).
- **VR-X2** (FR-021/SC-002): an `intent_bundles` row with `policy_verdict='approved'` MUST reference a
  `simulation_result_id`. Enforced: the orchestrator persists `simulation_results` **before**
  `intent_bundles` on the approved path and sets the FK; a build test asserts no approved bundle has a
  null `simulation_result_id`.
- **VR-X3** (FR-008): `policy_verdict != 'approved'` ⇒ the API returns reasons + **no** bundle (the
  drawer never renders a signable artifact).
- **VR-X5** (N1): no `steps[].data` may encode a recipient other than the connected user — forced in
  `builder.py` and independently re-checked by `evaluate()` (`RECIPIENT_NOT_USER`).
- **VR-X6**: `executions` are append-mostly; the on-chain `tx_hash` + events are authoritative and
  re-derivable — the row is a convenience index, never a source of funds movement.
- **VR-S1/S2/S3**: `passed = NOT will_revert (AND slippage≤max where applicable)`; a sim older than
  the freshness tolerance forces a re-simulate before sign (`/simulate`); a passed sim is displayed in
  the drawer before 100% of signatures.
- **N2**: no row on any exit path may be gated — the withdraw/redeem build persists an `approved`
  bundle even under a hostile ctx, and no `executions`/`simulation_results` row can block a redemption.

## Migration ordering (avoids the traps)

1. Create the 5 enums (guarded).
2. `CREATE TABLE intent_bundles` — `simulation_result_id UUID NULL` (no inline FK yet).
3. `CREATE TABLE simulation_results` — inline FK → `intent_bundles(id)`.
4. `ALTER TABLE intent_bundles ADD CONSTRAINT intent_bundles_sim_fk FOREIGN KEY (simulation_result_id) REFERENCES simulation_results(id)`.
5. `CREATE TABLE executions` — inline FK → `intent_bundles(id)` + `UNIQUE(intent_bundle_id)`.
6. Indexes.

Update `MIGRATIONS.md` (per-migration row + changelog + current-state) when applied. Next free number
is **0021**.
