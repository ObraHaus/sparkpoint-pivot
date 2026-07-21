# Quickstart: Fee Treasury Multisig Migration

How to stand up the fee-treasury Safe, run the Timelock ceremony, move the Robinhood constant, and verify
each user story locally + on the dev/staging (alpha) environment. The substantive change is **operational,
not code**: a Safe created through the Safe UI and a Timelock governance ceremony against the
already-deployed vault. There is **no database migration**.

## Prerequisites

- Node 20 (`.nvmrc`), **pnpm 9 (NOT 11 — see the pnpm-version trap)** for any web dep change.
- Python 3.12 + `uv` for `services/agent`.
- Foundry (`cast` / `forge`) for the Timelock ceremony and the fork test. `solc 0.8.24`, `evm_version cancun`.
- A funded deployer key on Base Sepolia (84532) that is the Timelock's **proposer + executor** (the testnet MVP config).
- `pnpm install --frozen-lockfile` at the repo root.
- **No** `@safe-global/*` / Safe SDK is added — the Safe is created via `app.safe.global` (UI), not Foundry.
- The two new signer keys live **outside the repo** at `/home/hello/project/.claude/testnet-wallets.txt` (`0600`, testnet only). **Never** commit them (FR-003).

Fixed on-chain facts (Base Sepolia 84532):

| Thing | Address |
|---|---|
| Vault | `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2` |
| Guardian = OZ `TimelockController` (`minDelay` 60s; deployer = sole proposer/executor/admin) | `0x0A21A9B4c2cd2d6a68EC828188826B673572d720` |
| Fee recipient **today** (deployer EOA) | `0xA71e24359A6cb7A939aae2d62dD12b6256365c30` |
| Safe signer 1 (deployer) | `0xA71e24359A6cb7A939aae2d62dD12b6256365c30` |
| Safe signer 2 (new) | `0x867ED872388D9fB613892E0a73c696c2207E5fEb` |
| Safe signer 3 (new) | `0x122DAB67a798179304CFEe0CD143b121E7A805Ed` |

## Apply the migration

**None.** This feature introduces **no migration** and no new table (D9/FR-015). The latest migration on disk
remains `0015_limits.sql`. (The parallel 012/013 work is claiming provisional `0016`/`0017` — those numbers
are provisional and must be reconciled with the 010/011 work before applying; 014 claims none.) The only
persisted change is config: the Safe address in the address book + the non-key `FEE_WALLET_ADDRESS` agent
constant; admin-revenue balances are live on-chain reads.

## Run

```bash
# 1) Create the 2-of-3 Safe on Base Sepolia via the Safe web app (NOT Foundry, NOT an SDK):
#    app.safe.global → New Safe → Network: Base Sepolia → owners:
#      0xA71e24359A6cb7A939aae2d62dD12b6256365c30  (deployer)
#      0x867ED872388D9fB613892E0a73c696c2207E5fEb  (new)
#      0x122DAB67a798179304CFEe0CD143b121E7A805Ed  (new)
#    → threshold 2 → deploy. Capture the Safe address as $SAFE.

# 2) Record $SAFE as the address of record (address-book field + non-key agent constant):
#    - packages/shared/src/addresses/baseSepolia.ts  → feeTreasury: $SAFE
#    - services/agent env  → FEE_WALLET_ADDRESS=$SAFE   (public address only; DEVELOPMENT.md)

# 3) The Timelock ceremony (US2) — as PROPOSER, schedule setFeeRecipient(Safe):
DATA=$(cast calldata "setFeeRecipient(address)" $SAFE)
SALT=$(cast keccak "sparkpoint-fee-recipient-migration-v1")   # a FRESH salt; record it with the schedule tx
cast send $TIMELOCK "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  $VAULT 0 $DATA 0x0000000000000000000000000000000000000000000000000000000000000000 $SALT 60 \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_KEY

# Verify BEFORE executing (D12): re-derive the operation id and confirm the queued calldata:
cast call $TIMELOCK "hashOperation(address,uint256,bytes,bytes32,bytes32)" \
  $VAULT 0 $DATA 0x00..00 $SALT --rpc-url $BASE_SEPOLIA_RPC
cast call $TIMELOCK "isOperationPending(bytes32)" $OP_ID --rpc-url $BASE_SEPOLIA_RPC

# Wait >= minDelay (60s on testnet), then as EXECUTOR:
cast send $TIMELOCK "execute(address,uint256,bytes,bytes32,bytes32)" \
  $VAULT 0 $DATA 0x00..00 $SALT --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_KEY

# Confirm settlement (NOT the execute receipt alone) — a live read at sufficient depth:
cast call $VAULT "feeRecipient()(address)" --rpc-url $BASE_SEPOLIA_RPC   # → $SAFE

# 4) Robinhood 46630 (US3) — edit the constant + REDEPLOY web (not done until both):
#    packages/shared/src/addresses/robinhoodTestnet.ts → swapFeeRecipient: $SAFE
#    then redeploy apps/web on Coolify (COOLIFY.md).

# App surfaces (already live-reading; no data-source change):
pnpm --filter @sparkpoint/web dev   # fees page + Trust Center reflect feeRecipient() live; admin revenue Safe card
```

