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
- [x] **T022** ✅ Ratified 2026-07-30 — constitution at **v3.0.0**, amendment log appended, proposal marked APPLIED,
      `CLAUDE.md` version pointer corrected (it still said v1.3.0 while the constitution was v2.0.0).
- [ ] **T023** Stop the feature-011 pre-mainnet audit spend (T035) on the superseded contracts.
- [x] **T024** ✅ **DONE** (fee copy is now keyed on a central `VaultFeeBasis`). ⚠️ **RATIFIED OBLIGATION — blocks any Fee Wrapper deposit.** Make the performance-fee copy
      conditional on vault kind, so a Fee Wrapper can never inherit the launch vault's "over a high-water
      mark" wording. Vault V2 keeps **no HWM state** (verified: `interest = newTotalAssets.zeroFloorSub(_totalAssets)`),
      so a gain after an earlier loss IS charged. The current copy is accurate **today** — the Aave launch
      vault has a real `_highWaterMark` — so this is a *conditionalisation*, not a deletion. Sites:
      `components/NonCustodyBadge.tsx:134`, `app/(app)/fees/page.tsx:173,178,199`,
      `app/(app)/vault/page.tsx:216,236`, `lib/chain/useVault.ts:188`.
      Honest Fee Wrapper wording: *"charged only when the vault gains value over a period — never on your
      principal, and never while it is flat or falling. Note a gain following an earlier loss is charged,
      even if you are still below your previous high."*

      **As shipped:** `VaultFeeBasis` (`high_water_mark` | `per_period_gain`) is derived CENTRALLY from the
      vault kind — `lib/policy/feeCopy.ts` + `useVault().feeBasis` (web), `policy/fee_copy.py` (agent) — never
      per call site. `PERFORMANCE_FEE_DISCLOSURE` kept byte-identical so 015/FR-006 verbatim parity and the
      §3.7 wire output are unchanged. `performanceFee.base` gains `period_interest_no_hwm`; `highWaterMark`
      became nullable (a V2 has no such selector; `"0"` would read as "the mark is at par").
      **Four sites this task list did not name, also fixed:** the withdraw receipt note in
      `vaultConfirmModel.ts` (asserted HWM in BOTH branches); `agents/literacy.py`'s canned answer (the
      assistant asserting it unqualified, with no vault context available); `NonCustodyBadge.tsx`'s
      "immutable — governance can never exceed it" fee-cap claim, which v3.0.0 downgrades to a policy
      commitment on the Fee Wrapper path; and `knowledge_seed/profit-only-vault.md`. `/fees` had its claims
      SCOPED to the launch vault it actually reads, and deliberately does not describe a Fee Wrapper — none
      exists, and advertising one would fabricate a capability.

## Phase 2 — Registry (advisory half NOT gated) ✅ SHIPPED (except applying 0026)

