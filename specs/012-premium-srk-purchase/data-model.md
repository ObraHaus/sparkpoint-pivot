# Data Model: Premium Purchase via SRK (Phase 1)

One new forward-only migration (`services/agent/migrations/0016_subscriptions.sql` — **number is provisional;
reconcile with the parallel 010/011 work before applying; use the next free sequential number**) adds two
Postgres tables plus one column, on top of the on-chain SRK token, the two address-book fields, and the in-app
verify/grant wire shapes. Field notes call out the invariants tests must enforce. The DB shapes copy the live
`0015` conventions (lowercased-wallet `TEXT` keys, on-chain rows carry `network_id … REFERENCES networks(id)`
and a `UNIQUE(network_id, tx_hash…)` idempotency key like `fee_events`/`0002`, append-only audit written in the
same transaction as the grant). The premium/expiry check this data feeds sits **only** on the three
advisory-compute routes (008) and **never** on withdraw/redeem/exit (N2, FR-017).

## SparkPointTestToken (on-chain — `contracts/src/token/SparkPointTestToken.sol`)

The fresh test SRK the premium price is denominated in — a first-class `src/` contract (not the `test/mocks`
`MockERC20`, which has an unpermissioned open mint), deliberately distinct from the old CoinMarketCap-listed SRK
(FR-001). Deployed on Base Sepolia (84532) only via `contracts/script/DeploySRK.s.sol`.

| Field | Value | Notes |
|---|---|---|
| Base | OpenZeppelin v5.1.0 `ERC20` | `import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";` — the whole repo's ERC-20 convention. |
| `name()` | `"SparkPoint Test Token"` | Set in the constructor: `constructor() ERC20("SparkPoint Test Token", "SRK")`. |
| `symbol()` | `"SRK"` | |
| `decimals()` | `18` | OZ default — **not** overridden; the price is compared in 18-dp base units (FR-003). |
| `totalSupply()` | fixed, all minted to the deployer | `_mint(msg.sender, INITIAL_SUPPLY)` in the constructor. |
| public faucet `mint` | **none** | No unpermissioned mint/burn — supply is fixed at deploy (FR-001). |

**Invariants (Foundry unit + FUZZ tests, before any mainnet consideration — Principle IV)**: `decimals() == 18`;
`totalSupply() == INITIAL_SUPPLY` and the deployer holds all of it at construction; there is no callable path
that mints after construction; ERC-20 transfer/approve invariants hold under fuzzed amounts/actors (a transfer
never creates supply; `transfer` beyond balance reverts; `approve`+`transferFrom` respects allowance). Web
balance/allowance/approve/transfer bind **viem's built-in `erc20Abi`** at the call site — SRK is **not** added
to `export-abis.sh` (a plain ERC-20 has no custom surface to bind).

**Deploy-write gotcha (`DeploySRK.s.sol`)**: write the deployed address with the **3-arg**
`vm.writeJson(vm.toString(srk), "deployments/84532/addresses.json", ".SRK")` (sets only the `.SRK` key) **or**
to a separate `deployments/84532/srk.json`. A **2-arg** `vm.writeJson(json, path)` **overwrites the whole file**
and would erase the vault/timelock/guardian entries the core deploy wrote. The Foundry artifact and the
hand-maintained TS address book are two separate stores kept in sync manually — copy the address into
`baseSepolia.ts` after deploy.

## Address book fields — `srk?` / `premiumTreasury?` (`packages/shared/src/addresses/types.ts` + `baseSepolia.ts`)

Two **plain optional** `AddressBook` fields (the exact precedent set by the Uniswap-V3 swap wiring's
`uniswapV3SwapRouter02?` / `swapFeeRecipient?`). They are **NOT** policy `TargetRef`s — do **not** add them to
`TARGET_REF_FIELD`, so they carry no parity/drift obligation and the T098 drift guard stays green.

| Field | Type | Notes |
|---|---|---|
| `srk?` | `Address` | The SRK token venue. Filled in `baseSepolia.ts` after the deploy; left `undefined` on every other chain. |
| `premiumTreasury?` | `Address` | The disclosed recipient of SRK premium payments — the feature-014 fee Safe if it exists at build time, else the deployer EOA with a recorded cutover note. |

