# Implementation Plan — 024 Multi-Protocol Vaults

**Spec:** `spec.md` · **Evidence:** `research.md` · **Governance:** `constitution-amendment-v3.0.0.md`

## Constitution check

| Gate | Status |
|---|---|
| N1 no admin withdrawal | **Strengthened** — a Fee Wrapper's risk-management setters are abdicated at deploy; fees are Morpho's own accounting. |
| N2 withdraw-always | **Strengthened** — gate setters permanently abdicated + `forceDeallocate` in-kind exit. Phase 0 explicitly preserves the retired wrapper's exit. |
| N3/N4 user-signed, scoped keys | Unchanged. Deposits/withdrawals stay user-signed; the registry is not readable by the policy/agent path. |
| N5 non-upgradeable, single-purpose | **Equal, and provable** — `addAdapter`/`removeAdapter` abdicated ⇒ one child, forever. |
| Fee ≤20% / mgmt 0 | **WEAKENED**: bytecode constant → policy + ≥3-day timelock + Safe owner + public Trust Center read. Requires ratification (see the amendment). |
| Chain scope | **Requires amendment** for 4663. |
| Principle VII (no meta-vault) | Satisfied — one immutable child, adapter list abdicated. Curation stays forbidden. |

**Verdict: proceed on Phases 0/2/4 now; Phases 3/5/6 gated on v3.0.0.**

## Architecture

Three layers, one organising rule: **stop writing custody-critical Solidity; configure Morpho's
instead.**

### Layer 1 — on-chain

- **Keep** `SparkPointVault` (Aave) exactly as-is. It is the only place SparkPoint holds a pooled
  position, and the only place an Aave position can live (Morpho ships no Aave adapter).
- **Supersede** `SparkPointMorphoVault` + `SparkPointVaultFactory` for new deployments. Do **not** delete
  the sources — the deployed wrapper must stay redeemable forever (N2).
- **Retire** the mock-backed wrapper (Phase 0, done).
- **Add** a vendored, release-pinned `FeeWrapperDeployer` + `DeployFeeWrapper.s.sol` under
  `contracts/script/morpho/`, with fork tests and an ABI-hash CI check. This is deployment tooling, not
  custody code — the only new Solidity in the feature.
- **Optional, view-only:** a `MorphoVaultLens` so the Trust Center can prove a wrapper's live config
  (child, gate abdication, fees, timelocks) without trusting our API.

### Layer 2 — data (`0026_vault_registry.sql`)

```sql
CREATE TABLE vault_registry (
  id             uuid PRIMARY KEY,
  chain_id       integer  NOT NULL,           -- 8453 | 84532 | 4663
  protocol       text     NOT NULL,           -- 'aave_v3' | 'morpho_vault_v2' | 'morpho_metamorpho_v1'
  kind           text     NOT NULL,           -- 'first_party' | 'fee_wrapper' | 'external_4626'
  vault_address  text     NOT NULL,           -- what the user deposits into
  child_address  text,                        -- fee wrapper -> its immutable child
  asset_address  text     NOT NULL,           -- 84532 has TWO different "USDC" tokens
  asset_symbol   text     NOT NULL,
  asset_decimals smallint NOT NULL,           -- 6 so far; do not assume
  share_decimals smallint NOT NULL,           -- 18 on Morpho V2, 6 on ours; do not assume
  status         text     NOT NULL,           -- 'live'|'paused'|'deprecated'|'redeem_only'
  sparkpoint_fee_bps smallint NOT NULL DEFAULT 0,
  native_fee_note text,                       -- child's own fees, for NET disclosure (IV.5)
  apy_source     text     NOT NULL,           -- 'morpho_api'|'aave_onchain'|'unavailable'
  label          text     NOT NULL,
  vetting_notes  text,
  UNIQUE (chain_id, vault_address)
);
```

Plus `vault_allowlist` (the governance record + the FR-020 eligibility evidence) and
`vault_apy_snapshots` (timestamped, source-tagged; "unavailable" is a first-class value, never `0`).

`status = 'redeem_only'` is the durable form of what Phase 0 encoded in the address book.

### Layer 3 — backend & web

- Replace `SPARKPOINT_VAULT_ADDRESS` reads with registry resolution **behind a feature flag**, so day-one
  behaviour is byte-identical.
- Generalise the 019 spine from "the vault" to "a registry-resolved vault"; add `forceDeallocate` as a
  first-class exit action.
- Background APY poller → `vault_apy_snapshots`; never call the Morpho API on the request path.
- Add chain 4663 to the policy chain map, the SIWE list and a new
  `packages/shared/src/addresses/robinhoodMainnet.ts`.
- Turn `VaultKind` into registry data; collapse the two chain lists and the ~30 hard-coded `84532`
  literals onto one source.

## Alternatives considered

- **Passthrough-only registry (no wrapper).** Scored highest on security, honesty and shippability by all
  three independent review lenses, and the synthesis recommended it. **Rejected by the operator (D1)**
  because it permanently forgoes the performance fee on external vaults (~$220k/yr at $50M TVL / 4.4%),
  which is unrecoverable non-custodially. Recorded here because it remains the fallback if the fee-cap
  downgrade fails ratification — and because both designs share the same registry, so nothing is wasted.
- **Full curation.** Rejected — see spec §Context.
- **Generalising `SparkPointVault` with pluggable adapters.** Rejected: a multi-month custody-core
  rewrite superseding both live vaults, and it breaks the `useVault` share-decimals invariant.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Third-party child failure carries our brand | High | FR-020 eligibility gate; liquidity floor; curator named on the deposit screen |
| Liquidity ≠ TVL (Steakhouse USDG 13.7%) | High | Show the ratio pre-signature; it drives D2 |
| Fee-cap enforcement downgrade | High | Explicit ratification; Safe owner; ≥3-day timelock; public Trust Center read |
| Dead-deposit doc conflict | High | Fork-simulate; reconcile against the pinned release before mainnet |
| Morpho API rate limit / week-long cooldown | Medium | Background poller only; cache; labelled staleness |
| No testnet indexer | Medium | Permanent honest "unavailable — testnet" |
| First user of the 84532 V2 factory | Low | Expect to debug without reference deployments |
| Parallel agent owns `023` + `services/agent/` | Low | We took `024`; no file overlap except `CHANGELOG.md` |
