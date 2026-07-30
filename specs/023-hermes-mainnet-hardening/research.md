# Research: Hermes Mainnet Hardening (feature 023)

**Date**: 2026-07-30 · **Baseline**: `develop@03b7ed4` (793 pytest green, `ruff check src` clean,
strict mypy clean / 122 files)

Each section states the decision, the rationale, and the alternatives rejected — the resolved unknowns
that `plan.md` builds on. Everything here was read from the tree at the baseline commit; no behavior is
inferred from documentation alone.

---

## 1. Where to enforce chain identity (FR-023-001 … 004)

**Decision.** Two independent layers, deliberately:

1. **Static** — `_resolve_rpc_url` stops cross-chain fallback. Give each supported chain an explicit,
   ordered env list that contains **only** urls that can legitimately serve that chain:
   `8453` → (`SPARKPOINT_RPC_URL`, `BASE_MAINNET_RPC_URL`); `84532` → (`SPARKPOINT_RPC_URL`,
   `BASE_SEPOLIA_RPC_URL`); `31337` → (`SPARKPOINT_RPC_URL`, `SIM_FORK_RPC_URL`); `46630` unchanged
   (override → public RPC). Note this *also* removes `SIM_FORK_RPC_URL` from the `84532` chain's list,
   which today can silently serve a Base-mainnet fork as Sepolia — the same class of bug, opposite
   direction.
2. **Dynamic** — a cached `eth_chainId` assertion, modelled on the existing `_llm_ready` probe in
   `api/main.py` (a TTL-cached async check, not a boot-blocking call). Three states, not two:
   `verified` / `mismatch` / `unknown` (RPC unreachable). `mismatch` and `unknown` both fail the
   chain-dependent surface closed; only `mismatch` is a latched, non-retryable configuration error, while
   `unknown` re-probes on the next TTL expiry.

**Rationale.** The static fix alone cannot catch the realistic mainnet incident — an operator sets
`SPARKPOINT_RPC_URL` to the *wrong* url (a copied develop value). Only reading the chain catches that.
Conversely the dynamic check alone would let a deployment start "working" off a fork url until the first
probe. Both are cheap; neither is sufficient.

**Rejected.**
- *Fail at boot / refuse to start.* Contradicts an explicit, load-bearing design decision in
  `api/main.py`: startup must never block on I/O, because a bounded-but-slow dependency gets the
  container killed and the data layer is never on the custody path. A mainnet instance that refuses to
  boot on a transient RPC blip is worse than one that boots and honestly reports not-ready.
- *Per-request `eth_chainId`.* An extra RPC round-trip on every read for a value that changes only on
  redeploy. The TTL cache is the same trade the LLM probe already makes.
- *Trusting `CHAIN_ID` alone with better docs.* Prose does not stop a misconfiguration; this is exactly
  the playbook's "deterministic beats advisory".

**Threat-model note (explicit, so the guarantee is not overstated).** The assertion catches
**misconfiguration**, not a hostile RPC: a provider that lies about `eth_chainId` defeats it. The
operator's choice of provider is trusted, as it already is for every other read.

**Blast radius.** The gate must wrap the *chain-dependent* surface only — vault quotes/simulations,
portfolio, outcomes, build/simulate/submit, session-key builds. It must **not** gate `/healthz`, chat's
non-chain paths, the admin content/persona/knowledge surfaces, or anything the frontend's direct-RPC exit
depends on (N2). Cleanest seam: the existing `get_sim_config` / `get_vault_reader` FastAPI dependencies,
which every chain-dependent route already goes through, plus `VaultUnavailable` as the established
fail-closed envelope carrier — a new `VaultUnavailableReason` member rather than a new exception type.

---

## 2. Readiness semantics (FR-023-005, 006)

**Decision.** Replace the two env-presence booleans with checks derived from the resolved config for the
served chain:
- `chain_rpc` — an RPC url resolved for `CHAIN_ID` (config, not a raw env name).
- `chain_identity` — the §1 probe returned `verified`.
- `sim_fork` — keep, but make it honest about what it gates: the fork simulator is required for the
  **swap** path only, which is not live on the vault-only surface. It should therefore not be able to
  hold `ready` false on a vault-only deployment. Report it, and include it in `ready` **iff** a
  swap-capable action is allowlisted for the served chain.

**Rationale.** `ready` should mean "can serve what this deployment is for". Today a mainnet instance
configured entirely correctly reports not-ready (no `BASE_SEPOLIA_RPC_URL`), and one carrying a stale
Sepolia url reports ready while serving mainnet. Both break the orchestrator's and Kuma's ability to tell
truth from noise, and the second is the dangerous one.

