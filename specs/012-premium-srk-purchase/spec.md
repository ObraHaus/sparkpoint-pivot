# Feature Specification: Premium Purchase via SRK

**Feature Branch**: `feature/012-premium-srk-purchase`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Purchase the Premium membership tier by paying a SparkPoint test SRK token on Base Sepolia; the agent verifies the on-chain payment and grants a time-boxed premium subscription."

Feature 008 built the tier engine — a per-wallet **free** / **premium** limits-and-priority system where premium is granted by an operator and enforced only on the three advisory-compute routes (chat, recommendations, onboarding). It deliberately left *how premium is paid for* to a later increment. This feature is that increment: it lets a user **buy** premium by making a user-signed payment of a SparkPoint **test SRK** token (a fresh OpenZeppelin ERC-20 on Base Sepolia — **not** the old CoinMarketCap-listed SRK) to a disclosed treasury, then has the agent **verify that payment on-chain** — buyer-bound, replay-proof, and finality-gated — before granting a **time-boxed** premium subscription that auto-expires back to free. Nothing here changes custody: the payment is a plain transfer the user signs from their own key, the premium/expiry check sits only on the advisory-compute routes it already governs in 008, and the vault — deposits, yield, swaps, and the withdraw-always exit — works fully without SRK or premium. Per the constitution, this is exactly the "later increment that flips the 008 engine on," and **SRK stays non-essential to core vault function**.

## Clarifications

### Session 2026-07-21

Resolved with the operator before authoring (locked decisions):

- **Q: What token pays for premium, and on which network?** → **A: A fresh SparkPoint test SRK ERC-20 on Base Sepolia (84532) only.** A new OpenZeppelin `ERC20` (`SparkPoint Test Token`, symbol `SRK`, 18 decimals), all supply minted to the deployer, no public faucet mint. Deliberately not the old listed SRK. Premium is Base-Sepolia-only for this increment; there is no SRK on Base mainnet (8453) or Robinhood (46630).
- **Q: What is the price, and is it a dollar price?** → **A: A flat 500 SRK per month, compared in SRK base units.** There is **no USD oracle** for SRK — the verifier compares `value >= PREMIUM_PRICE_SRK` in token base units, never dollars. The web mock's "≈ $12.00" is an illustrative peg only and must be labelled as such or dropped.
- **Q: Does the agent trust the client's claim of who paid?** → **A: No.** The buyer is always the server-scoped `account.owner` (the SIWE-verified owner EOA behind the S2S bearer), never a field in the request body. Verification asserts the on-chain `from` equals that owner.
- **Q: What stops a payment being replayed or claimed twice?** → **A: A global `UNIQUE(network_id, tx_hash)` on the payments ledger.** The BFF `Idempotency-Key` cache dedupes identical retries only; it is **not** the anti-replay control. One payment can never grant two wallets or grant twice.
- **Q: How does a shallow / unconfirmed / pending transaction behave?** → **A: Finality-gated.** A grant requires `head − blockNumber ≥ PREMIUM_MIN_CONFIRMATIONS`. A not-yet-mined tx returns a **retryable pending** (not a grant, not a hard failure); a reverted or under-confirmed tx never grants.
- **Q: How does expiry resolve, and how do renewals behave?** → **A: Lazy, on the hot path.** Premium carries an `expires_at`; tier resolution treats a lapsed row as absent (resolves to free) with no sweeper. A renewal **extends**: `expires_at = max(now, current_expiry) + 1 month`.
- **Q: Where does the money land?** → **A: A disclosed `premiumTreasury`.** It should be the feature-014 fee Safe if that exists at build time; otherwise the deployer EOA with a recorded cutover note. Either way the recipient is disclosed on the pay surface (Principle III).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A user pays SRK and becomes premium for a month (Priority: P1) 🎯 MVP

A signed-in user on Base Sepolia opens the Premium surface, sees their real SRK balance and the flat monthly price, and — if they hold enough SRK — signs a payment to the disclosed treasury from their own wallet. Once that payment settles on-chain and the agent verifies it, the user is premium for one month: their very next assistant turn is metered against the premium allowances and served at premium priority. They never hand SRK or keys to SparkPoint; they sign a plain transfer, and the entitlement follows.

