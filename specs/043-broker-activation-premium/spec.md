# Feature Specification: Sparky Broker — mint, activation, and NFT-derived Premium

**Feature Branch**: `043-broker-activation-premium`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "A holder can mint a Sparky Broker, activate it by retiring SRK, and get Premium from it. Same-chain activation registry (one transaction takes the SRK and flips activation, no backend key). 'Burn' means transfer to a dead address. Premium is derived from the chain, never stored."

## Context — what already exists

Phases 1 and 2 shipped before this spec and are **live**, not assumptions:

| | |
|---|---|
| Testnet SRK on Robinhood 46630 | `0x4538B536b1da5940deC8e15048Ce07a053699B04` — fixed supply, no mint, no owner |
| `SrkFaucet` on 46630 | `0x39C38c86611FF3679802D5341E830c83DB7F4537` — 5,000 SRK / 24h |
| `SparkyBroker` NFT on 46630 | `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2` — 10,000 cap, `minter`/`activator` **unset** |
| Metadata service | <internal-host> — reads the chain, serves the gold frame |

The NFT contract already owns the state and the product rule. It is **not** in scope to change:

- `activate(uint256)` is callable only by `activator`; `mint`/`mintBatch` only by `minter`. Both
  unset ⇒ fail-closed. This feature supplies the two contracts they will point at.
- `activatedAt[id]` is a **block number** (`uint64`), `0` when never or cleared.
- `_afterTokenTransfer` clears activation on every real transfer, including marketplace fills. This
  was proven on a real chain: activate → transfer → cleared, with other tokens untouched.
- Ownership is `Ownable2Step` and `renounceOwnership` reverts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Premium ends when the broker is sold (Priority: P1)

A holder with an activated broker has Premium. They sell the broker. Their Premium ends, and the
buyer's begins when the buyer retires their own SRK.

**Why this priority**: This is the only story that must be correct for the collection to mean
anything. A holder who sold their broker and kept the access makes the whole product pointless — the
NFT would no longer carry the entitlement, it would merely have introduced it once. Every other
story in this feature is a way of delivering value; this one is the definition of the value.

It is P1 in *build order* too, not just importance: the test that sells an activated broker and
asserts the tier drops is written **before** the code that grants the tier. A test written afterward
tends to assert what the code does.

**Independent Test**: Fully testable with no UI and no mint contract — take a wallet holding an
activated broker, confirm the resolved tier is premium, transfer the broker away, and confirm the
resolved tier returns to free within the cache window. Delivers the guarantee the collection rests on.

**Acceptance Scenarios**:

1. **Given** a wallet holds an activated broker and has no subscription, **When** its tier is
   resolved, **Then** the tier is premium and the source is identified as the broker.
2. **Given** that wallet transfers the broker away, **When** its tier is resolved after the cache
   window, **Then** the tier is free — with **no** trace of a premium grant left behind in stored
   state.
3. **Given** a wallet holds a broker that is **not** activated, **When** its tier is resolved,
   **Then** the tier is free. Holding is not activating.
4. **Given** a wallet has a live paid subscription **and** an activated broker, **When** the
   subscription expires, **Then** the tier stays premium (the broker still qualifies) and the named
   source changes to the broker.
5. **Given** a wallet has a live paid subscription and **no** broker, **When** its tier is resolved,
   **Then** it behaves exactly as it does today — this feature must not alter the existing path.
6. **Given** the chain cannot be read at all, **When** a wallet's tier is resolved, **Then** the
   answer falls back to stored state (subscription only) and the request is never failed on account
   of the broker read.

---

### User Story 2 — Activate a broker in one transaction (Priority: P2)

A holder who owns an unactivated broker retires SRK and gets an activated broker, in a single
transaction they sign themselves.

**Why this priority**: This is the feature's core mechanism and the reason SRK was deployed on
Robinhood Chain in phase 1. It is P2 rather than P1 only because P1 must be provably true first —
activating something whose entitlement can outlive its sale would ship the bug, faster.

**Independent Test**: Testable against the live testnet contracts with no UI: call the registry from
a wallet holding a broker and enough SRK, then read `isActivated` and the dead address's balance.

