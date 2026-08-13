# Implementation Plan: Sparky Broker — mint, activation, and NFT-derived Premium

**Branch**: `043-broker-activation-premium` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-broker-activation-premium/spec.md`

## Summary

A holder retires SRK and activates a broker in **one transaction they sign**, and their Premium is
then **derived from the chain on every read** rather than written down anywhere. Two new contracts
(`BrokerActivationRegistry`, `BrokerSale`) become the NFT's `activator` and `minter` — the two roles
deliberately left unset at deploy. One agent-side change makes `resolve_tier` answer
"subscription **OR** activated broker". Four app screens make it legible.

The load-bearing design decision is negative: **nothing writes an NFT-derived entitlement into
`wallet_tier`.** A stored grant outlives the sale that should end it, and the resulting bug — a
stranger keeping the access their broker was sold with — is the one that makes the collection
pointless. Everything below follows from refusing to store it.

## Technical Context

**Language/Version**: Solidity 0.8.24 (contracts, Foundry) · Python 3.12 (agent) · TypeScript 5 /
Next.js App Router (web)

**Primary Dependencies**: OpenZeppelin (ERC-20/721 interfaces, `Ownable2Step`) · viem + wagmi v2
(web) · asyncpg (agent) · the already-deployed `SparkyBroker`, `SparkPointTestToken`, `SrkFaucet`

**Storage**: Postgres — **read-only for this feature's new behaviour.** `wallet_tier` and
`subscriptions` are read as they are today and **no migration is added**. That is a design outcome,
not an oversight: see the Constitution Check.

**Testing**: Foundry unit + fuzz (contracts) · pytest (agent) · node:test (web pure modules) ·
a live-chain verification pass on 46630 (`quickstart.md`)

**Target Platform**: Robinhood Chain testnet 46630 (mainnet 4663 explicitly out of scope)

**Project Type**: Web app + agent service + on-chain contracts (existing four-layer architecture)

**Performance Goals**: The broker half of a tier resolution adds **at most one chain read per wallet
per 60s**, and never blocks a request — a chat turn's tier lookup must not become a chain round-trip.

**Constraints**: The activation transaction is atomic — no failure may leave SRK spent and the broker
unactivated. The registry holds no value between transactions. Tier resolution degrades to the
existing stored answer when the chain is unreadable.

**Scale/Scope**: 10,000 brokers · 2 new contracts · 1 agent module + 1 `resolve_tier` change ·
4 screens · no migration

## Constitution Check

*GATE: must pass before Phase 0. Re-checked after Phase 1 design.*

| Principle | Verdict | Reasoning |
|---|---|---|
| **I / N1 — no admin withdrawal** | ✅ PASS | The registry moves SRK from the holder to a dead address in one call and holds nothing. It has no sweep, rescue, or withdraw path for SRK or brokers. No SparkPoint address can receive retired SRK — that is what makes "retired" true. |
| **I / N2 — withdraw-always** | ✅ PASS | Nothing here touches the vault, deposits, or the exit path. A broker is not a fund position; failing to activate one loses nobody's principal. `/exit` is untouched. |
| **I / N3 — user-owned keys** | ✅ PASS | Every state change is user-signed. **No backend key exists in this design** — that is precisely why the same-chain registry was chosen over attested activation. |
| **I / N4 — scoped automation** | ✅ PASS (N/A) | No session key gains authority here. The registry is not a policy target and is not reachable from any agent-directed path. |
| **I / N5 — non-upgradeable, verifiable** | ✅ PASS | Both contracts are single-purpose and non-upgradeable. `SparkyBroker` ownership stays `Ownable2Step` with `renounceOwnership` reverting. The one mutable parameter is the activation price, hard-capped at deployment (below). |
| **II — AI proposes, policy + user dispose** | ✅ PASS (N/A) | No model output reaches this path. Activation and mint are direct user actions; the agent only *reads* activation state to answer a tier question. |
| **III — provable, not promised** | ✅ **This is the feature.** | The entitlement is reconstructable from chain data alone, because it is never anywhere else. "Derive, never store" is Principle III applied to access rather than to yield. |
| **IV — bounded blast radius** | ✅ PASS | Worst case if the registry is compromised: it cannot mint, cannot move a broker, and cannot take SRK it does not immediately retire. The price is capped so a compromised owner cannot set it arbitrarily high; a holder cannot be charged more than they approved, and the UI reads the live price at signing. Unit **and fuzz** tests before anything mainnet. |
| **V — conservative launch; SRK non-essential** | ✅ PASS | The vault, chat, onboarding and withdrawals work exactly as before for a wallet with no broker. A broker affects the **Premium tier only**. No token-incentive yield, no new strategy, no change to the launch vault. |
| **VI — spec-driven** | ✅ PASS | spec → clarify → plan → tasks, in that order; no implementation before this gate. |
| **VII — simplicity / YAGNI** | ⚠️ PASS **with a named exception** | See below. |

### The one thing worth arguing about (VII)

Two contracts rather than one. A single contract that both mints and activates would be smaller to
read — but it would hold **both** roles, so a flaw in the sale path would reach activation and vice
versa, and the collection's 10,000 cap would sit behind the same surface as its ongoing SRK flow.
They also have different lifetimes: the sale ends when the collection sells out, the registry runs
forever. `clearMinter()` exists so the sale can be retired without touching activation, which is only
meaningful if they are separate addresses. Two single-purpose contracts is the *simpler* system even
though it is more files.

### Explicitly checked against the constitution's Robinhood clause

> "Robinhood testnet (46630) has NO Morpho deployment of any kind — it stays **swap-only with the
> vault path fail-closed**, and MUST NOT be given a mock substitute."

This feature adds **no vault** on 46630 and no mock of one. A broker is a membership NFT, not a yield
position; `offersVault(46630)` stays `false` and the address book's vault fields stay `undefined`.
Nothing here makes 46630 look like it offers a product it does not.

### No migration — stated as a gate, not an omission

This feature adds **zero** SQL migrations. If a reviewer finds one in the diff, the design has been
violated: the only place an NFT-derived entitlement could be persisted is the database, and the whole
feature exists to keep it out of there. `wallet_tier` keeps its current meaning — *purchased or
admin-granted tier* — and gains no NFT-sourced rows.

## Approach

### 1. `BrokerActivationRegistry` (Solidity, new)

The `activator`. One externally callable function:

```
activate(uint256 tokenId)
  ├── require broker.ownerOf(tokenId) == msg.sender   (FR-010; not the owner ⇒ revert)
  ├── require !broker.isActivated(tokenId)            (FR-011; already active ⇒ revert)
  ├── srk.transferFrom(msg.sender, DEAD, price)       (FR-009; retires it, no custody)
  ├── broker.activate(tokenId)                        (FR-008; same transaction)
  └── record tokenId under msg.sender                 (the candidate set — research.md R1)
