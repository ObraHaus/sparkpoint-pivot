# Internal Interface Contracts: Premium Purchase via SRK (Phase 1)

This feature adds one Solidity token + deploy script, one keyless on-chain verifier, one agent verify endpoint,
one subscription store, a one-clause change to the 008 tier-resolve, two address-book fields, and one web exec
controller + confirm-gate wiring. Each contract below carries a test obligation. The verify endpoint is
`get_account`-scoped (the buyer is the server-scoped owner, **never** a body field) and **POST-only** (the BFF
forwards GET/POST only). Every material fact is read from chain — the client contributes only a tx hash.

## 1. SRK token — `contracts/src/token/SparkPointTestToken.sol`

```solidity
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";  // OZ v5.1.0

contract SparkPointTestToken is ERC20 {
    // name "SparkPoint Test Token", symbol "SRK", decimals 18 (OZ default, not overridden).
    // ALL supply minted to the deployer in the constructor; NO public faucet mint.
    constructor() ERC20("SparkPoint Test Token", "SRK") {
        _mint(msg.sender, INITIAL_SUPPLY);   // fixed supply; nothing mints after construction
    }
}
```

**Contract test obligations (Foundry unit + FUZZ, before any mainnet consideration — Principle IV)**:
`decimals() == 18`; `totalSupply() == INITIAL_SUPPLY` and the deployer holds all of it at construction; there is
no callable path that mints after construction; fuzzed transfer/approve/transferFrom preserve supply and respect
balances/allowances (a transfer never mints; over-balance transfer reverts; `transferFrom` respects allowance).

## 2. SRK deploy script — `contracts/script/DeploySRK.s.sol`

```solidity
contract DeploySRK is Script {           // mirrors DeploySepolia.s.sol
    function run() external {
        vm.startBroadcast();
        SparkPointTestToken srk = new SparkPointTestToken();
        vm.stopBroadcast();
        // 3-ARG write — sets ONLY the .SRK key, preserving the vault/timelock/guardian entries:
        vm.writeJson(vm.toString(address(srk)), "deployments/84532/addresses.json", ".SRK");
        // (or write to a separate deployments/84532/srk.json). NEVER a 2-arg write — it clobbers the file.
    }
}
```

**Contract test obligations**: after a scripted deploy on a fork, `deployments/84532/addresses.json` still
contains the pre-existing vault/timelock/guardian keys **and** a new `.SRK` key (no clobber); the deployed
address is copied by hand into `packages/shared/src/addresses/baseSepolia.ts`.

## 3. Address book — `packages/shared/src/addresses/types.ts` (+ `baseSepolia.ts`)

```ts
interface AddressBook {
  // …existing fields…
  readonly srk?: Address;              // SRK token venue (Premium is paid in SRK). Optional ⇒ fail-closed where unset.
  readonly premiumTreasury?: Address;  // disclosed SRK payment recipient (014 Safe if present, else deployer EOA)
  // NOT added to TARGET_REF_FIELD — plain optional fields, no policy/parity impact (T098 drift guard stays green).
}
```

**Contract test obligations**: `getAddresses(84532).srk` / `.premiumTreasury` resolve once filled; on 8453/46630
both stay `undefined` (SRK is Base-Sepolia-only); neither appears in `TARGET_REF_FIELD` (the parity/drift guard
is unaffected); an unset `srk` drives the pay surface's honest "unavailable" state, not a fabricated value.

## 4. Payment verifier — `services/agent/src/sparkpoint_agent/chain/payment_verifier.py`

Keyless, keccak-free — reuses `data/log_source.py`'s raw-result `HttpxLogsRpc` (a receipt is a JSON object the
string-only vault transport rejects) and `_addr_from_topic`.