**Invariants**: unset ⇒ `getAddresses(chainId).srk === undefined` ⇒ the pay surface fail-closes to an honest
"unavailable" state and offers no sign action, never a fabricated balance/price (FR-004, FR-022). SRK is
Base-Sepolia-only in this increment — both fields resolve on 84532 only; on 8453/46630 they stay `undefined`.
`premiumTreasury` is a **plain payment recipient** with no fund-movement authority over user funds (N5, FR-019);
if it is a multisig it is still a plain recipient, never the immutable vault guardian.

## payments (new — `services/agent/migrations/0016_subscriptions.sql`)

The append-only ledger of verified on-chain premium payments. Its **`UNIQUE(network_id, tx_hash)`** is the
authoritative anti-replay control (**not** the BFF `Idempotency-Key`, which only dedupes identical retries —
FR-011, FR-012). Shape follows the on-chain-derived `fee_events` (`0002`) convention.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | |
| `network_id` | TEXT NOT NULL REFERENCES `networks(id)` | The chain the payment settled on (Base Sepolia in this increment). |
| `tx_hash` | TEXT NOT NULL CHECK (`tx_hash = lower(tx_hash)`) | The verified payment transaction. Lowercased `0x…64hex`. |
| `buyer` | TEXT NOT NULL CHECK (`buyer = lower(buyer)`) | The owner EOA — the on-chain `from`, asserted equal to the server-scoped `account.owner` (FR-006). |
| `token` | TEXT NOT NULL CHECK (`token = lower(token)`) | The SRK token address the `Transfer` moved. |
| `amount_raw` | NUMERIC NOT NULL CHECK (`amount_raw >= 0`) | The `Transfer` value in **SRK base units** (18-dp), stored exactly (no float). |
| `block_number` | BIGINT NOT NULL | The receipt block — the finality basis (`head − block_number ≥ N`). |
| `verified_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | When the agent verified + recorded it. |
| CONSTRAINT | **UNIQUE (`network_id`, `tx_hash`)** | The anti-replay control — one payment can never grant twice, by the same or any other wallet (FR-011). |

**Invariants**: the insert and the subscription grant + audit happen in **one transaction**, so a unique
violation aborts the grant (a resubmitted hash grants zero additional times — SC-003); `amount_raw` is only ever
recorded for a payment that passed full verification (status success, ≥ N confirmations, correct token, correct
recipient, `value ≥ PREMIUM_PRICE_SRK`); no key material and no message content is stored.

## subscriptions (new — `services/agent/migrations/0016_subscriptions.sql`)

The append-only membership-window history / audit source of record — **not** the resolution source (that is
`wallet_tier`, see below). One row per granted or renewed period.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | |
| `wallet` | TEXT NOT NULL CHECK (`wallet = lower(wallet)`) | The buyer/owner EOA the membership is for. |
| `tier` | TEXT NOT NULL REFERENCES `tier_definitions(tier)` | `'premium'` for this feature. |
| `started_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | Period start (this grant/renewal). |
| `expires_at` | TIMESTAMPTZ NOT NULL | Period end — `max(now, current_expiry) + 1 month` for a renewal, `now + 1 month` for a fresh grant (FR-015). |
| `payment_tx_hash` | TEXT NOT NULL CHECK (`payment_tx_hash = lower(payment_tx_hash)`) | The `payments` row that funded this window (FK-by-value; the audit link). |
| `amount_raw` | NUMERIC NOT NULL | The SRK base-unit amount paid for this period (mirrors `payments.amount_raw`). |

Index `(wallet, started_at DESC)`. **Invariants**: append-only (a renewal writes a **new** row, it does not
mutate a prior one) so the paid-time history reads honestly; every row traces to exactly one verified
`payments` row (SC-008 — 100% of grants/renewals produce an audit record: buyer, tx hash, amount, expiry);
`expires_at` here is the **history** of what was granted, while the live resolution reads `wallet_tier.expires_at`
— the two are written together in the same transaction, so they never drift.

