// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The minimum of `SparkyBroker` this sale needs. The collection lives in its own repo and
///         is already deployed; nothing here may change it.
interface ISparkyBrokerMintable {
    function mint(address to) external returns (uint256 id);
    function totalMinted() external view returns (uint256);
    function MAX_SUPPLY() external view returns (uint256);
}

/// @title BrokerSale — the free, open mint for Sparky Broker.
/// @notice Becomes the NFT's `minter`, the second role deliberately left unset at deploy. Anyone may
///         mint, up to an owner-settable per-wallet cap; the collection's 10,000 supply cap is
///         enforced by the NFT itself and is not re-implemented here, because two caps eventually
///         disagree and the NFT's is the one that is immutable.
///
///         **Free and open is a deliberate decision** (operator, 2026-08-13), not a placeholder that
///         forgot its price. It also removed this feature's hardest unknown: the mint was originally
///         to be gated on holding ≥1,000,000 mainnet SRK, which is a CROSS-CHAIN assertion — the
///         balance is on Ethereum, the contract is on Robinhood Chain, and no contract can read
///         another chain. Every honest workaround (a signed allowlist root, an operator-maintained
///         on-chain list, or UI-only gating) is a different trust model rather than a detail.
///         Dropping the gate deleted the decision. A price or an allowlist is additive later.
///
/// @dev ⚠️ **A per-wallet cap is not a sybil defence, and must not be described as one.** It bounds
///      one address, and a free mint means a second address costs only gas. What actually bounds the
///      collection is the NFT's immutable 10,000 supply cap. The per-wallet cap exists to stop one
///      wallet trivially draining the sale in a single script, not to make distribution fair.
///
///      There is no payment leg and therefore **no `payable` function** — nothing can be sent here,
///      so nothing can be stranded here.
contract BrokerSale is Ownable2Step {
    /// @notice The Sparky Broker collection. Immutable — a sale never re-points at another one.
    ISparkyBrokerMintable public immutable broker;

    /// @notice How many brokers one address may mint from this sale. Owner-settable.
    uint256 public perWalletCap;

    /// @notice Whether minting is open. Closing MUST NOT be able to touch activation — that is the
    ///         registry's concern, and the two contracts are separate precisely so this is true.
    bool public saleOpen;

    /// @notice How many this address has minted here.
    mapping(address => uint256) public mintedBy;

    event Minted(address indexed to, uint256 indexed tokenId);
    event SaleOpenSet(bool open);
    event PerWalletCapSet(uint256 previousCap, uint256 newCap);

    error WalletCapReached(address wallet, uint256 minted, uint256 cap);
    error SaleClosed();
    error ZeroAddress();
    error ZeroCap();

    constructor(address broker_, uint256 perWalletCap_, bool open_) Ownable(msg.sender) {
        if (broker_ == address(0)) revert ZeroAddress();
        if (perWalletCap_ == 0) revert ZeroCap();
        broker = ISparkyBrokerMintable(broker_);
        perWalletCap = perWalletCap_;
        saleOpen = open_;
        emit PerWalletCapSet(0, perWalletCap_);
        emit SaleOpenSet(open_);
    }

    /// @notice Mint one broker to yourself. Free, and open to anyone.
    /// @dev ⚠️ The counter is incremented BEFORE the external call, and that ordering is load-bearing
    ///      rather than stylistic: `SparkyBroker` mints with `_safeMint`, so a CONTRACT recipient
    ///      receives an `onERC721Received` callback and can re-enter this function. Incrementing
    ///      first means a re-entrant call sees the updated count and hits the cap; incrementing
    ///      afterwards would let one contract mint the whole collection in a single transaction.
    ///      There is a test that mints from a re-entering contract and asserts the cap holds.
    function mint() external returns (uint256 id) {
        if (!saleOpen) revert SaleClosed();

        uint256 already = mintedBy[msg.sender];
        uint256 cap = perWalletCap;
        if (already >= cap) revert WalletCapReached(msg.sender, already, cap);

        // Effects first — see the note above.
        mintedBy[msg.sender] = already + 1;

        // The NFT owns the 10,000 supply cap and reverts `SupplyExhausted` on its own. Deliberately
        // not mirrored here: a second cap is a second thing to keep in sync, and this one could not
        // be the authority anyway.
        id = broker.mint(msg.sender);
        emit Minted(msg.sender, id);
    }

    /// @notice How many more this address may mint. Display-only; `mint` is the authority.
    function remainingFor(address wallet) external view returns (uint256) {
        uint256 already = mintedBy[wallet];
        uint256 cap = perWalletCap;
        return already >= cap ? 0 : cap - already;
    }

    /// @notice Open or close minting.
    /// @dev Closing the sale has NO effect on any broker already minted, and none on activation.
    function setSaleOpen(bool open) external onlyOwner {
        saleOpen = open;
        emit SaleOpenSet(open);
    }

    /// @notice Retune the per-wallet cap.
    /// @dev Lowering it below what someone has already minted does not claw anything back — it only
    ///      stops them minting more. Nothing here can move or unmint a broker.
    function setPerWalletCap(uint256 newCap) external onlyOwner {
        if (newCap == 0) revert ZeroCap();
        uint256 previous = perWalletCap;
        perWalletCap = newCap;
        emit PerWalletCapSet(previous, newCap);
    }
}
