# Tasks: Hermes Mainnet Hardening

**Branch**: `feature/023-hermes-mainnet-hardening` · **Spec**: [spec.md](./spec.md) ·
**Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

**Input**: spec.md (22 FRs, 11 SCs, 2 clarify decisions) + plan.md (Constitution Check PASS) +
the `/speckit-analyze` report (0 critical, 1 high — remediations folded in below)

## Tier ↔ Story map

The review that motivated this feature grouped the defects into **tiers by severity**; the tasks are
organized into **stories by testable outcome**. They are the same nine items seen two ways:

| Tier | What it means | Requirements | Stories / phases |
|---|---|---|---|
| **Tier 0** | The service can act on wrong facts on mainnet | FR-001…010, 013…015a | **A** (chain identity, Ph 3) · **B** (gas envelope, Ph 4) · **D** (idempotency, Ph 5) · the expiry half of **C** (Ph 6) |
| **Tier 1** | Non-custody is harder to *prove* than it should be | FR-011, 016…019 | **E** (hygiene, Ph 7) · the exec-mode half of **C** (Ph 6) |
| — | Applies to every item | FR-020, 021 | Ph 8 (T031, T032) |

Story C straddles the tiers deliberately: FR-023-010 (expiry) is a Tier-0 guarantee that is currently
only cooperative; FR-023-011 (exec-mode agreement) is Tier-1 audit fidelity with no policy consequence.
Both land in one task because they are two checks in the same branch of the same function.

## Format: `[ID] [P?] [Story] Description`

- **[P]** = parallelizable (different files, no ordering dependency on another `[P]` in the same phase).
- **[Story]** = the user story the task serves (A–E per spec.md), or `FOUND` / `POLISH`.
- Every task names its files. A task is done when its stated verification passes, not when the edit lands.

## Path Conventions

- Agent source: `services/agent/src/sparkpoint_agent/`
- Agent tests: `services/agent/tests/`
- Migrations: `services/agent/migrations/` (raw SQL, yoyo, out-of-band — never on the app hot path)
- Gates, run from `services/agent/`: `uv run --frozen ruff check .` · `uv run --frozen mypy` ·
  `uv run --frozen pytest -q`

## Definition of Done (every SparkPoint feature — feature 006)

