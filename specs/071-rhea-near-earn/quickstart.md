# Quickstart — 071 Rhea (Burrow) NEAR earn (backend)

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/.local/bin:$PATH
cd services/agent
uv run pytest -q tests/earn tests/evals tests/crosschain
uv run ruff check src tests scripts
uv run mypy src
```

## Snapshot (real NEAR RPC reads; Morpho is not re-fetched)

```bash
cd services/agent
# Refresh only the Rhea rows; keep the existing Morpho/Kamino rows
uv run python scripts/earn_registry_snapshot.py --rhea-only
# Full refresh (Morpho pages + Kamino + Rhea + dry receipt probes)
uv run python scripts/earn_registry_snapshot.py
```

Writes `src/sparkpoint_agent/earn/snapshot.json` and prints each Rhea asset's `supply_apr`
(`14.05%`), source/fetchedAt and the live one-time MCA fee (`0.3 USDC`). Request handlers never
call the RPC for the list; they read the shared snapshot.

## Real dry smoke (no funds, no signature)

```bash
cd services/agent
uv run python scripts/earn_dry_smoke.py
```

Covers the 069/070 receipts + Kamino routes, then:

- `get_mca_by_wallet(0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045)` → `None`
- `get_create_mca_fee_paged` → one-time fee 0.3 USDC
- Base USDC 100 → Rhea USDC with the **supply** message (≈99.9808)
- Base USDC 100 → Rhea USDC with the **register** message (≈99.9894)
- Base USDC 5000 → Rhea USDC (≈4999.04)

All quotes are `dry:true`; the keyless 0.25% routing fee is included.

## Chat

- “Deposit 100 USDC into Rhea” → `text` + `earn_quote` (`rail="oneclick_rhea"`, first deposit,
  one-time fee, message-to-sign, withdraw link).
- “Supply 500 USDC on Rhea Finance lending” → same preview.
- “Rhea APY for USDC” / “Show Rhea vaults” → `earn_vaults` (Rhea Lending USDC, 14.05%).
- “Show my Rhea positions” → `earn_positions` (ready/empty/unavailable).
- “How do I withdraw from Rhea?” → text with the `app.rhea.finance/lending` link.
- “Compare Aave and Rhea, then deposit 500 USDC into the safer one.”, “Bridge 100 USDC to NEAR
  then deposit into Rhea”, “Swap 100 USDC to Rhea” and “deposit 100 USDC into the vault” keep
  their existing routes.

## HTTP

```bash
curl -s "http://localhost:8000/earn/vaults?chain=near&protocol=rhea" \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"

curl -s http://localhost:8000/earn/rhea/positions \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"

curl -s http://localhost:8000/earn/preview \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453" \
  -H "Content-Type: application/json" \
  -d '{"chain":"near",
       "vaultAddress":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
       "originKey":"base:USDC","amount":"100"}'
```

The positions route reads the **signed-in** wallet only; there is no wallet query parameter.

## Enabling USDT (config-only)

1. Set `earn/earn.json → rhea.assets[USDT].enabled = true` (its token id/asset id/decimals are
   already present).
2. Optionally add `"USDT":"0.30"` to `rhea.mca_fee_fallback` if the live fee read is unavailable.
3. Rerun `scripts/earn_registry_snapshot.py --rhea-only`. No code change; the row and the
   `oneclick_rhea` rail appear.

## Phase C (not in this branch)

The first deposit needs one off-chain `personal_sign` of the preview's `messageToSign`
(`[{"EVM":"<addr without 0x>"}]`), then the live (`dry=false`) 1Click deposit with the resulting
signature in `customRecipientMsg`. In-app withdraw is a link-out today.
