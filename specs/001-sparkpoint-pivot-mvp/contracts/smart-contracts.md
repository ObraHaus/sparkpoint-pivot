# Contract: Smart-Contract Interfaces (Onchain Execution, Base)

**Feature:** 001-sparkpoint-pivot-mvp · **Chain:** Base mainnet (`8453`) / Base Sepolia (`84532`).
**Standards:** ERC-4337 (EntryPoint **v0.7**, `PackedUserOperation`) · ERC-4626 (vault) · ERC-20.
**Tooling:** Foundry. **Solidity:** `^0.8.24` (`evm_version = cancun`).
**Status:** Phase 1 interface sketch. Signatures + NatSpec + events + invariants are normative; bodies are illustrative.

---

## 0. The five non-custody invariants (enforced by construction, not by promise)

| Inv | Claim | Bytecode-level enforcement |
|---|---|---|
| **N1** | No admin/owner/governance function can transfer user assets to a SparkPoint or arbitrary external address. | No `sweep`/`rescue(to)`/admin-transfer selector exists. The only asset-out paths are ERC-4626 `withdraw`/`redeem` (share-owner only) and account `execute` gated to EntryPoint-or-owner with recipient forced to the account. |
| **N2** | Withdraw-always escape hatch; pause/kill-switch can NEVER block exit. | `withdraw`/`redeem` carry **no** `whenNotPaused`. Aave unwind is a direct `IPool.withdraw`. Works with all SparkPoint infra offline. |
| **N3** | User is sole owner/admin signer; no agent-generated wallets. | `AccountFactory.initialize(owner)` binds the user EOA; owner changeable only by owner. No SparkPoint co-signer/recovery. Default = per-action owner signature. |
| **N4** | Scoped, instantly-revocable, time-boxed automation. | `SessionKeyValidator` + `PolicyModule`: allowlisted `(target,selector)` only, per-tx + cumulative caps, max-slippage floor, hard `validUntil`, recipient forced to account; `revokeSessionKey` is owner-only and instant. |
| **N5** | Non-upgradeable custody semantics; governance is PAUSE-ONLY; provable. | Vault is a plain contract — no proxy, no `upgradeTo`, no EIP-1967 slots, no `delegatecall`-to-impl. Multisig wired to `pause()`/`unpause()` only. All roles public-view for Trust Center. |

> **Defense in depth:** these on-chain rules are the FINAL backstop. The off-chain deterministic policy layer (mirror) and Tenderly simulation are advisory layers in front; if any is wrong/offline, the worst case is a *good* action blocked, never a *bad* action executed.

---

## 1. Contract inventory

| Contract | Type | Upgradeable? | Enforces |
|---|---|---|---|
| `SparkPointAccount` | ERC-4337 smart account | UUPS, **owner-only** | N1, N3, N4 |
| `AccountFactory` | CREATE2 factory | No | N3 |
| `SessionKeyValidator` | ERC-4337 validator module | No | N4 |
| `PolicyModule` | On-chain policy registry | No | N4, caps, allowlist (G2, G5) |
| `SparkPointVault` | ERC-4626 vault | **No (non-upgradeable)** | N2, N5, caps, performance fee (HWM, capped) |

Supporting (not detailed here, referenced): `AaveV3Adapter`, `AerodromeAdapter` (stateless allowlist adapters), `CapRegistry` (param store, bounded), `KillSwitch`/`Guardian` (pause controller).

---

## 2. `SparkPointAccount` — ERC-4337 smart account (N1, N3, N4)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

/// @title SparkPointAccount
/// @notice The user's ERC-4337 smart account. Holds funds, validates UserOps, executes calls.
/// @dev Sole admin authority is the user's owner EOA (N3). The ONLY ways funds leave are:
///      (a) owner direct call, (b) an owner-signed UserOp, (c) a session-key UserOp validated
///      in-scope by SessionKeyValidator/PolicyModule. There is NO admin/sweep/rescue path that
///      can name a SparkPoint or arbitrary external recipient (N1). Upgrade is UUPS but
///      gated to owner() ONLY — SparkPoint can never upgrade a user's account.
interface ISparkPointAccount {
    /// @notice Emitted once at init; binds the sole owner. No SparkPoint address may appear here (N3).
    event SparkPointAccountInitialized(address indexed entryPoint, address indexed owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SessionKeyAuthorized(address indexed sessionKey, uint48 validUntil);
    event SessionKeyRevoked(address indexed sessionKey);
    /// @notice Provable intent tag for off-chain PnL attribution (Data layer). Emitted on execute.
    event IntentLog(bytes32 indexed intentId, address indexed target, bytes4 indexed selector, uint256 value);
    event Executed(address indexed target, uint256 value, bytes4 selector);

    /// @notice The canonical EntryPoint (v0.7) this account trusts. Immutable; wrong pin caught in tests.
    function entryPoint() external view returns (address);

    /// @notice The sole owner/admin signer (the user's EOA). Public for Trust Center (N3/N5 provability).
    function owner() external view returns (address);

    /// @notice ERC-4337 validation. Owner-signed UserOps validate ECDSA against owner(); session-key
    ///         UserOps (1-byte signature prefix) delegate to SessionKeyValidator.
    /// @dev MUST obey EntryPoint storage-access rules: only this account's own/associated storage is
    ///      read in validation (PolicyModule state is account-associated, §5/§6). Returns packed
    ///      validationData (authorizer | validUntil | validAfter).
    /// @return validationData 0 = owner OK; SIG_VALIDATION_FAILED on bad sig; packed expiry for session keys.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external returns (uint256 validationData);

    /// @notice Execute a single call. INVARIANT N1: gated by _requireFromEntryPointOrOwner(); for
    ///         session-key-originated UserOps the call has already passed PolicyModule scope. `target`
    ///         is unconstrained ONLY for the owner; session keys can reach allowlisted targets only.
    function execute(address target, uint256 value, bytes calldata data) external;

    /// @notice Execute a batch (e.g. approve + deposit). Same N1 gating as execute().
    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata datas) external;

    /// @notice Authorize an opt-in session key with an on-chain Policy. Owner-only (N4).
    /// @dev Seeds PolicyModule with EXACTLY {vault deposit/withdraw, Aave supply/withdraw,
    ///      Aerodrome swap}. ERC-20 approve and arbitrary call are NOT seeded, so a session key
    ///      cannot grant itself spend power or reach an unknown contract.
    function authorizeSessionKey(IPolicyModule.Policy calldata policy) external;

    /// @notice Revoke a session key. Owner-only, INSTANT, UNILATERAL — no SparkPoint cooperation,
    ///         no timelock. The next UserOp under this key fails validateUserOp because validation
    ///         reads live storage (N4, FR-031, SC-008). NEVER pausable.
    function revokeSessionKey(address sessionKey) external;