**Why this priority**: This is the whole feature and the first time premium can be *bought* rather than operator-granted — it turns the 008 engine into a revenue stream. It is a viable MVP on its own: a user pays, the agent verifies, premium is granted for a month. Everything else (finality hardening depth, expiry/renewal polish, the live pay surface) refines this path.

**Independent Test**: With SRK deployed on Base Sepolia and a wallet holding ≥ the monthly price, drive the pay flow end-to-end (approve if needed → transfer → submit the tx hash to the agent); confirm the wallet resolves to premium on its next chat turn (premium caps + priority + model alias), and that the grant carries a one-month expiry.

**Acceptance Scenarios**:

1. **Given** a wallet holding at least the monthly SRK price, **When** it signs the SRK payment to the disclosed treasury and submits the resulting tx hash, **Then** the agent verifies the payment and the wallet is granted premium with an expiry one month out.
2. **Given** a wallet that has just been granted premium, **When** it sends its next assistant message, **Then** it is metered against the premium allowances and served at premium priority — with no re-authentication.
3. **Given** a wallet whose SRK balance is below the price, **When** it opens the pay surface, **Then** it sees an honest "insufficient SRK" state (how much more is needed) and the sign action is unavailable — no payment is attempted.
4. **Given** a successful purchase, **When** the grant is written, **Then** an append-only audit record captures the buyer, the payment tx hash, the amount, and the new expiry.

---

### User Story 2 - The payment is verified on-chain, server-side, before any grant (Priority: P1)

Before premium is ever granted, the agent independently confirms the payment on-chain from the transaction receipt: the transaction succeeded, it is buried under enough confirmations to be final, it moved **at least** the required SRK to **the** treasury, and it came **from the buyer's own wallet** (the server-scoped owner) — not from someone else's payment the caller is trying to claim. The same payment can never be used twice.

