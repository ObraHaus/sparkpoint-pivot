# Feature Specification: Weighted revenue share for activated Sparky Broker holders

**Feature Branch**: `044-broker-revenue-share`

**Created**: 2026-08-14

**Status**: Draft

**Input**: "We forgot revenue share." Activation tiers (043c) already record a payout weight —
1.0× / 2.0× / 3.3× — and nothing pays out. This is the mechanism they point at.

## ⚠️⚠️ Read this before anything else: the pot is currently empty

Every figure in the interactive prototype assumed **$12,300 of monthly fee revenue** across **1,000**
brokers, producing "**+$14.00/month**" per holder. Neither number survives contact with the database.

**All protocol fee revenue ever recorded, queried 2026-08-14:**

| network | token | events | total |
|---|---|---|---|
| Base Sepolia | test USDC (6dp) | 5 | **2.18072500** |
| Robinhood testnet | test USDC (18dp) | 3 | **0.00178784** |

Eight swap-fee events, over a two-week window in July, in **testnet tokens with no market value**.
And the collection is **10,000** brokers (confirmed with the operator), not 1,000 — so even a real
pot divides ten times further than the prototype assumed.

This does not make the feature wrong. The plumbing has to exist before revenue can flow through it,
and building it now means it is ready and audited when there is something to distribute. But it
forces three hard rules on everything below, and they are requirements, not preferences:

1. **Never display a projected, illustrative or per-month figure.** The only number a holder may see
   is what is actually claimable, read from the chain. If that is zero, the screen says zero.
2. **No "earn"/"income"/"yield" framing anywhere.** A weight is a share of whatever arrives. Today
   what arrives is nothing.
3. **The feature must be honest when empty.** An epoch with no revenue is a normal state that reads
   as "nothing was distributed this period", not as an error and not as a coming-soon teaser.

## Context — what already exists

| | |
|---|---|
| Tier weights | `BrokerActivationRegistry` `0xf08116…a88E` — `weightOf(tokenId)` returns 10000 / 20000 / 33000 bps, and **0 the instant the broker is transferred** |
| Fee collection | 2-of-3 Safe `0xCB13…578f` on both chains; the vault's `feeRecipient()` and the 0.20% swap fee both land there |
| Fee indexing | `data/swap_fee_indexer.py` → `swap_fee_events`; `api/admin_revenue.py` already reports it |
| The rule that makes it work | transfer clears activation ⇒ **whoever holds an activated broker is the wallet that activated it** |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A holder claims their share of a closed period (Priority: P1)

A wallet holding an activated broker sees what a closed period allocated to it, and claims it.

**Why this priority**: It is the feature. Everything else is arrangement.

**Independent Test**: Fund a distributor for one epoch, publish the allocation, claim from a holder
wallet, and confirm the balance moved and the claim cannot be repeated.

**Acceptance Scenarios**:

1. **Given** a closed period allocated an amount to broker #N, **When** its holder claims, **Then**
   they receive exactly that amount and the claim is marked used.
2. **Given** they claim again, **When** the transaction is submitted, **Then** it reverts and no
   funds move.
3. **Given** a wallet that holds no activated broker, **When** it attempts to claim, **Then** it
   reverts.
4. **Given** a period allocated **nothing** (no revenue arrived), **When** a holder opens the
   screen, **Then** it says nothing was distributed for that period — not an error, not "soon".
5. **Given** a holder sells their broker **after** a period closed but **before** claiming, **Then**
   the claim still belongs to the wallet the period was closed against. A closed period is a fact
   about the past; selling does not retroactively move it.

---

### User Story 2 — Weights decide the split, and only activated brokers count (Priority: P1)

**Why this priority**: A split that is wrong is worse than no split — it is a visible, on-chain
unfairness with someone else's money.

**Acceptance Scenarios**:

1. **Given** brokers activated at Analyst, Associate and Partner, **When** a period closes, **Then**
   their allocations are in the ratio **1.0 : 2.0 : 3.3**.
2. **Given** an unactivated broker, **When** a period closes, **Then** it is allocated **nothing**.
3. **Given** a broker transferred before the period closed, **Then** it is allocated nothing — its
   activation was cleared by the transfer.
4. **Given** the sum of every allocation, **Then** it is **less than or equal to** the amount
   funded. The distributor can never owe more than it holds.

---

### User Story 3 — Nobody can take the pot but the holders (Priority: P1)

**Why this priority**: The distributor holds value. Every failure here is someone else's money.

**Acceptance Scenarios**:

1. **Given** any caller including the owner, **When** they attempt to withdraw funds other than by
   claiming an allocation, **Then** there is no function that permits it.
