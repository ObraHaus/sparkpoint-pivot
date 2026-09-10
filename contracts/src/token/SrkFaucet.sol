// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SrkFaucet — a standalone, pre-funded dispenser for the testnet SRK utility token.
/// @notice Testers need SRK to try the Premium purchase flow. `SparkPointTestToken` has a FIXED
///         supply, no mint function and no owner (a spec-012 property with a fuzz test asserting it),
///         so the faucet can never be part of the token. This contract instead holds a
///         hand-transferred float of already-minted SRK and hands it out `claimAmount` at a time,
///         once per address per `cooldown`.
///
///         It is deliberately a plain dispenser: it can only ever move the SRK that was deposited
///         into it, it holds no user funds, and it has no bearing on the vault / chat / withdraw
///         paths (Constitution V — SRK is non-essential to every core capability).
///
/// @dev Parameter administration is intentionally split:
///        - `owner` (the deployer) can withdraw the float, grant/revoke admins and hand over ownership;
///        - `owner` OR any `admin` can retune `claimAmount` / `cooldown`.
///      The SparkPoint agent is provably KEYLESS and can never sign, so "admin-editable from the ops
///      panel" means the connected admin WALLET signs these setters from `/admin/faucet` — the
///      backend is not in the trust path at all.
contract SrkFaucet {
    using SafeERC20 for IERC20;

    /// @notice The dispensed token (the testnet SRK ERC-20). Immutable — a faucet never re-points.
    IERC20 public immutable token;

    /// @notice Upper bound on `cooldown`, so a fat-fingered value can't brick the faucet for years.
    uint256 public constant MAX_COOLDOWN = 365 days;

    /// @notice Can withdraw the float, manage admins and transfer ownership.
    address public owner;

    /// @notice SRK handed out per successful `claim()`. Setting it to 0 PAUSES claims.
    uint256 public claimAmount;

    /// @notice Minimum seconds between two claims by the same address.
    uint256 public cooldown;

    /// @notice Addresses allowed to retune `claimAmount` / `cooldown` (the owner always may too).
    mapping(address => bool) public admins;

    /// @notice Unix timestamp of an address's last successful claim (0 = never claimed).
    mapping(address => uint256) public lastClaimAt;

    error NotOwner(address caller);
    error NotAdmin(address caller);
    error ZeroAddress();
    error FaucetPaused();
    error CooldownTooLong(uint256 requested, uint256 max);
    /// @dev Names the wait explicitly so the UI can render an honest countdown from the revert data.
    error CooldownActive(uint256 availableAt, uint256 secondsRemaining);
    error InsufficientFloat(uint256 available, uint256 requested);

    event Claimed(address indexed claimant, uint256 amount, uint256 nextClaimAt);
    event ClaimAmountSet(address indexed by, uint256 previousAmount, uint256 newAmount);
    event CooldownSet(address indexed by, uint256 previousCooldown, uint256 newCooldown);
    event AdminSet(address indexed by, address indexed admin, bool allowed);
    event Withdrawn(address indexed by, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @dev Owner-or-admin. Kept separate from `onlyOwner` so param tuning can be delegated to the
    ///      client's demo admin wallet without also delegating the float.
    modifier onlyAdmin() {
        if (msg.sender != owner && !admins[msg.sender]) revert NotAdmin(msg.sender);
        _;
    }

    /// @param token_ The SRK ERC-20 this faucet dispenses.
    /// @param claimAmount_ SRK per claim, in base units (18 dp).
    /// @param cooldown_ Seconds an address must wait between claims.
    /// @param initialAdmins Addresses seeded into `admins` (the deployer is owner and needs no entry).
    constructor(
        address token_,
        uint256 claimAmount_,
        uint256 cooldown_,
        address[] memory initialAdmins
    ) {
        if (token_ == address(0)) revert ZeroAddress();
        if (cooldown_ > MAX_COOLDOWN) revert CooldownTooLong(cooldown_, MAX_COOLDOWN);

        token = IERC20(token_);
        owner = msg.sender;
        claimAmount = claimAmount_;
        cooldown = cooldown_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit ClaimAmountSet(msg.sender, 0, claimAmount_);
        emit CooldownSet(msg.sender, 0, cooldown_);

        for (uint256 i = 0; i < initialAdmins.length; i++) {
            address a = initialAdmins[i];
            if (a == address(0)) revert ZeroAddress();
            admins[a] = true;
            emit AdminSet(msg.sender, a, true);
        }
    }

    /* --------------------------------- claiming --------------------------------- */

    /// @notice Send `claimAmount` SRK to the caller, once per `cooldown`.
    /// @dev State is written BEFORE the transfer, so even a hostile token can't re-enter for a
    ///      second payout within the cooldown.
    function claim() external returns (uint256 amount) {
        amount = claimAmount;
        if (amount == 0) revert FaucetPaused();

        uint256 availableAt = nextClaimAt(msg.sender);
        if (block.timestamp < availableAt) {
            revert CooldownActive(availableAt, availableAt - block.timestamp);
        }

        // Effect written BEFORE any token interaction — including the balance view — so the strict
        // checks-effects-interactions order holds and static analysis (aderyn) sees no state write
        // after an external call. Behaviour is unchanged: an insufficient-float revert below rolls
        // this write back, exactly as when it sat after the check.
        lastClaimAt[msg.sender] = block.timestamp;

        uint256 float_ = token.balanceOf(address(this));
        if (float_ < amount) revert InsufficientFloat(float_, amount);

        token.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount, block.timestamp + cooldown);
    }

    /* ----------------------------------- views ----------------------------------- */

    /// @notice The SRK float this faucet can still hand out.
    function available() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice How many more claims the current float covers at the current `claimAmount`.
    function claimsRemaining() external view returns (uint256) {
        uint256 amount = claimAmount;
        if (amount == 0) return 0;
        return available() / amount;
    }

    /// @notice Earliest timestamp at which `claimant` may claim again (0 = has never claimed).
    function nextClaimAt(address claimant) public view returns (uint256) {
        uint256 last = lastClaimAt[claimant];
        if (last == 0) return 0;
        return last + cooldown;
    }

    /// @notice Seconds `claimant` must still wait; 0 when they can claim now.
    function secondsUntilClaim(address claimant) external view returns (uint256) {
        uint256 at = nextClaimAt(claimant);
        return block.timestamp >= at ? 0 : at - block.timestamp;
    }

    /// @notice True when `claimant` would succeed right now (not paused, off cooldown, float covers it).
    function canClaim(address claimant) external view returns (bool) {
        uint256 amount = claimAmount;
        if (amount == 0) return false;
        if (block.timestamp < nextClaimAt(claimant)) return false;
        return available() >= amount;
    }

    /// @notice Whether `account` may retune the faucet parameters (owner counts as an admin).
    function isAdmin(address account) external view returns (bool) {
        return account == owner || admins[account];
    }

    /* --------------------------------- parameters -------------------------------- */

    /// @notice Set the per-claim amount (base units). `0` pauses claiming without moving the float.
    function setClaimAmount(uint256 newAmount) external onlyAdmin {
        uint256 previous = claimAmount;
        claimAmount = newAmount;
        emit ClaimAmountSet(msg.sender, previous, newAmount);
    }

    /// @notice Set the per-address cooldown in seconds.
    function setCooldown(uint256 newCooldown) external onlyAdmin {
        if (newCooldown > MAX_COOLDOWN) revert CooldownTooLong(newCooldown, MAX_COOLDOWN);
        uint256 previous = cooldown;
        cooldown = newCooldown;
        emit CooldownSet(msg.sender, previous, newCooldown);
    }

    /* ---------------------------------- ownership --------------------------------- */

    /// @notice Grant or revoke a parameter admin.
    function setAdmin(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        admins[account] = allowed;
        emit AdminSet(msg.sender, account, allowed);
    }

    /// @notice Move ownership (float withdrawal + admin management) to `newOwner`.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /// @notice Withdraw part of the remaining float. `amount == 0` withdraws all of it.
    function withdraw(address to, uint256 amount) external onlyOwner returns (uint256 sent) {
        if (to == address(0)) revert ZeroAddress();
        uint256 float_ = available();
        sent = amount == 0 ? float_ : amount;
        if (sent > float_) revert InsufficientFloat(float_, sent);

        token.safeTransfer(to, sent);
        emit Withdrawn(msg.sender, to, sent);
    }
}
