# Data Model: Fee Treasury Multisig Migration (Phase 1)

**No new Postgres table and no migration** (D9). The "data" this feature adds is a single public
address recorded in two config surfaces, plus the on-chain state and wire shapes the migration reads and
proves. Each section below is headed with the **real file it lives in**. Field notes call out the
invariants tests + the ceremony verification must enforce. The address-book shapes copy the existing
`swapFeeRecipient` convention (a plain optional `Address` field, explicitly **not** a policy `TargetRef`);
the agent constant copies the `SPARKPOINT_VAULT_ADDRESS` env → `AgentConfig` normalization convention.

> Latest migration on disk is `0016_vault_factory.sql` (feature 011, on develop); this feature adds none. (For reference, the parallel migration
> numbers are moving in parallel: 012 is working `0017_subscriptions.sql` and 013 `0018_swap_fee_events.sql`
> — those numbers must be confirmed as still free at apply time; use the
> next free sequential number. **014 claims no number at all.**)

## Fee Treasury Safe — address of record (config — `packages/shared/src/addresses/baseSepolia.ts` + optional `types.ts`)

The one canonical fee-treasury address per network, recorded as a plain optional address-book field
(seed-then-read, like `swapFeeRecipient`). This is the single source of truth every later step references.

| Field | Type | Notes |
|---|---|---|
| `feeTreasury` (optional new field on `AddressBook`) | `readonly Address?` (`packages/shared/src/addresses/types.ts`) | A **plain optional field, NOT a `TargetRef`** (no `TARGET_REF_FIELD`, no parity/drift impact) — mirrors the existing `swapFeeRecipient` shape. Where set on a network, it names that network's fee-treasury Safe. |
| value on Base Sepolia (84532) | `Address` = the 2-of-3 Safe | Recorded in `baseSepolia.ts`. This is an **address of record only** — it does NOT itself move the vault fee (that is the Timelock ceremony, US2); it exists so all surfaces resolve **one** canonical treasury address. |