**Acceptance Scenarios**:

1. **Given** a holder owns broker #N and holds at least the activation price in SRK, **When** they
   activate it, **Then** in one transaction the SRK moves to the dead address and `activatedAt[N]`
   becomes non-zero.
2. **Given** the holder does **not** own broker #N, **When** they attempt to activate it, **Then**
   the transaction reverts and **no** SRK moves.
3. **Given** broker #N is already activated, **When** anyone attempts to activate it again, **Then**
   the transaction reverts and no SRK moves.
4. **Given** the holder holds less than the activation price, **When** they attempt to activate,
   **Then** the transaction reverts and no SRK moves.
5. **Given** any activation attempt reverts for any reason, **Then** the holder's SRK balance and
   the broker's activation state are both exactly as they were. There is no state in which SRK has
   left the holder and the broker is not activated.
6. **Given** the holder granted an allowance to the registry, **When** the activation completes,
   **Then** the registry holds **no** SRK, holds **no** broker, and retains **no** unspent allowance
   beyond what the holder chose to leave.

---

### User Story 3 — Mint a broker (Priority: P3)

An eligible wallet mints a broker from the app.

**Why this priority**: Nothing can be activated that was not first minted, so this gates the live
journey — but it is P3 because three brokers already exist on testnet, so stories 1 and 2 are fully
testable without it. It is no longer *blocked*: the mint is free and open, which removed the
cross-chain holder gate that was the feature's hardest unknown.

**Independent Test**: Testable by minting until the per-wallet cap is hit, and confirming both that
cap and the collection's 10,000 cap hold.

**Acceptance Scenarios**:

1. **Given** any wallet, **When** it mints, **Then** it receives a broker and the minted count
   increases by one. There is no eligibility check to fail.
2. **Given** the sale is closed by the owner, **When** a wallet attempts to mint, **Then** the
   transaction reverts.
3. **Given** the collection's 10,000 cap is reached, **When** anyone attempts to mint, **Then** the
   transaction reverts.
4. **Given** a wallet has already minted its allocation, **When** it attempts to mint again,
   **Then** the transaction reverts.
5. **Given** a freshly minted broker, **When** its activation state is read, **Then** it is
   **unactivated** — minting never activates.

---

### User Story 4 — See which source is paying for Premium (Priority: P3)

A holder opens the Premium page and can tell whether their access comes from a subscription or from
an activated broker, and what would end it.

**Why this priority**: The failure mode this prevents is a holder who cannot tell why their access
ended. It is not required for correctness, but it is what makes the correctness legible.

**Independent Test**: Testable by rendering the Premium page for each of the four combinations of
(subscription live / not) × (activated broker / not).

**Acceptance Scenarios**:

1. **Given** Premium comes from an activated broker, **When** the holder opens the Premium page,
   **Then** it names the broker, states there is no expiry date, and says it ends on transfer.
2. **Given** Premium comes from a subscription, **When** they open the page, **Then** it shows the
   expiry date exactly as it does today.
3. **Given** both are live, **When** they open the page, **Then** the page says which one is
   currently the reason for access and does not imply the other is inactive.
4. **Given** neither is live, **When** they open the page, **Then** both routes are offered.

---

### Edge Cases

- **The holder sells the broker while a request is in flight.** The tier answer may be up to one
  cache window stale. That window MUST be short and MUST be stated, and it MUST never be extended by
  writing the answer down.
- **A wallet holds several brokers, one activated.** The wallet qualifies. Selling the activated one
  while keeping the others removes the qualification.
- **A broker is activated, transferred away, and transferred back.** It is unactivated on return —
  the transfer out cleared it. Re-activation costs SRK again. This is the intended product rule, and
  the UI must not describe activation as permanent.
- **The activation price changes between a holder reading it and signing.** The holder must not be
  able to pay more than they agreed to.
- **The chain read is slow rather than failing.** A tier resolution must not hold a request open
  waiting for it.
- **`activatedAt` cannot be resolved to a date on Robinhood Chain.** Already true and already
  handled in the metadata service: the block number is not addressable as an RPC block height on this
  chain, so the date is omitted. Any surface here that shows an activation date MUST tolerate its
  absence, and MUST NOT substitute the block number, "unknown", or a fabricated date.
