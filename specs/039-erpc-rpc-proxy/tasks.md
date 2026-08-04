# Tasks: RPC Proxy — resilient, cached chain access

**Input**: Design documents from `/specs/039-erpc-rpc-proxy/` (plan.md, research.md, data-model.md, contracts/, quickstart.md)
**Branch**: `feat/039-erpc-rpc-proxy`

**Conventions**: `[P]` = parallelizable (different files, no pending dependency). `(operator-confirmed)` = a Coolify/infra/credential mutation — per repo rule it is proposed by the session and executed only on explicit operator confirmation. Every cutover task cites its quickstart gate; a stage does not start until the previous stage's gate passed.

## Phase 1: Setup — proxy IaC authored in-repo

- [X] T001 Author `ops/erpc/erpc.yaml`: projects `core` (secret auth) + `app` (CORS allowlist, own budget); upstreams alchemy-base-sepolia (budget `alchemy-free` 15 req/s, auto-tune, `ignoreMethods: [eth_getLogs]`), base-sepolia-public (`ignoreMethods`: the five AA methods; getLogs auto-split on), publicnode-eth (chain 1), robinhood-public (chain 46630); Stage-A finalized-only memory cache (512 MB); hedging/retry/timeout per plan artifact §5. Config invariants 1–7 of `contracts/proxy-endpoints.md` all hold; secrets via env interpolation only.
- [X] T002 [P] Author `ops/erpc/compose.yaml`: pinned `ghcr.io/erpc/erpc` tag (never `latest`), ports 4000 + 4001 (4001 LAN-only), `GOMEMLIMIT` ≈ 90% of the container memory limit, healthcheck wired.
- [X] T003 [P] Author `ops/erpc/ROLLBACK.md`: the authoritative before-values env table (from `contracts/proxy-endpoints.md` map + current live values), one-line restore per stage, ≤5 min drill script. This is the runbook the console links to.

## Phase 2: Foundational — proxy live, zero consumers (quickstart Stage 0)

- [X] T004 (operator-confirmed) Create Coolify service `sparkpoint-erpc` from `ops/erpc/`, set `ERPC_CORE_SECRET` + provider URLs as service env, attach the public FQDN for the `app` lane.
- [X] T005 Run quickstart Stage 0 checks 1–3: `eth_chainId` correct on every lane/network (0x14a34 / 0x1 / 0xb626), 2000-block finalized `eth_getLogs` succeeds then repeats as a cache hit, `sepolia.base.org` accepts eRPC's UA (no 403 in logs).
- [X] T006 Capture the real `erpc_*` metric series names from `:4001/metrics` into `specs/039-erpc-rpc-proxy/research.md` (append a "Stage-0 captured metrics" block) — these are the ONLY names `rpcProxyTiles` may reference.
- [X] T007 (operator-confirmed) Add the Uptime Kuma monitor for the proxy healthcheck (FR-018); confirm UP.

**Checkpoint**: proxy serving all three networks, cache proven, metric names pinned, monitored — no production traffic touched yet.

## Phase 3: User Story 1 — chain reads survive provider failure (P1) 🎯 MVP

**Goal**: agent + indexer traffic rides the proxy; provider throttling becomes invisible.
**Independent test**: quickstart Stage 2 throttle drill — scripted session with Alchemy budget crushed to ~1 req/s completes with zero user-visible errors (SC-001).

