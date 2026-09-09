// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";

/// @title SessionKeyValidator fuzz — only in-scope actions validate; everything else packs
///        SIG_VALIDATION_FAILED or reverts (smart-contracts.md §4, the 6-step deterministic flow).
/// @dev Drives the validator DIRECTLY over a fuzzed notional / target / selector / recipient / expiry.
///      Every negative case is RED against the accept-all stub. Rejected ops never touch `spent`, so
///      these stateless-negative fuzzes do not accumulate and stay valid against the GREEN validator.
contract SessionKeyValidatorFuzzTest is AccountTestBase {
    function setUp() public {
        _deployAccountStack();
    }

    /// @dev Notional strictly above the per-tx cap ⇒ rejected.
    function testFuzz_notionalAbovePerTxCap_rejected(uint256 amount) public {
        amount = bound(amount, uint256(SESSION_PER_TX) + 1, 1e30);
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(amount, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_validatorAccepts(op), "over per-tx cap must fail validation");
    }

    /// @dev A target that is not one of the three allowlisted protocols ⇒ rejected (G5).
    function testFuzz_nonAllowlistedTarget_rejected(address target) public {
        vm.assume(
            target != address(vault) && target != address(aavePool) && target != address(router)
        );
        bytes memory cd = _execCd(target, 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_validatorAccepts(op), "non-allowlisted target must fail validation");
    }

    /// @dev approve / transfer / transferFrom / empty selector ⇒ rejected at an allowlisted target.
    function testFuzz_forbiddenSelector_rejected(uint256 kind) public {
        bytes4[4] memory forbidden = [SEL_APPROVE, SEL_TRANSFER, SEL_TRANSFER_FROM, SEL_EMPTY];
        bytes4 sel = forbidden[kind % 4];
        bytes memory inner = abi.encodeWithSelector(sel, address(account), uint256(100e6));
        bytes memory cd = _execCd(address(vault), 0, inner);
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_validatorAccepts(op), "forbidden selector must fail validation");
    }

    /// @dev Any recipient other than the account itself ⇒ rejected (recipient pin, N1).
    function testFuzz_externalRecipient_rejected(address recipient) public {
        vm.assume(recipient != address(account) && recipient != address(0));
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, recipient));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_validatorAccepts(op), "external recipient must fail validation");
    }

    /// @dev A timestamp outside [validAfter, validUntil] ⇒ rejected (hard expiry, N4). The op hash is
    ///      time-independent, so we build first, then warp out of the window.
    function testFuzz_outsideWindow_rejected(uint256 t) public {
        // Outside the default key's [validAfter, validUntil] = [START_TS, START_TS + 7 days].
        t = bound(t, uint256(validUntil) + 1, uint256(validUntil) + 3650 days);
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        vm.warp(t);
        assertFalse(_validatorAccepts(op), "op past validUntil must fail validation");
    }

    /// @dev §7 slippage floor (step 5): a swap with `amountOutMin == 0` is REJECTED — a zero floor is
    ///      an unbounded-loss / sandwich window. Recipient is pinned to the account so the ONLY thing
    ///      that can reject the op is the slippage check. RED against a validator that skips step 5.
    function testFuzz_swapZeroAmountOutMin_rejected(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, SESSION_PER_TX);
        bytes memory cd = _execCd(address(router), 0, _aeroSwapCd(amountIn, 0, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(
            _validatorAccepts(op), "swap with amountOutMin == 0 must fail the slippage floor"
        );
    }

    /// @dev §7 slippage floor (step 5): any `amountOutMin` strictly BELOW the floor is REJECTED. floor =
    ///      amountIn * (10_000 - maxSlippageBps) / 10_000 (SessionKeyValidator.sol:95). Fuzz amountOutMin
    ///      across the whole [0, floor) band; recipient pinned so only the slippage check can reject.
    function testFuzz_swapBelowSlippageFloor_rejected(uint256 amountIn, uint256 amountOutMin)
        public
    {
        amountIn = bound(amountIn, 2, SESSION_PER_TX); // >= 2 so the floor is >= 1 and [0, floor) is non-empty
        uint256 floor = (amountIn * (10_000 - SESSION_MAX_SLIPPAGE_BPS)) / 10_000;
        vm.assume(floor > 0);
        amountOutMin = bound(amountOutMin, 0, floor - 1);

        bytes memory cd =
            _execCd(address(router), 0, _aeroSwapCd(amountIn, amountOutMin, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(
            _validatorAccepts(op), "amountOutMin below the slippage floor must fail validation"
        );
    }

    /// @dev POSITIVE control (fresh key each run so cumulative never exhausts): a swap AT/above the
    ///      floor with the recipient pinned to the account VALIDATES — proving the two negatives above
    ///      fail specifically on the slippage floor, not on a blanket swap reject.
    function testFuzz_swapAtSlippageFloor_accepted(uint256 amountIn, uint256 keySeed) public {
        amountIn = bound(amountIn, 1, SESSION_PER_TX);
        uint256 floor = (amountIn * (10_000 - SESSION_MAX_SLIPPAGE_BPS)) / 10_000;
        vm.assume(floor > 0); // amountIn == 1 floors to 0, where amountOutMin == 0 is (correctly) rejected

        uint256 pk = bound(keySeed, 1, type(uint128).max);
        address k = vm.addr(pk);
        IPolicyModule.Policy memory p = _defaultPolicy();
        p.sessionKey = k;
        vm.prank(owner);
        account.authorizeSessionKey(p, _allowTargets(), _allowSelectors());

        bytes memory cd =
            _execCd(address(router), 0, _aeroSwapCd(amountIn, floor, address(account)));
        PackedUserOperation memory op = _sessionOpWith(pk, cd);
        assertTrue(
            _validatorAccepts(op), "swap AT the slippage floor with recipient pinned must validate"
        );
    }

    /// @dev POSITIVE: a fully in-scope op (fresh key each run so cumulative never exhausts) validates.
    function testFuzz_inScopeDeposit_accepted(uint256 amount, uint256 keySeed) public {
        amount = bound(amount, 1, SESSION_PER_TX);
        uint256 pk = bound(keySeed, 1, type(uint128).max);
        address k = vm.addr(pk);

        IPolicyModule.Policy memory p = _defaultPolicy();
        p.sessionKey = k;
        vm.prank(owner);
        account.authorizeSessionKey(p, _allowTargets(), _allowSelectors());

        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(amount, address(account)));
        PackedUserOperation memory op = _sessionOpWith(pk, cd);
        assertTrue(_validatorAccepts(op), "in-scope op must validate");
    }
}
