# Tasks — 070 Kamino SOL earn

## Phase A — backend (done in this branch)

- [x] T001 `EarnChain.protocols`, `sol` chain (sentinel `chain_id=0`), `KaminoConfig`,
  `dry_probe_addresses`, receipt `protocol` + `receipt_kind`, case-safe address matching.
- [x] T002 `earn/kamino.py`: list + metrics fetch (bounded, fail-open), normalization,
  auto-discover on/off, merge into the shared registry/snapshot refresh.
- [x] T003 Rails: Kamino direct hidden, native-share receipt note, Solana liveness probe recipient,
  no Intents Connect on sol.
- [x] T004 Service preview (`recipient`, native-shares `receiptKind`, `walletSupport`) and list
  `protocol` filter; API `chain=sol` / `protocol=kamino` and recipient validation.
- [x] T005 Parser + DAG hook for Kamino list/deposit without stealing 068/069 flows.
- [x] T006 Snapshot script (Kamino counts, `--kamino-only`) + Kamino dry smoke; run both once.
- [x] T007 Tests: normalization/metrics, auto-discover, config-only USDC vault + receipt,
  case-sensitive keys, rails, previews, router, parser, DAG, golden evals. All 069 tests pass.
- [x] T008 Spec-kit artifacts, CLAUDE.md pointer, CHANGELOG entry.

## Phase B — web (done in this branch)

- [x] T009 Add optional `protocol` / `receiptKind` / `walletSupport` to the shared zod earn
  schemas and Kamino fixtures.
- [x] T010 Kamino list + preview cards: Solana badge, native kVault-share label, base58 recipient
  paste, EVM-wallet vs copy-address deposit affordance.
- [x] T011 Mocked-agent Playwright coverage for “Show Kamino vaults” and a Kamino preview.

## Phase C — live execution (pending, awaits owner)

- [ ] T012 Live 1Click Earn deposit for a Solana receipt (user-signed origin transfer, recipient
  collected at confirm, status polling).
- [ ] T013 Withdraw/redeem via 1Click (kV share → SOL or Base USDC), respecting never-gate-the-exit.
- [ ] T014 Owner decisions: Kamino USDC receipt availability, fee copy, size-cap messaging.