- **A wallet with an activated broker on a chain the app is not connected to.** The entitlement is a
  fact about the broker's chain, not about the wallet's current connection.

## Clarifications

### Session 2026-08-13

Resolved against the signed-off plan, the operator's locked decisions, and the live contracts. Each
records what was chosen and — where it matters — what would change it.

- **Q: Where does the retired SRK go?** → A dead address (`0x…dEaD`), not the zero address: a
  standard ERC-20 `transfer` to `address(0)` reverts, so the zero address is not available even if it
  were preferred. The registry MUST NOT hold it — tokens sitting in a contract SparkPoint controls
  are treasury, not a retirement, and nobody may describe them as burned.
- **Q: Is the activation price fixed at deploy or settable?** → **Settable by the owner, under a hard
  cap fixed at deployment.** The mainnet number does not exist yet, so an immutable price would force
  a redeploy to discover it; a cap bounds what a compromised or careless owner can charge. This is
  the same shape as `SrkFaucet`'s admin-settable amount, which is already deployed and understood.
  The UI reads the live price at signing (FR-015), so it can never quote a stale one.
- **Q: What is the testnet activation price?** → **1,000 SRK** — deliberately NOT the 10,000 that
  buys a month of Premium, so a tester cannot confuse a permanent, transferable activation with a
  monthly subscription, and low enough that one faucet claim (5,000 SRK / 24h) covers it. Labelled in
  the UI as a testnet placeholder. **The mainnet price is undecided and is not inferable from this.**
- **Q: What are the testnet mint terms?** → Free, capped per wallet, obviously labelled as a testnet
  placeholder. Mainnet price, allocation and timing stay undecided and MUST NOT be invented.
- **Q: How fresh must the broker half of the tier answer be?** → Cached about **60 seconds**. Long
  enough that a chat turn does not become a burst of chain reads; short enough that "you sold it and
  briefly kept access" is a minute, not a session. The number MUST be a stated constant, not an
  emergent property of some other cache.
- ~~**Q: Does minting require the SRK holder gate on testnet too?** → Yes.~~ **SUPERSEDED by Session
  2026-08-13b** — the mint is free and open, with no holder gate at all. Left visible rather than
  deleted because the reasoning that replaced it matters: the gate was a cross-chain assertion no
  contract can make, and dropping it was cheaper and more honest than approximating it.
- **Q: Can a broker be re-activated after a transfer clears it?** → Yes, and it costs SRK again. That
  is the product rule, not an edge case. No surface may describe activation as permanent.

### Session 2026-08-13b — operator answers, and what they changed

These supersede the corresponding entries above where they conflict.

- **Q: What does the mint require?** → **Nothing. Free, open mint on testnet**, with a per-wallet cap
  as the only limit. The ≥1,000,000 mainnet-SRK holder gate is **dropped**. This deletes the feature's
  hardest open problem: that gate was a *cross-chain* assertion (mainnet balance, Robinhood contract)
  that no contract can make, and it was the only thing blocking the mint work. A price and an
  allowlist are both additive later.
- **Q: Where do the price and per-wallet cap live — our contract or a launchpad?** → **Our contract.**
  Researched at the operator's request: `anvil.clutch.market` is a permissionless NFT **liquidity**
  protocol (sell NFTs into an AMM vault, borrow/stake against them), not a launchpad — its docs state
  it never calls `mint()` and that minting, allowlists and supply are external concerns. It is a
  useful **post-mint** venue and composes fine with a standard ERC-721. A true launchpad would mean
  granting a third party the `minter` role over all 10,000, which is the one role this collection
  deliberately keeps fail-closed.
- **Q: What does activation cost on testnet?** → **10,000 SRK**, superseding the 1,000 chosen above.
  That earlier choice existed to avoid confusion with the 10,000-SRK monthly Premium — and with the
  subscription being sunset (below) there is nothing left to confuse it with. The parity becomes the
  product story: the same 10,000 SRK that bought one month now buys something permanent and sellable.