    /// @notice Owner-only ownership transfer (N3). The only way owner() changes.
    function transferOwnership(address newOwner) external;

    /// @notice UUPS upgrade — OWNER ONLY (N3). SparkPoint has no authority here. A user may adopt the
    ///         ZeroDev/Kernel fallback or patch a bug; we cannot upgrade their account.
    /// @dev Account upgradeability is a user-controlled convenience and is orthogonal to the vault,
    ///      which is hard non-upgradeable (N5). Safe default if deemed risky: ship non-upgradeable.
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;

    /// @notice Accept ETH (for the Aave-ETH path via WETH gateway inside an adapter call).
    receive() external payable;
}
```

### N-invariant annotations
- **N1 — no admin withdrawal.** There is deliberately **no** `sweep()`, no `rescueTokens(address to)`, no `onlyOwner` asset-transfer-to-arbitrary helper. If any rescue helper is ever added it MUST hard-code `to = owner()`. `execute`/`executeBatch` are the only outbound paths and are gated by `_requireFromEntryPointOrOwner()`; the EntryPoint only reaches `execute` after a validated owner sig or an in-scope session-key validation. **No code path lets the protocol/agent name a SparkPoint recipient.**
- **N3 — user-owned keys.** `owner()` is set at `initialize` to the user EOA and is the sole admin; no backend signer is ever owner/guardian/recovery. Default execution is per-action owner signature.
- **N4 — scoped automation.** `authorizeSessionKey`/`revokeSessionKey` are owner-only; scope is enforced on-chain by `PolicyModule` (§5). `revokeSessionKey` carries no pause modifier — revocation can never be blocked.
- **N5 — provability + scope.** `owner()`, `entryPoint()` are public view so the Trust Center reads them straight from chain. `SparkPointAccount` is UUPS-upgradeable but **owner-only** — the user is the sole upgrade authority (`_authorizeUpgrade` gated to `owner()`); SparkPoint can never upgrade a user's account. The **N5 non-upgradeability invariant is scoped to the vault, not the account**: the vault is hard non-upgradeable, while account upgradeability is a user-controlled convenience.

### Invariants (Foundry, `test/invariant/`)
- `invariant_onlyEntryPointOrOwnerMovesFunds`: across all reachable call sequences, the account's token balance decreases only via `execute`/`executeBatch` whose caller is EntryPoint (post owner/session validation) or owner.
- `invariant_noSparkPointRecipient`: no reachable execute can set a vault/adapter recipient to anything but `address(this)` / `owner()`.
- `invariant_onlyOwnerUpgrades`: `_authorizeUpgrade` reverts for any caller != `owner()`.

---

## 3. `AccountFactory` — CREATE2 factory (N3)

```solidity
/// @title AccountFactory
/// @notice Deterministically deploys one SparkPointAccount per user, binding owner at init.
/// @dev N3: `owner` is the user's self-custodied EOA, supplied by their wallet. SparkPoint NEVER
///      generates a private key and never appears as owner/guardian/recovery. Idempotent.
interface IAccountFactory {
    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    /// @notice Deploy (or return existing) the account for `owner`. CREATE2 ⇒ deterministic address.
    /// @dev Initializes the account with owner == the user EOA. Supports gasless first deposit via
    ///      initCode + paymaster. Returns the existing account if already deployed (idempotent).
    function createAccount(address owner, uint256 salt) external returns (address account);

    /// @notice Counterfactual address for `owner`/`salt` BEFORE deployment (frontend shows this).
    function getAddress(address owner, uint256 salt) external view returns (address);

    /// @notice The account implementation this factory deploys (public for Trust Center provability).
    function accountImplementation() external view returns (address);
}
```

### N-invariant annotations
- **N3.** The `owner` argument is the user's EOA; `initialize(owner)` binds it immutably-at-init. No factory path can inject a SparkPoint owner/co-signer. `getAddress` lets the frontend display the counterfactual account before any key exists on our side (there is none).

### Invariants
- `invariant_factoryOwnerIsCaller`: every account `AccountFactory` produces has `owner()` equal to the EOA passed by the user, never a SparkPoint address.

---

## 4. `SessionKeyValidator` — ERC-4337 validator module (N4)

```solidity
/// @title SessionKeyValidator
/// @notice Validates UserOps signed by a session key, delegating scope checks to PolicyModule.
/// @dev N4: a session key has ZERO standing authority. Every check is deterministic on-chain code;
///      a compromised agent holding the session private key can only churn within scope and can
///      NEVER name an external/SparkPoint recipient or exceed caps/slippage/expiry.
interface ISessionKeyValidator {
    /// @notice Validate a session-key UserOp against PolicyModule scope.
    /// @dev Flow (deterministic, account-associated storage only — bundler-compliant):
    ///   1. Recover signer; require it is a registered, non-revoked sessionKey.
    ///   2. require(block.timestamp ∈ [validAfter, validUntil]) else pack expiry → EntryPoint rejects.
    ///   3. Decode callData → (target, value, selector, innerData); require policy.allowed[target][selector].
    ///   4. Extract notional; require notional ≤ perTxCap AND spent + notional ≤ cumulativeCap; spent += notional.
    ///   5. Swaps: decode amountOutMin; require amountOutMin ≥ floor(maxSlippageBps); reject if 0/below floor.
    ///   6. Force recipient/`to` == account (NEVER external/SparkPoint) — else revert (N1).
    /// @return validationData packed (validUntil/validAfter); SIG_VALIDATION_FAILED on bad/revoked key.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external returns (uint256 validationData);