```

Atomicity is the EVM's, not ours: any revert reverts the SRK move with it, so FR-012 holds by
construction rather than by a compensating path. The ownership check reads the NFT rather than
trusting a caller-supplied address.

**Immutable at construction**: `broker`, `srk`, `DEAD`, `maxPrice`. **Mutable**: `price` only, owner-
settable, rejected above `maxPrice`. `Ownable2Step`. **No** `withdraw`/`sweep`/`rescue` — including
for ETH, which means the contract must not be `payable` anywhere (the `locked-ether` finding the
scanners raised on the NFT is the precedent).

### 2. `BrokerSale` (Solidity, new)

The `minter`. **Free and open** (operator decision): no holder gate, no allowlist, no payment leg —
so no `payable` function and nothing to strand. It enforces an owner-settable per-wallet cap and
defers the 10,000 cap to the NFT, which already owns it; re-implementing a cap is how two caps
disagree. Owner can close the sale; closing MUST NOT be able to touch activation, which is the other
contract's concern entirely.

This is where the feature's hardest unknown went away. The original design gated the mint on the
≥1,000,000 mainnet-SRK holder check — a **cross-chain** assertion (mainnet balance, Robinhood
contract) that no contract can make, only approximate with a signed root, an operator-maintained
allowlist, or UI-only advisory gating. Dropping the gate deletes that whole decision. Adding a price
or an allowlist later is additive and touches nothing else.

### 3. Agent — `resolve_tier` gains a second source

`LimitsStore.resolve_tier` currently runs one SQL query. It becomes:

```
stored  = <today's query, unchanged>
broker  = brokers.qualifies(address)      # chain read, ~60s cache, never awaited on failure
tier    = premium if stored is premium OR broker qualifies else stored
```

- A new `chain/broker_gate.py` mirroring `chain/srk_gate.py`'s shape and its discipline: **every
  failure path returns a non-qualifying result and it never raises** (FR-006). A wallet with no
  qualifying broker and a broken RPC are indistinguishable *to the caller*, but both are safe — the
  unsafe direction would be granting on a failed read, which cannot happen.
- The cache is a small TTL map keyed by address, TTL 60s, holding **the chain's answer**, not a
  derived tier. Storing the tier would recreate the bug in memory instead of in Postgres.
- `resolve_tier` keeps its signature. A new `resolve_tier_source(address)` returns which source
  qualified, for FR-005 and the Premium screen.
- **Finding the wallet's brokers** — `SparkyBroker` is solady ERC-721 and is **not** enumerable, so
  there is no `tokenOfOwnerByIndex`. Resolved in [`research.md` R1](./research.md) by the product
  rule itself: **a wallet can only hold an activated broker if that wallet activated it**, because
  minting never activates and every transfer clears. So the registry's own `activationsBy(wallet)`
  is a complete candidate set, and the gate verifies each candidate with a live `ownerOf` +
  `activatedAt`. Two batched reads, no indexer, no migration, no 10,000-id scan — and the list is
  only ever a hint, never the authority.

### 4. Web — four screens

Mint · your brokers · the activation confirm step · the Premium page naming its source. The confirm
step reuses the existing execution-drawer shape (what leaves, what arrives, which network) rather
than inventing a new gate. Activation state is read per load, never cached into component state as a
flag that could outlive a transfer.

**No anonymous machine surface is added to `apps/web`** (FR-022). Its middleware fail-closes and
allowlists three exact `/api` paths; the metadata service stays in its own repo and its own deploy.

## Project Structure

### Documentation (this feature)

```text
specs/043-broker-activation-premium/
├── spec.md              # done
├── plan.md              # this file
├── research.md          # Phase 0 — the broker-enumeration question, and the mainnet fallback
├── data-model.md        # Phase 1 — deliberately thin: no new persisted entities
├── quickstart.md        # Phase 1 — the live-chain verification pass on 46630
├── contracts/           # Phase 1 — registry + sale interfaces
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code

