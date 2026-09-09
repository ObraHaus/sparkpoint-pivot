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
/// @notice A holder who owns an unactivated broker calls `activate` and picks a TIER. In the same
///         transaction their SRK leaves for an address nobody controls and the broker's activation
///         flips. This contract becomes the NFT's `activator` — the role deliberately left unset at
///         deploy.
///
///         **Every tier grants exactly the same Premium.** A higher tier buys only a larger
///         `weightBps`, which is recorded here for a future revenue share.
///
/// @dev ⚠️⚠️ **REVENUE SHARING IS NOT BUILT.** No contract in this repo pays anything out, and there
///      is no epoch, pot, or claim path anywhere. `weightBps` is a number this contract writes down
///      and nothing currently reads for money. Until a payout mechanism exists and is deployed,
///      **a higher tier buys a holder nothing they can use today**, and every surface that offers the
///      choice MUST say so in those terms. Recording a weight is honest; implying it pays is not.
///
///         **Non-custody (N1/N5).** This contract never holds a broker, never holds retired SRK, and
///         takes no approval it does not spend in the same call. There is deliberately no
///         `withdraw`, `sweep`, `rescue` or `recoverERC20` — for SRK, for brokers, or for ETH — and
///         no `payable` function anywhere, so nothing can be sent here and nothing can be stranded.
///
/// @dev "Retired", not "burned". `SparkPointTestToken` has a fixed supply and **no burn function**
///      (verified on the deployed testnet token: the `burn(uint256)` selector is absent from its
///      bytecode), so the SRK is moved out of circulation to a dead address rather than destroyed.
///      Total supply is unchanged by an activation — there is a fuzz test asserting exactly that.
contract BrokerActivationRegistry is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice Tier ids. `0` is not a tier — it means "no activation recorded here".
    uint8 public constant TIER_ANALYST = 1;
    uint8 public constant TIER_ASSOCIATE = 2;
    uint8 public constant TIER_PARTNER = 3;
    uint8 public constant TIER_COUNT = 3;

    /// @notice Weights are basis points of 1.0×, so 3.3× is expressible: 10000 / 20000 / 33000.
    ///         A plain integer multiplier could not hold 3.3 and would have silently become 3.
    uint32 public constant WEIGHT_ONE = 10_000;

    struct TierConfig {
        /// @notice SRK retired to activate at this tier. `0` disables the tier.
        uint256 price;
        /// @notice Payout weight in basis points of 1.0×. Recorded only; nothing pays out yet.
        uint32 weightBps;
    }

    /// @notice The Sparky Broker collection. Immutable — a registry never re-points at another one.
    ISparkyBroker public immutable broker;

    /// @notice The SRK retired on activation. Immutable.
    IERC20 public immutable srk;

    /// @notice Where retired SRK goes. Immutable, and NOT `address(0)`: a standard ERC-20 `transfer`
    ///         to the zero address reverts, so it is not available even if it were preferable.
    address public immutable deadAddress;

    /// @notice The ceiling ANY tier's price can reach, fixed at deployment. The mainnet numbers do
    ///         not exist yet, so immutable prices would force a redeploy to discover them — but an
    ///         unbounded mutable price lets a careless or compromised owner charge anything.
    uint256 public immutable maxPrice;

    /// @notice tier id (1..3) → its price and weight.
    mapping(uint8 => TierConfig) public tiers;

    /// @dev tokenId → the tier it was last activated at through THIS registry.
    ///
    ///      ⚠️ RAW and possibly STALE. This contract cannot observe a transfer (it is not the NFT),
    ///      and a transfer CLEARS the activation on the NFT while leaving this entry untouched. Use
    ///      `weightOf` / `activeTierOf`, which check the chain, rather than reading this directly.
    mapping(uint256 => uint8) private _tierOf;

    /// @dev Every token a wallet has activated THROUGH THIS REGISTRY — the candidate set that makes
    ///      NFT-derived Premium answerable without an indexer. `SparkyBroker` is solady ERC-721 and
    ///      is NOT enumerable, but minting never activates and `_afterTokenTransfer` clears
    ///      activation on every real transfer, so **a wallet can only hold an activated broker it
    ///      activated itself** — which makes this list a complete superset.
    ///
    ///      ⚠️ A HINT, never the authority. Narrow it with a live `ownerOf` + `activatedAt`.
    mapping(address => uint256[]) private _activations;

    /// @dev Which tokens a wallet already has in `_activations`, so a re-activation does not append
    ///      a duplicate. Readers scan a BOUNDED prefix, so duplicates could push a genuinely
    ///      activated broker out of range and answer "no premium" to a holder entitled to it.
    mapping(address => mapping(uint256 => bool)) private _recorded;

    event Activated(
        address indexed holder,
        uint256 indexed tokenId,
        uint8 tier,
        uint256 srkRetired,
        uint32 weightBps
    );
    event TierSet(uint8 indexed tier, uint256 price, uint32 weightBps);

    error NotBrokerOwner(uint256 tokenId, address owner, address caller);
    error AlreadyActivated(uint256 tokenId);
    error PriceAboveCap(uint256 requested, uint256 cap);
    error UnknownTier(uint8 tier);
    error TierDisabled(uint8 tier);
    error ZeroAddress();
    error ZeroMaxPrice();
    error ZeroWeight();

    /// @param broker_ the deployed `SparkyBroker`
    /// @param srk_ the SRK retired on activation, on the SAME chain as `broker_`
    /// @param deadAddress_ where retired SRK goes; must not be zero (ERC-20 transfers there revert)
    /// @param maxPrice_ the permanent ceiling on every tier's price
    /// @param prices_ the three tier prices, Analyst→Partner
    /// @param weights_ the three tier weights in bps, Analyst→Partner
    constructor(
        address broker_,
        address srk_,
        address deadAddress_,
        uint256 maxPrice_,
        uint256[TIER_COUNT] memory prices_,
        uint32[TIER_COUNT] memory weights_
    ) Ownable(msg.sender) {
        if (broker_ == address(0) || srk_ == address(0) || deadAddress_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxPrice_ == 0) revert ZeroMaxPrice();

        broker = ISparkyBroker(broker_);
        srk = IERC20(srk_);
        deadAddress = deadAddress_;
        maxPrice = maxPrice_;

        for (uint8 i = 0; i < TIER_COUNT; i++) {
            uint8 tier = i + 1;
            _setTier(tier, prices_[i], weights_[i]);
        }
    }

    /// @notice Retire this tier's SRK and activate a broker you own, atomically.
    /// @param tokenId the broker to activate — you must own it, and it must not be activated
    /// @param tier 1 = Analyst, 2 = Associate, 3 = Partner. **All three grant identical Premium.**
    /// @dev Atomicity is the EVM's, not ours: any revert below reverts the SRK movement with it, so
    ///      there is no state in which SRK has left the holder and the broker is not activated.
    function activate(uint256 tokenId, uint8 tier) external {
        TierConfig memory cfg = _requireTier(tier);

        address holder = broker.ownerOf(tokenId);
        if (holder != msg.sender) revert NotBrokerOwner(tokenId, holder, msg.sender);
        if (broker.activatedAt(tokenId) != 0) revert AlreadyActivated(tokenId);

        // Effects on our own state first. Neither callee is attacker-controlled (both immutable,
        // both ours), and a re-entrant `activate` for the same token reverts on `AlreadyActivated`
        // once the NFT is flipped.
        _tierOf[tokenId] = tier;
        if (!_recorded[msg.sender][tokenId]) {
            _recorded[msg.sender][tokenId] = true;
            _activations[msg.sender].push(tokenId);
        }

        if (cfg.price != 0) {
            // Straight from the holder to the dead address — this contract is never the holder of
            // retired SRK, not even for one instruction.
            srk.safeTransferFrom(msg.sender, deadAddress, cfg.price);
        }
        broker.activate(tokenId);

        emit Activated(msg.sender, tokenId, tier, cfg.price, cfg.weightBps);
    }

    /// @notice The tier a broker is CURRENTLY activated at, or 0 if it is not activated.
    /// @dev Checks the chain rather than trusting `_tierOf`, so a transfer — which clears the
    ///      activation on the NFT and cannot be observed here — correctly reads as 0. Safe by
    ///      construction rather than by documentation.
    function activeTierOf(uint256 tokenId) public view returns (uint8) {
        if (broker.activatedAt(tokenId) == 0) return 0;
        return _tierOf[tokenId];
    }

    /// @notice The payout weight a broker currently carries, in bps of 1.0×; 0 when not activated.
    /// @dev ⚠️ Recorded for a future revenue share that **does not exist**. Nothing reads this for
    ///      money today. Do not present it to a holder as income.
    function weightOf(uint256 tokenId) external view returns (uint32) {
        uint8 tier = activeTierOf(tokenId);
        return tier == 0 ? 0 : tiers[tier].weightBps;
    }

    /// @notice Every token this wallet has activated through this registry.
    /// @dev A HINT, not the authority. Narrow it with a live `ownerOf` + `activatedAt`.
    function activationsBy(address holder) external view returns (uint256[] memory) {
        return _activations[holder];
    }

    function activationCountBy(address holder) external view returns (uint256) {
        return _activations[holder].length;
    }

    /// @notice Read a tier's price and weight in one call, for the confirm screen.
    function tierConfig(uint8 tier) external view returns (uint256 price, uint32 weightBps) {
        TierConfig memory cfg = tiers[tier];
        return (cfg.price, cfg.weightBps);
    }

    /// @notice Retune a tier. Price is capped by the immutable `maxPrice`.
    /// @dev The app reads the tier's price at the point of signing, so a holder can never be charged
    ///      more than the amount they were shown.
    function setTier(uint8 tier, uint256 price, uint32 weightBps) external onlyOwner {
        _setTier(tier, price, weightBps);
    }

    function _setTier(uint8 tier, uint256 price, uint32 weightBps) private {
        if (tier == 0 || tier > TIER_COUNT) revert UnknownTier(tier);
        if (price > maxPrice) revert PriceAboveCap(price, maxPrice);
        if (weightBps == 0) revert ZeroWeight();
        tiers[tier] = TierConfig({ price: price, weightBps: weightBps });
        emit TierSet(tier, price, weightBps);
    }

    function _requireTier(uint8 tier) private view returns (TierConfig memory cfg) {
        if (tier == 0 || tier > TIER_COUNT) revert UnknownTier(tier);
        cfg = tiers[tier];
        // A zero price is how the owner retires a tier. It must not silently become a free
        // activation at that tier's weight.
        if (cfg.price == 0) revert TierDisabled(tier);
    }
}
