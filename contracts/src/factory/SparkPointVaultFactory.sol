// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import { ISparkPointVaultFactory } from "../interfaces/ISparkPointVaultFactory.sol";
import { SparkPointMorphoVault } from "../vault/SparkPointMorphoVault.sol";
import { CapRegistry } from "../governance/CapRegistry.sol";

/// @title SparkPointVaultFactory — admin-gated, deploy-only registrar of branded Morpho wrappers (011).
/// @notice CREATE2 deployer of `SparkPointMorphoVault` instances from an on-chain CURATED Morpho
///         allowlist. Holds NO funds and has NO fund path (N1): there is no receive/payable/fallback and
///         no deposit/withdraw/sweep/rescue/transfer selector — a value-bearing call reverts and the
///         factory balance is provably always 0.
/// @dev Non-custody BY CONSTRUCTION:
///        N1  the factory is not a custodian — it only reads state and deploys wrappers; the ONLY
///            place a Morpho address is vetted on-chain is the allowlist gate.
///        N2  removing a vault from the allowlist blocks FUTURE deploys ONLY; it can NEVER touch an
///            already-deployed wrapper (each wrapper's `morphoVault` is a constructor IMMUTABLE), so
///            existing users always keep their withdraw/redeem escape hatch.
///        N5  wrappers are deployed via FULL-BYTECODE CREATE2 (creation bytecode + all constructor
///            args), NOT a minimal-proxy clone — a clone delegatecalls an impl, violating N5. Every
///            wrapper is a fresh, immutable, non-upgradeable contract.
///
///      OWNERSHIP / TIMELOCK. `owner` is the OZ Ownable owner and SHOULD be the OZ TimelockController.
///      The timelock IS the mandated delay/veto window for allowlist adds (constitution v2.0.0), so
///      `onlyOwner` suffices — there is deliberately NO second in-contract timelock. The IV.5(c)
///      ineligibility rule (no SparkPoint-controlled role over the underlying Morpho vault) is enforced
///      OFF-CHAIN during that timelock/veto window; the factory's on-chain gate is the allowlist itself
///      (it does NOT read the Morpho vault's role set on-chain).
///
///      IMMUTABLES. `usdc`, `guardian` (every wrapper's guardian == the timelock) and `feeRecipient`
///      (the SparkPoint treasury) are fixed once at construction and shared by EVERY wrapper.
///
///      DELIBERATELY ABSENT (N1): no deposit / withdraw / sweep / transfer / rescue / receive / fallback.
contract SparkPointVaultFactory is ISparkPointVaultFactory, Ownable {
    /// @dev Hard cap on the wrapper performance-fee rate (mirrors the wrapper's own bytecode constant).
    uint16 internal constant _MAX_PERFORMANCE_FEE_BPS = 2000; // 20%

    /// @notice USDC asset every wrapper routes (immutable, shared by all wrappers).
    IERC20 public immutable usdc;
    /// @notice Guardian (== the timelock) set on every wrapper: pause + hard-capped fee-rate ONLY (N5).
    address public immutable guardian;
    /// @notice SparkPoint treasury that receives fee-SHARES on every wrapper (non-privileged holder).
    address public immutable feeRecipient;

    /// @dev On-chain curated allowlist. Only an allowlisted Morpho vault may back a NEW wrapper. Per
    ///      constitution IV.5(d) it is consulted ONLY at createVault time and is deliberately NOT wired
    ///      into the PolicyModule / SessionKeyValidator / any agent or session-key strategy-direction
    ///      path — so a curated Morpho address can never leak into the deterministic policy engine.
    ///      Embedded here (rather than a standalone registry) keeps it even more isolated from that path.
    mapping(address => bool) internal _morphoAllowlist;

    /// @notice Provenance attestation consumed by the 010 reader/admin panel.
    mapping(address => bool) public isSparkPointVault;

    /// @dev Idempotency guard keyed by the deterministic salt. Guarantees a second createVault with the
    ///      same (morphoVault, label) — hence the same salt — is rejected REGARDLESS of feeBps/caps
    ///      (which vary the init code and so would otherwise land at a different CREATE2 address).
    mapping(bytes32 => address) public vaultBySalt;

    /// @dev The registry of every wrapper this factory has deployed.
    address[] internal _vaults;

    error ZeroAddress();
    error NotAllowlisted(address morphoVault);
    error FeeExceedsCap(uint16 feeBps);
    error VaultAlreadyExists(bytes32 salt, address existing);
    error IndexOutOfBounds(uint256 index, uint256 length);

    /// @param owner_        the Ownable owner; SHOULD be the OZ TimelockController (the delay/veto window).
    /// @param usdc_         the USDC every wrapper routes.
    /// @param guardian_     the guardian set on every wrapper (== the timelock); pause + fee-rate only.
    /// @param feeRecipient_ the SparkPoint treasury that receives wrapper fee-shares.
    constructor(address owner_, IERC20 usdc_, address guardian_, address feeRecipient_) Ownable(owner_) {
        if (
            address(usdc_) == address(0) || guardian_ == address(0) || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        guardian = guardian_;
        feeRecipient = feeRecipient_;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Curated allowlist (onlyOwner / timelocked) — the ONLY on-chain vetting gate (N1)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactory
    function allowlistMorphoVault(address morphoVault, bool allowed) external override onlyOwner {
        if (morphoVault == address(0)) revert ZeroAddress();
        _morphoAllowlist[morphoVault] = allowed;
        emit MorphoVaultAllowlisted(morphoVault, allowed);
    }

    /// @inheritdoc ISparkPointVaultFactory
    function isAllowlisted(address morphoVault) public view override returns (bool) {
        return _morphoAllowlist[morphoVault];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deploy (onlyOwner) — FULL-BYTECODE CREATE2, allowlist- + fee-gated (N1/N5)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactory
    /// @dev NON-PAYABLE (no `payable`): a value-bearing createVault reverts (N1). Deploys a per-wrapper
    ///      CapRegistry and the wrapper, both via CREATE2 at the SAME salt (their init codes differ, so
    ///      they land at distinct addresses). The wrapper's init code embeds the CapRegistry's CREATE2
    ///      address, so `predictVaultAddress` can reproduce the exact address from the same inputs.
    function createVault(
        address morphoVault,
        uint16 feeBps,
        Caps calldata caps,
        string calldata label
    ) external override onlyOwner returns (address vault) {
        if (!isAllowlisted(morphoVault)) revert NotAllowlisted(morphoVault);
        if (feeBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap(feeBps);

        bytes32 salt = _salt(morphoVault, label);
        address existing = vaultBySalt[salt];
        if (existing != address(0)) revert VaultAlreadyExists(salt, existing);

        // 1) Per-wrapper CapRegistry via CREATE2 (owner == this factory's owner/timelock). Its address is
        //    deterministic (salt + init code), so it is reproducible by predictVaultAddress. Deployed
        //    from the SAME init-code helper predict uses, so the two can never disagree.
        address capRegistry = Create2.deploy(0, salt, _capInitCode(caps));

        // 2) The wrapper via FULL-BYTECODE CREATE2 (NOT a minimal-proxy clone — N5), from the SAME
        //    init-code helper predict uses.
        vault = Create2.deploy(0, salt, _wrapperInitCode(morphoVault, feeBps, capRegistry, label));

        vaultBySalt[salt] = vault;
        isSparkPointVault[vault] = true;
        _vaults.push(vault);

        emit VaultCreated(vault, morphoVault, feeBps, label);
    }

    /// @inheritdoc ISparkPointVaultFactory
    /// @dev Recomputes the IDENTICAL init code createVault uses, from the SAME inputs, so predict ==
    ///      the deployed address exactly (T013/T018). First reproduces the per-wrapper CapRegistry's
    ///      CREATE2 address (it is a wrapper constructor arg), then the wrapper's. This is a PURE address
    ///      PREVIEW: it does NOT enforce the allowlist / feeBps<=cap / CapRegistry-ceiling gates that
    ///      createVault applies, so it may return an address for inputs createVault would revert on.
    function predictVaultAddress(
        address morphoVault,
        uint16 feeBps,
        Caps calldata caps,
        string calldata label
    ) external view override returns (address) {
        bytes32 salt = _salt(morphoVault, label);
        address capRegistry =
            Create2.computeAddress(salt, keccak256(_capInitCode(caps)), address(this));
        return Create2.computeAddress(
            salt,
            keccak256(_wrapperInitCode(morphoVault, feeBps, capRegistry, label)),
            address(this)
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Registry reads (010)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISparkPointVaultFactory
    /// @dev Disambiguates the identical `owner()` declared by BOTH Ownable and the factory interface.
    function owner() public view override(Ownable, ISparkPointVaultFactory) returns (address) {
        return super.owner();
    }

    /// @inheritdoc ISparkPointVaultFactory
    function vaults() external view override returns (address[] memory) {
        return _vaults;
    }

    /// @inheritdoc ISparkPointVaultFactory
    function vaultsLength() external view override returns (uint256) {
        return _vaults.length;
    }

    /// @inheritdoc ISparkPointVaultFactory
    function vaultAt(uint256 index) external view override returns (address) {
        if (index >= _vaults.length) revert IndexOutOfBounds(index, _vaults.length);
        return _vaults[index];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deterministic-address internals — SHARED by createVault + predictVaultAddress
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev The per-wrapper salt: keccak256(morphoVault, label, chainId) exactly per the §2 spec.
    function _salt(address morphoVault, string memory label) internal view returns (bytes32) {
        return keccak256(abi.encode(morphoVault, label, block.chainid));
    }

    /// @dev FULL init code for the per-wrapper CapRegistry — the SINGLE source used by BOTH the
    ///      CREATE2 deploy and the address prediction, so they are provably identical.
    function _capInitCode(Caps calldata caps) internal view returns (bytes memory) {
        (uint256 perUser, uint256 total, uint256 vaultCap) = _capParams(caps);
        // bytes.concat, not abi.encodePacked: identical bytes (creation code is fixed-length, the
        // abi.encode tail is self-delimiting) so every predicted CREATE2 address is unchanged, and
        // aderyn's `abi.encodePacked() Hash Collision` heuristic is resolved.
        return bytes.concat(
            type(CapRegistry).creationCode, abi.encode(owner(), perUser, total, vaultCap)
        );
    }

    /// @dev FULL init code for the wrapper — creation bytecode + EVERY constructor arg (incl. the
    ///      per-wrapper CapRegistry address, feeBps and derived name/symbol/label). The SINGLE source
    ///      used by BOTH the CREATE2 deploy and the address prediction (full-bytecode, NOT a clone; N5).
    function _wrapperInitCode(
        address morphoVault,
        uint16 feeBps,
        address capRegistry,
        string memory label
    ) internal view returns (bytes memory) {
        (string memory name, string memory symbol) = _branding(label);
        // bytes.concat, not abi.encodePacked — identical bytes (fixed-length creation code +
        // self-delimiting abi.encode tail) so predicted CREATE2 addresses stay stable; resolves
        // aderyn's `abi.encodePacked() Hash Collision` heuristic.
        return bytes.concat(
            type(SparkPointMorphoVault).creationCode,
            abi.encode(
                usdc,
                IERC4626(morphoVault),
                guardian,
                address(this),
                capRegistry,
                feeRecipient,
                feeBps,
                name,
                symbol,
                label
            )
        );
    }

    /// @dev Map the 2-field Caps{perAddressCap,totalCap} onto the CapRegistry's 3 caps
    ///      (perUser, total, vault). The single totalCap governs BOTH the aggregate and vault ceilings.
    ///      Deterministic ⇒ predict and createVault derive the identical CapRegistry init code.
    function _capParams(Caps calldata caps)
        internal
        pure
        returns (uint256 perUser, uint256 total, uint256 vaultCap)
    {
        return (caps.perAddressCap, caps.totalCap, caps.totalCap);
    }

    /// @dev Deterministic ERC-20 branding derived purely from `label`, so predict reproduces the exact
    ///      name/symbol constructor args the wrapper is deployed with (they are part of the init code).
    function _branding(string memory label)
        internal
        pure
        returns (string memory name, string memory symbol)
    {
        return (string.concat("SparkPoint Morpho Vault: ", label), "spMORPHO");
    }
}
