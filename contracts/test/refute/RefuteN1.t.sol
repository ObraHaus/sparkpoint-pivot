// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { AaveV3Adapter } from "../../src/adapters/AaveV3Adapter.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { MockERC20, MockAToken, MockAavePool, MockCapRegistry } from "../mocks/Mocks.sol";

/// @notice A hostile fee-recipient: reverts on *every* call and refuses ETH. If the vault ever calls
///         back into the fee recipient during fee-share minting, or lets it block a withdrawal, honest
///         redemptions would break. Used to disprove the "mint to a privileged blocker" angle of N1.
contract HostileReceiver {
    fallback() external payable {
        revert("HOSTILE");
    }
}

/// @title RefuteN1 — ADVERSARIAL refutation of invariant N1 (no admin/owner asset withdrawal).
/// @notice The refuter GRANTS ITSELF EVERY ROLE the vault knows: the constructor's single governance
///         principal (guardian == governance == pauser) AND the feeRecipient are BOTH the `attacker`
///         address, deployed that way from block 0. There is no Ownable/owner and no other role.
///         From that maximal-privilege position every test below tries to move the vault's underlying
///         USDC (principal or accrued Aave value) to an arbitrary attacker-controlled address — via any
///         selector, the perf-fee path, the (unused) adapter recipient, the pool max-approval, a
///         donation, or a would-be sweep/rescue/upgrade. Each test asserts the drain FAILS.
///
///         N1 (from smart-contracts.md §6 / CLAUDE.md): the vault moves USDC out ONLY via ERC-4626
///         withdraw/redeem (share-owner/approved only); the perf fee is share DILUTION (_mint to a
///         non-privileged feeRecipient), never an asset transfer; there is NO sweep/rescue/migrate/
///         upgrade selector. A refutation would be: admin moving underlying directly, OR the
///         feeRecipient extracting MORE than realized yield (i.e. eating principal), OR any holder's
///         redeemable principal falling below deposited principal because of an admin action.
contract RefuteN1Test is Test {
    uint256 internal constant ONE_USDC = 1e6;
    uint16 internal constant MAX_FEE_BPS = 2000;

    MockERC20 internal usdc;
    MockAavePool internal pool;
    MockAToken internal aUSDC;
    MockCapRegistry internal caps;
    SparkPointVault internal vault;

    // The attacker holds EVERY role: guardian == governance == pauser == feeRecipient.
    address internal attacker = makeAddr("attacker");
    address internal alice = makeAddr("alice_victim"); // an honest depositor
    address internal sink = makeAddr("attacker_sink"); // an arbitrary drain destination

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pool = new MockAavePool(usdc);
        aUSDC = pool.aToken();
        // Permissive registry (this suite is not about caps): big ceilings so honest deposits land.
        caps = new MockCapRegistry(
            1_000_000 * ONE_USDC, 100_000_000 * ONE_USDC, 100_000_000 * ONE_USDC
        );

        // Deploy with the attacker as BOTH the sole governance principal and the fee recipient.
        vault = new SparkPointVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            attacker, // guardian == governance == pauser
            address(caps),
            attacker, // feeRecipient
            1000 // 10% starting fee
        );
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), amt);
        shares = vault.deposit(amt, who);
        vm.stopPrank();
    }

    /// @dev The vault's underlying claim (what N1 protects): aUSDC held + any idle USDC in the vault.
    function _vaultUnderlying() internal view returns (uint256) {
        return aUSDC.balanceOf(address(vault)) + usdc.balanceOf(address(vault));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 1 — hunt for a sweep / rescue / migrate / upgrade / drain selector.
    // As the all-powerful guardian, blast every plausible admin-drain signature at the vault.
    // The vault has NO fallback/receive, so a non-existent selector reverts (ok == false).
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_noHiddenDrainSelector() public {
        _deposit(alice, 100_000 * ONE_USDC);
        pool.accrueTo(address(vault), 25_000 * ONE_USDC); // real Aave value to try to steal
        uint256 underlyingBefore = _vaultUnderlying();

        bytes[] memory calls = new bytes[](18);
        calls[0] =
            abi.encodeWithSignature("sweep(address,uint256)", address(usdc), underlyingBefore);
        calls[1] = abi.encodeWithSignature(
            "sweep(address,address,uint256)", address(usdc), sink, underlyingBefore
        );
        calls[2] = abi.encodeWithSignature(
            "rescueTokens(address,address,uint256)", address(usdc), sink, underlyingBefore
        );
        calls[3] = abi.encodeWithSignature(
            "rescueERC20(address,uint256)", address(usdc), underlyingBefore
        );
        calls[4] = abi.encodeWithSignature(
            "recoverERC20(address,uint256)", address(usdc), underlyingBefore
        );
        calls[5] = abi.encodeWithSignature("emergencyWithdraw(address)", sink);
        calls[6] = abi.encodeWithSignature("emergencyWithdraw()");
        calls[7] = abi.encodeWithSignature("withdrawAll(address)", sink);
        calls[8] = abi.encodeWithSignature("skim(address)", sink);
        calls[9] = abi.encodeWithSignature("migrate(address)", sink);
        calls[10] = abi.encodeWithSignature("migrateFunds(address)", sink);
        calls[11] = abi.encodeWithSignature("upgradeTo(address)", sink);
        calls[12] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", sink, bytes(""));
        calls[13] = abi.encodeWithSignature("setImplementation(address)", sink);
        calls[14] = abi.encodeWithSignature(
            "execute(address,uint256,bytes)",
            address(usdc),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", sink, underlyingBefore)
        );
        calls[15] = abi.encodeWithSignature("adminWithdraw(uint256)", underlyingBefore);
        calls[16] =
            abi.encodeWithSignature("transferAssets(address,uint256)", sink, underlyingBefore);
        calls[17] = abi.encodeWithSignature("setAavePool(address)", sink); // repoint custody -> attacker pool

        vm.startPrank(attacker);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok,) = address(vault).call(calls[i]);
            assertFalse(ok, "N1 REFUTED: a hidden admin-drain selector EXISTS and executed");
        }
        vm.stopPrank();

        // Nothing moved: the underlying is intact and no attacker-controlled address holds vault USDC.
        assertEq(
            _vaultUnderlying(), underlyingBefore, "N1: underlying changed via a hidden selector"
        );
        assertEq(usdc.balanceOf(attacker), 0, "N1: attacker extracted underlying");
        assertEq(usdc.balanceOf(sink), 0, "N1: drain sink received underlying");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 2 — exhaust the real governance surface. None of the four real admin selectors
    // (pause/unpause/setPerformanceFeeBps/setFeeRecipient) may move a single wei of underlying.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_realGovernanceMovesNoFunds() public {
        _deposit(alice, 50_000 * ONE_USDC);
        pool.accrueTo(address(vault), 5_000 * ONE_USDC);
        uint256 underlyingBefore = _vaultUnderlying();

        vm.startPrank(attacker);
        vault.pauseDeposits();
        vault.unpauseDeposits();
        vault.setPerformanceFeeBps(MAX_FEE_BPS); // crank to the 20% hard cap
        vault.setFeeRecipient(sink); // point the fee at an arbitrary address
        vm.stopPrank();

        assertEq(_vaultUnderlying(), underlyingBefore, "N1: a governance selector moved underlying");
        assertEq(usdc.balanceOf(attacker), 0, "N1: governance leaked funds to attacker");
        assertEq(usdc.balanceOf(sink), 0, "N1: governance leaked funds to the sink");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 3 — THE PERF-FEE PATH. Can the fee recipient (attacker) ever extract MORE than the
    // realized yield, i.e. eat principal? Crank to 20%, harvest aggressively over many rounds, then
    // redeem every fee share. N1 holds iff attacker take <= total yield AND the honest holder still
    // redeems >= principal.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_feeRecipientCannotEatPrincipal() public {
        uint256 principal = 100_000 * ONE_USDC;
        _deposit(alice, principal);

        vm.prank(attacker);
        vault.setPerformanceFeeBps(MAX_FEE_BPS); // 20% — the worst the cap allows

        uint256 rounds = 6;
        uint256 yieldPerRound = 10_000 * ONE_USDC;
        uint256 totalYield = rounds * yieldPerRound;

        for (uint256 i = 0; i < rounds; i++) {
            pool.accrueTo(address(vault), yieldPerRound);
            // Hammer accrual: try to double/triple-charge the same yield.
            vm.startPrank(attacker);
            vault.harvest();
            vault.accrueFee();
            vault.accrueFee();
            vault.harvest();
            vm.stopPrank();
        }

        // Attacker (feeRecipient) redeems ALL of its minted fee shares. Hoist the balance read into a
        // local so the staticcall does not interfere with any expectRevert (author's noted gotcha).
        uint256 feeShares = vault.balanceOf(attacker);
        uint256 attackerTake;
        if (feeShares > 0) {
            vm.prank(attacker);
            attackerTake = vault.redeem(feeShares, attacker, attacker);
        }

        // Honest holder exits.
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 aliceOut = vault.redeem(aliceShares, alice, alice);

        // (a) The fee NEVER reaches into principal: the attacker's total take is bounded by the yield.
        assertLe(
            attackerTake,
            totalYield,
            "N1 REFUTED: fee recipient extracted MORE than the yield (principal)"
        );
        // Tighter: at 20% the take should be about a fifth of the yield, never a majority.
        assertLe(
            attackerTake, totalYield / 2, "N1 REFUTED: fee recipient took a majority of the yield"
        );
        // (b) The honest depositor's redeemable principal is fully preserved (allow OZ 1-wei offset dust).
        assertGe(
            aliceOut + 1, principal, "N1 REFUTED: honest principal fell below deposit due to fee"
        );
        // Conservation: no value materialized out of nowhere.
        assertLe(
            attackerTake + aliceOut, principal + totalYield + 1, "N1: value created from nothing"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 4 — steal ANOTHER holder's funds without allowance. The attacker holds every admin role
    // but zero shares of Alice's. withdraw/redeem with owner=alice must revert (no allowance).
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_cannotDrainAnotherOwnerWithoutAllowance() public {
        _deposit(alice, 40_000 * ONE_USDC);
        uint256 underlyingBefore = _vaultUnderlying();

        uint256 aliceShares = vault.balanceOf(alice);
        uint256 aliceAssets = vault.convertToAssets(aliceShares);

        vm.startPrank(attacker);
        vm.expectRevert(); // ERC20InsufficientAllowance
        vault.withdraw(aliceAssets, sink, alice);

        vm.expectRevert(); // ERC20InsufficientAllowance
        vault.redeem(aliceShares, sink, alice);
        vm.stopPrank();

        assertEq(_vaultUnderlying(), underlyingBefore, "N1: drained another owner's funds");
        assertEq(usdc.balanceOf(sink), 0, "N1: attacker sink received another owner's funds");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 5 — withdraw/redeem with NO shares, from a pure OUTSIDER. maxWithdraw/maxRedeem are 0 for a
    // non-holder, so any positive request reverts. `sink` is neither a depositor NOR the feeRecipient
    // (so accrueFee at the top of withdraw never mints it a claim); no one can conjure a claim it never
    // funded. NOTE: the attacker==feeRecipient IS a legitimate shareholder once fees accrue and may
    // redeem its OWN fee shares — that is bounded to <= realized yield (see ATTACK 3) and is NOT a drain.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_zeroShareOutsiderCannotWithdraw() public {
        _deposit(alice, 30_000 * ONE_USDC);
        pool.accrueTo(address(vault), 3_000 * ONE_USDC);
        uint256 underlyingBefore = _vaultUnderlying();

        assertEq(vault.balanceOf(sink), 0, "precondition: outsider holds no shares");

        vm.startPrank(sink);
        vm.expectRevert(); // ERC4626ExceededMaxWithdraw
        vault.withdraw(1, sink, sink);

        vm.expectRevert(); // ERC4626ExceededMaxRedeem
        vault.redeem(1, sink, sink);
        vm.stopPrank();

        // Even after a withdraw attempt ran accrueFee (minting fee shares to the attacker, not sink),
        // the outsider holds nothing and extracted nothing.
        assertEq(vault.balanceOf(sink), 0, "N1: outsider gained a share claim from nowhere");
        assertEq(_vaultUnderlying(), underlyingBefore, "N1: a zero-share outsider extracted funds");
        assertEq(usdc.balanceOf(sink), 0, "N1: zero-share outsider routed funds to itself");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 6 — abuse the constructor's max USDC approval to the Aave pool. Only the pool address can
    // pull, and only when the vault itself supplies. The attacker (not the pool) cannot transferFrom
    // the vault, so the unlimited allowance is not an admin drain path.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_maxPoolApprovalNotExploitable() public {
        _deposit(alice, 20_000 * ONE_USDC);
        // Idle USDC only exists if donated; force some idle balance to make the target juicy.
        usdc.mint(address(vault), 5_000 * ONE_USDC);
        uint256 vaultUsdc = usdc.balanceOf(address(vault));
        assertGt(vaultUsdc, 0, "precondition: vault holds pullable USDC");

        vm.prank(attacker);
        vm.expectRevert(); // attacker is not an approved spender of the vault's USDC
        usdc.transferFrom(address(vault), sink, vaultUsdc);

        assertEq(
            usdc.balanceOf(sink), 0, "N1: attacker pulled the vault's USDC via the pool allowance"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 7 — the (unused) adapter recipient angle. §7 forces the Aave recipient to the account/self;
    // the vault never routes withdrawals through the adapter, and the adapter itself is a reverting stub.
    // Confirm the adapter cannot deliver funds anywhere, and the vault's own Aave unwind lands in the
    // vault (address(this)) — a redeem receiver only ever gets what its OWN shares are worth.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_adapterAndPoolRecipientAreForced() public {
        AaveV3Adapter adapter = new AaveV3Adapter(IPool(address(pool)));
        vm.startPrank(attacker);
        vm.expectRevert(AaveV3Adapter.NotImplemented.selector);
        adapter.withdraw(address(usdc), 1);
        vm.expectRevert(AaveV3Adapter.NotImplemented.selector);
        adapter.supply(address(usdc), 1);
        vm.stopPrank();

        // The vault's redeem sends to an arbitrary receiver, but only up to the caller's OWN share value.
        uint256 principal = 10_000 * ONE_USDC;
        _deposit(alice, principal);
        pool.accrueTo(address(vault), 1_000 * ONE_USDC);
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 delivered = vault.redeem(aliceShares, sink, alice); // receiver=sink is Alice's choice
        // sink got exactly Alice's claim — not the whole vault; the fee holder's value stayed put.
        assertEq(usdc.balanceOf(sink), delivered, "receiver got Alice's own claim");
        assertLe(
            delivered, principal + 1_000 * ONE_USDC, "N1: redeem over-delivered beyond own claim"
        );
        assertGt(
            vault.totalAssets() + usdc.balanceOf(address(vault)), 0, "other holders' value remains"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 8 — the "privileged blocker" fee recipient. Point the fee at a contract that reverts on
    // everything. Because the fee is a plain _mint (no recipient callback) AND accrual is fail-open, a
    // hostile fee recipient can neither block withdrawals nor trap funds. Honest exit still returns
    // full principal + net yield.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_hostileFeeRecipientCannotBlockWithdraw() public {
        HostileReceiver hostile = new HostileReceiver();
        vm.startPrank(attacker);
        vault.setFeeRecipient(address(hostile));
        vault.setPerformanceFeeBps(MAX_FEE_BPS);
        vm.stopPrank();

        uint256 principal = 80_000 * ONE_USDC;
        _deposit(alice, principal);
        pool.accrueTo(address(vault), 8_000 * ONE_USDC);

        // Withdrawal MUST succeed despite the hostile fee recipient (fee mint has no callback; accrual
        // is fail-open). Alice exits with at least her principal.
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        assertGe(
            out + 1, principal, "N2/N1 REFUTED: hostile fee recipient blocked/ate honest principal"
        );
        assertEq(usdc.balanceOf(alice), out, "honest holder received underlying");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 9 — a raw-USDC donation is NOT admin-extractable. totalAssets() excludes idle USDC, so a
    // donation cannot move the share price, and with no sweep selector the admin cannot route it to an
    // attacker address either. It is inert w.r.t. custody.
    // ─────────────────────────────────────────────────────────────────────────
    function test_refute_donationNotSweepableToAttacker() public {
        _deposit(alice, 25_000 * ONE_USDC);
        usdc.mint(address(vault), 9_999 * ONE_USDC); // donation straight into the vault
        uint256 donated = usdc.balanceOf(address(vault));
        assertGt(donated, 0, "precondition: donation present");

        // Every conceivable sweep of the donation fails (no selector exists).
        vm.startPrank(attacker);
        (bool a,) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "sweep(address,address,uint256)", address(usdc), sink, donated
                )
            );
        (bool b,) = address(vault).call(abi.encodeWithSignature("skim(address)", sink));
        (bool c,) = address(vault)
            .call(abi.encodeWithSignature("recoverERC20(address,uint256)", address(usdc), donated));
        vm.stopPrank();
        assertFalse(a || b || c, "N1 REFUTED: donation was sweepable by admin");
        assertEq(usdc.balanceOf(sink), 0, "N1: donation reached the attacker sink");
        assertEq(usdc.balanceOf(attacker), 0, "N1: donation reached the attacker");
    }
}