    /// @notice Whether `sessionKey` is currently usable on `account` (live storage read).
    function isActive(address account, address sessionKey) external view returns (bool);
}
```

### N-invariant annotations
- **N4.** Hard expiry (`validUntil`) is enforced in step 2 and surfaced to EntryPoint via packed `validationData`; per-tx + cumulative caps in step 4; slippage floor in step 5. Step 6 forcibly pins the recipient to the account, so even with the session private key the agent cannot exfiltrate funds (only in-scope churn). Reads live storage ⇒ a revocation takes effect on the very next UserOp.
- **N1 (reinforced).** Step 6's recipient pin is the on-chain guarantee that automation can never move funds to a SparkPoint/external address.

### Invariants
- `invariant_sessionCannotExceedPerTxCap` · `invariant_sessionCumulativeMonotonicAndCapped` · `invariant_sessionRejectsAfterExpiry` · `invariant_sessionRejectsNonAllowlistedTarget` · `invariant_sessionRecipientIsAccount` · `invariant_revokeIsImmediate` (post-revoke, the same UserOp reverts).

---

## 5. `PolicyModule` — on-chain policy registry (N4, caps, G2/G5)

```solidity
/// @title PolicyModule
/// @notice The on-chain authority both manual (SparkPointAccount) and automated (SessionKeyValidator)
///         execution consult. Deterministic scope: protocol+selector allowlist, per-tx & cumulative
///         caps, max-slippage floor, hard expiry.
/// @dev N4 + G2 + G5. State is stored in the ACCOUNT'S ASSOCIATED STORAGE (keyed by account) so
///      validateUserOp stays within EntryPoint storage-access rules and is bundler-acceptable.
interface IPolicyModule {
    /// @param sessionKey      pubkey the agent signs rebalances with (no standing authority)
    /// @param validAfter      activation timestamp
    /// @param validUntil      HARD expiry (N4)
    /// @param perTxCap        max notional per UserOp (USDC 6dp)
    /// @param cumulativeCap   lifetime ceiling for this key
    /// @param spent           running total (monotonic ↑; never resets)
    /// @param maxSlippageBps  floor on amountOutMin for swaps
    /// @param revoked         set true by revokeSessionKey
    struct Policy {
        address sessionKey;
        uint48  validAfter;
        uint48  validUntil;
        uint128 perTxCap;
        uint128 cumulativeCap;
        uint128 spent;
        uint16  maxSlippageBps;
        bool    revoked;
        // allowlist: target => selector => allowed  (seeded at authorization, see SparkPointAccount)
    }

    struct Call { address target; uint256 value; bytes data; }

    event PolicySeeded(address indexed account, address indexed sessionKey, uint48 validUntil);
    event PolicyRevoked(address indexed account, address indexed sessionKey);
    event Spent(address indexed account, address indexed sessionKey, uint256 notional, uint256 newSpent);

    /// @notice Is (target, selector) a whitelisted protocol entrypoint? Address+selector level (G5),
    ///         NOT name level — only specific Aave v3 Pool / Aerodrome Router / vault selectors pass.
    function isAllowedTarget(address target, bytes4 selector) external view returns (bool);

    /// @notice Stateless scope check used by SessionKeyValidator. Pure-ish view over account storage.
    /// @return ok      true iff allowlisted target+selector, value ≤ perTxCap, spent+value ≤ cumulativeCap,
    ///                 within [validAfter, validUntil], not revoked, slippage floor honored, recipient==account.
    /// @return reason  bytes32 reason code when !ok (surfaced off-chain).
    function checkAction(address account, Call calldata call, uint256 valueUSD)
        external view returns (bool ok, bytes32 reason);

    /// @notice Read a session policy (for SessionKeyValidator + Trust Center provability).
    function policyOf(address account, address sessionKey) external view returns (Policy memory);
}
```

### N-invariant annotations
- **N4.** `Policy` is the on-chain shape the frontend displays VERBATIM at authorization, so on-chain == displayed (FR-029). `spent` is monotonic; `cumulativeCap`/`perTxCap`/`validUntil`/`maxSlippageBps` are the bounds a compromised agent cannot cross.
- **G5 — whitelist.** `isAllowedTarget` is keyed `(target, selector)`; arbitrary `call` and ERC-20 `approve` are never allowlisted, so a session key cannot self-grant spend or reach unknown code. The same allowlist is mirrored (read) by the off-chain policy layer to prevent drift.
- **G2 — caps.** Per-tx + cumulative session caps live here; vault/global caps live in the vault + `CapRegistry` (§6). **Caps never gate withdrawals.**
- **No fund path.** `PolicyModule` holds no assets and exposes no transfer selector — it only answers `bool`.

### Invariants
- `invariant_allowlistAddressAndSelectorOnly` · `invariant_noApproveOrArbitraryCallEverAllowed` · `invariant_spentMonotonicAndBounded`.

---

## 6. `SparkPointVault` — ERC-4626 vault (N2, N5, caps)

```solidity
import {IERC4626} from "openzeppelin/interfaces/IERC4626.sol";

/// @title SparkPointVault
/// @notice Single-purpose, 0-management / profit-only performance-fee Aave Yield Vault.
///         USDC in → Aave aUSDC → withdraw anytime. 0% management, 0% entry/exit, 0% on principal;
///         a PERFORMANCE FEE of 10% (default; on-chain-configurable within a HARD CAP of 20%) is
///         charged on REALIZED YIELD ONLY, above a high-water mark (HWM) on share price — never on
///         principal, never in flat/down periods. "We only earn when you earn — never on your
///         principal, never by taking custody." ACTIVE AT LAUNCH (Sept 2026 v1).
/// @dev NON-UPGRADEABLE (N5): plain contract, no proxy, no upgradeTo, no EIP-1967 slots, no
///      delegatecall-to-impl. Immutables (USDC, AAVE_POOL, aUSDC, guardian, capRegistry) set in
///      constructor. Built on OZ v5 ERC4626 with virtual-offset (donation/inflation safe).
///      CONSTRUCTOR SEEDS the HWM: `highWaterMark = convertToAssets(1e18)` (== 1e18 under the OZ
///      ERC4626 virtual-shares offset at empty-vault state) so the first accrueFee() can NEVER charge
///      the fee on principal (a default-0 HWM would tax the ENTIRE share value on the first accrual —
///      N-fee / FR-050). The seeded HWM is monotonic up and never sits below 1e18 thereafter.
///      INVARIANT N2: withdraw/redeem carry NO whenNotPaused — exit is unconditional.
///      PERFORMANCE FEE (see §6.1) is realized by MINTING fee shares to a NON-PRIVILEGED feeRecipient
///      during a lazy, FAIL-OPEN `_accrueFee()` — it can NEVER block/revert withdraw/redeem and NEVER
///      reduce a user's redeemable principal below deposited principal. feeRate is the ONLY mutable
///      param: timelocked, hard-capped at 20%, multisig-bounded, and can NEVER alter custody/withdraw/
///      principal semantics (N1–N5 unchanged). Constitution v1.1.0 (standard amendment).
interface ISparkPointVault is IERC4626 {
    /// ── ERC-4626 surface (asset/share accounting; OZ-standard rounding ALWAYS in the VAULT's favor) ──
    /// asset()        => USDC
    /// totalAssets()  => aUSDC.balanceOf(this) (+ idle USDC, ~0). Reflects Aave yield automatically.
    ///                   The performance fee is taken via fee-SHARE dilution (§6.1), NOT by deducting
    ///                   from totalAssets() — so totalAssets() is always the full Aave-backed claim.
    /// convertToShares / convertToAssets / previewDeposit / previewMint / previewWithdraw / previewRedeem
    /// deposit(assets, receiver) / mint(shares, receiver)        — pausable (deposit side ONLY)
    /// withdraw(assets, receiver, owner) / redeem(shares, receiver, owner)  — NEVER pausable (N2)
    /// maxDeposit(receiver) => min(perUserRemaining, totalRemaining, vaultRemaining); 0 at cap (caps via ERC-4626)
    /// maxMint / maxWithdraw / maxRedeem accordingly