**Validation / invariants**: lowercased/checksummed `0x`-address; **no code path may resolve two different
fee-treasury addresses for the same network** (FR-002); the field is address-only — **no private key or
seed** ever appears here (FR-003, SC-006). Recording it changes **no** fee flow (US1 acceptance #4). The
`feeTreasury` field is optional and additive; unset on a network ⇒ that network has no recorded Safe
(unchanged behavior).

## Vault fee recipient `_feeRecipient` — on-chain state (contract — `contracts/src/vault/SparkPointVault.sol:340`)

Mutable vault state naming the address that receives performance-fee dilution shares. Read live by the
fees page, the `NonCustodyBadge`, and (by fallback) the swap flow. Changed **only** through the Timelock
ceremony (US2) — never a redeploy, never a raw EOA call.

| On-chain element | Shape | Notes |
|---|---|---|
| `_feeRecipient` | `address internal` (`SparkPointVault.sol:47`) | "ordinary, non-privileged share holder with no authority over other users' funds." **Before**: deployer EOA `0xA71e24359A6cb7A939aae2d62dD12b6256365c30`. **After US2**: the Safe. |
| `setFeeRecipient(address newRecipient)` | `external override onlyGuardian` (`SparkPointVault.sol:340`) | `if (newRecipient == address(0)) revert ZeroAddress();` then `emit FeeRecipientUpdated(old, new)`; sets `_feeRecipient`. |
| `feeRecipient()` | `view` returns `address` | The live read the fees page / badge / swap-fee fallback consume. |
| `FeeRecipientUpdated(address old, address new)` | event | The authoritative post-execute confirmation signal (with a live `feeRecipient()` re-read). |

**Invariants**: `newRecipient != address(0)` (vault reverts `ZeroAddress`); `msg.sender` MUST equal the
immutable `_guardian` (the Timelock) or the call reverts `NotGuardian` — so a direct EOA call is impossible
by construction (FR-004). The migration changes **only** this state field: the **vault address and the
immutable `_guardian` are unchanged**, no redeploy (FR-006, SC-002). `feeRecipient` remains a plain
share-holder with **zero** authority over user funds (N1/N5, FR-011).

## Timelock operation — governance ceremony (on-chain — OZ `TimelockController` `0x0A21A9B4c2cd2d6a68EC828188826B673572d720`)

The scheduled-then-executed governance call that carries `setFeeRecipient(Safe)`. Public and delayed by
`minDelay` (60s on testnet). The deployer is sole proposer + executor + admin.

| Operation parameter | Value for this migration | Notes |
|---|---|---|
| `target` | the vault `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2` | The call target. |
| `value` | `0` | No ETH. |
| `data` | `abi.encodeWithSelector(setFeeRecipient.selector, SAFE)` | MUST encode the correct selector + the correct Safe address (verified before execute — FR-005, D12). |
| `predecessor` | `0x0` | No dependency. |
| `salt` | a **fresh** `bytes32` for this operation | A reused salt for an identical call collides with the prior operation id (replay note, research §Adversarial). Recorded with the schedule tx. |
| `delay` | `>= minDelay` (60s testnet) | Pre-delay `execute` is rejected (US2 acceptance #3). |

**Idempotency / keying**: the operation id is `hashOperation(target, value, data, predecessor, salt)` — a
reused `(target,value,data,predecessor,salt)` tuple maps to the same id and cannot be re-scheduled while
pending. **Verification obligation (D12)**: assert the encoded calldata + derived operation id **before**
`execute`; after `execute`, confirm `FeeRecipientUpdated` **and** a live `feeRecipient() == Safe` at
sufficient depth (never trust the execute receipt alone — testnet reorg). The Timelock is **not** granted
to the Safe; the Safe receives **no** proposer/executor role (FR-011).

## Robinhood swap-fee constant (config — `packages/shared/src/addresses/robinhoodTestnet.ts`)

The 46630 swap fee recipient. A **hardcoded client-shipped constant** because Robinhood testnet has **no
vault** to fall back to. Does NOT follow the Timelock — moved by editing the constant + redeploying web.

| Field | Type | Notes |
|---|---|---|
| `swapFeeRecipient` | `Address` (`robinhoodTestnet.ts`) | **Before**: deployer EOA `0xA71e24359A6cb7A939aae2d62dD12b6256365c30`. **After US3**: the Safe. |

**Validation / invariants**: a non-zero `0x`-address (the swap flow zero-guards — a zero/unset value ⇒ no
vault-independent recipient, and on 46630 that would mean a fee-free swap, so it MUST stay set). The change
is **complete only after both** the constant edit **and** the web redeploy (FR-009, US3 acceptance #2);
until redeploy the shipped bundle still carries the old value. It is **independent of the Timelock** — the
46630 surface has no vault and is unaffected by US2 (US3 acceptance #3).

## Fee-treasury agent config constant (config — `services/agent/src/sparkpoint_agent/config.py`)

A **non-key** public-address constant `FEE_WALLET_ADDRESS`, resolved from the environment into `AgentConfig`
the same way `SPARKPOINT_VAULT_ADDRESS` is (`_normalize_address`, `_ADDRESS_RE = ^0x[0-9a-fA-F]{40}$`).
Consumed by feature 013's admin-revenue Safe-balance read.

| Field | Type | Notes |
|---|---|---|
| env `FEE_WALLET_ADDRESS` | `str` (`0x…40 hex`), OPTIONAL | Normalized via `_normalize_address(value, "FEE_WALLET_ADDRESS")`; absent ⇒ `None` (the admin-revenue Safe card degrades honestly). |
| `AgentConfig.fee_wallet_address` | `str | None` | The public Safe address only. |

**Validation / invariants**: matches `_ADDRESS_RE` or fails closed at load (like `SPARKPOINT_VAULT_ADDRESS`);
**public address only — never key material** (the existing `_assert_no_key_material()` guard applies;
FR-003, SC-006). It is a read input for a **live** balance read, **not** a persisted balance ledger (FR-015).
Documented in `DEVELOPMENT.md` in the same change.

## Admin-revenue Safe-balance wire shape (in-app — `apps/web/src/app/admin/revenue/…`, fed by feature 013)

The read-only shape the admin revenue dashboard's Safe card exchanges. **Live on-chain read**
(`eth_getBalance` + ERC20 `balanceOf`), not persisted — this feature supplies the address + the
requirement, not the persistence layer (013 owns the card).

```ts
type SafeBalanceCard = {
  configured: boolean;                 // false ⇒ honest-degrade ("cannot load"), never a fabricated figure (FR-014)
  address: Address | null;             // the FEE_WALLET_ADDRESS Safe (null when unconfigured)
  native: { raw: string; decimals: 18 } | null;      // live eth_getBalance
  tokens: Array<{ token: Address; symbol: string; raw: string; decimals: number }>; // live balanceOf per fee token
};
```

**Invariants**: `configured:false` when the RPC read is unavailable (mirrors `admin_usage.py`
honest-degrade) — never a number in that state (FR-014, SC-005); a real **zero** balance renders as a real
zero, never a placeholder/sample figure (US5 acceptance #3); no persisted/cached figure is treated as
truth (Principle III).

## Trust Center / fees permissions view (in-app — `apps/web/src/app/(app)/trust/permissions/page.tsx`, `apps/web/src/app/(app)/fees/page.tsx`)

The proof surface. **No data-source change**: the fees page and `NonCustodyBadge` already read
`vault.feeRecipient()` live, so they show the Safe automatically the moment the Timelock `execute` lands.
The Trust Center permissions view surfaces the Safe's exact (nil) authority over user funds.

| Displayed fact | Source | Notes |
|---|---|---|
| current fee recipient | live `vault.feeRecipient()` (existing read) | Reflects the Safe post-execute, **no** bespoke data source (FR-012, SC-003). |
| Safe's power over user funds | derived from chain (not guardian; no withdraw/redeem path) | Provable **none** — not asserted copy (FR-012, Principle III / N5). |
| withdraw-always exit | unchanged path | The Safe cannot block, delay, or capture an exit (FR-013, N2, SC-004). |

**Invariants**: the surfaces represent the Safe's authority over user funds as **nil** — provable from
chain, not asserted (Principle III); the withdraw-always path is **never** touched (N2); the fees-page copy
may note the treasury is a multisig, but its **data source is unchanged**.
