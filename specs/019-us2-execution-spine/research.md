# Phase 0 — Research & Design Decisions: US2 Execution Spine

Every decision below is grounded in the as-built codebase (a full 9-subsystem ground-truth map), the
authoritative contract (`contracts/agent-service-api.md` §2.1/§3.5/§3.6), the data-model (§11/§12),
and the constitution (N1–N5, fail-closed). No NEEDS CLARIFICATION remain.

---

### R1 — Signing mode on testnet: `eoa_call` / `per_action`, not ERC-4337 `userOp`

- **Decision**: build-tx materializes `opType="eoa_call"` steps (a direct owner-signed call to the
  allowlisted vault) with `execMode="per_action"`. The `userOp` field in the wire `IntentBundle`
  stays `null` (present for schema parity, exercised only when US6 lands).
- **Rationale**: no ERC-4337 `SparkPointAccount` is deployed on Base Sepolia (that IS US6, still
  deferred — `docs/phase-3-deferred.md` row 1). The owner EOA is `account == owner` today (the BFF
  sets both from the SIWE session). The existing manual vault flow already signs EOA `writeContract`
  legs successfully, proving the path. Constitution N3 default is "per-action user signature."
- **Alternatives rejected**: (a) deploy the AA stack now — that is a separate hard-infra feature
  (US6) with an unresolved ERC-7562 bundler-validation issue; out of scope. (b) block on US6 — would
  strand the whole spine; the contract explicitly supports `eoa_call`.

### R2 — `/build-tx` receives the FULL proposed action (no recommendation dereference)

- **Decision**: the request body carries the complete `action` object (`type`, `asset` address,
  `decimals`, `amount`, optional `params`, optional `recommendationId`). The server does NOT look up
  a stored recommendation.
- **Rationale**: there is **no recommendation store** — `/recommendations` ids are deterministic
  `rec_{strategy_kind}` (recompute-and-match) and `/chat` ids are ephemeral UUIDs; neither maps to a
  stored action. This matches the contract §3.5 request shape exactly. `recommendationId` is a link
  hint for the outcome ledger, never required to build.
- **Alternatives rejected**: a recommendation store — larger scope, and the contract already puts the
  full action in the build request.

### R3 — The build pipeline is an async orchestrator, NOT the sync `agentic_loop.execute`

- **Decision**: implement build-tx as an async orchestration in `execution/orchestrate.py` that runs
  the ordered steps (decode → prove-deployed/assemble → build → simulate → evaluate → gate → persist),
  reusing `policy.evaluate()`, the `sim` engine, and the 018 calldata encoders directly.
- **Rationale**: `coordinator/agentic_loop.execute` is a **sync** skeleton whose `Simulator` Protocol
  is `simulate(action, artifact) -> object`, while the real `sim/simulator.py` engine is **async**
  `simulate(request) -> SimulationResult`, and the FastAPI handlers are async. Forcing the sync loop
  would require an async→sync bridge + an adapter for a signature mismatch — more complexity than
  value. The async orchestrator honors the identical ordered/fail-closed contract while staying
  idiomatic with the 018 handlers. `agentic_loop` remains as the documented conceptual reference.
- **Alternatives rejected**: adapt `agentic_loop.execute` — signature mismatch + sync/async friction;
  net negative. (The `UnsignedArtifact.signature=None` type-level invariant is preserved in our
  models regardless.)

### R4 — Simulation provider: reuse the 018 `ViemEthCallChecker` live dry-run for vault custody ops

- **Decision**: build-tx and `/simulate` use the same `DryRunner` seam as 018
  (`ViemEthCallChecker.check`, provider `viem_eth_call`) for the oracle-free vault deposit/withdraw
  path. `SimulationResult.provider` is labeled honestly. Swaps (`aerodrome_swap`) fail closed
  (`SIMULATION_UNAVAILABLE`) — no Base-Sepolia Aerodrome, and swaps must NOT fall back to viem.
- **Rationale**: the vault path is oracle-free (ERC-4626 share accounting), so a live `eth_call`
  dry-run + `eth_estimateGas` is a real, deterministic-enough preview (the constitution generalized
  "simulation" to any provider-neutral simulator — Anvil fork or eth_call dry-run). The anvil-fork
  engine exists but needs a `SIM_FORK_RPC_URL` and is heavier; the balance-delta enrichment it adds is
  not required for the vault preview (we source `sharesOut`/`assetsOut` from `previewDeposit`/
  `previewRedeem` exactly as 018 does). Anvil fork is the upgrade path (swaps, richer deltas).
- **Alternatives rejected**: mandate anvil-fork now — heavier infra for no testnet gain on the vault
  path; swap sim is mainnet-gated anyway.

