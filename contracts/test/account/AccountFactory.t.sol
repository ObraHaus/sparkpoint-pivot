// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { EntryPoint } from "@account-abstraction/core/EntryPoint.sol";

import { AccountFactory } from "../../src/account/AccountFactory.sol";
import { SparkPointAccount } from "../../src/account/SparkPointAccount.sol";
import { SessionKeyValidator } from "../../src/account/SessionKeyValidator.sol";
import { PolicyModule } from "../../src/account/PolicyModule.sol";

/// @title AccountFactory — N3: CREATE2 determinism, idempotency, owner==caller (smart-contracts.md §3).
/// @notice invariant_factoryOwnerIsCaller + counterfactual/determinism/idempotency unit gates.
contract AccountFactoryTest is StdInvariant, Test {
    EntryPoint internal entryPoint;
    PolicyModule internal policy;
    SessionKeyValidator internal validator;
    SparkPointAccount internal accountImpl;
    AccountFactory internal factory;

    address internal user = makeAddr("user");

    address[] internal created;
    address[] internal expectedOwners;

    function setUp() public {
        entryPoint = new EntryPoint();
        policy = new PolicyModule(address(this));
        validator = new SessionKeyValidator(address(policy));
        accountImpl = new SparkPointAccount(
            IEntryPoint(address(entryPoint)), address(validator), address(policy)
        );
        factory = new AccountFactory(address(accountImpl));

        bytes4[] memory sel = new bytes4[](1);
        sel[0] = this.h_create.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: sel }));
        targetContract(address(this));
    }

    function h_create(address ownerSeed, uint256 salt) public {
        if (ownerSeed == address(0)) return;
        try factory.createAccount(ownerSeed, salt) returns (address a) {
            created.push(a);
            expectedOwners.push(ownerSeed);
        } catch { }
    }

    /// @dev Every account the factory produces is owned by the caller-supplied EOA — never a
    ///      SparkPoint/factory address (N3). RED: the stub binds owner = the factory itself.
    function invariant_factoryOwnerIsCaller() public view {
        for (uint256 i = 0; i < created.length; i++) {
            assertEq(
                SparkPointAccount(payable(created[i])).owner(),
                expectedOwners[i],
                "N3: account owner must equal the caller-supplied EOA"
            );
        }
    }

    // ── Deterministic gates (proof of RED) ──

    /// @dev N3: createAccount binds owner == the supplied EOA.
    function test_createAccount_bindsCallerOwner() public {
        address a = factory.createAccount(user, 1);
        assertEq(SparkPointAccount(payable(a)).owner(), user, "owner must be the supplied EOA");
    }

    /// @dev CREATE2: the deployed address MUST equal the counterfactual getAddress(owner, salt).
    function test_getAddress_matchesCreateAccount() public {
        address predicted = factory.getAddress(user, 7);
        address a = factory.createAccount(user, 7);
        assertEq(predicted, a, "N3: getAddress must predict the CREATE2 address");
    }

    /// @dev The counterfactual address holds code AFTER deployment (frontend shows it before).
    function test_counterfactual_hasCodeAfterDeploy() public {
        address predicted = factory.getAddress(user, 9);
        factory.createAccount(user, 9);
        assertGt(
            predicted.code.length, 0, "N3: counterfactual address must be the deployed account"
        );
    }

    /// @dev Idempotent: a second createAccount(owner, salt) returns the SAME account.
    function test_createAccount_idempotent() public {
        address a1 = factory.createAccount(user, 42);
        address a2 = factory.createAccount(user, 42);
        assertEq(a1, a2, "N3: createAccount must be idempotent for the same (owner, salt)");
    }

    /// @dev Different salts ⇒ different accounts (still deterministic per salt).
    function test_differentSalt_differentAccount() public {
        address a1 = factory.createAccount(user, 1);
        address a2 = factory.createAccount(user, 2);
        assertTrue(a1 != a2, "distinct salts must yield distinct accounts");
    }
}
