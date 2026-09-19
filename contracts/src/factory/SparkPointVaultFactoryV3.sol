// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { BeaconProxy } from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { CapRegistry } from "../governance/CapRegistry.sol";
import { SparkPointUniversalVault } from "../vault/SparkPointUniversalVault.sol";
import { ISparkPointUniversalVault } from "../interfaces/ISparkPointUniversalVault.sol";
import { ISparkPointVaultFactoryV3 } from "../interfaces/ISparkPointVaultFactoryV3.sol";

/// @title SparkPointVaultFactoryV3 — admission-gateway factory for universal wrapper proxies (049)
/// @notice Deploys one `BeaconProxy` (bound to the timelock-owned beacon) + one `CapRegistry` per
///         admitted vault, atomically initialized. Holds NO funds, has NO deposit/withdraw/sweep/
///         rescue/migrate selector, and retains NO authority over deployed wrappers.
///
/// @dev AUTHORITY (constitution v4.1.0, amendment v4.1.0):
///        DEFAULT_ADMIN_ROLE  the TimelockController (3-of-5 proposer, independent canceller,
///                            ≥72h). Grants/revokes roles and sets the non-admission params
///                            (beacon, guardian, fee recipient, deploy limit). It CANNOT whitelist
///                            or deploy — the timelock was deliberately removed from admission.
///        ADMIN_ROLE          the operator EOA. Admits instantly (`readyAt = 0`), releases an AI
///                            entry early, cancels a pending entry, bounds the cooldown, and
///                            deploys. It cannot upgrade code or move funds.
///        DEPLOYER_ROLE       the scoped AI runner key. Admits a child that unlocks after the
///                            on-chain cooldown and deploys it. **No other power** — no
///                            unwhitelist, no release, no cooldown config, no upgrade, no funds.
///
///      ADMISSION (v4.1.0): an admission is one pending `WhitelistEntry{by, readyAt}` per child.
///      `readyAt == 0` means deployable immediately (admin admissions); AI admissions set
///      `readyAt = now + cooldown` with a plain inline `block.timestamp` check — there is NO
///      TimelockController in the admission path. `createVault` consumes the entry and records
///      `wrapperOf[child]`; a second wrapper for a child is impossible on-chain. The rule that the
///      AI never deploys admin-added entries is enforced OFF-CHAIN in the runner (provenance check)
///      — the chain permits admin/deployer either way.
///
///      UPGRADEABILITY: this factory is FUNDLESS (it custodies nothing) — the constitution permits
///      upgradeability for fundless infra. It sits behind a **Transparent proxy** whose ProxyAdmin
///      is owned by the timelock; the implementation itself carries NO upgrade function and NO
///      payable function, so it can never hold value and there is no in-implementation upgrade
///      surface to abuse. Upgrading the factory can never touch an existing wrapper.
///
///      STORAGE: ERC-7201 namespaced (slot derived from "sparkpoint.storage.SparkPointVaultFactoryV3").
contract SparkPointVaultFactoryV3 is
    Initializable,
    AccessControlUpgradeable,
    ISparkPointVaultFactoryV3
{
    /// @notice Instant-admission role: whitelist/release/unwhitelist/setCooldown/createVault.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @notice Scoped AI-admission role: cooldown-gated whitelist + createVault. Nothing else.
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    /// @inheritdoc ISparkPointVaultFactoryV3
    uint64 public constant override MIN_COOLDOWN = 1 hours;
    /// @inheritdoc ISparkPointVaultFactoryV3
    uint64 public constant override DEFAULT_COOLDOWN = 24 hours;
    /// @inheritdoc ISparkPointVaultFactoryV3
    uint64 public constant override MAX_COOLDOWN = 7 days;

    uint16 internal constant _MAX_PERFORMANCE_FEE_BPS = 2000; // 20% — mirrors the wrapper cap
    uint256 internal constant _DEPLOY_WINDOW = 1 days;
    uint256 internal constant _MAX_DECIMALS = 36;

    /// @custom:storage-location erc7201:sparkpoint.storage.SparkPointVaultFactoryV3
    struct FactoryStorage {
        address timelock; // DEFAULT_ADMIN_ROLE holder + governance of every CapRegistry
        address beacon;
        address guardian;
        address feeRecipient;
        uint32 deployLimit; // 0 = unlimited; else max deploys per rolling 1-day window
        uint32 deploysInWindow;
        uint64 windowStart;
        uint64 cooldown; // AI cooling-off window; bounded [MIN_COOLDOWN, MAX_COOLDOWN]
        mapping(address => ISparkPointVaultFactoryV3.WhitelistEntry) whitelist;
        mapping(address => address) wrapperOf;
    }

    // keccak256(abi.encode(uint256(keccak256("sparkpoint.storage.SparkPointVaultFactoryV3")) - 1))
    //   & ~bytes32(uint256(0xff))
    bytes32 private constant _STORAGE_LOCATION =
        0x087f00b87689a3454a928391765efb0077b517cc3d981b4dc267fea6a5624500;

    function _store() private pure returns (FactoryStorage storage $) {
        assembly {
            $.slot := _STORAGE_LOCATION
        }
    }

    error ZeroAddress();
    error DuplicateRoleHolder();
    error NotWhitelisted(address child);
    error AlreadyWhitelisted(address child);
    error WrapperAlreadyDeployed(address child);
    error CooldownOutOfBounds(uint64 newCooldown);
    error CooldownNotElapsed(address child, uint64 readyAt);
    error FeeExceedsCap();
    error InvalidChild();
    error DeployLimitReached();
    error SaltRequired();

    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer (the factory runs behind a Transparent proxy).
    /// @dev Roles are granted ATOMICALLY here — this is the one moment the deploy tx is the
    ///      authority; every later role change is a timelocked DEFAULT_ADMIN_ROLE action.
    /// @param defaultAdmin_ the TimelockController (role admin + non-admission params).
    /// @param admin_ the operator EOA (instant admission lane).
    /// @param deployer_ the AI deploy runner (cooldown-gated admission lane).
    /// @param beacon_ the UpgradeableBeacon owned by the same timelock.
    /// @param guardian_ the wrapper guardian (normally the same timelock).
    /// @param feeRecipient_ the non-privileged treasury receiving fee shares.
    function initialize(
        address defaultAdmin_,
        address admin_,
        address deployer_,
        address beacon_,
        address guardian_,
        address feeRecipient_
    ) external initializer {
        if (
            defaultAdmin_ == address(0) || admin_ == address(0) || deployer_ == address(0)
                || beacon_ == address(0) || guardian_ == address(0) || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }
        // The three powers are deliberately separate holders; a deploy typo must revert loudly.
        if (defaultAdmin_ == admin_ || defaultAdmin_ == deployer_ || admin_ == deployer_) {
            revert DuplicateRoleHolder();
        }
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
        _grantRole(ADMIN_ROLE, admin_);
        _grantRole(DEPLOYER_ROLE, deployer_);
        FactoryStorage storage $ = _store();
        $.timelock = defaultAdmin_;
        $.beacon = beacon_;
        $.guardian = guardian_;
        $.feeRecipient = feeRecipient_;
        $.cooldown = DEFAULT_COOLDOWN;
        $.windowStart = uint64(block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admission (v4.1.0) — no timelock in this path; cooldown is an inline timestamp check
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactoryV3
    function whitelistVault(address child) external {
        if (child == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        if ($.wrapperOf[child] != address(0)) revert WrapperAlreadyDeployed(child);
        if ($.whitelist[child].by != address(0)) revert AlreadyWhitelisted(child);

        bool admin = hasRole(ADMIN_ROLE, msg.sender);
        if (!admin && !hasRole(DEPLOYER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ADMIN_ROLE);
        }
        // An admin admission is deployable immediately; an AI admission waits out the cooldown.
        uint64 readyAt = admin ? 0 : uint64(block.timestamp) + $.cooldown;
        $.whitelist[child] = WhitelistEntry({ by: msg.sender, readyAt: readyAt });
        emit VaultWhitelisted(child, msg.sender, readyAt);
    }

    /// @inheritdoc ISparkPointVaultFactoryV3
    function releaseNow(address child) external onlyRole(ADMIN_ROLE) {
        FactoryStorage storage $ = _store();
        if ($.whitelist[child].by == address(0)) revert NotWhitelisted(child);
        $.whitelist[child].readyAt = 0;
        emit VaultReleased(child, msg.sender);
    }

    /// @inheritdoc ISparkPointVaultFactoryV3
    function unwhitelist(address child) external onlyRole(ADMIN_ROLE) {
        FactoryStorage storage $ = _store();
        if ($.whitelist[child].by == address(0)) revert NotWhitelisted(child);
        delete $.whitelist[child];
        emit VaultUnwhitelisted(child, msg.sender);
    }

    /// @inheritdoc ISparkPointVaultFactoryV3
    function setCooldown(uint64 newCooldown) external onlyRole(ADMIN_ROLE) {
        if (newCooldown < MIN_COOLDOWN || newCooldown > MAX_COOLDOWN) {
            revert CooldownOutOfBounds(newCooldown);
        }
        FactoryStorage storage $ = _store();
        uint64 oldCooldown = $.cooldown;
        $.cooldown = newCooldown;
        emit CooldownUpdated(oldCooldown, newCooldown, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deploy — ADMIN_ROLE | DEPLOYER_ROLE; admission + one-per-child enforced on-chain
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactoryV3
    function createVault(CreateVaultParams calldata p) external returns (address proxy) {
        FactoryStorage storage $ = _store();
        _checkAdmissionRole();

        if (p.salt == bytes32(0)) revert SaltRequired();
        address child = address(p.child);
        if ($.wrapperOf[child] != address(0)) revert WrapperAlreadyDeployed(child);
        WhitelistEntry memory entry = $.whitelist[child];
        if (entry.by == address(0)) revert NotWhitelisted(child);
        if (entry.readyAt != 0 && block.timestamp < entry.readyAt) {
            revert CooldownNotElapsed(child, entry.readyAt);
        }
        if (p.feeBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();
        _chargeDeploy($);
        _validateChild(p.child);

        // Consume the admission BEFORE the external deploy calls; `wrapperOf` records the result
        // so no child can ever receive a second wrapper, whatever the caller does afterwards.
        delete $.whitelist[child];
        address capRegistry =
            _deployCapRegistry($.timelock, p.perUserCap, p.totalCap, p.vaultCap, p.salt);
        bytes memory initData = _initData($, p, capRegistry);
        proxy = address(new BeaconProxy{ salt: p.salt }($.beacon, initData));
        $.wrapperOf[child] = proxy;
        emit VaultCreated(child, proxy, capRegistry, msg.sender, p.feeBps, p.label);
    }

    /// @inheritdoc ISparkPointVaultFactoryV3
    function predictVaultAddress(CreateVaultParams calldata p)
        external
        view
        returns (address proxy)
    {
        FactoryStorage storage $ = _store();
        address capRegistry =
            _predictCapRegistry($.timelock, p.perUserCap, p.totalCap, p.vaultCap, p.salt);
        bytes memory initData = _initData($, p, capRegistry);
        return Create2.computeAddress(
            p.salt,
            // bytes.concat, not abi.encodePacked: same bytes (the exact init code the CREATE2
            // deploy produces), without the hash-collision heuristic a packed encoding invites.
            keccak256(bytes.concat(type(BeaconProxy).creationCode, abi.encode($.beacon, initData)))
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Non-admission config (DEFAULT_ADMIN_ROLE, the timelock) — never a fund path
    // ─────────────────────────────────────────────────────────────────────────

    function setBeacon(address newBeacon) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBeacon == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit BeaconUpdated($.beacon, newBeacon);
        $.beacon = newBeacon;
    }

    function setGuardian(address newGuardian) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newGuardian == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit GuardianUpdated($.guardian, newGuardian);
        $.guardian = newGuardian;
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        FactoryStorage storage $ = _store();
        emit FeeRecipientUpdated($.feeRecipient, newRecipient);
        $.feeRecipient = newRecipient;
    }

    function setDeployLimit(uint32 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    /// @notice The timelock recorded at initialization (DEFAULT_ADMIN_ROLE holder and the
    ///         governance of every CapRegistry this factory deploys).
    function timelock() external view returns (address) {
        return _store().timelock;
    }

    function deployLimit() external view returns (uint32) {
        return _store().deployLimit;
    }

    function cooldown() external view returns (uint64) {
        return _store().cooldown;
    }

    function whitelistOf(address child) external view returns (address by, uint64 readyAt) {
        WhitelistEntry memory entry = _store().whitelist[child];
        return (entry.by, entry.readyAt);
    }

    function isWhitelisted(address child) external view returns (bool) {
        return _store().whitelist[child].by != address(0);
    }

    function isReady(address child) external view returns (bool) {
        WhitelistEntry memory entry = _store().whitelist[child];
        return entry.by != address(0) && (entry.readyAt == 0 || block.timestamp >= entry.readyAt);
    }

    function wrapperOf(address child) external view returns (address) {
        return _store().wrapperOf[child];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev createVault is open to exactly the two admission roles; the timelock is deliberately
    ///      NOT one of them.
    function _checkAdmissionRole() internal view {
        if (hasRole(ADMIN_ROLE, msg.sender) || hasRole(DEPLOYER_ROLE, msg.sender)) return;
        revert AccessControlUnauthorizedAccount(msg.sender, ADMIN_ROLE);
    }

    /// @dev Rolling-window deploy limit for the admission roles (0 = unlimited). Makes a
    ///      compromised admission key loud instead of silent: it can spam at most `deployLimit`
    ///      wrappers per day.
    function _chargeDeploy(FactoryStorage storage $) internal {
        if ($.deployLimit == 0) return;
        if (block.timestamp >= uint256($.windowStart) + _DEPLOY_WINDOW) {
            $.windowStart = uint64(block.timestamp);
            $.deploysInWindow = 0;
        }
        if (++$.deploysInWindow > $.deployLimit) revert DeployLimitReached();
    }

    /// @dev On-chain admission checks for an arbitrary ERC-4626 child (FR-049-007). The whitelist
    ///      is the first gate; this is the last. Sync-only, non-reverting views required.
    function _validateChild(IERC4626 child) internal view {
        if (address(child).code.length == 0) revert InvalidChild();
        if (child.asset() == address(0)) revert InvalidChild();
        if (child.decimals() > _MAX_DECIMALS) revert InvalidChild();
        // A reverting conversion is a hard reject; so is a child that claims 1e18 shares are worth
        // exactly 0 assets (broken or hostile pricing) — the probe is read AND checked.
        try child.convertToAssets(1e18) returns (uint256 probe) {
            if (probe == 0) revert InvalidChild();
        } catch {
            revert InvalidChild();
        }
    }

    /// @dev The CapRegistry governance is the recorded timelock (the DEFAULT_ADMIN_ROLE holder at
    ///      initialization), so cap changes on a deployed wrapper stay behind the 72h timelock,
    ///      never an EOA.
    function _deployCapRegistry(
        address timelock_,
        uint256 perUserCap,
        uint256 totalCap,
        uint256 vaultCap,
        bytes32 salt
    ) internal returns (address capRegistry) {
        capRegistry = address(
            new CapRegistry{ salt: _capSalt(salt) }(timelock_, perUserCap, totalCap, vaultCap)
        );
    }

    function _predictCapRegistry(
        address timelock_,
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
                    abi.encode(timelock_, perUserCap, totalCap, vaultCap)
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
