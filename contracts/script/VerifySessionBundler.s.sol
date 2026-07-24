// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import { AccountFactory } from "../src/account/AccountFactory.sol";
import { SparkPointAccount } from "../src/account/SparkPointAccount.sol";
import { IPolicyModule } from "../src/interfaces/IPolicyModule.sol";

interface IERC20Like {
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title VerifySessionBundler — set up a real session account + emit a signed mode-0x01 UserOp so the
///        Alchemy Base-Sepolia bundler can render the definitive ERC-7562 verdict (SC-U6-A).
/// @notice Broadcasts the owner setup (create account, fund it with USDC + approve the vault, authorize
///         one session key, prefund the EntryPoint gas deposit), then builds + session-signs an
///         `execute(vault, 0, deposit(1 USDC, account))` UserOp and writes it (unpacked v0.7) to
///         `deployments/<chain>/session-userop.json` for submission via `eth_sendUserOperation`.
contract VerifySessionBundler is Script {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant FACTORY = 0x251C9Cb0A30fCA6FEF2916Ca2C5679411DCedbdb;
    address internal constant VAULT = 0x15D269B1D4fb3581E5a47482A70215e63Ed547f2;
    address internal constant USDC = 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f;
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65;
    bytes1 internal constant MODE_SESSION = 0x01;
    uint256 internal constant SALT = 0x022;

    // UserOp gas envelope (generous; Base Sepolia base fee ~0.01 gwei).
    uint128 internal constant VGL = 150_000; // verificationGasLimit (actual ~70k; keeps efficiency ≥0.25)
    uint128 internal constant CGL = 400_000; // callGasLimit
    uint256 internal constant PVG = 200_000; // preVerificationGas
    uint128 internal constant MPFG = 1_000_000; // maxPriorityFeePerGas (0.001 gwei)
    uint128 internal constant MFG = 50_000_000; // maxFeePerGas (0.05 gwei)

    function run() external {
        uint256 sessionPk = uint256(keccak256("us6-022-bundler-verify-session"));
        address account = _setup(msg.sender, vm.addr(sessionPk));
        PackedUserOperation memory op = _buildOp(account);
        op.signature = _sign(op, sessionPk);
        console2.log("account   ", account);
        console2.log("sessionKey", vm.addr(sessionPk));
        _writeJson(op);
    }

    function _setup(address owner, address sessionKey) internal returns (address account) {
        vm.startBroadcast();
        account = AccountFactory(FACTORY).createAccount(owner, SALT);
        IERC20Like(USDC).transfer(account, 5_000_000); // 5 USDC
        SparkPointAccount(payable(account)).execute(
            USDC, 0, abi.encodeCall(IERC20Like.approve, (VAULT, type(uint256).max))
        );
        _authorize(account, sessionKey);
        IEntryPoint(ENTRYPOINT).depositTo{ value: 0.003 ether }(account);
        vm.stopBroadcast();
    }

    function _authorize(address account, address sessionKey) internal {
        IPolicyModule.Policy memory p = IPolicyModule.Policy({
            sessionKey: sessionKey,
            validAfter: 0,
            validUntil: uint48(block.timestamp + 1 days),
            perTxCap: 500_000_000,
            cumulativeCap: 5_000_000_000,
            spent: 0,
            maxSlippageBps: 50,
            revoked: false
        });
        address[] memory targets = new address[](1);
        bytes4[] memory selectors = new bytes4[](1);
        targets[0] = VAULT;
        selectors[0] = SEL_VAULT_DEPOSIT;
        SparkPointAccount(payable(account)).authorizeSessionKey(p, targets, selectors);
    }

    function _buildOp(address account) internal view returns (PackedUserOperation memory op) {
        bytes memory inner = abi.encodeWithSelector(SEL_VAULT_DEPOSIT, uint256(1_000_000), account);
        op.sender = account;
        op.nonce = IEntryPoint(ENTRYPOINT).getNonce(account, 0);
        op.callData = abi.encodeCall(SparkPointAccount.execute, (VAULT, 0, inner));
        op.accountGasLimits = bytes32((uint256(VGL) << 128) | uint256(CGL));
        op.preVerificationGas = PVG;
        op.gasFees = bytes32((uint256(MPFG) << 128) | uint256(MFG));
    }

    function _sign(PackedUserOperation memory op, uint256 pk) internal view returns (bytes memory) {
        bytes32 h = IEntryPoint(ENTRYPOINT).getUserOpHash(op);
        console2.log("userOpHash", vm.toString(h));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(h));
        return abi.encodePacked(MODE_SESSION, r, s, v);
    }

    function _writeJson(PackedUserOperation memory op) internal {
        string memory obj = "userop";
        vm.serializeAddress(obj, "sender", op.sender);
        vm.serializeUint(obj, "nonce", op.nonce);
        vm.serializeBytes(obj, "callData", op.callData);
        vm.serializeUint(obj, "callGasLimit", uint256(CGL));
        vm.serializeUint(obj, "verificationGasLimit", uint256(VGL));
        vm.serializeUint(obj, "preVerificationGas", PVG);
        vm.serializeUint(obj, "maxFeePerGas", uint256(MFG));
        vm.serializeUint(obj, "maxPriorityFeePerGas", uint256(MPFG));
        string memory json = vm.serializeBytes(obj, "signature", op.signature);
        vm.writeJson(
            json, string.concat("deployments/", vm.toString(block.chainid), "/session-userop.json")
        );
    }
}
