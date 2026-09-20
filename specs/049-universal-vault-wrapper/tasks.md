# Tasks — 049 Universal upgradeable vault wrapper

Legend: `[x]` done · `[ ]` not started · **[GATED]** blocked by a live child vault (Gate 0) or external review.

## Phase W0 — Constitution + spec kit

- [x] **T001** Constitution **v4.0.0** amendment (`.specify/memory/constitution-amendment-v4.0.0.md`) + `constitution.md` updated (N5, IV.5(a), IV.6, Principle V, upgradeability, contracts list, amendment log).
- [x] **T002** Spec/plan/tasks (`specs/049-universal-vault-wrapper/`) + roadmap artifact (`docs/orchestration/vault-program-roadmap.html`).
- [x] **T003** Generate the scoped AI deployer wallet (address recorded: `0xB555dbEc2cC5908c8B245ED84cb038D5d205D875`; key outside the repo, 0600).

## Phase W1 — Contracts (P8)

- [x] **T101** Add `@openzeppelin/contracts-upgradeable` (v5.1.x, matching the vendored OZ 5.1.0) + remapping; `forge build` green.
- [x] **T102** `SparkPointUniversalVault.sol` — implementation per plan: initializer, child binding, HWM fee (dilution, fail-open), caps, pause-deposits-only, direct unwind, slippage overload, decimals offset, ERC-7201 storage.
- [x] **T103** `SparkPointVaultFactoryV2.sol` — deploy-only, allowlist + on-chain validation + role-gated deployer, CREATE2 BeaconProxy + per-wrapper CapRegistry, events.
- [x] **T104** Beacon: thin `SparkPointVaultBeacon` (OZ `UpgradeableBeacon`) + deploy script wiring the TimelockController as owner.
- [x] **T105** Interfaces + natspec (custody invariants documented per selector; no fund-moving selector exists).

## Phase W2 — Tests (P8)

- [x] **T201** Unit/fuzz: initializer guards; child binding immutability; deposit/mint/withdraw/redeem; HWM fee above/below (fuzz incl. loss-then-gain); cap enforcement; pause-deposits-only; minSharesOut; inflation/donation; V2 `max*==0` liquidity fallback.
- [x] **T202** Factory: deployer gating, allowlist, fee cap, validation rejects, deterministic address prediction, CapRegistry ownership.
- [x] **T203** Upgrade suite: beacon upgrade preserves storage + invariants; malicious implementation caught by CI checks; storage-layout compatibility.
- [ ] **T204** Invariant/fuzz harness: withdraw-always, fee ≤ cap, child unchanged across upgrades, no asset path to any SparkPoint address.
- [ ] **T205** [GATED] Fork rehearsal against a real vault (4663 when one exists, else the supported-chain equivalent) incl. upgrade-with-open-position.

## Phase W3 — Deployer runner (P9)

- [x] **T301** Agent endpoints: admin deploy-request + S2S deploy-report (mirror the curator Run-now/ingest pattern; the agent holds no key).
- [x] **T302** `runners/src/deployer.ts`: poll requests, pre-check allowlist/fee/caps, simulate + `createVault`, report tx/address, heartbeat; fail loud, never silent.
- [x] **T303** Tests (node:test) + runbook/env (`WRAPPER_DEPLOYER_PRIVATE_KEY`, chain 4663, gas-only, rotation) + Kuma monitor.
- [ ] **T304** Monitoring/ops: deploy alert (child + tx + proxy), no-report incident, funding alerts.
      *(runner side done: every attempt is reported loudly; Kuma/monitor wiring is an ops step.)*

## Phase W4 — Audit + deploy (P10)

- [ ] **T401** CI: `upgrades-core validate` + `slither-check-upgradeability` + full Foundry suite on every PR touching contracts.
- [ ] **T402** External review of the implementation + beacon upgrade path; resolve findings.
- [x] **T403** Operator-signed deploy on 4663: TimelockController → beacon → implementation → factory; on-chain verification passed; 4663 book updated. *(allowlist seed remains gated on Gate 0; Safe `setDeployer` op `0x3581b36c…85e0` scheduled 2026-09-19, executable 2026-09-22 07:43 UTC.)*
- [ ] **T404** [GATED] First wrapper deployment for a live curated vault (requires Gate 0) via the deploy runner.

## Phase W5 — Product wiring + disclosure (P11)

- [x] **T501** Curated store `wrapped`/`wrapperAddress` wired from real deployments (the runner's success report flips the row), deposit rail already routed wrappers with the fee disclosure; the first real wrapper book entry lands with T404. Runner report wiring + tests in #225.
- [x] **T502** Trust Center rewritten: 3-of-5 proposer Safe → 72h timelock, independent 2-of-3 canceller, exit never gated, residual-risk stated; the "non-upgradeable" guarantee now scoped to SparkPoint's own vault (§W5, #225).
- [x] **T503** Spec 048 M1 closed with the review recorded there; both changelogs updated same-beat (#225).
- [x] **T504** Admin → Vaults → Wrapper deployments: provenance on each row, request form (fee/caps/name/symbol/label), cancel-while-pending; the runner executes and reports back (#225).

## Phase W6 — V3 pivot (amendment v4.1.0, 2026-09-19)

- [x] **T601** `SparkPointVaultFactoryV3` + `ISparkPointVaultFactoryV3` — OZ `AccessControl` admission (instant `ADMIN_ROLE` lane · cooldown-gated `DEPLOYER_ROLE` lane), `releaseNow` / `unwhitelist` / `setCooldown` (bounded 1h–7d), `wrapperOf` one-wrapper-per-child, V2 deploy path retained (CREATE2 `BeaconProxy` + per-wrapper CapRegistry, child validation, fee/caps, rolling `deployLimit`); 41 Foundry tests + `DeployVaultFactoryV3.s.sol` (PR #228).
- [x] **T602** Operator-signed V.3 deploy on 4663: impl `0xa65596e6…2213`, Transparent proxy `0x1de85106…6406` (ProxyAdmin owner = timelock); initializer role grants + cooldown + fleet wiring verified on-chain; recorded in `contracts/deployments/4663/addresses.json → wrapper.factoryV3`.
- [x] **T603** V.4 sunset: cancelled the Sep 22 `setDeployer` op via Safe B (`timelock.cancel(opId)`, tx `0x481f6e18…c239`, 2026-09-20; `isOperationPending` = false) + removed the auto-execute cron; V2 factory marked sunset in the book (`wrapper.factoryStatus`, `timelockOps.setDeployer.status`). PR #235.
- [x] **T604** V.5 runner: auto-whitelist newly published curated vaults as AI entries → auto-deploy after the cooldown; SKIP entries not added by the AI key (provenance); report + heartbeat; tests. PR #230; `byAddress` provenance fix in #234.
- [x] **T605** V.6 panel: whitelist queue (countdown / ready / deployed / cancelled), instant Whitelist / Deploy-now / Cancel, cooldown setting; agent migration 0040 + routes + tests. PRs #231 (agent) + #232 (panel); 0040 applied to `sparkpoint-postgres-beta` 2026-09-20.
- [x] **T606** V.7 wiring + disclosure: book + `packages/shared` (V3 ABI + 4663 addresses) + deployer app `WRAPPER_FACTORY_ADDRESS` → V3; Trust Center + BOTH changelogs; V2 request queue retired. PRs #232 + cleanup.
- [ ] **T607** V.8 go-live: Steakhouse USDG admitted by the AI (cooldown until 2026-09-20 22:54 UTC) — first wrapper deploy pending (admin Deploy-now click or automatic), then verify the curated row flip + deposit rail on beta.