```text
contracts/
├── src/broker/
│   ├── BrokerActivationRegistry.sol      NEW — the activator
│   └── BrokerSale.sol                    NEW — the minter
├── test/broker/
│   ├── BrokerActivationRegistry.t.sol    NEW — incl. the atomicity fuzz
│   └── BrokerSale.t.sol                  NEW
└── script/
    ├── DeployBrokerRegistry.s.sol        NEW
    └── DeployBrokerSale.s.sol            NEW

services/agent/src/sparkpoint_agent/
├── chain/broker_gate.py                  NEW — mirrors srk_gate.py; never raises
└── db/limits.py                          CHANGED — resolve_tier + resolve_tier_source

apps/web/src/
├── app/(app)/brokers/page.tsx            NEW — mint + your brokers
├── app/(app)/brokers/[id]/activate/…     NEW — the confirm step
├── app/(app)/premium/page.tsx            CHANGED — names the paying source
├── components/brokers/…                  NEW
└── lib/chain/brokers.ts                  NEW — pure leaf helpers (+ tests)

packages/shared/src/
├── addresses/robinhoodTestnet.ts         CHANGED — registry + sale + brokerNft
└── abis/                                 CHANGED — exported ABIs
```

## Build order

Deliberately not the order the screens appear in.

1. **The failing test first.** A wallet with an activated broker resolves premium; it transfers the
   broker; the tier drops. Written and *watched to fail* before `broker_gate.py` exists. The handover
   is explicit about this, and the reason is that a test written after the code tends to assert what
   the code does rather than what the product promises.
2. `broker_gate.py` + `resolve_tier` — makes it pass. **US1 is now shippable on its own**: the three
   brokers already minted on 46630 exercise it end to end with no new contract and no UI.
3. `BrokerActivationRegistry` + tests, then deploy to 46630 and `setActivator`. US2.
4. `BrokerSale` + tests, then deploy and `setMinter`. US3.
5. The four screens. US4.
6. Live verification per `quickstart.md`, then both changelogs.

Steps 1–2 deliver the feature's whole guarantee before any contract is written, which is the point.

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
|---|---|---|
| Two contracts instead of one | Different lifetimes, different roles, separate blast radii; `clearMinter()` is only meaningful if the sale is a distinct address | One contract holding both roles couples a flaw in the sale path to activation and to the supply cap |
| A mutable `price` | The mainnet number does not exist yet; an immutable price forces a redeploy to discover it | A constructor-fixed price would be immutable in the wrong direction — capped-mutable bounds the risk while leaving the decision open |
| A 60s cache in the agent | Without it, every chat turn's tier lookup becomes a chain read | No cache is honest but slow; a long cache is fast but re-creates the "premium outlives the sale" window it exists to close |

## Open, and owned by the operator

Recorded here so the plan does not silently absorb them:

- **Mainnet mint terms** — free and open on testnet; mainnet terms are the operator's, later.
- **Royalties** — ERC-2981 reports zero. An owner action, never discussed. Settable post-deploy, so
  not a deploy gate — but a marketplace reads it once and caches, so decide before listing.
- **Canonical vs bridged SRK on Robinhood mainnet** — a **new** SRK contract either way, so nothing
  about today's token constrains this design. Two inputs given to the operator for its deployment:
  give it a real `burn`; and note a *bridged* representation burns the wrapper while canonical supply
  stays locked in the bridge, so "burned" is only literally true for a canonical deployment.
- ⚠️ **The mainnet DEPLOY is gated on final art**, not the mint. The provenance hash is a constructor
  argument and immutable from that moment; deploying against placeholder art would publish a
  commitment to images that will not exist. Swapping art before then is fully supported — change the
  generator, watch `verify_frozen.py` fail, bump `art/frozen.json` in the same commit.