- **Q: What happens to the existing SRK Premium subscription?** → **It is sunset in favour of the
  broker.** Verified against the develop database: there is **exactly one** subscriber and it is our
  own test-user wallet `0x32Ed…e8b5` (1 payment, 1 subscription). No real tester loses access.
  ⚠️ **The sunset is an operational step, not a code branch** — see FR-004a. And it happens **after**
  mint and activation are live, so there is never a window in which Premium has no path at all.
- **Q: Mainnet SRK?** → A **new** SRK contract, not the one deployed on Ethereum today; canonical-on-
  Robinhood vs Ethereum-plus-bridge is still undecided. Mainnet stays out of scope. Two inputs were
  passed back to the operator for whoever deploys it: **give it a real `burn`** (free now, impossible
  later), and note that a *bridged* representation burns the wrapper while canonical supply stays
  locked in the bridge — so "burned" is only literally true for a canonical deployment.
- **Q: The art?** → The generator's output is a **placeholder**; the client's official art is still
  being made and will be swapped in. Fine on testnet. ⚠️ On mainnet the provenance hash is a
  constructor argument and immutable, so **the mainnet deploy must not happen until the art is
  final** — otherwise the hash attests to art that no longer exists, and it is the one property of
  this collection anyone can independently check. Swapping before then is a supported operation:
  change the generator, watch `verify_frozen.py` fail, bump `art/frozen.json` in the same commit.
  `freezeBaseURI()` stays uncalled until the art is final.

## Requirements *(mandatory)*

### Functional Requirements

**Premium resolution**

- **FR-001**: The system MUST resolve a wallet's tier as premium when **either** a live subscription
  **or** an activated broker held by that wallet qualifies it.
- **FR-002**: The system MUST NOT write an NFT-derived entitlement into stored tier state. The
  broker half of the answer MUST be derived on read, every time.
- **FR-003**: The system MUST re-derive the broker half at most one short cache window behind the
  chain, and that window MUST be measured in seconds, not hours.
- **FR-004**: The system MUST leave the existing subscription path — payment verification, the
  subscription record, and stored expiry — working unchanged **in code**. `resolve_tier` stays
  "stored tier OR activated broker", which after the sunset degenerates to "admin grant OR broker" —
  correct, and with no new branching.
- **FR-004a**: The subscription sunset MUST be an **operational** step, not a code branch: retire the
  `/premium/pay` purchase surface and revoke the `srk`-sourced `wallet_tier` rows. Admin and
  `env-seed` grants MUST keep working — they share the same table and are not subscriptions. It MUST
  happen only after mint and activation are live and verified.
- **FR-005**: The system MUST report **which** source qualifies a wallet, so a surface can name it.
- **FR-006**: When the broker read is unavailable, the system MUST fall back to the stored
  subscription answer and MUST NOT fail the request, and MUST NOT report "no premium" as though it
  were a determination.
- **FR-007**: An unactivated broker MUST NOT qualify a wallet for premium.

**Activation**

- **FR-008**: A holder MUST be able to retire SRK and activate a broker they own in a single
  transaction that they sign.
- **FR-009**: The retired SRK MUST leave circulation to an address nobody controls, and the system
  MUST NOT describe this as reducing supply.
- **FR-010**: Activation MUST be rejected unless the caller owns the broker being activated.
- **FR-011**: Activation MUST be rejected for an already-activated broker.
- **FR-012**: The activation path MUST NOT be able to leave a holder having paid SRK without an
  activated broker, under any failure.
- **FR-013**: The activation contract MUST NOT hold a broker, MUST NOT hold retired SRK, and MUST
  NOT take an approval it does not spend within the same transaction.
- **FR-014**: The holder MUST be shown, before signing, what leaves their wallet, what they get, what
  ends it, and on which network.
- **FR-015**: The activation price MUST be read from the chain at the point of signing, never
  hardcoded in the interface.

**Mint**

- **FR-016**: Minting MUST be **free and open** — no holder gate, no allowlist. The per-wallet cap is
  the only restriction. (Superseded the SRK holder gate; see Session 2026-08-13b.)
