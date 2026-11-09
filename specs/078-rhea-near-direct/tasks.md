# Tasks — 078 Rhea same-chain NEAR direct earn

## Implemented

- [x] T001 Confirm authoritative IDs via read-only RPC: `contract.main.burrow.near`, native USDC
  `17208628…133a1` with `decimals=6` and Burrow `extra_decimals=12`; storage minima; registration
  state; probe-account balances/position.
- [x] T002 `burrow.ts`: allowlists, exact amount parsing/bounds, 6↔18 dp conversion, supply builder
  (optional storage_deposit + `ft_transfer_call` empty supply msg, exact 1 yocto), withdraw builder
  (`execute` → `Withdraw` with token_id/max_amount), balance/reserve/withdraw refusals, freshness,
  wallet-switch guard, receipt classification.
- [x] T003 Separate wallet capability: adapter `sendTransactions` + `getConnectedAccount`; provider
  exposure; re-check account immediately before send; login/NEP-413 paths remain transaction-free.
- [x] T004 Read-only RPC helpers (view/account/block/tx) with no send surface.
- [x] T005 `POST/GET /api/earn/rhea/live` unsigned preflight (server flag gate) and
  `GET /api/earn/rhea/receipt` honest finality polling.
- [x] T006 Rhea flags `EARN_LIVE_RHEA` / `NEXT_PUBLIC_EARN_LIVE_RHEA`, default off; server page 404.
- [x] T007 Self-contained `/vault/live` UI: connect → supply/withdraw → preflight review +
  acknowledgement → confirm → receipt polling; wallet-switch/stale-plan refusal.
- [x] T008 Entry points from `/vault` registry row and Sparky's Rhea earn card when public flag on.
- [x] T009 Unit tests: builders, allowlists, storage, reserves, bounds, withdraw, receipt, freshness,
  wallet switch, flags, no-tx login path, adapter transaction boundary.
- [x] T010 Read-only simulation `scripts/earn-sim/rhea-near-sim.mjs`, labelled SIMULATED.
- [x] T011 Docs: spec set, CHANGELOG, in-app what's-new, demo note; cross-chain deferred stated.
- [x] T012 Run web unit tests, lint, typecheck, build; secret-scan the diff.

## Funded / operational follow-ups (not done here)

- [ ] T013 Fund a NEAR test account with USDC + NEAR; exercise a real supply (including the one-time
  0.1 NEAR Burrow storage deposit) and withdraw end-to-end.
- [ ] T014 Verify receipt polling and UI copy with a real Meteor wallet (multi-transaction batch).
- [ ] T015 Decide whether to reuse a shared `/vault/live` route once 077 lands; currently
  self-contained to avoid depending on unmerged code.
- [ ] T016 Owner decision/credentials for the deferred 071 cross-chain MCA/1Click Phase C path
  (env names only; not part of 078).
- [ ] T017 Operational flag enablement after funded tests (not performed by this branch).
