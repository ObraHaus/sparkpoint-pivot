// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ISparkyBrokerViews — the read surface of `SparkyBroker` that this app uses.
///
/// @notice The collection itself lives in a SEPARATE repo (`ObraHaus/sparkpoint-sparky-broker`) and
///         is already deployed, so its ABI cannot be exported from this project's build. This
///         interface exists so it does not have to be hand-written either: it compiles here, its ABI
///         is emitted by `script/export-abis.sh` like every other, and the "ABIs are up to date" CI
///         gate covers it. A guessed ABI is exactly the drift that gate exists to prevent.
///
///         Reads only. Nothing in this repo may mint, activate or move a broker except through
///         `BrokerSale` and `BrokerActivationRegistry`, which hold the two roles.
interface ISparkyBrokerViews {
    /// @notice Who holds this broker. Reverts for an id that was never minted.
    function ownerOf(uint256 id) external view returns (address);

    /// @notice The BLOCK the activation happened in; `0` when never activated or cleared by a
    ///         transfer.
    /// @dev ⚠️ A block NUMBER, not a timestamp — and on Robinhood Chain it is **not addressable as
    ///      an RPC block height** (`block.number` and `eth_blockNumber` are different sequences
    ///      there, measured ~89M apart). Never resolve it to a date on that chain: `getBlock` will
    ///      succeed and return an unrelated block. Show no date rather than a wrong one.
    function activatedAt(uint256 id) external view returns (uint64);

    /// @notice Convenience form of `activatedAt(id) != 0`.
    function isActivated(uint256 id) external view returns (bool);

    /// @notice Batched `activatedAt` for a gallery, so N brokers cost one call rather than N.
    function activationsOf(uint256[] calldata ids) external view returns (uint64[] memory);

    /// @notice How many have been minted so far.
    function totalMinted() external view returns (uint256);

    /// @notice The collection's immutable supply cap (10,000).
    function MAX_SUPPLY() external view returns (uint256);

    /// @notice How many brokers this address holds. Note the collection is NOT enumerable — this
    ///         returns a count, and there is no way to list the ids from the contract.
    function balanceOf(address owner) external view returns (uint256);

    /// @notice The metadata URI. Served by the collection's own deploy, never from `apps/web`.
    function tokenURI(uint256 id) external view returns (string memory);
}
