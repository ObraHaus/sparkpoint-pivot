# Plan — 072 multi-chain portfolio (backend + evals)

## Shape

```
api/multichain_portfolio.py             GET /portfolio/multichain (session wallet only)
portfolio/
  config.py      env → PortfolioConfig (Base/Ethereum RPCs, Solana RPC, Morpho URL, limits)
  models.py      PortfolioOverview / PortfolioSection / PortfolioRow + totals + wire
  pricing.py     060 PriceService adapter; stables at $1 par
  rpc.py         EvmRpc (eth_getBalance / eth_call balanceOf), SolanaRpc (getTokenAccountsByOwner)
  balances.py    Base/Ethereum native + USDC/USDT/WETH/cbBTC
  morpho.py      one aliased GraphQL request + 069 registry join + 1Click receipts
  kamino.py      owner-linked Solana addresses only; kVault share balances
  rhea.py        adapter over 071 EarnService.rhea_positions
  swaps.py       crosschain_quotes history + bounded status refresh
  service.py     concurrent sections, per-source timeout, short cache, factory
  text.py        deterministic prose (all / swaps / earn)
  chat.py        narrow detector + PortfolioOverviewBlock assembly
coordinator/chat_blocks.py              + PortfolioOverviewBlock
coordinator/dag.py                      portfolio route AFTER 068/069/070/071
db/crosschain_quotes.py                 + list_for_owner (read-only)
```

## Data flow

1. The API/chat passes the session owner (never a client address) to
   `MultichainPortfolioService.read(owner, focus=...)`.
2. Five source coroutines run with `asyncio.gather`; each is wrapped in
   `asyncio.wait_for(..., timeout=PortfolioConfig.timeout_s)`.
3. A source returns its own `PortfolioSection`; a raised exception/timeout is converted to
   `unavailable` with a generic human reason (never a fabricated row).
4. `ok`/`not_linked` sections are cached briefly per owner; `unavailable` is retried next time.
5. Totals sum only `ok` rows. `asOf` is stamped on each section (and on the overview).
6. The API adds `text` from `render_text`; the chat path emits `TextBlock(text)` +
   `PortfolioOverviewBlock`.

## Source notes

- **Balances.** Base uses `BASE_MAINNET_RPC_URL` only (never `SPARKPOINT_RPC_URL`, which may be a
  fork). Ethereum uses `ETHEREUM_RPC_URL` (or `ETH_MAINNET_RPC_URL`); unset means a separate
  `not configured` chain entry. One chain's failure does not hide the other.
- **Morpho.** One HTTP request:
  `{ eth: userByAddress(chainId:1) { vaultPositions { state { shares assets assetsUsd } vault {...} } }, base: ... }`.
  `VaultPosition` has no top-level `shares`/`assets`; they live under `state` (verified against the
  live API). The 069 registry supplies names/APY and the rail. `assetsUsd` is used only when our
  price feed cannot value the asset.
- **Kamino.** The linked-address lookup reads the owner's own `crosschain_quotes` rows and extracts
  Solana recipients from the recorded quote request. Public `getTokenAccountsByOwner` for the
  configured share mint. No share price is in the 070 snapshot, so shares are shown and priced only
  if a cached underlying-per-share value is injected; otherwise `valueUsd` is `null`.
- **Rhea.** The 071 service already scopes to the session EVM wallet and is read-only. The section
  reshapes its block and values USDC/USDT at par.
- **Swaps.** `list_for_owner` is keyed on `user_eoa` (the same ownership key the status endpoint
  uses). Status refresh is opt-in (`PORTFOLIO_SWAP_STATUS_REFRESH`), at most three non-terminal rows,
  and never written back.

## Chat precedence (documented)

Order in `CoordinatorDag.run_chat`:

1. unsafe request / 068 crosschain parser / 071 native-NEAR-staking /
   069/070/071 earn parser;
2. **072 portfolio overview** (only when the detector matches a complete ask);
3. unsupported swap, price, confirmations, bridge, curated/APY/fees, vault portfolio, planner.

The detector is anchored and deliberately excludes "worth", "performance", "advice", action verbs
and amounts, so:
`"my Rhea positions"` → 071 `earn_positions`;
`"what is my portfolio worth right now?"` / `"what's in my wallet?"` → existing
`portfolio_snapshot`;
`"show my portfolio and then swap ETH"` → planner (compound action).
`CoordinatorDag(portfolio=None)` keeps the pre-072 path byte-for-byte for every existing test.

## Failure modes

| Condition | Behaviour |
|---|---|
| No Base/Ethereum RPC | balances `unavailable` (`not configured`); per-chain entries explain |
| RPC / Morpho / Solana error or timeout | that section `unavailable`; others unaffected |
| No DB | swaps `unavailable` ("database is not configured"); Kamino `not_linked` |
| No linked Solana recipient | Kamino `not_linked` with the Phase C copy |
| No Rhea MCA | Rhea `ok` with zero rows + explainer |
| Price unavailable | row kept, `valueUsd: null`, `priceSource: "unavailable"` |

## Testing

- Unit: `tests/portfolio/` (balances, morpho, kamino, rhea, swaps, service, API, chat routing,
  shared fixtures). All HTTP/DB mocked.
- Evals: `portfolio-100..110` in `evals/golden.yaml`; assertions check route, focus and section
  statuses.
- Contract: `packages/shared/tests/fixtures/portfolio/*.json` regenerated from the production
  models.