### R5 — 0021 migration: nullable-UUID for absent FK referents + `ALTER` for the circular FK

- **Decision**: `intent_bundles.recommendation_id` and `user_id` are **plain nullable UUID** (no
  `REFERENCES`) because `recommendations`/`session_keys` tables don't exist. Create `intent_bundles`
  and `simulation_results` first, then `ALTER TABLE intent_bundles ADD CONSTRAINT ... FOREIGN KEY
  (simulation_result_id) REFERENCES simulation_results(id)` to resolve the circular FK.
  `simulation_results.intent_bundle_id` and `executions.intent_bundle_id` keep their FK (target
  created first). Enums use a `DO $$ … EXCEPTION WHEN duplicate_object …$$` idempotency guard (there's
  no `CREATE TYPE IF NOT EXISTS`).
- **Rationale**: writing a FK to a non-existent table fails the migration. This is the exact trap the
  data-model map flagged. PKs are `UUID DEFAULT gen_random_uuid()` (v4; data-model says "v7 preferred
  app-side" but no helper exists — stay consistent with the E-table convention, and `intent_bundles.id`
  as UUID is what downstream attribution assumes).
- **Alternatives rejected**: create the referent tables now — out of scope (recommendations store is
  R2's rejected option; session_keys is US6).

### R6 — Durable submit de-dup on the `executions` unique key, not the idempotency scaffold

- **Decision**: `POST /build-tx` reuses the global process-local `Idempotency-Key` replay (fine — a
  build is inert and re-buildable). `POST /submit-signed-tx` gets durable de-dup via a **UNIQUE
  constraint on `executions.intent_bundle_id`** (one submitted execution per intent): a second submit
  for the same intent `INSERT ... ON CONFLICT DO NOTHING RETURNING id` returns the existing row rather
  than double-recording.
- **Rationale**: the process-local idempotency store is a scaffold that doesn't survive restarts or
  span workers (its own docstring says prod needs Postgres/Redis). A signed submit can broadcast real
  funds, so its de-dup must be durable — the `executions` table IS that durable key. This is exactly
  the data-model's intended durable dedup anchor.
- **Alternatives rejected**: build the Postgres/Redis idempotency backing store now — larger scope;
  the executions unique key gives the needed guarantee for the one endpoint that matters.

### R7 — Byte-match binding: the drawer signs the server calldata VERBATIM

- **Decision**: the `ExecutionDrawer` signs `wagmi.sendTransaction({ to: step.to, data: step.data,
  value })` using the exact server-issued `steps[0].data` — never `writeContract` re-encoding. The
  relay's `/submit-signed-tx` then asserts the signed `to`/`data`/`value` byte-match the issued bundle.
- **Rationale**: today the manual flow re-encodes calldata client-side at sign time, so there is **no
  byte-match** between what was simulated and what is signed (a real gap the map surfaced). Signing the
  server bytes verbatim closes that gap (SC-005) and makes the contract's byte-match validation (§3.6)
  meaningful. It also moves the recipient-forcing trust root server-side (the client check stays as
  defense in depth).
- **Alternatives rejected**: keep client re-encoding — defeats the whole point of a server-materialized
  IntentBundle and the byte-match contract.

### R8 — N2 (withdraw-is-sacred) enforced in TWO independent layers + a real parity test

- **Decision (N2)**: the exit path (`Direction.EXIT`) is protected twice — (a) the orchestrator skips
  the cap/pause **gather** and never runs the sim as a gate on an exit, and (b) `policy.evaluate()`
  structurally skips caps/pause/mandate/freshness for `Direction.EXIT` (already tested against a
  hostile ctx). build-tx for a withdraw/redeem returns a signable bundle even when paused + at cap +
  stale + no sim, and never returns `KILL_SWITCH_PAUSED`/`CAP_*`/`DATA_STALE` for an exit. The
  direct-RPC `/exit` path is not touched.
- **Decision (parity)**: because the current policy-parity CI only compares 6 numeric/address
  constants (enum/model parity is convention-only, despite stale "T098" comments), add a real
  zod⟷pydantic field-set parity test for the new `IntentBundle` / `SimulationResult` /
  `WirePolicyVerdict` models so a future drift is caught.
- **Rationale**: N2 is a NON-NEGOTIABLE constitution invariant and the single most safety-critical
  property here; defense-in-depth is warranted. The parity test converts an aspirational comment into
  an enforced guarantee for the models this feature adds.
- **Alternatives rejected**: rely on `evaluate()` alone for N2 — correct but the orchestrator should
  not even gather gating reads on an exit (avoids any accidental future coupling). Rely on the
  comment-only parity — a silent wire drift would be a latent client-breaking bug.

---

**All unknowns resolved.** Proceed to Phase 1 (data-model, contracts, quickstart).
