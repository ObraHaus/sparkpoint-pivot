# Requirements Checklist: Phase 1 — `SparkPointMorphoVault` template (011 / US2)

**Purpose**: Implementation-readiness gate for Phase 1 (US2) — the branded, single-purpose, non-upgradeable ERC-4626 wrapper over ONE curated Morpho vault, and the Foundry re-proof of N1/N2/N5 under non-rebasing shares + partial Morpho liquidity. Every item must be TRUE (or its test GREEN) before Phase 1 is "done".
**Created**: 2026-07-21
**Feature**: [spec.md](../spec.md) US2 · [plan.md](../plan.md) Phase 1 · [data-model.md](../data-model.md) · [contracts/vault-factory-interfaces.md](../contracts/vault-factory-interfaces.md) §1
**Gate status**: ✅ Phase-0 amendment RATIFIED (constitution **v2.0.0**, 2026-07-21) — Phase 1 is unblocked.
**Clone base**: `contracts/src/vault/SparkPointVault.sol` + `ISparkPointVault.sol` (fee/pause/guardian spine is identical; only the Aave leg changes).

> **Spec-kit `analyze` result (2026-07-21):** spec-US2 ↔ plan-Phase-1 ↔ data-model ↔ `ISparkPointMorphoVault` §1 ↔ tasks T005–T012 are **consistent** and **fully task-covered**, and align with constitution v2.0.0 (I / IV.5 / IV.6 / V). No contradictions found. The items below are the concrete, verifiable obligations that consistency implies.

## A. Non-custody by construction (Constitution I · v2.0.0 IV.6/V)

- [ ] CHK001 **N1 — no fund egress.** `SparkPointMorphoVault` exposes **no** `sweep`/`migrate`/`rescue`/`recoverERC20`/`skim`/`upgradeTo` selector; the ONLY asset-out path is ERC-4626 `withdraw`/`redeem` to the share-owner/approved. (T006, T011; `AssertNonCustody.s.sol`)
- [ ] CHK002 **N1 — fee never touches principal.** The performance fee is realized by **minting fee-shares** to a non-privileged `feeRecipient` (share dilution), above the HWM only; **no USDC/`morphoVault`-share is ever transferred out** of the pooled position to a fee/treasury/recipient address. (T005/T006)
- [ ] CHK003 **N1 — no SparkPoint-address egress.** No path lets `feeRecipient`, `guardian`, `factory`, or any SparkPoint-controlled address receive the pooled `morphoVault` shares or underlying except via its own ERC-4626 redemption as an ordinary holder. (T006 invariant)
- [ ] CHK004 **N2 — withdraw-always.** `withdraw`/`redeem`/`_withdraw` carry **no** `whenNotPaused`/pause modifier and succeed while `paused()==true` and with the backend "offline"; the guardian pauses **deposits only**. (T006)
- [ ] CHK005 **N2 — SparkPoint is never the exit-blocker.** The **only** permissible cause of a partial/delayed exit is insufficient **underlying Morpho** liquidity — never a SparkPoint key, role, pause, or lock-up. (T007)
- [ ] CHK006 **N5 — non-upgradeable, single-purpose.** Plain contract: no proxy, no `upgradeTo`, no EIP-1967 slots, no delegatecall-to-impl. `morphoVault`, `guardian`, `factory`, `capRegistry` are constructor **immutables**; the single Morpho target can never be redirected/rebalanced/migrated. (T009/T010)
- [ ] CHK007 **N3/N4 unchanged.** Deposits/withdrawals are user-signed; no new automation/session-key surface is added by the template (PolicyModule scope unchanged).

## B. Non-rebasing ERC-4626 accounting (the core Aave→Morpho change)

- [ ] CHK008 `totalAssets()` == `morphoVault.convertToAssets(morphoVault.balanceOf(address(this)))` — **non-rebasing** (do NOT copy the aUSDC `balanceOf` rebasing form). Tracks Morpho value **up AND down** (a Morpho-side loss is reflected, never fabricated). (T005)
- [ ] CHK009 Deposit path: pull USDC → `morphoVault.deposit(assets, address(this))` → mint spk-shares; `_deposit` emits `MorphoSupplied`. Rounding stays in the vault's favor. (T005/T010)
- [ ] CHK010 Withdraw path: `morphoVault.withdraw/redeem` → USDC → receiver → burn spk-shares; emits `MorphoWithdrawn`. No silent short-fill. (T007/T010)
- [ ] CHK011 `maxWithdraw`/`maxRedeem` **clamped to live Morpho liquidity** (`morphoVault.maxWithdraw(this)`); a request ≤ clamp returns exactly the amount, above it reverts cleanly (the `received == assets` assertion holds). (T007)
- [ ] CHK012 **Vaults-V2 `max*==0` fallback:** when the wrapped Morpho vault is V2 (whose `max*` return 0), availability is derived from the underlying market's liquid assets — N2 is **not** spuriously blocked. (T007; §1.3 note)

## C. Performance fee (profit-only, HWM, capped — spine identical to `SparkPointVault`)

