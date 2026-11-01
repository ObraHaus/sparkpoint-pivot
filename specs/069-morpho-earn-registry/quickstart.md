# Quickstart — 069 Morpho earn registry (backend)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/.local/bin:$PATH
cd services/agent
uv run pytest -q tests/earn
uv run ruff check src tests
uv run mypy src
```

## Regenerate the shipped snapshot (real Morpho reads; ≤6 requests)

```bash
cd services/agent
uv run python scripts/earn_registry_snapshot.py
```

Writes `src/sparkpoint_agent/earn/snapshot.json` (enabled chains, after filters) and prints the
per-chain/asset/rail counts plus the "all vaults" reachability table. The runtime refresher uses the
same fetcher on `EARN_ENABLED` deployments.

## Real dry 1Click smoke (no funds, dry only)

```bash
cd services/agent
uv run python scripts/earn_dry_smoke.py
```

Output: `receipt | http | amountOut | ETA | liveness`. Today `gtUSDCp` is live; the other three
configured receipts answer `400 No liquidity available`. No key is printed; when `ONECLICK_API_KEY`
is set the keyless-fee note is omitted.

## Chat

With `EARN_ENABLED` unset (default on), these are answered deterministically before the planner:

- “Show Morpho vaults on Base” → `text` + `earn_vaults` (top 5, rails per vault).
- “What's the best Morpho vault on Base?” → `earn_vaults` sorted by net APY.
- “Deposit 100 USDC into Morpho Gauntlet USDC Prime” → `text` + `earn_quote` (`direct` on Base).
- “Deposit 100 USDC from Ethereum into Morpho Gauntlet USDC Prime” → dry 1Click receipt preview.
- “Deposit 100 USDC into the vault” and “Compare Aave and Morpho, then deposit 500 USDC into the
  safer one.” keep the existing planner path.

## HTTP (against a running agent)

```bash
curl -s http://localhost:8000/earn/vaults?chain=base\&asset=USDC\&limit=5 \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"

curl -s http://localhost:8000/earn/preview \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453" \
  -H "Content-Type: application/json" \
  -d '{"chain":"base","vaultAddress":"0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61","originKey":"eth:USDC","amount":"100"}'
```

## Config knobs

| Env | Default | Meaning |
|---|---|---|
| `EARN_ENABLED` | JSON `true` | Deployment feature flag. `0` disables chat + HTTP. |
| `EARN_CONFIG_PATH` | packaged `earn.json` | Route/filter/receipt override. |
| `EARN_DATA_DIR` | `/var/lib/sparkpoint-agent` | Writable snapshot dir (fail-open). |
| `EARN_SNAPSHOT_PATH` | `$EARN_DATA_DIR/earn-snapshot.json` | Explicit snapshot file. |
| `AURORA_INTENTS_API_KEY` | unset | Enables the `intents_connect` rail (data plan only; never printed). |

No migration is required. The shipped `earn/snapshot.json` keeps the app working when Morpho is
down or the data dir is read-only.
