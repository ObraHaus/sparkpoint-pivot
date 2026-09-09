# Feature Specification: US6 — Scoped, Revocable Session-Key Automation (the N4 slice)

**Feature Branch**: `feature/US6-session-key-automation`

**Created**: 2026-07-24

**Status**: Draft

**Input**: Implement the Phase-3-deferred US6 item (docs/phase-3-deferred.md row 1): let a user grant
Sparky a **scoped, capped, time-boxed, instantly-revocable** ERC-4337 session key so approved moves
execute **without a per-move signature** — while the user always keeps ultimate control (constitution
N4; Gate C: never fully autonomous). Continues the US6 slice tracked under
`specs/001-sparkpoint-pivot-mvp` (spec §US6, plan §N4, tasks Phase 8 T084–T091, data-model §10 E10,
contracts/policy-schema.md §6, contracts/smart-contracts.md §4/§5, agent-service-api.md §3.9).
Depends on the 019 execution spine (shipped) and the US2 ERC-4337 account (contracts written,
UNDEPLOYED). Testnet: Base Sepolia (84532), vault path only.

---

## Context & Framing

SparkPoint is **non-custodial by construction** (constitution Principle I, N1–N5). Its default
execution mode is **per-action user signature** (Principle II). N4 carves the *only* exception:
**opt-in, scoped, capped, time-boxed, instantly-revocable automation** via an ERC-4337 session key
bounded by an on-chain policy — so a user who wants hands-off rebalancing can grant Sparky a key that
**can only ever churn in scope** and **can never** exceed its caps, reach a non-allowlisted target,
approve/transfer, send to a non-account recipient, or outlive its hard expiry — and the user can
**revoke it instantly and unilaterally, with SparkPoint entirely offline**.

Today US6 is an **honest mock**. The custom ERC-4337 stack (`SparkPointAccount`,
`SessionKeyValidator`, `PolicyModule`, `AccountFactory`) is written and unit-green but **UNDEPLOYED**
on Base Sepolia, blocked on a single ERC-7562 finding: the session-key validation writes the spend
ledger (`recordSpend`) into the **external** `PolicyModule` at a slot that is **not** sender-associated
(`_policies[account][sessionKey]` → `keccak(sessionKey ‖ keccak(account ‖ base))`), which a
safe-mode bundler rejects. The web discloses this truthfully (`/automation` wears a `StatusTag mock`;
`/trust/permissions` says "only you can move funds; Sparky holds no on-chain grant").

This feature **closes US6**: it resolves the ERC-7562 blocker by moving **all** per-session state
into the **account's own storage** (so validation touches only sender storage — unambiguously
compliant), **deploys** the AA stack to Base Sepolia, gets a **real bundler verdict** (Alchemy's
Rundler, EntryPoint v0.7), persists grants in a `session_keys` table, builds the **user-signed grant**
and **instant unilateral revoke** flows, extends the 019 spine with a **session-key submission path**,
de-mocks the web, and wires the `sessionKeyExpiry` notification that feature 021 left ready.

**Non-custody is strengthened, never weakened.** The session key holds **zero** standing authority;
every scope check is deterministic on-chain code; revoke is a **sacred exit** (N2) that no cap, pause,
slippage, or mandate may ever block and that never routes through SparkPoint; the service never
generates or stores a session private key (only the public key); and there is **no** fully-autonomous
path — every automated move is still bounded by the on-chain `PolicyModule` and remains testnet-only
until Gate C (mainnet audit + sign-off).

---

## User Scenarios & Testing *(mandatory)*

### User Story 6 — "Let Sparky rebalance for me, on a leash I hold" (Priority: P3)

A user who trusts the assistant's in-scope moves opts in to automation. They authorize a session key
bound by an on-chain policy: allowlisted vault actions only, a per-transaction cap, a cumulative
lifetime cap, a max-slippage floor, and a hard expiry. From then on, an **approved** move within the
live grant can execute without a fresh signature — but nothing outside the grant can ever execute, and
the user can pull the leash (revoke) at any instant without anyone's help.

**Independent Test** (spec 001 §US6): authorize a session key with explicit caps + expiry; confirm an
in-scope automated action succeeds; confirm an out-of-scope action is rejected **on-chain** and no
funds move; revoke the key and confirm no further automated action can occur; confirm an expired key
is rejected.

#### Acceptance Scenarios

1. **Given** a user opts in to auto-rebalance, **When** they authorize a session key, **Then** the key
   is bound by an **on-chain** policy specifying allowlisted vault actions only + per-transaction and
   cumulative caps + max slippage + a hard expiry, and the scope they sign is displayed **verbatim**
   from the on-chain `Policy` shape (FR-029).
2. **Given** an active session key, **When** the agent attempts an action exceeding
   caps/slippage/allowlist/expiry, or naming a non-account recipient, **Then** the action is rejected
   **on-chain** in `validateUserOp` and no funds move (FR-030) — even if the agent/session key is
   fully compromised.
3. **Given** an active session key, **When** the user revokes it, **Then** revocation takes effect
   **immediately and unilaterally** (no SparkPoint action required — buildable and broadcastable
   entirely client-side / direct on-chain) and no further automated action can be taken (FR-031).
4. **Given** a session key has reached hard expiry, **When** the agent attempts to use it, **Then** the
   attempt fails on-chain and the user is prompted to re-authorize if they wish (FR-032).

#### Edge Cases

