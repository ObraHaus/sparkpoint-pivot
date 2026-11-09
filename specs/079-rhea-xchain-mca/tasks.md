# Tasks — 079 Rhea cross-chain (071 Phase C)

## Coding (done in this branch)

- [x] T001 `earn/rhea_xchain.py`: exact-"true" flags, key-presence boolean, live gate, unsigned
  ERC-20 transfer plan, honest withdraw review with sources.
- [x] T002 `earn/service.py`: `dry`/`signature` on the Rhea preview; first-deposit
  `requiresSignature` without a 1Click call; gated live quote + deposit address + unsigned plan;
  in-process owner-scoped status.
- [x] T003 `api/earn.py`: gate, quote (`dry` default true), withdraw review and status routes;
  live gate closed ⇒ 403.
- [x] T004 Additive chat-block + shared-schema fields (`live`, `depositAddress`, `transferPlan`,
  `requiresSignature`); 069/070/071 wire unchanged when absent.
- [x] T005 Web `lib/earn/xchain.ts`: flags, gate predicate, review href, review lines, plan
  offerability.
- [x] T006 `/vault/rhea-xchain` review: dry by default, live when gated, first-deposit
  `personal_sign`, unsigned plan, acknowledgement, wallet confirm, honest withdraw review.
- [x] T007 Dual access: `/vault` Rhea row + Sparky Rhea card link to the same review when the
  public flag is on.
- [x] T008 Env example, specs, docs/demo note, CHANGELOG.
- [x] T009 Tests: agent flags/gate/plan/withdraw/API; web flags/review/plan. Lint + unit tests.

## Funded acceptance (blocked, not coding)

- [ ] T010 Fund a Base/Ethereum wallet with USDC + gas and run a real live `dry=false` commit against
  a live `ONECLICK_API_KEY`; verify the unsigned ERC-20 transfer to the 1Click deposit address.
- [ ] T011 Exercise a first-deposit `personal_sign` end-to-end with the real wallet and confirm the
  MCA is created and supplied.
- [ ] T012 Poll 1Click/Rhea order completion and verify status copy.
- [ ] T013 Owner decision to enable `EARN_LIVE_RHEA_XCHAIN` /
  `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` (no flag change in this branch).
- [ ] T014 Decide whether to persist deposit ownership in `crosschain_quotes` (multi-instance).

## Not this branch

- 078 same-chain NEAR → Burrow supply/withdraw (separate worktree/branch).
- 077 live Kamino/Morpho (separate worktree/branch).
- Any Rhea relayer or `nearMcaWithdrawTx` implementation.
