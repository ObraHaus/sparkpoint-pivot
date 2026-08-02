# Data Model — 028 Sparky Memory v2 (Platform-Activity Awareness)

## 1. `user_memory.activity_cursor` (NEW column, migration 0031)

Nullable JSONB on the existing `user_memory` row (feature 027). `NULL` = never folded.
All writes `json.dumps(..., ensure_ascii=False)` (SQL_ASCII server constraint).

```jsonc
{
  "v": 1,                                  // shape version for forward-compat
  "flows":  { "base": { "block": 12345678, "log": 2 } },        // per network_id
  "execs":  { "ts": "2026-08-03T02:10:00+00:00",                // newest row SEEN
              "deferred": ["<execution-uuid>", "..."] },        // pending, ≤10 carried
  "swaps":  { "base": { "block": 12345600, "log": 0 },
              "robinhood": { "block": 991, "log": 1 } },
  "faucet": "2026-08-02T14:13:00+00:00"                          // last folded claim ts
}
```

Rules:
- **Missing sub-key** = that source never folded for this user (treated like first fold for
  that source, still subject to the global first-fold rule when the whole column is NULL).
- **Clear keeps the cursor**: `MemoryStore.clear()` nulls `lines` only. FR-009.
- **Atomicity**: lines-append + cursor write happen in ONE transaction
  (`MemoryStore.append_with_cursor`), under the existing `FOR UPDATE` row lock.
- **Fallback**: `UndefinedColumnError` reading/writing the column ⇒ fold disabled, warn once
  (`user_memory_fold_column_missing`), memory v1 behavior.

## 2. `ActivityEvent` (internal model, `activity.py` — never persisted, never on the wire)

| field        | type                | notes |
|--------------|---------------------|-------|
| `source`     | `"flow" \| "exec" \| "swap" \| "faucet"` | provenance |
| `kind`       | str                 | `deposit`/`withdraw`/`swap`/`faucet_claim`/execution `action_kind` |
| `at`         | datetime (UTC)      | flow: block-derived; exec: `created_at`; swap: `block_time`; faucet: derived ts |
| `amount_raw` | int \| None         | base units; None where unknowable (faucet) |
| `decimals`   | int \| None         | 6 for vault USDC; swap: `token_decimals` |
| `approx`     | bool                | True for swap notional (fee × 500) |
| `via_sparky` | bool                | exec-matched (R6/R7) |
| `reverted`   | bool                | exec status `reverted` |
| `tx`         | str \| None         | lower hex no-0x — the dedup key |
| `order_key`  | tuple               | `(at, block, log)` — merge ordering + cursor advance |

## 3. Line formats (produced by `activity.py`, consumed verbatim by the digest)

All ≤ `MAX_LINE_CHARS` (120), plain text, absolute dates (`%b %-d`), amounts 2dp:

```
deposited 500.00 USDC into the vault (yourself, Aug 1)
withdrew 120.00 USDC from the vault (yourself, Aug 2)
deposited 500.00 USDC into the vault (via Sparky's plan, Aug 2)
granted a session key (via Sparky's plan, Aug 2)
a vault withdrawal you signed didn't go through (reverted, Aug 2)
made a token swap (~1,000.00 USDC, Aug 2)
made a token swap (~5.00 WETH, Aug 3)        // fee token ≠ USDC: label with the fee token's symbol-less unit? → see note
claimed test SRK from the faucet (Aug 2)
```

Note on the swap unit: the fee event records `token_address` + `token_decimals` but no symbol.
v2 renders the amount with NO invented symbol when the token is not the network's canonical
USDC (address match against the shared address book): `made a token swap (~5.00 tokens, Aug 3)`.
Honest over specific — a wrong symbol would violate Constitution III.

## 4. State transitions (cursor advance per fold)

```
fold(owner, account, cursor):
  events = merge(
      flows.list_since(cursor.flows[net], LIMIT 25)      per net with data,
      execs.list_since(cursor.execs.ts) ∪ execs.by_id(cursor.execs.deferred)   LIMIT 25,
      swaps.list_for_swapper_since(cursor.swaps[net], LIMIT 25)  per net,
      faucet.last_claim if > cursor.faucet)
  events = dedup_by_tx(events)                     # flow+exec pair → one via-Sparky event
  if cursor is NULL: events = last K=5 chronologically; cursors → head
  else: events = first 10 chronologically; cursors → last folded event
        (execs: ts → newest SEEN; still-pending ids → deferred, capped 10)
  lines = [format(e) for e in events]
  append_with_cursor(owner, lines, new_cursor)     # one transaction
```

Failure at ANY step: no append, no cursor change, one process-lifetime warning; the turn
proceeds with the unfolded digest.

## 5. Unchanged (inherited from feature 027 — the contract this feature must not disturb)

- `user_memory.lines` shape (`[{"at": iso, "line": str}]`), 40-entry cap, oldest dropped.
- Digest render: fence, sanitize, per-line clamp re-applied, 800/400-char consumer caps.
- Boundary: digest reaches ONLY `agents/planner.py` (classifier) + `agents/sparky.py` (prose).
- `GET /memory/self` / `POST /memory/clear` wire shapes.