2. **Given** a period whose allocations go unclaimed, **When** the next period is funded, **Then**
   the unclaimed share stays **reserved for its holder** — it is not swept to any SparkPoint address
   and it is not re-allocated to other holders either. ⚠️ Corrected 2026-08-14 after the testnet
   simulation: an earlier wording said the unclaimed remainder became *available to the next period*,
   which the code never did and should not. Re-allocating it would take one holder's earned share
   and hand it to other people. Only the **unallocated** remainder (truncation dust, or a period
   with no activated brokers) raises `available()`.
3. **Given** the owner, **When** they publish an allocation for a period already published, **Then**
   it reverts — a published period is immutable.

---

### Edge Cases

- **A period with revenue but zero activated brokers.** Nothing can be allocated; the funds must
  remain for the next period rather than being stranded or seized.
- **A holder activates mid-period.** They are included only if activated at the moment the period is
  closed. Pro-rating by time is explicitly out of scope — it needs per-block history nothing records.
- **Dust.** Integer division leaves a remainder; it rolls forward, never to an admin address.
- **Two brokers, same wallet.** Allocations are per broker and both are claimable.
- **The fee Safe is multi-token.** Fees arrive as USDC *and* WETH *and* others. A period must be
  denominated in ONE token or the split is meaningless.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A holder MUST be able to claim the amount a closed period allocated to a broker they
  hold, in one transaction they sign.
- **FR-002**: A claim MUST be usable exactly once.
- **FR-003**: Allocations MUST be proportional to `weightBps` at the moment the period closed, and
  MUST be zero for any broker not activated at that moment.
- **FR-004**: The sum of a period's allocations MUST NOT exceed the amount funded for it.
- **FR-005**: There MUST be **no** path by which anyone other than a claimant removes value —
  no withdraw, sweep, rescue or migrate, for the owner or anyone else.
- **FR-006**: Value MUST NOT be transferable to a SparkPoint-controlled address under any
  circumstances. **Unallocated** value (dust, or a period with no activated brokers) MUST remain
  available to subsequent periods. **Published but unclaimed** value MUST stay reserved for its
  holder indefinitely, claimable after later periods have opened — it MUST NOT be re-allocated.
- **FR-007**: A published period MUST be immutable.
- **FR-008**: Every surface MUST show only **actual, on-chain** claimable amounts. It MUST NOT show
  a projection, an illustrative figure, a rate, or a per-month number.
- **FR-009**: An empty period MUST read as "nothing was distributed", not as an error or a promise.
- **FR-010**: The inputs to a period's allocation MUST be published so anyone can recompute it
  independently — the split is a claim about other people's money and must be checkable.
- **FR-011**: A period MUST be denominated in a single token, named on every surface.

### Key Entities

- **Period** (the engineering term is "epoch"; **the UI says period**): a closed window with one
  funded amount in one token, and a published allocation. Immutable once published.
- **Allocation**: what one broker was awarded for one period. Claimable once, by whoever holds that
  broker.
- **Weight**: `weightBps` from the activation registry at close — 10000 / 20000 / 33000, or 0.

## Success Criteria *(mandatory)*

- **SC-001**: A holder claims and receives exactly their allocation; a second attempt reverts. Proven
  on a real chain.
- **SC-002**: Allocations across the three tiers are in the ratio 1.0 : 2.0 : 3.3, asserted by test.
- **SC-003**: The sum of allocations never exceeds the funded amount — a fuzz property.
- **SC-004**: The deployed distributor exposes no function that moves value to a non-claimant.
- **SC-005**: An independent party can recompute a period's allocation from published inputs and get
  the identical result.
- **SC-006**: With the pot empty — today's real state — every surface reads honestly and offers no
  claim.

## Assumptions

- **The pot is funded manually, by the fee-treasury signers.** Automating a sweep from the Safe would
  mean giving something the authority to move the Safe's funds. A 2-of-3 human transfer per period is
  the smaller trust surface, and periods are monthly, not hourly.
- **One token per period**, chosen when the period is funded. USDC is the obvious first.
- **No time-weighting within a period.** Activated-at-close is the rule; anything finer needs
  per-block history that nothing records today.
- **Testnet only.** Mainnet needs the new SRK, final art, and real revenue — none of which exist.

## Out of Scope

- Automating the transfer out of the fee Safe.
- Pro-rating by time held within a period.
- Any change to how fees are *collected* — `swap_fee_events` and the Safe are unchanged.
- Any change to `SparkyBroker`, the sale, or the activation registry.
- Any projected-return surface. There is no oracle for SRK and no forecast anyone could stand behind.
