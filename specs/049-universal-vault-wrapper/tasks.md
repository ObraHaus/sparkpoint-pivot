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
- [x] **T403** Operator-signed deploy on 4663: TimelockController → beacon → implementation → factory; on-chain verification passed; 4663 book updated. *(allowlist seed remains gated on Gate 0; Safe `setDeployer` op `0x3581b36c…85e0` scheduled 2026-09-19, executable 2026-09-22 08:23 UTC.)*
- [ ] **T404** [GATED] First wrapper deployment for a live curated vault (requires Gate 0) via the deploy runner.

## Phase W5 — Product wiring + disclosure (P11)

- [ ] **T501** Curated store `wrapped`/`wrapperAddress` wired from real deployments; deposit rail flips to the wrapper path; fee disclosure copy.
- [ ] **T502** Trust Center rewrite (timelock + exit-window guarantee + residual-risk sentence); remove "Non-upgradeable" for wrapper surfaces only where the contract now exists.
- [ ] **T503** Spec 048 M1 (T501–T504) closed with a recorded T501 review pointing at this spec; both changelogs updated.
- [ ] **T504** Admin → Vaults: wrapper provenance + "Deploy wrapper" request button (agent-keyless, runner-executed).
