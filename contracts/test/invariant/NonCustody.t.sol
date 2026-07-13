// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { VaultTestBase } from "../utils/VaultTestBase.sol";
import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { MockERC20, MockAavePool } from "../mocks/Mocks.sol";
import { Test } from "forge-std/Test.sol";

/// @notice N1 fuzz driver: honest actors deposit/withdraw, yield accrues, and an `attacker` that
///         never deposited hammers EVERY admin/governance/exit selector trying to extract funds.
contract NonCustodyHandler is Test {
    SparkPointVault internal vault;
    MockERC20 internal usdc;
    MockAavePool internal pool;
    address[] internal actors;
    address public immutable attacker;

    constructor(
        SparkPointVault vault_,
        MockERC20 usdc_,
        MockAavePool pool_,
        address[] memory actors_
    ) {
        vault = vault_;
        usdc = usdc_;
        pool = pool_;
        actors = actors_;
        attacker = makeAddr("attacker");
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        amount = bound(amount, 1, 100_000e6);
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(vault), amount);
        try vault.deposit(amount, a) { } catch { }
        vm.stopPrank();
    }

    function withdraw(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        uint256 maxW = vault.maxWithdraw(a);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(a);
        try vault.withdraw(amount, a, a) { } catch { }
    }

    function accrueYield(uint256 amount) public {
        amount = bound(amount, 0, 50_000e6);
        pool.accrueTo(address(vault), amount);
    }

    /// @notice The attacker tries every non-view selector. NONE may move underlying to it (N1).
    function attackerAssault(uint256 amount, uint16 feeBps) public {
        vm.startPrank(attacker);
        try vault.pauseDeposits() { } catch { }
        try vault.unpauseDeposits() { } catch { }
        try vault.setPerformanceFeeBps(feeBps) { } catch { }
        try vault.setFeeRecipient(attacker) { } catch { }
        try vault.accrueFee() { } catch { }
        try vault.harvest() { } catch { }
        try vault.withdraw(amount, attacker, actors[0]) { } catch { }
        try vault.redeem(amount, attacker, actors[0]) { } catch { }
        vm.stopPrank();
    }
}

