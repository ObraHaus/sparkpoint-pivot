# Feature Specification: Hermes Mainnet Hardening (the Gate-C readiness slice)

**Feature Branch**: `feature/023-hermes-mainnet-hardening`

**Created**: 2026-07-30

**Status**: Draft

**Input**: A review of the Hermes agent service at `develop@03b7ed4` (all gates green: 793 pytest,
`ruff check src` clean, strict mypy clean across 122 source files) found the architecture sound and the
non-custody invariants intact, but several **configuration and envelope paths shaped for Base Sepolia
that fail open on the wrong side when pointed at Base mainnet (8453)**, plus code/doc drift that a
Gate-C audit will have to adjudicate. This feature closes the agent-side half of that list. It is
scoped to `services/agent/` + its CI + the living docs; **no contract, web, or Coolify change is in
scope**, and no user-visible behavior changes on Base Sepolia.

**Gate**: this feature does **not** open Gate C ([`docs/orchestration/GATES.md`](../../docs/orchestration/GATES.md)
— mainnet requires the recorded internal security audit + hardening sign-off, T103). It is a
**prerequisite** for it: the T103 audit should run against a tree with these defects closed, and the
audit itself remains a separate, human-gated step.

---

## Context & Framing

Hermes is advisory and read/derive only. It holds no key, signs nothing, and the strongest artifact it
emits is an unsigned, simulated, policy-stamped `IntentBundle` (constitution Principle I/II, N1/N3;
`agent-service-api.md` §0). Nothing in this feature changes that posture — every item either **closes a
path where the service could act on the wrong facts**, or **removes an ambiguity that makes the posture
harder to prove**.

The distinction that organizes the work: the deterministic policy layer is correct, but it decides on
`PolicyContext` values that an I/O layer gathers. On Base Sepolia every gathering path is pinned to one
chain and one gas regime, so the inputs are trivially right. On mainnet three of those paths can be
right-shaped and wrong-valued, and the policy layer has no way to notice:

