// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title KillSwitch (Guardian)
/// @notice PAUSE-ONLY kill switch (smart-contracts.md §6, N5). The guardian multisig can pause/unpause
///         the DEPOSIT side only. It holds NO assets, has NO fund path, and can NEVER block a
///         withdraw/redeem (N2) — its entire authority is a single boolean.
/// @dev COMPILE-ONLY STUB SCOPE (W5-US1): the vault's own `pauseDeposits`/`unpauseDeposits`/`paused`
///      surface is self-contained per ISparkPointVault; this standalone controller exists for the
///      inventory (§1 "KillSwitch/Guardian pause controller") and is deliberately custody-free.
contract KillSwitch {
    address public immutable guardian;
    bool public paused;

    event Paused(address indexed guardian);
    event Unpaused(address indexed guardian);

    error NotGuardian();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_) {
        guardian = guardian_;
    }

    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGuardian {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
