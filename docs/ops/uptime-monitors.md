# Uptime monitors — SparkPoint develop (Uptime Kuma on <monitor-host>)

> **✅ INSTALLED + LIVE (2026-07-17); curatorial push monitor added 2026-09-18 (048).** Uptime Kuma is running on **<monitor-host>** (`<internal-ip>`) —
> native **Node 20** install (no Docker: unprivileged LXC), a `uptime-kuma` **systemd** service on
> **:3001**, `--max-old-space-size=320` so it stays well within the 512 MiB LXC (~200 MiB in use).
> Dashboard: **http://<internal-ip>:3001** (credentials are configured out-of-band and
> never committed; the dashboard is LAN-only, not internet-exposed). The 512 MiB LXC can't be built on
> in-place (swap is blocked in an unprivileged container), so Kuma was **built on the workspace at
> the matching Node 20 ABI and shipped** to `/opt/uptime-kuma`. All **5 monitors below are created
> and reporting UP**. No monitor targets `/exit` or `/trust` (those must never be treated as health
> gates). Re-provision (idempotent) with `scratchpad/provision_kuma.py` via `uptime-kuma-api`.

Monitors (created via the Kuma Socket.IO API; the table is the source of truth for the config):

| # | Name | Type | Target | Up when | Interval |
|---|---|---|---|---|---|
| 1 | web (develop) | HTTP(s) | `<internal-host>/` | 200 | 60s |
| 2 | agent healthz | HTTP(s) | `<internal-host>/healthz` | 200, body contains `"status":"ok"` | 60s |
| 3 | agent readyz | HTTP(s) — keyword | `<internal-host>/readyz` | 200 (anon body is `{"ready":true|false}`; alert on non-200 / unreachable, NOT on `ready:false` alone — a dependency blip is expected to flip it) | 60s |
| 4 | LiteLLM gateway | HTTP(s) | `<internal-host>/health/liveliness` | 200 | 60s |
| 5 | <anvil-host> (sim fork) | HTTP(s) — JSON query | `POST http://<anvil-host>:8545` body `{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}` | 200 + JSON has `result` | 120s |
| 8 | curator run (4663 beta) | Push | `http://<internal-ip>:3001/api/push/<push-token>` | the keyless curator pings UP after a published discovery run and DOWN when discovery fails — 048; 25h heartbeat window (daily cadence). ⚠️ Reads RUN health, not process liveness; until the curator container is deployed it will legitimately report DOWN. | push |

Notes:
- **Do NOT monitor `/exit` or `/trust` as health gates** — they're public and must never be treated
  as "down" logic that pages anyone; their whole point is that they work regardless of backend health.
- The gateway's other surfaces (`/`, `/docs`, `/openapi.json`, `/ui/*`) return **404 by design** (the
  guard proxy) — only `/health/liveliness` is a valid up-check.
- Monitor #3 (`readyz`) is process-reachability, not model health — see `known-limitations.md`.
- Suggested notification: a single Kuma notification channel (e.g. a webhook / email) on any monitor
  DOWN; group 1–4 into a "develop stack" status page for the team.
- <anvil-host> host IP: use the `SIM_FORK_RPC_URL` host from the deploy env (the LAN Anvil box).