**Rejected.** *Adding `chain_identity` while leaving the existing checks untouched.* Cheapest diff, but
leaves the permanently-red mainnet deployment — the operator would learn to ignore `/readyz`, which is how
a real outage gets missed.

**Preserved.** The anonymous response stays a bare `{"ready": bool}`; the per-dependency breakdown and
`policy_version` stay S2S-only. The chain-id **values** may appear in the S2S breakdown (they are public
facts); the RPC **url** never appears anywhere, in any log line, because it can carry a key.

---

## 3. Gas estimation for the session-key UserOp (FR-023-007 … 009)

**Decision.** Call the existing, unused `bundler.estimate_user_op_gas` with a fee-populated draft op, then
clamp. Fees come from `eth_maxPriorityFeePerGas` + the pending block's `baseFeePerGas` with a documented
multiplier; limits come from the estimator. Every value is clamped to a named floor/ceiling constant
(`_MIN_*` / `_MAX_*`), and the constants are named for the bound they express, not the chain they were
proven on.

**Concrete starting values** (pinned here so they are reviewable, not invented at implementation time):

| Field | Source | Floor | Ceiling |
|---|---|---|---|
| `maxFeePerGas` | `2 × pending baseFeePerGas + maxPriorityFeePerGas` | 1 gwei / 1000 (0.001 gwei) | 5 gwei |
| `maxPriorityFeePerGas` | `eth_maxPriorityFeePerGas` | 0.0001 gwei | 1 gwei |
| `callGasLimit` | estimator | 100 000 | 2 000 000 |
| `verificationGasLimit` | estimator | 100 000 | 1 000 000 |
| `preVerificationGas` | estimator | 50 000 | 2 000 000 |

The `2×` base-fee headroom is the common bundler convention: it lets the op survive several blocks of
base-fee growth without over-committing, and on an OP-Stack L2 the base fee is small enough that the
absolute overpay is negligible. The floors are at or below the values proven live on Base Sepolia
(feature 022) so nothing that works today regresses; the ceilings sit roughly an order of magnitude above
observed mainnet values so a bundler quirk or a gas spike is bounded rather than unbounded. **These are
starting values, not physics** — they belong in one named block with a comment saying so, and adjusting
them is a visible edit rather than a hidden constant.

**Rationale.** `preVerificationGas` on an OP-Stack L2 covers the L1 data-posting cost and moves with
Ethereum mainnet gas; `maxFeePerGas` at 0.05 gwei is a Base-Sepolia artifact. Both are inside the
`userOpHash`, so the client signs them and cannot repair them — a wrong envelope is unrecoverable without
a rebuild. The estimator is the only source that is right by construction on both chains.

**Ordering subtlety (the part that is easy to get wrong).** `eth_estimateUserOperationGas` on most
bundlers wants the fee fields already populated, and Rundler validates the op's signature field shape.
The draft therefore needs a **dummy signature of the correct length** — 66 bytes in this scheme
(`mode ‖ r ‖ s ‖ v`) — or the estimate is rejected or mis-sized. This must be a named constant with a
comment tying it to `SESSION_SIGNATURE_MODE`, and a test must assert the dummy's length equals the real
signature's, so the two cannot drift.

**Rejected.**
- *Keep constants, raise the ceilings.* Trades a guaranteed failure for an unbounded overpay and still
  breaks the first time L1 gas spikes past the new guess.
- *Let the client estimate and send its own envelope.* The service byte-matches only `sender` and
  `callData`, so the client can already choose its envelope; making that the *primary* path would move a
  correctness input out of the service and weaken the SC-005 story rather than strengthen it.
- *Estimate once and cache per chain.* Fees are the volatile half; a cache reintroduces the bug.

**Fail-closed.** No fallback envelope. An estimator or fee-read failure returns no UserOp — consistent
with `build_session_userop`'s existing contract (it already returns `None` when the EntryPoint nonce can't
be read, and the caller fails closed rather than fabricating).

---

## 4. Submit-path expiry and mode agreement (FR-023-010 … 012)

**Decision.** Check both on the **UserOp branch only**, before the bundler is contacted:
`expires_at` (from the loaded bundle row) and `is_session_key_path`. Two distinct reasons —
`BUNDLE_EXPIRED` and an exec-mode mismatch — separate from the existing byte-match failure. The
wallet-path branch is untouched.

**Rationale.** The asymmetry is deliberate and load-bearing, so it is worth stating plainly in the code:
on the wallet path submit is a *correlation relay* — the transaction is already on-chain, so rejecting it
would only destroy the outcome record (US5 attribution) while stopping nothing. On the session-key path
submit *is* the submission, so the same check is the difference between a cooperative and a structural
guarantee.