## Verify by user story

**US1 — stand up + record the Safe (🎯 MVP).** Create the 2-of-3 Safe via `app.safe.global` with the three
signers and threshold 2; confirm `getAddresses(84532).feeTreasury` and the agent's `FEE_WALLET_ADDRESS`
both resolve the **same** single Safe address (no code path resolves two treasury addresses); grep the repo
+ committed config for any signer private key/seed and confirm **none** is present. Accrue a fee before
US2 and confirm it still lands on the current recipient (recording the address moves no money).

**US2 — re-point the vault fee via the Timelock (🛡️).** Attempt `vault.setFeeRecipient($SAFE)` directly
from the EOA → confirm it **reverts** (`NotGuardian`) and the recipient is unchanged. `schedule` the exact
encoded call with delay ≥ `minDelay`; attempt `execute` before the delay → confirm the Timelock **rejects**
it. After the delay, `execute` → confirm `msg.sender` is the Timelock, `FeeRecipientUpdated` is emitted, a
live `feeRecipient()` returns the Safe, and the **vault address + immutable guardian are unchanged** (no
redeploy). Then do a Base-Sepolia swap and confirm its routing fee pays the Safe **automatically** (fallback
to the live `feeRecipient()`), with no separate config change.

**US3 — move the Robinhood 46630 fee.** Edit the `robinhoodTestnet.ts` `swapFeeRecipient` to the Safe and
redeploy web; confirm a 46630 swap now pays the Safe. Confirm that **before** the redeploy the old value was
still shipped (the constant edit alone does not move the 46630 fee). Confirm the US2 Timelock change did
**not** affect 46630 (it has no vault).

**US4 — prove nil power on the Trust Center / fees page (🛡️).** After US2 executes, load the fees page +
Trust Center and confirm the displayed fee recipient equals the Safe (a **live** read, no page data-source
change); confirm the permissions view represents the Safe's authority over user funds as **none** (not the
guardian, no withdraw/redeem path) — provable from chain; perform a withdraw/redeem and confirm it is
entirely **unaffected** (the Safe can't block, delay, or capture it).

**US5 — operators see the Safe's balances.** With the Safe recorded + funded on testnet, open the admin
revenue dashboard and confirm it shows the Safe's real native + fee-token balances from a **live** on-chain
read; disable the RPC read path and confirm the card degrades honestly (`configured:false`, "cannot load")
rather than a number; with an empty Safe confirm it shows a real **zero**, not a placeholder.

## Tests

```bash
# Contracts — Foundry fork test locking the ceremony semantics
cd contracts && forge test --match-path 'test/**/FeeRecipientMigration*.t.sol' -vvv
#   asserts: direct EOA setFeeRecipient reverts NotGuardian; schedule → (pre-delay execute reverts) → wait →
#   execute succeeds, emits FeeRecipientUpdated, feeRecipient()==Safe, vault address + guardian unchanged;
#   zero-address recipient reverts ZeroAddress.

# Web — address-book resolution (single canonical treasury per network; 46630 constant == Safe)
pnpm --filter @sparkpoint/shared test
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/fees.spec.ts   # domcontentloaded + long hydration budget (CPU-starved box)
#   fees page + Trust Center reflect the Safe live post-execute; admin-revenue Safe card real-or-honest-degrade.

# Repo hygiene — no signer key/seed committed
git grep -nE '(PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|mnemonic|seed phrase)' -- . ':!*.md' || echo "clean"
```

Cover: the Timelock ceremony (revert-on-EOA, pre-delay-reject, execute-succeeds, event + live re-read,
vault/guardian unchanged, zero-address reject), single canonical treasury per network, 46630 constant ==
Safe (with the redeploy caveat), fees/Trust-Center live reflection, admin-revenue honest-degrade,
withdraw-always untouched, no key committed.

## Living docs to update (same change)

- `CHANGELOG.md` — `## [Unreleased]` bullets (Safe as fee treasury; the Timelock `setFeeRecipient` ceremony; the 46630 constant move; `FEE_WALLET_ADDRESS` + `feeTreasury` address-book field).
- `services/agent/content_seed/whats-new.json` — a client-facing entry (stable slug): the fee treasury is now a 2-of-3 multisig, provably with no power over user funds.
- `DEVELOPMENT.md` — the new `FEE_WALLET_ADDRESS` env var + the `feeTreasury` address-book field.
- `DEPLOYMENT.md` — the Safe creation + the Timelock `schedule`/`execute` ceremony (tx hashes, salt, before/after recipient — FR-016).
- `COOLIFY.md` — the 46630 web redeploy (the constant change is not "done" until web ships).
- `MIGRATIONS.md` — **no new migration** (latest remains `0015_limits`); record explicitly that 014 adds none.
