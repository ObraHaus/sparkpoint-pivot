# Research — US6 Session-Key Automation (Phase 0)

## R1 — Resolving the ERC-7562 recordSpend-in-validation blocker (the load-bearing decision)

**Finding (first-hand + tracer-confirmed).** `SessionKeyValidator.validateUserOp` writes the spend
ledger into the **external** `PolicyModule` during validation (`recordSpend` → `_policies[account][sessionKey].spent`). That slot is `keccak(sessionKey ‖ keccak(account ‖ base))`, which
ERC-7562 Definition 5 associates with the **sessionKey**, not the sender/account. Validation also
reads `policyOf` (same association) and `isAllowedTarget` (keyed by `target`). Per the ERC-7562
storage rules, an unstaked entity may only touch the sender's own storage ([STO-010]) or
sender-associated storage ([STO-021]/[STO-022]); the observed accesses are none of these → a
safe-mode bundler rejects the UserOp. The local Alto-0.0.20 spike couldn't render a *clean* verdict
(a viem decode bug on `delegateAndRevert 0x99410554`, proven by an owner-mode control failing
identically), but the tracer captured the offending external write, so the risk is real.

**Options considered.**
1. **Path A — account-owned session storage (CHOSEN).** Move `Policy` (config + `spent`) + the
   per-session `(target,selector)` allowlist snapshot into `SparkPointAccount`'s own storage.
   `validateUserOp` reads config + writes `spent` in own storage only → [STO-010], unambiguous, no
   staking, no external dependency for compliance. `PolicyModule` → stateless checker + a global
   arming allowlist read **only at grant time** (a normal owner tx). `SessionKeyValidator` → pure,
   policy passed in memory; the account does the `spent` write.
2. Move `recordSpend` to the execution phase. **Rejected** — handleOps validates all ops before
   executing any, so two bundled session ops can each pass the cap check against stale `spent` (a
   double-spend window). Would need a defensive execution-time re-check + nonce serialization anyway.
3. Reorder `_policies` to `[sessionKey][account]` (sender-associated) + immutable validator allowlist.
   **Rejected** — relies on the nested-mapping association allowance the spike itself calls a **gray
   area** (reference tracers attribute a slot to the *outermost* key); higher residual bundler-reject
   risk than own-storage. Also freezes the target set into validator bytecode.
4. Stake the `PolicyModule`. **Rejected** — locks `MIN_STAKE_VALUE` with an unstake delay, subjects a
   **shared** module (one across all accounts) to EREP throttle/ban limiting bundling throughput, and
   still leaves the `target`-keyed allowlist read non-compliant.

**Decision.** Path A. It is the operator's own `RESULT-safemode.md` recommendation, realizes the
spec's stated "account-associated storage keyed by account" intent, matches §6's per-session
`allowlist`, keeps the spend debit atomic in validation (no double-spend window), and — because
nothing is deployed — carries zero storage-migration risk. **Gate:** account suite green (semantics
unchanged) + N4 refuter NOT REFUTED + a real Alchemy-bundler ERC-7562 accept.

**Target shape.**
- `SparkPointAccount` storage: `_owner`, `mapping(address sessionKey => SessionPolicy)`
  `_sessionPolicies`, `address _activeSessionKey` (single-agent-key model preserved). `SessionPolicy`
  = the 8 `Policy` fields + a bounded `(target,selector)` allowlist snapshot.
- `authorizeSessionKey(policy, targets, selectors)` onlyOwner: enforce §6 bounds (validUntil required
  + ≤ MAX_SESSION_DURATION, no validUntil==0), verify each `(target,selector)` ∈ global arming set via
  `PolicyModule.isAllowedTarget` **and** not a forbidden selector, snapshot into own storage.
- `revokeSessionKey(key)` onlyOwner: set `revoked` in own storage — instant, unilateral, no pause.
- `validateUserOp` mode 0x01: load own `_sessionPolicies[signer]`; `PolicyModule.checkScope(policy,
  call, notional)` (pure) or the pure `SessionKeyValidator` returns `(ok, notional, window)`; on pass
  write `spent += notional` in own storage; pack the window.