/// @title NonCustody invariants — N1 (no admin drain), N2 (withdraw-always), N5 (non-upgradeable).
contract NonCustodyInvariantTest is StdInvariant, VaultTestBase {
    // EIP-1967 slots (must be EMPTY for a non-proxy, N5).
    bytes32 internal constant EIP1967_IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant EIP1967_ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    NonCustodyHandler internal handler;

    function setUp() public {
        _deployStack();
        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        handler = new NonCustodyHandler(vault, usdc, pool, actors);
        targetContract(address(handler));
    }

    // ── N1: no admin/governance path can drain to a non-holder ──
    /// @dev The attacker never deposited and is never approved, so across every governance/exit
    ///      selector it must NEVER end up holding vault USDC.
    function invariant_noAdminCanDrain() public view {
        assertEq(usdc.balanceOf(handler.attacker()), 0, "N1: admin/attacker extracted underlying");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // N2 — withdraw-always
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev redeem/withdraw must succeed with paused()==true (the whole stack "offline").
    function test_withdrawWorks_whenPaused_andOffline() public {
        uint256 amount = 1_000e6;
        _deposit(alice, amount);

        vm.prank(guardian);
        vault.pauseDeposits();
        assertTrue(vault.paused(), "precondition: vault must be paused");

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares, alice, alice);

        assertGt(assetsOut, 0, "N2: redeem must return funds while paused");
        assertEq(usdc.balanceOf(alice), assetsOut, "N2: user received underlying while paused");
        assertEq(vault.balanceOf(alice), 0, "N2: shares fully burned");
    }

    /// @dev The counterpart: deposit/mint MUST be blocked while paused (deposit-side pause).
    ///      RED against the stub: the stub deposit carries no `whenDepositsAllowed` enforcement.
    function test_deposit_revertsWhenPaused() public {
        vm.prank(guardian);
        vault.pauseDeposits();

        usdc.mint(bob, 1_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(SparkPointVault.DepositsArePaused.selector);
        vault.deposit(1_000e6, bob);
        vm.stopPrank();
    }

    /// @dev Source-level assert (COMMENTS STRIPPED so only real code counts): ONLY deposit/mint carry
    ///      the pause modifier; withdraw/redeem NEVER do. RED against the stub: the stub CODE has no
    ///      `whenDepositsAllowed` modifier (it appears only in a doc-comment, which we strip).
    function test_onlyDepositMintCarryPauseModifier() public view {
        string memory code = _stripComments(vm.readFile("src/vault/SparkPointVault.sol"));
        assertTrue(
            _contains(code, "whenDepositsAllowed"),
            "N2: deposit/mint must carry the whenDepositsAllowed pause modifier"
        );
        assertFalse(
            _contains(code, "whenNotPaused"),
            "N2: withdraw/redeem must NEVER carry a pause modifier"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // N5 — non-upgradeable + provable + pause-only governance
    // ─────────────────────────────────────────────────────────────────────────

    function test_vaultNotBehindProxy() public view {
        assertEq(
            vm.load(address(vault), EIP1967_IMPL_SLOT), bytes32(0), "N5: EIP-1967 impl slot set"
        );
        assertEq(
            vm.load(address(vault), EIP1967_ADMIN_SLOT), bytes32(0), "N5: EIP-1967 admin slot set"
        );
        // A minimal proxy is ~45 bytes; a real, self-contained vault is much larger.
        assertGt(
            address(vault).code.length, 1000, "N5: vault looks like a proxy, not a real contract"
        );
    }

    /// @dev The two role-gated pause functions must never move funds.
    function test_governanceIsPauseOnly() public {
        _deposit(alice, 5_000e6);
        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        uint256 guardianBalBefore = usdc.balanceOf(guardian);

        vm.startPrank(guardian);
        vault.pauseDeposits();
        vault.unpauseDeposits();
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), vaultBalBefore, "N5: pause moved vault funds");
        assertEq(usdc.balanceOf(guardian), guardianBalBefore, "N5: pause moved funds to guardian");
    }

    function test_feeConstantsAreZero() public view {
        assertEq(vault.entryFeeBasisPoints(), 0, "N5: entry fee must be 0");
        assertEq(vault.exitFeeBasisPoints(), 0, "N5: exit fee must be 0");
        assertEq(vault.managementFeeBasisPoints(), 0, "N5: management fee must be 0");
        assertEq(vault.MAX_PERFORMANCE_FEE_BPS(), 2000, "N5: perf-fee hard cap must be 2000 bps");
    }

    /// @dev Constructor MUST seed the HWM to convertToAssets(1e18) == 1e18 (FR-050).
    ///      RED against the stub: the stub leaves highWaterMark == 0.
    function test_hwmSeededAtDeployment() public view {
        assertGe(vault.highWaterMark(), 1e18, "N5/FR-050: HWM must be seeded to >= 1e18 at deploy");
    }

    /// @dev Remove `//`/`///` line comments and `/* */` block comments so only code is searched.
    function _stripComments(string memory src) internal pure returns (string memory) {
        bytes memory b = bytes(src);
        bytes memory out = new bytes(b.length);
        uint256 k;
        uint256 i;
        bytes1 slash = bytes1("/");
        bytes1 star = bytes1("*");
        bytes1 nl = bytes1("\n");
        while (i < b.length) {
            if (i + 1 < b.length && b[i] == slash && b[i + 1] == slash) {
                while (i < b.length && b[i] != nl) i++;
            } else if (i + 1 < b.length && b[i] == slash && b[i + 1] == star) {
                i += 2;
                while (i + 1 < b.length && !(b[i] == star && b[i + 1] == slash)) i++;
                i += 2;
            } else {
                out[k++] = b[i++];
            }
        }
        bytes memory res = new bytes(k);
        for (uint256 j = 0; j < k; j++) {
            res[j] = out[j];
        }
        return string(res);
    }

    // ── substring helper ──
    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
