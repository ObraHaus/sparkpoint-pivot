# Tasks — 071 Rhea (Burrow) NEAR earn

## Phase A — backend (done in this branch)

- [x] T001 Config: `near` chain (`protocols:["rhea"]`), `RheaAsset`/`RheaConfig`, `oneclick_rhea`
  rail flag, `earn.json` asset list + fee fallback + origins, `known_protocol("rhea"/"burrow")`.
- [x] T002 `earn/rhea.py`: NEAR JSON-RPC view client (base64 args, decoded result, URL fallback),
  TTL caches (asset/fee ~5 min, MCA ~60 s), exact `customRecipientMsg` builders, unit-safe
  `extra_decimals` math, position parsing, `fetch_rhea_vaults` merged into the registry snapshot.
- [x] T003 Rails: `oneclick_rhea` only; direct/Intents unavailable with reasons; liveness by token.
- [x] T004 Service: Rhea preview (MCA or first deposit, one-time fee, net supplied, message-to-sign,
  source, withdraw link) and read-only positions; wallet required.
- [x] T005 Chat blocks: additive `EarnQuoteBlock` fields + new `EarnPositionsBlock` (camelCase).
- [x] T006 Parser + DAG hook: deposit/list/APY/positions/withdraw; bridge/swap/comparative
  negatives; wallet pass-through; zero LLM.
- [x] T007 API: `GET /earn/rhea/positions` (session wallet only), `protocol=rhea` /
  `rail=oneclick_rhea` filters, preview wallet; contract doc.
- [x] T008 Scripts: `--rhea-only` snapshot merge, Rhea dry smoke (supply/register/5000 + fee/MCA).
- [x] T009 Tests: RPC decode/fallback, extra-decimals, fee present/absent, message shapes, preview
  ok/no-liquidity/RPC-down, positions empty/non-empty/unknown, API scoping, router filters, parser,
  DAG. All 068/069/070 tests pass.
- [x] T010 Spec-kit artifacts, CLAUDE.md pointer, CHANGELOG entry.

## Phase B — web (pending)

- [ ] T011 Shared zod: `earn_positions` block + the Rhea `earn_quote` fields (`protocol`,
  `firstDeposit`, `mca`, `recipient`, `customRecipientMsg`, `messageToSign`, `oneTimeFee`,
  `netSupplied`, `supplyApy`, `source`, `withdraw`); fixtures.
- [ ] T012 Rhea list/preview cards: NEAR/Rhea badge, first-deposit fee + net-supplied line,
  message-to-sign display, withdraw link, positions card.
- [ ] T013 Mocked-agent Playwright coverage for "Deposit 100 USDC into Rhea" and "Show my Rhea
  positions".

## Phase C — live execution (pending, awaits owner)

- [ ] T014 Real off-chain `personal_sign` of `messageToSign` for the first deposit (no gas, no chain
  switch, no NEAR wallet) and the live `dry=false` 1Click deposit flow.
- [ ] T015 Owner decision: in-app withdraw (Rhea relayer business) vs the current
  `app.rhea.finance/lending` link-out.
- [ ] T016 Owner decisions: enable USDT by config, fee copy, 1Click API key.