- [x] **T030** ✅ Migration `0026_vault_registry.sql` written + validated (rolled-back txn, savepoint per CHECK). **STILL NOT APPLIED to develop** — needs operator sign-off. Go-live order: apply → redeploy agent → verify `/admin/vault-registry` `available: true` → only then set the flag.
- [x] **T031** ✅ Seeded inside `0026` (Aave launch vault `live`; retired demo wrapper `redeem_only`; mock target recorded `rejected`). The seeded launch address was confirmed to equal the live on-chain vault by `policy-parity 84532`, which is what makes T032's flag-off path byte-identical.
- [x] **T032** ✅ `chain/vault_resolution.py` + `db/vault_registry.py`, gated on `SPARKPOINT_VAULT_REGISTRY_ENABLED` (default off ⇒ env value verbatim, **no DB round-trip**). Fail-OPEN: an unmigrated/unreachable registry falls back to the env var and warns once per chain, because a display table must never take a funded vault offline (N2). Returns a bare address string, so no row content can reach the policy path (IV.5(d)). ONE resolution per request — `VaultReader.vault_address` is now the single source, and `/build-tx` + both `/vault/simulate/*` read it from there instead of re-reading config (previously `/build-tx` resolved a second time, which with the registry live could price a quote against one vault and emit calldata for another).
- [x] **T033** ✅ *(partial by design, and documented as such)* Each row now names its OWN chain and states when live reads are out of scope for it; `scan()` is chain-aware via the shared registry (it was hard-coded to Sepolia while the endpoint returns rows for every chain, so a Base-mainnet wrapper linked into Sepolia's explorer). Plus a new advisory `GET /admin/vault-registry`. **`CHAIN_ID` deliberately stays a constant:** a selector would offer chains the backend cannot serve — the agent's `SPARKPOINT_VAULT_FACTORY_ADDRESS` is a single global env, and `API_SUPPORTED_CHAIN_IDS` rejects 4663. Those two + the `sendTransaction`-without-`chainId` gap are Phase 5/6.
- [x] **T035** ✅ *(from plan.md Layer 3)* Chain metadata collapsed onto one LEAF registry `packages/shared/src/chains/` (`@sparkpoint/shared/chains`): three independent chainId→explorer maps and two independent chain lists folded into one. Leaf-ness (no relative imports, no enums, no viem/wagmi) is what lets a web unit test VALUE-import it under `--experimental-strip-types`, and `chainMeta.test.ts`'s value import IS that assertion. Duplication vs policy `CHAIN_ID` is checked by a compile-time parity guard (`chains/parity.ts`), verified to fire on a deliberate drift. **Fixed two wrong-chain-explorer bugs:** `app/exit/page.tsx` returned basescan.org for ANY non-84532 chain (so Robinhood txs linked to Base mainnet — on the page whose job is proving you can verify and exit), and `ExecutionDrawer.tsx` silently rendered no link on Robinhood.
- [x] **T034** ✅ `contracts/script/vault-eligibility-check.sh` + `.github/workflows/vault-eligibility.yml` (oh-ci, timeout, concurrency, fork guard) + `contracts/deployments/vault-candidates.json`. Read-only (`cast call` only, no key), DB-free. **All 3 candidates verified PASS live** on 8453 + 4663 via public RPCs, no secrets. **Negatives proven to FAIL:** wrong asset, non-VaultV2 address, tampered selector, and a real 25%-fee vault vs a 0bps ceiling. Selectors recomputed with `cast sig` and re-derived at runtime. **Caught a bash 64-bit overflow** — `wad*10000` for a 25% fee wrapped to −8bps and PASSED a 0bps ceiling; moved to python3, rounded up. **Liquidity floor NOT asserted, and the script says so:** withdrawable liquidity needs Morpho's indexer, and idle balance is useless for it (Steakhouse Prime USDC: $567M totalAssets, 0 idle).

## Phase 3 — Real Morpho on Base Sepolia **[GATED — ungated by v3.0.0; SIMULATED, NOT YET BROADCAST]**

> **Status 2026-07-30.** The full deploy sequence is written, committed and **validated end to end on
> an anvil fork of Base Sepolia against the real deployed factory** —
> `contracts/script/deploy-vault-v2-base-sepolia.sh --simulate` runs 43 receipt-checked transactions
> and ends with the vault owned + curated by the 2-of-3 Safe, the dead deposit placed, name/symbol
> carrying no "morpho", fees 0/0, and the result passing FR-020. **The real broadcast has NOT been
> run.** It is a one-shot, irreversible, ~43-transaction sequence from an EIP-7702-delegated deployer
> whose known failure mode is a silent missing receipt, so it wants a dedicated pass with attention
> on every receipt — not a tail-end of a long session. Run
> `bash contracts/script/deploy-vault-v2-base-sepolia.sh --broadcast`; it refuses any chain but
> 84532, aborts on the first missing/failed receipt, and re-checks the dead-deposit cost live before
> spending. Findings that de-risked it are in `research.md` §5.


- [x] **T040** ✅ *(superseded, deliberately)* No vendoring needed and none done: the vault is deployed BY Morpho's already-deployed factory, so the whole sequence is `cast` calls against the REAL bytecode — strictly better evidence than a fork test over a recompiled copy, and it sidesteps this repo's solc 0.8.24 pin. `FeeWrapperDeployer` cannot run on 84532 anyway (no `MorphoVaultV1AdapterFactory`).
- [x] **T041** ✅ SIMULATED end-to-end (not broadcast). Script: `contracts/script/deploy-vault-v2-base-sepolia.sh`. Fork result: vault `0x756C41dD…2170` (deterministic — `factory.vaultV2(owner,asset,salt)` is a view, so the real address is pre-computable), adapter `0x4C4dCd2e…8E24`, asset = Circle USDC `0x036CbD53…`, into live Blue market `0x01351cf8…0bfb`.
- [x] **T042** ✅ SIMULATED. All three critical gate setters + `setAdapterRegistry` abdicated and re-read as `true` before the script will continue; timelocks 259200s on all 7 curator selectors with `increaseTimelock` LAST; owner + curator = Safe `0xCB135893…578f`, sentinel too. **Ordering bug found and fixed by running it:** timelocks MUST precede the role handover — `submit` is curator-gated, so after `setCurator(Safe)` the deployer gets `Unauthorized` (0x82b42900). Morpho's docs list roles before timelocks, which only works if the new curator does them.
- [x] **T043** ✅ **CONFLICT SETTLED BY MEASUREMENT.** The dead-deposit page is right; the vault-creation page's Phase-8 comment is wrong. On the fork: `virtualShares()` = 1e12, `previewMint(1e18 shares)` = **exactly 1000000 base units = 1.000000 USDC**, and after `mint(1e18, 0xdead)` the vault holds 999999 assets with 1e18 shares at `0xdead`. The argument is SHARES. As *assets* the other reading means 1,000,000 USDC (absurd); as shares it means 0.000001 USDC (far too small to defend anything). The script now **guards** this — it reads `previewMint` live and aborts unless the cost is exactly 1000000, because the step cannot be undone.
- [ ] **T044** Resolve the two-USDC problem (D4): model both test assets in the registry. *(The deploy uses Circle's `0x036CbD53…` — Morpho's markets' USDC — while the Aave launch vault uses `0xba50Cd2A…`. `0026` already carries `asset_address` per row, so this is the registry ROW for the new vault, pending the broadcast.)*
- [x] **T045** ✅ Verified on the fork against the real V2: deposit 2 USDC → `redeem` ALL shares → **full principal returned, shares 0** (the N2 exit); `maxDeposit/maxMint/maxWithdraw/maxRedeem` **all returned 0** as documented (never derive a UI limit from them); `forceDeallocate(address,bytes,uint256,address)` = `0xe4d38cd8` present, penalty 0.
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

- [x] **T080** ✅ Both changelogs updated in the same beat for the Phase-2 work — repo `CHANGELOG.md` + in-app `whats-new.json` (`fee-wording-now-follows-each-vault`).
- [x] **T081** ✅ *(partial)* `MIGRATIONS.md` (0026 is no longer "inert" — it is read behind a flag; go-live order recorded), `DEVELOPMENT.md` (**new CI section** — the playbook's oh-ci fleet rules were undocumented here; plus the `/admin/vaults` single-global-factory-env blocker), `COOLIFY.md` (the new optional env var). `docs/architecture-as-built.md` still pending.
- [ ] **T082** Reword the `_decimalsOffset` NatSpec (offset is 0, not the implied stronger guarantee).
- [ ] **T083** Annotate or unpublish the inert `AaveV3Adapter` / `KillSwitch` addresses on 84532.