```python
ERC20_TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

class PaymentVerifier:
    async def verify(self, *, tx_hash: str, buyer: str) -> VerifiedPayment | Pending:
        # receipt = await HttpxLogsRpc(rpc).call("eth_getTransactionReceipt", [tx_hash])
        #   receipt is None                                   -> Pending (not yet mined)
        #   receipt["status"] != "0x1"                        -> raise (reverted; refuse)
        # head = int(await ...call("eth_blockNumber", []), 16)
        #   head - int(receipt["blockNumber"],16) < PREMIUM_MIN_CONFIRMATIONS -> Pending (retryable)
        # pick log where address == SRK_ADDRESS_84532 and topics[0] == ERC20_TRANSFER_TOPIC0
        #   from_ = _addr_from_topic(topics[1]); to = _addr_from_topic(topics[2]); value = decode(data)
        # require from_ == buyer and to == PREMIUM_TREASURY_ADDRESS and value >= PREMIUM_PRICE_SRK
        #   (all addresses lowercased; value in SRK BASE UNITS — no USD oracle) else raise (refuse)
        ...
```

`SRK_ADDRESS_84532`, `PREMIUM_PRICE_SRK`, `PREMIUM_TREASURY_ADDRESS`, `PREMIUM_MIN_CONFIRMATIONS` are read
**directly** (like `PREMIUM_ALLOWLIST`), kept out of the keyless `AgentConfig`.

**Contract test obligations (the receipt matrix)**: a valid full-price payment **from the buyer** to the treasury
returns a `VerifiedPayment`; a payment from a **different sender** is refused; **under-price**, **reverted**,
**wrong-token**, **wrong-recipient** are each refused with a clear reason; an **unmined** or **under-confirmation**
tx returns `Pending` (retryable, not a grant, not a hard failure); an **RPC outage** propagates as the mappable
upstream error (→ `UPSTREAM_UNAVAILABLE`), never swallowed into a false "invalid"; the amount comparison is in
base units; the verifier is pinned to the SRK chain and fails closed elsewhere.

## 5. Verify endpoint — `services/agent/src/sparkpoint_agent/api/subscription.py` (mount in `api/main.py`)

```python
router = APIRouter(tags=["subscription"])

class PurchaseSubmit(BaseModel):
    txHash: str                         # ^0x[0-9a-fA-F]{64}$ — the ONLY client-supplied fact

@router.post("/subscription/verify")
async def verify_purchase(
    body: PurchaseSubmit,
    account: Annotated[AccountContext, Depends(get_account)],       # buyer = account.owner (NEVER the body)
    verifier: Annotated[PaymentVerifier, Depends(get_payment_verifier)],
    subs: Annotated[SubscriptionStore, Depends(get_subscription_store)],
) -> dict:
    # verify -> Pending  => {"status":"pending","confirmations":c,"required":N}   (200, retryable)
    # verify -> refuse   => raise ApiError(VALIDATION_ERROR, "<reason>")          (400)
    # RPC outage         => raise ApiError(UPSTREAM_UNAVAILABLE, ...)             (503)
    # verified           => subs.record_and_grant(...) -> {"status":"granted","tier":"premium","expiresAt":...}
    ...
```

`# api/main.py: from .subscription import router as subscription_router; app.include_router(subscription_router)`

**Contract test obligations**: the buyer is `account.owner`, never a body field (a body-supplied buyer/amount is
ignored); a malformed `txHash` → `400 VALIDATION_ERROR`; a valid payment grants premium and returns the
`expiresAt`; a pending tx returns the `pending` outcome (not a 4xx); a refusal grants nothing; the BFF path
`/api/agent/subscription/verify` reaches it with the injected `X-Owner`/S2S bearer; the same hash resubmitted
(same or different wallet) grants zero additional times (via §6).

## 6. Subscription store — `services/agent/src/sparkpoint_agent/db/subscriptions.py`

Mirrors `db/limits.py`. The payment insert + subscription window + grant + audit are one transaction; the
`payments` `UNIQUE(network_id, tx_hash)` is the anti-replay control.