- **FR-017**: Minting MUST respect the collection's 10,000 cap and an owner-settable per-wallet cap.
  The 10,000 cap stays enforced by the NFT — two caps eventually disagree.
- **FR-018**: A minted broker MUST be unactivated.
- **FR-019**: The mint interface MUST NOT display an invented price, allocation, or date. Where a
  term is undecided it MUST say so.

**Surfaces**

- **FR-020**: A holder MUST be able to see the brokers they own and each one's activation state,
  read from the chain rather than from a stored flag.
- **FR-021**: Every surface MUST use the word **retired** rather than "burned" wherever the word
  would read as a claim about supply.
- **FR-022**: Anonymous machine traffic MUST NOT be served from the app. The metadata service stays
  in its own repo and its own deploy.

### Key Entities

- **Broker**: one of 10,000 NFTs. Has an owner and an activation state. The activation state is
  cleared by any transfer. It is the entitlement; nothing mirrors it.
- **Activation**: the event of retiring SRK against a specific broker. Recorded on the NFT as the
  block it happened in. Not a record this feature owns or duplicates.
- **Premium entitlement**: not an entity. It is a question answered from a subscription record and a
  chain read at the moment it is asked. Making it an entity is the bug this feature exists to avoid.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A wallet that transfers away its only activated broker loses premium within one cache
  window, verified end to end against a real chain, with no manual step and no stored row to clean up.
- **SC-002**: 100% of activation attempts either complete fully (SRK retired **and** broker
  activated) or change nothing. Zero partial outcomes across the tested failure set: not the owner,
  already activated, insufficient balance, insufficient allowance.
- **SC-003**: After any activation, the activation contract holds zero SRK and zero brokers.
- **SC-004**: A holder can tell, from the Premium page alone, which source is paying for their access
  and what would end it, in all four source combinations.
- **SC-005**: The existing subscription purchase path continues to pass its current tests unchanged.
- **SC-006**: The activation loop is demonstrated on a real chain, not only in tests — mint,
  activate, observe the gold frame, transfer, observe it clear.
- **SC-007**: No surface presents an activation date it cannot resolve, and none presents a mint
  price, allocation, or date that has not been decided.

## Assumptions

- **The mint is free and open on testnet**, per the operator, with a per-wallet cap as the only
  limit. A price and an allowlist are additive and can be added without redeploying anything else.
- **Royalties remain unset.** ERC-2981 is wired and reports zero. Setting it is an owner action, not
  a code change, and it was never discussed.
- **Mainnet is out of scope for this feature.** The registry is same-chain, and a mainnet registry
  needs canonical or bridged SRK on Robinhood Chain — a token decision the operator owns. Testnet is
  unaffected and complete without it.
- **If that decision comes back "no"**, the fallback is attested activation: verify a settled
  transfer from chain alone, exactly as the existing payment verifier does, then activate with a
  backend key — **plus an explicit repair path**, because by then the holder has already paid. That
  fallback is a different spec, not a variation of this one, and its cost (a hot key, and a window
  where a holder has paid but is not activated) is the reason it is the fallback.
- **Mainnet will use a NEW SRK contract**, not the one on Ethereum today, so nothing about the
  current token constrains this design. Testnet SRK demonstrably has no `burn` (selector absent from
  the deployed bytecode), so testnet retires to a dead address.
- **The current art is a placeholder.** The client's official art is still being made and will be
  swapped in. This does not block testnet at all. It **does** block the mainnet **deploy** — not the
  mint — because the provenance hash is a constructor argument and immutable from that moment.
- Holders reaching these surfaces have a wallet session, so the in-app screens are not anonymous
  machine traffic.

## Out of Scope

- Changing `SparkyBroker.sol`. It is deployed, its rule is proven on-chain, and nothing here needs it
  to change.
- A second path that clears activation. `_afterTokenTransfer` is the only one, deliberately.
- Revenue-payout weighting. Activation is described as carrying one, but computing or paying it is
  not this feature.
- Mainnet deployment of anything.
- Any change to how the vault, chat, onboarding or withdrawals work. An activated broker affects the
  Premium tier and nothing else; SRK remains non-essential to core vault function.