1. **Chain identity is assumed, never asserted.** `_resolve_rpc_url`
   ([`config.py:135-140`](../../services/agent/src/sparkpoint_agent/config.py#L135-L140)) resolves chain
   `8453` as `SPARKPOINT_RPC_URL` → **`SIM_FORK_RPC_URL`** → **`BASE_SEPOLIA_RPC_URL`**. A mainnet
   deployment missing one env var therefore reads the Anvil fork — or Base Sepolia — and presents it as
   mainnet. `eth_chainId` is read in exactly one place (the simulator's own healthcheck) and is never
   compared to the configured `CHAIN_ID`. Because cap headroom, `paused()`, `totalAssets()` and the
   ERC-4626 previews all feed `evaluate()` while the built calldata still targets the **mainnet** vault
   from env, the failure mode is a bundle **approved against one chain's state and signed on another**.
   This is the highest-severity item in the feature.
2. **Readiness does not describe the chain being served.** `/readyz`
   ([`api/main.py:598-599`](../../services/agent/src/sparkpoint_agent/api/main.py#L598-L599)) reports
   `sim_fork` from the presence of `SIM_FORK_RPC_URL` and `base_rpc` from
   `BASE_SEPOLIA_RPC_URL or ALCHEMY_ACCESS_KEY`. A mainnet deployment configured via
   `SPARKPOINT_RPC_URL` alone reports **not-ready forever**; one carrying a stale Sepolia URL reports
   **ready** while serving mainnet. Both directions are wrong, and the second is worse.
3. **The session-key gas envelope is a Sepolia constant.**
   [`session_userop.py:26-30`](../../services/agent/src/sparkpoint_agent/execution/session_userop.py#L26-L30)
   hardcodes `maxFeePerGas` at 0.05 gwei ("Base Sepolia base fee ~0.01 gwei") and
   `preVerificationGas` at 200 000. On Base mainnet `preVerificationGas` tracks the L1 data-posting cost
   and moves with Ethereum gas; a hardcoded fee cap gets the UserOp rejected outright or stranded
   un-mined. The envelope is signed over (it is part of the `userOpHash`), so the client cannot repair it
   after the fact. `bundler.estimate_user_op_gas`
   ([`bundler.py:84`](../../services/agent/src/sparkpoint_agent/execution/bundler.py#L84)) **already
   exists and is never called.**

Two more items are custody-adjacent rather than custody-critical, and both were named in the earlier
alpha security audit (R1) or the `03b7ed4` review:

4. **Bundle expiry is enforced only in the browser.** A bundle carries a 180-second `expiresAt` and
   `orchestrate.build_tx` documents it as the signal that a stale bundle must be rebuilt before signing,
   but neither `/simulate` nor `/submit-signed-tx` compares against it — the check lives in the web
   app's `executionModel.isExpired`. On the wallet path this is immaterial (submit is a correlation relay;
   the transaction is already broadcast and refusing it would only lose the outcome record). On the
   **session-key path it is not**, because there `submit_signed`
   ([`orchestrate.py:515`](../../services/agent/src/sparkpoint_agent/execution/orchestrate.py#L515)) *is*
   the submission — an expired bundle can still be handed to the bundler with no fresh policy pass. The
   on-chain `validateUserOp` re-enforces the session scope, the vault enforces its own cap and pause, and
   the UserOp nonce blocks replay, so the realistic outcome is a wasted or reverting op rather than an
   out-of-policy one — but the guarantee is currently *cooperative*, and mainnet is where that stops
   being acceptable.
5. **Idempotency keys are not scoped to the caller.** `IdempotencyStore`
   ([`api/idempotency.py:40-45`](../../services/agent/src/sparkpoint_agent/api/idempotency.py#L40-L45))
   is keyed on the raw `Idempotency-Key` alone, so a key collision across wallets serves one caller's
   cached `IntentBundle` to another. The store is also process-local, so replay protection dies on
   restart and does not span workers. (R1 medium, still open.)

The remaining items are **provability hygiene**. This codebase deliberately carries its invariants in
its own comments and module structure — an auditor reads `agentic_loop.py` and believes it is the
interposition point. Three artifacts now mislead:

6. `submit_signed` branches on the **request's** `opType` and never consults the loaded bundle's
   `is_session_key_path`, so a bundle built for the wallet path can be submitted as a UserOp. The action
   and its verdict are identical, so there is **no policy consequence** — but the audit record ends up
   self-inconsistent (`intent_bundles.exec_mode = per_action_user_signature` against
   `executions.signing_mode = session_key`), which weakens a trail the project treats as provable
   (Principle III).
7. `coordinator/coordinator.py`, `coordinator/flows.py` and `coordinator/agentic_loop.py` still describe
   themselves as the manual execution loop where the policy gate is interposed, but **nothing imports or
   calls them** — the shipped spine is an independent implementation in `execution/`. Two modules now
   document the same guarantee and only one runs.
8. `api/portfolio.py` still opens by stating that cost basis and PnL "need the derived cost-basis index
   (owned by the fee indexer, not yet built) → exposed as `null`", and two model docstrings repeat it,
   while the module imports `replay_basis` and computes all three for real (018/020).
   `migrations/0025_session_keys.sql` still calls itself `0024_session_keys.sql` in its own header from
   before the renumber.
9. `[tool.ruff]` declares `src = ["src", "tests"]` but CI runs `ruff check src`
   ([`.github/workflows/agent.yml:25`](../../.github/workflows/agent.yml#L25)), and the untested half has
   accumulated 52 `E501` violations — 39 of them in the two newest notification test files. Harmless
   today, monotonically growing, and it means a whole tree is outside the gate the config claims covers it.

---

## User Scenarios & Testing *(mandatory)*

The "user" for most of this feature is the **operator** standing up or running a mainnet deployment, and
the **auditor** performing T103. The end user's experience is unchanged by design — that is a success
criterion, not an omission.

### User Story A — "A misconfigured mainnet deployment refuses to serve rather than lying" (Priority: P1)

An operator brings up a Hermes instance with `CHAIN_ID=8453`. If the RPC it can reach is not Base
mainnet — because `SPARKPOINT_RPC_URL` was omitted and a fork or Sepolia URL was inherited from the
develop environment — the service must refuse to serve the chain-dependent surface and say so, instead of
quoting fork state as mainnet.

**Independent Test**: set `CHAIN_ID=8453` with only `SIM_FORK_RPC_URL` present; boot the service;
confirm the vault/quote/execution surface fails closed with an honest envelope, `/readyz` reports
not-ready with a chain-identity reason to an S2S caller, and `/healthz` still answers (the process is
alive). Then point `SPARKPOINT_RPC_URL` at a real mainnet RPC and confirm the surface serves.

#### Acceptance Scenarios

1. **Given** `CHAIN_ID=8453` and no `SPARKPOINT_RPC_URL`, **When** the config resolves the RPC url,
   **Then** it does **not** fall back to `SIM_FORK_RPC_URL` or `BASE_SEPOLIA_RPC_URL`, and the
   chain-dependent getters fail closed with a message naming the missing variable.
2. **Given** any configured chain, **When** the service starts, **Then** it reads `eth_chainId` from the
   resolved RPC and compares it to `CHAIN_ID`; on a mismatch the chain-dependent surface fails closed
   with a distinct, non-retryable reason and the mismatch is logged (chain ids only — never the RPC url,
   which can carry a key).
3. **Given** a chain-id mismatch, **When** an S2S caller reads `/readyz`, **Then** the response reports
   not-ready and includes a `chain_identity` check that is `false`; an anonymous caller still receives
   only `{"ready": false}` (no topology disclosure).
4. **Given** a chain-id mismatch, **When** any user calls the withdraw/exit-adjacent surface,
   **Then** nothing about the on-chain exit path is affected (N2) — the frontend's direct-RPC exit is
   untouched, and the failure is confined to this service's advisory reads and builds.

### User Story B — "An automated move on mainnet is priced for mainnet" (Priority: P1)

A user with a live session-key grant triggers a hands-off move on Base mainnet. The UserOp the service
builds must carry a gas envelope estimated against the chain it will execute on, not a constant proven on
a testnet.

**Independent Test**: build a session-key UserOp against a mainnet-like bundler; confirm the emitted
envelope came from `eth_estimateUserOperationGas` plus live fee reads, that it is bounded by sane
floors/ceilings, and that an estimator outage yields **no bundle** rather than a Sepolia-shaped guess.

#### Acceptance Scenarios

1. **Given** a session-key build, **When** the UserOp is assembled, **Then** `callGasLimit`,
   `verificationGasLimit` and `preVerificationGas` come from `eth_estimateUserOperationGas` and the fee
   fields from a live fee read, each clamped to a documented floor and ceiling.
2. **Given** the estimator or fee read is unavailable, **When** the build runs, **Then** it fails closed
   (no UserOp, honest envelope) — it never substitutes a hardcoded envelope, because a wrong envelope is
   signed over and cannot be corrected downstream.
3. **Given** a built envelope, **When** the client signs and submits it, **Then** the bundler's verdict is
   surfaced verbatim on rejection (unchanged behavior), and the byte-match on `sender`/`callData` still
   holds (SC-005).

### User Story C — "A stale or mismatched submission cannot reach the bundler" (Priority: P2)

**Independent Test**: build a session-key bundle, wait past `expiresAt`, submit; confirm a distinct
non-retryable rejection, nothing recorded, and no bundler call. Repeat with a wallet-path bundle
submitted as `opType=userop`; confirm rejection. Confirm the wallet-path correlation relay is
**unchanged** for an expired bundle (it must still record, so outcome attribution is not lost).

#### Acceptance Scenarios

1. **Given** a session-key bundle past `expiresAt`, **When** `/submit-signed-tx` is called with
   `opType=userop`, **Then** it is rejected before the bundler is contacted, with a reason distinguishing
   "expired" from "mismatched".
2. **Given** a bundle whose `is_session_key_path` is false, **When** a UserOp submission cites it,
   **Then** the submission is refused — the exec mode recorded at build time and the submission mode must
   agree.
3. **Given** a wallet-path bundle past `expiresAt`, **When** `/submit-signed-tx` relays a broadcast
   `txHash`, **Then** behavior is unchanged (verify on-chain, byte-match, record) — expiry must **not**
   become a new way to lose an outcome record for a transaction that is already on-chain.

### User Story D — "One wallet's bundle can never be served to another" (Priority: P1)

**Independent Test**: issue two requests carrying the same `Idempotency-Key` from two different
`X-Account`/`X-Owner` pairs; confirm each receives its own response and neither sees the other's.

#### Acceptance Scenarios

1. **Given** two accounts using the same `Idempotency-Key`, **When** both POST, **Then** the cache
   entries are distinct — the key is scoped by at minimum the account, the method and the path.
2. **Given** one account replaying its own key on the same route, **When** it POSTs again, **Then** the
   original 2xx response is replayed (unchanged §1.3 behavior).
3. **Given** a replay after a process restart, **When** the durable store is enabled, **Then** the
   original response is still replayed; when it is not enabled, the degradation is documented, not silent.

### User Story E — "An auditor reading this service cannot be misled by it" (Priority: P2)

**Independent Test**: grep the service for modules describing themselves as the policy interposition
point and confirm exactly one exists and runs; read `api/portfolio.py`'s docstring and confirm it matches
what the module computes; confirm `ruff` covers every path the config claims.

#### Acceptance Scenarios

1. **Given** the coordinator package, **When** an auditor looks for the execution interposition,
   **Then** exactly one implementation is present and reachable — the superseded scaffolding is removed,
   or retained only with an unmistakable "superseded, not executed" marker and no misleading prose.
2. **Given** `api/portfolio.py`, **When** its docstring is read against its behavior, **Then** they agree
   (cost basis, realized and unrealized PnL are computed and gated on `reconciles`).
3. **Given** CI, **When** the agent workflow runs, **Then** `ruff` covers `src` **and** `tests`, and the
   tree is clean.

### Edge Cases

- **Chain-id read fails at boot** (RPC down, not wrong) → distinguishable from a *mismatch*: the service
  boots (as today, never blocking on I/O), reports not-ready, and retries; it must not latch a false
  "mismatch" from a transient outage, and it must not serve on an unverified chain either.
- **31337 (local Anvil fork of Base mainnet)** reports `eth_chainId` 31337 while `CHAIN_ID` may be 31337
  — the fork case must keep working for local development and the swap simulator.
- **A fork whose `eth_chainId` is spoofed to 8453** — out of scope; a hostile RPC is a trust-the-operator
  problem, and the assertion's purpose is catching *misconfiguration*, not an adversarial provider. State
  this explicitly rather than implying protection it does not give.
- **Estimator returns limits below a known-good floor** (a bundler quirk) → clamp up to the floor rather
  than emit an op that cannot execute.
- **Expiry clock skew** between the service and the client → the server check must use the stored
  `expires_at`, and the tolerance (if any) must be an explicit constant, not an accident.
- **46630 (Robinhood testnet)** has no vault; the chain assertion must not regress its chat/read-only
  path, and `for_chain` must keep nulling the vault.
- **Retaining the coordinator scaffolding** (the clarify decision) means the `coordinator/__init__.py`
  re-export surface stays intact, so nothing importing those symbols breaks — but the "not executed" claim
  then depends on a *marker*, which can rot. The enforcing test (FR-023-016) is what makes the claim
  durable: it must fail if a marker is dropped **or** if an import of a superseded symbol appears outside
  the coordinator package.

---

## Requirements *(mandatory)*

### Functional Requirements

**Chain identity (Tier 0)**

- **FR-023-001**: The RPC resolution for chain `8453` MUST NOT fall back to `SIM_FORK_RPC_URL` or
  `BASE_SEPOLIA_RPC_URL`. A mainnet deployment MUST configure an explicit mainnet RPC or fail closed.
- **FR-023-002**: The service MUST verify, against the resolved RPC, that the reported `eth_chainId`
  equals the configured `CHAIN_ID` before serving any chain-dependent surface (vault quotes and
  simulations, portfolio, outcomes, build/simulate/submit, session-key builds).
- **FR-023-003**: A chain-identity failure MUST fail closed with a canonical §1.5 envelope and a distinct
  reason, MUST be surfaced in `/readyz` as its own check to S2S callers only, and MUST NOT log the RPC
  url (it may carry a credential).
- **FR-023-004**: A chain-identity failure MUST NOT affect the on-chain exit path in any way (N2), and
  `/healthz` MUST continue to answer.

**Readiness (Tier 0)**

- **FR-023-005**: `/readyz` checks MUST describe the chain actually being served — the RPC check MUST be
  derived from the resolved RPC for `CHAIN_ID`, not from the presence of a Sepolia-specific or
  provider-specific variable.
- **FR-023-006**: The anonymous `/readyz` response MUST remain a bare `{"ready": bool}`.

**Gas envelope (Tier 0)**

- **FR-023-007**: A session-key UserOp's gas limits MUST be obtained from
  `eth_estimateUserOperationGas` and its fee fields from a live fee read, for the chain being served.
- **FR-023-008**: Each estimated field MUST be clamped to a documented floor and ceiling, and the
  constants MUST be named for what they bound rather than for the chain they were proven on.
- **FR-023-009**: If estimation or the fee read is unavailable, `/build-tx` with `execMode=session_key`
  MUST fail closed and return no UserOp. It MUST NOT fall back to a hardcoded envelope.

**Submission integrity**

- **FR-023-010** *(Tier 0 — the guarantee is currently cooperative)*: `/submit-signed-tx` MUST reject a
  UserOp submission whose bundle is past `expires_at`, before contacting the bundler, with a reason
  distinct from a byte-match failure.
- **FR-023-011** *(Tier 1 — audit-record fidelity; no policy consequence)*: `/submit-signed-tx` MUST
  reject a UserOp submission whose bundle was not built as a session-key bundle (`is_session_key_path`
  false), and vice versa.
- **FR-023-012**: The wallet-path (`opType=eoa_call`) correlation relay MUST remain unchanged, including
  for an expired bundle — the transaction is already on-chain and the record MUST NOT be lost (N2,
  US5 attribution).

**Idempotency (Tier 0)**

- **FR-023-013**: An idempotency cache entry MUST be scoped by at minimum the requesting account, the
  chain, the HTTP method and the request path, in addition to the `Idempotency-Key`.
- **FR-023-014**: Replay of a caller's own key on the same route MUST continue to return the original
  2xx response; SSE and non-2xx responses MUST continue never to be cached.
- **FR-023-015a** *(deploy ordering — the silent-degradation guard)*: because the store fails **open**,
  a deploy that precedes the `0027` apply would lose replay protection with **no error and no failing
  check**. `0027` MUST therefore be applied **before** the agent is redeployed, and the service MUST log a
  distinct warning at first use when the table is absent, so the degradation is observable rather than
  silent.
- **FR-023-015**: The idempotency store MUST be durable so replay protection survives a restart and spans
  workers — backed by Postgres via one additive, idempotent migration (`0027`), with a bounded retention
  sweep so the table cannot grow without limit. *(Clarify decision, 2026-07-30: operator chose to close
  this in-feature rather than defer it, accepting the migration step.)* A store outage MUST fail **open**
  for serving (admit the request, as the pre-existing behavior does) — idempotency is a
  double-emit guard on advisory builds, never a custody gate, and MUST NOT become a new way to block a
  build (N2).

**Provability hygiene (Tier 1)**

- **FR-023-016**: Exactly one execution-interposition implementation MUST be **reachable** in the agent.
  The superseded scaffolding (`coordinator/coordinator.py`, `coordinator/flows.py`,
  `coordinator/agentic_loop.py`) is **retained** and MUST carry an unmistakable header stating that it is
  not executed and naming `execution/orchestrate.py` as the live path; every claim in its prose that it
  *is* the interposition MUST be corrected to the past/reference tense. *(Clarify decision, 2026-07-30:
  operator chose retain-and-mark over deletion, to preserve the documented design intent and the
  per-flow `AgentSpec` mapping as reference.)* A test MUST assert the markers are present and that
  nothing outside the coordinator package imports the superseded symbols, so the "not executed" claim
  cannot silently rot.
- **FR-023-017**: Module and field documentation for shipped behavior MUST match that behavior —
  specifically `api/portfolio.py`'s PnL/cost-basis prose and the `0025_session_keys.sql` header.
- **FR-023-018**: CI MUST lint every path `[tool.ruff]` declares (`src` and `tests`), and the tree MUST
  be clean.
- **FR-023-019**: The single-process assumptions that remain after FR-023-013/015 (the process-global LLM
  concurrency limiter) MUST be documented as an explicit deployment constraint, and a multi-worker
  configuration MUST produce a loud startup warning.

**Non-regression (applies to every requirement)**

- **FR-023-020**: No requirement in this feature may weaken the non-custody invariants. Specifically: no
  new key material, no new signing path, no new gate on the withdraw/exit path, no change to
  `policy.evaluate` or `evaluate_session_grant` decision logic, and no change to the recipient pin.
- **FR-023-021**: Behavior on Base Sepolia (84532) and Robinhood testnet (46630) MUST be unchanged
  except where a defect is being fixed; the existing 793 tests MUST continue to pass.

### Key Entities

- **`AgentConfig`** — gains a verified chain identity; no new field carries a secret.
- **Idempotency cache key** — becomes a composite of (account, chain_id, method, path, key) rather than a bare key.
- **Gas envelope** — moves from module constants to per-request estimated values with named bounds.
- **`intent_bundles.expires_at` / `is_session_key_path`** — already persisted (migration 0021); this
  feature starts *reading* them on the submit path. No schema change needed for these.
- **`idempotency_records`** (new, migration `0027`) — the durable replay cache: the composite scope
  (account, chain_id, method, path, key) plus the cached status/media-type/body and a `created_at` for the
  retention sweep. Holds **no key material** and is **never** on the withdraw/exit path (N2); losing the
  table degrades replay protection to fail-open, never custody.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-023-001**: With `CHAIN_ID=8453` and no mainnet RPC configured, zero chain-dependent responses are
  served and zero fabricated values are returned; the failure names the missing configuration.
- **SC-023-002**: With a deliberately mismatched RPC (`CHAIN_ID=8453`, RPC reporting 84532), the
  chain-dependent surface fails closed 100% of the time, and no bundle is issued.
- **SC-023-003**: `/readyz` reports ready **iff** the service can serve the chain it is configured for —
  verified on a mainnet-shaped config and on a Sepolia config.
- **SC-023-004**: Every session-key UserOp emitted carries estimator-derived gas and live fees; no build
  emits the previous hardcoded envelope. An estimator outage yields zero UserOps.
- **SC-023-005**: An expired or mode-mismatched UserOp submission results in zero bundler calls and zero
  `executions` rows.
- **SC-023-006**: Two accounts sharing an `Idempotency-Key` receive zero cross-account cache hits.
- **SC-023-007**: A grep for the execution interposition finds exactly one **reachable** implementation;
  the retained scaffolding carries its SUPERSEDED marker and a test fails if the marker is dropped or an
  import of it appears outside the coordinator package.
- **SC-023-011**: A replayed `Idempotency-Key` returns the original response **after a process restart**;
  a store outage admits the request rather than blocking it.
- **SC-023-008**: `ruff check .` and strict `mypy` are clean; the full pytest suite is green with new
  tests covering each of SC-023-001 … SC-023-006.
- **SC-023-009**: No diff in this feature touches `policy/evaluate.py` or `policy/session.py` decision
  logic, adds an env var matching the key-bearing forbidden substrings, or introduces a code path that
  can set a signature. (Verifiable by reading the diff; the config guard and custody-seam CI enforce
  the last two.)
- **SC-023-010**: `CHANGELOG.md` carries the dev entry; the Definition of Done checklist in
  `tasks.md` is satisfied; `DEPLOYMENT.md`/`DEVELOPMENT.md` document the new mainnet env requirements
  and the worker constraint.

---

## Assumptions

1. **Mainnet is a separate deployment.** `SPARKPOINT_VAULT_ADDRESS` is singular and `for_chain` nulls the
   vault on any non-configured chain, so one instance cannot serve both the Sepolia and mainnet vaults.
   This feature assumes a **distinct mainnet deployment** rather than introducing a per-chain vault map —
   the latter is a larger change and is not required for Gate C. Recorded as a decision, not a code
   change.
2. **The chain assertion targets misconfiguration, not a hostile RPC.** An RPC that lies about
   `eth_chainId` is outside this feature's threat model; the operator's choice of provider is trusted.
3. **Cap and session-bound values are out of scope.** The launch caps (5 000 USDC/user, 1 000 000 vault,
   500/tx and 5 000 lifetime per session key, 30-day max session) are deliberate constants mirrored to
   TypeScript; ratifying them for real money is an operator decision that belongs with Gate C, not a
   code change here. Flagged, unchanged.
4. **The unpoliced web swap path is out of scope.** `SLIPPAGE.applies_to` is Aerodrome-only and the
   assistant refuses to build swaps; the web's Uniswap path executes outside this policy layer. That is
   a scope ruling for the operator (and the other open R1 medium), not an agent fix.
5. **The hardcoded `84532` occurrences outside the agent's config path** (`admin_revenue` network
   labels, premium/SRK chain pinning, the web's `VAULT_CHAIN`) are **out of scope** for this feature —
   they are display/monetization concerns on separate surfaces, and folding a web change into an
   agent-hardening PR would blur the review. Tracked for a follow-up.
6. **The estimator's bundler is reachable from the agent.** Today `rpc_url` doubles as the bundler URL
   because Alchemy serves both; splitting that env is a follow-up (it is a deployment concern, and the
   estimator introduced here uses whatever URL the bundler client is already given).
7. **Existing gates are the baseline.** The tree is green at `03b7ed4`; any red introduced by this
   feature is this feature's defect.

---

## Out of Scope

- Opening Gate C, or performing the T103 audit itself.
- Any contract change or mainnet deployment of the AA stack / vault / Safe / timelock.
- Any `apps/web` change (including the hardcoded `VAULT_CHAIN`).
- Any Coolify or environment mutation (this feature *documents* the new requirements; the operator
  applies them).
- Externalizing the LLM concurrency limiter (documented as a constraint instead — FR-023-019).
- The per-chain vault map, the bundler-URL split, cap ratification, and the swap-policy ruling
  (assumptions 1, 6, 3, 4).
