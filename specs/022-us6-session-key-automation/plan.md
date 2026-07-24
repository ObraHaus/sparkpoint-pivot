# Implementation Plan: US6 — Scoped, Revocable Session-Key Automation

**Branch**: `feature/US6-session-key-automation` · **Spec**: [spec.md](./spec.md) · **Date**: 2026-07-24

**Constitution**: v2.0.0 (`.specify/memory/constitution.md`) — N1–N5, Gate C, Principles I–VII.

## Summary

Close the Phase-3-deferred US6 slice: resolve the ERC-7562 recordSpend-in-validation blocker by
relocating **all** per-session policy state into the **account's own storage**, deploy the ERC-4337
stack to Base Sepolia, prove the fix against a **real** bundler (Alchemy Rundler, EntryPoint v0.7),
then build the grant/revoke flows, the session-key submission path on the 019 spine, the de-mocked
web surfaces, and the `sessionKeyExpiry` notification. One vertical slice, testnet, vault path,
never autonomous.

## The load-bearing decision — resolving the ERC-7562 blocker (research.md R1)

**Problem.** `SessionKeyValidator.validateUserOp` (today) calls `policyModule.recordSpend(...)` during
validation, writing `_policies[account][sessionKey].spent` in the **external** `PolicyModule`. That
slot = `keccak(sessionKey ‖ keccak(account ‖ base))` — associated with the **sessionKey**, not the
sender (ERC-7562 Definition 5). It also **reads** `policyOf` (same association) and `isAllowedTarget`
(keyed by `target`). An unstaked entity touching non-sender-associated external storage in validation
is an [STO-021]/[STO-022] violation → a safe-mode bundler rejects the UserOp.

**Chosen fix — Path A: account-owned session storage.** Move the session `Policy` (config + monotonic
`spent`) **and** a snapshot of the per-session `(target,selector)` allowlist into `SparkPointAccount`'s
**own** storage, keyed by `sessionKey`. Then `validateUserOp` reads config and writes `spent`
touching **only the account's own storage** ([STO-010] — the least-contestable rule; no staking, no
hosted-bundler dependency to reach compliance). `PolicyModule` becomes a **stateless** scope-checker
(pure decode + cap/slippage/recipient logic) plus the **global arming allowlist** that is read **only
at grant time** (an ordinary owner tx, not bundler-validated, where the §6 "allowlist ⊆ global"
subset check is free). `SessionKeyValidator` becomes a **pure** validator that takes the `Policy` in
memory and returns `(validationData, notional)` without touching storage; the account performs the
`spent` write itself.

**Why Path A over the alternatives** (research.md R1):
- *vs. move recordSpend to the execution phase*: that reintroduces a **bundle double-spend window**
  (handleOps validates all ops before executing any), so two session ops could each pass the cap
  check against stale `spent`. Path A keeps the debit atomic in validation against live own-storage.
- *vs. reorder the mapping to sender-associated + immutable allowlist*: relies on the nested-mapping
  "sender-associated external storage" allowance the spike itself calls a **gray area** (tracers
  differ); Path A's own-storage rule is unambiguous.
- *vs. stake the PolicyModule*: locks capital + unstake delay + shared-entity reputation throttle
  across all accounts; still leaves the target-keyed allowlist read non-compliant.

Path A is **the operator's own `RESULT-safemode.md` recommendation** ("move the in-validation spend
write into the account's OWN storage… unambiguously permitted"), it **realizes the spec's stated
intent** (`PolicyModule` NatSpec claims "account-associated storage keyed by account" — the nesting
just missed it), and it matches §6 (which already defines a per-session `allowlist`). Nothing is
deployed, so there is **zero storage-migration risk** to restructuring the account now.

**Verification.** After the refactor: `forge build` + the full account suite green (semantics
unchanged — the invariant + refuter suites are the guardrail), then re-run the **N4 adversarial
refuter** (must return NOT REFUTED), then deploy to Base Sepolia and submit a mode-0x01 UserOp to the
Alchemy bundler for the **real** ERC-7562 verdict (SC-U6-A).

## Constitution Check