- [ ] CHK013 Profit-only: `accrueFee()` mints shares only when share-price > HWM; **0 fee** in flat/down periods; **0 on principal**. HWM constructor-seeded, monotonic up. (T008)
- [ ] CHK014 Fee rate default **1000 bps**, hard cap **`MAX_PERFORMANCE_FEE_BPS == 2000`**; `setPerformanceFeeBps` reverts above cap; management/entry/exit fees are compile-time **0**.
- [ ] CHK015 `accrueFee()` is **fail-open** on the exit path (a revert in accrual can never block `withdraw`/`redeem` — N2); deposit path accrues-then-prices + settles HWM (late depositor never taxed on pre-entry yield).
- [ ] CHK016 Governance (`setPerformanceFeeBps`/`setFeeRecipient`) is guardian/timelock-bounded and **never** a fund/withdraw path; `feeRecipient` stays an ordinary non-privileged holder.

## D. Interface + provability (`ISparkPointMorphoVault` §1)

- [ ] CHK017 `SparkPointMorphoVault.sol` implements `ISparkPointMorphoVault` exactly: adds `morphoVault()`/`factory()`/`label()`, drops the Aave views (`aavePool`/`aUSDC`), keeps the full fee/pause/guardian/cap views. (T009/T010)
- [ ] CHK018 Custody-relevant views are public for Trust-Center provability (`paused`, `guardian`, `capRegistry`, `depositCap`, `morphoVault`, `feeRecipient`, `highWaterMark`, `performanceFeeBps`).
- [ ] CHK019 Caps enforced via `maxDeposit`/`maxMint` against `CapRegistry` (per-user/total/vault); caps **never** gate `withdraw`/`redeem` (N2).

## E. Disclosure (Constitution III · v2.0.0)

- [ ] CHK020 The template/`label()` and downstream surfaces make the **stacked double-fee** (SparkPoint HWM fee **over** Morpho's native curator fee) and the **non-Aave yield source** disclosable net (enforced in the app in later phases; the contract must not obstruct it). (spec FR-023)

## F. Test coverage + validation gates (§8 playbook)

- [ ] CHK021 `contracts/test/fuzz/MorphoVault4626.t.sol` — non-rebasing accounting up/down + rounding (T005) and partial-liquidity clamp + V2 `max*==0` (T007), written **first** and initially RED.
- [ ] CHK022 `contracts/test/invariant/MorphoVaultNonCustody.t.sol` — N1 no-egress + N2 withdraw-while-paused/offline (T006).
- [ ] CHK023 `contracts/test/fork/MorphoVaultFork.t.sol` — deploy over a **real Base-mainnet curated Morpho vault**, deposit/withdraw round-trip, HWM fee accrues only above HWM (T008). (Base Sepolia has no real curated vault — fork against 8453 or a mainnet fork.)
- [ ] CHK024 `contracts/script/AssertNonCustody.s.sol` extended to assert the wrapper has no fund-egress selector + immutable `morphoVault` (T011).
- [ ] CHK025 `forge build` + the **full** contracts suite green (existing 171 + new); N1/N2/N5 re-proven under non-rebasing + partial liquidity (Phase-1 checkpoint).
- [ ] CHK026 Living docs updated in the same change: `CHANGELOG.md` bullet ("feat(contracts): SparkPointMorphoVault template") + `DEVELOPMENT.md` note on the non-rebasing wrapper (T012). No new env var undocumented.

## Phase-1 status — ✅ IMPLEMENTED + GREEN (2026-07-21)

All 26 checks above are satisfied: `forge build` clean, **191 passed / 0 failed / 3 skipped** (the 171 pre-existing tests unchanged; +20 new Morpho tests; the fork test skips without RPC). Files: `ISparkPointMorphoVault.sol`, `SparkPointMorphoVault.sol`, `MockMorphoVault` (in `test/mocks/Mocks.sol`), `MorphoVaultTestBase.sol`, `test/{fuzz/MorphoVault4626,invariant/MorphoVaultNonCustody,fork/MorphoVaultFork}.t.sol`, extended `AssertNonCustody.s.sol`. Two independent adversarial custody reviews (N1–N5 lens + accounting/rounding/liquidity lens) returned **SOUND** — no critical or major findings.

**3 minor defense-in-depth findings — considered, deferred to the mainnet-audit gate** (each matches an established pattern in the audited base `SparkPointVault`, so kept for clone fidelity + the curated-vault trust model):
- Constructor grants `type(uint256).max` USDC allowance to the immutable `morphoVault` (mirrors the base's Aave `forceApprove(max)`). Safe under the curated-allowlist trust; surface as an explicit Trust-Center assumption. Optional: per-deposit exact approvals for defense against a curated-vault compromise.
- No `ReentrancyGuard` on deposit/withdraw (the base vault has none; USDC is non-reentrant and Morpho is curated/vetted). Optional: add `nonReentrant` in the hardening pass.
- `require(got == assets, "PARTIAL")` is strict `==` (mirrors the base). A benign over-delivering wrapped vault would revert that exact-amount exit (user can still exit a smaller amount — N2 intact). Optional: relax to `>=` if ever wrapping non-strict vaults.

## Notes

- Curated-allowlist gating, the factory, admin manage, and app deposit/withdraw are **Phases 2–4** — NOT this checklist. Phase 1 is the template + its tests only (no factory yet).
- Every ✅ is either a code invariant or a GREEN Foundry test. Contract audit before **mainnet** is a separate gate (spec T035), not a Phase-1-to-develop blocker.
- Check items off as implemented/tested: `[x]`.
