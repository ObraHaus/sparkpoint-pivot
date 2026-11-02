# Quickstart — 068 one-click cross-chain swaps (backend)

## Run the agent tests

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$HOME/.local/bin:$PATH
cd services/agent
uv run pytest -q tests/crosschain
uv run ruff check src tests
uv run ruff format --check src tests
uv run mypy src
```

## What chat does

With `CROSSCHAIN_ENABLED` unset (default on), these prompts are answered deterministically before
the planner:

- “Swap 5,000 USDC into native BTC.” → `text` + `crosschain_quote(state=preview)`
- “Move 10,000 USDC from Ethereum to Base.” → `base/eth USDC` route
- “Turn 2,000 USDC into SOL on Solana.” → `base:USDC → sol:SOL`
- “Swap 500 USDG to USDC on Base” → `hood:USDG → base:USDC`
- “Pay my supplier 3,000 USDT on Tron.” → `crosschain_quote(state=unavailable)` with the Tron reason

No 1Click call is made for a disabled route; no API key is printed.

## Exercise the HTTP surface locally

The middleware requires the S2S bearer and scoping headers. Against a running agent:

```bash
curl -s http://localhost:8000/crosschain/assets \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"
```

Preview (real dry quote; no funds move):

```bash
curl -s http://localhost:8000/crosschain/quote \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453" \
  -H "Content-Type: application/json" \
  -d '{"originKey":"base:USDC","destinationKey":"btc:BTC","amount":"5000"}'
```

Confirm (`dry=false`) needs a real destination/refund address, returns `depositAddress`, and writes
one `crosschain_quotes` row. The user then sends the origin transaction from their own wallet.

## Dry smoke (real network, dry only)

```bash
cd services/agent
uv run python scripts/oneclick_dry_smoke.py
```

Output columns: `route | http | amountOut | ETA`. A disabled Tron row prints `unavailable` and
makes no HTTP call. `ONECLICK_API_KEY` is optional; when set it is sent as a Bearer token and never
printed.

## Deploy checklist

1. Apply `services/agent/migrations/0044_crosschain_quotes.sql` with `PGCLIENTENCODING=UTF8` before
   deploying the agent that serves `/crosschain/*`.
2. Optionally set `CROSSCHAIN_ROUTES_PATH` / `CROSSCHAIN_ENABLED` / `ONECLICK_API_KEY`.
3. Redeploy the agent. Confirm `GET /crosschain/assets` lists the routes and Tron is disabled.
4. Run the dry smoke from a host with egress to `1click.chaindefuser.com`.
