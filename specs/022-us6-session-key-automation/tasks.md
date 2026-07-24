# Tasks — US6 Session-Key Automation (feature 022)

Ordering: **Phase 1 gates everything** (the contracts define the ABI the backend + web consume).
`[P]` = parallelizable once its phase's prerequisites are met. Confirm-before-deploy and
confirm-before-PR are hard stops.

## Phase 1 — Contracts (gating)

- **T1.1** Refactor `PolicyModule.sol` → stateless: keep global `_allowed[target][selector]` arming
  map + `setAllowedTarget`/`setSessionValidator`(drop) + forbidden-selector guard + pure
  `checkScope(policy, call, valueUSD)` / `decodeAction` / `slippageFloor` / `isAllowedTarget`. Remove
  `_policies`, `recordSpend`, `registerSession`, `revokeSession`, `activeSessionKey`.
- **T1.2** Refactor `SessionKeyValidator.sol` → pure: `validate(Policy memory p, PackedUserOperation
  calldata op, bytes32 hash) view returns (uint256 validationData, uint256 notional)`; recover signer,
  run the 6-step scope flow over the in-memory policy + the policy's snapshot allowlist; **no** storage
  writes, **no** external `PolicyModule` state calls.
- **T1.3** Refactor `SparkPointAccount.sol` → owns session storage: `mapping(address => SessionPolicy)
  _sessionPolicies` + `_activeSessionKey`; `authorizeSessionKey(policy, targets, selectors)` (onlyOwner,
  §6 bounds + subset-of-global via `PolicyModule.isAllowedTarget` at grant time, snapshot); `validateUserOp`
  mode 0x01 reads own policy → pure validate → writes `spent` in own storage; `revokeSessionKey`
  (onlyOwner, instant, no pause); views `sessionPolicyOf` / `checkAction` / `isSessionAllowed`.
- **T1.4** Update interfaces (`IPolicyModule`, `ISessionKeyValidator`, `ISparkPointAccount`) + NatSpec
  (correct the "account-associated storage" claim to "account **own** storage").
- **T1.5** Update tests to the new API (semantics unchanged): `AccountTestBase.sol`, `refute/*`,
  `invariant/*`, `fuzz/SessionKeyValidator.t.sol`, `integration/SessionDepositFork.t.sol`,
  `invariant/PolicyModule.t.sol`. `forge build` + `forge test --match-path 'test/account/**'` green.
- **T1.6** Re-run the **N4 adversarial refuter** (`.claude/agents/adversarial-refuter.md`) — must
  return **NOT REFUTED** (SC-U6-B).
- **T1.7** Deploy script `contracts/script/DeploySessionStack.s.sol` (impl + factory + validator +
  policy; arm the global allowlist with the vault/Aave/Aero pairs). **Confirm before broadcast.**
- **T1.8** Deploy to Base Sepolia; record addresses in the address book + `contracts/deployments/`.
- **T1.9** Submit a mode-0x01 UserOp to the Alchemy bundler → real ERC-7562 **accept** (SC-U6-A);
  record the verdict; retire the bundler-spike blocker note.

## Phase 2 — Backend `[P after Phase 1]`

- **T2.1** `migrations/0024_session_keys.sql` (data-model.md): `session_keys` + `session_key_status`
  enum; additive/idempotent; `PGCLIENTENCODING=UTF8`. Apply to develop DB; update MIGRATIONS.md.
- **T2.2** `db/session_keys.py`: `SessionKeyStore` (insert grant, mark revoked, update spent/status
  from chain, list by wallet, get active). Owner-scoped; chain is authoritative.
- **T2.3** `policy/session.py`: `SessionScope` frozen model + `evaluate_session_grant(scope, ctx)`
  (§6 rules 1–6, bounds from `packages/shared`); wire into `policy/evaluate.py` replacing the
  fail-closed grant stub. Keep `session_key_revoke` sacred exit unchanged.
- **T2.4** `api/sessions.py`: `POST /session-keys/grant/build`, `POST /session-keys/revoke/build`,
  `GET /session-keys` — build **unsigned** UserOps; `scopeEcho` verbatim; service makes only the
  session **public** key.
- **T2.5** `execution/bundler.py`: Alchemy Rundler client (`eth_sendUserOperation`,
  `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_supportedEntryPoints`).
- **T2.6** Session-key submission path: open `orchestrate.build_tx` (`execMode='session_key'` →
  set `exec_mode`/`is_session_key_path`, build userOp via `builder`), `orchestrate.submit_signed`
  (`opType='userop'` → simulate + submit via bundler, record `signing_mode='session_key'` +
  `userop_hash`), `submission_status` (userop receipt). Still policy-gated + recipient-pinned.
- **T2.7** `api/notifications.py`: `_session_key_notif()` + `sessionKeyExpiry` derivation source
  (expiring-soon / expired / revoked / cap-near) from `session_keys`; fail-open.
- **T2.8** Agent tests: SessionScope validator, sessions API, bundler client (mocked), notification
  derivation. `ruff` + `mypy --strict` + `pytest` green.

## Phase 3 — Web `[P after Phase 1]`

- **T3.1** `lib/automation/useSessionKey.ts`: read the live grant (on-chain account view + agent
  `GET /session-keys`); honest undefined-guard.
- **T3.2** `app/(app)/automation/page.tsx`: retire `StatusTag mock`; render the live (revocable) grant
  card + instant Revoke (client-buildable) or the honest empty state.
- **T3.3** `app/(app)/automation/grant/page.tsx`: controlled inputs; build+sign a real grant via the
  ExecutionDrawer path (not `confirm/deposit`).
- **T3.4** `app/(app)/trust/permissions/page.tsx`: conditionalize the "no grants" banner to reflect a
  live grant. Vault-fact table stays. `typecheck:test` + `lint` + `build` green.

## Phase 4 — Housekeeping (same change)

- **T4.1** `CHANGELOG.md` (### Added — 022) + `services/agent/content_seed/whats-new.json` (new slug,
  tester-friendly). **T4.2** `MIGRATIONS.md` 0024 ✅. **T4.3** delete `docs/phase-3-deferred.md` row 1;
  retire the AA/US6 bullet in `docs/ops/known-limitations.md`; update `docs/orchestration/wave-state.json`
  P3 + `docs/architecture-as-built.md` US6 line. **T4.4** quickstart validation run (SC-008 / SC-U6-A /
  SC-U6-B / the N4 revoke drill). **T4.5** confirm-before-PR.
