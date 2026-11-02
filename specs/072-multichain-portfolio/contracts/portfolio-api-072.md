# Contract — `GET /portfolio/multichain` (feature 072)

The existing `GET /portfolio` (the SparkPoint vault view) is unchanged. 072 adds one sibling,
read-only route. All routes keep the same S2S bearer + account-scoping dependencies as the rest of
the agent; the wallet is always the **signed-in session wallet** (`X-Owner` asserted by the
middleware). Nothing signs, submits or holds a key.

## `GET /portfolio/multichain`

- **Auth:** S2S bearer + `X-Account` / `X-Owner` / `X-Chain-Id` (middleware).
- **Body:** none.
- **Query:** none. `wallet`, `address`, `owner`, `account`, `user`, `eoa` are **rejected** with
  `400 VALIDATION_ERROR` — the route can never be pointed at another wallet.
- **Rate limit:** 120/hour per owner (`429 RATE_LIMITED` + `Retry-After`).
- **Status:** `200` even when sections degrade; each section carries its own status/reason.
- **Never:** a signature, calldata, transaction, custody or DB write.

### Response

```json
{
  "type": "portfolio_overview",
  "state": "ready",
  "focus": "all",
  "asOf": "2026-11-01T05:08:57.057006+00:00",
  "wallet": "0x…",
  "sections": [ … ],
  "totals": { … },
  "sources": ["rpc", "morpho_api", "solana_rpc", "rhea_rpc", "db"],
  "text": "Your priced positions total about $… … Read-only — nothing was signed or sent."
}
```

`state` is `ready` (at least one priced row), `empty` (readable but no rows), or `unavailable`
(no section readable). `focus` is `all` for this endpoint (the chat block may use `swaps`/`earn`).
`text` is deterministic prose from the same data.

### Section

```json
{
  "key": "balances | morpho | kamino | rhea | swaps",
  "label": "Wallet balances",
  "status": "ok | unavailable | not_linked",
  "reason": "human reason (only when not ok)",
  "source": "rpc | morpho_api | solana_rpc | rhea_rpc | db",
  "asOf": "2026-11-01T…",
  "rows": [ … ],
  "totalUsd": "24431.46",
  "chains": [ { "chain": "base", "label": "Base", "status": "ok", "reason": null } ]
}
```

`totalUsd` is present only when at least one row in that `ok` section is priced. `chains` is a
balances-only additive field.

### Row

Common: `chain`, `chainLabel`, `protocol`, `kind`, `symbol`, optional `amount`, `valueUsd`,
`priceSource`; then source-specific fields (all camelCase).

| section | kind | extra fields |
|---|---|---|
| balances | `native` / `token` | `address` (token), `decimals`, `priceUsd` |
| morpho | `vault_position` / `morpho_position` / `oneclick_receipt` | `vaultAddress`, `vaultName`, `assetSymbol`, `decimals`, `netApy`, `shares`, `rail`; receipts add `receiptAddress`, `underlyingVault`, `note` |
| kamino | `vault_position` | `vaultAddress`, `vaultName`, `sharesMint`, `assetSymbol`, `netApy`, `wallet`, optional `note` |
| rhea | `lending_position` | `apy`, `mca` |
| swaps | `cross_chain_swap` | `originKey`, `originLabel`, `destinationKey`, `destinationLabel`, `route`, `amountOut`, `depositAddress`, `createdAt`, `lastStatus` |

`valueUsd` is `null` when the row cannot be priced honestly (e.g. a Kamino share with no share
price). `amount` is a decimals-correct human string. A stablecoin is valued at $1 par
(`priceSource: "stablecoin_par"`); a missing feed quote is `priceSource: "unavailable"`.

### Totals

```json
{
  "totalUsd": "24431.46",
  "priced": true,
  "byChain": [{ "chain": "eth", "label": "Ethereum", "valueUsd": "16752.58" }],
  "byProtocol": [{ "protocol": "wallet", "valueUsd": "24431.46" }]
}
```

Only rows in `status:"ok"` sections are summed. `totalUsd` is `null` when nothing is priced.
`priced` distinguishes "no value" from "$0".

### Degraded examples

```json
{ "key": "kamino", "label": "Kamino", "status": "not_linked",
  "reason": "Kamino positions show once you deposit to a Solana address from SparkPoint (Phase C)",
  "source": "solana_rpc", "rows": [] }
```

```json
{ "key": "swaps", "label": "Cross-chain swaps", "status": "unavailable",
  "reason": "Swap history is unavailable: the database is not configured.",
  "source": "db", "rows": [] }
```

## Chat block `portfolio_overview`

The same section/totals shape, emitted as a non-signable `ChatBlock`:

```json
{
  "type": "portfolio_overview",
  "state": "ready",
  "focus": "all",
  "asOf": "2026-11-01T…",
  "sections": [ … ],
  "totals": { … },
  "sources": ["rpc", "morpho_api", "solana_rpc", "rhea_rpc", "db"]
}
```

It never contains `text`, `policy`, `proposedAction` or `wallet`. The DAG emits a separate
`text` block with the deterministic prose.

### Chat routing / precedence

| turn | block | note |
|---|---|---|
| "show my portfolio" | `portfolio_overview` (all) | deterministic, no planner |
| "what do I have across chains" | `portfolio_overview` (all) | |
| "my balances" / "show me my balances" | `portfolio_overview` (all) | |
| "show my positions everywhere" | `portfolio_overview` (all) | |
| "my swap history" | `portfolio_overview` (swaps) | swaps-focused text |
| "how much am I earning" | `portfolio_overview` (earn) | earn-focused text |
| "my Rhea positions" | `earn_positions` | 071 wins (checked first) |
| "swap 100 USDC to SOL" | `crosschain_quote` | 068 wins |
| "what is my portfolio worth right now?" | `portfolio_snapshot` | vault view preserved |
| "what's in my wallet?" | `portfolio_snapshot` | vault view preserved |
| "show my portfolio and then swap ETH" | planner | compound action never takes the shortcut |

## Shared fixtures

`packages/shared/tests/fixtures/portfolio/portfolio-overview-{ready,degraded,empty}.json` are the
exact `PortfolioOverviewBlock.to_wire()` output, pinned by
`services/agent/tests/portfolio/test_chat_block_fixtures.py`. The web phase adds the zod schema and
the same parity test.
