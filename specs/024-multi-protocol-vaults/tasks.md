# Tasks — 024 Multi-Protocol Vaults

Legend: `[x]` done in this PR · `[ ]` not started · **[GATED]** blocked on constitution v3.0.0.

## Phase 0 — Retire the tamperable mock (NOT gated) ✅

- [x] **T001** Add `retired` / `retiredReason` to `SparkPointWrapper` (`packages/shared/src/addresses/types.ts`).
- [x] **T002** Mark the Base-Sepolia demo wrapper retired, with the reason, in `baseSepolia.ts`.
- [x] **T003** Thread `retired` through `VaultOption` (`vaultOptions.ts`).
- [x] **T004** Fail-close deposit in `deriveVaultConfirm`: `depositSignable === false`, CTA
      "Vault retired — withdrawals only". **Withdraw path untouched.**
- [x] **T005** Pass `retired` from the selected option in `_amount-screen.tsx`.
- [x] **T006** Badge the option `RETIRED` in `VaultPicker` (still selectable, so a holder reaches withdraw).
- [x] **T007** Trust Center: say "retired · withdrawals only"; **delete the false "Morpho has no testnet"
      claim** (Morpho Blue + the V2 factory are live on 84532).
- [x] **T008** Unit tests: deposit fail-closes when attested; the flag alone flips signability; **withdraw
      is byte-identical retired vs not (N2)**; launch unaffected.
- [x] **T009** Unit tests: `retired` flows through `buildVaultOptions`; a retired address still **resolves**
      (no silent launch fallback).
- [x] **T010** e2e: retired deposit CTA visible **and disabled**; withdraw still renders; picker shows RETIRED.
- [x] **T011** Record the retirement + the falsified premise in `contracts/deployments/84532/testnet-wrapper-notes.md`.
- [x] **T012** Mark feature 011 superseded in `DEVELOPMENT.md`.
- [ ] **T013** *(needs a signer, not code)* Call `factory.allowlistMorphoVault(mock, false)` via the
      Timelock. Blocks future deploys only; can never affect the deployed wrapper (N2).
- [ ] **T014** *(needs DB access)* Set the `sparkpoint_wrappers` row to a retired status and annotate
      `morpho_curated_allowlist`.

## Phase 1 — Ratify

- [ ] **T020** Operator reviews `constitution-amendment-v3.0.0.md`, especially the **fee-cap enforcement
      downgrade** and **real funds on chain 4663**.
- [ ] **T021** Confirm from `vault-v2` source whether V2's performance fee is **HWM + profit-only**. If not,
      update the disclosure, not just the wording.
- [ ] **T022** Ratify → edit `.specify/memory/constitution.md` to v3.0.0, append the amendment log entry,
      mark the proposal APPLIED.
- [ ] **T023** Stop the feature-011 pre-mainnet audit spend (T035) on the superseded contracts.

## Phase 2 — Registry (advisory half NOT gated)

- [ ] **T030** Migration `0026_vault_registry.sql`: `vault_registry`, `vault_allowlist`, `vault_apy_snapshots`.
- [ ] **T031** Backfill the two existing vaults; the retired wrapper lands as `status = 'redeem_only'`.
- [ ] **T032** Registry resolution behind a feature flag; day-one behaviour byte-identical.
- [ ] **T033** Extend `/admin/vaults` beyond its hard-coded `CHAIN_ID = "84532"`.
- [ ] **T034** FR-020 eligibility checker as a CI job: `isVaultV2`, three `abdicated(...)`, `asset()` match,
      fee reads, liquidity floor.

## Phase 3 — Real Morpho on Base Sepolia **[GATED]**

- [ ] **T040** Vendor + pin `FeeWrapperDeployer` / `DeployFeeWrapper.s.sol`; ABI-hash CI check.
- [ ] **T041** Create a real Vault V2 on 84532 via `0xE3a2CEbc…2ea0` + `MorphoMarketV1AdapterV2`
      (`0xa24674Cc…a3D5`) into a live Blue market. *(The canonical Fee Wrapper path cannot run here — no
      `MorphoVaultV1AdapterFactory`.)*
- [ ] **T042** Abdicate the three critical gate setters; timelocks ≥3 days; owner = the 2-of-3 Safe.
- [ ] **T043** **Dead deposit as the first transaction.** Reconcile the doc conflict (§research 5) and
      fork-simulate first.
- [ ] **T044** Resolve the two-USDC problem (D4): model both test assets in the registry.
- [ ] **T045** Fork tests: deposit, redeem, `forceDeallocate`, and `max* == 0` behaviour.
- [ ] **T046** Remove the mock wrapper row once no holder remains.

## Phase 4 — Honest APY (NOT gated)

- [ ] **T050** Morpho API client on `vaultV2ByAddress(ourAddress, chainId)` → `avgNetApy`; fail-open to
      "unavailable".
- [ ] **T051** Background poller → `vault_apy_snapshots`. **Never on the request path** (rate limit).
- [ ] **T052** UI: our fee, the child's fee, and the net — three separate lines.
- [ ] **T053** Retire the placeholder Morpho APY story spec 010 left open.

## Phase 5 — Robinhood mainnet 4663 **[GATED]**

- [ ] **T060** `packages/shared/src/addresses/robinhoodMainnet.ts`; chain 4663 in the policy map + SIWE list.
- [ ] **T061** Model USDG as a first-class asset (6 dp asset / 18 dp shares).
- [ ] **T062** Fee Wrapper over Steakhouse USDG `0xBeEff033…09dd`.
- [ ] **T063** Surface the liquidity ratio prominently (13.7%) **before** signature.
- [ ] **T064** State plainly that Aave is unavailable on this chain.
- [ ] **T065** Confirm 46630 still offers no vault and says why.

## Phase 6 — Base mainnet **[GATED + audit gate]**

- [ ] **T070** Fee Wrappers over **both** D2 children — Gauntlet USDC Prime `0x050cE30b…56f0` (86.6% liquid)
      and Steakhouse Prime USDC `0xbeef0e08…73C9` ($571.8M) — each showing its liquidity ratio.
- [ ] **T071** Real timelock delays; separate schedule/execute cadence with the Safe in front (**not** the
      `minDelay 0` testnet shortcut).
- [ ] **T072** Trust Center renders **live** abdication/timelock/fee state, not a static chip.

## Housekeeping (every phase)

- [ ] **T080** Both changelogs in the same beat — repo `CHANGELOG.md` **and** the in-app `/changelog`.
- [ ] **T081** Living docs: `MIGRATIONS.md`, `DEPLOYMENT.md`, `docs/architecture-as-built.md`.
- [ ] **T082** Reword the `_decimalsOffset` NatSpec (offset is 0, not the implied stronger guarantee).
- [ ] **T083** Annotate or unpublish the inert `AaveV3Adapter` / `KillSwitch` addresses on 84532.
