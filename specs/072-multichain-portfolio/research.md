# Research — 072 multi-chain portfolio (verified 2026-11-01)

Everything below came from read-only public calls and the existing repo modules. No key, signature,
env value or secret is printed; no transaction was signed or sent; no real database was written.
The only network calls are the bounded smoke reads in §6.

## 1. The existing surfaces 072 must not break

- `GET /portfolio` (`api/portfolio.py`) is the SparkPoint **vault** view: one ERC-4626 position,
  idle stable, derived PnL/allocation. It stays unchanged; 072 adds a sibling route.
- `agents/portfolio_reader.py` is a capability spec (READ only), not the chat answer builder.
- `chain/vault_reader.py` already exposes `native_balance(owner)` and
  `token_balance_of(token, owner)`; 072 reuses the same JSON-RPC shape (`eth_getBalance`,
  `eth_call` + `balanceOf`) with an injectable transport.
- `coordinator/prices.py` is the chat price *route*; the feed itself is
  `data/prices.py::PriceService` (keyless CoinGecko → Coinbase, cached/bounded). 072 uses the
  service directly and labels stables `stablecoin_par`.

## 2. RPC configuration

`config.AgentConfig` resolves the **active** chain's RPC from `SPARKPOINT_RPC_URL` / per-chain vars.
For the portfolio that is not enough: 072 must read Base **and** Ethereum independently, and
`SPARKPOINT_RPC_URL` may point at a local fork. So `portfolio/config.py` reads:

| chain | env | behaviour when unset |
|---|---|---|
| Base 8453 | `BASE_MAINNET_RPC_URL` | chain entry `unavailable` — `not configured` |
| Ethereum 1 | `ETHEREUM_RPC_URL` (fallback `ETH_MAINNET_RPC_URL`) | same |
| Solana | `SOLANA_RPC_URL` (public default) | only called for a linked owner address |
| Morpho | `MORPHO_API_URL` (069 default) | API errors degrade the Morpho section |

No key material is read. The portfolio config does not extend `AgentConfig.ALLOWED_ENV_KEYS`
because it never touches a signing surface; it is read-only display data.

## 3. Token address book

The four assets already known to earn/crosschain:

| chain | USDC | USDT | WETH | cbBTC |
|---|---|---|---|---|
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6) | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` (6) | `0x4200000000000000000000000000000000000006` (18) | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8) |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (6) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` (6) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (18) | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8) |

Stables are valued at $1 par (the accepted demo convention, `priceSource: "stablecoin_par"`).
WETH uses the ETH price; cbBTC uses the BTC price. A missing quote keeps the amount and leaves
`valueUsd: null` — never 0.

## 4. Morpho GraphQL — the schema that actually works

The 069 client/endpoint conventions were reused (`https://api.morpho.org/graphql`, a small query,
no request-handler loop). The first query failed validation:

```
Cannot query field "shares" on type "VaultPosition". Did you mean "state"?
Cannot query field "assets" on type "VaultPosition".
```

The working single-request shape (two aliases, one HTTP call) is:

```graphql
query PortfolioMorpho($address: String!) {
  eth: userByAddress(address: $address, chainId: 1) {
    vaultPositions {
      state { shares assets assetsUsd }
      vault {
        address name symbol chain { id }
        asset { address symbol decimals }
        state { netApy }
      }
    }
  }
  base: userByAddress(address: $address, chainId: 8453) { ...same... }
}
```

`VaultPosition.state` holds `shares`/`assets` (raw) and `assetsUsd`. `vault.state.netApy` is the
V1/MetaMorpho shape used by 069. The result is joined with the 069 registry by
`chain:address` for the display name, net APY and rail; the API's own `assetsUsd` is used only when
our price feed cannot value the asset. V1 `vaultPositions` is the surface implemented here; a V2
positions field (if the API exposes one later) would be additive config/code, not a schema change.

1Click Earn Morpho receipts (`earn.json → oneclick_receipts`) are plain ERC-20 wrapper balances on
Base/Ethereum. They are read with the same `balanceOf` call and valued at $1 par **only because every
configured Morpho receipt is a USDC strategy**; the row carries
`note: "1Click Earn receipt; valued at ~$1 par (USDC strategy)"`.

