# Internal Interface Contracts: Fee Treasury Multisig Migration (Phase 1)

This feature adds **no new application endpoint**. Its "interfaces" are the on-chain governance ceremony
(the Timelock `schedule`/`execute` against the vault's guardian-only setter), two config surfaces (the
address-book `feeTreasury` field + the 46630 `swapFeeRecipient` constant + the non-key `FEE_WALLET_ADDRESS`
agent constant), and the existing **live-read** surfaces that reflect the change (fees page / `NonCustodyBadge`
/ Trust Center / feature-013's admin-revenue Safe card). Each contract below carries a test obligation.
There is **no Safe SDK** — the Safe is created via `app.safe.global` and is a plain, non-privileged holder.

## 1. Vault fee-recipient setter (guardian-only) — `contracts/src/vault/SparkPointVault.sol:340`

```solidity
// State (SparkPointVault.sol:47): an ordinary, non-privileged share holder — NO authority over user funds.
address internal _feeRecipient;

function setFeeRecipient(address newRecipient) external override onlyGuardian {   // :340
    if (newRecipient == address(0)) revert ZeroAddress();
    emit FeeRecipientUpdated(_feeRecipient, newRecipient);                        // authoritative confirmation signal
    _feeRecipient = newRecipient;
}
function feeRecipient() external view returns (address);                          // live read used by web + swap fallback

modifier onlyGuardian() { if (msg.sender != _guardian) revert NotGuardian(); _; } // :67  (_guardian is IMMUTABLE)
```

**Contract test obligations (Foundry fork)**: a direct EOA `setFeeRecipient(Safe)` reverts `NotGuardian`
(only the guardian/Timelock may call it); a call whose `msg.sender == _guardian` (i.e. via `execute`)
succeeds, emits `FeeRecipientUpdated(old, Safe)`, and sets `feeRecipient() == Safe`; `setFeeRecipient(0x0)`
reverts `ZeroAddress`; the **vault address and `_guardian` are unchanged** before/after (no redeploy);
`_feeRecipient` is the **only** state that changes. **No contract source edit** in this feature — the setter
already exists; this contract is asserted, not modified.

## 2. Timelock migration ceremony — OZ `TimelockController` `0x0A21A9B4c2cd2d6a68EC828188826B673572d720`

```solidity
// The ONLY way to move the vault fee recipient. Deployer is sole proposer + executor (testnet MVP).
bytes  data = abi.encodeWithSelector(SparkPointVault.setFeeRecipient.selector, SAFE);
bytes32 salt = keccak256("sparkpoint-fee-recipient-migration-v1");   // FRESH salt (replay-safe); recorded

// as PROPOSER — queue it (delay >= minDelay == 60s testnet):
schedule(target=VAULT, value=0, data=data, predecessor=0x0, salt=salt, delay>=60);

// verify BEFORE execute (D12):
bytes32 opId = hashOperation(VAULT, 0, data, 0x0, salt);
require(isOperationPending(opId));      // and re-check the encoded selector + SAFE arg in `data`

// after >= minDelay, as EXECUTOR:
execute(target=VAULT, value=0, data=data, predecessor=0x0, salt=salt);  // msg.sender == timelock == _guardian
// confirm settlement by a LIVE feeRecipient()==SAFE read at sufficient depth — never the execute receipt alone.
```

**Contract test obligations**: a `schedule` with `delay < minDelay` is rejected; an `execute` **before** the
delay elapses is rejected; after the delay, `execute` makes `msg.sender == _guardian` so `setFeeRecipient`
succeeds; the derived `opId` matches the queued operation and the encoded `data` decodes to
`setFeeRecipient(SAFE)` with the exact selector + Safe address; a reused `(target,value,data,predecessor,salt)`
collides with the pending operation id (fresh salt required). The Safe is **not** granted any Timelock role
(no `PROPOSER_ROLE`/`EXECUTOR_ROLE`), and the guardian is not changed (N5, FR-011).

## 3. Swap-fee recipient resolution (auto-follows the vault) — `apps/web/src/lib/swap/useSwapConfirm.ts`

```ts
// Existing behavior relied upon — NOT changed by this feature:
const treasury = b.swapFeeRecipient && b.swapFeeRecipient.toLowerCase() !== ZERO_ADDR ? b.swapFeeRecipient : undefined;
const feeRecipient = swapFeeRecipient ?? vaultFeeRecipient;   // per-chain treasury wins; else live vault.feeRecipient()
// baseSepolia.ts leaves swapFeeRecipient UNSET → the Base-Sepolia swap fee FOLLOWS the vault automatically.
// A still-loading recipient can never degrade to a fee-free swap (synchronous fee gate, 007 §D5).
```

**Contract test obligations**: with `baseSepolia.ts` leaving `swapFeeRecipient` unset, the resolved swap-fee
recipient equals the live `vault.feeRecipient()` — so after the US2 Timelock `execute` a Base-Sepolia swap
routes its fee to the Safe **with no address-book change** (FR-007); setting `swapFeeRecipient` on Base
Sepolia is explicitly **not** done (it would break the follow-the-vault fallback and add a sync burden, D8).

## 4. Address-book fee-treasury field + 46630 constant — `packages/shared/src/addresses/{types.ts,baseSepolia.ts,robinhoodTestnet.ts}`

```ts
// types.ts — a PLAIN optional field (NOT a TargetRef), mirroring swapFeeRecipient:
readonly feeTreasury?: Address;                 // the network's canonical fee-treasury Safe (address of record)

// baseSepolia.ts — record the Safe (address of record; vault fee still moves via the Timelock ceremony):
feeTreasury: "0x…SAFE",

// robinhoodTestnet.ts — the 46630 swap fee is a HARDCODED constant (no vault to fall back to):
swapFeeRecipient: "0x…SAFE",                    // was 0xA71e…5c30; needs a WEB REDEPLOY to take effect
```

**Contract test obligations (Vitest)**: `getAddresses(84532)` exposes a single canonical `feeTreasury`
(no code path resolves two different treasury addresses for a network — FR-002); the 46630 `swapFeeRecipient`
equals the Safe after the edit; a zero/unset `swapFeeRecipient` on 46630 is disallowed (it would make the
46630 swap fee-free); the fields are plain `Address` values with no key material (FR-003).

## 5. Non-key agent config constant — `services/agent/src/sparkpoint_agent/config.py`

```python
# Resolved from env into AgentConfig exactly like SPARKPOINT_VAULT_ADDRESS (public address only):
FEE_WALLET_ADDRESS_ENV = "FEE_WALLET_ADDRESS"
# from_env(): raw = source.get(FEE_WALLET_ADDRESS_ENV)
#             fee_wallet_address = _normalize_address(raw, FEE_WALLET_ADDRESS_ENV) if raw else None
# _ADDRESS_RE = ^0x[0-9a-fA-F]{40}$   ;   _assert_no_key_material() must still pass.
```

**Contract test obligations**: a well-formed `FEE_WALLET_ADDRESS` normalizes onto `AgentConfig`; a
malformed value fails closed at load (like `SPARKPOINT_VAULT_ADDRESS`); an **absent** value yields `None`
(the admin-revenue Safe card honest-degrades); the value is a **public address only** — `_assert_no_key_material()`
still passes; the constant is a read input, **not** a persisted balance (FR-015).

## 6. Live-read proof surfaces (no data-source change) — `apps/web/src/app/(app)/fees/page.tsx`, `.../trust/permissions/page.tsx`, `NonCustodyBadge`

```ts
// Existing live reads — reflect the Safe automatically post-execute, NO rewiring of the data source:
const recipient = useReadContract({ address: vault, abi: vaultAbi, functionName: "feeRecipient" }).data; // → Safe after US2
// Trust Center permissions view: derive the Safe's authority over user funds FROM CHAIN:
//   not the guardian (guardian != Safe), no withdraw/redeem path ⇒ power = NONE (provable, not asserted).
```

**Contract test obligations**: the fees page + `NonCustodyBadge` show the Safe as the fee recipient within
one page load of `execute`, with **no** change to their data source (FR-012, SC-003); the Trust Center
permissions view represents the Safe's power over user funds as **nil** — provable from chain (not guardian,
no fund-movement path) — not asserted copy (Principle III, N5); the withdraw-always exit path is unaffected
by the fact that the recipient is now a multisig (FR-013, N2, SC-004).

## 7. Admin-revenue Safe balance card (live read, fed by feature 013) — `apps/web/src/app/admin/revenue/…`

```text
Input:  AgentConfig.fee_wallet_address (the Safe)  →  live eth_getBalance + ERC20 balanceOf (existing RPC transport)
Output: SafeBalanceCard { configured, address, native, tokens[] }   // see data-model.md
        configured:false ⇒ honest "cannot load"; real zero ⇒ real zero; NEVER a fabricated/sample figure.
```

**Contract test obligations**: reflects the Safe's **real** balances from a live on-chain read (no
persisted/cached figure treated as truth); returns `configured:false` when the read is unavailable (mirrors
`admin_usage.py`), never a number in that state (FR-014, SC-005); a real zero renders as zero, not a
placeholder. This feature supplies the address + the requirement; 013 owns the card and the persistence-free
read path.
