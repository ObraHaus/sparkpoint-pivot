# Phase 0 research — 043

Two questions had to be answered before the plan could be trusted. The first turned out to have a
much better answer than the obvious one.

## R1 — How does the agent find a wallet's activated brokers?

### The problem

`resolve_tier` needs to answer "does this wallet hold an activated broker?" on every request.
`SparkyBroker` extends **solady's `ERC721`**, which is **not** `ERC721Enumerable`: there is
`balanceOf(owner)` (a count) and `ownerOf(id)`, but **no `tokenOfOwnerByIndex`**. The contract cannot
tell you *which* brokers a wallet holds.

The obvious answers are all bad:

| Option | Why it was rejected |
|---|---|
| Scan all 10,000 ids per request | 10,000 reads per tier lookup. Absurd, and `activationsOf` batching only turns it into a few enormous calls. |
| Index `Transfer` events into Postgres | Needs a migration and a new indexer — and it stores **ownership**, which goes stale exactly when it matters (the moment of a sale). The plan forbids a migration for precisely this reason. |
| `eth_getLogs` per request | A full-history scan on a chain past 100M blocks. Range caps and split-on-error make this slow and fragile even cached. |
| Have the client name the broker id | Safe (the server still verifies `ownerOf`), but `resolve_tier` runs server-side on every chat turn with no client hint available. |

### The answer: the product rule already collapses the search space

**A wallet can only hold an activated broker if that same wallet activated it.**

Proof, from the deployed contract:

- To hold a broker you must have received it by **mint** or by **transfer**.
- `mint`/`mintBatch` never set `activatedAt` — a fresh broker is unactivated (verified live: tokens
  1–3 minted, all unactivated until explicitly activated).
- `_afterTokenTransfer` clears `activatedAt` on every real transfer — `from != 0 && to != 0` — which
  is every path including marketplace operator fills. Proven on-chain: #2 was activated, transferred,
  and came out cleared.

So there is no sequence of on-chain events that leaves wallet W holding an activated broker W did not
activate **after** last acquiring it. The rule that makes the product also makes the lookup cheap.

### Therefore

`BrokerActivationRegistry` records what it did: `activationsBy(address) → uint256[]`, appended on
each successful `activate`. That list is a **complete candidate set** — a superset of the wallet's
currently-activated brokers, and never a subset.

The gate then verifies each candidate against live chain state:

```
qualifies(W) = ∃ id ∈ registry.activationsBy(W) :
                 broker.ownerOf(id) == W  ∧  broker.activatedAt(id) != 0
```

- The registry list is a **hint**, never the authority. `ownerOf` + `activatedAt` are read live, so a
  sold broker stops qualifying immediately regardless of what the list still says.
- A stale hint can only produce a false **negative**… and it cannot even do that, per the proof above.
- Most wallets will have exactly one entry. Two batched reads answer the question.
- No migration, no indexer, no enumeration, no stored entitlement.

**⚠️ The one deployment discipline this creates**: if `activator` is ever re-pointed at a *different*
registry, activations split across two records and the gate must read both, or it under-reports. Any
future registry MUST either be given the old one's list or read through to it. This belongs in
`MIGRATIONS.md` at the moment `setActivator` is called, not in a code comment nobody re-reads.

**Rejected refinement**: deleting a wallet's entry when its broker is transferred. The registry
cannot observe a transfer (it is not the NFT), and adding a hook would mean a second path touching
activation — which the collection repo's rules forbid outright. The list is allowed to grow stale
because staleness in a *candidate set* is harmless when the verdict is read live.

## R2 — What happens on mainnet, and what does that change here?

Nothing in this feature, which is the useful finding.

The same-chain registry needs SRK on the broker's chain. That is true on testnet (deployed in phase
1) and **undecided** on mainnet — it needs canonical or bridged SRK on Robinhood Chain, which is a
token decision, not an engineering one.

If that answer is "no", the fallback is **attested activation**: verify a settled `Transfer` from
chain alone — exactly what `chain/payment_verifier.py` already does for Premium — then call
`activate()` with a backend key. Its costs are real and are the reason it is the fallback:

- the activator becomes a **hot key**, which this design currently does not have at all;
- a burn that lands while the backend is down leaves a holder **paid but not activated**, so it
  requires an explicit, holder-triggerable repair path — not a manual fix-up.

That is a **different spec**, not a flag on this one. Deciding it later costs nothing, because the
`activator` role is a single owner call: whichever contract wins, `setActivator` points at it.

## R3 — Confirmed rather than assumed

Checked live on 46630 while writing this, so the plan does not rest on the handover's summary:

- `SparkyBroker` at `0x15D269B1…47f2`: `minter` = `0x0`, `activator` = `0x0`, `totalMinted` = 3,
  `provenanceHash` matches `art/frozen.json`, `baseURIFrozen` = false, ERC-2981 returns zero.
- `SparkPointTestToken` at `0x4538B536…9B04`: `mint(address,uint256)` and `owner()` both **revert** —
  the no-mint/no-owner property holds on this deployment, so a dead-address transfer really is the
  only way to retire SRK here.
- `activatedAt` is a **block number**, and on this chain it is **not addressable** as an RPC block
  height (`block.number` 11,479,841 vs `eth_blockNumber` 100,519,695). Any surface showing an
  activation date must tolerate its absence — already handled in the metadata service, and the reason
  spec FR/edge-cases call it out. See the collection repo's `MIGRATIONS.md` for the full account.
