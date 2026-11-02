# Quickstart — 070 Kamino SOL earn (backend)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/.local/bin:$PATH
cd services/agent
uv run pytest -q tests/earn tests/evals tests/crosschain
uv run ruff check src tests evals scripts
uv run mypy src
```

## Snapshot (real Kamino reads; Morpho optional)

```bash
cd services/agent
# Full refresh (Morpho pages + Kamino list/metrics + dry receipt probes)
uv run python scripts/earn_registry_snapshot.py
# Kamino-only: keep the existing Morpho rows, refresh Kamino
uv run python scripts/earn_registry_snapshot.py --kamino-only
```

Writes `src/sparkpoint_agent/earn/snapshot.json` with Morpho + Kamino rows and prints kVault counts
(total, by asset, configured, oneclick-live). Request handlers never call either API.

## Real dry smoke (no funds)

```bash
cd services/agent
uv run python scripts/earn_dry_smoke.py
```

Covers the four/five Morpho receipts plus Kamino: Base USDC 100 → `kV-gtSOLb`, SOL 1 → kV,
Solana USDC 100 → kV, 1 kV → SOL, and Base USDC 1000 (the size cap). All quotes are `dry:true`.

## Chat

- “Show Kamino vaults” → `text` + `earn_vaults` (SOL Balanced, Solana).
- “Best Kamino vault” → sorted by net APY.
- “Deposit 100 USDC into Kamino SOL vault” → `text` + `earn_quote` (oneclick, native shares).
- “Deposit 1 SOL into Kamino on Solana” → SOL-origin preview (copy-address deposit).
- “Deposit 100 USDC into the vault” and “Compare Aave and Kamino, then deposit 500 USDC into the
  safer one.” keep the planner.

## HTTP

```bash
curl -s "http://localhost:8000/earn/vaults?chain=sol&protocol=kamino" \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"

curl -s http://localhost:8000/earn/preview \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453" \
  -H "Content-Type: application/json" \
  -d '{"chain":"sol","vaultAddress":"DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
       "originKey":"base:USDC","amount":"100",
       "recipient":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"}'
```

## Adding a Kamino USDC vault (config-only)

1. Append to `earn/earn.json → kamino.vaults`: `{address, name, asset:"USDC", shares_mint}`.
2. Append the matching 1Click receipt to `oneclick_receipts`: `symbol`, `asset_id`, `decimals`,
   `chain:"sol"`, `wrapper_address` = shares mint, `underlying_vault` = kVault address,
   `protocol:"kamino"`, `receipt_kind:"native_shares"`.
3. Rerun the snapshot. No code change; the oneclick rail appears because the receipt matches.