**Why this priority**: This is the trust boundary of the whole feature. A grant that trusted a client claim, ignored finality, or failed to bind the payer to the buyer would be a free-premium exploit (replay another wallet's payment; reorg a shallow tx out; under-pay). It is P1 alongside US1 because US1 is not safe to ship without it. It stays independently testable against the verifier alone.

**Independent Test**: Feed the verifier a matrix of transaction receipts — a valid full-price payment from the owner, one from a *different* sender, an under-price one, a reverted one, an unconfirmed/shallow one, a wrong-recipient one, and a duplicate of an already-granted hash — and confirm only the valid, sufficiently-confirmed, owner-originated, correct-recipient, full-amount, not-yet-seen payment yields a grant; every other case is refused or returned as retryable-pending, with no grant.

**Acceptance Scenarios**:

1. **Given** a submitted tx hash, **When** the agent verifies it, **Then** it derives the buyer from the server-scoped owner (never the request body) and requires the on-chain `from` to equal that owner.
2. **Given** a payment transaction, **When** it is verified, **Then** the agent requires the receipt status to be success, the confirmations to meet the minimum, the token to be SRK, the recipient to be the treasury, and the value to be at least the price — in SRK base units — before any grant.
3. **Given** a transaction that is not yet mined or is under the confirmation minimum, **When** it is submitted, **Then** the agent returns a retryable "pending confirmation" result — neither a grant nor a hard failure — so the client can poll.
4. **Given** a tx hash that has already granted a subscription, **When** the same hash is submitted again (by the same or a different wallet), **Then** the payments ledger's uniqueness rejects it and no second grant occurs.
5. **Given** a reverted, under-priced, wrong-recipient, or wrong-token transaction, **When** it is verified, **Then** it is refused with a clear reason and nothing is granted.

---

### User Story 3 - Premium auto-expires to free, and renewals extend (Priority: P2)

A purchased membership lasts one month and then quietly lapses back to free — the next assistant turn after expiry is metered against the free allowances again, with no sweeper job and no stuck "premium" state. If the user pays again, the new period **extends** their membership rather than resetting it: paying before expiry adds a month to the remaining time; paying after a lapse starts a fresh month from now.

**Why this priority**: A time-boxed subscription that never expires is not a subscription, and one that resets on early renewal quietly steals paid time. Correct expiry and extending-renewal are what make it a real recurring product. P2 because US1+US2 deliver the purchase-and-grant value first; this governs its lifetime.

**Independent Test**: Grant a subscription with a near-past expiry and confirm the wallet resolves to free on its next turn (no sweeper run); grant one with a future expiry and confirm premium; then submit a second valid payment and confirm the expiry becomes `max(now, current_expiry) + 1 month` (extends, not resets) in both the still-active and already-lapsed cases.

**Acceptance Scenarios**:

1. **Given** a wallet whose premium `expires_at` is in the past, **When** it sends its next assistant message, **Then** it is metered as free — resolved on the hot path with no background job required.
2. **Given** a wallet whose premium `expires_at` is in the future, **When** it sends a message, **Then** it is metered as premium.
3. **Given** an active premium wallet, **When** it makes a second valid payment, **Then** its expiry becomes its current expiry plus one month (paid time is added, never truncated).
4. **Given** a lapsed wallet, **When** it makes a valid payment, **Then** its expiry becomes one month from now.
5. **Given** any admin (non-purchased) premium grant, **When** it is resolved, **Then** a null expiry means non-expiring — an operator grant is never auto-lapsed by this feature.

---

### User Story 4 - The whole flow is non-custodial and never gates withdraw (Priority: P2) 🛡️

Buying premium never puts SparkPoint in control of any funds and never stands between a user and their money. SRK is moved only by a transfer the user signs from their own key to a recipient disclosed on screen; SparkPoint never holds the user's SRK or keys and never sweeps user funds. The premium/expiry check exists only on the advisory-compute routes it governs in 008 — it is never attached to a withdrawal, exit, vault redeem, or any funds-movement path, so a user can always exit regardless of premium status, price, or a verification outage.

**Why this priority**: Non-custody is constitutional law (Principle I, N1–N5). A payment feature is exactly where a custody violation could sneak in — a "pay to keep access" gate on withdraw, or a custodied sweep of user funds. This story makes the invariants explicit and testable. P2 because it is a guarantee over the P1 mechanism, not a separate user journey.

**Independent Test**: With the premium/expiry code live, assert (a) the SRK movement is a user-signed transfer to a disclosed address with no SparkPoint-signed leg and no approval to a SparkPoint contract that could pull funds; and (b) a custody-untouched test proving no premium, subscription, or expiry check sits on any withdraw / redeem / exit path — a free, lapsed, or verification-erroring wallet withdraws exactly as a premium one does.

**Acceptance Scenarios**:

1. **Given** a premium purchase, **When** SRK moves, **Then** it moves only via a transfer the user signs from their own wallet to the on-screen disclosed treasury — SparkPoint signs nothing and holds neither the SRK nor the keys (N1, N3).
2. **Given** any wallet in any premium state (free, premium, lapsed, verification-erroring), **When** it withdraws, redeems, or exits the vault, **Then** the action proceeds unaffected — no premium, subscription, expiry, or price check ever touches it (N2).
3. **Given** the treasury recipient, **When** it is shown, **Then** the exact on-chain recipient address is disclosed and verifiable (Principle III) — no hidden or SparkPoint-custodied intermediary.
4. **Given** the premium treasury is (or later becomes) a multisig, **When** it holds fee/payment funds, **Then** it gains no fund-movement authority over user funds — it is a plain recipient, not a privileged party (N5).

---

### User Story 5 - The pay surfaces show real SRK balance and price and route through a real confirm gate (Priority: P3)

The Premium and pay screens stop showing invented numbers. The pay screen reads the user's live SRK balance and the real monthly price, computes whether an approval is needed, and — instead of a placeholder — routes "Review & sign" through a real confirm gate that builds the actual approve-and-pay transaction, runs a fail-closed pre-sign check, and only reveals the sign action once that check passes. Success is shown only after a real on-chain confirmation.

**Why this priority**: The pay surface today hard-codes a balance and price and lands "Review & sign" on a placeholder that never builds a transaction — it looks live but is a mock. Making it read real chain data and sign through the real gate is what a user actually touches. P3 because the engine (US1–US4) delivers and secures the value first; this is the honest front door onto it.

**Independent Test**: On the pay screen with SRK deployed, confirm the displayed balance equals the on-chain `balanceOf` and the price is the configured value (not a literal); confirm "Review & sign" opens a confirm gate that shows the approve-and-pay legs, blocks the sign button until the pre-sign check passes, and only shows success after a real receipt — and that an unset SRK address renders an honest "unavailable" state rather than a fabricated balance.

**Acceptance Scenarios**:

1. **Given** SRK is deployed and the wallet is connected, **When** the pay screen loads, **Then** the SRK balance shown equals the live on-chain balance and the price shown is the configured monthly price (no hard-coded 320/500).
2. **Given** the current SRK allowance to the treasury is below the price, **When** the user proceeds, **Then** the flow presents an approve leg before the pay leg; if allowance already covers the price, only the pay leg is presented.
3. **Given** the user opens the confirm gate, **When** the fail-closed pre-sign check has not passed, **Then** the sign action is not offered; it appears only once the check is green, and success renders only after a real on-chain confirmation.
4. **Given** SRK is not deployed / not configured on the active chain, **When** the pay screen loads, **Then** it shows an honest "unavailable" state and offers no sign action — never a fabricated balance or price.

---

### Edge Cases

- **Buyer mismatch**: a tx whose on-chain `from` is not the server-scoped owner is refused — a caller can never claim another wallet's payment.
- **Replay / double-claim**: the same tx hash (resubmitted by the same or a different wallet) is rejected by the payments ledger uniqueness — one payment, at most one grant.
- **Reorg / shallow confirmation**: a receipt that is successful but under the confirmation minimum is treated as pending (retryable), not granted, so a payment that later reorgs out never yields lasting premium.
- **Pending / not-yet-mined**: an unknown or un-mined tx hash returns retryable-pending, distinct from a hard "invalid payment" failure, so the client polls instead of erroring.
- **Under-payment / over-payment**: value below the price is refused; value at or above the price is accepted (an over-payment grants exactly one month — no proportional crediting in this increment).
- **Wrong token / wrong recipient**: a Transfer of a different token, or to any address other than the treasury, is not counted — the verifier matches on both the SRK address and the treasury.
- **Native-ETH gap**: SRK is an ERC-20; a payment attempted in native ETH emits no ERC-20 Transfer log and is simply not verifiable — the flow only ever signs an SRK transfer.
- **RPC outage**: an upstream RPC failure during verification degrades to a retryable "temporarily unavailable," never a grant and never a false "invalid."
- **Renewal timing**: paying while still active adds a month to the remaining time; paying after a lapse starts a fresh month — never a reset that truncates paid time.
- **Admin grant coexistence**: an operator (008) grant with a null expiry is non-expiring and is never lapsed by this feature; a purchased grant and an admin grant on the same wallet resolve to the same premium tier without conflict.
- **Wrong chain**: SRK exists only on Base Sepolia; on any other chain the pay surface shows "unavailable" and the verifier is pinned to the SRK chain and fails closed elsewhere.
- **Custody path**: no premium, subscription, expiry, or price check ever applies to a withdrawal, exit, or vault redeem (N2) — always available regardless of premium state.

## Requirements *(mandatory)*

### Functional Requirements

**Token & payment**

- **FR-001**: The system MUST provide a SparkPoint test SRK token — a standard ERC-20 (`SparkPoint Test Token`, symbol `SRK`, 18 decimals) with all supply minted to the deployer and **no** public faucet mint — deployed on Base Sepolia, distinct from any previously listed SRK.
- **FR-002**: A premium purchase MUST move SRK only via a transfer the **user signs from their own key** to a **disclosed** treasury recipient; SparkPoint MUST NOT hold the user's SRK or keys, MUST NOT be a signer on the transfer, and MUST NOT hold an approval that could pull the user's funds beyond the user-authorized payment.
- **FR-003**: The monthly price MUST be a fixed amount of SRK expressed and compared in **SRK base units**; the system MUST NOT depend on a USD/price oracle for SRK, and MUST NOT present a dollar figure as anything other than an explicitly illustrative peg.
- **FR-004**: Premium purchase MUST be scoped to Base Sepolia (the only network where SRK is deployed); on any other network the purchase MUST be unavailable and MUST NOT fabricate a balance, price, or grant.

**On-chain verification**

- **FR-005**: Before any grant, the agent MUST verify the payment **server-side** from the on-chain transaction receipt — it MUST NOT trust a client claim that a payment occurred.
- **FR-006**: The buyer MUST be the server-scoped owner (the SIWE-verified owner EOA behind the S2S bearer); the agent MUST require the on-chain `from` of the SRK transfer to equal that owner, and MUST NEVER take the buyer from the request body.
- **FR-007**: Verification MUST require: receipt status = success; at least `PREMIUM_MIN_CONFIRMATIONS` confirmations (`head − blockNumber ≥ N`); a Transfer log whose token is the SRK address, whose recipient is the treasury, and whose value is **≥** the monthly price in base units.
- **FR-008**: A transaction that is not yet mined, or is mined but under the confirmation minimum, MUST be returned as a **retryable pending** result — neither a grant nor a hard failure — so the client can poll.
- **FR-009**: A reverted, under-priced, wrong-token, wrong-recipient, or wrong-sender transaction MUST be refused with a clear reason and MUST NOT grant.
- **FR-010**: An upstream RPC failure during verification MUST surface as a retryable "temporarily unavailable" outcome, never as a grant and never as a false "invalid payment."

**Anti-replay & idempotency**

- **FR-011**: Each verified payment MUST be recorded in an append-only payments ledger with a **global `UNIQUE(network_id, tx_hash)`** constraint; a tx hash that has already granted MUST be rejected on re-submission (by the same or any other wallet).
- **FR-012**: The BFF idempotency key MUST NOT be relied on as the anti-replay control — the payments-ledger uniqueness is the authoritative guard against double-granting.

**Grant, expiry & renewal**

- **FR-013**: On a verified payment the agent MUST grant the premium tier to the buyer via the existing 008 assignment path using source `srk`, and MUST record the payment and the subscription window (buyer, tier, start, expiry, tx hash, amount) plus an audit entry — in a single transaction.
- **FR-014**: A purchased premium grant MUST carry an `expires_at` set one month out; tier resolution MUST treat a row whose `expires_at` is in the past as absent — resolving the wallet to free on the **hot path** with no sweeper job.
- **FR-015**: A renewal MUST **extend**, not reset: `expires_at = max(now, current_expiry) + 1 month`.
- **FR-016**: An operator (008) admin grant with a **null** `expires_at` MUST be treated as non-expiring and MUST NOT be auto-lapsed by this feature.

**Enforcement boundary (constitutional)**

- **FR-017**: The premium/expiry/subscription/price check MUST sit only on the advisory-compute routes it already governs in 008 (chat, recommendations, onboarding) and MUST NEVER be applied to a withdrawal, exit, vault redeem, or any funds-movement path (N2).
- **FR-018**: SRK and premium MUST remain non-essential — no core capability, and nothing on the vault/custody/withdraw path, may be gated by SRK ownership or premium status; the vault MUST function fully without SRK or premium.
- **FR-019**: If the treasury recipient is a multisig, it MUST gain no fund-movement authority over user funds — it is a plain payment recipient, not a privileged party (N5); the exact recipient MUST be disclosed and verifiable (Principle III).

**Pay & premium surfaces**

- **FR-020**: The pay surface MUST show the user's **real** on-chain SRK balance and the **configured** price (not hard-coded values), and MUST compute whether an approval is required from the live allowance.
- **FR-021**: "Review & sign" MUST route through a real confirm gate that builds the actual approve-and-pay transaction, runs a **fail-closed pre-sign check** (the sign action revealed only once the check passes), and shows success only after a **real** on-chain confirmation; a reverted receipt MUST fail closed.
- **FR-022**: When SRK is not deployed/configured on the active chain, the surfaces MUST show an honest "unavailable" state and offer no sign action — never a fabricated balance, price, or success.

### Key Entities *(include if feature involves data)*

- **SRK Token**: the SparkPoint test ERC-20 (name, symbol `SRK`, 18 decimals, deployer-minted supply), addressed per chain in the shared address book as an optional non-policy field.
- **Premium Treasury**: the disclosed recipient of SRK premium payments (the 014 Safe if present, else the deployer EOA), an optional non-policy address-book field.
- **Payment**: an append-only ledger row for a verified on-chain payment — network, tx hash (globally unique per network), buyer, token, raw amount, block number, verified-at — the anti-replay control.
- **Subscription**: a membership window — wallet, tier, start, expiry, the payment tx hash, and the paid amount — the audit/history source of record.
- **Tier Assignment (extended, from 008)**: the wallet→tier mapping gains a nullable `expires_at`; null means non-expiring (admin grant), a past value resolves to free.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A wallet that makes a valid full-price SRK payment resolves to premium on its **next** assistant turn (premium caps + priority + model alias), with **zero** re-authentication and no operator action.
- **SC-002**: In **100%** of cases, a payment is granted only if it is successful, from the buyer's own wallet, to the treasury, in SRK, at or above the price, and buried under at least the configured confirmations — every other case yields no grant.
- **SC-003**: The **same** payment tx hash grants **at most once** — a resubmission by the same or a different wallet grants **zero** additional times.
- **SC-004**: A lapsed subscription resolves to free on the **next** assistant turn with **no** sweeper job running; a valid renewal extends the expiry to `max(now, current_expiry) + 1 month` in **100%** of tested active and lapsed cases.
- **SC-005**: **Zero** withdrawals, redeems, exits, or funds-movement actions are ever blocked, delayed, or degraded by any premium, subscription, expiry, or price check — verified across free, premium, lapsed, and verification-erroring states.
- **SC-006**: The pay surface's displayed SRK balance equals the live on-chain balance and the displayed price equals the configured value in **100%** of loads; an unset SRK address yields an honest "unavailable" state, never a fabricated number.
- **SC-007**: The SRK payment is a single user-signed transfer to a disclosed address with **no** SparkPoint-signed leg and **no** standing approval to a SparkPoint-controlled contract — verifiable from the signed transactions.
- **SC-008**: **100%** of grants, renewals, and verified payments produce an audit record (buyer, tx hash, amount, expiry).

## Assumptions

- **Identity** is the SIWE-verified owner EOA, derived server-side and asserted to the agent via `X-Owner` behind the S2S bearer (the existing 008/001 trust model); this feature does not change that boundary and re-derives the buyer from it, never from the body.
- **SRK is a fresh test token** on Base Sepolia only, 18 decimals, deployer-minted, no faucet — not the old CoinMarketCap-listed SRK; there is no SRK on Base mainnet or Robinhood testnet in this increment.
- **No USD oracle** exists for SRK; the price is a flat 500 SRK/month compared in base units, and any dollar figure is illustrative only.
- **Premium is advisory-compute only** (008): the tier gate sits on chat/recommendations/onboarding and never on custody; this feature inherits that boundary unchanged.
- **Expiry resolves lazily** on the hot path (no sweeper); the `subscriptions`/`payments` ledgers are the history/audit source, while `wallet_tier.expires_at` is the resolution source, to avoid dual-source drift.
- **The premium treasury** is the feature-014 fee Safe if it exists at build time; otherwise the deployer EOA with a recorded cutover note — in either case a plain recipient with no authority over user funds.
- **Single agent replica** for the alpha (008 assumption) — the payments-ledger uniqueness, not in-process state, is what guarantees single-grant.
- **The contract needs unit + fuzz tests** before any mainnet consideration (Principle IV); this increment targets Base Sepolia only.
