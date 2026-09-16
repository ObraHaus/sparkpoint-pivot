// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RoyaltySink
/// @notice The address `royaltyInfo` returns. Its entire job is to accept a payment and do nothing.
///
/// @dev This contract exists because of a gas budget. A marketplace forwarding a royalty typically
/// does so with a 2,300-gas stipend, which pays for a `receive` and essentially nothing else.
///
/// Point `royaltyInfo` at the engine instead and the failure is not a lost royalty — it is a
/// **failed sale**, because the engine's `receive()` records revenue and cannot complete inside the
/// stipend. So royalties land here, where `receive()` is empty, and a separate permissionless
/// `flush()` moves the balance on to the splitter to meet the same 90/10 as trading revenue.
contract RoyaltySink {
    address public immutable splitter;

    error ZeroAddress();
    error NothingToFlush();
    error FlushFailed();
    error BadDestination();

    event Flushed(uint256 amount);

    constructor(address splitter_) {
        if (splitter_ == address(0)) revert ZeroAddress();
        splitter = splitter_;
    }

    /// @dev Deliberately empty — adding anything here, including an event, risks the 2,300-gas
    /// budget and therefore the sale.
    receive() external payable { }

    /// @notice Push accumulated royalties into the 90/10 split. **Anyone may call.**
    function flush() external {
        uint256 balance = address(this).balance;
        // A nothing-to-do guard, not balance-dependent logic — dust forces it false and buys the
        // sender exactly what an ordinary call would have given them.
        if (balance < 1) revert NothingToFlush();

        // Read through the immutable at the call site, not through a local: a local makes the
        // destination look caller-influenced to static analysis. The immutable can only ever pay
        // one hard-coded address.
        if (splitter == address(0) || splitter == address(this)) revert BadDestination();

        (bool ok,) = splitter.call{ value: balance }("");
        if (!ok) revert FlushFailed();

        emit Flushed(balance);
    }
}
