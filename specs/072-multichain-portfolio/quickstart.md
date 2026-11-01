# Quickstart — 072 multi-chain portfolio (backend + evals)

> **Hackathon demo:** the step-by-step 068 → 072 run of show (with every prompt verified against
> the parsers/golden cases) lives at [`docs/demo/072-hackathon-demo.md`](../../docs/demo/072-hackathon-demo.md).

## Run the tests

```bash
cd services/agent
export PATH=$HOME/.local/bin:$PATH

uv run pytest -q tests/portfolio
uv run pytest -q tests/evals tests/crosschain tests/earn
uv run pytest -q          # full agent suite (12 pre-existing vault_reader failures excepted)

uv run ruff check src tests scripts evals
uv run ruff format --check src tests scripts evals
uv run mypy src
```

## Run the golden evals

```bash
cd services/agent
uv run python -m evals.run --mode offline
# only the 072 cases:
uv run python -m evals.run --mode offline --case portfolio-100-show --case portfolio-106-degraded-sections
```

## Smoke the read-only portfolio

```bash
cd services/agent
uv run python scripts/portfolio_smoke.py
# Ethereum is optional; Base-only keeps the call count lower:
uv run python scripts/portfolio_smoke.py --skip-eth
```

It prints each section's status, row count and total, the overall totals, the sources and the
counted HTTP calls. It uses a public address and public endpoints, never a database, and never a
1Click quote.

## Try the API (behind the normal S2S auth)

```bash
curl -s http://localhost:8000/portfolio/multichain \
  -H "Authorization: Bearer $AGENT_S2S_TOKEN" \
  -H "X-Account: 0x…" -H "X-Owner: 0x…" -H "X-Chain-Id: 8453"
```

`?wallet=…` / `?address=…` are rejected with `400 VALIDATION_ERROR`; the route always uses the
session owner.

## Environment

| variable | purpose |
|---|---|
| `BASE_MAINNET_RPC_URL` | Base 8453 read RPC (unset → balances chain entry `not configured`) |
| `ETHEREUM_RPC_URL` (or `ETH_MAINNET_RPC_URL`) | Ethereum 1 read RPC (optional) |
| `SOLANA_RPC_URL` | Solana JSON-RPC (used only for an owner-linked address) |
| `MORPHO_API_URL` | Morpho GraphQL (default `https://api.morpho.org/graphql`) |
| `PORTFOLIO_SWAP_STATUS_REFRESH` | opt-in bounded 1Click status refresh (default off) |

No key material is read by this surface.
