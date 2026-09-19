// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafeSetup {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address paymentReceiver
    ) external;
}

/// @title DeployWrapperSafes
/// @notice Step 0 of the feature-049 deploy: create the TWO Safe multisigs whose addresses become
///         the TimelockController's PROPOSER and CANCELLER. Robinhood Chain (4663) only.
///
/// Safe v1.4.1's canonical singleton, proxy factory and CompatibilityFallbackHandler are already
/// deployed on 4663 (verified on-chain), so this only calls the factory — the deploying EOA is NOT
/// an owner of either Safe and gains no power from deploying them.
///
/// Defaults encode the operator-approved shape:
///   * proposer  = 3-of-5 over the five generated signer wallets;
///   * canceller = 2-of-3 over a DIFFERENT quorum (W3,W4,W5) — see the independence note in
///     `.claude/sparkpoint-wrapper-signers.txt`; the 72h timelock delay remains the primary guard.
///
/// Env (all optional — the defaults are the generated signer set):
///   PROPOSER_OWNERS   csv, default W1..W5
///   PROPOSER_THRESHOLD default 3
///   CANCELLER_OWNERS  csv, default W3,W4,W5
///   CANCELLER_THRESHOLD default 2
///   SAFE_SALT_PROPOSER / SAFE_SALT_CANCELLER  (defaults 4663001 / 4663002)
///
/// Usage (dry run first, then --broadcast):
///   forge script script/DeployWrapperSafes.s.sol \
///     --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
contract DeployWrapperSafes is Script {
    // Safe v1.4.1 canonical deployments (verified deployed on 4663).
    address internal constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    function run() external {
        if (block.chainid != 4663) {
            revert("DeployWrapperSafes: Robinhood Chain 4663 only");
        }

        address[] memory proposerOwners = vm.envAddress("PROPOSER_OWNERS", ",");
        address[] memory cancellerOwners = vm.envAddress("CANCELLER_OWNERS", ",");
        uint256 proposerThreshold = vm.envOr("PROPOSER_THRESHOLD", uint256(3));
        uint256 cancellerThreshold = vm.envOr("CANCELLER_THRESHOLD", uint256(2));
        uint256 proposerSalt = vm.envOr("SAFE_SALT_PROPOSER", uint256(4_663_001));
        uint256 cancellerSalt = vm.envOr("SAFE_SALT_CANCELLER", uint256(4_663_002));

        _validateOwners("PROPOSER", proposerOwners, proposerThreshold);
        _validateOwners("CANCELLER", cancellerOwners, cancellerThreshold);

        vm.startBroadcast();

        address proposerSafe = ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(
            SAFE_SINGLETON,
            abi.encodeCall(
                ISafeSetup.setup,
                (
                    proposerOwners,
                    proposerThreshold,
                    address(0),
                    "",
                    SAFE_FALLBACK_HANDLER,
                    address(0),
                    uint256(0),
                    address(0)
                )
            ),
            proposerSalt
        );

        address cancellerSafe = ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(
            SAFE_SINGLETON,
            abi.encodeCall(
                ISafeSetup.setup,
                (
                    cancellerOwners,
                    cancellerThreshold,
                    address(0),
                    "",
                    SAFE_FALLBACK_HANDLER,
                    address(0),
                    uint256(0),
                    address(0)
                )
            ),
            cancellerSalt
        );

        vm.stopBroadcast();

        console2.log("== Wrapper timelock Safes created (4663) ==");
        console2.log("proposer Safe (3-of-5) ", proposerSafe);
        console2.log("canceller Safe (2-of-3)", cancellerSafe);
        console2.log("owners (proposer):", proposerOwners.length, "threshold", proposerThreshold);
        console2.log("owners (canceller):", cancellerOwners.length, "threshold", cancellerThreshold);
        console2.log("");
        console2.log("NEXT: export the two addresses for the deploy script:");
        console2.log("  export TIMELOCK_PROPOSER=%s", proposerSafe);
        console2.log("  export TIMELOCK_CANCELLER=%s", cancellerSafe);
        console2.log("Then run DeployUniversalWrapper.s.sol (see the roadmap, P10).");
    }

    function _validateOwners(string memory label, address[] memory owners, uint256 threshold)
        internal
        pure
    {
        if (owners.length == 0) revert(string.concat(label, ": owners required"));
        if (threshold == 0 || threshold > owners.length) {
            revert(string.concat(label, ": threshold must be 1..owners"));
        }
        for (uint256 i = 0; i < owners.length; ++i) {
            if (owners[i] == address(0)) revert(string.concat(label, ": zero owner"));
            for (uint256 j = i + 1; j < owners.length; ++j) {
                if (owners[i] == owners[j]) revert(string.concat(label, ": duplicate owner"));
            }
        }
    }
}
