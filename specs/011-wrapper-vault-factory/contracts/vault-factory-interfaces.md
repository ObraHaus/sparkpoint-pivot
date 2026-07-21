# Internal Interface Contracts: Wrapper Vault Factory (Phase 1–4)

> **GATE.** All interfaces, the admin API, and the test obligations below are DESIGN ONLY. **No Solidity,
> no endpoint, and no test may be authored until the Phase-0 constitution amendment is ratified**
> (super-majority re-ratification — [`plan.md`](../plan.md) Constitution Check, [`tasks.md`](../tasks.md)
> T001). This document is the contract the ratified implementation must satisfy, not a licence to start.

This feature adds (1) two new on-chain Solidity interfaces (a wrapper template + a deploy-only factory),
(2) an admin BFF surface for the MANAGE half of `/admin/vaults` that only READS and PREPARES calldata
(never holds a key or moves funds), and (3) Foundry test obligations that re-prove the non-custody
invariants under NON-rebasing shares + partial Morpho liquidity. Each has a test obligation.

---

## 1. `ISparkPointMorphoVault` — `contracts/src/interfaces/ISparkPointMorphoVault.sol`

A branded, single-purpose, non-upgradeable ERC-4626 that routes USDC into exactly ONE curated Morpho
`IERC4626`. Mirrors `contracts/src/interfaces/ISparkPointVault.sol` (fee/pause/guardian surface identical)
with the Aave leg replaced. Implementation: `contracts/src/vault/SparkPointMorphoVault.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title SparkPointMorphoVault
/// @notice Branded, single-purpose, NON-UPGRADEABLE (N5) ERC-4626 wrapper over ONE curated Morpho vault.
///         USDC in -> curated IERC4626 morphoVault -> withdraw anytime (up to live Morpho liquidity).
///         0% management, 0% entry/exit, 0% on principal; a profit-only HWM performance fee (default 1000
///         bps, HARD CAP 2000 bps) minted as fee-SHARES to a non-privileged feeRecipient. External-vault
///         yield is NOT Aave and the SparkPoint fee STACKS on Morpho's native curator fee (both disclosed).
/// @dev Deployed via SparkPointVaultFactory CREATE2 FULL-bytecode (NOT a minimal-proxy clone: a clone
///      delegatecalls an impl, which violates N5's "no delegatecall-to-impl"). morphoVault + guardian +
///      factory + capRegistry are constructor IMMUTABLES. NO sweep/migrate/rescue (N1). withdraw/redeem
///      carry NO whenNotPaused (N2). Non-rebasing: totalAssets == morphoVault.convertToAssets(balanceOf).
interface ISparkPointMorphoVault is IERC4626 {
    // ── The single wrapped protocol target (immutable ⇒ single-purpose, N5) ──
    /// @notice The ONE curated Morpho IERC4626 this instance routes into. Immutable; no setter.
    function morphoVault() external view returns (address);
    /// @notice The deploying factory (provenance; the factory has NO fund path into this instance).
    function factory() external view returns (address);

    // ── Non-rebasing accounting ──
    /// totalAssets() => morphoVault.convertToAssets(morphoVault.balanceOf(address(this)))
    /// @notice Withdrawable amount CLAMPED to live Morpho liquidity so the partial-exit assertion holds.
    ///         For a wrapped Morpho VAULTS V2 (whose max* return 0), availability is derived from the
    ///         market's liquid assets, not maxWithdraw (see research.md / §1.3 note).
    function maxWithdraw(address owner) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);

    // ── Custody-relevant views (public for Trust Center provability, N5) ──
    function paused() external view returns (bool);          // PAUSE-DEPOSITS-ONLY; withdrawals unaffected (N2)
    function guardian() external view returns (address);     // OZ TimelockController; pause/unpause + param-set ONLY
    function capRegistry() external view returns (address);
    function depositCap() external view returns (uint256);
    function label() external view returns (string memory);  // branded display name (registry parity)
    function entryFeeBasisPoints() external pure returns (uint256);       // == 0
    function exitFeeBasisPoints() external pure returns (uint256);        // == 0
    function managementFeeBasisPoints() external pure returns (uint256);  // == 0

    // ── Performance fee (profit-only, HWM, capped — identical spine to ISparkPointVault §6.1) ──
    function MAX_PERFORMANCE_FEE_BPS() external pure returns (uint16);    // == 2000 (20%)
    function performanceFeeBps() external view returns (uint16);          // default 1000; ≤ MAX
    function highWaterMark() external view returns (uint256);             // constructor-seeded; monotonic up
    function feeRecipient() external view returns (address);              // ordinary, non-privileged holder
    function accrueFee() external returns (uint256 feeSharesMinted);      // lazy, FAIL-OPEN; never blocks N2
    function harvest() external;                                          // read-through Morpho + accrueFee()

    // ── Governance (timelocked, guardian-bounded; NEVER a fund/custody/withdraw path — N1, N5) ──
    function setPerformanceFeeBps(uint16 newRateBps) external;            // timelock; reverts if > MAX
    function setFeeRecipient(address newRecipient) external;              // timelock; still non-privileged
    function pauseDeposits() external;                                    // guardian-only; blocks NEW deposits only
    function unpauseDeposits() external;                                  // guardian-only

    // ── Events (superset of ISparkPointVault; Aave events replaced by Morpho leg) ──
    event MorphoSupplied(uint256 assets, uint256 morphoShares);
    event MorphoWithdrawn(uint256 assets, uint256 morphoShares, address indexed receiver);
    event DepositsPaused(address indexed guardian);
    event DepositsUnpaused(address indexed guardian);
    event PerformanceFeeAccrued(address indexed feeRecipient, uint256 feeShares, uint256 yieldAssets, uint256 newHighWaterMark);
    event FeeRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event HighWaterMarkUpdated(uint256 oldHighWaterMark, uint256 newHighWaterMark);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ── DELIBERATELY ABSENT (N1): no sweep / migrate / rescue / recoverERC20 / skim / upgradeTo. ──
}
```

