// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { SparkPointAccount } from "../../../src/account/SparkPointAccount.sol";
import { SessionKeyValidator } from "../../../src/account/SessionKeyValidator.sol";
import { PolicyModule } from "../../../src/account/PolicyModule.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";

interface IVaultLike {
    function asset() external view returns (address);
    function balanceOf(address) external view returns (uint256);
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @title SessionDepositFork — end-to-end session-key deposit through EntryPoint v0.7 into the DEPLOYED
///        Base-Sepolia vault, and proof the recipient pin blocks an external redeem (N1/N4).
/// @notice Env-guarded on SIM_FORK_RPC_URL (self-skips when unset, like the vault fork test). Exercises
///         the FULL 4337 handleOps path (the only test that does). RED against the stub: the external
///         redeem SUCCEEDS (no recipient pin) so the expected revert never fires.
contract SessionDepositForkTest is Test {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032; // v0.7 singleton
    address internal constant VAULT = 0x15D269B1D4fb3581E5a47482A70215e63Ed547f2; // Base Sepolia

    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_VAULT_REDEEM = 0xba087652; // redeem(uint256,address,address)
    bytes1 internal constant MODE_SESSION = 0x01;

    IEntryPoint internal entryPoint = IEntryPoint(ENTRYPOINT);
    PolicyModule internal policy;
    SessionKeyValidator internal validator;
    SparkPointAccount internal account;

    address internal owner;
    uint256 internal ownerPk;
    address internal sessionKey;
    uint256 internal sessionPk;
    address internal external_ = makeAddr("external"); // a non-account recipient (must be blocked)

    address internal usdc;
    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("SIM_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        require(ENTRYPOINT.code.length > 0, "EntryPoint v0.7 singleton missing on fork");
        forkReady = true;

        (owner, ownerPk) = makeAddrAndKey("owner");
        (sessionKey, sessionPk) = makeAddrAndKey("sessionKey");

        policy = new PolicyModule(address(this));
        validator = new SessionKeyValidator(address(policy));
        policy.setSessionValidator(address(validator));

        SparkPointAccount impl =
            new SparkPointAccount(entryPoint, address(validator), address(policy));
        account = SparkPointAccount(
            payable(address(
                    new ERC1967Proxy(
                        address(impl), abi.encodeCall(SparkPointAccount.initialize, (owner))
                    )
                ))
        );

        // Scope: the session key may ONLY deposit/redeem the deployed vault.
        policy.setAllowedTarget(VAULT, SEL_VAULT_DEPOSIT, true);
        policy.setAllowedTarget(VAULT, SEL_VAULT_REDEEM, true);

        usdc = IVaultLike(VAULT).asset();
        deal(usdc, address(account), 1000e6);

        // Owner (not the session key — approve is forbidden for session keys) pre-approves the vault.
        vm.prank(owner);
        account.execute(usdc, 0, abi.encodeCall(IERC20Like.approve, (VAULT, type(uint256).max)));

        // Authorize the agent's session key.
        IPolicyModule.Policy memory p;
        p.sessionKey = sessionKey;
        p.validAfter = uint48(block.timestamp);
        p.validUntil = uint48(block.timestamp + 7 days);
        p.perTxCap = 500e6;
        p.cumulativeCap = 5000e6;
        p.maxSlippageBps = 50;
        vm.prank(owner);
        account.authorizeSessionKey(p);

        // Prefund the account's EntryPoint gas deposit.
        vm.deal(address(this), 5 ether);
        entryPoint.depositTo{ value: 2 ether }(address(account));
    }

    function test_fork_sessionKeyDepositsIntoVault_andExternalRedeemBlocked() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        // 1) A session-key UserOp deposits into the vault; the account receives shares.
        bytes memory depositInner =
            abi.encodeWithSelector(SEL_VAULT_DEPOSIT, uint256(200e6), address(account));
        PackedUserOperation memory depositOp = _sessionOp(_execCd(VAULT, 0, depositInner));

        uint256 usdcBefore = IERC20Like(usdc).balanceOf(address(account));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = depositOp;
        entryPoint.handleOps(ops, payable(address(this)));

        assertGt(IVaultLike(VAULT).balanceOf(address(account)), 0, "account must hold vault shares");
        assertLt(
            IERC20Like(usdc).balanceOf(address(account)),
            usdcBefore,
            "USDC must have moved into the vault"
        );

        // 2) A session-key UserOp that redeems to an EXTERNAL recipient MUST be rejected (recipient pin).
        uint256 shares = IVaultLike(VAULT).balanceOf(address(account));
        bytes memory redeemInner =
            abi.encodeWithSelector(SEL_VAULT_REDEEM, shares, external_, address(account));
        PackedUserOperation memory badOp = _sessionOp(_execCd(VAULT, 0, redeemInner));

        PackedUserOperation[] memory badOps = new PackedUserOperation[](1);
        badOps[0] = badOp;
        vm.expectRevert(); // FailedOp — validation rejects the external recipient
        entryPoint.handleOps(badOps, payable(address(this)));
    }

    // ── 4337 helpers (mirror AccountTestBase) ──
    function _execCd(address target, uint256 value, bytes memory inner)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(SparkPointAccount.execute, (target, value, inner));
    }

    function _sessionOp(bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(account);
        op.nonce = entryPoint.getNonce(address(account), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(600_000), uint128(800_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(2e9), uint128(100e9)));
        bytes32 h = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(sessionPk, MessageHashUtils.toEthSignedMessageHash(h));
        op.signature = abi.encodePacked(MODE_SESSION, r, s, v);
    }

    receive() external payable { }
}