    /// ── Events ──
    /// Inherited ERC-4626: Deposit(caller, owner, assets, shares); Withdraw(caller, receiver, owner, assets, shares)
    event DepositsPaused(address indexed guardian);
    event DepositsUnpaused(address indexed guardian);
    event AaveSupplied(uint256 assets);
    event AaveWithdrawn(uint256 assets, address indexed receiver);
    /// @notice Fee shares minted to feeRecipient for realized yield above the HWM (§6.1). Profit-only.
    event PerformanceFeeAccrued(address indexed feeRecipient, uint256 feeShares, uint256 yieldAssets, uint256 newHighWaterMark);
    /// @notice feeRate changed by timelocked, hard-capped (≤2000 bps), multisig-bounded governance.
    event FeeRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    /// @notice HWM (share price, 1e18-scaled) advanced after a fee accrual on new highs.
    event HighWaterMarkUpdated(uint256 oldHighWaterMark, uint256 newHighWaterMark);
    /// @notice feeRecipient changed (timelocked governance). Always an ORDINARY, non-privileged holder.
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// ── Custody-relevant views (public for Trust Center provability, N5) ──
    function paused() external view returns (bool);     // PAUSE-ONLY status; withdrawals unaffected
    function guardian() external view returns (address); // multisig — pause/unpause ONLY, no fund path
    function pauser() external view returns (address);   // the ops multisig; role scope = PAUSE-ONLY (cannot move funds or block withdrawals)
    function depositCap() external view returns (uint256);
    function capRegistry() external view returns (address);
    function aavePool() external view returns (address);
    function aUSDC() external view returns (address);
    /// @notice Entry/exit fee BPS — overridden to a compile-time constant 0; not settable (0 at bytecode level).
    function entryFeeBasisPoints() external pure returns (uint256);  // == 0 (pure constant)
    function exitFeeBasisPoints() external pure returns (uint256);   // == 0 (pure constant)
    /// @notice Management fee BPS — overridden to a compile-time constant 0; not settable (no time-based fee).
    function managementFeeBasisPoints() external pure returns (uint256); // == 0 (pure constant)

    /// ── Performance fee surface (profit-only, HWM, capped — §6.1; public-view for Trust Center, N5) ──
    /// @notice Hard cap on the performance fee (bytecode constant). Governance can NEVER exceed this.
    function MAX_PERFORMANCE_FEE_BPS() external pure returns (uint16); // == 2000 (20%)
    /// @notice Current performance-fee rate in bps. Default 1000 (10%); timelocked, ≤ MAX_PERFORMANCE_FEE_BPS.
    ///         Applies ONLY to realized yield above the HWM — never to principal, never in flat/down periods.
    function performanceFeeBps() external view returns (uint16);
    /// @notice High-water mark on SHARE PRICE (assets-per-share, 1e18-scaled). Fee accrues only above this.
    ///         SEEDED in the constructor to `convertToAssets(1e18)` (== 1e18 at empty-vault state) so the
    ///         first accrual can never tax principal, and ADVANCED to the current pps on every deposit
    ///         (mandatory, non-fail-open). Monotonic up; never < 1e18 from block 0 (FR-050).
    function highWaterMark() external view returns (uint256);
    /// @notice The fee-share recipient — an ORDINARY, NON-privileged holder. Redeems via the same
    ///         withdraw/redeem path as any user; has NO admin/withdraw authority over other holders'
    ///         shares and cannot block, delay, or reorder any redemption.
    function feeRecipient() external view returns (address);

    /// @notice Lazy, idempotent fee accrual. Best-effort / FAIL-OPEN: if anything would revert it MUST
    ///         no-op and return 0 (NEVER bubble up). Invoked at the TOP of deposit/withdraw/redeem/harvest.
    ///         Mints fee shares to feeRecipient worth feeRate × (assets gained above HWM since last
    ///         accrual), then advances the HWM. Callable by anyone (e.g. a keeper); the withdraw/redeem
    ///         escape-hatch path NEVER depends on its success (N2).
    function accrueFee() external returns (uint256 feeSharesMinted);

    /// @notice Realize Aave interest into the share price and accrue the fee (keeper convenience).
    ///         Pure read-through to Aave + accrueFee(); no custody movement. Also FAIL-OPEN on the fee leg.
    function harvest() external;

    /// ── Governance (timelocked, multisig-bounded; NEVER a fund/custody/withdraw path — N1, N5) ──
    /// @notice Set the performance-fee rate. Timelocked + multisig; reverts if newRateBps > MAX (20%).
    ///         Cannot alter custody/withdraw/principal semantics; only the forward fee on FUTURE yield.
    function setPerformanceFeeBps(uint16 newRateBps) external;       // timelock + onlyGovernance; ≤ MAX
    /// @notice Set the fee-share recipient (timelocked + multisig). The new recipient is still an
    ///         ordinary, non-privileged share holder with no power over other users' funds.
    function setFeeRecipient(address newRecipient) external;          // timelock + onlyGovernance

    /// ── Pause: PAUSE-ONLY kill-switch (N5). Multisig/guardian ONLY. Touches deposit/mint ONLY. ──
    function pauseDeposits() external;   // guardian-only; blocks NEW deposits, never withdrawals
    function unpauseDeposits() external; // guardian-only
}
```

```solidity
// ── Constructor: set immutables AND SEED the HWM (load-bearing for principal preservation, FR-050) ──

/// @dev Sets the custody immutables and SEEDS highWaterMark so the first accrual can never tax principal.
///      At empty-vault state convertToAssets(1e18) == 1e18 under OZ ERC4626's virtual-shares offset, so
///      the seed is exactly 1e18. If left at the Solidity default 0, the first accrueFee() would treat the
///      ENTIRE share value (principal included) as "gain above the mark" and mint a fee on principal —
///      violating N-fee / FR-050. The seed makes highWaterMark >= 1e18 from block 0 (invariant_hwmNeverBelowInitial).
constructor(IERC20 usdc_, IPool aavePool_, IERC20 aUSDC_, address guardian_, address capRegistry_,
            address feeRecipient_, uint16 performanceFeeBps_)
    ERC20("SparkPoint Aave USDC Vault", "spkUSDC") ERC4626(usdc_)
{
    USDC = usdc_; AAVE_POOL = aavePool_; aUSDC = aUSDC_;          // custody immutables (N5)
    guardian = guardian_; capRegistry = capRegistry_;
    feeRecipient = feeRecipient_;
    require(performanceFeeBps_ <= MAX_PERFORMANCE_FEE_BPS, "FEE_CAP");
    performanceFeeBps = performanceFeeBps_;                       // default 1000 (10%), <= 2000 hard cap
    highWaterMark = convertToAssets(1e18);                       // SEED == 1e18 (empty-vault virtual-offset) — never tax principal
}

