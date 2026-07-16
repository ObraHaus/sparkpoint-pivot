# Uptime monitors — SparkPoint develop (Uptime Kuma on spark-mon)

Monitors to create in the Uptime Kuma instance on **spark-mon**. (I could not provision these from
the build environment — no spark-mon/Kuma credentials or reachability — so this is the exact,
apply-ready config. Create them in the Kuma UI or via its API with an admin token.)

| # | Name | Type | Target | Up when | Interval |
|---|---|---|---|---|---|
| 1 | web (develop) | HTTP(s) | `https://71zxh8ed1ejf8132l46joodp17.aldrickb.app/` | 200 | 60s |
| 2 | agent healthz | HTTP(s) | `https://8jcvimzny63tw81xkfl3wwmdzz.aldrickb.app/healthz` | 200, body contains `"status":"ok"` | 60s |
| 3 | agent readyz | HTTP(s) — keyword | `https://8jcvimzny63tw81xkfl3wwmdzz.aldrickb.app/readyz` | 200 (anon body is `{"ready":true|false}`; alert on non-200 / unreachable, NOT on `ready:false` alone — a dependency blip is expected to flip it) | 60s |
| 4 | LiteLLM gateway | HTTP(s) | `https://fi5zmq5osp0g3aam93gnv2j4rl.aldrickb.app/health/liveliness` | 200 | 60s |
| 5 | spark-anvil (sim fork) | HTTP(s) — JSON query | `POST http://<spark-anvil>:8545` body `{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}` | 200 + JSON has `result` | 120s |

Notes:
- **Do NOT monitor `/exit` or `/trust` as health gates** — they're public and must never be treated
  as "down" logic that pages anyone; their whole point is that they work regardless of backend health.
- The gateway's other surfaces (`/`, `/docs`, `/openapi.json`, `/ui/*`) return **404 by design** (the
  guard proxy) — only `/health/liveliness` is a valid up-check.
- Monitor #3 (`readyz`) is process-reachability, not model health — see `known-limitations.md`.
- Suggested notification: a single Kuma notification channel (e.g. a webhook / email) on any monitor
  DOWN; group 1–4 into a "develop stack" status page for the team.
- spark-anvil host IP: use the `SIM_FORK_RPC_URL` host from the deploy env (the LAN Anvil box).