- [X] T008 [US1] (operator-confirmed) Stage 1 cutover: agent env `VAULT_INDEX_RPC_URL` → `…/core/evm/84532`; redeploy agent; watch-restart if `exited:unhealthy`.
- [X] T009 [US1] Verify quickstart Stage 1: `indexer_cursors` advance ≥3 ticks on all three streams, no window-shrink events, revenue rows ingest; then run the rollback drill once, stopwatch ≤5 min, re-apply (SC-007).
- [X] T010 [US1] (operator-confirmed) Stage 2 cutover: agent env `BASE_SEPOLIA_RPC_URL`, `ETH_MAINNET_RPC_URL`, `ROBINHOOD_RPC_URL` → core lane; redeploy agent.
- [X] T011 [US1] Verify quickstart Stage 2 (browser run, not just green tests): `/readyz` chain_rpc + chain_identity green (FR-014); chat turn → deposit quote → sim → sign; portfolio; premium verify; SIWE SRK-gate via `/core/evm/1`; session-key automation end-to-end with the UserOp served by Alchemy only (FR-005, SC-006).
- [X] T012 [US1] Throttle drill (SC-001): temporarily set `alchemy-free` budget ≈1 req/s, run the scripted session — zero user-visible chain-read errors; restore budget.

**Checkpoint**: US1 shippable — all server-side chain traffic resilient. Browsers still direct (US2).

## Phase 4: User Story 2 — the provider credential leaves the browser (P2)

**Goal**: browsers ride the `app` lane; the Alchemy key exists only server-side and is rotated.
**Independent test**: served-bundle grep = 0 provider hits; old key dead; `/exit` works with the proxy stopped.

- [X] T013 [P] [US2] Pin `/exit` reads to public endpoints (N2/FR-016): give `apps/web/src/lib/chain/exit.ts` a dedicated viem client on the chain's public default RPC, ignoring `NEXT_PUBLIC_*` proxy values; adjust `apps/web/src/lib/chain/clients.ts` only if a helper is needed. Unit-test the client selection as a leaf module if extracted.
- [ ] T014 [US2] (operator-confirmed) Stage 3 cutover (after T013 is deployed): web env `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` → `https://<fqdn>/app/evm/84532`, server-side `BASE_SEPOLIA_RPC_URL` → core lane; redeploy web; verify the deploy actually served (fetch the page, not the deploy status).
- [ ] T015 [US2] Verify quickstart Stage 3: CORS allows platform origin / refuses foreign (FR-008); real-browser sweep (swap-quote typing fan-out, `/fees` + `/trust` polls, faucet + premium balances); served JS chunks `grep -c 'g.alchemy.com'` = 0 (SC-002); `/exit` correct with proxy container stopped, then restart (SC-008); budget tile/metrics never exceed 15 req/s during the sweep (SC-004).
- [ ] T016 [US2] (operator-confirmed) Rotate the Alchemy key in the provider dashboard; update Coolify service env + `ops/erpc/ROLLBACK.md`; confirm app healthy and the OLD key no longer authenticates (SC-002).

**Checkpoint**: US2 shippable — no secret in any browser artifact.

## Phase 5: User Story 3 — operators see RPC health in the System console (P3)

**Goal**: sixth read-only "RPC proxy" section in `/admin/system`, honest tri-state tiles.
**Independent test**: Playwright renders live tiles; proxy-down drill shows "unreachable" while the other five sections render; anonymous route hit → 404.
**Note**: T017–T020 are code-parallel with Phases 3–4 (route reads target from env; panel handles unreachable) but merge only via Phase 6.

- [X] T017 [P] [US3] Create `apps/web/src/lib/admin/rpcProxyTiles.ts` — pure leaf (no `@/` value imports): parse the T006-captured series into `RpcProxySnapshot` (data-model.md §1) and derive tiles per the §2 contract (absent → "not reported", never amber; unknown upstream ids still render).
- [X] T018 [P] [US3] Create `apps/web/src/lib/admin/rpcProxyTiles.test.ts` pinning: the verbatim T006 metric names, tri-state derivation, clamping rules, and the unreachable/not-configured shapes; `typecheck:test` green.
- [X] T019 [US3] Create `apps/web/src/app/api/admin/rpc-proxy/route.ts` per `contracts/admin-metrics-api.md`: admin gate copied from the existing admin-only server surface (anonymous → 404), `RPC_PROXY_METRICS_URL` env, ~2 s fetch timeout, ~5 s response cache, typed JSON only (never raw metrics text), `reachable:false` as a 200 state.
- [X] T020 [US3] Create `apps/web/src/components/admin/RpcProxyPanel.tsx` (15 s poll): status tiles, upstream table (health dot + text, share, p50/p95, errors, breaker), cache hit-rate + traffic figures, read-only links (endpoints, metrics, Kuma, `ops/erpc/ROLLBACK.md`) — no mutating controls (FR-013); then register the sixth section `{ id: "rpc", label: "RPC proxy" }` in `apps/web/src/app/admin/system/page.tsx`.
- [ ] T021 [US3] Playwright spec (existing minted-`sp_session` pattern, `domcontentloaded` + long hydration budget): section renders live data; proxy-down drill → "unreachable" while the other five sections render; anonymous `/api/admin/rpc-proxy` → 404; spot-check 15 s staleness (SC-005).
- [ ] T022 [US3] (operator-confirmed) Set web env `RPC_PROXY_METRICS_URL=http://sparkpoint-erpc:4001/metrics`.