// ── Load-bearing implementation detail: WHERE the pause modifier sits ──

/// @dev Deposit IS pausable + cap-checked. Cap enforced even if frontend is bypassed. ACCRUE-THEN-PRICE.
///      HWM HANDLING (FR-050): accrue FIRST (atomic mint+advance) so existing holders pay the
///      performance fee on yield-above-HWM up to NOW before the new shares are priced. accrueFee() is
///      FAIL-OPEN; if (and ONLY if) its fee-share MINT leg is skipped, the MANDATORY non-fail-open
///      _settleHighWaterMark() fallback force-advances the HWM to the current pps WITHOUT minting — so a
///      late depositor can never be charged on pre-entry yield even when the mint failed open. The
///      fallback is a no-op on the success path and NEVER runs before/instead of the mint (that would
///      zero the gain and under-collect the fee).
///      (Model note: this is a single per-share GLOBAL HWM with an accrue-first deposit-time settle. A
///      per-depositor cost-basis HWM is the alternative that removes cross-cohort exposure entirely; the
///      accrue-then-settle deposit path gives the same principal-preservation guarantee for the global model.)
function deposit(uint256 assets, address receiver)
    public override whenDepositsAllowed returns (uint256 shares)
{
    _tryAccrueFee();                                      // BEST-EFFORT: atomic accrueFee() = mint fee shares for gain>HWM AND advance HWM
    _settleHighWaterMark();                               // FALLBACK ONLY: no-op if accrueFee already advanced HWM; force-advances HWM (no mint) only if the mint failed open
    require(assets <= maxDeposit(receiver), "CAP");        // per-user / total / vault (G2)
    shares = previewDeposit(assets);                       // priced AFTER accrual so the incoming depositor is not diluted by it
    USDC.safeTransferFrom(msg.sender, address(this), assets);
    AAVE_POOL.supply(address(USDC), assets, address(this), 0);
    _mint(receiver, shares);
    emit Deposit(msg.sender, receiver, assets, shares);
}

/// @dev INVARIANT N2: NO whenNotPaused here. The single most important modifier-placement in the codebase.
///      Redemption calls Aave directly; no SparkPoint contract/oracle/agent is on this path.
///      Partial-liquidity is handled by ROUNDING-SOUND clamps at the PUBLIC entry points
///      maxWithdraw()/maxRedeem(), so BOTH the withdraw(assets) and redeem(shares) wrappers cap the
///      request to what Aave can actually pay. Crucially the clamps are derived so the assets the OZ
///      wrappers ultimately compute can NEVER exceed availableLiquidity():
///        - maxWithdraw clamps assets directly to availableLiquidity() (convertToAssets rounds DOWN).
///        - maxRedeem clamps SHARES to convertToShares(availableLiquidity()) (rounds DOWN), so
///          previewRedeem(maxRedeem) = convertToAssets(maxRedeem) <= availableLiquidity(). We do NOT
///          derive maxRedeem from previewWithdraw() — that rounds UP and could push the recomputed
///          assets ABOVE available liquidity, tripping the require below.
///      By construction _withdraw is only ever called for an `assets` amount Aave can fully satisfy.
///      Ordering is also safe: we pull from Aave FIRST and only burn shares for assets actually
///      received — never burn shares for assets that won't be delivered.

/// @notice Underlying USDC currently withdrawable from Aave for this vault.
///         For a request <= this amount, Aave v3 IPool.withdraw returns EXACTLY the requested amount.
function availableLiquidity() public view returns (uint256) {
    return Math.min(
        aUSDC.balanceOf(address(this)),          // our claim on the reserve
        USDC.balanceOf(address(aUSDC))           // underlying USDC actually held by the aToken
    );
}
function maxWithdraw(address owner_) public view override returns (uint256) {
    uint256 byShares = convertToAssets(balanceOf(owner_));          // assets implied by owner's shares (rounds DOWN)
    return Math.min(byShares, availableLiquidity());               // clamp assets to what Aave can actually pay
}
function maxRedeem(address owner_) public view override returns (uint256) {
    uint256 liquidShares = convertToShares(availableLiquidity());  // shares payable from liquidity (rounds DOWN)
    return Math.min(balanceOf(owner_), liquidShares);              // => previewRedeem(maxRedeem) <= availableLiquidity()
}

function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
    internal override
{
    // NOTE: do NOT call _spendAllowance here — super._withdraw (OZ v5) already spends the caller's
    // allowance exactly once when caller != owner_. Spending it here too would double-decrement and
    // spuriously revert approved-spender exits.
    // The public withdraw()/redeem() wrappers clamp to maxWithdraw()/maxRedeem(), so `assets` is
    // ALWAYS <= availableLiquidity() here. Pull from Aave FIRST; reconcile shares to assets received.
    uint256 received = AAVE_POOL.withdraw(address(USDC), assets, address(this));  // returns amount delivered
    require(received == assets, "PARTIAL");  // DEFENSIVE: clamps make this provably non-tripping for BOTH paths
    super._withdraw(caller, receiver, owner_, assets, shares);       // spends allowance once (if caller != owner_) + burns `shares` + transfers `assets`; emits Withdraw
}

// ── §6.1 PERFORMANCE FEE — lazy, profit-only, HWM, FAIL-OPEN (the load-bearing non-custody detail) ──

/// @notice The public withdraw()/redeem() wrappers invoke _accrueFee() in a try/no-revert wrapper
///         BEFORE the exit, but the accrual is BEST-EFFORT and the exit path is INDEPENDENT of it.
/// @dev INVARIANT N2 (reinforced): _accrueFee MUST NOT be able to block or revert an exit. It is called
///      via a low-level self-call guarded so a revert is swallowed (FAIL-OPEN — skip the fee, keep going).
///      The withdraw/redeem math (maxWithdraw/maxRedeem clamps, Aave unwind, burn) NEVER reads a
///      successful accrual as a precondition. If accrual is skipped, the only effect is the protocol
///      forgoes a fee on that exit — the user still exits in full.
function withdraw(uint256 assets, address receiver, address owner_)
    public override returns (uint256 shares)        // NO whenNotPaused (N2)
{
    _tryAccrueFee();                                // FAIL-OPEN; can never block the exit below
    return super.withdraw(assets, receiver, owner_);// OZ path: clamps to maxWithdraw, _withdraw, burn
}
function redeem(uint256 shares, address receiver, address owner_)
    public override returns (uint256 assets)        // NO whenNotPaused (N2)
{
    _tryAccrueFee();                                // FAIL-OPEN; can never block the exit below
    return super.redeem(shares, receiver, owner_);  // OZ path: clamps to maxRedeem, _withdraw, burn
}