**§1.3 Vaults-V2 availability note.** Morpho Vaults V2 `max*` return `0`, so a naive clamp to
`morphoVault.maxWithdraw(this)` would make a V2-wrapped instance appear to have zero liquidity. The
implementation MUST detect V2 (e.g. `maxWithdraw`/`maxRedeem` both `0` while `totalAssets > 0`) and derive
withdrawable liquidity from the underlying market's liquid assets, falling back to attempting the redeem and
honoring whatever Morpho returns — the N2 escape hatch must never be blocked by a spuriously-zero clamp.
See [`research.md`](../research.md).

**Contract test obligations (§1):** deposit mints shares at the correct non-rebasing price; `totalAssets()`
tracks `morphoVault` share-price movement UP and DOWN (Morpho-side loss reflected, never fabricated);
`withdraw`/`redeem` succeed while `paused == true` (N2); `withdraw` succeeds under PARTIAL Morpho liquidity
up to the clamped max and reverts cleanly (no silent short-fill) above it; NO reachable code path transfers
user shares or the wrapped position to `feeRecipient`/`guardian`/`factory`/any SparkPoint address (N1);
`morphoVault()` is immutable across the instance's life (N5); the fee accrues ONLY above the HWM and only on
realized gain (profit-only); a reverting `accrueFee()` NEVER blocks a withdraw (fail-open).

---

## 2. `ISparkPointVaultFactory` — `contracts/src/interfaces/ISparkPointVaultFactory.sol`

Admin-gated, deploy-only registrar. **Holds no funds.** Implementation:
`contracts/src/factory/SparkPointVaultFactory.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SparkPointVaultFactory
/// @notice Admin-gated CREATE2 deployer of branded SparkPointMorphoVault instances from a curated,
///         on-chain Morpho allowlist. Holds NO funds (no receive, no token custody, no fund path).
///         createVault reverts unless morphoVault is allowlisted ("interaction with any other protocol
///         impossible by construction" preserved at the factory boundary, per the ratified amendment).
interface ISparkPointVaultFactory {
    struct Caps { uint256 perAddressCap; uint256 totalCap; } // 0 == unlimited (mirrors CapRegistry semantics)

    /// @notice Deploy a branded wrapper over an allowlisted curated Morpho vault. onlyOwner (SHOULD be the
    ///         OZ TimelockController). Reverts if !isAllowlisted(morphoVault) or feeBps > 2000 (20% cap).
    /// @dev FULL-bytecode CREATE2 (salt = keccak256(morphoVault, label, chainId)); NOT a minimal proxy.
    function createVault(
        address morphoVault,
        uint16  feeBps,
        Caps calldata caps,
        string calldata label
    ) external returns (address vault);

    /// @notice Predict the CREATE2 address before deploy (admin preview + idempotency).
    function predictVaultAddress(address morphoVault, string calldata label) external view returns (address);

    /// @notice Add/remove a curated Morpho vault from the on-chain allowlist. onlyOwner (timelocked).
    ///         Removal blocks FUTURE deploys only; it CANNOT touch an already-deployed instance's
    ///         immutable morphoVault (existing users keep their N2 escape hatch).
    function allowlistMorphoVault(address morphoVault, bool allowed) external;
    function isAllowlisted(address morphoVault) external view returns (bool);

    /// @notice Registry reads consumed by the 010 vault reader / admin panel.
    function vaults() external view returns (address[] memory);
    function vaultsLength() external view returns (uint256);
    function vaultAt(uint256 index) external view returns (address);
    function isSparkPointVault(address vault) external view returns (bool); // provenance attestation for 010

    function owner() external view returns (address);

    event VaultCreated(address indexed vault, address indexed morphoVault, uint16 feeBps, string label);
    event MorphoVaultAllowlisted(address indexed morphoVault, bool allowed);

    // ── DELIBERATELY ABSENT (N1): no deposit / withdraw / sweep / transfer / rescue. Factory ≠ custodian. ──
}
```

