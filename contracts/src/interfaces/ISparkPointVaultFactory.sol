// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SparkPointVaultFactory
/// @notice Admin-gated CREATE2 deployer of branded SparkPointMorphoVault instances from a curated,
///         on-chain Morpho allowlist. Holds NO funds (no receive, no token custody, no fund path).
///         createVault reverts unless morphoVault is allowlisted ("interaction with any other protocol
///         impossible by construction" preserved at the factory boundary, per the ratified amendment).
interface ISparkPointVaultFactory {
    // Absolute base-unit caps (clamped to CapRegistry's hard ceilings). NOTE: 0 == NO capacity
    // (fully capped — blocks deposits), NOT unlimited; pass a large value for "effectively unlimited".
    // totalCap governs BOTH the aggregate and per-vault CapRegistry ceilings.
    struct Caps { uint256 perAddressCap; uint256 totalCap; }

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
    /// @dev DOCUMENTED, JUSTIFIED DEVIATION from §2's `predictVaultAddress(morphoVault, label)`: the
    ///      deployed wrapper is FULL-bytecode CREATE2, so its address is a pure function of its ENTIRE
    ///      init code — creation bytecode + EVERY constructor arg, which includes the per-wrapper
    ///      capRegistry, feeBps and the derived name/symbol/label. feeBps and caps vary the init code
    ///      (and caps vary the per-wrapper CapRegistry's own CREATE2 address, which is itself a wrapper
    ///      constructor arg), so a (morphoVault, label)-only signature CANNOT reproduce the exact address
    ///      createVault lands at. To keep predict() and createVault() provably identical (the T013/T018
    ///      "lands at predictVaultAddress" obligation), predict takes the SAME inputs as createVault and
    ///      recomputes the identical init code from them. The salt is still keccak256(morphoVault, label,
    ///      chainId) exactly as §2 specifies.
    function predictVaultAddress(
        address morphoVault,
        uint16  feeBps,
        Caps calldata caps,
        string calldata label
    ) external view returns (address);

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
