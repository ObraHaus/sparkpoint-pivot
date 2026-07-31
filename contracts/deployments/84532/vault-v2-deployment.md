# Morpho Vault V2 — Base Sepolia (84532) deployment record

**Feature 024 Phase 3. Broadcast 2026-07-30. 52 receipt-checked transactions, nonce 67 → 119.**

This is the vault that replaces the retired demo wrapper (`testnet-wrapper-notes.md`), whose
underlying was a mock with unpermissioned simulation hooks. Nothing here is a mock and nothing here
is bespoke SparkPoint custody Solidity — constitution v3.0.0's organising rule is "stop writing
custody-critical Solidity; configure Morpho's instead."

## Addresses

| What | Address |
|---|---|
| **Vault V2** (deposit/withdraw target) | `0x756C41dD33481620EbCB0357F759d31c9eE72170` |
| Market adapter (`MorphoMarketV1AdapterV2`) | `0x4C4dCd2e2Bb985a606C1e7d4822bB330637D8E24` |
| Asset — **Circle** USDC, 6 dp | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Morpho `VaultV2Factory` (creator) | `0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0` |
| Adapter factory | `0xa24674Cc2c603FBA8AE6b442E3dB05f3dDaAa3D5` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| Morpho adapter registry | `0xCED92dd29B6E99120DD41CB79321126Abd5852b2` |
| Target Blue market id | `0x01351cf859346bbae655f1c9da71ba0e9ad201dd79a276c28f34e574386b0bfb` |
| Owner + curator + sentinel | the 2-of-3 Safe `0xCB135893C84876aab9E10792b56e5bEa91dc578f` |
| Deployer | `0xA71e24359A6cb7A939aae2d62dD12b6256365c30` (EIP-7702 delegated) |
| Role-handover tx (`setOwner`) | `0x5f44f1af009a303da311ccfc4698d4511acfa9ccf6ad01847f8d7f06c11958fd` |

Reproduce with `bash contracts/script/deploy-vault-v2-base-sepolia.sh --simulate` against an anvil
fork; the script header is the deployment's full reasoning.

## THE TWO USDCs — read this before touching any amount

Base Sepolia genuinely has two tokens that both report `symbol() == "USDC"` at 6 decimals:

- `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f` — Aave's market test USDC. This is what the rest of
  the 84532 address book calls **`usdc`**, and what the Aave launch vault's `asset()` is.
- `0x036CbD53842c5426634e7929541eC2318f3dCF7e` — **Circle's**. This is what Morpho's markets use, and
  therefore **this vault's `asset()`**.

They are not interchangeable. This is why `MorphoFeeWrapper.asset` is a required field rather than
inherited from the chain's `usdc`, and why `vault_registry.asset_address` is per-row.

## 6-dp asset, 18-dp shares

`decimals()` on the vault is **18**; `virtualShares()` is **1e12**. A Vault V2 applies a decimals
offset, so share decimals ≠ asset decimals. Scaling a USDC amount with the share decimals is a 1e12
error. `assetDecimals` and `shareDecimals` are stored separately in both the address book and the
registry for exactly this reason.

The existing `useVault` decimals read documents an invariant (`_decimalsOffset() == 0`, so
share-decimals == asset-decimals) that holds for SparkPoint's own ERC-4626s and **does not hold
here**.

## Verified live after the handover

All read back from chain, not taken from the script's own output:

```
isVaultV2(vault)                          true
name / symbol                             "SparkPoint USDC Yield" / "spUSDCv2"   (no "morpho" — FR-022)
asset                                     0x036CbD53…CF7e  (Circle)
decimals / virtualShares                  18 / 1e12
owner / curator                            0xCB135893…578f  (both the Safe)
isSentinel(Safe)                          true
abdicated(setReceiveSharesGate 0x2cb19f98) true
abdicated(setSendSharesGate    0xc21ad028) true
abdicated(setReceiveAssetsGate 0x04dbf0ce) true
abdicated(setAdapterRegistry)              true
timelock(all 7 curator selectors)          259200   (3 days)
isAdapter(adapter) / liquidityAdapter      true / the adapter
adapterRegistry / maxRate                  0xCED92dd2…52b2 / 63419583967
totalAssets / totalSupply                  999999 / 1e18
balanceOf(0xdead)                          1e18
performanceFee() / managementFee()         0 / 0        (WAD-scaled: 1e18 == 100%)
previewRedeem(1e18)                        999999       (the exit prices correctly)
```

`contracts/script/vault-eligibility-check.sh 84532` re-run against the live vault: **PASS**
(provenance · three critical gates abdicated · asset match · native fee ceilings). The vault is now a
declared candidate in `contracts/deployments/vault-candidates.json`, so this is enforced on every PR.

### N2 — the exit

