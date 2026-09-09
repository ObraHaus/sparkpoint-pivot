# Base Sepolia (84532) — testnet Morpho-wrapper demo deploy

> ## ⛔ RETIRED 2026-07-30 (feature 024) — deposits closed, withdrawals open
>
> **Why.** The wrapper's underlying `0x7f37…8420` is the test-tree `MockMorphoVault`
> (`contracts/test/mocks/Mocks.sol:283-350`). Its simulation hooks — `simulateYield`, `simulateLoss`,
> `lendOut`, `setAvailableLiquidity`, `setMaxReturnsZero` — are all plain `external` with **no access
> control**, so any anonymous caller on Base Sepolia can move the wrapper's share price or drain its
> withdrawable liquidity. The wrapper's `morphoVault` is a constructor **immutable**, so this cannot be
> repaired by re-pointing it — only by retiring the wrapper.
>
> **What changed.** `packages/shared/src/addresses/baseSepolia.ts` marks the row `retired: true`.
> Deposit fail-closes in `deriveVaultConfirm` (`depositSignable === false`, CTA
> "Vault retired — withdrawals only"). **Withdraw, redeem and the `/portfolio` row are untouched** —
> N2 says only underlying liquidity may ever block an exit, never a SparkPoint decision. The row is
> deliberately *kept* (not deleted) so a holder deep-linking `?vault=0xff0a…E9BB` still resolves to the
> wrapper instead of silently falling back to the launch vault.
>
> **The premise below is also now false.** "Morpho has no curated testnet vaults" was the stated reason
> for the mock. Verified on-chain 2026-07-30: Base Sepolia runs **Morpho Blue**
> `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` (live markets, real supply/borrow), the **MetaMorpho V1.1
> factory** `0x2c3FE6D71F8d54B063411Abb446B49f13725F784` (50 vaults created) and the **Vault V2 factory**
> `0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0`. Feature 024 Phase 3 replaces this mock with real Morpho.
>
> **Not done here (needs a signer):** the on-chain `factory.allowlistMorphoVault(mock, false)` call, via
> the Timelock. That blocks *future* deploys only and can never affect the deployed wrapper (N2).

Deployed 2026-07-21 to give the alpha vault picker a real 2nd vault (Morpho has no curated testnet vaults).

| Contract | Address | Notes |
|---|---|---|
| MockMorphoVault (curated target) | `0x7f377fe96DaD2eEa494F0fb095233EF4aB438420` | TESTNET DEMO MOCK — standard ERC-4626 over the launch test USDC. NOT a real Morpho vault. Flat 1:1 pps (deployer can't mint USDC → no yield sim). |
| TimelockController (owner/guardian) | `0xE7b9FfB970A38E686Efb7188290148EB3f8255B5` | minDelay 0 (testnet MVP; deployer = sole proposer/executor/admin). |
| SparkPointVaultFactory | `0x2774D4b0Af206b8F489BF1db9d8FAFbB17D36D8b` | owner = timelock; USDC = 0xba50..; feeRecipient = deployer. |
| SparkPointMorphoVault (wrapper) | `0xff0a43FA397a90c1277C96A783e1171e1efbE9BB` | label "SparkPoint Morpho USDC", symbol spMORPHO, 10% perf fee. isSparkPointVault=true. |
| USDC (launch test token) | `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f` | same USDC as the launch Aave vault (0x15D2..). |

## Key txs
- Mock deploy: `0x6b0a52a0a00f775697467821f283891bd188911b3f1c3928adee30003b2095bb`
- Factory + Timelock deploy: via `DeployMorphoWrapperFactory.s.sol` (partial forge broadcast; delegated-EOA in-flight limit)
- allowlist(mock): landed via the partial broadcast (`factory.isAllowlisted(mock)=true`)
- createVault schedule: `0x3f176af3d8f37a545bc3c01e01d8ca4276e314e9814e46a7fcd3ecea0bce68eb`
- createVault execute: `0xcff750617f6b395ea4f0b54e728f4b3fef3f20ffdb9b6846644bdafd483550e4`
- seed approve + deposit 25 USDC: `0x4d9e597dc7a30e68f8d1a1b371065c525b99f9ded77291781a77bc4bff52519f`

## e2e validated on-chain
deposit 25 USDC → wrapper.totalAssets=25e6, deployer shares=25e6, mock.totalAssets=25e6, maxWithdraw=25e6 (N2 exit clear).

## Provenance recorded (develop DB, migration 0016)
- `sparkpoint_wrappers`: wrapper row status=`live`.
- `morpho_curated_allowlist`: mock row status=`allowlisted`, vetting_notes flag it a TESTNET DEMO MOCK (do NOT promote to mainnet).

## Deploy gotchas (for the real mainnet deploy later)
- The deployer EOA is EIP-7702 **delegated** → Alchemy throttles in-flight/gapped-nonce txs. `forge script --broadcast` (pipelined) trips "in-flight transaction limit reached for delegated accounts". Use `--slow`, or drive the timelock schedule/execute with sequential `cast send` (each waits for its receipt). `--resume` desynced on the cache nonce.
- `TIMELOCK_MIN_DELAY=0` is REQUIRED for a single-run testnet broadcast (the script's `vm.warp` skips the delay only in simulation; on a real broadcast the execute is mined seconds after schedule, so a >0 delay reverts). Production uses a real delay + a Safe in front + a **separate** schedule/execute cadence.
- `forge create --constructor-args` is variadic — put it LAST or it swallows `--rpc-url`/`--private-key`.

## Still TODO (blocked on file-editing tools being down this session)
- Address book `packages/shared/src/addresses/baseSepolia.ts`: add `sparkPointVaultFactory` + wire the wrapper for the picker.
- Agent Coolify env `SPARKPOINT_VAULT_FACTORY_ADDRESS=0x2774D4b0Af206b8F489BF1db9d8FAFbB17D36D8b` (develop) + redeploy → /admin/vaults factory reads.
- `deployments/84532/addresses.json`: add SparkPointVaultFactory + wrapper.
- The UI vault picker itself.