/// @dev FAIL-OPEN wrapper. A revert in fee accrual is swallowed so the redemption is never blocked (N2).
function _tryAccrueFee() internal {
    try this.accrueFee() returns (uint256) { /* ok */ } catch { /* skip the fee, NEVER revert the exit */ }
}

/// @notice FAIL-OPEN FALLBACK HWM advance (NON-fail-open itself). Settle highWaterMark up to the CURRENT
///         pps WITHOUT minting. In deposit() this runs AFTER `_tryAccrueFee()` — NEVER before/instead of the
///         fee-share mint (running it first would raise the HWM to pps so accrueFee sees gain == 0 and
///         under-collects the fee to ZERO). On the success path it is a NO-OP, because accrueFee() already
///         advanced the HWM to the post-mint pps. It only does real work when accrueFee()'s MINT leg failed
///         open: then it force-advances the mark so a late depositor entering at a pps above the global HWM
///         is never later charged a fee on yield that accrued BEFORE their entry (which would dilute their
///         principal below deposit — FR-050). The HWM is monotonic up: it is raised to pps, never lowered.
/// @dev Note this advances the mark WITHOUT minting — it just records the price at/below which no fee is
///      owed. The fee-share mint for the gain up to here is the SEPARATE, fail-open primary leg in accrueFee().
function _settleHighWaterMark() internal {
    uint256 pps = convertToAssets(1e18);
    if (pps > highWaterMark) {                                   // raise the mark to the current price (monotonic ↑)
        emit HighWaterMarkUpdated(highWaterMark, pps);
        highWaterMark = pps;
    }
}