The three critical gate setters are **permanently abdicated**, so no role holder — us included —
can ever install a gate that blocks share or asset movement. That was the one real N2 hole in a
Vault V2, and `abdicate(bytes4)` is irreversible, so asserting it is asserting the hole is shut
forever. `forceDeallocate(address,bytes,uint256,address)` (`0xe4d38cd8`) is present with penalty 0.

**`maxDeposit` / `maxMint` / `maxWithdraw` / `maxRedeem` are all `pure returns (0)` on a V2** and are
NOT enforced inside `deposit`/`withdraw`. **Never derive a UI limit from them** — a naive read would
show "you cannot withdraw", which is both false and precisely the wrong thing to tell a holder.

## Fees

Native `performanceFee()` and `managementFee()` both read **0**. SparkPoint's fee on this vault *is*
the V2's own `performanceFee()` — there is no child vault to stack on, and the Blue market charges no
vault-level fee (its market fee reads 0). Raising it is a curator action by the Safe behind a 3-day
timelock, and `vault_registry.sparkpoint_fee_bps` must follow it.

Note `performanceFee()` is **WAD**-scaled (1e18 == 100%), not bps. Converting needs exact integer
arithmetic: `wad * 10000` reaches 1e22 for a 25% fee and wraps in 64-bit signed arithmetic — a bug
the eligibility gate hit and fixed by moving to `python3` and rounding up.

**No high-water mark.** A Vault V2 keeps none (`interest = newTotalAssets.zeroFloorSub(_totalAssets)`),
so the fee basis is `per_period_gain` (T024): a gain following an earlier loss **is** charged even
while a holder is below their previous peak. The registry `kind = 'fee_wrapper'` is what makes the
honest copy apply.

## APY is `unavailable`, deliberately, and must never be 0

Morpho's API covers no testnet — chainId 84532 is rejected outright. So on this chain the only legal
`vault_apy_snapshots` write is `source = 'unavailable'` with `net_apy_bps` **NULL**. A `0` would be a
fabricated yield, and the `vault_apy_unavailable_is_null` CHECK enforces it.

## Registering it

`contracts/deployments/84532/vault-registry-row.sql` — a committed, idempotent ops SQL file, run once
by an operator. It is deliberately **not** a yoyo migration: `0026` is already applied and
`yoyo apply` applies every pending migration including other features'. There is no programmatic
write path for `vault_registry` anywhere in the service, by design.

The row is **inert today** and that is expected, not broken: vault resolution hard-filters
`kind = 'first_party' AND status = 'live'`, so a `fee_wrapper` row cannot move the deposit target.
Its only visible effect is the `vaults` array in `GET /admin/vault-registry` — verify there, not in
the logs.

## Known posture and follow-ups

- **The deployer is still an allocator** (`isAllocator(deployer)` true). `setIsAllocator` is not
  timelocked, so the Safe can revoke it immediately. Blast radius is moving assets between idle and
  the single approved Blue market — no custody path — but this **must not carry over to a mainnet Fee
  Wrapper**.
- **T046 is blocked by design.** The retired mock wrapper still has a holder (`totalSupply()` =
  `50000000`, all held by the deployer). N2 says a holder keeps a first-class exit, and the registry
  row is what keeps the picker resolving it and withdraw ungated — so it stays until
  `totalSupply()` is 0.
- **The canonical Fee Wrapper path did not run here.** `FeeWrapperDeployer` needs
  `MorphoVaultV1AdapterFactory`, which has no bytecode on 84532. So this is a plain Vault V2 +
  market adapter into a Blue market — a **rehearsal** for the mainnet Fee Wrapper, not the Fee
  Wrapper itself. Phases 5/6 (Base mainnet 8453, Robinhood 4663) remain gated on a full external
  audit.

## RPC lag — the operational lesson

The broadcast took four attempts. **All three failures were the same root cause, RPC view lag, and
none was a logic error**; each aborted safely rather than building on uncommitted state.

1. `createVaultV2` committed (status 1) but the immediate `factory.vaultV2` view returned **empty** —
   leaving the vault created and the salt spent, so a plain re-run would revert.
2. `setCurator` was **mined**, yet the pending-nonce view still counted it in flight, so the next
   `cast send` reused the nonce and the node rejected it: `replacement transaction underpriced`.
3. `exec absCap(market)` failed **gas estimation** with `TimelockNotExpired` although
   `timelock(increaseAbsoluteCap)` was 0 and the submit had a receipt — the estimator ran against a
   state view predating the submit, where `executableAt` reads 0, and V2 reverts `TimelockNotExpired`
   for 0 exactly as it does for "not yet due".

The script is now idempotent and resumable: per-step state guards, script-owned nonce, retrying view
reads, `await_executable` before every exec, adoption of a pending submit (re-submitting reverts
`DataAlreadyPending` `0xd91ff208`), and a tx hash printed on every step. Rehearsing each resume on a
fork of the **then-current** live block — not a stale one — caught failure (3) and
`DataAlreadyPending` before either cost a live transaction.
