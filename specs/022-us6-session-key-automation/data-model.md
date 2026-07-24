# Data Model — US6 Session-Key Automation (022)

## E10 — `session_keys` (migration `0024_session_keys.sql`)

The owner-scoped **mirror** of an on-chain scoped session grant. The CHAIN (the deployed
`SparkPointAccount`'s own storage) is the source of truth; every column is re-derivable, so nothing is
fabricated (Principle III / N5). Holds the session **public** key only — never a private key or
signature (N3). Revoke is a **sacred exit** (N2): `revoked_tx_hash` records the owner's unilateral kill.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `smart_account_address` | CITEXT | the user's ERC-4337 account |
| `owner_address` | CITEXT | the account's sole owner EOA (N3) |
| `chain_id` | BIGINT | 84532 (Base Sepolia) |
| `session_pubkey` | CITEXT | PUBLIC key only |
| `status` | `session_key_status` | `active` \| `expired` \| `revoked` \| `exhausted` |
| `allowlisted_targets` | CITEXT[] | the session scope's targets |
| `allowlisted_selectors` | TEXT[] | parallel 4-byte selectors (0x-hex) |
| `per_tx_cap_raw` | NUMERIC(78,0) | USDC base units (6dp) |
| `cumulative_cap_raw` | NUMERIC(78,0) | lifetime ceiling |
| `spent_raw` | NUMERIC(78,0) | mirror of the on-chain **monotonic** spend (GREATEST on sync) |
| `max_slippage_bps` | INTEGER | swap floor; 0 = n/a (vault/Aave) |
| `valid_after` | TIMESTAMPTZ NULL | activation (null ⇒ now) |
| `valid_until` | TIMESTAMPTZ | **hard expiry** (N4, required) |
| `registered_tx_hash` | BYTEA | grant tx/userOp EVENT (never a signature) |
| `revoked_tx_hash` | BYTEA | revoke tx EVENT (sacred exit) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Constraints/indexes: `UNIQUE (smart_account_address, session_pubkey)` (a re-grant upserts + never
resets `spent`); `(smart_account_address, status)`; `(valid_until) WHERE status='active'` (drives the
`sessionKeyExpiry` notification). Additive/idempotent; apply with `PGCLIENTENCODING=UTF8`.

### Lifecycle (`session_key_status`)
`(absent) → active → { exhausted (spent ≥ cumulative_cap) | expired (now ≥ valid_until) | revoked
(owner-only revoke) }`. A re-authorization mints a NEW session key (a new pubkey ⇒ a new row).

### On-chain ↔ mirror parity (VR mapping)
The mirror follows the account's own storage: `Policy{sessionKey, validAfter, validUntil, perTxCap,
cumulativeCap, spent, maxSlippageBps, revoked}` + the per-session `(target,selector)` allowlist
snapshot ↔ the columns above. `spent_raw` is only ever advanced (monotonic), matching the on-chain
in-validation `spent += notional`. The store fail-opens (advisory); it is never on the withdraw/exit
path (N2).

## Extends 019 (`0021`) — the execution spine
`signing_mode` enum already carries `'session_key'`; `intent_bundles.exec_mode` /
`intent_bundles.is_session_key_path`; `executions.signing_mode` / `executions.userop_hash`. The
session-key submission path reuses these (no schema change) — the automated-move increment writes
`exec_mode='session_key'` / `is_session_key_path=true` and records `userop_hash`.
