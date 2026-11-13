# Contract: Proxy endpoints, env mapping, and config invariants

## URL scheme (eRPC lane/network addressing)

```
<base>/<lane>/evm/<chainId>
```

| Lane | Base | Auth | Networks served |
|---|---|---|---|
| `core` | `<internal-host>` (Coolify TLS; also container-net `sparkpoint-erpc:4000`) | secret token (`ERPC_CORE_SECRET`, server-side only) | 84532, 1, 46630 |
| `app` | `<internal-host>` (same domain, no secret) | none; CORS allowlist = platform origins; own budget | 84532 (46630 optional) |

Port **4001** (Prometheus metrics) is LAN-only, consumed exclusively by the admin route ([admin-metrics-api.md](admin-metrics-api.md)) and any future scraper.

## Env re-pointing map (the entire stages 1–3 change surface)

| Stage | Service | Variable | New value |
|---|---|---|---|
| 1 | agent | `VAULT_INDEX_RPC_URL` | `…/core/evm/84532` |
| 2 | agent | `BASE_SEPOLIA_RPC_URL` | `…/core/evm/84532` |
| 2 | agent | `ETH_MAINNET_RPC_URL` | `…/core/evm/1` |
| 2 | agent | `ROBINHOOD_RPC_URL` | `…/core/evm/46630` |
| 3 | web | `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | `https://<public-fqdn>/app/evm/84532` |
| 3 | web | `BASE_SEPOLIA_RPC_URL` (server-side, SIWE verify) | `…/core/evm/84532` |
| 4 | web | `RPC_PROXY_METRICS_URL` (new, server-side) | `http://sparkpoint-erpc:4001/metrics` |

**Unchanged by contract**: CI secrets (runners can't reach the LAN); wallet-side RPC (MetaMask uses its own); `SIM_FORK_RPC_URL` (Anvil is not a provider). **Rollback** for any stage = restore the previous value(s); the authoritative before-values table lives in `ops/erpc/ROLLBACK.md`.

## Config invariants (`ops/erpc/erpc.yaml` — reviewed on every change)

1. **AA pin**: `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `eth_supportedEntryPoints` are `ignoreMethods` on every upstream except Alchemy (FR-005).
2. **getLogs routing**: `eth_getLogs` is `ignoreMethods` on Alchemy; the serving upstream has auto-split enabled (FR-006).
3. **Cache**: only `finality: finalized` policies may exist; no `realtime`/`unfinalized` entry may be added under feature 042 (FR-003).
4. **Budgets**: Alchemy ≤15 req/s; the `app` lane carries its own budget (FR-007).
5. **Origins**: `app` CORS allowlist contains only platform origins (FR-008).
6. **Secrets**: provider keys and `ERPC_CORE_SECRET` are referenced via env interpolation — never committed literal (FR-009's spirit applies to the repo too).
7. **Image tag pinned** — never `latest` (an SPOF doesn't get surprise upgrades).

## Verification hooks the contract relies on

- Chain identity: each lane/network answers the correct `eth_chainId`; the agent's fail-closed assertion (023) revalidates continuously once cut over (FR-014).
- Exit independence: `/exit` never resolves to either lane (FR-016) — its client pins public endpoints by construction.