- **Cumulative cap exhausted** → any further spend (even 1 unit) is rejected on-chain; `spent` never
  moves past the cap (monotonic + bounded). The user is notified when the cap is nearly reached.
- **Expiring soon** → the user gets a `sessionKeyExpiry` notification ("your session key expires in
  ~24h") derived from the real `session_keys` row; on expiry, a "session key expired" notification.
- **Revoked mid-flight** → the very next session UserOp fails `validateUserOp` (live-storage read); a
  "session key revoked" notification is emitted.
- **Bundle double-spend attempt** → two session ops in one bundle cannot jointly exceed the cumulative
  cap; the spend debit happens in validation against the account's own live storage.
- **Service offline** → the user can still revoke directly on-chain (`SparkPointAccount.revokeSessionKey`
  via `cast`/any wallet) and still exit the vault (ERC-4626 redeem). Neither depends on SparkPoint.
- **Session key never touches the exit** → a session key can enter/exit the *allowlisted vault* within
  caps, but it can never move funds to any non-account address, and it can never approve/transfer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-028** (prerequisite, from US2): the user is the **sole** owner/admin of their smart account; the
  system never generates or holds custody of user wallets.
- **FR-029**: a user MAY opt in to scoped auto-rebalance via a **time-boxed** session key bound by an
  on-chain policy (allowlisted vault actions only, per-tx + cumulative caps, max slippage, hard
  expiry); the scope signed is displayed **verbatim** from the on-chain `Policy`.
- **FR-030**: any automated action exceeding allowlist/caps/slippage/expiry, or naming a non-account
  recipient, MUST be rejected **on-chain**; a compromised agent can never exceed scope.
- **FR-031**: the user MUST be able to revoke a session key **instantly and unilaterally** without
  SparkPoint's cooperation; the next automated action then fails.
- **FR-032**: at hard expiry the key MUST stop working and the user MUST be required to explicitly
  re-authorize to continue.
- **FR-036** (N4): all opt-in automation MUST be bounded by the on-chain policy module and allow
  instant unilateral revocation.
- **FR-U6-1** (this feature): grants and revokes MUST be persisted in an owner-scoped `session_keys`
  mirror table whose values are all reconstructable from chain; the chain is the source of truth.
- **FR-U6-2** (this feature): the agent MUST expose build-only endpoints for grant/revoke UserOps
  (`POST /session-keys/grant/build`, `POST /session-keys/revoke/build`, `GET /session-keys`) that
  return an **unsigned** UserOp + a `scopeEcho` (the normalized on-chain `Policy`); the service
  generates only the session **public** key and never a private key/signature.
- **FR-U6-3** (this feature): the 019 execution spine MUST accept a `session_key` submission path
  (build → simulate → submit the userOp via the bundler) that remains policy-gated, capped, and
  recipient-pinned, recording only the `userop_hash` event (never a key).
- **FR-U6-4** (this feature): the web MUST reflect **real** grant state — `/automation` shows the live
  (but instantly-revocable) grant when one exists and the honest empty state otherwise; the
  `StatusTag mock` is retired; `/trust/permissions` reflects the live grant.
- **FR-U6-5** (this feature): a `sessionKeyExpiry` notification MUST be derived from the real
  `session_keys` table (expiring-soon / expired / revoked / cap-nearly-reached), honest and
  non-fabricated.

### Success Criteria

- **SC-008**: session-key revocation takes effect **immediately and unilaterally**, and **100%** of
  out-of-scope automated actions (exceeding caps, slippage, allowlist, or expiry) are rejected
  **on-chain**.
- **SC-001**: 100% of state-changing actions require an explicit user signature **or** an explicitly
  authorized, in-scope session key.
- **SC-U6-A**: the deployed session-key UserOp passes a **real** ERC-4337 bundler's ERC-7562
  validation (Alchemy Rundler, Base Sepolia, EntryPoint v0.7) — i.e. the recordSpend-in-validation
  blocker is provably resolved, not tuned away.
- **SC-U6-B**: the **N4 adversarial refuter** returns **NOT REFUTED** against the refactored contracts
  (no drain, no cap/expiry overrun, no non-allowlisted target, no approve/non-account recipient, no
  non-immediate revoke).

### Key Entities

- **E10 — Session Key + Policy Scope** (`session_keys` table): the owner-scoped mirror of the on-chain
  `Policy` — smart account, session public key, status (active/expired/revoked/exhausted), allowlisted
  targets + selectors, per-tx cap, cumulative cap, spent, max-slippage bps, valid_after/until, and the
  registered/revoked tx hashes. Reconstructable from chain; the chain is authoritative.

---

## Constraints / Non-Goals

- **Testnet only.** Base Sepolia (84532), vault path. Mainnet is behind **Gate C** (recorded internal
  security audit + hardening sign-off; **never autonomous**) and is out of scope.
- **Never autonomous** (Gate C, Principle II). Every automated move stays bounded by the on-chain
  `PolicyModule`. No never-user-signed path is built.
- **No Sui / non-EVM.** Session-key automation on Move is a deferred follow-on.
- **No new strategy / no fee-path change.** Scope is the existing allowlisted vault + Aave + swap
  action set already defined in policy-schema §3/§6; caps/slippage/expiry bounds come from
  `packages/shared`.
- **Revoke is a sacred exit** (N2, policy-schema §6 rule 7): never cap-, pause-, slippage-, or
  mandate-gated; owner-only; instant; agent-independent.