*GATE: must pass before implementation. This feature touches N4 (a custody-relevant automation path),
so the check is explicit and the N4 refuter is a hard gate (SC-U6-B).*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Non-custodial (N1–N5)** | N1 recipient pinned to account; N2 exit/revoke never gated; N3 user sole owner, service never signs/stores keys; N4 automation on-chain-bounded + instantly revocable; N5 provable/reconstructable | **PASS by construction.** N1: the validator forces every decoded recipient == the account and never allowlists approve/transfer/transferFrom/arbitrary — a session key can never move funds to a non-account address (proven by RefuteSessionDrain). N2: `revokeSessionKey` is owner-only, instant, unilateral, carries **no** pause/cap/timelock modifier, and off-chain `session_key_revoke` is an unconditional sacred exit; the ERC-4626 redeem exit path is untouched. N3: the service builds **unsigned** UserOps and generates only the session **public** key; the account owner (user EOA) is the sole signer/admin; `_authorizeUpgrade` is owner-only. N4: all scope lives in immutable on-chain code read live in `validateUserOp`; revoke is a live-storage read so it bites on the very next op. N5: `session_keys` mirrors chain and every value is base-unit exact + reconstructable; the vault stays single-purpose/non-upgradeable (untouched). **Path A moves state into the account's own storage — it does not add any admin/sweep/recipient path.** |
| **II. AI proposes, deterministic policy + user disposes** | policy gate authoritative; scoped session key is the *only* non-per-action exception, still policy-bounded | **PASS.** A grant is only ever built after the deterministic `SessionScope` validator approves the §6 grammar; a session move is only submitted after `evaluate()` approves **and** the on-chain `PolicyModule`/validator re-enforces it. The LLM never has the final word; no memory/embedding feeds the policy verdict. |
| **III. Provable, not promised** | real chain reads or honest empty/degraded state; no faked figure | **PASS.** Grants/scope/spent/expiry are read from chain (the `session_keys` mirror is reconstructable); the web shows the real grant or an honest empty state; the `sessionKeyExpiry` notification is derived only from real rows (no placeholder); the bundler verdict is a real submission (SC-U6-A), not a claim. The `StatusTag mock` is retired only when a real read backs it. |
| **IV. Bounded blast radius** | policy wraps every decision; address+selector allowlist; sim before submit; pause-only kill-switch | **PASS.** Only allowlisted `(target,selector)` tuples validate; forbidden selectors (approve/transfer/transferFrom/arbitrary) are rejected **by construction**; the per-session allowlist can only **narrow** the global set (§6 rule 1); the userOp is simulated before submission; caps + slippage + expiry bound each move; the kill-switch is unaffected (and never gates the exit/revoke). |
| **V. Conservative launch / non-upgradeable custody** | vault single-purpose + non-upgradeable; no new strategy; curated wrapper allowlist isolated from the session-key path | **PASS.** No vault/strategy/fee change. The `PolicyModule`/`SessionKeyValidator`/session-key path does **not** read the curated Morpho allowlist (Principle V, N4). The account is UUPS but owner-only-upgradeable (SparkPoint can never upgrade it); the vault is untouched. |
| **VI. Spec-driven** | spec → plan → tasks + Constitution Check before code | **PASS.** This sub-spec (022) continues the ratified 001 US6 slice; the N4 refinement is recorded here explicitly (not introduced implicitly through implementation). |
| **VII. Simplicity / YAGNI** | narrowest slice that ships the milestone | **PASS.** Testnet + vault path only; existing 019 spine, 021 notification pipeline, and policy engine are **extended**, not rebuilt; the account/adapter/policy machinery from US2 is reused. |

**No violations.** The one governance-relevant refinement — relocating session state into the account
(Path A) to satisfy ERC-7562 — is a **strengthening** of N4/N1 (validation now touches only the
account's own storage, and the on-chain scope enforcement is unchanged in behavior). It is recorded in
research.md R1 and gated by the N4 refuter (SC-U6-B). No relaxation of N1–N5, the pause-only
kill-switch, the AI-disposition rule, or non-upgradeable vault semantics is made.

## Project Structure

```text
specs/022-us6-session-key-automation/
├── plan.md              # this file
├── spec.md              # the ratified sub-spec
├── research.md          # R1 ERC-7562/Path A · R2 Alchemy bundler · R3 SessionScope · R4 spine reuse
├── data-model.md        # 0024_session_keys table + status enum + VR mapping
├── quickstart.md        # end-to-end validation (SC-008 / SC-U6-A / SC-U6-B), incl. the N4 drill
├── contracts/
│   └── session-endpoints.md   # grant/revoke/list request-response + submission-path shapes
└── checklists/requirements.md # spec quality checklist
```

### Source (the vertical slice)

- **Contracts** (`contracts/src/account/`): `SparkPointAccount.sol` (now owns session storage),
  `SessionKeyValidator.sol` (now pure), `PolicyModule.sol` (now stateless + global arming allowlist),
  interfaces; deploy script `contracts/script/DeploySessionStack.s.sol`; tests updated + N4 refuter.
- **Agent** (`services/agent/`): `migrations/0024_session_keys.sql`; `db/session_keys.py`;
  `policy/session.py` (SessionScope model + grant validator) wired into `policy/evaluate.py`;
  `api/sessions.py` (grant/revoke/list); the session-key branch in `execution/orchestrate.py` +
  `execution/builder.py` (userOp build) + a bundler client `execution/bundler.py`;
  `api/notifications.py` `sessionKeyExpiry` derivation.
- **Web** (`apps/web/`): `lib/automation/useSessionKey.ts` (on-chain + agent read);
  `app/(app)/automation/page.tsx` + `automation/grant/page.tsx` (real grant/revoke via ExecutionDrawer);
  `app/(app)/trust/permissions/page.tsx` (conditional live-grant banner).

### Living docs (same change)

`CHANGELOG.md` + `services/agent/content_seed/whats-new.json` (both), `MIGRATIONS.md` (0024 ✅),
`docs/phase-3-deferred.md` (delete row 1), `docs/ops/known-limitations.md` (retire the AA/US6 bullet),
`docs/orchestration/wave-state.json` (P3 deferred_items[0]), `docs/architecture-as-built.md` (US6 line).

## Phases

- **Phase 0 — Research** (research.md): R1 Path A decision (this plan §load-bearing) · R2 Alchemy
  bundler (live, EP v0.7, verified) · R3 SessionScope grammar → Python model + on-chain `Policy`
  parity · R4 019 spine + 021 notification reuse points.
- **Phase 1 — Contracts (gating)**: Path A refactor → `forge build` + account suite green → N4 refuter
  NOT REFUTED. **Then** deploy to Base Sepolia (confirm-before-deploy) + real bundler verdict (SC-U6-A).
- **Phase 2 — Backend**: 0024 + store; SessionScope validator; grant/revoke/list API; session-key
  submission path on the spine; `sessionKeyExpiry` derivation.
- **Phase 3 — Web**: de-mock `/automation` + `/automation/grant` + `/trust/permissions`.
- **Phase 4 — Housekeeping**: both changelogs + all living docs; full agent + web CI green;
  quickstart validation run. Confirm-before-PR.