## wallet_tier.expires_at (altered — `services/agent/migrations/0016_subscriptions.sql`)

The one column that turns 008's existence-only tier resolution into a time-boxed one. Added to the existing
`0015` `wallet_tier` table; **`wallet_tier` stays the single hot-path resolution source**.

| Column | Type | Notes |
|---|---|---|
| `expires_at` | TIMESTAMPTZ **NULL** | `ALTER TABLE wallet_tier ADD COLUMN IF NOT EXISTS expires_at timestamptz;` |

**Semantics**: `NULL` ⇒ **non-expiring** — an operator (008) admin grant, never auto-lapsed by this feature
(FR-016, US3 scenario 5). A past value ⇒ the row resolves as **absent** (the wallet is metered free) on the hot
path. No `ALTER` to `wallet_tier.source` is needed — `'srk'` is **already** in the `0015` CHECK constraint
(`source IN ('admin','env-seed','srk')`), reserved for exactly this paid path.

**Resolution change (the single load-bearing edit)** — `_RESOLVE_SQL` at `db/limits.py:44` gains one clause:

```sql
-- before (008):  SELECT tier FROM wallet_tier WHERE address = $1
SELECT tier FROM wallet_tier WHERE address = $1 AND (expires_at IS NULL OR expires_at > now())
```

**Invariants**: a lapsed row resolves to the default (free) tier on the **next** assistant turn with **no**
sweeper job (FR-014, SC-004); the resolve stays a single indexed read (the extra predicate adds nothing to the
hot path); expiry fails **closed to free**, consistent with the existing fail-closed-to-default posture; expiry
resolution is keyed on the owner EOA, never the counterfactual ERC-4337 account. `LimitsStore.assign` is
extended to accept an `expires_at`, still writing the grant + a `limits_audit` row in one transaction; the grant
uses `source='srk'`.

## PurchaseSubmit (in-app — `services/agent/src/sparkpoint_agent/api/subscription.py`)

The request body of `POST /subscription/verify`. The client contributes **only** a tx hash — every material
fact (buyer, amount, recipient, token, status, confirmations) is read from chain (FR-005).

```python
class PurchaseSubmit(BaseModel):
    txHash: str            # 0x + 64 hex; the only thing the client contributes
    # NO buyer / amount / recipient / token field — the buyer is account.owner (server-scoped),
    # never a body field (FR-006). A buyer/amount in the body would be ignored if present.
```

**Invariants**: `txHash` is validated against `^0x[0-9a-fA-F]{64}$` (→ `VALIDATION_ERROR` otherwise); the buyer
is `account.owner` from the S2S-scoped `X-Owner` header (mirrors every admin/scoped write); a body-supplied
buyer/amount is never trusted. `Idempotency-Key` dedupes identical retries only — the `payments`
`UNIQUE(network_id, tx_hash)` is the anti-replay guard (FR-012).

## VerifyResult (in-app — `services/agent/src/sparkpoint_agent/api/subscription.py`)

The endpoint's response — a three-way outcome (granted / retryable-pending / refused), not persisted.

```python
# Success (granted, or already-granted-idempotent):
{ "status": "granted", "tier": "premium", "expiresAt": "<iso8601>", "txHash": "0x…" }

# Not yet final — a retryable pending result (NOT a grant, NOT a hard failure): the client polls.
# Surfaced as a distinct outcome so a freshly-broadcast tx does not error (FR-008).
{ "status": "pending", "confirmations": <int>, "required": PREMIUM_MIN_CONFIRMATIONS }

# Refused (reverted / under-price / wrong-token / wrong-recipient / wrong-sender): raises
#   ApiError(ErrorCode.VALIDATION_ERROR, "<clear reason>")   -> 400   (FR-009)
# RPC outage during verification: raises
#   ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, ...)            -> 503 retryable (FR-010)
```