## 5. Kamino (Solana) and Rhea (NEAR)

- There is no session Solana wallet. The only defensible address source is one the owner already
  recorded: the destination recipient in their own `crosschain_quotes` rows (the same `user_eoa`
  ownership key as the 068 status route). The lookup extracts a base58 recipient only when
  `destination_key` starts with `sol:` and validates the shape; anything else is ignored.
  With no such address the section is `not_linked` and says:
  *"Kamino positions show once you deposit to a Solana address from SparkPoint (Phase C)"*.
- Share balances use public Solana JSON-RPC `getTokenAccountsByOwner` with
  `{ mint: kamino.vaults[].shares_mint }` (`jsonParsed`), summed and scaled by the returned
  decimals. The 070 snapshot carries name/APY but **no kVault share price**, so a share balance is
  shown and `valueUsd` stays `null` (rather than inventing a NAV). A future cached
  underlying-per-share source can fill it without changing the wire.
- Rhea reuses 071 exactly: the EVM wallet → MCA (`multica.near`) → `get_account_all_positions`
  (`contract.main.burrow.near`). No new RPC, no USDT enablement, stablecoins at par.

## 6. Smoke output (public address, read-only)

Command:

```bash
cd services/agent
uv run python scripts/portfolio_smoke.py
```

Output (no secrets; 16 counted HTTP calls, well under the 25 cap):

```
Portfolio smoke — READ-ONLY (no key, no signature, no transaction)
wallet: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
state:  ready   asOf: 2026-11-01T05:11:17.844364+00:00

section    status       rows    totalUsd  source
balances   ok             10    24451.77  rpc
morpho     ok              0           -  morpho_api
kamino     not_linked      0           -  solana_rpc
           reason: Kamino positions show once you deposit to a Solana address from SparkPoint (Phase C)
rhea       ok              0           -  rhea_rpc
swaps      unavailable     0           -  db
           reason: Swap history is unavailable: the database is not configured.

totalUsd: 24451.77
  chain eth    Ethereum   $16766.47
  chain base   Base       $7685.30
  proto wallet     $24451.77
sources: rpc, morpho_api, solana_rpc, rhea_rpc, db
http calls: 16 (bounded read-only)
```

The public address has no Morpho/Kamino/Rhea position; the zero-row `ok` sections prove the reads
succeeded (the schema/address are valid), while the Kamino and swap statuses exercise the two
honest degraded states without a DB.

## 7. Tests and static checks

- `tests/portfolio/` — 62 tests: balances (decimals, non-zero only, per-chain config), Morpho
  (registry join, GraphQL failure, receipt), Kamino (`not_linked`, linked read, RPC failure,
  disabled), Rhea (ready/empty/unavailable), swaps (mapping, empty, no DB, 3-row refresh bound,
  linked-address extraction), service (degradation/timeout/totals/cache), API (session wallet,
  query-param rejection, rate limit), chat routing (positives/negatives, precedence, wire shape).
- Evals: 109 offline cases pass, including `portfolio-100..110` and the existing
  `near-95-vague-near-yield` (071 already covered the vague NEAR-yield routing).
- `ruff check` and `mypy src` pass; the full agent suite is run in the final verification step.

## 8. Deliberate limitations / open questions

1. **Kamino valuation.** The 070 registry snapshot has TVL/APY but not a share price, so shares are
   not USD-valued in this phase. A cached `underlying-per-share` read (or a Kamino metrics field)
   can fill `valueUsd` later without a wire change.
2. **Morpho V2 positions.** The query reads `vaultPositions` (V1/MetaMorpho). If Morpho's API
   exposes a separate V2 positions field, that is a follow-up (same one-request pattern).
3. **Linked Solana address.** Only 068 quote recipients are available today; 070's Kamino preview
   is dry and does not persist a recipient. A future owner-bound address store would widen the
   lookup, not the client contract.
4. **Swap status refresh.** Off by default so a portfolio read never fans out to 1Click on the
   request path; enabling it is a deployment flag and still bounded to three rows.