**Checkpoint**: US3 shippable — console section live against the real proxy.

## Phase 6: User Story 4 — repeat reads stop costing money (P4)

**Goal**: prove the Stage-A cache + dedup earns its keep (config shipped in T001).

- [ ] T023 [US4] Backfill economics (SC-003): reset a scratch indexer cursor (or replay a bounded historical range through the core lane) twice; second pass ≤1% of the first pass's upstream calls; first pass needed no range tuning (FR-006). Record numbers in quickstart.md's acceptance table.
- [ ] T024 [P] [US4] Dedup + mutable-data checks: two concurrent identical finalized reads → one upstream call (FR-004); repeated `eth_call` balance reads each hit upstream — confirm NOTHING mutable is cached (FR-003), and grep `ops/erpc/erpc.yaml` asserts no non-finalized cache policy exists.

## Phase 7: Polish & ship

- [X] T025 [P] Update `CHANGELOG.md` (developer entry: proxy, cutover stages, key rotation, console section) — FR-017.
- [X] T026 [P] Add the client-facing in-app entry to `services/agent/content_seed/whats-new.json` (semi-technical: reliability + key-hygiene framing, honest about what changed) — FR-017; both-surfaces gate applies, no direct-to-develop push.
- [ ] T027 Run the full quickstart acceptance sweep (SC-001…SC-008 table) and check off; fix anything found before PR.
- [ ] T028 (operator-confirmed) Open the PR `feat/039-erpc-rpc-proxy` → `develop` with the changelog gate satisfied; merge on approval; verify the web deploy actually served the new commit.

## Dependencies & execution order

```text
Phase 1 (T001–T003, parallel after T001)
  → Phase 2 (T004 → T005 → T006, T007)
      → Phase 3 [US1] (T008 → T009 → T010 → T011 → T012)
          → Phase 4 [US2] (T013 ∥ earlier; T013 → T014 → T015 → T016)
      → Phase 5 [US3] code (T017 ∥ T018 after T006; → T019 → T020 → T021; T022 after T004)
  → Phase 6 [US4] (T023 after T008; T024 after T004)
  → Phase 7 (T025 ∥ T026 → T027 → T028)
```

- **US1 is the MVP** (proxy + server-side resilience); US2, US3, US4 are each independently shippable increments on top.
- Parallel opportunities: T002∥T003; T017∥T018 (after T006) run while Phases 3–4 proceed; T023/T024 anytime after their gates; T025∥T026.
- Hard gates: T006 before any tile code (metric names are never guessed); T013 deployed before T014 (exit must be off the proxied client before browsers cut over); T015's grep before T016 (rotate only after the bundle is clean).

## Implementation strategy

Ship US1 first and soak (it alone removes the standing fragility); US2 next (smallest change, biggest security win — includes the N2 exit pin); US3 as the only real code PR, developed in parallel from Stage 0's captured metrics; US4 is measurement, not construction. Every stage carries its own rollback and its own live browser verification — the repo's standing lesson (029/034): a green suite proves the code runs, the browser run proves the output.
