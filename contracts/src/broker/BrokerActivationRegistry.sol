// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The minimum of `SparkyBroker` this registry needs. The collection lives in its own repo
///         (`ObraHaus/sparkpoint-sparky-broker`) and is already deployed; nothing here may change it.
interface ISparkyBroker {
    function ownerOf(uint256 id) external view returns (address);
    function activatedAt(uint256 id) external view returns (uint64);
    function activate(uint256 id) external;
}

/// @title BrokerActivationRegistry — retire SRK, activate a Sparky Broker, in one transaction.
/// @notice A holder who owns an unactivated broker calls `activate`. In the same transaction their
///         SRK leaves for an address nobody controls and the broker's activation flips. This
///         contract becomes the NFT's `activator` — the role deliberately left unset at deploy.
///
///         **Why a same-chain registry at all.** A transaction touches one chain, so the SRK a
///         broker retires has to live on the broker's chain or activation cannot be atomic. The
///         alternative — proving a settled transfer off-chain and activating with a backend key —
///         needs a hot key AND a repair path, because a burn landing while the backend is down
///         leaves a holder who has paid and is not activated. Feature 043 phase 1 deployed SRK on
///         Robinhood testnet precisely so that alternative is not needed.
///
///         **Non-custody (N1/N5).** This contract never holds a broker, never holds retired SRK,
///         and takes no approval it does not spend in the same call. There is deliberately no
///         `withdraw`, `sweep`, `rescue` or `recoverERC20` — for SRK, for brokers, or for ETH — and
///         no `payable` function anywhere, so nothing can be sent here and nothing can be stranded.
///         (The `locked-ether` finding the scanners raised against the NFT is the precedent: solady
///         marks some ERC-721 paths `payable`, and ETH with no way out is a real defect.)
///
/// @dev "Retired", not "burned". `SparkPointTestToken` has a fixed supply and **no burn function**
///      (verified on the deployed testnet token: the `burn(uint256)` selector is absent from its
///      bytecode), so the SRK is moved out of circulation to a dead address rather than destroyed.
///      Total supply is unchanged by an activation — there is a fuzz test asserting exactly that —
///      so no surface may describe this as reducing supply.
contract BrokerActivationRegistry is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice The Sparky Broker collection. Immutable — a registry never re-points at another one.
    ISparkyBroker public immutable broker;

    /// @notice The SRK retired on activation. Immutable.
    IERC20 public immutable srk;

    /// @notice Where retired SRK goes. Immutable, and NOT `address(0)`: a standard ERC-20 `transfer`
    ///         to the zero address reverts, so it is not available even if it were preferable.
    ///         Holding the SRK here instead would make it treasury, not a retirement.
    address public immutable deadAddress;

    /// @notice The ceiling `price` can never exceed, fixed at deployment. The mainnet number does
    ///         not exist yet, so an immutable price would force a redeploy to discover it — but an
    ///         unbounded mutable one lets a careless or compromised owner charge anything. This is
    ///         the bound on that.
    uint256 public immutable maxPrice;

    /// @notice SRK retired per activation. The only mutable parameter, and it is capped.
    uint256 public price;

    /// @dev Every token a wallet has activated THROUGH THIS REGISTRY.
    ///
    ///      This is the candidate set that makes NFT-derived Premium answerable without an indexer.
    ///      `SparkyBroker` is solady ERC-721 and is NOT enumerable, so nothing can list a wallet's
    ///      tokens. But minting never activates and `_afterTokenTransfer` clears activation on every
    ///      real transfer, so **a wallet can only hold an activated broker it activated itself** —
    ///      which makes this list a complete superset of that wallet's activated brokers.
    ///
    ///      ⚠️ It is a HINT, never the authority. This contract cannot observe a transfer (it is not
    ///      the NFT), so the list is allowed to name tokens the wallet no longer owns. Every reader
    ///      MUST narrow it with a live `ownerOf` + `activatedAt`. Adding a hook to prune it would
    ///      mean a second path touching activation, which the collection's rules forbid outright.
    mapping(address => uint256[]) private _activations;

    /// @dev Which tokens a wallet already has in `_activations`, so a re-activation does not append
    ///      a duplicate.
    ///
    ///      ⚠️ This is NOT cosmetic. A broker can be activated, sold, reacquired and activated again
    ///      — that is the product rule, not an edge case — and without this the same id is pushed
    ///      every time. Readers scan a BOUNDED prefix of this list (the agent's gate caps at 32), so
    ///      enough duplicates could push a genuinely-activated broker out of range and answer "no
    ///      premium" for a holder who is entitled to it. Found by the live verification on 46630,
    ///      where `activationsBy` came back `[3, 3]`.
    mapping(address => mapping(uint256 => bool)) private _recorded;

    event Activated(address indexed holder, uint256 indexed tokenId, uint256 srkRetired);
    event PriceSet(uint256 previousPrice, uint256 newPrice);

    error NotBrokerOwner(uint256 tokenId, address owner, address caller);
    error AlreadyActivated(uint256 tokenId);
    error PriceAboveCap(uint256 requested, uint256 cap);
    error ZeroAddress();
    error ZeroMaxPrice();

    /// @param broker_ the deployed `SparkyBroker`
    /// @param srk_ the SRK retired on activation, on the SAME chain as `broker_`
    /// @param deadAddress_ where retired SRK goes; must not be zero (ERC-20 transfers there revert)
    /// @param maxPrice_ the permanent ceiling on `price`
    /// @param initialPrice_ the starting price; must be at or below `maxPrice_`
    constructor(
        address broker_,
        address srk_,
        address deadAddress_,
        uint256 maxPrice_,
        uint256 initialPrice_
    ) Ownable(msg.sender) {
        if (broker_ == address(0) || srk_ == address(0) || deadAddress_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxPrice_ == 0) revert ZeroMaxPrice();
        if (initialPrice_ > maxPrice_) revert PriceAboveCap(initialPrice_, maxPrice_);

        broker = ISparkyBroker(broker_);
        srk = IERC20(srk_);
        deadAddress = deadAddress_;
        maxPrice = maxPrice_;
        price = initialPrice_;
        emit PriceSet(0, initialPrice_);
    }

    /// @notice Retire `price()` SRK and activate a broker you own, atomically.
    /// @dev Atomicity is the EVM's, not ours: any revert below reverts the SRK movement with it, so
    ///      there is no state in which SRK has left the holder and the broker is not activated. That
    ///      is why this ordering is safe and why no compensating path exists.
    ///
    ///      The ownership check reads the NFT rather than trusting a caller-supplied address, and
    ///      the price is read ONCE into a local so a single call can never charge two different
    ///      amounts.
    function activate(uint256 tokenId) external {
        address holder = broker.ownerOf(tokenId);
        if (holder != msg.sender) revert NotBrokerOwner(tokenId, holder, msg.sender);
        if (broker.activatedAt(tokenId) != 0) revert AlreadyActivated(tokenId);

        uint256 amount = price;

        // Effects on our own state first, then the two external calls. Neither callee is
        // attacker-controlled (both immutable, both ours), and a re-entrant `activate` for the same
        // token would revert on `AlreadyActivated` anyway once the NFT is flipped.
        if (!_recorded[msg.sender][tokenId]) {
            _recorded[msg.sender][tokenId] = true;
            _activations[msg.sender].push(tokenId);
        }

        if (amount != 0) {
            // Straight from the holder to the dead address — this contract is never the holder of
            // retired SRK, not even for one instruction.
            srk.safeTransferFrom(msg.sender, deadAddress, amount);
        }
        broker.activate(tokenId);

        emit Activated(msg.sender, tokenId, amount);
    }

    /// @notice Every DISTINCT token this wallet has activated through this registry.
    /// @dev A HINT, not the authority — see `_activations`. Narrow it with a live `ownerOf` +
    ///      `activatedAt` before treating any entry as an entitlement. Duplicate-free, so the list
    ///      is bounded by how many different brokers the wallet has activated, not by how many times.
    function activationsBy(address holder) external view returns (uint256[] memory) {
        return _activations[holder];
    }

    /// @notice How many activations this wallet has made. Cheaper than fetching the whole array.
    function activationCountBy(address holder) external view returns (uint256) {
        return _activations[holder].length;
    }

    /// @notice Retune the activation price, up to the immutable `maxPrice`.
    /// @dev Owner-only and capped. The app reads `price()` at the point of signing, so a holder can
    ///      never be charged more than the amount they were shown.
    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice > maxPrice) revert PriceAboveCap(newPrice, maxPrice);
        uint256 previous = price;
        price = newPrice;
        emit PriceSet(previous, newPrice);
    }
}
