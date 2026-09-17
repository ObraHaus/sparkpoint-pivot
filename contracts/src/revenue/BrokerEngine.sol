// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { IBrokerNFT } from "./interfaces/IBrokerNFT.sol";
import { IUtilityToken } from "./interfaces/IUtilityToken.sol";
import { IBrokerVault } from "./interfaces/IBrokerVault.sol";

/// @title BrokerEngine
/// @notice The Sparky Broker earning system for the 4663 beta: activate / promote / fuse, and a
/// per-asset revenue accumulator delivered **AS-IS** ("what the protocol earns is what holders get")
/// — no swap, no conversion, no payout asset.
///
/// @dev Ported from the proven `robin-brokers-companion` CompanionEngine with the AS-IS settlement
/// change: the reference swaps the ETH pot into one registered payout asset through WETH and a
/// UniV3 route with a TWAP floor; here every received asset (ETH = `address(0)`, plus any registered
/// ERC-20) accrues in its own units and is delivered by straight transfer. There is no router, no
/// WETH, no TwapFloor, no per-broker splits and no `minSwap` — the whole conversion layer is gone.
///
/// Two money-in paths: `receive()` for ETH, and a permissionless `depositAsset(token, amount)` pull
/// for ERC-20s (the splitter routes ERC-20 revenue here).
///
/// **D1 — hold-to-earn without a transfer hook.** A broker earns only while the wallet that clocked
/// it in still holds it: `activator[id]` is recorded at clockIn and every verb / deliver batch
/// re-validates `nft.ownerOf(id)` (`_reconcileOwner`).
///
/// ⚠️ **The load-bearing correctness rule.** `_crystallise` credits on `weightOf[id]`, never on
/// `isActive`, so the only drop path (`_deactivate`) must **zero `weightOf`** — not merely subtract
/// from `totalWeight`. A half-drop lets a sold token keep accruing on stale weight into insolvency.
///
/// **No `block.number` anywhere** — every boundary keys on `block.timestamp`.
contract BrokerEngine is ReentrancyGuard, Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- wiring

    IBrokerNFT public nft;
    IUtilityToken public token;
    IBrokerVault public vault;
    address public owner;
    uint256 private _roundSeconds;
    uint256 private _startedAt;

    // ---------------------------------------------------------------- constants

    /// @dev Basis points of 1x = 100. Ceiling is 1215 (three fused Directors).
    uint256 public constant INTERN_WEIGHT = 100;
    uint256 public constant MANAGER_WEIGHT = 200;
    uint256 public constant DIRECTOR_WEIGHT = 300;

    uint8 public constant RANK_INTERN = 1;
    uint8 public constant RANK_MANAGER = 2;
    uint8 public constant RANK_DIRECTOR = 3;

    uint256 public constant FUSE_BONUS_TWO_BPS = 12_500; // +25%
    uint256 public constant FUSE_BONUS_THREE_BPS = 13_500; // +35%

    uint8 public constant MIN_FUSE_PARTS = 2;
    uint8 public constant MAX_FUSE_PARTS = 3;
    uint8 public constant PARTS_TWO = 2;
    uint8 public constant PARTS_THREE = 3;

    /// @dev ETH is `address(0)` throughout; the registry holds ERC-20s only.
    uint8 public constant MAX_ASSETS = 16;
    uint256 public constant MAX_DELIVER_BATCH = 80;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @dev Single-digit defaults (beta economics). Owner-settable.
    uint256 public constant DEFAULT_CLOCK_IN_BURN = 1;
    uint256 public constant DEFAULT_INTERN_BURN = 1;
    uint256 public constant DEFAULT_MANAGER_BURN = 2;
    uint256 public constant DEFAULT_DIRECTOR_BURN = 3;
    uint256 public constant DEFAULT_FUSE_BURN_TWO = 2;
    uint256 public constant DEFAULT_FUSE_BURN_THREE = 3;

    // ---------------------------------------------------------------- assets

    address[] private _assetList;
    mapping(address asset => bool registered) private _isAsset;

    // ---------------------------------------------------------------- accounting

    /// @notice Revenue received and not yet settled into the accumulator, per asset.
    mapping(address asset => uint256 amount) public pendingPot;
    /// @notice Per-weight accumulator, per asset. Advance-on-settle, claim in the same asset.
    mapping(address asset => uint256 acc) public accPerWeight;
    /// @notice The accumulator's value at the end of `round`, per asset (promotion boundaries).
    mapping(uint256 round => mapping(address asset => uint256 acc)) public accAtRound;
    uint256 public settledRound;

    uint256 public totalWeight;
    /// @dev A delta, not an absolute. An increase counts from the next round.
    uint256 public totalWeightNext;

    mapping(uint256 tokenId => uint256 weight) public weightOf;
    mapping(uint256 tokenId => uint256 weight) public pendingWeightOf;
    mapping(uint256 tokenId => uint256 round) public promoteAfterRoundOf;
    mapping(uint256 tokenId => mapping(address asset => uint256 acc)) public debtOf;
    /// @notice Banked, not yet delivered to the vault, per asset.
    mapping(uint256 tokenId => mapping(address asset => uint256 amount)) public owedOf;

    mapping(uint256 tokenId => bool active) public isActive;
    mapping(uint256 tokenId => address wallet) public activator;
    mapping(uint256 tokenId => uint8 rank) private _rank;
    mapping(uint256 tokenId => uint256 burned) public tierBurned;
    mapping(uint256 tokenId => uint8 count) public parts;
    mapping(uint256 tokenId => uint256 weight) public absorbedWeight;
    mapping(uint256 tokenId => uint32 marks) public fusedArt;

    // ---------------------------------------------------------------- prices

    uint256 public clockInBurn;
    uint256 public internBurn;
    uint256 public managerBurn;
    uint256 public directorBurn;
    uint256 public fuseBurnTwo;
    uint256 public fuseBurnThree;

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error ZeroAddress();
    error AssetAlreadyRegistered();
    error AssetNotRegistered();
    error BatchTooLarge();
    error VaultNotSet();
    error BadRoundLength();
    error RescueFailed();
    error TooManyAssets();
    error NotBrokerOwner();
    error TokenNotSet();
    error TokenAlreadySet();
    error AlreadyActive();
    error BadTier();
    error BadBurnOrder();
    error BadFuse();
    error AlreadyFused();
    error NothingToDeposit();

    // ---------------------------------------------------------------- events

    event RevenueReceived(address indexed from, address indexed asset, uint256 amount);
    event AssetAdded(address indexed asset);
    event AssetDeposited(address indexed asset, uint256 amount);
    event VaultSet(address indexed vault);
    event OwnershipRenounced();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event Settled(uint256 indexed round, address indexed asset, uint256 spend, uint256 acc);
    event RoundSkipped(uint256 indexed round, string reason);
    event RoundSecondsSet(uint256 roundSeconds);
    event Delivered(uint256 indexed tokenId, address indexed asset, uint256 amount);

    event ClockedIn(uint256 indexed tokenId, address indexed owner, uint256 burned);
    event ClockedOut(uint256 indexed tokenId, address indexed activator, bool salvagedToPot);
    event Promoted(uint256 indexed tokenId, uint8 rank, uint256 cumulativeBurn);
    event Fused(uint256 indexed survivor, uint256[] absorbed, uint8 parts, uint256 burned);
    event MergeFailed(uint256 indexed survivor, uint256 indexed absorbed, bytes reason);
    event WeightCached(uint256 indexed tokenId, uint256 held, uint256 newWeight, uint256 queued);
    event TokenSet(address indexed token);
    event ClockInBurnSet(uint256 previous, uint256 current);
    event RankBurnsSet(uint256 intern, uint256 manager, uint256 director);
    event FuseBurnsSet(uint256 two, uint256 three);

    // ---------------------------------------------------------------- construction

    constructor() {
        _disableInitializers();
    }

    /// @notice Wire the engine. `owner` is the caller (the proxy's creator). `token` and `vault` are
    /// wired afterwards — the token does not exist yet at engine deploy time, and the vault binds
    /// this engine.
    function initialize(address nft_, uint256 roundSeconds_) external initializer {
        if (nft_ == address(0)) revert ZeroAddress();
        if (roundSeconds_ == 0 || roundSeconds_ > type(uint32).max) revert BadRoundLength();

        nft = IBrokerNFT(nft_);
        _roundSeconds = roundSeconds_;
        _startedAt = block.timestamp;
        owner = msg.sender;

        clockInBurn = DEFAULT_CLOCK_IN_BURN;
        internBurn = DEFAULT_INTERN_BURN;
        managerBurn = DEFAULT_MANAGER_BURN;
        directorBurn = DEFAULT_DIRECTOR_BURN;
        fuseBurnTwo = DEFAULT_FUSE_BURN_TWO;
        fuseBurnThree = DEFAULT_FUSE_BURN_THREE;
    }

    function _authorizeUpgrade(address) internal override onlyOwner { }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------- revenue in

    /// @dev Records and nothing more, so the engine is cheap enough to be a revenue recipient.
    receive() external payable {
        pendingPot[address(0)] += msg.value;
        emit RevenueReceived(msg.sender, address(0), msg.value);
    }

    /// @notice Pull an ERC-20 into the revenue pot. **Anyone may call** — the funds go to brokers,
    /// not to the caller. The asset must be registered (owner-managed, bounded at `MAX_ASSETS`).
    function depositAsset(address asset, uint256 amount) external nonReentrant {
        if (asset == address(0) || !_isAsset[asset]) revert AssetNotRegistered();
        if (amount < 1) revert NothingToDeposit();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        pendingPot[asset] += amount;
        emit AssetDeposited(asset, amount);
    }

    // ---------------------------------------------------------------- rounds

    // solhint-disable-next-line func-name-mixedcase
    function ROUND() external view returns (uint256) {
        return _roundSeconds;
    }

    // solhint-disable-next-line func-name-mixedcase
    function START() external view returns (uint256) {
        return _startedAt;
    }

    /// @notice Change the round length (owner-only, UUPS-upgradeable engine — the port had no setter,
    /// matching the reference, so the beta would otherwise be stuck at its deploy-time 3600s grid).
    /// Narrow on purpose: the round grid is what `settle()` closes against, so raising the length can
    /// leave `currentRound()` below `settledRound` until the grid catches up — `settle()` no-ops in
    /// that window (no revert, no double-settle, no rewind of `settledRound`).
    function setRoundSeconds(uint256 roundSeconds_) external onlyOwner {
        if (roundSeconds_ == 0 || roundSeconds_ > type(uint32).max) revert BadRoundLength();
        _roundSeconds = roundSeconds_;
        emit RoundSecondsSet(roundSeconds_);
    }

    /// @notice How many rounds have fully elapsed. The highest round `settle()` can close.
    function currentRound() public view returns (uint256) {
        return (block.timestamp - _startedAt) / _roundSeconds;
    }

    /// @notice The round now accruing revenue. Always `currentRound() + 1`.
    /// @dev ⚠️ NOT the round an increase takes effect in. After a round-length increase the grid
    /// can rewind (`currentRound() < settledRound`) and this points at a round that is already
    /// closed — `_changeWeight` must key its boundary on `settledRound + 1` instead.
    function roundInProgress() public view returns (uint256) {
        return currentRound() + 1;
    }

    /// @notice Close every elapsed round, per asset. Callable by anyone. Ownership-blind by design.
    function settle() external nonReentrant {
        uint256 target = currentRound();
        uint256 round = settledRound;
        if (round >= target) return;

        uint256 count = _assetList.length;
        while (round < target) {
            ++round;

            if (totalWeight == 0) {
                emit RoundSkipped(round, "no active weight");
            } else {
                bool any;
                // ETH first, then the registry.
                uint256 potEth = pendingPot[address(0)];
                if (potEth != 0) {
                    pendingPot[address(0)] = 0;
                    accPerWeight[address(0)] += Math.mulDiv(potEth, WAD, totalWeight);
                    any = true;
                    emit Settled(round, address(0), potEth, accPerWeight[address(0)]);
                }
                for (uint256 i = 0; i < count; ++i) {
                    address asset = _assetList[i];
                    uint256 pot = pendingPot[asset];
                    if (pot == 0) continue;
                    pendingPot[asset] = 0;
                    accPerWeight[asset] += Math.mulDiv(pot, WAD, totalWeight);
                    any = true;
                    emit Settled(round, asset, pot, accPerWeight[asset]);
                }
                if (!any) emit RoundSkipped(round, "no revenue");
            }

            accAtRound[round][address(0)] = accPerWeight[address(0)];
            for (uint256 i = 0; i < count; ++i) {
                address asset = _assetList[i];
                accAtRound[round][asset] = accPerWeight[asset];
            }

            if (totalWeightNext != 0) {
                totalWeight += totalWeightNext;
                totalWeightNext = 0;
            }
        }

        settledRound = target;
    }

    // ---------------------------------------------------------------- delivery

    /// @notice Move earned credit into the vault, in batches. Callable by anyone.
    /// @dev A burned, absorbed or already-current id is skipped, never a revert. Straight transfers:
    /// each asset is delivered in the asset it was earned in.
    function deliver(uint256[] calldata ids) external nonReentrant {
        uint256 idCount = ids.length;
        if (idCount > MAX_DELIVER_BATCH) revert BatchTooLarge();
        IBrokerVault vault_ = vault;
        if (address(vault_) == address(0)) revert VaultNotSet();

        // State pass: reconcile + crystallise every id once.
        for (uint256 i = 0; i < idCount; ++i) {
            uint256 id = ids[i];
            _reconcileOwner(id);
            _crystallise(id);
        }

        // ETH pass: one value-bearing credit per id.
        for (uint256 i = 0; i < idCount; ++i) {
            uint256 id = ids[i];
            uint256 share = owedOf[id][address(0)];
            if (share == 0) continue;
            owedOf[id][address(0)] = 0;
            emit Delivered(id, address(0), share);
            vault_.creditEth{ value: share }(id);
        }

        // ERC-20 pass: credit each id, then one transfer per asset into the vault.
        uint256 count = _assetList.length;
        for (uint256 a = 0; a < count; ++a) {
            address asset = _assetList[a];
            uint256 moved = 0;
            for (uint256 i = 0; i < idCount; ++i) {
                uint256 id = ids[i];
                uint256 share = owedOf[id][asset];
                if (share == 0) continue;
                owedOf[id][asset] = 0;
                moved += share;
                emit Delivered(id, asset, share);
                vault_.credit(id, asset, share);
            }
            if (moved != 0) IERC20(asset).safeTransfer(address(vault_), moved);
        }
    }

    /// @notice Re-validate ownership for a batch and drop any broker that was sold or burned.
    /// Callable by anyone.
    function sync(uint256[] calldata ids) external nonReentrant {
        uint256 n = ids.length;
        for (uint256 i = 0; i < n; ++i) {
            _reconcileOwner(ids[i]);
        }
    }

    // ---------------------------------------------------------------- verbs

    /// @notice Put a broker to work. Burns `clockInBurn` tokens every time; only the first grants
    /// rank 1. Re-activation after a sale burns the price again.
    function clockIn(uint256 tokenId) external nonReentrant {
        _reconcileOwner(tokenId); // one-tx resume: drop a stale ghost before the AlreadyActive check
        if (address(token) == address(0)) revert TokenNotSet();
        _requireOwner(tokenId);
        if (isActive[tokenId]) revert AlreadyActive();

        _crystallise(tokenId); // inactive here → only advances debt, so the broker starts clean

        if (_rank[tokenId] == 0) {
            _rank[tokenId] = RANK_INTERN;
            tierBurned[tokenId] = internBurn;
        }
        isActive[tokenId] = true;
        activator[tokenId] = msg.sender;

        uint256 held = weightOf[tokenId]; // 0 for a fresh or dropped token
        uint256 w = deriveWeight(tokenId);
        totalWeight = totalWeight + w - Math.min(totalWeight, held);
        weightOf[tokenId] = w;

        uint256 fee = clockInBurn;
        if (fee != 0) token.burnFrom(msg.sender, fee);

        emit ClockedIn(tokenId, msg.sender, fee);
        emit WeightCached(tokenId, held, w, pendingWeightOf[tokenId]);
    }

    /// @notice Promote a broker to rank 2 or 3. An increase pays from the next round.
    function promote(uint256 tokenId, uint8 rank) external nonReentrant {
        _reconcileOwner(tokenId);
        if (address(token) == address(0)) revert TokenNotSet();
        _requireOwner(tokenId);
        if (rank < RANK_MANAGER || rank > RANK_DIRECTOR) revert BadTier();
        if (rank <= _rank[tokenId]) revert BadTier();

        uint256 target = rank == RANK_DIRECTOR ? directorBurn : managerBurn;
        uint256 paid = tierBurned[tokenId];
        uint256 due = target > paid ? target - paid : 0;

        // Effects: rank, credit, and the weight change — all before the burn, so no state is written
        // after an external call. `_changeWeight` crystallises at the old weight first.
        _rank[tokenId] = rank;
        if (target > paid) tierBurned[tokenId] = target;
        if (isActive[tokenId]) _changeWeight(tokenId, deriveWeight(tokenId));

        emit Promoted(tokenId, rank, tierBurned[tokenId]);

        // Interaction last.
        if (due != 0) token.burnFrom(msg.sender, due);
    }

    /// @notice Merge two or three of your own brokers. The first survives; the rest are burned and
    /// the collection permanently shrinks. Weights add, then a +25%/+35% bonus.
    /// @dev The caller must have granted this engine ERC-721 approval for each absorbed id so
    /// `nft.burn` can destroy it (approve-then-fuse).
    function fuse(uint256[] calldata ids) external nonReentrant {
        if (address(token) == address(0)) revert TokenNotSet();
        uint256 n = ids.length;
        if (n < MIN_FUSE_PARTS || n > MAX_FUSE_PARTS) revert BadFuse();

        uint256 survivor = ids[0];
        uint256 absorbedTotal = 0;

        for (uint256 i = 0; i < n; ++i) {
            uint256 id = ids[i];
            _reconcileOwner(id);
            _requireOwner(id);
            if (parts[id] != 0) revert AlreadyFused();
            for (uint256 j = i + 1; j < n; ++j) {
                if (ids[j] == id) revert BadFuse();
            }
            if (i > 0) absorbedTotal += rawWeight(id);
        }

        // ---- effects: every state change first, no external calls ----
        _crystallise(survivor);

        uint256 cost = n == MIN_FUSE_PARTS ? fuseBurnTwo : fuseBurnTwo + fuseBurnThree;
        uint8 partCount = n == MIN_FUSE_PARTS ? PARTS_TWO : PARTS_THREE;

        uint32 marks = 0;
        uint256[] memory absorbedIds = new uint256[](n - 1);

        for (uint256 i = 1; i < n; ++i) {
            uint256 dead = ids[i];
            absorbedIds[i - 1] = dead;

            // Crystallise-before-absorb: bank the dead broker's accrual, then carry it (per asset)
            // to the survivor. State only — the vault move and the clone burn come later.
            _dropForFuse(dead, survivor);

            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 mark = uint32(dead);
            // forge-lint: disable-next-line(unsafe-typecast)
            if (uint16(marks) == 0) marks |= mark;
            else marks |= mark << 16;
        }

        fusedArt[survivor] = marks;
        parts[survivor] = partCount;
        absorbedWeight[survivor] += absorbedTotal;
        // The fuser is the survivor's clocker now, so a later `_reconcileOwner` cannot drop it on a
        // stale activator. Refreshed even when inactive, harmlessly.
        activator[survivor] = msg.sender;

        if (isActive[survivor]) _changeWeight(survivor, deriveWeight(survivor));

        emit Fused(survivor, absorbedIds, partCount, cost);

        // ---- interactions: every external call last ----
        for (uint256 i = 1; i < n; ++i) {
            uint256 dead = ids[i];
            if (address(vault) != address(0)) {
                try vault.merge(dead, survivor) { }
                catch (bytes memory reason) {
                    emit MergeFailed(survivor, dead, reason);
                }
            }
            nft.burn(dead); // holder/approved-gated; the engine is approved
        }

        if (cost != 0) token.burnFrom(msg.sender, cost);
    }

    // ---------------------------------------------------------------- D1 internals

    /// @dev Reverts unless `msg.sender` currently owns the token. Kept in its own function so the
    /// external `ownerOf` read sits in a frame that writes no state.
    function _requireOwner(uint256 tokenId) private view {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotBrokerOwner();
    }

    /// @dev If the broker is active but its current owner is no longer the wallet that clocked it
    /// in, drop it. A transfer credits the ghost-window accrual to the token (rides to the buyer);
    /// a burn — where `ownerOf` reverts and there is no owner to pay — routes it to the pot.
    function _reconcileOwner(uint256 tokenId) private {
        if (!isActive[tokenId]) return;
        try nft.ownerOf(tokenId) returns (address holder) {
            if (holder != activator[tokenId]) _deactivate(tokenId, false);
        } catch {
            _deactivate(tokenId, true); // burned/gone: no owner to credit
        }
    }

    /// @dev The ONE drop path. Crystallise FIRST, then remove the weight AND zero `weightOf` — the
    /// zero is load-bearing. `salvageToPot` moves banked credit to the pot when there is no owner.
    function _deactivate(uint256 tokenId, bool salvageToPot) private {
        _crystallise(tokenId);

        if (salvageToPot) {
            uint256 count = _assetList.length;
            uint256 eth = owedOf[tokenId][address(0)];
            if (eth != 0) {
                owedOf[tokenId][address(0)] = 0;
                pendingPot[address(0)] += eth; // re-enters the accumulator for current holders
            }
            for (uint256 i = 0; i < count; ++i) {
                address asset = _assetList[i];
                uint256 amount = owedOf[tokenId][asset];
                if (amount == 0) continue;
                owedOf[tokenId][asset] = 0;
                pendingPot[asset] += amount;
            }
        }

        uint256 held = weightOf[tokenId];
        totalWeight -= Math.min(totalWeight, held);
        weightOf[tokenId] = 0;

        uint256 queued = pendingWeightOf[tokenId];
        if (queued != 0) {
            totalWeightNext -= Math.min(totalWeightNext, queued - held);
            pendingWeightOf[tokenId] = 0;
            promoteAfterRoundOf[tokenId] = 0;
        }

        address who = activator[tokenId];
        isActive[tokenId] = false;
        activator[tokenId] = address(0);
        emit ClockedOut(tokenId, who, salvageToPot);
    }

    /// @dev Fusion's absorbed-token drop: same weight removal as `_deactivate`, but the banked
    /// accrual is carried to the survivor rather than the pot.
    function _dropForFuse(uint256 tokenId, uint256 survivor) private {
        _crystallise(tokenId);

        uint256 count = _assetList.length;
        uint256 eth = owedOf[tokenId][address(0)];
        if (eth != 0) {
            owedOf[tokenId][address(0)] = 0;
            owedOf[survivor][address(0)] += eth;
        }
        for (uint256 i = 0; i < count; ++i) {
            address asset = _assetList[i];
            uint256 amount = owedOf[tokenId][asset];
            if (amount == 0) continue;
            owedOf[tokenId][asset] = 0;
            owedOf[survivor][asset] += amount;
        }

        uint256 held = weightOf[tokenId];
        totalWeight -= Math.min(totalWeight, held);
        weightOf[tokenId] = 0;

        uint256 queued = pendingWeightOf[tokenId];
        if (queued != 0) {
            totalWeightNext -= Math.min(totalWeightNext, queued - held);
            pendingWeightOf[tokenId] = 0;
            promoteAfterRoundOf[tokenId] = 0;
        }

        address who = activator[tokenId];
        bool wasActive = isActive[tokenId];
        isActive[tokenId] = false;
        activator[tokenId] = address(0);
        if (wasActive || eth != 0) emit ClockedOut(tokenId, who, false);
    }

    /// @dev A weight change while clocked in: an increase queues to the next round; a decrease is
    /// immediate. `totalWeightNext` holds a delta, not an absolute.
    function _changeWeight(uint256 tokenId, uint256 newWeight) private {
        _crystallise(tokenId);
        uint256 held = weightOf[tokenId];
        uint256 queued = pendingWeightOf[tokenId];
        uint256 contributed = queued == 0 ? 0 : queued - held;

        if (newWeight > held) {
            uint256 wanted = newWeight - held;
            totalWeightNext = totalWeightNext + wanted - Math.min(totalWeightNext, contributed);
            pendingWeightOf[tokenId] = newWeight;
            // ⚠️ The NEXT round to be CLOSED — never `roundInProgress()`, which after a
            // round-length increase points into the rewind window (`currentRound() <
            // settledRound`) at a round that is already closed. `_crystallise` resolves a
            // promotion at `accAtRound[boundary]`; a past boundary (whose accumulator predates
            // the revenue) makes the increase retroactive — the whole accumulator is then paid at
            // the queued weight even though `settle()` divided the pot by the old `totalWeight`,
            // and the engine can be made to owe more than it holds (found by the 4663 fork proof).
            promoteAfterRoundOf[tokenId] = settledRound + 1;
            emit WeightCached(tokenId, held, held, newWeight);
        } else if (newWeight < held) {
            totalWeight = totalWeight + newWeight - Math.min(totalWeight, held);
            weightOf[tokenId] = newWeight;
            if (queued != 0) {
                totalWeightNext -= Math.min(totalWeightNext, contributed);
                pendingWeightOf[tokenId] = 0;
                promoteAfterRoundOf[tokenId] = 0;
            }
            emit WeightCached(tokenId, held, newWeight, 0);
        }
    }

    /// @dev Bank everything owed at the weight that was actually earning, per asset; resolve a due
    /// promotion; move the debt clock forward. Guarded on `isActive`; the debt advances anyway so a
    /// later re-clockIn starts clean.
    function _crystallise(uint256 tokenId) private {
        if (!isActive[tokenId]) {
            _advanceDebts(tokenId);
            return;
        }

        uint256 held = weightOf[tokenId];
        uint256 queued = pendingWeightOf[tokenId];
        uint256 boundary = promoteAfterRoundOf[tokenId];
        bool promoted = queued != 0 && settledRound >= boundary;

        _crystalliseAsset(tokenId, address(0), held, queued, boundary, promoted);
        uint256 count = _assetList.length;
        for (uint256 i = 0; i < count; ++i) {
            _crystalliseAsset(tokenId, _assetList[i], held, queued, boundary, promoted);
        }

        if (promoted) {
            weightOf[tokenId] = queued;
            pendingWeightOf[tokenId] = 0;
            promoteAfterRoundOf[tokenId] = 0;
        }
    }

    function _crystalliseAsset(
        uint256 tokenId,
        address asset,
        uint256 held,
        uint256 queued,
        uint256 boundary,
        bool promoted
    ) private {
        uint256 acc = accPerWeight[asset];
        uint256 debt = debtOf[tokenId][asset];

        if (promoted) {
            uint256 accAtPromote = accAtRound[boundary][asset];
            if (accAtPromote < debt) accAtPromote = debt;
            if (accAtPromote > acc) accAtPromote = acc;

            uint256 due = Math.mulDiv(held, accAtPromote - debt, WAD)
                + Math.mulDiv(queued, acc - accAtPromote, WAD);
            if (due != 0) owedOf[tokenId][asset] += due;
        } else if (held != 0 && acc > debt) {
            owedOf[tokenId][asset] += Math.mulDiv(held, acc - debt, WAD);
        }

        debtOf[tokenId][asset] = acc;
    }

    /// @dev The read-only twin of `_crystalliseAsset`, for `earnedOf`.
    function _accruedAsset(uint256 tokenId, address asset) private view returns (uint256) {
        if (!isActive[tokenId]) return 0;
        uint256 acc = accPerWeight[asset];
        uint256 held = weightOf[tokenId];
        uint256 debt = debtOf[tokenId][asset];
        uint256 queued = pendingWeightOf[tokenId];
        uint256 boundary = promoteAfterRoundOf[tokenId];

        if (queued != 0 && settledRound >= boundary) {
            uint256 accAtPromote = accAtRound[boundary][asset];
            if (accAtPromote < debt) accAtPromote = debt;
            if (accAtPromote > acc) accAtPromote = acc;
            return Math.mulDiv(held, accAtPromote - debt, WAD)
                + Math.mulDiv(queued, acc - accAtPromote, WAD);
        }
        if (held == 0 || acc <= debt) return 0;
        return Math.mulDiv(held, acc - debt, WAD);
    }

    function _advanceDebts(uint256 tokenId) private {
        debtOf[tokenId][address(0)] = accPerWeight[address(0)];
        uint256 count = _assetList.length;
        for (uint256 i = 0; i < count; ++i) {
            address asset = _assetList[i];
            debtOf[tokenId][asset] = accPerWeight[asset];
        }
    }

    // ---------------------------------------------------------------- weight derivation

    /// @notice What a broker contributes when absorbed: rank weight plus anything it absorbed, no
    /// bonus of its own.
    function rawWeight(uint256 tokenId) public view returns (uint256) {
        uint8 rank = _rank[tokenId];
        if (rank == 0) return 0;
        uint256 w = rank == RANK_DIRECTOR
            ? DIRECTOR_WEIGHT
            : (rank == RANK_MANAGER ? MANAGER_WEIGHT : INTERN_WEIGHT);
        return w + absorbedWeight[tokenId];
    }

    /// @notice The rank-derived earning weight (raw + fuse bonus). Zero for an unranked broker.
    function deriveWeight(uint256 tokenId) public view returns (uint256 w) {
        w = rawWeight(tokenId);
        if (w == 0) return 0;
        uint8 p = parts[tokenId];
        uint256 bonusBps =
            p == PARTS_TWO ? FUSE_BONUS_TWO_BPS : (p == PARTS_THREE ? FUSE_BONUS_THREE_BPS : 0);
        if (bonusBps != 0) w = Math.mulDiv(w, bonusBps, BPS_DENOMINATOR);
    }

    /// @notice 0 none, 1 Analyst, 2 Associate, 3 Partner (reference names: Intern/Manager/Director).
    function rankOf(uint256 tokenId) public view returns (uint8) {
        return _rank[tokenId];
    }

    // ---------------------------------------------------------------- views

    /// @notice What a broker has earned and not yet had delivered, in `asset` — banked plus
    /// uncrystallised.
    function earnedOf(uint256 tokenId, address asset) external view returns (uint256) {
        return owedOf[tokenId][asset] + _accruedAsset(tokenId, asset);
    }

    /// @notice The registered ERC-20s. Native ETH is implicit (`address(0)`).
    function assets() external view returns (address[] memory) {
        return _assetList;
    }

    function isRegisteredAsset(address asset) external view returns (bool) {
        return _isAsset[asset];
    }

    // ---------------------------------------------------------------- owner admin

    /// @notice Register an ERC-20 revenue asset. Append-only, bounded, no route or tolerance — the
    /// AS-IS model needs neither.
    function addAsset(address asset) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        if (_isAsset[asset]) revert AssetAlreadyRegistered();
        if (_assetList.length >= MAX_ASSETS) revert TooManyAssets();
        _isAsset[asset] = true;
        _assetList.push(asset);
        emit AssetAdded(asset);
    }

    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = IBrokerVault(vault_);
        emit VaultSet(vault_);
    }

    /// @notice Wire the utility token. One-shot: a token without `burnFrom` would brick every verb
    /// with no way back, so it is set exactly once and `renounceOwnership` refuses while it is unset.
    function setToken(address token_) external onlyOwner {
        if (token_ == address(0)) revert ZeroAddress();
        if (address(token) != address(0)) revert TokenAlreadySet();
        token = IUtilityToken(token_);
        emit TokenSet(token_);
    }

    function setClockInBurn(uint256 burn) external onlyOwner {
        uint256 previous = clockInBurn;
        clockInBurn = burn;
        emit ClockInBurnSet(previous, burn);
    }

    /// @notice Set all three rank prices at once. Strictly increasing is the only rule; existing
    /// brokers are untouched because rank is stored, not derived.
    function setRankBurns(uint256 analyst, uint256 associate, uint256 partner) external onlyOwner {
        if (analyst >= associate || associate >= partner) revert BadBurnOrder();
        internBurn = analyst;
        managerBurn = associate;
        directorBurn = partner;
        emit RankBurnsSet(analyst, associate, partner);
    }

    function setFuseBurns(uint256 two, uint256 three) external onlyOwner {
        fuseBurnTwo = two;
        fuseBurnThree = three;
        emit FuseBurnsSet(two, three);
    }

    /// @notice End ownership. Refuses while the token is unwired, so the key that must spend the
    /// one-shot `setToken` cannot be discarded before it does.
    function renounceOwnership() external onlyOwner {
        if (address(token) == address(0)) revert TokenNotSet();
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
        emit OwnershipRenounced();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Recover native value. Ships with the contract (non-custody constitution).
    function rescueEth(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert RescueFailed();
    }

    function rescueToken(address token_, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token_).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- storage gap

    /// @dev Reserved so new variables are appended, never inserted.
    uint256[50] private __gap;
}
