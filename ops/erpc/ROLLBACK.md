# RPC proxy — rollback runbook (feature 041)

Every cutover stage is one or more **Coolify env values**; every rollback is restoring
the previous value(s) and redeploying that one app. Target: **≤ 5 minutes** (SC-007).
This file is the authoritative before-values table — the admin console's RPC-proxy
section links here.

> Agent redeploys do NOT auto-trigger: `GET /api/v1/deploy?uuid=<agent-uuid>` with the
> RWD token, then poll `/readyz`; if the app reports `exited:unhealthy` after ~1 min,
> `POST /applications/<uuid>/restart`. Web deploys are supposed to auto-trigger but have
> silently not fired before — always verify the served page changed, not the deploy status.

## Stage 1 — indexers (agent app)

| Variable | Proxied value | RESTORE to (pre-039 live value) |
|---|---|---|
| `VAULT_INDEX_RPC_URL` | `https://erpc-t84o44c0ss04k0oswc00wg0k.aldrickb.app/core/evm/84532?secret=…` | `https://sepolia.base.org` |

Verify after restore: `indexer_cursors` advance within 2 ticks (≤10 min).

## Stage 2 — agent request path (agent app)

| Variable | Proxied value | RESTORE to (pre-039 live value) |
|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | `…/core/evm/84532?secret=…` | the keyed Alchemy Base-Sepolia URL (in Coolify env history / operator vault — never written here) |
| `ETH_MAINNET_RPC_URL` | `…/core/evm/1?secret=…` | `https://ethereum-rpc.publicnode.com` |
| `ROBINHOOD_RPC_URL` | `…/core/evm/46630?secret=…` | **unset** (code falls back to the public Robinhood RPC) |

Verify after restore: `/readyz` `chain_rpc` + `chain_identity` green; one chat turn + one
deposit quote in a real browser.

## Stage 3 — browsers (web app)

| Variable | Proxied value | RESTORE to (pre-039 live value) |
|---|---|---|
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | `https://<public-fqdn>/app/evm/84532` | the keyed Alchemy Base-Sepolia URL (⚠️ restoring this puts the key BACK in the public bundle — acceptable only as a rollback, re-plan the cutover after) |
| `BASE_SEPOLIA_RPC_URL` (server-side) | `…/core/evm/84532?secret=…` | **unset** |

⚠️ If the Alchemy key was already rotated (T016), the restore value is the NEW key's URL.
Verify after restore: swap quote + `/fees` render in a real browser; `/exit` unaffected
either way (it is pinned to public endpoints and never rides the proxy — N2).

## Stage 4 — console section (web app)

| Variable | Proxied value | RESTORE |
|---|---|---|
| `RPC_PROXY_METRICS_URL` | `http://sparkpoint-erpc:4001/metrics` | unset — the section renders "not configured"; full removal is a normal PR revert |

## Proxy service itself

Stopping/removing the `sparkpoint-erpc` service is safe **only after** stages 1–3 are
rolled back (consumers point at it until then). Order: restore envs → verify → stop proxy.
The Uptime Kuma monitor will go red when it stops — pause the monitor if the stop is
intentional.