**Implementation note.** `_BundleWithId` currently exposes only `id_str`, `chain_id`, `kind`, `steps` and
`smart_account_address`. It must carry `expires_at` and `is_session_key_path` — a two-field addition to a
private adapter class over a row the store already selects (`intent_bundles.expires_at` and
`is_session_key_path` are both in the 0021 schema and in the store's select list), so no query change and
no migration.

**Clock.** Compare against `datetime.now(UTC)` with **no** tolerance window. A tolerance would be a
second, undocumented TTL; if the 180 s bundle TTL is too tight in practice that is a change to
`_BUNDLE_TTL_SECONDS`, made deliberately and visibly, not a fudge factor hidden in the submit path.

**Rejected.** *Re-running `evaluate()` at submit time instead of checking expiry.* Strictly stronger, and
tempting — but it needs a fresh simulation and fresh chain reads inside a request whose job is to relay,
turns a fast path into a slow one, and can reject a move the user already signed. The bundle TTL exists
precisely so that re-evaluation is a *rebuild*, not a *submit* concern. Deferred as a possible Gate-C
audit recommendation, not adopted here.

---

## 5. Idempotency scoping and durability (FR-023-013 … 015)

**Decision.** A composite scope plus a Postgres-backed store (operator's clarify decision):

- **Scope** = `(account, method, path, Idempotency-Key)`. `account` is the middleware's already-parsed
  `X-Account`; `method` and `path` prevent a key valid for one route replaying onto another.
- **Store** = `idempotency_records` via migration `0026` (additive, idempotent, `IF NOT EXISTS`), with a
  unique constraint on the scope, first-write-wins semantics preserved, and a bounded retention sweep
  (bundles are short-lived, so retention can be measured in hours, not forever).
- **Failure posture** = **fail open for serving.** A store outage admits the request. This mirrors the
  data layer's standing rule (a derived accelerator is never on the withdraw/exit path) and matches how
  the quota gate already behaves. Idempotency is a double-emit guard on an *advisory build*, not a custody
  gate; making it fail closed would invent a new way for a DB blip to block a user's build.

**The cost of fail-open, and the guard for it.** Failing open means a *missing table* is
indistinguishable from a working store at the request level — so a deploy landing before `0026` is applied
would silently run with no replay protection: no error, no failing check, nothing in `/readyz`. Two
controls, because the ordering alone is a process promise:

1. **Ordering** — `0026` is applied *before* the agent is redeployed (the standard
   migration-before-deploy rule this repo already follows; `0026` is additive, so the currently-live agent
   ignores it).
2. **Observability** — the store logs a **distinct** warning the first time it finds the table absent
   (not the generic "store unavailable" path), so the degraded state is visible in the agent log rather
   than inferred. This is the same reasoning as the `/readyz` work in §2: a silent wrong-state is worse
   than a loud one.

**Rationale for scoping being the security half.** The cache is keyed today on a value the *client*
supplies, with no tenant component — the textbook multi-tenant cache-poisoning shape, and the R1 audit's
open medium. It is also the cheapest fix in the feature.

**Rejected.**
- *Hashing the request body into the key.* Would catch a same-key-different-payload replay too, but §1.3
  specifies replay-returns-the-original, and body-sensitivity would silently change that contract.
- *Redis.* A new dependency and a new failure mode for a table Postgres already suits; the repo has no
  Redis and the playbook's stack preferences don't add one for this.
- *First-write-wins via `ON CONFLICT DO NOTHING` then re-read.* Adopted, actually — it is the direct SQL
  expression of the current in-memory `setdefault` semantics, so behavior is preserved exactly.

**Concurrency note.** The current in-memory store holds an `asyncio.Lock` so concurrent replays within a
worker are consistent. Postgres's unique constraint provides the same guarantee *across* workers; the
lock can stay for the in-process fast path but must not be relied on for correctness.

---

## 6. Retaining the superseded scaffolding (FR-023-016)

**Decision** (operator's clarify choice): keep `coordinator/coordinator.py`, `coordinator/flows.py` and
`coordinator/agentic_loop.py`; add an unmistakable `SUPERSEDED — NOT EXECUTED` header naming
`execution/orchestrate.py` as the live path; rewrite every present-tense claim that these modules *are*
the interposition into reference tense. Add a test that (a) the markers exist and (b) no module outside
`coordinator/` imports the superseded symbols.

**Rationale.** The risk being closed is *an auditor believing the wrong module is load-bearing*. A marker
plus an enforcing test closes that as well as deletion does, and keeps two things deletion would lose:
the documented per-flow `AgentSpec`→DAG mapping (the only place the five-agent flow order is written as
code) and the design-intent record for the read/execution split. The test is what stops the claim rotting:
a prose marker alone is exactly the "prose never stopped an agent" failure the playbook warns about.

**Rejected.** *Deletion* — cleaner grep, but discards the flow mapping and the intent record, and the
`coordinator/__init__.py` re-export surface would need pruning with no functional gain.

---

## 7. The remaining single-process assumption (FR-023-019)

**Decision.** Document, warn, do not externalize. After §5 the only correctness-by-single-worker mechanism
left is the process-global LLM concurrency limiter (`llm/resilience.py`, `max_inflight` 1–2). Record it as
a hard deployment constraint in `DEPLOYMENT.md` + `COOLIFY.md`, and emit a loud startup warning when a
multi-worker configuration is detected (`WEB_CONCURRENCY` / `UVICORN_WORKERS` > 1).

**Rationale.** Post-§5 the limiter guards **cost and upstream rate limits**, not custody or correctness of
any signable artifact — so the proportionate control is visibility, not a distributed semaphore. A
DB-backed limiter would add a round-trip to every model call to protect a budget the LiteLLM virtual key
already caps server-side.

**Rejected.** *Externalizing to Postgres/Redis* — real work, new failure mode, protects something the
gateway's own rpm/tpm/daily-budget limits already protect. *Failing closed on >1 worker* —
disproportionate: it would take a service down over a cost control.

---

## 8. Documentation and lint drift (FR-023-017, 018)

**Decision.** Correct `api/portfolio.py`'s module docstring and the two model docstrings to describe what
018/020 actually shipped (cost basis, realized and unrealized PnL computed from the indexed flows and
gated on `basis.reconciles`; the per-position event history and series remain honestly absent). Fix the
`0025_session_keys.sql` header's stale `0024` self-reference. Extend CI to `ruff check .` and clear the 52
`E501`s (39 in the two newest notification test files) by reflowing — **no** `noqa`, and no line-length
change.

**Rationale.** In this codebase the docstrings *are* the invariant documentation an auditor reads; a module
that claims it returns `null` while returning real money figures is the same class of defect as a wrong
comment on a policy step. And a lint config that declares a path it never checks is a gate that only looks
like a gate.

**Rejected.** *Bumping `line-length` to silence E501* — changes house style repo-wide to avoid reflowing
nine test files. *Per-file `noqa`* — same, with more noise.

---

## 9. Test strategy

**Decision.** Every FR gets a test at the seam it protects, using the injectable boundaries the codebase
already provides — the fake `MessageTransport`/store/reader patterns in `tests/`, not the network:

| Requirement | Test shape |
|---|---|
| FR-023-001 | table-driven `_resolve_rpc_url` over (chain, env-set) → expect `None` where a cross-chain url is the only candidate |
| FR-023-002/003 | fake RPC transport returning a mismatched `eth_chainId`; assert the chain-dependent routes fail closed with the new reason and `/readyz` reports `chain_identity: false` for S2S, bare bool for anonymous |
| FR-023-004 | assert `/healthz` still 200s and that no exit-path route acquires a new dependency (extends `tests/api/test_custody_untouched.py`) |
| FR-023-007/008 | fake bundler returning known estimates; assert the emitted op carries them, that clamping applies at both bounds, and that the dummy signature length equals the real signature length |
| FR-023-009 | estimator raises / returns `None` → no UserOp, honest envelope |
| FR-023-010/011 | expired bundle and mode-mismatched bundle → rejected, **bundler never called** (assert on the fake), no `executions` row |
| FR-023-012 | expired **wallet-path** bundle → still recorded (the regression guard for the asymmetry) |
| FR-023-013/014 | two accounts, one key → two entries, no cross-hit; same account replay → original response |
| FR-023-015 | store raises → request admitted (fail-open); restart simulated by a fresh store instance over the same fake DB → replay still returns the original; the **retention sweep** purges an aged record and keeps a fresh one |
| FR-023-015a | a fake DB reporting the table as absent → the **distinct** table-missing warning is logged (not the generic store-unavailable path) and the request is still admitted |
| FR-023-019 | `WEB_CONCURRENCY=2` at lifespan start → the warning is emitted (extends `tests/api/test_app_lifespan.py`); unset or `1` → no warning |
| FR-023-016 | markers present; no import of superseded symbols outside `coordinator/` |
| FR-023-020/021 | the existing 793 remain green; the custody-seam and policy-parity CI gates unchanged |

**Rationale.** These are all pure-seam tests — no network, no live chain — which is what keeps the suite
at ~7 s and is the pattern every existing test in this service follows.
