# Quickstart: live verification per stage — feature 042

Each stage gates the next. Every check is runnable by the operator (or the agent session) with no code knowledge beyond this file. `PXY` = LAN base `http://sparkpoint-erpc:4000`, `PUB` = public FQDN. Secrets come from the ops env, never pasted into shells that log.

## Stage 0 — proxy deployed, zero traffic (operator-confirmed Coolify actions)

```bash
# 1. Right chain on every lane/network (core needs the secret; app is open):
for c in 84532 1 46630; do curl -s "$PXY/core/evm/$c?secret=$ERPC_CORE_SECRET" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'; echo; done
curl -s "$PUB/app/evm/84532" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# EXPECT: 0x14a34, 0x1, 0xb626 respectively; app lane returns 0x14a34.

# 2. getLogs over a 2000-block finalized range via core → succeeds (auto-split visible in
#    container logs); repeat the identical call → cache hit (second response markedly faster,
#    upstream counters unchanged).

# 3. sepolia.base.org accepts eRPC's user-agent (no 403 in logs — the httpx UA lesson).

# 4. Read REAL metric names:
curl -s http://sparkpoint-erpc:4001/metrics | grep -oE '^erpc_[a-z_]+' | sort -u
# → these exact names feed rpcProxyTiles.test.ts. Never guess (037 tip.topic lesson).

# 5. Kuma: new monitor on the healthcheck endpoint is UP (FR-018).
```

## Stage 1 — indexers on the proxy (agent env: `VAULT_INDEX_RPC_URL`)

- `indexer_cursors` advance across ≥3 ticks (vault_flows + both swap-fee streams).
- Agent logs: no window-shrink events; revenue rows still ingest.
- Rollback drill once (restore var, restart, cursors still advance) — stopwatch it: **≤5 min** (SC-007). *Ran 2026-08-04: env restore + restart cycle well under 60s (readyz poll raced the queued restart, so the exact figure is coarse; the bound holds with wide margin).*

## Stage 2 — agent request path (agent env: 3 RPC vars)

- `/readyz`: `chain_rpc` + `chain_identity` green — the 023 assertion now validates the proxy path (FR-014).
- **Browser run, not just green tests** (029 lesson): chat turn → deposit quote → sim → sign; portfolio renders; premium payment verify; SIWE with a non-allowlisted wallet (SRK gate via `/core/evm/1`).
- Session-key automation end-to-end: build → sign → submit → receipt; container logs show the UserOp served by the Alchemy upstream only (FR-005/SC-006).
- **Throttle drill (SC-001)**: temporarily set the Alchemy budget to ~1 req/s, run the scripted session — zero user-visible chain-read errors (failover absorbs); restore the budget.

## Stage 3 — browsers (web env), then key rotation

- CORS: reads succeed from the platform origin; a foreign-origin browser request is refused (FR-008).
- Real browser: swap-quote fan-out while typing, `/fees` + `/trust` polls, faucet + premium balances — all green.
- `curl` the served JS chunks: `grep -c 'g.alchemy.com'` → **0** (SC-002).
- `/exit` with the proxy container **stopped**: page loads, vault state reads correctly (FR-016/SC-008). Restart proxy.
- **Only after** the grep passes: rotate the Alchemy key (operator, Alchemy dashboard); confirm the app still works and the old key no longer authenticates.

## Stage 4 — console section (the code PR)

- Unit: `rpcProxyTiles.test.ts` pins metric names + tri-state (absent → "not reported", never amber) — leaf-module constraints (no `@/` value imports; `typecheck:test` green).
- Playwright (minted `sp_session`): section renders live tiles; **proxy-down drill** → section shows "unreachable", the other five System sections still render (FR-011/012).
- Anonymous request to `/api/admin/rpc-proxy` → 404.
- PR carries `CHANGELOG.md` + the in-app entry (FR-017) — the gate checks both surfaces; no direct-to-develop push (036 lesson).

## Acceptance sweep (maps to spec SC-001…SC-008)

| SC | Where proven |
|---|---|
| SC-001 | Stage 2 throttle drill |
| SC-002 | Stage 3 bundle grep + rotation |
| SC-003 | Stage 0 #2 + Stage 1 backfill counters |
| SC-004 | Stage 3 rapid-interaction session while watching the budget tile |
| SC-005 | Stage 4 Playwright + a manual 15 s-staleness spot check |
| SC-006 | Stage 2 session-key run |
| SC-007 | Stage 1 rollback drill (repeat at any later stage if config drifted) |
| SC-008 | Stage 3 exit-with-proxy-stopped |

## Acceptance results (2026-08-04, all live)

| SC | Result |
|---|---|
| SC-001 | PASS — 5/5 agent quotes with the Alchemy budget at 1 req/s (warmed proxy); cold-start caveat in research.md |
| SC-002 | PASS — 23 served chunks, 0 contain the provider key; **rotation still pending (human step — runbook artifact)** |
| SC-003 | PASS — identical 2000-block getLogs: 1652ms cold → 30ms cached (upstream counters flat on repeat) |
| SC-004 | PASS (by construction + drill) — 15 req/s hard budget; overflow observed failing over, not erroring |
| SC-005 | PASS — panel live in the real console (Playwright, admin wallet); tri-state honest; anonymous route 404 |
| SC-006 | PARTIAL — AA routing proven live (supportedEntryPoints + bundler validation reply through the proxy); the full session-key user journey deferred to its next real use |
| SC-007 | PASS — rollback drill + the SC-008 outage windows all recovered by env/service restore well under the bound |
| SC-008 | PASS — exit-offline drill: /exit read real vault state with the proxy CONFIRMED dead (spec `e2e/pw/exit-offline-drill.spec.ts`, gated on PW_EXIT_DRILL=1) |

**Operational lesson recorded**: Coolify service stop/start requests are QUEUED and can execute
out of order with subsequent requests — during the SC-008 drill a stop landed after a start,
extending the planned ~2-min window to ~10 min. Sequence drills as: request → CONFIRM state
via a live probe → act; never chain a second lifecycle request while one is pending.
