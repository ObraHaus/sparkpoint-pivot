// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";
import { MockProtocol } from "../mocks/MockProtocol.sol";
import { MockERC20 } from "../../mocks/Mocks.sol";
import { SparkPointAccount } from "../../../src/account/SparkPointAccount.sol";
import { PolicyModule } from "../../../src/account/PolicyModule.sol";

/// @notice A DRAIN-CAPABLE allowlisted target: `redeem` actually moves USDC to whatever `receiver` the
///         calldata names. Used to prove the recipient pin blocks an END-TO-END `handleOps` exfiltration
///         (with the inert MockProtocol nothing moves, so a token-moving target makes the drain "real").
contract DrainableVault {
    MockERC20 public immutable token;

    constructor(MockERC20 token_) {
        token = token_;
    }

    /// @dev ERC-4626-shaped redeem(shares, receiver, owner): sends `shares` USDC to `receiver`.
    function redeem(uint256 shares, address receiver, address) external returns (uint256) {
        token.transfer(receiver, shares);
        return shares;
    }

    function deposit(uint256 assets, address) external returns (uint256) {
        return assets;
    }
}

/// @title RefuteSessionDrain — ADVERSARIAL refuter for N1/N4 (smart-contracts.md §2/§4/§5).
/// @notice The test contract HOLDS the session private key (`sessionPk`) as a hostile agent and tries
///         every documented way to move funds OUT of the account: name an external/SparkPoint
///         recipient (a), smuggle approve/transfer/transferFrom (b), reach an un-allowlisted target (c),
///         batch a benign+malicious call (d), exceed the per-tx cap (e), and blow through the cumulative
///         cap (f). It also probes native-ETH `value`, session self-escalation, and revoked/expired keys.
///
/// Verdict convention: EVERY malicious session UserOp must be REJECTED at validation (the §4 flow runs
///   inside `validateUserOp`, so a rejection means `execute` is never reached and nothing moves). Two
///   drains are additionally driven through a full `EntryPoint.handleOps` round-trip against a
///   token-moving target to prove the block holds end-to-end (attacker balance stays 0). If any
///   `assertFalse` here were to fail — i.e. a malicious op validated — that IS the failing PoC and the
///   suite goes RED (REFUTED).
contract RefuteSessionDrainTest is AccountTestBase {
    DrainableVault internal drainable;

    function setUp() public {
        _deployAccountStack();

        // A token-moving allowlisted target for the end-to-end drain proofs (admin == this test).
        drainable = new DrainableVault(usdc);
        usdc.mint(address(drainable), 1_000_000e6);
        policy.setAllowedTarget(address(drainable), SEL_VAULT_REDEEM, true);

        // Prefund the account's EntryPoint gas deposit so handleOps needs no in-band prefund
        // (keeps the account's own ETH balance untouched by the gas accounting).
        vm.deal(address(this), 20 ether);
        entryPoint.depositTo{ value: 5 ether }(address(account));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Positive control — a fully in-scope session op MUST validate, so every
    //  rejection below is a real scope block and not a vacuously-broken harness.
    // ─────────────────────────────────────────────────────────────────────────

    function test_control_inScopeDepositToAccount_isAccepted() public {
        PackedUserOperation memory op =
            _sessionExec(address(vault), _vaultDepositCd(100e6, address(account)));
        assertTrue(_accountAccepts(op), "control: in-scope deposit to the account must validate");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (a) External / SparkPoint recipient on every allowlisted protocol path
    // ─────────────────────────────────────────────────────────────────────────

    function test_a_vaultDeposit_toAttacker_rejected() public {
        _expectRejected(_sessionExec(address(vault), _vaultDepositCd(100e6, attacker)));
    }

    function test_a_vaultDeposit_toSparkPoint_rejected() public {
        _expectRejected(_sessionExec(address(vault), _vaultDepositCd(100e6, sparkpoint)));
    }

    function test_a_vaultRedeem_receiverAttacker_rejected() public {
        _expectRejected(
            _sessionExec(address(vault), _vaultRedeemCd(100e6, attacker, address(account)))
        );
    }

    function test_a_vaultWithdraw_receiverSparkPoint_rejected() public {
        _expectRejected(
            _sessionExec(address(vault), _vaultWithdrawCd(100e6, sparkpoint, address(account)))
        );
    }

    function test_a_aaveSupply_onBehalfOfAttacker_rejected() public {
        _expectRejected(
            _sessionExec(address(aavePool), _aaveSupplyCd(address(usdc), 100e6, attacker))
        );
    }

    function test_a_aaveWithdraw_toAttacker_rejected() public {
        _expectRejected(
            _sessionExec(address(aavePool), _aaveWithdrawCd(address(usdc), 100e6, attacker))
        );
    }

    /// @dev Swap crafted to CLEAR the slippage floor so the ONLY failing check is the recipient pin.
    function test_a_swap_toAttacker_evenWithHealthySlippage_rejected() public {
        bytes memory inner = _swapCd(100e6, 100e6, attacker); // amountOutMin 100e6 >= floor 99.5e6
        _expectRejected(_sessionExec(address(router), inner));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (b) Smuggle approve / transfer / transferFrom / empty selector through an
    //      allowlisted target — the by-construction forbidden-selector guard.
    // ─────────────────────────────────────────────────────────────────────────

    function test_b_approve_onAllowlistedTarget_rejected() public {
        bytes memory inner = abi.encodeWithSelector(SEL_APPROVE, attacker, type(uint256).max);
        _expectRejected(_sessionExec(address(vault), inner));
    }

    function test_b_transfer_onAllowlistedTarget_rejected() public {
        bytes memory inner = abi.encodeWithSelector(SEL_TRANSFER, attacker, uint256(100e6));
        _expectRejected(_sessionExec(address(vault), inner));
    }

    function test_b_transferFrom_onAllowlistedTarget_rejected() public {
        bytes memory inner =
            abi.encodeWithSelector(SEL_TRANSFER_FROM, address(account), attacker, uint256(100e6));
        _expectRejected(_sessionExec(address(vault), inner));
    }

    /// @dev approve directly on the USDC token itself (would grant the attacker a standing allowance).
    function test_b_approveOnUsdcToken_rejected() public {
        bytes memory inner = abi.encodeWithSelector(SEL_APPROVE, attacker, type(uint256).max);
        _expectRejected(_sessionExec(address(usdc), inner));
    }

    function test_b_emptySelector_arbitraryCall_rejected() public {
        _expectRejected(_sessionExec(address(vault), hex"")); // empty selector 0x00000000
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (c) Un-allowlisted target
    // ─────────────────────────────────────────────────────────────────────────

    function test_c_rogueTarget_rejected() public {
        _expectRejected(_sessionExec(address(0xBEEF), _vaultDepositCd(100e6, address(account))));
    }

    function test_c_attackerAsTarget_rejected() public {
        _expectRejected(_sessionExec(attacker, _vaultDepositCd(100e6, address(account))));
    }

    /// @dev The drainable target IS allowlisted, but only for redeem; a deposit selector on it is not.
    function test_c_allowlistedTargetWrongSelector_rejected() public {
        _expectRejected(_sessionExec(address(drainable), _vaultDepositCd(100e6, address(account))));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (d) Batch a benign + malicious call (session keys are single-execute only)
    // ─────────────────────────────────────────────────────────────────────────

    function test_d_executeBatch_benignPlusMalicious_rejected() public {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory datas = new bytes[](2);
        targets[0] = address(vault);
        datas[0] = _vaultDepositCd(1, address(account)); // benign
        targets[1] = address(drainable);
        datas[1] = _vaultRedeemCd(100e6, attacker, address(account)); // malicious exfil
        bytes memory cd = abi.encodeCall(SparkPointAccount.executeBatch, (targets, values, datas));
        _expectRejected(_sessionOp(cd));
    }

    /// @dev A top-level callData that is neither execute nor executeBatch is likewise rejected.
    function test_d_nonExecuteTopLevelCall_rejected() public {
        bytes memory cd = abi.encodeCall(SparkPointAccount.transferOwnership, (attacker));
        _expectRejected(_sessionOp(cd));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (e) Exceed the per-tx cap (crafted notional / max notional)
    // ─────────────────────────────────────────────────────────────────────────

    function test_e_perTxCapPlusOne_rejected() public {
        _expectRejected(
            _sessionExec(
                address(vault), _vaultDepositCd(uint256(SESSION_PER_TX) + 1, address(account))
            )
        );
    }

    function test_e_maxNotional_rejected() public {
        _expectRejected(
            _sessionExec(address(vault), _vaultDepositCd(type(uint256).max, address(account)))
        );
    }

    function test_e_aaveSupplyOverCap_rejected() public {
        _expectRejected(
            _sessionExec(
                address(aavePool),
                _aaveSupplyCd(address(usdc), uint256(SESSION_PER_TX) + 1, address(account))
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  (f) Reach the cumulative cap, then keep going
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Ten accepted in-scope 500-USDC deposits exhaust the 5,000-USDC cumulative cap; the 11th op
    ///      (and even a 1-unit op) is then rejected, and on-chain `spent` never exceeds the cap.
    function test_f_cumulativeCap_exhaustThenBlocked() public {
        uint256 nOps = uint256(SESSION_CUMULATIVE) / uint256(SESSION_PER_TX); // 10
        for (uint256 i = 0; i < nOps; i++) {
            PackedUserOperation memory op = _sessionExec(
                address(vault), _vaultDepositCd(uint256(SESSION_PER_TX), address(account))
            );
            assertTrue(_accountAccepts(op), "in-scope op below cumulative cap must validate");
        }

        uint256 spent = policy.policyOf(address(account), sessionKey).spent;
        assertEq(spent, uint256(SESSION_CUMULATIVE), "spent must sit exactly at the cumulative cap");

        // The cap is now reached: any further spend, even a single unit, is rejected.
        _expectRejected(
            _sessionExec(address(vault), _vaultDepositCd(uint256(SESSION_PER_TX), address(account)))
        );
        _expectRejected(_sessionExec(address(vault), _vaultDepositCd(1, address(account))));

        // And `spent` was never nudged past the cap by the rejected ops (monotonic + bounded).
        assertEq(
            policy.policyOf(address(account), sessionKey).spent,
            uint256(SESSION_CUMULATIVE),
            "rejected ops must not move the monotonic spend ledger"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Session self-escalation — a compromised key cannot widen its own scope.
    // ─────────────────────────────────────────────────────────────────────────

    function test_g_sessionCannotAuthorizeNewKey() public {
        IPolicyModule.Policy memory rogue = _defaultPolicy();
        rogue.sessionKey = attacker;
        rogue.perTxCap = type(uint128).max;
        rogue.cumulativeCap = type(uint128).max;
        bytes memory inner = abi.encodeCall(SparkPointAccount.authorizeSessionKey, (rogue));
        _expectRejected(_sessionExec(address(account), inner));
    }

    function test_g_sessionCannotTransferOwnership() public {
        bytes memory inner = abi.encodeCall(SparkPointAccount.transferOwnership, (attacker));
        _expectRejected(_sessionExec(address(account), inner));
    }

    function test_g_sessionCannotArmAllowlist() public {
        bytes memory inner =
            abi.encodeCall(PolicyModule.setAllowedTarget, (attacker, SEL_TRANSFER, true));
        _expectRejected(_sessionExec(address(policy), inner));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Revoked / expired keys cannot drain (live-storage read; hard window)
    // ─────────────────────────────────────────────────────────────────────────

    function test_h_revokedKeyCannotDrain() public {
        vm.prank(owner);
        account.revokeSessionKey(sessionKey);
        _expectRejected(_sessionExec(address(vault), _vaultDepositCd(100e6, address(account))));
    }

    function test_h_expiredWindowCannotDrain() public {
        PackedUserOperation memory op =
            _sessionExec(address(vault), _vaultDepositCd(100e6, address(account)));
        vm.warp(uint256(validUntil) + 1); // step past the hard expiry
        assertFalse(_accountAccepts(op), "an op past validUntil must be rejected");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Native-ETH `value` cannot exfiltrate — value is only ever sent to the
    //  (allowlisted, non-payable) target, never to the attacker/SparkPoint.
    // ─────────────────────────────────────────────────────────────────────────

    function test_i_nonZeroValue_cannotReachAttacker() public {
        bytes memory cd = _execCd(address(vault), 5 ether, _vaultDepositCd(1, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);

        uint256 attackerEthBefore = attacker.balance;
        uint256 sparkEthBefore = sparkpoint.balance;
        uint256 accountEthBefore = address(account).balance;

        // Execution reverts inside the non-payable target (EntryPoint catches it, no handleOps revert),
        // so no ETH is transferred anywhere; the attacker/SparkPoint never receive value.
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        try entryPoint.handleOps(ops, payable(address(this))) { } catch { }

        assertEq(attacker.balance, attackerEthBefore, "attacker must not receive ETH via value");
        assertEq(sparkpoint.balance, sparkEthBefore, "SparkPoint must not receive ETH via value");
        assertEq(
            address(account).balance,
            accountEthBefore,
            "reverted inner call must not move account ETH"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  END-TO-END through EntryPoint.handleOps against a token-MOVING target.
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Control: an in-scope redeem to the ACCOUNT succeeds and USDC lands back in the account.
    function test_e2e_control_redeemToAccount_succeeds() public {
        uint256 accBefore = usdc.balanceOf(address(account));
        PackedUserOperation memory op = _sessionExec(
            address(drainable), _vaultRedeemCd(100e6, address(account), address(account))
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(address(this)));
        assertEq(
            usdc.balanceOf(address(account)),
            accBefore + 100e6,
            "in-scope redeem must return USDC to the account"
        );
    }

    /// @dev The drain: a session redeem naming the ATTACKER as receiver is rejected by the recipient pin,
    ///      handleOps reverts (FailedOp), and not one unit of USDC reaches the attacker.
    function test_e2e_drain_redeemToAttacker_blockedAndNoFunds() public {
        uint256 attackerBefore = usdc.balanceOf(attacker);
        uint256 drainableBefore = usdc.balanceOf(address(drainable));

        PackedUserOperation memory op =
            _sessionExec(address(drainable), _vaultRedeemCd(500e6, attacker, address(account)));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;

        vm.expectRevert(); // FailedOp — validation rejects the external recipient
        entryPoint.handleOps(ops, payable(address(this)));

        assertEq(usdc.balanceOf(attacker), attackerBefore, "attacker USDC must be unchanged");
        assertEq(
            usdc.balanceOf(address(drainable)), drainableBefore, "no USDC may leave the target"
        );
    }

    /// @dev Same drain aimed at the SparkPoint address (the address funds must NEVER reach).
    function test_e2e_drain_redeemToSparkPoint_blockedAndNoFunds() public {
        uint256 sparkBefore = usdc.balanceOf(sparkpoint);
        PackedUserOperation memory op =
            _sessionExec(address(drainable), _vaultRedeemCd(500e6, sparkpoint, address(account)));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(this)));
        assertEq(usdc.balanceOf(sparkpoint), sparkBefore, "SparkPoint USDC must be unchanged");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Build a session-signed `execute(target, 0, inner)` UserOp (the hostile agent's op).
    function _sessionExec(address target, bytes memory inner)
        internal
        view
        returns (PackedUserOperation memory)
    {
        return _sessionOp(_execCd(target, 0, inner));
    }

    /// @notice Assert the account REJECTS this op at validation (the §4 gate; execute never runs).
    function _expectRejected(PackedUserOperation memory op) internal {
        assertFalse(_accountAccepts(op), "malicious session op must be rejected at validation");
    }

    function _vaultWithdrawCd(uint256 assets, address receiver, address owner_)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_VAULT_WITHDRAW, assets, receiver, owner_);
    }

    function _aaveWithdrawCd(address asset, uint256 amount, address to)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_AAVE_WITHDRAW, asset, amount, to);
    }

    function _swapCd(uint256 amountIn, uint256 amountOutMin, address to)
        internal
        pure
        returns (bytes memory)
    {
        MockProtocol.Route[] memory routes = new MockProtocol.Route[](0);
        return abi.encodeWithSelector(
            SEL_AERO_SWAP, amountIn, amountOutMin, routes, to, type(uint256).max
        );
    }

    receive() external payable { }
}
