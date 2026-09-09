// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ICapRegistry } from "../interfaces/ICapRegistry.sol";

/// @title CapRegistry
/// @notice Bounded parameter store for the three inflow caps the vault reads (smart-contracts.md §6,
///         G2). Caps are governance-settable ONLY within immutable ceilings; a compromised multisig
///         can never open caps to infinity. Holds NO assets and exposes NO transfer selector.
/// @dev Cap defaults + ceilings mirror packages/shared/src/policy/constants.ts (T098 parity):
///      perUser 5_000e6 (ceiling 10_000e6); total 1_000_000e6 (ceiling 5_000_000e6);
///      vault 1_000_000e6 (ceiling 5_000_000e6). Caps NEVER gate withdraw/redeem (N2).
///
///      NOTE (W5-US1 STUB SCOPE): this is a minimal, non-custody param store used by the gating
///      test-suite to configure the vault. The custody-critical logic under test lives in
///      SparkPointVault; nothing here can move funds.
contract CapRegistry is ICapRegistry {
    uint256 public constant PER_USER_CEILING = 10_000e6;
    uint256 public constant TOTAL_CEILING = 5_000_000e6;
    uint256 public constant VAULT_CEILING = 5_000_000e6;

    address public immutable governance;

    uint256 public perUserCap;
    uint256 public totalCap;
    uint256 public vaultCap;

    event PerUserCapUpdated(uint256 oldCap, uint256 newCap);
    event TotalCapUpdated(uint256 oldCap, uint256 newCap);
    event VaultCapUpdated(uint256 oldCap, uint256 newCap);

    error NotGovernance();
    error CapAboveCeiling();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(address governance_, uint256 perUserCap_, uint256 totalCap_, uint256 vaultCap_) {
        if (
            perUserCap_ > PER_USER_CEILING || totalCap_ > TOTAL_CEILING || vaultCap_ > VAULT_CEILING
        ) {
            revert CapAboveCeiling();
        }
        governance = governance_;
        perUserCap = perUserCap_;
        totalCap = totalCap_;
        vaultCap = vaultCap_;
    }

    function setPerUserCap(uint256 newCap) external onlyGovernance {
        if (newCap > PER_USER_CEILING) revert CapAboveCeiling();
        emit PerUserCapUpdated(perUserCap, newCap);
        perUserCap = newCap;
    }

    function setTotalCap(uint256 newCap) external onlyGovernance {
        if (newCap > TOTAL_CEILING) revert CapAboveCeiling();
        emit TotalCapUpdated(totalCap, newCap);
        totalCap = newCap;
    }

    function setVaultCap(uint256 newCap) external onlyGovernance {
        if (newCap > VAULT_CEILING) revert CapAboveCeiling();
        emit VaultCapUpdated(vaultCap, newCap);
        vaultCap = newCap;
    }
}
