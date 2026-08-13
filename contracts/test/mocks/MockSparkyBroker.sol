// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A faithful stand-in for the deployed `SparkyBroker`, for testing the activation registry.
/// @dev Deliberately reproduces the two behaviours the registry's correctness depends on, so a test
///      cannot pass against a mock that is kinder than the real contract:
///
///        1. `activate` is callable ONLY by `activator` (unset = fail-closed), and reverts on a
///           token that is already activated.
///        2. **A real transfer clears the activation.** This is the product rule, enforced in the
///           real contract's `_afterTokenTransfer`; mints do not clear (there is nothing to clear).
///
///      The real collection is solady ERC-721 in its own repo and is NOT enumerable — that absence
///      is why the registry keeps a candidate list at all, so this mock does not add enumeration
///      either. It stores `activatedAt` as a BLOCK NUMBER (uint64), as the real one does.
contract MockSparkyBroker {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => uint64) public activatedAt;

    address public activator;
    uint256 public totalMinted;

    error NotActivator();
    error AlreadyActivated();
    error NotMinted();

    function setActivator(address newActivator) external {
        activator = newActivator;
    }

    function mint(address to) external returns (uint256 id) {
        id = ++totalMinted;
        _owners[id] = to;
        // NOTE: no activation on mint, ever — a fresh broker is unactivated.
    }

    function ownerOf(uint256 id) external view returns (address) {
        address owner = _owners[id];
        if (owner == address(0)) revert NotMinted();
        return owner;
    }

    function isActivated(uint256 id) external view returns (bool) {
        return activatedAt[id] != 0;
    }

    function activate(uint256 id) external {
        if (msg.sender != activator) revert NotActivator();
        if (activatedAt[id] != 0) revert AlreadyActivated();
        activatedAt[id] = uint64(block.number);
    }

    /// @notice A real, owner-signed transfer — which CLEARS the activation.
    function transferFrom(address from, address to, uint256 id) external {
        require(_owners[id] == from, "not owner");
        _owners[id] = to;
        // The rule that makes the product. A sale hands over the token, not the membership.
        if (activatedAt[id] != 0) activatedAt[id] = 0;
    }
}
