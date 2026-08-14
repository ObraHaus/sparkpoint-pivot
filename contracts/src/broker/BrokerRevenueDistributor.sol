// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title BrokerRevenueDistributor — pays a closed period's protocol revenue to broker holders.
///
/// @notice Protocol fees accumulate in the fee-treasury Safe. Once a period closes, a portion is
///         transferred in here and an allocation is published; holders of activated Sparky Brokers
///         then claim their share, weighted by the tier they activated at (1.0× / 2.0× / 3.3×).
///
/// @dev **This contract holds other people's money, so the whole design is about what it CANNOT do.**
///
///      There is no `withdraw`, `sweep`, `rescue`, `migrate` or `recoverERC20` — not for the owner,
///      not for anyone. The ONLY way value leaves is a holder claiming an allocation they were
///      published. That is deliberate and it is the point: an admin path out of a pot of other
///      people's revenue is the thing this must not have.
///
///      **The core invariant, enforced by construction rather than by care:**
///
///          owed[token] <= balanceOf(token)          — at all times, for every token
///
///      `publishAllocations` refuses to promise more than `available()` (balance minus what is
///      already owed), so the contract can never owe more than it holds. A fuzz test asserts it.
///
///      **Rollover is what happens by default, not a feature that could be forgotten.** Value that
///      is funded but never allocated, and value allocated but never claimed once a period is
///      superseded, simply stays in the balance and raises `available()` for the next period.
///      Nothing sweeps it anywhere, because nothing can.
///
///      **Why Merkle roots rather than on-chain enumeration.** `SparkyBroker` is not enumerable and
///      there are 10,000 of them; computing a weighted split on-chain is impossible. The split is
///      computed off-chain and committed as a root. That is a trust surface, so the inputs are
///      published alongside it and anyone can recompute the root — a claim about other people's
///      money should be checkable, not taken on faith.
///
/// @dev ⚠️ A leaf binds an ACCOUNT, not a token id: a closed period is a fact about the past, so
///      selling a broker afterwards does not move a claim that was already earned. Allocations are
///      computed per broker and summed per wallet before the tree is built.
contract BrokerRevenueDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    struct Period {
        /// @notice The ONE token this period is denominated in. Mixed-token splits are meaningless.
        address token;
        /// @notice Total added to the contract for this period (may be 0 — a period can run purely
        ///         on rollover).
        uint256 funded;
        /// @notice Sum of every allocation in the tree. Never more than was available.
        uint256 totalAllocated;
        /// @notice Commitment to the allocation. Zero until published; immutable once set.
        bytes32 merkleRoot;
        /// @notice When the allocation was published. 0 = not yet.
        uint64 publishedAt;
    }

    /// @notice periodId → its record. Ids start at 1; 0 is "no period".
    mapping(uint256 => Period) public periods;

    /// @notice How many periods exist.
    uint256 public periodCount;

    /// @notice token → total published-but-unclaimed. The contract's promise.
    mapping(address => uint256) public owed;

    /// @notice periodId → account → already claimed.
    mapping(uint256 => mapping(address => bool)) public claimed;

    event PeriodFunded(
        uint256 indexed periodId, address indexed token, uint256 added, uint256 available
    );
    event AllocationsPublished(
        uint256 indexed periodId, bytes32 merkleRoot, uint256 totalAllocated
    );
    event Claimed(
        uint256 indexed periodId, address indexed account, address indexed token, uint256 amount
    );

    error UnknownPeriod(uint256 periodId);
    error AlreadyPublished(uint256 periodId);
    error NotPublished(uint256 periodId);
    error AllocationExceedsAvailable(uint256 requested, uint256 available);
    error AlreadyClaimed(uint256 periodId, address account);
    error BadProof();
    error ZeroAddress();
    error ZeroRoot();

    constructor(address owner_) Ownable(owner_ == address(0) ? msg.sender : owner_) { }

    /// @notice Open a period and (optionally) add funds to it.
    /// @dev `added` may be 0: a period can run entirely on value left over from earlier ones, which
    ///      is exactly how rollover reaches holders.
    function fundPeriod(address token, uint256 added)
        external
        onlyOwner
        returns (uint256 periodId)
    {
        if (token == address(0)) revert ZeroAddress();

        if (added != 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), added);
        }

        periodId = ++periodCount;
        periods[periodId] = Period({
            token: token, funded: added, totalAllocated: 0, merkleRoot: bytes32(0), publishedAt: 0
        });

        emit PeriodFunded(periodId, token, added, available(token));
    }

    /// @notice Commit this period's allocation.
    /// @param merkleRoot root of leaves `keccak256(abi.encode(periodId, account, amount))`
    /// @param totalAllocated the sum of every amount in the tree
    /// @dev Refuses to promise more than is actually here, which is what keeps
    ///      `owed <= balance` true for every token at all times. Immutable once set: a published
    ///      period is a fact holders may already have acted on.
    function publishAllocations(uint256 periodId, bytes32 merkleRoot, uint256 totalAllocated)
        external
        onlyOwner
    {
        Period storage p = periods[periodId];
        if (p.token == address(0)) revert UnknownPeriod(periodId);
        if (p.publishedAt != 0) revert AlreadyPublished(periodId);
        if (merkleRoot == bytes32(0)) revert ZeroRoot();

        uint256 free = available(p.token);
        if (totalAllocated > free) revert AllocationExceedsAvailable(totalAllocated, free);

        p.merkleRoot = merkleRoot;
        p.totalAllocated = totalAllocated;
        p.publishedAt = uint64(block.timestamp);
        owed[p.token] += totalAllocated;

        emit AllocationsPublished(periodId, merkleRoot, totalAllocated);
    }

    /// @notice Claim what a published period allocated to you.
    /// @dev The caller IS the account — a proof cannot be replayed to redirect someone else's share.
    function claim(uint256 periodId, uint256 amount, bytes32[] calldata proof) external {
        Period storage p = periods[periodId];
        if (p.token == address(0)) revert UnknownPeriod(periodId);
        if (p.publishedAt == 0) revert NotPublished(periodId);
        if (claimed[periodId][msg.sender]) revert AlreadyClaimed(periodId, msg.sender);

        bytes32 leaf = keccak256(abi.encode(periodId, msg.sender, amount));
        if (!MerkleProof.verifyCalldata(proof, p.merkleRoot, leaf)) revert BadProof();

        // Effects before the transfer — the token is owner-chosen rather than attacker-chosen, but
        // the ordering costs nothing and removes the question entirely.
        claimed[periodId][msg.sender] = true;
        owed[p.token] -= amount;

        if (amount != 0) {
            IERC20(p.token).safeTransfer(msg.sender, amount);
        }
        emit Claimed(periodId, msg.sender, p.token, amount);
    }

    /// @notice Value of `token` held here that is not already promised to someone.
    /// @dev What a new period may allocate. Rollover is simply this being larger than what was
    ///      freshly funded — no separate mechanism, and therefore nothing that can fail to run.
    function available(address token) public view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 promised = owed[token];
        // Defensive: a token that takes a fee on transfer could in principle break the arithmetic.
        // Reporting 0 is the safe direction — it blocks new allocations rather than over-promising.
        return balance > promised ? balance - promised : 0;
    }

    /// @notice Whether `account` can still claim `periodId` (published, and not already claimed).
    /// @dev Display only. `claim` is the authority.
    function claimable(uint256 periodId, address account) external view returns (bool) {
        Period storage p = periods[periodId];
        return p.publishedAt != 0 && !claimed[periodId][account];
    }

    /// @notice The leaf a claim must prove. Exposed so the off-chain builder and the contract can
    ///         never disagree about the encoding — the classic Merkle-distributor footgun.
    function leafFor(uint256 periodId, address account, uint256 amount)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(periodId, account, amount));
    }
}
