// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { IBrokerVault } from "./interfaces/IBrokerVault.sol";
import { IBrokerNFT } from "./interfaces/IBrokerNFT.sol";

/// @title BrokerVault
/// @notice Holds what a broker has earned, keyed by **token id**, so the value rides a resale.
///
/// @dev Multi-asset, AS-IS: **`asset == address(0)` means native ETH**; anything else is an ERC-20.
/// The engine delivers each fee asset straight through — no swap, no conversion.
///
/// This contract has **no owner, no fee parameter, no upgrade path and no rescue function**, and
/// that is deliberate: its only job is to hold what belongs to a token id, and any path that could
/// move value elsewhere would defeat it. Nothing may be added here that could take value out to
/// anyone but the current owner of the token.
///
/// ⚠️ Deployed **immutable** (not a proxy), matching the reference implementation and the
/// constitution's "value-bearing contracts stay immutable" rule.
contract BrokerVault is IBrokerVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- immutable wiring

    IBrokerNFT public immutable nft;
    address public immutable engine;

    /// @dev Computed at construction, so a withdrawal signature made against one chain cannot be
    /// replayed on another even where the same code runs.
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant _WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(uint256 tokenId,address[] assets,address to,uint256 nonce,uint256 deadline)"
    );

    // ---------------------------------------------------------------- state

    mapping(uint256 tokenId => mapping(address asset => uint256 amount)) private _balance;

    /// @dev The vault's **own** record of which assets a token holds. `merge` walks this rather
    /// than a caller-supplied list: a stale or wrong list is exactly how value gets stranded, and
    /// the vault is in a position to know the truth, so it does not ask.
    ///
    /// A global append-only asset list plus a **per-token bitmap** — one storage write per broker on
    /// first credit instead of three. `address(0)` (ETH) participates like any other asset.
    address[] private _knownAssets;
    /// @dev 1-based; 0 means "not seen yet".
    mapping(address asset => uint256 index) private _assetIndex;
    mapping(uint256 tokenId => uint256 mask) private _heldMask;

    /// @dev Per-token, not per-owner: a signature authorises a withdrawal from a broker, and the
    /// broker is what may change hands.
    mapping(uint256 tokenId => uint256 nonce) public nonces;

    // ---------------------------------------------------------------- errors & events

    error NotEngine();
    error NotOwner();
    error NothingToWithdraw();
    error SignatureExpired();
    error InvalidSignature();
    error SameToken();
    error TooManyAssets();
    error UseCreditEth();

    event Credited(uint256 indexed tokenId, address indexed asset, uint256 amount);
    event Withdrawn(
        uint256 indexed tokenId, address indexed to, address indexed asset, uint256 amount
    );
    event Merged(uint256 indexed from, uint256 indexed to, uint256 assetCount);

    // ---------------------------------------------------------------- construction

    constructor(address nft_, address engine_) {
        if (nft_ == address(0) || engine_ == address(0)) revert NotEngine();
        nft = IBrokerNFT(nft_);
        engine = engine_;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("SparkyBrokerVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    // ---------------------------------------------------------------- engine surface

    /// @inheritdoc IBrokerVault
    function credit(uint256 tokenId, address asset, uint256 amount) external override onlyEngine {
        if (amount < 1) return;
        if (asset == address(0)) revert UseCreditEth(); // ETH must arrive via creditEth
        _remember(tokenId, asset);
        _balance[tokenId][asset] += amount;
        emit Credited(tokenId, asset, amount);
    }

    /// @inheritdoc IBrokerVault
    function creditEth(uint256 tokenId) external payable override onlyEngine {
        uint256 amount = msg.value;
        if (amount < 1) return;
        _remember(tokenId, address(0));
        _balance[tokenId][address(0)] += amount;
        emit Credited(tokenId, address(0), amount);
    }

    /// @inheritdoc IBrokerVault
    /// @dev Called on every fusion from the engine, which wraps it in `try`/`catch` because a
    /// revert here would brick `fuse()` permanently.
    function merge(uint256 from, uint256 to) external override onlyEngine {
        if (from == to) revert SameToken();

        uint256 mask = _heldMask[from];
        uint256 n = _knownAssets.length;
        uint256 movedCount = 0;

        for (uint256 i = 0; i < n; ++i) {
            if ((mask & (uint256(1) << i)) == 0) continue;
            address asset = _knownAssets[i];
            uint256 amount = _balance[from][asset];
            if (amount < 1) continue;
            _balance[from][asset] = 0;
            _remember(to, asset);
            _balance[to][asset] += amount;
            ++movedCount;
        }

        _heldMask[from] = 0;
        emit Merged(from, to, movedCount);
    }

    // ---------------------------------------------------------------- holder surface

    /// @notice Withdraw a broker's holdings. Callable by the broker's current owner.
    function withdraw(uint256 tokenId, address[] calldata assets) external nonReentrant {
        address owner = nft.ownerOf(tokenId);
        if (msg.sender != owner) revert NotOwner();
        _payOut(tokenId, assets, owner);
    }

    /// @notice Withdraw on a holder's behalf, against their signature. Anyone may submit.
    /// @dev Payment goes to `nft.ownerOf(tokenId)` and to nothing else, so a hostile relay can
    /// grief by declining to submit but can never redirect a payment. ERC-1271 is supported.
    function withdrawWithSig(
        uint256 tokenId,
        address[] calldata assets,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();

        // Nonce first, then the external read — state before interaction.
        uint256 nonce = nonces[tokenId]++;
        address owner = nft.ownerOf(tokenId);

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        _WITHDRAW_TYPEHASH,
                        tokenId,
                        keccak256(abi.encodePacked(assets)),
                        owner,
                        nonce,
                        deadline
                    )
                )
            )
        );

        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) {
            revert InvalidSignature();
        }

        _payOut(tokenId, assets, owner);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IBrokerVault
    function balanceOf(uint256 tokenId, address asset) external view override returns (uint256) {
        return _balance[tokenId][asset];
    }

    /// @inheritdoc IBrokerVault
    function assetsOf(uint256 tokenId) external view override returns (address[] memory out) {
        uint256 mask = _heldMask[tokenId];
        uint256 n = _knownAssets.length;

        uint256 count = 0;
        for (uint256 i = 0; i < n; ++i) {
            if ((mask & (uint256(1) << i)) != 0) ++count;
        }

        out = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < n; ++i) {
            if ((mask & (uint256(1) << i)) != 0) out[j++] = _knownAssets[i];
        }
    }

    /// @notice The digest a holder signs to authorise a gasless withdrawal.
    function withdrawDigest(uint256 tokenId, address[] calldata assets, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        _WITHDRAW_TYPEHASH,
                        tokenId,
                        keccak256(abi.encodePacked(assets)),
                        nft.ownerOf(tokenId),
                        nonces[tokenId],
                        deadline
                    )
                )
            )
        );
    }

    // ---------------------------------------------------------------- internal

    function _remember(uint256 tokenId, address asset) private {
        uint256 index = _assetIndex[asset];
        if (index == 0) {
            if (_knownAssets.length >= 256) revert TooManyAssets();
            _knownAssets.push(asset);
            index = _knownAssets.length;
            _assetIndex[asset] = index;
        }
        uint256 bit = uint256(1) << (index - 1);
        if ((_heldMask[tokenId] & bit) == 0) _heldMask[tokenId] |= bit;
    }

    /// @dev Balances are zeroed before any transfer, so a reentrant call finds nothing left. The
    /// `nonReentrant` guard on the callers is belt to this contract's braces.
    function _payOut(uint256 tokenId, address[] calldata assets, address to) private {
        uint256 n = assets.length;
        uint256 paid = 0;
        for (uint256 i = 0; i < n; ++i) {
            address asset = assets[i];
            uint256 amount = _balance[tokenId][asset];
            if (amount < 1) continue;
            _balance[tokenId][asset] = 0;
            ++paid;
            if (asset == address(0)) {
                // Native ETH — `Address.sendValue` forwards all available gas and reverts on
                // failure. `to` is the token's current owner, never a caller-supplied address.
                Address.sendValue(payable(to), amount);
            } else {
                IERC20(asset).safeTransfer(to, amount);
            }
            emit Withdrawn(tokenId, to, asset, amount);
        }
        if (paid == 0) revert NothingToWithdraw();
    }
}