```python
@dataclass
class SubscriptionStore:
    db: Database
    async def record_and_grant(self, *, buyer: str, tx_hash: str, network_id: str,
                               token: str, amount_raw: int, block_number: int) -> datetime:
        # ONE transaction:
        #   INSERT INTO payments(...) ...                      -- UNIQUE(network_id, tx_hash) => anti-replay
        #     (a duplicate hash raises a unique violation and aborts the whole grant)
        #   new_expiry = max(now(), current wallet_tier.expires_at) + interval '1 month'   -- EXTENDS, not resets
        #   INSERT INTO subscriptions(wallet, tier, started_at, expires_at, payment_tx_hash, amount_raw) ...
        #   LimitsStore.assign(buyer, "premium", source='srk', expires_at=new_expiry)       -- + limits_audit row
        # returns new_expiry
        ...
```

**Contract test obligations**: a duplicate `(network_id, tx_hash)` insert raises and grants zero additional
times (SC-003); a renewal sets `expires_at = max(now, current_expiry) + 1 month` for both an active and a lapsed
wallet (never a reset that truncates paid time — SC-004); every grant/renewal writes a `subscriptions` row + a
`limits_audit` row in the same transaction (SC-008); the grant uses `source='srk'` (no CHECK ALTER); the wallet
resolves premium via the existing `resolve_tier` on its next turn.

## 7. Expiry-aware tier resolve — `services/agent/src/sparkpoint_agent/db/limits.py`

```python
# _RESOLVE_SQL (:44) gains ONE clause; assign(...) accepts an optional expires_at.
_RESOLVE_SQL = "SELECT tier FROM wallet_tier WHERE address = $1 AND (expires_at IS NULL OR expires_at > now())"
async def assign(self, address, tier, *, source, actor=None, expires_at=None) -> None: ...
```

**Contract test obligations**: a `wallet_tier` row whose `expires_at` is in the past resolves to the default
(free) tier on the **next** turn with **no** sweeper (FR-014); a `NULL` `expires_at` resolves as non-expiring
(an admin grant is never auto-lapsed — FR-016); a future `expires_at` resolves premium; the resolve stays a
single indexed read; the change does **not** attach any check to the withdraw/redeem/exit path (the resolve is
called only from the three advisory-compute routes).

## 8. Web premium exec + confirm gate — `apps/web/src/lib/chain/useExecutePremiumTx.ts` (+ `premium/pay/page.tsx`, `ConfirmFlow.tsx`/`OnchainConfirmFlow`)

```ts
// Clone of useExecuteSwapTx.ts — user is the SOLE signer; viem erc20Abi at the call site.
function useExecutePremiumTx(exec: PremiumPayExec) {
  // leg-0 (only if exec.needsApprove): writeContractAsync({ address: exec.srk, abi: erc20Abi,
  //          functionName: "approve", args: [exec.treasury, exec.amount], chainId: exec.chainId })
  //          -> waitForTransactionReceipt; status === "reverted" ⇒ fail closed
  // leg-1:  writeContractAsync({ address: exec.srk, abi: erc20Abi,
  //          functionName: "transfer", args: [exec.treasury, exec.amount], chainId })   // plain transfer, disclosed recipient
  //          -> waitForTransactionReceipt; status === "reverted" ⇒ fail closed
}
// pay/page.tsx: replace hardcoded balance=320/price=500 with
//   useReadContract(erc20Abi, "balanceOf", [owner])  +  ...("allowance", [owner, treasury])  +  config price.
// "Review & sign" routes through the real gate ("premium" is already in INTENTS + the ConfirmIntent union):
//   generalize OnchainConfirmFlow past deposit|withdraw for a premiumPay exec, OR an inline confirm
//   modeled on inline-swap-confirm.tsx; the Sign action is revealed ONLY once the fail-closed pre-sign check passes.
```

**Contract test obligations**: leg-1 is a plain `transfer` to the disclosed treasury — **no** `transferFrom`, no
standing pull-approval to a SparkPoint contract (SC-007); the approve leg is presented only when
`allowance < price`, otherwise only the pay leg; the displayed balance equals the on-chain `balanceOf` and the
price equals the configured value (no hard-coded 320/500 — SC-006); the sign action is hidden until the
fail-closed pre-sign check passes and success renders only after a real receipt (FR-021); an unset `srk` on the
active chain renders an honest "unavailable" state with no sign action (FR-022).
