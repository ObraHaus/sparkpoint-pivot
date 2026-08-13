# Phase 1 contracts — 043

Interfaces only. Both contracts are single-purpose, non-upgradeable, `Ownable2Step`, and hold no
value between transactions.

## Existing surface consumed (deployed, unchanged)

```solidity
interface ISparkyBroker {
    function ownerOf(uint256 id) external view returns (address);
    function isActivated(uint256 id) external view returns (bool);
    function activatedAt(uint256 id) external view returns (uint64);   // BLOCK NUMBER, 0 = never/cleared
    function activationsOf(uint256[] calldata ids) external view returns (uint64[] memory);
    function totalMinted() external view returns (uint256);
    function activate(uint256 id) external;                            // onlyActivator
    function mint(address to) external returns (uint256 id);           // onlyMinter
    function mintBatch(address to, uint256 quantity) external;         // onlyMinter
}
```

`MAX_SUPPLY` is 10,000 and lives on the NFT. Neither new contract re-implements it.

## `BrokerActivationRegistry` — becomes the NFT's `activator`

```solidity
interface IBrokerActivationRegistry {
    event Activated(address indexed holder, uint256 indexed tokenId, uint256 srkRetired);
    event PriceSet(uint256 oldPrice, uint256 newPrice);

    error NotBrokerOwner(uint256 tokenId, address owner, address caller);
    error AlreadyActivated(uint256 tokenId);
    error PriceAboveCap(uint256 requested, uint256 cap);
    error ZeroAddress();

    // ── immutable, set at construction ──
    function broker()   external view returns (address);
    function srk()      external view returns (address);
    function deadAddress() external view returns (address);   // 0x…dEaD; NOT address(0) — ERC-20 reverts
    function maxPrice() external view returns (uint256);      // the cap `price` can never exceed

    // ── the one state-changing entry point ──
    /// Retires `price()` SRK from the caller and activates a broker the caller owns, atomically.
    /// Reverts unless the caller owns `tokenId` and it is not already activated.
    /// Holds no SRK and no broker at any point. Takes no approval it does not spend here.
    function activate(uint256 tokenId) external;

    // ── the candidate set (research.md R1) — a HINT, never the authority ──
    /// Every token this wallet has activated through THIS registry. May contain tokens it no
    /// longer owns; callers MUST narrow with a live ownerOf + activatedAt.
    function activationsBy(address holder) external view returns (uint256[] memory);
    function activationCountBy(address holder) external view returns (uint256);

    // ── owner ──
    function price() external view returns (uint256);
    function setPrice(uint256 newPrice) external;   // onlyOwner; reverts above maxPrice
}
```

**Deliberately absent, and the absence is the design:**

- no `withdraw`, `sweep`, `rescue`, or `recoverERC20` — for SRK, for brokers, or for ETH;
- **no `payable` function anywhere**, so ETH cannot be stranded (the `locked-ether` finding raised
  against the NFT is the precedent — solady marks some ERC-721 paths `payable`);
- no `pause` — pausing activation would strand a holder mid-flow, and there is nothing to protect:
  the contract never holds value;
- no way to set `broker`, `srk`, or `deadAddress` after construction.

## `BrokerSale` — becomes the NFT's `minter`

```solidity
interface IBrokerSale {
    event Minted(address indexed to, uint256 indexed tokenId);
    event SaleOpenSet(bool open);
    event PerWalletCapSet(uint256 oldCap, uint256 newCap);

    error WalletCapReached(address wallet, uint256 minted, uint256 cap);
    error SaleClosed();

    function broker() external view returns (address);          // immutable
    function perWalletCap() external view returns (uint256);
    function mintedBy(address wallet) external view returns (uint256);
    function saleOpen() external view returns (bool);

    /// Mints one broker to the caller. FREE and OPEN — no holder gate, no allowlist, no payment.
    /// Reverts only if the caller has used its per-wallet cap or the sale is closed. The 10,000
    /// supply cap is enforced by the NFT, not re-implemented here.
    function mint() external;

    function setSaleOpen(bool open) external;                   // onlyOwner
    function setPerWalletCap(uint256 newCap) external;          // onlyOwner
}
```

**Free and open, by operator decision.** The earlier design gated this on the ≥1,000,000 mainnet-SRK
holder check — which is a **cross-chain** assertion no contract can make. Dropping it removes the
feature's hardest unknown rather than approximating it. A price or an allowlist is additive later.

Note there is **no payment leg and therefore no `payable` function**: nothing can be sent to this
contract, so nothing can be stranded in it.

## Invariants the tests must pin

| # | Invariant | Where |
|---|---|---|
| I1 | After any successful `activate`, the registry holds **0** SRK and **0** brokers | registry test + fuzz |
| I2 | Any revert leaves the caller's SRK balance and `activatedAt[id]` exactly as before | fuzz over the failure set |
| I3 | `activate` by a non-owner reverts and moves no SRK | unit |
| I4 | `activate` on an already-activated broker reverts and moves no SRK | unit |
| I5 | `setPrice` above `maxPrice` reverts | unit |
| I6 | A holder can never be charged more than the `price()` they read (no price change between read and spend within one tx) | unit |
| I7 | `activationsBy` is a superset of the wallet's currently-activated brokers, never a subset | invariant test |
| I8 | Minting never sets `activatedAt` | sale test |
| I11 | The sale has no `payable` function and holds no value | static + unit |
| I12 | The per-wallet cap cannot be bypassed by minting from a contract or in a loop | fuzz |
| I9 | The registry has no reachable path that transfers a broker | static + unit |
| I10 | Total SRK supply is unchanged by an activation (it moves, it is not destroyed) | fuzz — this is why the word is "retired" |
