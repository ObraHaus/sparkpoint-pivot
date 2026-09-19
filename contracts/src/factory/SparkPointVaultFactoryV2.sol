// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    UUPSUpgradeable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { BeaconProxy } from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { CapRegistry } from "../governance/CapRegistry.sol";
import { SparkPointUniversalVault } from "../vault/SparkPointUniversalVault.sol";
import { ISparkPointUniversalVault } from "../interfaces/ISparkPointUniversalVault.sol";
import { ISparkPointVaultFactoryV2 } from "../interfaces/ISparkPointVaultFactoryV2.sol";

/// @title SparkPointVaultFactoryV2 — deploy-only factory for universal wrapper proxies (feature 049)
/// @notice Deploys one `BeaconProxy` (bound to the timelock-owned beacon) + one `CapRegistry` per
///         curated vault, atomically initialized. Holds NO funds, has NO deposit/withdraw/sweep/
///         rescue/migrate selector, and retains NO authority over deployed wrappers.
///
/// @dev AUTHORITY (constitution v4.0.0):
///        owner        the TimelockController (3-of-5 proposer, independent canceller, ≥72h delay).
///                     Owns the allowlist, the deployer role, the fleet defaults, and this factory's
///                     own UUPS upgrade path (`_authorizeUpgrade onlyOwner`) — never an EOA.
///        deployer     a scoped hot key (the AI wrapper-deploy runner). It can ONLY call
///                     `createVault` for an ALLOWLISTED child with fee ≤ 2000 and bounded caps.
///                     It cannot upgrade, allowlist, pause, set recipients, or move funds.
///
///      UPGRADEABILITY: this factory is FUNDLESS (it custodies nothing) — the constitution permits
///      upgradeability for fundless infra. It sits behind a **Transparent proxy** whose ProxyAdmin
///      is owned by the timelock; the implementation itself carries NO upgrade function and NO
///      payable function, so it can never hold value and there is no in-implementation upgrade
///      surface to abuse. Upgrading the factory can never touch an existing wrapper.
///
///      STORAGE: ERC-7201 namespaced (slot derived from "sparkpoint.storage.SparkPointVaultFactoryV2").
contract SparkPointVaultFactoryV2 is Initializable, OwnableUpgradeable, ISparkPointVaultFactoryV2 {
    uint16 internal constant _MAX_PERFORMANCE_FEE_BPS = 2000; // 20% — mirrors the wrapper cap
    uint256 internal constant _DEPLOY_WINDOW = 1 days;
    uint256 internal constant _MAX_DECIMALS = 36;

    /// @custom:storage-location erc7201:sparkpoint.storage.SparkPointVaultFactoryV2
    struct FactoryStorage {
        address beacon;
        address guardian;
        address feeRecipient;
        uint32 deployLimit; // 0 = unlimited; else max deploys per rolling 1-day window
        uint32 deploysInWindow;
        uint64 windowStart;
        mapping(address => bool) deployers;
        mapping(address => bool) allowlisted;
    }

    // keccak256(abi.encode(uint256(keccak256("sparkpoint.storage.SparkPointVaultFactoryV2")) - 1))
    //   & ~bytes32(uint256(0xff))
    bytes32 private constant _STORAGE_LOCATION =
        0xf8b6198b100dabebcf409d375df9a3cf7ed72fac998c758dd977324e3146cb00;

    function _store() private pure returns (FactoryStorage storage $) {
        assembly {
            $.slot := _STORAGE_LOCATION
        }
    }

    error NotDeployer();
    error NotAllowlisted(address child);
    error FeeExceedsCap();
    error ZeroAddress();
    error DuplicateSalt();
    error InvalidChild();
    error DeployLimitReached();
    error SaltRequired();

    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer (the factory is deployed behind a UUPS ERC1967 proxy).
    /// @param owner_ the TimelockController.
    /// @param beacon_ the UpgradeableBeacon owned by the same timelock.
    /// @param guardian_ the wrapper guardian (normally the same timelock).
    /// @param feeRecipient_ the non-privileged treasury receiving fee shares.
    function initialize(address owner_, address beacon_, address guardian_, address feeRecipient_)
        external
        initializer
    {
        if (
            owner_ == address(0) || beacon_ == address(0) || guardian_ == address(0)
                || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }
        __Ownable_init(owner_);
        FactoryStorage storage $ = _store();
        $.beacon = beacon_;
        $.guardian = guardian_;
        $.feeRecipient = feeRecipient_;
        $.windowStart = uint64(block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deploy — role-gated to the scoped deployer; allowlist + bounds enforced on-chain
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactoryV2
    function createVault(CreateVaultParams calldata p) external returns (address proxy) {
        FactoryStorage storage $ = _store();
        if (!(msg.sender == owner() || $.deployers[msg.sender])) revert NotDeployer();
        if (p.salt == bytes32(0)) revert SaltRequired();
        if (!$.allowlisted[address(p.child)]) revert NotAllowlisted(address(p.child));
        if (p.feeBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();
        _chargeDeploy($);
        _validateChild(p.child);

        address capRegistry = _deployCapRegistry(p.perUserCap, p.totalCap, p.vaultCap, p.salt);
        bytes memory initData = _initData($, p, capRegistry);
        proxy = address(new BeaconProxy{ salt: p.salt }($.beacon, initData));
        emit VaultCreated(address(p.child), proxy, capRegistry, msg.sender, p.feeBps, p.label);
    }

    /// @inheritdoc ISparkPointVaultFactoryV2
    function predictVaultAddress(CreateVaultParams calldata p)
        external
        view
        returns (address proxy)
    {
        FactoryStorage storage $ = _store();
        address capRegistry = _predictCapRegistry(p.perUserCap, p.totalCap, p.vaultCap, p.salt);
        bytes memory initData = _initData($, p, capRegistry);
        return Create2.computeAddress(
            p.salt,
            // bytes.concat, not abi.encodePacked: same bytes (the exact init code the CREATE2
            // deploy produces), without the hash-collision heuristic a packed encoding invites.
            keccak256(bytes.concat(type(BeaconProxy).creationCode, abi.encode($.beacon, initData)))
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Owner config (timelock) — never a fund path
    // ─────────────────────────────────────────────────────────────────────────

    function setAllowlisted(address child, bool allowed) external onlyOwner {
        if (child == address(0)) revert ZeroAddress();
        _store().allowlisted[child] = allowed;
        emit AllowlistUpdated(child, allowed, msg.sender);
    }

    function setDeployer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _store().deployers[account] = allowed;
        emit DeployerUpdated(account, allowed, msg.sender);
    }

    function setBeacon(address newBeacon) external onlyOwner {
        if (newBeacon == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit BeaconUpdated($.beacon, newBeacon);
        $.beacon = newBeacon;
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit GuardianUpdated($.guardian, newGuardian);
        $.guardian = newGuardian;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit FeeRecipientUpdated($.feeRecipient, newRecipient);
        $.feeRecipient = newRecipient;
    }

    function setDeployLimit(uint32 newLimit) external onlyOwner {
        FactoryStorage storage $ = _store();
        emit DeployLimitUpdated($.deployLimit, newLimit);
        $.deployLimit = newLimit;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function beacon() external view returns (address) {
        return _store().beacon;
    }

    function guardian() external view returns (address) {
        return _store().guardian;
    }

    function feeRecipient() external view returns (address) {
        return _store().feeRecipient;
    }

    function deployLimit() external view returns (uint32) {
        return _store().deployLimit;
    }

    function isDeployer(address account) external view returns (bool) {
        return _store().deployers[account];
    }

    function isAllowlisted(address child) external view returns (bool) {
        return _store().allowlisted[child];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Rolling-window deploy limit for the scoped deployer (0 = unlimited). Makes a compromised
    ///      deploy key loud instead of silent: it can spam at most `deployLimit` wrappers per day.
    function _chargeDeploy(FactoryStorage storage $) internal {
        if ($.deployLimit == 0) return;
        if (block.timestamp >= uint256($.windowStart) + _DEPLOY_WINDOW) {
            $.windowStart = uint64(block.timestamp);
            $.deploysInWindow = 0;
        }
        if (++$.deploysInWindow > $.deployLimit) revert DeployLimitReached();
    }

    /// @dev On-chain admission checks for an arbitrary ERC-4626 child (FR-049-007). The allowlist is
    ///      the first gate; this is the last. Sync-only, non-reverting views required.
    function _validateChild(IERC4626 child) internal view {
        if (address(child).code.length == 0) revert InvalidChild();
        if (child.asset() == address(0)) revert InvalidChild();
        if (child.decimals() > _MAX_DECIMALS) revert InvalidChild();
        // A reverting conversion is a hard reject; a 0 here (empty or fully-capped child) is legal.
        try child.convertToAssets(1e18) returns (uint256) { }
        catch {
            revert InvalidChild();
        }
    }

    function _deployCapRegistry(
        uint256 perUserCap,
        uint256 totalCap,
        uint256 vaultCap,
        bytes32 salt
    ) internal returns (address capRegistry) {
        capRegistry = address(
            new CapRegistry{ salt: _capSalt(salt) }(owner(), perUserCap, totalCap, vaultCap)
        );
    }

    function _predictCapRegistry(
        uint256 perUserCap,
        uint256 totalCap,
        uint256 vaultCap,
        bytes32 salt
    ) internal view returns (address) {
        return Create2.computeAddress(
            _capSalt(salt),
            keccak256(
                bytes.concat(
                    type(CapRegistry).creationCode,
                    abi.encode(owner(), perUserCap, totalCap, vaultCap)
                )
            )
        );
    }

    function _capSalt(bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(salt, "sparkpoint.cap"));
    }

    function _initData(FactoryStorage storage $, CreateVaultParams calldata p, address capRegistry)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(
            SparkPointUniversalVault.initialize,
            (ISparkPointUniversalVault.InitParams({
                    asset: IERC20(p.child.asset()),
                    child: p.child,
                    guardian: $.guardian,
                    factory: address(this),
                    capRegistry: capRegistry,
                    feeRecipient: $.feeRecipient,
                    performanceFeeBps: p.feeBps,
                    name: p.name,
                    symbol: p.symbol,
                    label: p.label
                }))
        );
    }
}