⚠️ **This PR changes `services/agent/src/`, so the `skip-changelog` escape hatch is IGNORED**
(`changelog-required.yml`, hardened 2026-07-24). **BOTH** changelogs are mandatory — an infra-only
justification will not pass the gate.

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for the behavior/schema/infra change.
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry (new `slug`, tester-friendly,
      no dev detail). This change is not visually obvious, so it needs an **honest "behind-the-scenes"**
      entry (the gate's own error text asks for exactly this). Newest-first; keys:
      `slug, type, tag, title, body, cta_label, cta_href, published_at, active`.
- [ ] Version id left automatic (nothing hand-bumped); migration `0027` applies with
      `PGCLIENTENCODING=UTF8`; no new agent seed dir (so no new `Dockerfile` `COPY` needed — confirm).
- [ ] `changelog-required` CI green; tests / typecheck / lint green.

---

## Phase 1: Setup

- [ ] **T001** `[POLISH]` Record the baseline in the PR body: run all three gates and paste the output
      (`pytest -q` → 793 passed; `ruff check src` → clean; `mypy` → 122 files clean). Playbook §10 requires
      validation evidence in the PR; capturing it *before* any edit is what makes "no regression"
      checkable rather than asserted.

## Phase 2: Foundational (blocking prerequisites)

These unblock Stories A and D. Nothing else may start until T002–T004 are green.

- [ ] **T002** `[FOUND]` **Per-chain RPC resolution, no cross-chain fallback** —
      `src/sparkpoint_agent/config.py` `_resolve_rpc_url`. Give each chain an ordered list of only urls
      that can legitimately serve it: `8453` → (`SPARKPOINT_RPC_URL`, `BASE_MAINNET_RPC_URL`);
      `84532` → (`SPARKPOINT_RPC_URL`, `BASE_SEPOLIA_RPC_URL`); `31337` → (`SPARKPOINT_RPC_URL`,
      `SIM_FORK_RPC_URL`); `46630` unchanged. Add `BASE_MAINNET_RPC_URL` to `ALLOWED_ENV_KEYS`.
      **Removing `SIM_FORK_RPC_URL` from the `84532` list is intentional** — today a Base-mainnet fork can
      be served as Sepolia (same bug, opposite sign). Update the `require_rpc_url` message to name the
      chain's actual candidates. (FR-023-001)
      *Verify*: `_assert_no_key_material` still passes at import; existing config tests green.
- [ ] **T003** `[FOUND]` **Chain-identity probe** — NEW `src/sparkpoint_agent/chain/chain_identity.py`.
      A TTL-cached async `eth_chainId` check modelled on `api/main.py::_llm_ready`, returning **three**
      states: `verified` / `mismatch` / `unknown`. `mismatch` latches (a configuration error, not
      retryable); `unknown` re-probes on TTL expiry. Never log the RPC url — chain ids only (a url can
      carry a key). Reuse `chain/vault_reader.py`'s `JsonRpcTransport` rather than adding a client.
      **The module docstring MUST state the limit of the guarantee** — this catches *misconfiguration*,
      not a hostile RPC; a provider that lies about `eth_chainId` defeats it, and the operator's choice of
      provider is trusted as it already is for every read. An overstated guarantee is its own defect under
      Principle III, so this sentence is part of the task, not a nicety. (FR-023-002, 003)
- [ ] **T004** `[FOUND]` **Migration `0027_idempotency.sql`** — `services/agent/migrations/`.
      `idempotency_records`: the composite scope (`account`, `method`, `path`, `key`) with a UNIQUE
      constraint, the cached `status_code` / `media_type` / `body`, and `created_at` for retention.
      Additive, forward-only, `IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object` for any type.
      Header must carry the non-custody note in house style: holds **no** key material, is **never** on
      the withdraw/exit path (N2), and losing the table degrades replay protection to fail-open, never
      custody. **Name the file `0027`** and make the header's self-reference say `0027` — the `0025`
      header's stale `0024` is a defect this feature also fixes (T025). (FR-023-015)
      *Verify*: `yoyo` parses it; do **not** apply to develop yet (T029 sequences the apply).

**Checkpoint**: `pytest -q` green (793), `ruff check src` clean, mypy clean.

---

## Phase 3: Story A — misconfigured mainnet refuses to serve (P1) 🎯

The load-bearing item (plan.md). Depends on T002–T003.

- [ ] **T005** `[A]` **Gate the chain-dependent surface** — `src/sparkpoint_agent/api/vault.py`
      (`get_sim_config`, `get_vault_reader`) + a new `VaultUnavailableReason` member in
      `src/sparkpoint_agent/chain/__init__.py`. Every chain-dependent route already flows through these two
      dependencies, so this is the whole seam: vault quotes/simulations, portfolio, outcomes,
      build/simulate/submit, session-key builds. Fail closed via the **existing** `VaultUnavailable` →
      `vault_unavailable_handler` path (a canonical §1.5 envelope), **not** a new exception type.
      (FR-023-002, 003)
- [ ] **T006** `[A]` **Prove the gate does not touch the exit path** — extend
      `tests/api/test_custody_untouched.py`: `/healthz` still 200s under `mismatch`; chat's non-chain
      routes, the admin content/persona/knowledge surfaces and `/tips` are unaffected; no exit-adjacent
      route gains a new dependency. This is the N2 guard for the whole story — write it **with** T005, not
      after. (FR-023-004)
- [ ] **T007** `[P]` `[A]` **Probe tests** — NEW `tests/chain/test_chain_identity.py`: a fake transport
      returning a matching id → `verified`; a mismatched id → `mismatch` and it **latches**; a raising
      transport → `unknown` and it **re-probes** (does not latch); the TTL is honored; assert the log
      records carry no url. (FR-023-002, 003)
- [ ] **T008** `[P]` `[A]` **Config-resolution tests** — extend `tests/config/test_config.py`:
      table-driven over (chain, env-set) → expect `None` where the only candidate is a cross-chain url,
      including the two regression cases that motivated this (`8453` with only `SIM_FORK_RPC_URL`;
      `84532` with only `SIM_FORK_RPC_URL`) **and** the two non-regressions that must keep working:
      `31337` still resolves `SIM_FORK_RPC_URL` (local fork + swap simulator), and `46630` still resolves
      its override-then-public-RPC order with the vault nulled by `for_chain`.
      Also assert `_assert_no_key_material()` still passes with `BASE_MAINNET_RPC_URL` in the allowlist
      (it trips none of `PRIVATE / PRIVKEY / SECRET / MNEMONIC / SEED_PHRASE / SIGNING_KEY`). (FR-023-001)
- [ ] **T009** `[A]` **Chain-aware `/readyz`** — `src/sparkpoint_agent/api/main.py`. Replace the
      env-presence booleans: `chain_rpc` from the **resolved** config for `CHAIN_ID` (not a raw env name);
      NEW `chain_identity` from T003. Make `sim_fork` honest — it gates the **swap** path only, so it must
      not hold `ready` false on a vault-only deployment; report it always, include it in `ready` **iff** a
      swap-capable action is allowlisted for the served chain. Anonymous response stays a bare
      `{"ready": bool}`. Chain-id **values** may appear in the S2S breakdown; the url never. (FR-023-005, 006)
- [ ] **T010** `[A]` **Readiness tests** — NEW `tests/api/test_readyz_chain.py`: a mainnet-shaped config
      (no `BASE_SEPOLIA_RPC_URL`) reports **ready** (today's bug: permanently red); a Sepolia-shaped config
      still reports ready; a `mismatch` reports not-ready with `chain_identity: false`; a vault-only
      deployment with no `SIM_FORK_RPC_URL` still reports **ready** (the `sim_fork` semantics change) while
      a swap-capable chain without it does not; the anonymous response is still a bare boolean and leaks no
      key names. Confirm `tests/api/test_app_lifespan.py` still passes. (SC-023-003)

**Checkpoint**: Story A independently verifiable — SC-023-001, 002, 003 demonstrable.

---

## Phase 4: Story B — a mainnet move is priced for mainnet (P1)

Independent of Story A; may run in parallel with Phase 3 (different files).

- [ ] **T011** `[B]` **Live fee read** — `src/sparkpoint_agent/execution/bundler.py`, alongside the
      existing (and currently unused) `estimate_user_op_gas`: `eth_maxPriorityFeePerGas` + the pending
      block's `baseFeePerGas`, with a documented multiplier. Read-only; a failure returns `None` (never a
      guess). (FR-023-007)
- [ ] **T012** `[B]` **Estimator-driven envelope** — `src/sparkpoint_agent/execution/session_userop.py`.
      Replace the five module constants with: fee read → draft op → `eth_estimateUserOperationGas` →
      clamp each field to a named `_MIN_*` / `_MAX_*` bound. **Name the constants for the bound they
      express, not the chain they were proven on.** ⚠️ **The draft needs a dummy signature of the correct
      length (66 bytes: `mode ‖ r ‖ s ‖ v`)** or the estimate is rejected or mis-sized — make it a named
      constant commented back to `SESSION_SIGNATURE_MODE`. (FR-023-007, 008)
- [ ] **T013** `[B]` **Fail closed, no fallback envelope** — same file: an estimator or fee-read failure
      returns `None` from `build_session_userop`, exactly as the existing nonce-read failure does, so
      `/build-tx` with `execMode=session_key` emits no UserOp. **Never** substitute a hardcoded envelope —
      the envelope is inside the `userOpHash`, so a wrong value is signed over and unrecoverable.
      (FR-023-009)
- [ ] **T014** `[P]` `[B]` **Gas tests** — NEW `tests/execution/test_session_gas.py`: a fake bundler with
      known estimates → the emitted op carries them; clamping applies at **both** bounds; the dummy
      signature's length **equals** a real signature's (the drift guard — assert against
      `SESSION_SIGNATURE_MODE`'s scheme, not a literal); estimator `None`/raise → no UserOp.
      (SC-023-004)
- [ ] **T015** `[P]` `[B]` **Wire-parity regression** — confirm `tests/execution/test_wire_parity.py` and
      `tests/execution/test_session_userop.py` still pass: `callData` and `sender` are untouched by this
      change, so the SC-005 byte-match and the client's `userOpHash` reproduction must be unaffected. If a
      fixture pins a gas field, update it deliberately and say so in the PR body.

**Checkpoint**: Story B independently verifiable — SC-023-004.

---

## Phase 5: Story D — one wallet's bundle never served to another (P1)

Depends on T004.

- [ ] **T016** `[D]` **Composite scope** — `src/sparkpoint_agent/api/idempotency.py` +
      `src/sparkpoint_agent/api/middleware.py`. Key on `(account, method, path, Idempotency-Key)`;
      `account` is the middleware's already-parsed `X-Account`. Preserve first-write-wins and the
      "only 2xx JSON, never SSE, never errors" rule. This is the security half and the cheapest fix in the
      feature — the current key is entirely client-supplied with no tenant component (open R1 medium).
      (FR-023-013, 014)
- [ ] **T017** `[D]` **Durable store** — NEW `src/sparkpoint_agent/db/idempotency.py`
      (`PgIdempotencyStore`) behind the existing store interface, plus a bounded retention sweep (bundles
      are short-lived; retention in hours). Use `ON CONFLICT DO NOTHING` + re-read — the direct SQL
      expression of the current in-memory `setdefault`, so semantics are preserved exactly. Keep the
      in-process `asyncio.Lock` as a fast path but do **not** rely on it for correctness (the UNIQUE
      constraint is the cross-worker guarantee). (FR-023-015)
- [ ] **T018** `[D]` **Fail open on a store outage — with the silent-degradation guard** — a store error
      **admits** the request, mirroring the quota gate. Idempotency guards a double-emit on an *advisory
      build*; it must never become a new way for a DB blip to block a build (N2).
      ⚠️ **But fail-open makes a *missing table* indistinguishable from a working store at the request
      level**, so a deploy landing before `0027` is applied would run with no replay protection and no
      signal anywhere. Log a **distinct** warning the first time the table is found absent — not the
      generic store-unavailable path — so the degraded state is visible in the agent log rather than
      inferred. (FR-023-015, 015a)
- [ ] **T019** `[P]` `[D]` **Scoping + durability tests** — NEW `tests/api/test_idempotency_scope.py`:
      two accounts / one key → two entries, **zero** cross-hits; same account replay → the original
      response; a different path with the same key → not a hit; SSE and non-2xx still never cached; a
      raising store → request admitted; a **fresh store instance over the same fake DB** (the restart
      simulation) → replay still returns the original; the **retention sweep** purges an aged record and
      keeps a fresh one; a fake DB reporting the table absent → the **distinct** table-missing warning is
      logged and the request is still admitted. (SC-023-006, SC-023-011)

**Checkpoint**: Story D independently verifiable — SC-023-006, 011.

---

## Phase 6: Story C — stale or mismatched submissions cannot reach the bundler (P2)

- [ ] **T020** `[C]` **Expiry + exec-mode agreement on the UserOp branch** —
      `src/sparkpoint_agent/execution/orchestrate.py`. Carry `expires_at` and `is_session_key_path` on
      `_BundleWithId` (both are already in the 0021 schema **and** the store's select list — no query
      change, no migration). In `submit_signed`'s `opType == "userop"` branch, **before** the bundler is
      contacted: reject a bundle past `expires_at` (`BUNDLE_EXPIRED`), and reject one whose
      `is_session_key_path` disagrees with the submission mode — each with a reason distinct from the
      byte-match failure. Compare against `datetime.now(UTC)` with **no** tolerance window; a tolerance
      would be a second, undocumented TTL. **Leave the `eoa_call` branch untouched** and comment *why*:
      there, submit is a correlation relay for an already-broadcast tx, so rejecting it would only destroy
      the US5 outcome record while stopping nothing. (FR-023-010, 011, 012)
- [ ] **T021** `[C]` **Submit tests** — extend `tests/api/test_submit_signed.py`: an expired
      session-key bundle → rejected, **the fake bundler is never called**, zero `executions` rows; a
      mode-mismatched bundle → rejected; and the asymmetry regression — an expired **wallet-path** bundle
      is **still recorded**. That last one is the test that stops a future "consistency" refactor from
      silently breaking outcome attribution. (SC-023-005)

---

## Phase 7: Story E — an auditor cannot be misled (P2)

- [ ] **T022** `[E]` **SUPERSEDED markers** — `src/sparkpoint_agent/coordinator/coordinator.py`,
      `flows.py`, `agentic_loop.py`. Add an unmistakable `SUPERSEDED — NOT EXECUTED` header naming
      `execution/orchestrate.py` as the live path, and rewrite every present-tense claim that these
      modules *are* the interposition into reference tense. Per the clarify decision these are **retained**
      (they hold the only code-form record of the per-flow `AgentSpec`→DAG mapping); the
      `coordinator/__init__.py` exports stay so nothing importing them breaks. (FR-023-016)
- [ ] **T023** `[E]` **Enforcing test** — NEW `tests/coordinator/test_superseded_markers.py`: the markers
      are present in all three modules, **and** no module outside `coordinator/` imports the superseded
      symbols (`Coordinator`, `run_read`, `run_execution`, `execution_flow_for`, `agentic_loop.execute`).
      This is what stops the "not executed" claim rotting — a prose marker alone is exactly the "prose
      never stopped an agent" failure mode. (FR-023-016, SC-023-007)
- [ ] **T024** `[P]` `[E]` **Docstring truth** — `src/sparkpoint_agent/api/portfolio.py`: the module
      docstring and the two model docstrings still say cost basis / realized+unrealized PnL "need the
      derived cost-basis index (not yet built) → `null`", while the module imports `replay_basis` and
      computes all three. Correct them to describe 018/020 as shipped (computed from the indexed flows,
      gated on `basis.reconciles`), and keep the *genuinely* absent items honestly absent (the
      per-position event history and series, risk score, drift). (FR-023-017)
- [ ] **T025** `[P]` `[E]` **Migration header fix** — `services/agent/migrations/0025_session_keys.sql`:
      the header still calls itself `0024_session_keys.sql` from before the renumber. Comment-only.
      (FR-023-017)
- [ ] **T026** `[E]` **Lint the tree the config declares** — `.github/workflows/agent.yml`: change
      `ruff check src` → `ruff check .`, and clear the 52 `E501`s (39 in `tests/api/test_notifications.py`
      + `tests/api/test_notification_poller.py`) by **reflowing**. No `noqa`, no `line-length` bump —
      either would change house style repo-wide to avoid reflowing nine files. (FR-023-018)
- [ ] **T027** `[E]` **Worker-count constraint** — `src/sparkpoint_agent/api/main.py`: after Phase 5 the
      only correctness-by-single-worker mechanism left is the process-global LLM concurrency limiter, which
      guards **cost and upstream rate limits**, not custody. Emit a loud startup warning when
      `WEB_CONCURRENCY` / `UVICORN_WORKERS` > 1. Do **not** fail closed — taking a service down over a cost
      control is disproportionate. (FR-023-019)
- [ ] **T027a** `[P]` `[E]` **Worker-warning test** — extend `tests/api/test_app_lifespan.py`:
      `WEB_CONCURRENCY=2` at lifespan start emits the warning; unset or `1` emits nothing. Added because
      the analyze pass found FR-023-019 was the only requirement in the feature with an implementation
      task and no test. (FR-023-019)

---

## Phase 8: Polish & cross-cutting

- [ ] **T028** `[POLISH]` **Living docs, in the same change that alters behavior** (playbook §7):
      - `DEPLOYMENT.md` — the mainnet env contract (`CHAIN_ID=8453` **requires** an explicit mainnet RPC;
        no cross-chain fallback exists), the new `chain_identity` readiness check, and the **single-worker
        constraint** with its reason.
      - `DEVELOPMENT.md` — the local/fork story after T002 (`31337` takes `SIM_FORK_RPC_URL`).
      - `MIGRATIONS.md` — the `0027` row + the run-history entry, `PGCLIENTENCODING=UTF8`, Production
        still `none`.
      - `CHANGELOG.md` — the `## [Unreleased]` dev bullet.
- [ ] **T029** `[POLISH]` **Apply `0027` to develop — BEFORE the agent is redeployed** out-of-band via
      yoyo with `PGCLIENTENCODING=UTF8`; verify the table + UNIQUE constraint exist; record it in
      `MIGRATIONS.md`.
      ⚠️ **Ask the operator before running it** — it touches the shared develop database (CLAUDE.md:
      confirm before infra mutations).
      ⚠️ **Ordering is load-bearing, not a formality** (the analyze pass's one HIGH finding): the store
      fails **open**, so a redeploy that lands before this apply runs with **no replay protection, no
      error, and no failing check**. `0027` is additive, so applying it first is safe for the
      currently-live agent — the unsafe order is the other one. T018's table-missing warning is the
      backstop if this is ever got wrong. (FR-023-015a)
- [ ] **T030** `[POLISH]` **Client-facing changelog entry** — `services/agent/content_seed/whats-new.json`,
      newest-first, new `slug`. **Mandatory** (see the DoD box: the escape hatch is ignored for a PR that
      changes `services/agent/src/`). Write it as an honest behind-the-scenes note in the register's
      established voice — what changed, why it matters, that nothing changes on the user's side, no dev
      detail. Suggested `tag: "Improved"`.
- [ ] **T031** `[POLISH]` **Full gate run + evidence**: `ruff check .` · `mypy` · `pytest -q` from
      `services/agent/`. Expect 793 + the new tests, all green. Paste the output into the PR body
      (playbook §10).
- [ ] **T032** `[POLISH]` **Diff self-audit against SC-023-009**: confirm the diff touches no decision
      logic in `policy/evaluate.py` or `policy/session.py`, adds no env var matching
      `_FORBIDDEN_ENV_SUBSTRINGS`, introduces no path that can set a signature, and adds no gate on the
      exit path. State the result in the PR body — the constitution requires reviews to *explicitly*
      confirm Principles I and II are not weakened.
- [ ] **T033** `[POLISH]` **PR → `develop`**, body carrying: baseline vs final gate output, the migration
      note, the two clarify decisions, the SC-023-009 self-audit, and the stated limit of the chain
      assertion (misconfiguration, not a hostile RPC). ⚠️ **Ask before pushing / opening the PR**
      (CLAUDE.md is stricter than playbook §10 here: it requires confirmation for `git push` / PR / merge).
      Then resolve every **OH Defender** finding before merge.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** (T001) → everything. The baseline is what makes "no regression" checkable.
- **Phase 2** (T002–T004) blocks Phases 3 and 5. T002+T003 → Story A; T004 → Story D.
- **Phases 3, 4, 6, 7** are mutually independent (disjoint files). **Phase 5** needs T004 only.
- **Phase 8** last, except T029 (operator-gated, can run once T004 is final).

### Story dependencies

| Story | Needs | Independent of |
|---|---|---|
| A (chain identity) | T002, T003 | B, C, D, E |
| B (gas envelope) | — | A, C, D, E |
| C (submit integrity) | — | A, B, D, E |
| D (idempotency) | T004 | A, B, C, E |
| E (hygiene) | — | all |

### Parallel opportunities

- After Phase 2: **A, B, D can proceed concurrently** (config/api/vault · execution · api/db).
- `[P]`-marked test tasks (T007, T008, T014, T015, T019, T024, T025) touch distinct files. T006 and T021
  are deliberately **not** `[P]`: each is the guard for its implementation task (T005, T020) and is written
  with it.
- **Serialize** anything touching `api/main.py` (T009 and T027) — same file, and T009 is behavioral while
  T027 is a log line.

### Within each story

Implementation and its N2/regression guard are written **together** (T005+T006, T020+T021), not
sequentially. The guard is the deliverable, not the follow-up.

---

## Implementation Strategy

**Highest-severity first.** Story A is the only item that can produce a wrong *outcome* with every other
part of the system behaving correctly (a bundle approved against one chain's state and signed on another).
Story B is next: it can't produce a wrong outcome, but it makes mainnet automation fail outright. Both are
P1 and both should land before anything cosmetic.

**Each story is independently shippable.** If the PR needs splitting for review, the seam is the story
boundary — A, B and D each stand alone with their own tests and success criteria. The natural split, if
one is wanted, is *A+B+C (mainnet correctness)* and *D+E (hygiene + the migration)*, because only D carries
a schema change.

**No behavior change on Base Sepolia.** That is the invariant that makes this PR safe to merge into a live
develop environment: the existing 793 tests must pass unmodified except where a fixture pins a value this
feature deliberately changes — and every such fixture edit must be called out in the PR body rather than
quietly absorbed.

## Notes

- Ultracode/workflow parallelization (playbook §10) is **not** used in this session: the operator's
  standing instruction for this session is no subagents and no workflows unless explicitly requested.
  Tasks are therefore sequenced for a single implementer, and the `[P]` markers record where a future
  session *could* fan out.
- The chain assertion's limit is a **deliverable**, not a caveat: the code must say it catches
  misconfiguration and not a hostile RPC. An overstated guarantee is its own defect under Principle III.
- Out of scope and tracked for follow-ups (spec assumptions 1, 3, 4, 5, 6): the per-chain vault map, cap
  ratification for real money, the swap-policy ruling, the hardcoded `84532`s outside the agent's config
  path (`admin_revenue` labels, premium/SRK pinning, the web's `VAULT_CHAIN`), and splitting the
  bundler URL from the RPC URL.
