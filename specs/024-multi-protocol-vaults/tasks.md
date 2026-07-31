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
- [x] **T013** ✅ **DONE 2026-07-31.** `factory.allowlistMorphoVault(mock, false)` executed via the MorphoWrapperTimelock `0xE7b9FfB9…55B5` (the factory's `owner()`), which the deployer holds PROPOSER+EXECUTOR on at `minDelay 0`. schedule `0x92f9de39…192e` → execute `0x9d49c2b8…19a9`. **Verified: `isAllocated`→ `isAllowlisted(mock)` is now `false`.** N2 re-proved immediately after: the retired wrapper's holder still has `maxRedeem(deployer) = 50000000`, their full balance — revoking blocks FUTURE deploys over the mock and cannot touch the existing wrapper, whose `morphoVault` binding is a constructor immutable.
- [~] **T014** **PARTIALLY DONE 2026-07-31 — one half is blocked by the 0016 SCHEMA, not by access.**
      * ✅ **`morpho_curated_allowlist` revoked.** The mock is now `allowed=false, status='revoked'` with the
        reason appended — the canonical pairing the app's own writer produces
        (`db/vault_factory.py`: `status = "allowlisted" if allowed else "revoked"`). Applied via the
        committed, idempotent `contracts/deployments/84532/retire-mock-wrapper-rows.sql` (re-run proven
        to be a no-op: notes length identical across two passes).
      * ⛔ **`sparkpoint_wrappers.status = 'retired'` is IMPOSSIBLE without a schema change.** The live
        constraint is `CHECK (status = ANY (ARRAY['pending','live']))` — there is no retired state in
        0016. The attempt raised `CheckViolationError` and rolled back cleanly (verified: nothing partial
        landed). Widening that CHECK is a **migration against the shared develop DB**, deliberately left
        as an operator decision rather than slipped into an ops script.
      * **The retirement is nevertheless durably on record**, in the table that supersedes this one:
        migration 0026 states "`status = 'redeem_only'` is the durable form of a RETIRED vault", and
        `vault_registry` already carries this wrapper as `redeem_only`. Nothing reads 0016's `status`
        for an authorization decision — the only predicate on it anywhere is the promote-only
        `WHERE status='pending'` guard, and the user-facing picker/exit read the STATIC address book.

## Phase 1 — Ratify

- [ ] **T020** Operator reviews `constitution-amendment-v3.0.0.md`, especially the **fee-cap enforcement
      downgrade** and **real funds on chain 4663**.
- [x] **T021** ✅ **ANSWERED — it is NOT high-water-mark.** A Vault V2 keeps no HWM state at all
      (`interest = newTotalAssets.zeroFloorSub(_totalAssets)`, i.e. max(0, new − last)) and exposes no
      `highWaterMark()` selector, confirmed against the deployed contract on 84532. So the disclosure
      itself changed, not merely the wording — that finding IS the `per_period_gain` fee basis T024
      was built on.
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

## Phase 2 — Registry (advisory half NOT gated) ✅ SHIPPED · 0026 APPLIED to develop

- [x] **T030** ✅ Migration `0026_vault_registry.sql` written, validated, and **APPLIED to develop 2026-07-30 11:35:20 UTC** — applied by feature 023's `yoyo apply --batch` run as a pending migration, not by a deliberate 024 action (see MIGRATIONS.md). Verified live afterwards: 3 tables + 4 enums exist, both seed rows correct, mock `rejected`, the `unavailable_is_null` CHECK still fires, `resolve_first_party_vault(84532)` returns the launch vault, `count_live_first_party` = 1, and flag-OFF == flag-ON so flipping the flag is a verified no-op. **Remaining:** redeploy the agent, confirm `/admin/vault-registry` `available: true`, THEN set the flag.
- [x] **T031** ✅ Seeded inside `0026` (Aave launch vault `live`; retired demo wrapper `redeem_only`; mock target recorded `rejected`). The seeded launch address was confirmed to equal the live on-chain vault by `policy-parity 84532`, which is what makes T032's flag-off path byte-identical.
- [x] **T032** ✅ `chain/vault_resolution.py` + `db/vault_registry.py`, gated on `SPARKPOINT_VAULT_REGISTRY_ENABLED` (default off ⇒ env value verbatim, **no DB round-trip**). Fail-OPEN: an unmigrated/unreachable registry falls back to the env var and warns once per chain, because a display table must never take a funded vault offline (N2). Returns a bare address string, so no row content can reach the policy path (IV.5(d)). ONE resolution per request — `VaultReader.vault_address` is now the single source, and `/build-tx` + both `/vault/simulate/*` read it from there instead of re-reading config (previously `/build-tx` resolved a second time, which with the registry live could price a quote against one vault and emit calldata for another).
- [x] **T033** ✅ *(partial by design, and documented as such)* Each row now names its OWN chain and states when live reads are out of scope for it; `scan()` is chain-aware via the shared registry (it was hard-coded to Sepolia while the endpoint returns rows for every chain, so a Base-mainnet wrapper linked into Sepolia's explorer). Plus a new advisory `GET /admin/vault-registry`. **`CHAIN_ID` deliberately stays a constant:** a selector would offer chains the backend cannot serve — the agent's `SPARKPOINT_VAULT_FACTORY_ADDRESS` is a single global env, and `API_SUPPORTED_CHAIN_IDS` rejects 4663. Those two + the `sendTransaction`-without-`chainId` gap are Phase 5/6.
- [x] **T035** ✅ *(from plan.md Layer 3)* Chain metadata collapsed onto one LEAF registry `packages/shared/src/chains/` (`@sparkpoint/shared/chains`): three independent chainId→explorer maps and two independent chain lists folded into one. Leaf-ness (no relative imports, no enums, no viem/wagmi) is what lets a web unit test VALUE-import it under `--experimental-strip-types`, and `chainMeta.test.ts`'s value import IS that assertion. Duplication vs policy `CHAIN_ID` is checked by a compile-time parity guard (`chains/parity.ts`), verified to fire on a deliberate drift. **Fixed two wrong-chain-explorer bugs:** `app/exit/page.tsx` returned basescan.org for ANY non-84532 chain (so Robinhood txs linked to Base mainnet — on the page whose job is proving you can verify and exit), and `ExecutionDrawer.tsx` silently rendered no link on Robinhood.
- [x] **T034** ✅ `contracts/script/vault-eligibility-check.sh` + `.github/workflows/vault-eligibility.yml` (oh-ci, timeout, concurrency, fork guard) + `contracts/deployments/vault-candidates.json`. Read-only (`cast call` only, no key), DB-free. **All 3 candidates verified PASS live** on 8453 + 4663 via public RPCs, no secrets. **Negatives proven to FAIL:** wrong asset, non-VaultV2 address, tampered selector, and a real 25%-fee vault vs a 0bps ceiling. Selectors recomputed with `cast sig` and re-derived at runtime. **Caught a bash 64-bit overflow** — `wad*10000` for a 25% fee wrapped to −8bps and PASSED a 0bps ceiling; moved to python3, rounded up. **Liquidity floor NOT asserted, and the script says so:** withdrawable liquidity needs Morpho's indexer, and idle balance is useless for it (Steakhouse Prime USDC: $567M totalAssets, 0 idle).

## Phase 3 — Real Morpho on Base Sepolia **[BROADCAST — LIVE on 84532 2026-07-30]**

> **Status 2026-07-30 — DONE, and verified independently of the script's own output.**
> **Vault `0x756C41dD33481620EbCB0357F759d31c9eE72170`**, adapter
> `0x4C4dCd2e2Bb985a606C1e7d4822bB330637D8E24`, asset = Circle USDC `0x036CbD53…`, allocating into
> live Blue market `0x01351cf8…0bfb`. Handover tx `0x5f44f1af…58fd`. The deterministic address
> prediction held exactly: the real deploy landed on the same address the fork produced.
>
> **It took 52 transactions, not 43** — the earlier count was wrong (9 `tl()` pairs in step 3 alone
> are 18 transactions). Nonce 67 → 119 confirms 52. Cost: exactly **1.000000 USDC** for the dead
> deposit and **0.0000616 ETH** in gas.
>
> **Verified live after the handover** (all read back from chain, not taken from the script):
> `isVaultV2` true · owner + curator + sentinel = the 2-of-3 Safe `0xCB135893…578f` ·
> `setReceiveSharesGate`/`setSendSharesGate`/`setReceiveAssetsGate` **and** `setAdapterRegistry` all
> permanently abdicated · 3-day (259200s) timelocks on all 7 curator selectors · adapter added,
> `liquidityAdapter` + `adapterRegistry` + `maxRate` set · `0xdead` holds 1e18 shares ·
> `performanceFee()` = `managementFee()` = 0 · `previewRedeem(1e18)` = 999999 (the exit prices
> correctly) · **FR-020 gate re-run against the live vault: PASS**.
>
> **THE BROADCAST TOOK FOUR ATTEMPTS, ALL THREE FAILURES THE SAME ROOT CAUSE: RPC VIEW LAG.** None
> was a logic error, and each aborted safely without corrupting state. Recorded because the next
> chain deploy will hit them again:
>   1. `createVaultV2` committed (status 1) but the immediate `factory.vaultV2` view returned EMPTY,
>      so the script refused to continue — with the vault already created and the salt spent.
>   2. `setCurator` was MINED, yet the pending-nonce view still counted it in-flight, so the next
>      `cast send` reused the nonce and the node rejected it as an underpriced replacement.
>   3. `exec absCap(market)` failed **gas estimation** with `TimelockNotExpired` although
>      `timelock(increaseAbsoluteCap)` was 0 and the submit had a receipt: the estimator ran against a
>      state view predating the submit, where `executableAt` reads 0 — and V2 reverts
>      `TimelockNotExpired` for 0 exactly as for "not yet due".
>
> The script is now **fully idempotent and resumable**, which is what actually finished the job:
> every step is guarded by a read of the state it produces (`tl_if`/`tx_if`), the script **owns the
> nonce** instead of asking the RPC, view reads retry (`read_view`), a submitted-but-unexecuted
> action is **adopted** rather than re-submitted (re-submitting reverts `DataAlreadyPending`
> `0xd91ff208`), and `await_executable` asks the vault itself before every exec. Every step prints
> its tx hash. The done-check for the one-shot dead deposit deliberately precedes the `previewMint`
> assertion, because once the vault is non-empty that assertion would abort a finished deployment.
> Rehearsing each resume on a fork of the **then-current** live block is what caught #3 and
> `DataAlreadyPending` for free.
>
> **Known testnet posture, deliberately recorded:** the deployer is still an allocator
> (`isAllocator(deployer)` true). `setIsAllocator` is not timelocked, so the Safe can revoke it
> immediately. Blast radius is moving assets between idle and the single approved Blue market — no
> custody path — but this **must not carry over to a mainnet Fee Wrapper**.


- [x] **T040** ✅ *(superseded, deliberately)* No vendoring needed and none done: the vault is deployed BY Morpho's already-deployed factory, so the whole sequence is `cast` calls against the REAL bytecode — strictly better evidence than a fork test over a recompiled copy, and it sidesteps this repo's solc 0.8.24 pin. `FeeWrapperDeployer` cannot run on 84532 anyway (no `MorphoVaultV1AdapterFactory`).
- [x] **T041** ✅ **BROADCAST LIVE** 2026-07-30 (52 receipt-checked txs, nonce 67→119). Script: `contracts/script/deploy-vault-v2-base-sepolia.sh`. Vault `0x756C41dD33481620EbCB0357F759d31c9eE72170`, adapter `0x4C4dCd2e2Bb985a606C1e7d4822bB330637D8E24`, asset = Circle USDC `0x036CbD53…`, into live Blue market `0x01351cf8…0bfb`. **The deterministic prediction held** — the real deploy landed on exactly the fork's address, because `factory.vaultV2(owner,asset,salt)` is a view.
- [x] **T042** ✅ **LIVE, re-read from chain after the handover.** All three critical gate setters + `setAdapterRegistry` abdicated and re-read as `true` before the script will continue; timelocks 259200s on all 7 curator selectors with `increaseTimelock` LAST; owner + curator = Safe `0xCB135893…578f`, sentinel too. **Ordering bug found and fixed by running it:** timelocks MUST precede the role handover — `submit` is curator-gated, so after `setCurator(Safe)` the deployer gets `Unauthorized` (0x82b42900). Morpho's docs list roles before timelocks, which only works if the new curator does them.
- [x] **T043** ✅ **CONFLICT SETTLED BY MEASUREMENT, THEN CONFIRMED ON MAINNET-REAL STATE.** On the live broadcast `previewMint(1e18)` returned **exactly 1000000** and the guard passed, so the fork measurement held on chain. The dead-deposit page is right; the vault-creation page's Phase-8 comment is wrong. On the fork: `virtualShares()` = 1e12, `previewMint(1e18 shares)` = **exactly 1000000 base units = 1.000000 USDC**, and after `mint(1e18, 0xdead)` the vault holds 999999 assets with 1e18 shares at `0xdead`. The argument is SHARES. As *assets* the other reading means 1,000,000 USDC (absurd); as shares it means 0.000001 USDC (far too small to defend anything). The script now **guards** this — it reads `previewMint` live and aborts unless the cost is exactly 1000000, because the step cannot be undone.
- [x] **T044** ✅ Both test assets are now modelled per-row. The new vault's `asset_address` is Circle's `0x036CbD53…` (Morpho's markets' USDC) while the Aave launch vault row keeps `0xba50Cd2A…`; `0026` already carried `asset_address` per row, and the row is written in `contracts/deployments/84532/vault-registry-row.sql`. The same split is now explicit in the TS address book: `MorphoFeeWrapper.asset` is a **required** field rather than inherited from the book's `usdc`, precisely because on this chain `usdc` is Aave's token. **Pending: an operator runs the SQL** (there is deliberately no programmatic write path for `vault_registry`).
- [x] **T045** ✅ Verified on the fork against the real V2: deposit 2 USDC → `redeem` ALL shares → **full principal returned, shares 0** (the N2 exit); `maxDeposit/maxMint/maxWithdraw/maxRedeem` **all returned 0** as documented (never derive a UI limit from them); `forceDeallocate(address,bytes,uint256,address)` = `0xe4d38cd8` present, penalty 0.
- [ ] **T046** **BLOCKED BY DESIGN — do not do this yet; checked 2026-07-30.** The retired mock wrapper `0xff0a43FA…E9BB` still has a holder: `totalSupply()` = `50000000` and the deployer `0xA71e2435…5c30` holds all of it (50 USDC). N2 says a holder must always keep a first-class exit, and the row is precisely what keeps the picker resolving it, `/portfolio` showing the position, and withdraw ungated — so removing it now would contradict the reason it was kept. Re-check `totalSupply()` before revisiting. (It could be unblocked by redeeming the deployer's own 50 shares, which would also re-prove the N2 exit on the retired wrapper — but that is a deliberate fund action on a real position and was left to the operator rather than assumed.)

## Phase 4 — Honest APY (NOT gated)

- [x] **T050** ✅ `data/morpho_api.py` — `vaultV2ByAddress(address, chainId)` → `avgNetApy`, which is ALREADY net of the whole fee chain (child fees + our fee + rewards), so it is exactly the IV.5 disclosure figure and needs no adjustment by our own fee. Schema introspected, not guessed: on `VaultV2` the fields are **top-level, not under `state`**, and `performanceFee`/`managementFee` are **fractions** (`0.25` = 25%). Fail-open to `unavailable` on every path — unsupported chain, transport error, GraphQL error (incl. the rate-limit rejection), unindexed vault, unparseable rate. A negative APY is PRESERVED, never clamped (a vault can genuinely lose money; clamping would flatter it).
- [x] **T051** ✅ `api/vault_apy_poller.py` → `vault_apy_snapshots`, wired into `lifespan` and cancelled in `finally`, matching the three existing loops (lazy imports in the body; `except asyncio.CancelledError: raise` BEFORE the broad except). **Background only** — the API is rate-limited and sustained abuse reportedly triggers a week-scale cooldown, so a request-path read would scale with traffic and could take the feed down for everyone. Advisory lock **`210_260_024`** (mirrors `notification_poller`'s `210_240_021` = `21_<migration>_<feature>`; reuse would be a SILENT bug since both loops fail open). Interval floored at **300s** so a misconfigured `1` cannot hammer the API. The unsupported-chain check is LOCAL, so the default 84532 path makes no network call at all — asserted by test. Never writes `vault_registry` (migration/operator only).
- [x] **T052** ✅ The stacked fee chain now renders as **three separate lines** — ours, the child's, the net — via a pure, tested `vaultFeeChain()` in `lib/policy/feeCopy.ts`. It replaced a single vague "+ Morpho curator fee" that named a fee without ever stating its size. **The rule the model exists to enforce: "we didn't read it" and "there is none" must never render the same** (`undefined` ⇒ "not yet read"; `0` ⇒ "0% — none charged"), the same discipline that makes an unavailable APY render "unavailable" and never 0%. The net is `unavailable` on 84532 by construction. 10 new tests. The vault page's APY/fee panel now branches on `isMorphoVenue` rather than the legacy-only `isWrapper`, so a V2 cannot fall into the Aave branch and be described as earning an Aave supply rate. **NOT included: surfacing the V2 in the picker** — `buildVaultOptions` still takes only `sparkPointWrappers`, and surfacing it would route deposits through `vaultConfirmModel`'s `isWrapper`/attestation logic, which has NOT been adapted for a V2 (`attested` is false for one, so it would be treated like the launch vault for signability). That audit is the prerequisite and is deliberately left open.
- [x] **T053** ✅ `specs/010-universal-vaults/spec.md` US1 marked **SUPERSEDED by 024 Phase 4**, with what actually shipped (T050 client + T051 background poller) and — stated plainly — what did **not** carry over: the broader "AI reasons over live external yields to direct strategy" ambition, which IV.5(d) deliberately keeps out of the policy path. Recorded as open and unscheduled rather than quietly counted as delivered.

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
- [x] **T082** ✅ Reworded in `useVault.ts` (2 sites). It called `_decimalsOffset() == 0` an **INVARIANT**, which overclaims: nothing enforces it — it is OpenZeppelin's default that our own vaults simply never override. The counterexample is now deployed (a Vault V2 sets an offset, `virtualShares() == 1e12`, and reads 18 decimals over a 6-dp asset), so the comment now says "a relied-on default, not an invariant" and points at the fee-wrapper branch that reads `asset()`'s decimals separately.
- [x] **T083** ✅ **Annotated, not unpublished** (deleting would lose the deployment record). Verified on-chain 2026-07-31: both are deployed (306 / 456 bytes) but wired to NOTHING — the live `SparkPointVault` exposes `guardian`/`pauser`/`paused`/`pauseDeposits`/`unpauseDeposits` and has **no `adapter()` or `killSwitch()` selector**, and no runtime code reads the killSwitch address (only its ABI is exported). Annotated in `contracts/deployments/84532/addresses.json` (new `$comment`) and `baseSepolia.ts`, both stating they MUST NOT be presented as active safety machinery — the live pause path is the vault's own.