- `PolicyModule`: keep the global `_allowed[target][selector]` arming map + forbidden-selector guard +
  pure `checkScope`/`decodeAction`/`slippageFloor`; drop `_policies`/`recordSpend`/`registerSession`/
  `revokeSession`/`activeSessionKey` (they move to the account). Off-chain parity + Trust Center read
  the account's `sessionPolicyOf`/`checkAction` views.

## R2 — Bundler infrastructure (real ERC-7562 verdict + runtime submission)

**Decision.** Use the **existing Alchemy** endpoint. `BASE_SEPOLIA_RPC_URL` =
`https://base-sepolia.g.alchemy.com/v2/<KEY>`; Alchemy runs a spec-compliant ERC-4337 bundler
(Rundler) on the **same** URL. Verified live: `eth_supportedEntryPoints` returns the **v0.7 singleton**
`0x0000000071727De22E5E9d8BAf0edAc6f37da032` (exactly what `SparkPointAccount` pins), `eth_chainId` =
`0x14a34` (84532). This gives (a) the real ERC-7562 [STO-*] verdict via `eth_sendUserOperation`
(supersedes the broken local Alto spike), and (b) runtime userOp submission + `eth_getUserOperationReceipt`. **No paymaster needed** — the account self-prefunds its EntryPoint deposit (as the spike
already does). No separate Pimlico. The agent bundler client reuses the existing Alchemy key.

## R3 — SessionScope grammar → Python model + on-chain parity

`policy-schema.md §6` defines `SessionScope` (maps 1:1 to `PolicyModule.Policy`): `sessionKey`,
`validAfter`, `validUntil` (required, ≤ 30 d), `perTxCap`/`cumulativeCap` (USDC 6dp), `maxSlippageBps`
(∈ [protocolFloorBps=50, absoluteCeilingBps=300], swaps only), `allowlist` (⊆ global §3, narrow-only),
`recipientPin='user_account'`, `revocable=true`, `spent`. Off-chain the policy engine has
`session_key_revoke` as an unconditional sacred exit but `session_key_grant` is a fail-closed stub. We
add `policy/session.py`: a frozen `SessionScope` dataclass + `evaluate_session_grant(scope, ctx)`
enforcing §6 grammar rules 1–6, wired into `evaluate()` in place of the stub. Bounds come from
`packages/shared` (session caps + slippage floor/ceiling + maxSessionDurationDays) to prevent drift
(§9). The displayed scope is echoed verbatim from the normalized on-chain `Policy` (FR-029).

## R4 — 019 spine + 021 notification reuse

**Spine is pre-shaped.** `signing_mode` enum already has `'session_key'`; `intent_bundles.is_session_key_path` exists; `BuildTxRequest.execMode: Literal['per_action','session_key']`;
`SignedPayload.opType: Literal['userop','eoa_call']`; `ExecutionStore.insert_submitted(signing_mode,
userop_hash)` already accepts the session shape. Gaps: `orchestrate.build_tx` hard-refuses
`execMode != 'per_action'` (lines ~282–287); `builder.build_steps` only emits `eoa_call`;
`orchestrate.submit_signed` hard-refuses `opType == 'userop'` (lines ~492–498); `submission_status`
resolves only an eth-tx receipt. We open these for the session-key path (build a v0.7
`PackedUserOperation` with `signature=null`; simulate via `eth_estimateUserOperationGas`/on-chain
dry-run; submit via the bundler; resolve `eth_getUserOperationReceipt`). Three vocabularies to map:
DB `signing_mode` (`per_action_user_signature`/`session_key`), wire `execMode`
(`per_action`/`session_key`), `opType` (`userop`/`eoa_call`).

**Notifications derive-on-read (021).** `GET /notifications` rebuilds the feed live; `sessionKeyExpiry`
+ its Settings toggle already flow through the web unchanged but emit nothing (no session keys existed).
We add a third derivation source reading the `session_keys` table: a `_session_key_notif()` helper
returning `_Derived(expiry_dt, None, item)` with `category='sessionKeyExpiry'`, wrapped in the same
fail-open try/except as the executions/flows blocks. No poller needed (expiry/expired/revoked are
standing conditions). Web needs no change.