**Invariants**: a grant is returned **only** for a payment that is successful, ≥ N confirmations, in SRK, to the
treasury, from the owner, at or above the price in base units (SC-002); `pending` is never a grant and never a
hard failure (FR-008); a refusal grants nothing and carries a clear reason (FR-009); an RPC failure surfaces as
retryable `UPSTREAM_UNAVAILABLE`, never a grant and never a false "invalid payment" (FR-010).

## PaymentReceipt / verifier decode (in-app — `services/agent/src/sparkpoint_agent/chain/payment_verifier.py`)

The internal shape the keyless verifier produces from the on-chain receipt — reusing `data/log_source.py`'s
raw-result `HttpxLogsRpc` (a receipt is a JSON **object**, which the string-only vault transport rejects) and
`_addr_from_topic` (keyless, keccak-free). Not persisted; it is the input to the grant decision.

```python
@dataclass(frozen=True)
class VerifiedPayment:
    tx_hash: str          # lowercased 0x…64
    buyer: str            # decoded Transfer `from` (indexed topic[1]) — MUST == account.owner
    token: str            # the log `address` — MUST == SRK_ADDRESS_84532
    recipient: str        # decoded Transfer `to` (indexed topic[2]) — MUST == premiumTreasury
    amount_raw: int       # decoded non-indexed `value` (uint256) from log["data"] — SRK base units
    block_number: int     # int(receipt["blockNumber"], 16)
    confirmations: int    # head(eth_blockNumber) - block_number

# The match target (a hardcoded constant like the existing topic0s, no keccak call):
ERC20_TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
```

**Decode + assert sequence**: `receipt = HttpxLogsRpc.call("eth_getTransactionReceipt", [txHash])`; if `receipt`
is `null` ⇒ pending. Assert `receipt["status"] == "0x1"` (reverted ⇒ refuse). `head =
int(eth_blockNumber, 16)`; if `head − block_number < PREMIUM_MIN_CONFIRMATIONS` ⇒ **pending** (retryable). Among
`receipt["logs"]`, select the one where `address == SRK_ADDRESS_84532` **and** `topics[0] ==
ERC20_TRANSFER_TOPIC0`; decode `from = _addr_from_topic(topics[1])`, `to = _addr_from_topic(topics[2])`, `value`
from `data`. Require `from == account.owner`, `to == PREMIUM_TREASURY_ADDRESS`, `value >= PREMIUM_PRICE_SRK` —
**all compared in base units, all addresses lowercased**; any miss ⇒ refuse. **Invariants**: comparison is in
SRK base units, never USD (there is no oracle — FR-003); billing constants (`SRK_ADDRESS_84532`,
`PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS`) are read **directly** (like
`PREMIUM_ALLOWLIST`), kept out of the keyless `AgentConfig`; the verifier is pinned to the SRK chain and
fails closed on any other (FR-004).

## PremiumPayExec (in-app — `apps/web/src/lib/chain/useExecutePremiumTx.ts`)

The web two-leg exec descriptor the pay surface builds and signs — a clone of the 007 `SwapExec` shape. The user
is the **sole signer**; SparkPoint signs nothing (N1, N3, FR-002).

```ts
interface PremiumPayExec {
  kind: "premiumPay";
  chainId: number;      // 84532
  srk: Address;         // getAddresses(chainId).srk
  treasury: Address;    // getAddresses(chainId).premiumTreasury (disclosed on screen)
  account: Address;     // the signer's own wallet (owner EOA)
  amount: bigint;       // the configured price in SRK base units
  needsApprove: boolean; // allowance(owner, treasury) < amount
}
// leg-0 (only if needsApprove): erc20.approve(treasury, amount)
// leg-1:                         erc20.transfer(treasury, amount)
// each: writeContractAsync -> waitForTransactionReceipt; status === "reverted" ⇒ fail closed.
```

**Invariants**: leg-1 is a plain `transfer` **to a disclosed recipient** — there is **no** standing pull-approval
to a SparkPoint-controlled contract (`transferFrom` is never used), so no SparkPoint party can move the user's
SRK (FR-002, SC-007); the approve leg exists only when the live allowance is below the price; a reverted receipt
on either leg fails closed; the sign action is revealed only after the fail-closed pre-sign check passes (FR-021,
"simulate before sign").
