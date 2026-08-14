# Phase 1 data model — 043

**This document is short on purpose. The absence of persisted state is the feature.**

## New database tables

**None. Zero migrations.**

This is a gate, not an omission. The only place an NFT-derived entitlement could be persisted is
Postgres, and the entire feature exists to keep it out of there — a stored grant outlives the sale
that should end it, and the bug surfaces as a stranger keeping the access their broker was sold with.

**If a reviewer finds a migration in this feature's diff, the design has been violated.**

## Existing tables — read only, meaning unchanged

| Table | How this feature uses it | What must NOT happen |
|---|---|---|
| `wallet_tier` | Read by `resolve_tier` exactly as today: purchased or admin-granted tier, with `expires_at`. | **No NFT-derived row may ever be written here**, under any `source` value. Not `'broker'`, not `'nft'`, not a long expiry standing in for "no expiry". |
| `subscriptions` | Untouched. The paid path keeps working as-is. | No broker-sourced subscription row. |
| `payments` | Untouched. | An activation is not a payment record — it is on-chain and needs no mirror. |

## On-chain state (the real data model)

| Where | What | Authority |
|---|---|---|
| `SparkyBroker.activatedAt[id]` | `uint64` block number; `0` = never or cleared | **Authoritative.** The entitlement itself. Cleared by `_afterTokenTransfer` on every real transfer. |
| `SparkyBroker.ownerOf(id)` | current owner | **Authoritative.** |
| `BrokerActivationRegistry.activationsBy(w)` | ids this wallet has activated | **A hint, never the authority.** A complete candidate set (see research R1); may contain ids the wallet no longer owns. Always narrowed by a live `ownerOf` + `activatedAt`. |
| `BrokerActivationRegistry.price()` | current activation price in SRK | Authoritative; read at signing, never hardcoded in the UI. |
| `BrokerSale.mintedBy(w)` | per-wallet allocation used | Authoritative for allocation. The 10,000 cap stays on the NFT — two caps would eventually disagree. |

## In-memory state (agent)

One TTL map, process-local:

```
address → { qualifies: bool, checked_at: float }        TTL 60s
```

- It caches **the chain's answer to a narrow question**, not a tier. Caching a derived tier would
  re-create the bug in memory instead of in Postgres — the difference would be that it disappears on
  restart, not that it is safe.
- Never persisted, never shared between processes, never warmed.
- On a chain-read failure the entry is **not** written, so a transient outage cannot pin a
  non-qualifying answer for 60 seconds.

## Derived values (never stored)

- **A wallet's tier** — a question answered from `wallet_tier` plus a chain read at the moment it is
  asked. It is not an entity, and the moment it becomes one this feature has failed.
- **Which source is paying** — computed alongside the tier, for display. Not stored.
- **The activation date** — resolved from `activatedAt` where the chain allows it, and **omitted**
  where it does not. On Robinhood Chain it does not: `block.number` is not addressable as an RPC
  block height there. No surface may substitute the block number, the string "unknown", or a
  fabricated date.