/// @notice MECHANISM: share-price HWM, fee on realized yield only, realized by minting fee shares.
/// @dev Let pps = convertToAssets(1e18) be the current assets-per-share (1e18-scaled), computed from the
///      LIVE Aave-backed totalAssets(). hwm = highWaterMark (last high pps at which fee was settled).
///      hwm is SEEDED at deployment to convertToAssets(1e18) (== 1e18, empty-vault virtual-offset) and
///      ADVANCED on every deposit: deposit() runs accrueFee() FIRST (atomic mint-for-gain-above-HWM AND
///      advance), THEN _settleHighWaterMark() as a fail-open fallback that only force-advances the HWM if
///      the mint leg was skipped, so it never sits below the price implied by the latest deposit. Within accrueFee:
///        1. If pps <= hwm  → NO gain above the mark → mint nothing, do NOT lower the HWM (no fee in
///           flat OR down periods; a prior loss must be fully re-earned before any new fee — N-fee).
///        2. Else gainPerShare = pps - hwm; gainAssets = gainPerShare × totalSupply / 1e18 (yield realized
///           above the mark across all shares). feeAssets = gainAssets × performanceFeeBps / 10_000.
///        3. feeShares = convertToShares(feeAssets) computed so the recipient's CLAIM ≈ feeAssets, i.e.
///           feeShares = feeAssets × totalSupply / (totalAssets() - feeAssets) (rounded DOWN, in the
///           vault's / existing holders' favor). The fee is taken as DILUTION (new shares), so it NEVER
///           touches totalAssets() and NEVER reduces any existing holder's underlying principal.
///        4. _mint(feeRecipient, feeShares); then advance hwm to the post-mint pps (so the same gain is
///           never charged twice — strictly monotonic up). emit PerformanceFeeAccrued + HighWaterMarkUpdated.
///      PRINCIPAL PRESERVATION (N-fee invariant / FR-050): fee shares are minted ONLY against yield strictly
///      above the HWM; the HWM is SEEDED at >= 1e18 at deployment and advanced to the current pps on every
///      deposit — accrueFee() runs FIRST (atomic mint+advance) and the non-fail-open _settleHighWaterMark()
///      fallback then guarantees the advance even if the fee-share MINT was skipped. So a holder's redeemable
///      assets can NEVER fall below their deposited principal as a result of fee dilution, and a late
///      depositor is never charged on pre-entry yield. (Per-share GLOBAL HWM with an accrue-first
///      deposit-time settle; a per-depositor cost-basis HWM is the alternative that scopes the mark per
///      cohort — the accrue-then-settle deposit path gives the same guarantee under the single global model.)
///      FEERECIPIENT IS NON-PRIVILEGED: it receives ordinary ERC-4626 shares and can only ever redeem
///      them via the same withdraw/redeem path as anyone; it has no admin, no withdraw authority over
///      others, and cannot block/delay/reorder any redemption.
function accrueFee() public returns (uint256 feeShares) {
    uint256 pps = convertToAssets(1e18);
    if (pps <= highWaterMark) return 0;                          // flat/down → no fee, HWM unchanged
    uint256 gainAssets = ((pps - highWaterMark) * totalSupply()) / 1e18;
    uint256 feeAssets  = (gainAssets * performanceFeeBps) / 10_000;
    if (feeAssets == 0) return 0;
    feeShares = (feeAssets * totalSupply()) / (totalAssets() - feeAssets);  // round DOWN (vault's favor)
    if (feeShares == 0) return 0;
    _mint(feeRecipient, feeShares);                             // dilution only — totalAssets() untouched
    uint256 newHwm = convertToAssets(1e18);                     // post-mint pps (monotonic ↑)
    emit PerformanceFeeAccrued(feeRecipient, feeShares, gainAssets, newHwm);
    emit HighWaterMarkUpdated(highWaterMark, newHwm);
    highWaterMark = newHwm;
}
```

### N-invariant annotations
- **N1 — no admin withdrawal.** The ONLY functions that move USDC out are ERC-4626 `withdraw`/`redeem`, callable by the share `owner_` or an approved spender. There is **no** `onlyGuardian`/`onlyOwner` asset-movement function — no `sweep`, no `rescue(to)`, no migrate-to-address. The aUSDC position is owned by the vault and only unwound on user redemption. **The performance fee adds NO fund path:** the fee is realized purely by `_mint`-ing fee SHARES to `feeRecipient` (ERC-4626 dilution), never by transferring assets to a SparkPoint/governance address. `feeRecipient` collects only by redeeming its own shares via the same public `withdraw`/`redeem` path as any user; it has no authority over anyone else's shares.
- **N2 — withdraw-always.** `withdraw`/`redeem`/`_withdraw` carry **no** `whenNotPaused`; only `deposit`/`mint` carry `whenDepositsAllowed`. A user can `redeem` directly via cast/explorer with the whole SparkPoint stack offline and **while `paused == true`**. Partial-liquidity handling is routed through the public `withdraw`/`redeem` wrappers via **rounding-sound** `maxWithdraw`/`maxRedeem` clamps against `availableLiquidity()`: `maxWithdraw` returns `min(convertToAssets(shares), availableLiquidity())` (assets clamped directly), and `maxRedeem` returns `min(balanceOf(owner), convertToShares(availableLiquidity()))` with `convertToShares` rounding **DOWN** — so `previewRedeem(maxRedeem) = convertToAssets(maxRedeem) ≤ availableLiquidity()`. (maxRedeem is **not** derived from `previewWithdraw`, which rounds UP and could push the OZ-recomputed `assets` above available liquidity.) Consequently **both** `withdraw(assets)` and `redeem(shares)` at the clamped max **SUCCEED**, delivering the currently-liquid portion; the remaining shares stay redeemable as liquidity returns. There is **no hard revert at or below `maxWithdraw`/`maxRedeem` on either path**. `_withdraw` pulls from Aave FIRST and only then burns shares + transfers assets; because the wrappers clamp the request, `assets ≤ availableLiquidity()` always holds, so the `require(received == assets, "PARTIAL")` is a **defensive assertion that cannot trip** for either the withdraw or the redeem path. A partial exit (up to current liquidity) thus beats a hard revert, and **this preserves N2 for BOTH the `withdraw` and `redeem` escape-hatch paths**: the escape hatch always lets the user exit at least the liquid portion, with no SparkPoint liquidity lock ever added. The performance-fee accrual the wrappers invoke first (`_tryAccrueFee`) is **try/catch FAIL-OPEN**, so it can never block, revert, or delay the exit — if accrual would revert it is silently skipped and the redemption proceeds unchanged; **the exit path never reads a successful accrual as a precondition.**
- **N5 — non-upgradeable + provable.** No proxy/`upgradeTo`/admin slot; immutables set in constructor. Governance multisig is wired to `pauseDeposits`/`unpauseDeposits`, bounded `CapRegistry` params, and the timelocked `setPerformanceFeeBps`/`setFeeRecipient` ONLY — it has **no** call path to vault assets and **no** ability to alter custody/withdraw/principal semantics. **Entry/exit and management fees are `pure` constant `0`** (bytecode-level, not config). The **performance fee** is the single mutable parameter: `performanceFeeBps` is **timelocked, hard-capped at `MAX_PERFORMANCE_FEE_BPS == 2000` (20%), and multisig-bounded** (`setPerformanceFeeBps` reverts above the cap), and it touches only the FORWARD fee on FUTURE yield-above-HWM — it can never reach principal, never gate or block a withdraw, never make the vault upgradeable. `performanceFeeBps()`/`highWaterMark()`/`feeRecipient()`/`MAX_PERFORMANCE_FEE_BPS()` are public view for the Trust Center alongside `paused()`/`guardian()`/`pauser()`/`depositCap()`. The `pauser()` role is held by the operations multisig and is **PAUSE-ONLY** — it can call `pauseDeposits`/`unpauseDeposits` only and has **no** path to move funds or block withdrawals.
- **N-fee — profit-only, HWM, principal-preserving, withdraw-independent.** (1) The fee is charged ONLY on realized yield strictly **above** the share-price high-water mark — **0 fee in flat or down periods**, and a prior drawdown must be fully re-earned before any new fee (the HWM is monotonic up, never lowered). (2) Because fee shares are minted only against gains above the HWM — and the HWM is **SEEDED in the constructor** to `convertToAssets(1e18)` (== 1e18, so the FIRST accrual can never tax principal) and **advanced** to the current pps on every deposit (deposit runs `accrueFee()` FIRST for atomic mint+advance, then a non-fail-open `_settleHighWaterMark()` fallback that force-advances the HWM only if the mint leg was skipped, so a late depositor is never charged on pre-entry yield) — **a holder's redeemable assets can never fall below their deposited principal** due to fee dilution — 0% on principal. (3) `_accrueFee`/`accrueFee` is **lazy + idempotent + FAIL-OPEN**: the public `withdraw`/`redeem` call it via `_tryAccrueFee()` (try/catch swallow), so a revert in accrual is **impossible to propagate** to the exit — **the withdraw-always path (N2) is fully independent of fee collectability**. (4) The fee is realized as ERC-4626 share **dilution to a non-privileged `feeRecipient`**, never as an asset transfer (N1).
- **Caps (G2).** Enforced via ERC-4626 `maxDeposit` override (`min(perUser, total, vault)`) in both `maxDeposit` (frontend pre-sign block, FR-025/SC-009) and `deposit` (on-chain backstop). Caps **never** gate `withdraw`/`redeem`. `CapRegistry` params are multisig-settable only within hard-coded max ceilings, so even a compromised multisig cannot open caps to infinity.

### Invariants (the security-critical suite, `test/invariant/NonCustody.t.sol`)
- **N1:** `invariant_noAdminCanDrain` — no caller other than the share-owner/approved can reduce another account's balance to an external address; no governance role can call any asset-transfer selector.
- **N2:** `test_withdrawWorks_whenPaused_andOffline` — `redeem`/`withdraw` succeed with `paused() == true`; grep asserts only `deposit`/`mint` carry the pause modifier.
- **N5:** `test_vaultNotBehindProxy` — no `Upgraded`/`AdminChanged` events, EIP-1967 slots empty, no `delegatecall`-to-impl; `test_governanceIsPauseOnly` — enumerate role-gated functions, assert none touch funds.
- **Caps:** `invariant_totalAssetsLeTotalCap`; per-user shares ≤ per-user cap at deposit time.
- **ERC-4626 rounding:** fuzz deposit/withdraw round-trips never let a user extract more than `deposited + yield` (virtual-offset guards share-inflation/donation).
- **Performance fee (`test/invariant/PerformanceFee.t.sol`):**
  - `invariant_feeOnlyAboveHighWaterMark` — across any sequence of yield-up/yield-down/deposit/withdraw, `PerformanceFeeAccrued` is emitted (and fee shares minted) ONLY when the post-state share price exceeds the prior `highWaterMark`; `highWaterMark` is monotonic non-decreasing and is never lowered by a loss.
  - `invariant_hwmNeverBelowInitial` — `highWaterMark >= 1e18` from block 0 onward, across every state and yield path (constructor seed `convertToAssets(1e18) == 1e18`, monotonic up, mandatory deposit-time advance) — so the first accrual can never tax principal (FR-050).
  - `test_firstAccrualAfterFirstDeposit_chargesZeroFee` — after the FIRST deposit, with share price NOT risen above the seed, the first `accrueFee()` mints 0 fee shares and emits no `PerformanceFeeAccrued`; the depositor redeems exactly their deposited principal (the seeded HWM means the fee is never taken on principal).
  - `test_lateDepositor_notChargedOnPreEntryYield` — deposit while accrual reverts (mocked `accrueFee` reverting, so the fail-open MINT leg is skipped), then raise the Aave price and `accrueFee()`; assert the fallback deposit-time `_settleHighWaterMark` advanced the mark at entry, so the late depositor still redeems `>=` their deposited principal (never charged on yield that accrued before entry).
  - `test_depositOnFreshHigh_mintsFee` — with `performanceFeeBps > 0`, an existing holder, and the Aave price raised so pps is strictly ABOVE the current `highWaterMark`, a `deposit()` (NOT a separate keeper `accrueFee()`) MUST actually MINT a non-zero performance fee to `feeRecipient` and emit `PerformanceFeeAccrued` — guarding the accrue-FIRST ordering so the deposit-time settle never pre-advances the HWM to zero the gain. (The other tests only check the no-overcharge / fail-open directions, which let this fee-zeroing reorder bug through.)
  - `invariant_noFeeInFlatOrDownPeriods` — fuzz Aave-yield deltas ≤ 0 (and exactly-flat): `accrueFee()` mints 0 and emits nothing; share price unchanged for existing holders.
  - `invariant_principalPreserved` — for every depositor, `convertToAssets(balanceOf(user))` (and any redeem at current liquidity) is always ≥ their net deposited principal, for ALL fee rates in `[0, MAX]` and all yield paths (fee dilution never eats principal).
  - `test_withdrawAlways_independentOfAccrual` — with a mocked `accrueFee` that ALWAYS reverts, `withdraw`/`redeem` still succeed (FAIL-OPEN), including while `paused() == true` and with the SparkPoint stack offline; asserts the exit amount is identical to the no-fee path.
  - `invariant_feeRateWithinCap` — `performanceFeeBps <= MAX_PERFORMANCE_FEE_BPS (2000)` always; `setPerformanceFeeBps(x)` for `x > 2000` reverts; non-governance / pre-timelock callers revert.
  - `invariant_feeRecipientIsOrdinaryHolder` — `feeRecipient` can reduce only its OWN balance via `withdraw`/`redeem`; no fee-path selector lets it touch another holder's shares or block/reorder a redemption.
  - `test_feeMintMatchesYieldShare` (fuzz) — minted fee-share claim ≈ `performanceFeeBps × yieldAboveHWM` (rounded in the vault's favor), and `totalAssets()` is unchanged by accrual (dilution-only).

---

## 7. ERC-4337 / ERC-4626 correctness notes (normative)

**ERC-4337 (v0.7):**
- `validateUserOp(PackedUserOperation, bytes32 userOpHash, uint256 missingAccountFunds)` returns packed `validationData = authorizer (160) | validUntil (48) | validAfter (48)`; `authorizer == 0` ⇒ valid, `== 1` ⇒ `SIG_VALIDATION_FAILED`. Session keys pack `validUntil`/`validAfter` so EntryPoint enforces expiry.
- Validation MUST touch only the account's own/associated storage (no external SLOADs of foreign contracts) to pass bundler simulation. `PolicyModule` state is account-associated by design.
- EntryPoint is the canonical v0.7 singleton, pinned as an immutable in the account; a wrong pin is a test failure, not a prod incident. Bundler = Alchemy (Pimlico fallback). Paymaster (optional) pays **gas only** and is never on the fund or withdrawal path.

**ERC-4626:**
- `deposit`/`mint`/`withdraw`/`redeem` + previews + `convertTo*` follow OZ v5 semantics; per EIP-4626 rounding is **always in the vault's favor (against the user)** to protect existing depositors — never to over-credit a depositor. Specifically: `convertToShares`/`previewDeposit` round **DOWN** (user gets fewer shares); `previewMint` rounds **UP** (user pays more assets in); `previewWithdraw` rounds **UP** (more shares burned); `convertToAssets`/`previewRedeem` round **DOWN** (user gets fewer assets out). This is the standard EIP-4626 direction.
- `totalAssets()` = aUSDC balance (rebasing, includes Aave interest) + idle USDC; share price tracks Aave yield. The performance fee is **not** a term in `totalAssets()` — it is taken as fee-share **dilution** on realized yield above the HWM (§6.1), so `totalAssets()` always equals the full Aave-backed claim and existing holders' underlying is never reduced below principal. `maxDeposit` returns 0 at cap so standard tooling reflects the cap; `maxWithdraw`/`maxRedeem` are never reduced by pause, caps, or fee accrual.
- Virtual-offset (OZ v5) defeats the first-depositor/donation inflation attack.

**Aave v3 / Aerodrome:**
- Aave: `IPool.supply(asset, amount, onBehalfOf=vault/account, referralCode=0)` and `IPool.withdraw(asset, amount, to)`; ETH routed through `WrappedTokenGatewayV3` (`depositETH`/`withdrawETH`). USDC is the must-have; ETH gated behind a flag if the gateway address is unconfirmed at build.
- Aerodrome: `Router.swapExactTokensForTokens(amountIn, amountOutMin, Route[]{from,to,stable,factory}, to=account, deadline)`; `amountOutMin` is the on-chain slippage floor (enforced by the AMM and re-checked by `PolicyModule` for session keys); `to` forced to the account.

---

## 8. Traceability

| Contract / property | FR / SC | Invariant | Guardrail |
|---|---|---|---|
| Vault `withdraw`/`redeem` not pausable | FR-026, FR-034, SC-003 | **N2** | G3 |
| No admin asset-transfer selector | FR-033, SC-004 | **N1** | — |
| Factory binds user EOA owner | FR-035 | **N3** | — |
| Session scope (caps/slippage/expiry/allowlist) | FR-029/030/036, SC-008 | **N4** | G2, G5 |
| Owner-only instant revoke | FR-031, FR-032 | **N4** | — |
| Vault non-upgradeable, pause-only governance | FR-017, FR-037 | **N5** | G6 |
| Performance fee: profit-only, HWM, capped 20%, timelocked, fail-open accrual, principal-preserving | FR-017, FR-037 | **N1, N2, N5, N-fee** | G6 |
| Caps in `maxDeposit`/`deposit` | FR-025, SC-009 | caps | G2 |
| `(target,selector)` allowlist | FR-016/027, SC-006 | — | G5 |
| Public-view roles for Trust Center | FR-038, SC-012 | N1/N5 provability | — |

**Net:** custody guarantees are enforced at the bytecode/modifier level — pause never touches withdraw, no admin asset-movement selector exists, session scope is checked deterministically in `validateUserOp` against account-associated storage, the protocol allowlist is unreachable to bypass, and the vault is hard non-upgradeable with governance limited to PAUSE plus a single timelocked, hard-capped (≤20%) performance-fee rate that touches only forward yield-above-HWM. The profit-only performance fee is realized as fail-open fee-share dilution to a non-privileged recipient, so it never reaches principal and the withdraw-always path is fully independent of it.