**External dependency.** `MORPHO_VAULT` is typed as OZ `IERC4626`
(`@openzeppelin/contracts/interfaces/IERC4626.sol`) — MetaMorpho V1.1 and Vaults V2 are both standard
ERC-4626 (+ERC-2612). No Morpho-specific interface is imported into the vault; the factory allowlist is the
ONLY place a specific Morpho address is vetted.

**Contract test obligations (§2):** `createVault` from a non-owner reverts; from a non-allowlisted
`morphoVault` reverts; with `feeBps > 2000` reverts; a successful deploy pushes to `vaults`, sets
`isSparkPointVault`, emits `VaultCreated`, and lands at `predictVaultAddress`; a second `createVault` with
the same `(morphoVault, label)` is idempotent/guarded (no duplicate at the same salt); the factory has NO
payable/token-receiving path (a value-bearing call reverts); de-allowlisting a vault leaves already-deployed
instances fully operational (their `morphoVault()` unchanged, withdrawals still succeed).

---

## 3. Deploy script — `contracts/script/DeployMorphoWrapperFactory.s.sol`

Foundry script: deploy `SparkPointVaultFactory` with `owner = TimelockController`; allowlist the vetted
curated vault(s) via `allowlistMorphoVault`; optionally deploy one wrapper via `createVault` for the smoke
test. Mirrors `contracts/script/DeploySepolia.s.sol` / `DeployCore.s.sol`. Records deployed addresses into
`packages/shared/src/addresses/{base,baseSepolia}.ts` as plain address-book fields (factory +
curated-vault), NOT policy `TargetRef`s.

**Test obligation:** `contracts/test/DeployDeterminism.t.sol` extends to assert the factory + a wrapper
deploy deterministically at their predicted CREATE2 addresses; `contracts/script/AssertNonCustody.s.sol`
extends to assert the wrapper exposes no fund-egress selector (N1) and the factory holds no balance.

---

## 4. Admin manage API — the MANAGE half of `/admin/vaults` (read + prepare-only)

The 010 read/advisory half already serves the READ side (live state of every registered vault). 011 adds the
MANAGE endpoints on the same page. **Every endpoint either READS or returns PREPARED CALLDATA the operator
signs off-app** (mirrors `apps/web/src/app/admin/killswitch/page.tsx`). The BFF holds NO key and has NO
fund path (N1). Surfaced via `apps/web/src/app/admin/vaults/page.tsx` → agent BFF routes:

| Endpoint | Method | Behavior | Non-custody note |
|---|---|---|---|
| `/admin/vaults` | GET | List registry rows + live per-instance state (010 reader). | Read-only. |
| `/admin/vaults/create` | POST `{ morphoVault, feeBps, caps, label, chainId }` | Validate against the curated allowlist; return prepared `createVault(...)` calldata + `predictVaultAddress`; insert a `pending` registry row. | Returns calldata only; the operator signs `createVault` from the owner/timelock. No server key. |
| `/admin/vaults/allowlist` | POST `{ morphoVault, allowed, vettingNotes }` | Return prepared `allowlistMorphoVault(...)` calldata; upsert the off-chain vetting record (data-model §3). | Calldata only. |
| `/admin/vaults/{vault}/guardian-action` | POST `{ action: 'pause'\|'unpause'\|'setFee'\|'setFeeRecipient'\|'setCaps', args }` | Return prepared OZ Timelock `schedule` + `execute` calldata for the requested guardian action. | Calldata only; timelock-delayed; **no move-funds action exists** in the enum (US4 invariant). |
| `/admin/vaults/{vault}` | GET | Live single-instance state (paused, guardian, fee, recipient, caps, morphoVault, nativeFeeBps). | Read-only. |

**Contract test obligations (§4):** `create` refuses a `morphoVault` not on the curated allowlist; refuses
`feeBps > 2000`; the guardian-action enum contains NO fund-moving verb (a fabricated `withdraw`/`sweep`/
`migrate` action is rejected/absent) — the "no move-funds action exists" invariant is asserted in a test;
every mutating endpoint returns calldata + never signs; a wrapper created here appears in the 010
registry/reader automatically once its row + on-chain provenance verify (US5).

---

## 5. On-chain / API data feed (Phase 1–4) — read-only

Morpho GraphQL (`https://api.morpho.org/graphql`, keyless, ~750 req/min, MAINNET-only) supplies curated
vault APY/TVL/fee metadata for the ADMIN allowlist-vetting UI and the honest double-fee disclosure — it is
NEVER a signing input and NEVER reaches the deterministic policy engine (same posture as the yield feed in
010). On Base Sepolia (84532) the API is unavailable, so APY is on-chain-derived or mocked from a
self-created test Morpho market (see [`quickstart.md`](../quickstart.md)); DeFiLlama / on-chain-derived is
the mainnet fallback. No state change. This mirrors 007 §7's read-only probe posture.
