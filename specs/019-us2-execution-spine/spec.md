# Feature Specification: US2 Execution Spine — the Single Signing Chokepoint

**Feature Branch**: `feature/019-us2-execution-spine`

**Created**: 2026-07-23

**Status**: Draft

**Input**: Continue the Phase-3-deferred US2 anchor (docs/phase-3-deferred.md row 8): wire the built-but-unrouted policy engine + simulator into the execution endpoints, add a single-signing ExecutionDrawer, and persist durable non-custodial execution records. Testnet scope = the vault action path.

---

## Context & Framing

SparkPoint is **"provable, not promised"** and **non-custodial**. Today the AI can *advise*
(`/chat`, `/recommendations` emit an advisory `proposedAction` + a policy stamp) and the app can
*preview* (018's read-only `/vault/simulate/*` dry-run), but there is **no single place** where an
AI-proposed action becomes a real, user-signed on-chain transaction with a durable record. The
manual vault deposit/withdraw confirm flow re-encodes its own calldata client-side and submits
directly — it works and stays untouched — but an **agent-proposed** action has no execution path.

This feature builds that path: the **single signing chokepoint**. An approved proposal is turned
into one unsigned, simulated, policy-approved artifact (an *Intent Bundle*), the user reviews and
signs it **once** in an **Execution Drawer**, the transaction is submitted and tracked to
confirmation, and every step is recorded so a realized outcome can later be attributed back to the
advice that caused it. The service **never holds keys, never signs, and can never move a user's
funds** — it only proposes inert calldata the user's own wallet signs.

The already-finished pure policy engine (`evaluate()`) and pre-trade simulator are consumed here,
not rebuilt. Non-custody invariants **N1–N5** and the fail-closed rule from the constitution are the
hard requirements of this feature, not aspirations.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Turn an approved recommendation into one signable transaction (Priority: P1)

A beta user is shown an approved vault recommendation (e.g. "Supply 100 USDC to the Aave Yield
Vault"). They ask to act on it. The system produces a single, fully-simulated, policy-approved,
**unsigned** transaction bundle — with the recipient forced to the user's own wallet — that is ready
to sign. If the action does not pass policy or simulation, the system returns the specific reasons
and **no** signable bundle.

**Why this priority**: This is the MVP and the anchor of the whole feature. Without it there is no
execution path at all, and it is what mints the identifier that later links advice to realized
outcome (unlocking US5 per-advice attribution). It is independently valuable: it proves the "AI
proposes, deterministic policy is the final word, the user is the recipient" custody model end to
end, even before a UI exists.

**Independent Test**: Call the build endpoint with an approved vault-deposit action and confirm it
returns an Intent Bundle whose recipient is the caller, whose signature field is null, that carries a
passing simulation and an `approved` verdict, and that is persisted. Call it with an over-cap deposit
and confirm it returns a rejection envelope with reasons and no bundle.

**Acceptance Scenarios**:

1. **Given** an approved in-caps vault-deposit proposal, **When** the user requests a build, **Then**
   the system returns one Intent Bundle with the recipient forced to the connected user, a null
   signature, a passing simulation, an `approved` verdict, a short expiry, and a stable id; and both
   the bundle and its simulation are persisted.
2. **Given** a vault-deposit proposal that exceeds the per-user cap, **When** the user requests a
   build, **Then** the system returns a policy-rejection envelope listing the cap reason and returns
   **no** bundle (nothing signable is produced).
3. **Given** a proposal whose target/selector is not on the allowlist, **When** the user requests a
   build, **Then** the system rejects it with an allowlist reason and returns no bundle.
4. **Given** the same build request replayed with the same idempotency key, **When** it is received
   again, **Then** the original bundle is returned verbatim (no second bundle is materialized).

---

### User Story 2 — Review and sign once, in one place (the Execution Drawer) (Priority: P1)

The user opens an Execution Drawer that shows exactly what they are about to do: the guardrail
checklist (whitelisted target, recipient is you, within caps, simulation passed…), the simulated
balance changes, the plain-language rationale, the data citations, and the fee/risk disclosure. They
sign **once**, and the bytes their wallet signs are the **exact** bytes the server built and
simulated. A rejected or expired bundle offers no Sign button.

**Why this priority**: The single signing chokepoint is the human-facing custody guarantee. It is
where "provable, not promised" and "the user is always the recipient" become visible and auditable.
It closes the byte-match gap the manual flow has today (where signed calldata is re-encoded and never
matched to what was simulated).

**Independent Test**: Given a built bundle, the drawer renders its checklist + deltas + rationale and
produces exactly one wallet signature over the bundle's calldata; the signed `to`/`data`/`value`
byte-match the issued bundle. Given a rejected or expired bundle, the drawer shows the reasons and
offers no Sign.

**Acceptance Scenarios**:

1. **Given** an approved bundle, **When** the drawer renders, **Then** it shows the guardrail
   checklist, the simulated balance deltas, the rationale, the citations, and the fee/risk
   disclosure, and enables Sign.
2. **Given** the user signs, **When** the wallet signs, **Then** it signs the server-issued calldata
   verbatim (the signed `to`/`data`/`value` equal the bundle's step), and the app submits and tracks
   the transaction to confirmation.
3. **Given** a bundle that is expired or whose connected network no longer matches, **When** the
   drawer renders, **Then** Sign is disabled and the user is prompted to refresh/rebuild.
4. **Given** a policy-rejected proposal, **When** the drawer renders, **Then** it shows the reasons
   and never presents a Sign button.

---

### User Story 3 — Never sign stale data (Priority: P2)

A user leaves an Execution Drawer open long enough that its simulation is near expiry. Before
signing, the system refreshes the simulation so the user never signs against a stale preview.

**Why this priority**: "No execution on stale data" is a constitution invariant (VR-S2). It protects
against signing a bundle whose simulated outcome no longer reflects chain reality, but it is a
refinement on top of the core build/sign path, so it is P2.

**Independent Test**: A bundle past its freshness threshold forces a re-simulate call that returns a
fresh simulation (or an honest failure); a fresh bundle does not.

**Acceptance Scenarios**:

1. **Given** a bundle near its expiry, **When** the user attempts to sign, **Then** the system
   re-simulates and updates the preview before offering Sign.
2. **Given** a re-simulation reports the action would now revert, **When** it returns, **Then** Sign
   is withheld and the user is told why (deposit path only — see US5 for the withdraw exception).

---

### User Story 4 — A durable, provable execution record with live status (Priority: P2)

After the user signs, the app can optionally relay the signed transaction through the service purely
so the resulting on-chain transaction can be correlated to the intent (for the outcome ledger). The
user can watch the status move from pending → confirmed. Nothing about this relay is required to move
funds — the app submits directly by default and the relay is a convenience.

**Why this priority**: The durable `executions` record + status is what lets a realized outcome be
attributed to the specific advice that caused it (SC-010 / US5). It also gives the user honest,
provable status. It is P2 because the P1 path (build + sign + direct submit + direct receipt) already
delivers a working, non-custodial transaction without it.

**Independent Test**: Submitting a user-signed payload records one execution row keyed to the intent
and returns a pending status; the signed payload is byte-matched to the issued bundle (a tampered
payload is rejected); polling status reflects the on-chain receipt (pending → confirmed/failed).

**Acceptance Scenarios**:

1. **Given** a user-signed payload for a known intent, **When** it is relayed, **Then** the service
   confirms the signed `to`/`data`/`value` byte-match the issued bundle, records an execution row in
   the `submitted` state keyed to the intent, and returns a pending status — **without** signing or
   altering the payload.
2. **Given** a signed payload that does not byte-match the issued bundle (or carries a null
   signature), **When** it is relayed, **Then** the service rejects it as a validation error and
   records no submitted execution.
3. **Given** a submitted execution, **When** status is polled, **Then** it reflects the real on-chain
   receipt (pending → confirmed with a tx hash and block, or failed with a reason).
4. **Given** a confirmed execution that originated from a recommendation, **When** it confirms,
   **Then** the record carries the link needed to attribute a future realized outcome to that
   recommendation.

---

### User Story 5 — Non-custody guarantees hold under adversarial conditions (Priority: P1)

Across every path above, the custody model must not be defeatable: the recipient is always the user;
the withdraw/exit path is never blocked by a simulation, quote, pause, cap, or fee; the service never
signs and never returns a signature; and every displayed figure is reconstructable from chain data.

**Why this priority**: Non-custody is the product's core promise and a hard safety property. It is P1
and cross-cutting — a violation is a critical defect, not a missing feature.

**Independent Test**: A withdraw/redeem build succeeds even when the vault is paused, at cap, data is
stale, and no simulation is available; the service never emits a non-null signature on any path; a
recipient other than the connected user is impossible to encode; the existing direct-RPC exit path is
unchanged.

**Acceptance Scenarios**:

1. **Given** the vault is paused **and** at its cap **and** chain data is stale **and** the simulator
   is unavailable, **When** a withdraw or redeem build is requested, **Then** it still returns a
   signable bundle (the exit is never gated; a kill-switch/cap/stale reason is never returned for an
   exit).
2. **Given** any build or refresh, **When** the response is produced, **Then** the signature field is
   always null and the recipient is always the connected user; there is no request or response where
   the service emits a non-null signature.
3. **Given** a deposit while the vault is paused, **When** a build is requested, **Then** it is
   refused with a kill-switch reason and no bundle (deposits are pausable; withdraws are not).
4. **Given** the service is entirely down, **When** the user needs to exit, **Then** the existing
   direct-on-chain exit path still works and is not routed through this feature.

---

### Edge Cases

- **Undeployed vault / unreachable RPC**: a build proves the vault is deployed with a read *before*
  building calldata; if it cannot, it fails closed with an honest "unavailable" (never a fabricated
  pass). The withdraw path still degrades gracefully to the direct exit.
- **Simulator outage on a deposit**: an outage does not silently pass; but for oracle-free custody
  ops the system may fall back to a local dry-run and label the provider honestly. Swaps fail closed.
- **Near-expiry at sign time**: the drawer refreshes before signing; a bundle past expiry is not
  signable and must be rebuilt.
- **Network switched mid-review**: if the connected network no longer matches the bundle's chain, the
  gate fails closed with "wrong network."
- **Replay / double-submit**: a replayed build returns the original bundle; a relay is de-duplicated
  so a signed payload cannot create two submitted executions.
- **Recommendation id no longer resolvable**: because recommendations are ephemeral, the build request
  carries the full proposed action; a stale recommendation id is a link hint only, never required.
- **Unsupported action on testnet**: a swap (Aerodrome) or direct-Aave build is refused honestly
  (simulation unavailable / not enabled) rather than pretending — those remain deferred.

---

## Requirements *(mandatory)*

### Functional Requirements

**Build (the chokepoint)**

- **FR-001**: The system MUST expose a single build operation that turns a proposed vault action into
  one unsigned Intent Bundle, and MUST be the only way an advisory proposal becomes signable.
- **FR-002**: The build operation MUST run a fixed, fail-closed order: validate shape → deterministic
  policy evaluation → build unsigned calldata → fresh simulation → re-assert (not-revert, within
  caps, fresh) → return the bundle only on a full pass. On any failure it MUST return an error
  envelope with reasons and **no** bundle. (spec-001 FR-008/FR-021/FR-023; constitution "fail-closed")
- **FR-003**: The build operation MUST force the transaction recipient to the connected user's wallet
  and MUST never produce a bundle whose signature is non-null. (N1, N3)
- **FR-004**: A produced bundle MUST carry: the ordered unsigned step(s), a passing simulation, a
  deterministic policy verdict (`approved`), a guardrail checklist, a plain-language rationale, data
  citations, the policy version, an optional link to the originating recommendation, and a short
  expiry.
- **FR-005**: An approved bundle MUST reference a persisted, passing simulation — the system MUST NOT
  produce an approved bundle without a simulation that passed. (spec-001 FR-021 / VR-X2)
- **FR-006**: The build request MUST carry the full proposed action (type, asset, decimals, amount,
  optional params, optional recommendation id); the system MUST NOT rely on server-side storage of a
  prior recommendation to build (recommendations are ephemeral).
- **FR-007**: The build operation MUST mint a stable intent identifier at build time and persist the
  bundle; this identifier is the anchor later used to attribute a realized outcome to the advice.
- **FR-008**: Replaying a build with the same idempotency key MUST return the original bundle, not a
  second one.

**Simulate (refresh)**

- **FR-009**: The system MUST expose a standalone re-simulation operation that refreshes the
  simulation for an existing bundle (or previews raw steps) and returns a fresh simulation result.
- **FR-010**: A bundle whose simulation is older than the freshness tolerance MUST be re-simulated
  before it can be signed (no execution on stale data). (VR-S2)

**Submit + status (relay & tracking)**

- **FR-011**: The system MUST expose a convenience relay that accepts a **user-signed** payload,
  verifies its `to`/`data`/`value`/sender **byte-match** the issued unsigned bundle, and forwards it;
  it MUST NOT sign, alter, or re-encode the payload. A mismatch or null signature MUST be rejected as
  a validation error. (spec-001 FR-022 / VR-X1)
- **FR-012**: On a successful relay the system MUST record one execution row, keyed to the intent, in
  a `submitted` state, and MUST de-duplicate so one signed payload cannot create two submitted
  executions.
- **FR-013**: The system MUST expose a status read that reflects the real on-chain receipt for an
  intent (pending → confirmed with tx hash + block, or failed with a reason), derivable from chain.
- **FR-014**: The app MUST be able to submit the signed transaction **directly** (not through the
  relay) and still confirm it; the relay MUST be optional and MUST never be on the critical path to
  move funds. (N2 independence)

**Execution Drawer (the human chokepoint)**

- **FR-015**: The app MUST present a single Execution Drawer that renders a built bundle's guardrail
  checklist, simulated balance deltas, rationale, citations, and fee/risk disclosure before any
  signature is requested. (spec-001 SC-002 / VR-S3)
- **FR-016**: The drawer MUST sign the server-issued calldata **verbatim** (the signed bytes equal the
  bundle's step) so the relay's byte-match holds; it MUST NOT re-encode the transaction.
- **FR-017**: The drawer MUST offer Sign only when the bundle is `approved`, unexpired, and on the
  connected network; otherwise it MUST show the reasons and withhold Sign.
- **FR-018**: The drawer MUST hold exactly one signature per action and MUST keep the exit path
  ungated (a withdraw/redeem is never blocked by a failed simulation/quote/pause/fee in the drawer).

**Non-custody invariants (cross-cutting, hard requirements)**

- **FR-019**: For any exit action (vault withdraw/redeem, and by extension aave withdraw / session
  revoke), the build operation MUST skip caps, pause, mandate, and freshness checks, MUST build even
  when no simulation is available, and MUST never return a kill-switch/cap/stale rejection. (N2)
- **FR-020**: The build operation MUST refuse a deposit while the kill-switch is paused (deposits are
  pausable) but MUST NOT apply that pause to any exit. (N2 asymmetry)
- **FR-021**: The system MUST never store a private key, a signature, or a signed payload; it MUST
  store only the *event* of having signed (the resulting on-chain references). (N3, N5, VR-A3/VR-X1)
- **FR-022**: Every persisted figure MUST be reconstructable from chain data plus the pinned inputs;
  amounts MUST be exact base-unit integer strings (never floats). (N5, §1.4)
- **FR-023**: The deterministic policy verdict — not any AI output — MUST be authoritative for
  whether a bundle is signable; no model output, memory, or cache may feed the verdict. (constitution
  "AI never has the final word")

**Honesty & scope**

- **FR-024**: On testnet the buildable action path is the vault (deposit/withdraw/redeem) via a direct
  owner-signed call; direct Aave v3 and Aerodrome-swap simulation MUST be refused honestly (an honest
  "unavailable/not enabled"), never faked. The deferred register MUST be updated to reflect what
  shipped vs. what remains.
- **FR-025**: The existing manual vault confirm flow and the direct-RPC exit path MUST remain
  unchanged and functional; this feature MUST NOT gate or replace the exit hatch.

### Key Entities *(include if feature involves data)*

- **Intent Bundle**: the only state-changing artifact the service ever emits — an inert, unsigned,
  short-lived proposal (ordered steps of unsigned calldata, recipient forced to the user, signature
  always null) plus its simulation, its policy verdict, its guardrail checklist, rationale, and
  citations. Its id is the attribution anchor. Persisted.
- **Simulation Result**: the mandatory pre-trade preview backing a bundle — revert flag + reason,
  balance deltas, expected outputs, gas, freshness block, and a composite "passed" flag. Persisted and
  referenced by the bundle it justifies.
- **Execution**: the durable, append-mostly record of a submitted/confirmed action over the
  on-chain-derived truth — its intent link, signing mode, status through its lifecycle, the resulting
  transaction/userop references, and the attribution link. Never a source of funds movement; a
  convenience index over chain reality.
- **Policy Verdict (wire form)**: the deterministic, LLM-free decision (approved/rejected + reasons +
  the normalized action + the simulation) carried by a bundle and returned in rejections.
- **Guardrail Checklist**: the human-readable pass/fail checks rendered in the drawer (whitelisted
  target, recipient is you, within caps, simulation passed, …), mapped 1:1 to the guardrails + the
  recipient check.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of build responses either return a bundle whose recipient is the connected user
  with a null signature **or** return a reasons envelope with no bundle — there is no third outcome,
  and never a non-null signature from the service. (verified by contract tests over every action type)
- **SC-002**: 100% of signable bundles carry a persisted, passing simulation, and 100% of signatures
  are requested only after that simulation is displayed in the drawer. (spec-001 SC-002)
- **SC-003**: A withdraw/redeem build succeeds under a fully hostile context (paused + at cap + stale
  + no simulator) in 100% of cases, and an exit build never returns a kill-switch, cap, or stale
  rejection. (N2)
- **SC-004**: For a relayed submission, the signed payload is byte-matched to the issued bundle before
  it is recorded/forwarded in 100% of cases; a tampered or unsigned payload is rejected 100% of the
  time and creates no submitted execution.
- **SC-005**: The bytes the wallet signs in the Execution Drawer equal the bytes the server built and
  simulated (byte-match) for 100% of vault signatures — closing the client re-encode gap.
- **SC-006**: A confirmed execution that originated from a recommendation carries the link required to
  attribute a future realized outcome to that recommendation (the intent id is the anchor),
  demonstrably enabling US5. (unblocks SC-010)
- **SC-007**: A full round-trip on alpha (testnet) — build an approved vault-deposit bundle, sign it
  in the drawer with the deployer wallet, submit, and observe it reach confirmed with a real tx hash —
  completes end to end, and the resulting execution row + status are reconstructable from chain.
- **SC-008**: The existing manual vault confirm flow and the direct-RPC exit path continue to pass
  their tests and function unchanged (no regression to custody or the exit hatch).

---

## Assumptions

- **Per-action owner signature, no smart account yet.** On testnet the account is the owner EOA and
  the bundle uses a direct owner-signed call (`opType = eoa_call`, `execMode = per_action`). The
  ERC-4337 smart-account / session-key path is present in the artifact shape but exercised only when
  US6 lands; this feature does not deploy the account.
- **Vault action path only for the demonstrable round-trip.** Direct Aave v3 and Aerodrome swaps are
  out of scope for a real build on testnet (Aave direct is deferred; Aerodrome has no Base-Sepolia
  deployment). Their code paths fail closed honestly.
- **The pure policy engine and the pre-trade simulator already exist** and are consumed, not rebuilt;
  the simulation provider for oracle-free vault custody ops is the live-chain dry-run already wired for
  018's preview.
- **Identity is server-derived.** The connected user's address (owner = account until AA lands) is
  established by the existing session; the browser never asserts custody authority.
- **The existing global request plumbing** (service-to-service auth, user-scoping headers,
  idempotency replay, the standard error envelope) is reused as-is; the relay's durable de-duplication
  is anchored on the new execution record rather than the process-local replay store.
- **Housekeeping is part of "done":** both changelogs, the deferred register, `MIGRATIONS.md`, and the
  as-built docs are updated in the same change.
