# Implementation Plan: Fee Treasury Multisig Migration

**Branch**: `feature/014-fee-multisig` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-fee-multisig/spec.md`

## Summary

Migrate the protocol fee treasury from the single deployer EOA
(`0xA71e24359A6cb7A939aae2d62dD12b6256365c30`) to a dedicated **2-of-3 Safe** on Base Sepolia, and make
that Safe's real balances and real (nil) on-chain powers visible on the admin revenue dashboard and the
Trust Center. The work is **two independent surfaces**: **(A)** the vault's `_feeRecipient`, moved **only**
through the guardian Timelock as a `schedule` → wait `minDelay` → `execute` ceremony of
`setFeeRecipient(Safe)` — which **also auto-moves the Base / Base-Sepolia swap routing fee**, because
`apps/web/src/lib/swap/useSwapConfirm.ts` resolves `feeRecipient = swapFeeRecipient ?? vault.feeRecipient()`
and `baseSepolia.ts` leaves `swapFeeRecipient` unset; and **(B)** the Robinhood 46630 swap fee, a **hardcoded
constant** in `packages/shared/src/addresses/robinhoodTestnet.ts` that does NOT follow the Timelock and is
moved by editing the constant + redeploying web. There is **no contract change and no vault redeploy**
(`_feeRecipient` is mutable state; the guardian is immutable, so the Safe can never become the guardian) and
**no database migration** — the Safe address goes into the shared address book plus a non-key agent config
constant `FEE_WALLET_ADDRESS`, and the admin dashboard reads balances live from chain (feature 013's card).

**Technical approach** (from research.md): treat the migration as a governance **ceremony**, not a code
change, on the vault surface, and a **config + redeploy** on the Robinhood surface. Create the Safe via the
Safe web app (`app.safe.global`) — there is **no Safe SDK / `@safe-global/*` in the repo and none is added**.
The Safe is a **plain, non-privileged fee holder**: it receives fee shares/tokens only, is never the vault
guardian, and is never granted a Timelock role — so it gains **zero** authority over user funds (N5). The
fees page (`apps/web/src/app/(app)/fees/page.tsx`) and `NonCustodyBadge` already read `vault.feeRecipient()`
live, so they reflect the Safe automatically after `execute`; the Trust Center
(`apps/web/src/app/(app)/trust/...`) surfaces the Safe's exact (nil) power over user funds from chain
(Principle III). Nothing here touches the custody or withdraw-always path.

## Technical Context

**Language/Version**: No new application language surface is introduced. TypeScript 5 (Next.js 15 App Router,
React 19) for the shared address book (`packages/shared`) and the Trust Center / fees / admin-revenue reads
in `apps/web`; Python 3.12 (`services/agent`) for the non-key `FEE_WALLET_ADDRESS` config constant consumed
by the admin-revenue Safe-balance read (feature 013). **Solidity/Foundry unchanged** — no contract edit, no
redeploy; the on-chain change is a Timelock governance ceremony run with existing tooling (`cast`/`forge
script` or the Safe UI acting as proposer/executor).

**Primary Dependencies**: the deployed `SparkPointVault` (`0x15D269B1D4fb3581E5a47482A70215e63Ed547f2`,
`setFeeRecipient` at `contracts/src/vault/SparkPointVault.sol:340`, `onlyGuardian`) and its guardian OZ
`TimelockController` (`0x0A21A9B4c2cd2d6a68EC828188826B673572d720`, `minDelay` 60s on testnet, deployer =
sole proposer + executor + admin); the shared address book (`packages/shared/src/addresses/*`); the existing
live-read swap-fee resolution in `apps/web/src/lib/swap/useSwapConfirm.ts`; feature 013's admin-revenue
Safe-balance card (live `eth_getBalance` + ERC20 `balanceOf`). **No new runtime dependency** — explicitly no
Safe SDK.

**Storage**: **None new.** No migration, no table. The Safe address lives in `packages/shared/src/addresses/`
(TypeScript, per-network) and in the agent's non-key config as `FEE_WALLET_ADDRESS`. Admin-revenue balances
are live on-chain reads, not persisted. (Latest migration on disk is `0016_vault_factory.sql` (feature 011, on develop); this feature
adds none.)

**Testing**: Foundry test asserting the ceremony semantics on a fork — a direct EOA `setFeeRecipient` reverts
(`NotGuardian`); a Timelock `schedule` → (pre-delay execute reverts) → wait → `execute` succeeds, emits
`FeeRecipientUpdated`, and `feeRecipient()` returns the Safe with the vault address + immutable guardian
unchanged; a zero-address recipient reverts (`ZeroAddress`). TypeScript/Vitest for the address-book
resolution (single canonical treasury per network; 46630 constant = Safe). Playwright/manual: fees page +
Trust Center reflect the Safe live post-execute; admin-revenue Safe card shows real balance or honest "cannot
load". A repo scan asserting no signer key/seed is committed.

**Target Platform**: Web (desktop + mobile, Trust Center / fees / admin revenue) + the Python agent config
constant, on the Coolify dev/staging alpha; plus a one-time on-chain governance ceremony on Base Sepolia and
a Safe created through `app.safe.global`.

**Project Type**: Web application — Next.js frontend + Python agent service + on-chain contracts (unchanged) +
an operational multisig (Safe) and a Timelock ceremony.

**Performance Goals**: Not a hot-path feature. The only added runtime work is a live balance read on the
admin revenue dashboard (already 013's shape) and the unchanged live `feeRecipient()` read on the fees page /
badge — negligible. The ceremony itself is a one-time, deliberately delayed (`minDelay`) governance action.

**Constraints**: the vault fee recipient changes **only** through the Timelock ceremony (never a raw EOA
call); **no vault redeploy** and the **immutable guardian is untouched** (the Safe can never become guardian);
the Safe gains **zero** fund-movement authority over user funds and is granted **no** on-chain role (N5); the
withdraw-always exit path is **never** touched (N2); the Base/Base-Sepolia swap fee moves automatically with
the vault while the Robinhood 46630 constant must be moved + redeployed separately; **no migration**; **no
private key** in the repo/config; admin figures are **live on-chain reads**, honest-degrade, never fabricated
(Principle III).

**Scale/Scope**: 1 Safe (2-of-3); 2 fee surfaces (vault Timelock + Robinhood constant); 3 fee streams
consolidated (vault performance fee + Base/Base-Sepolia swap fee + 46630 swap fee); 2 networks in scope
(84532 vault+swap, 46630 constant); 0 migrations; 0 contract changes; 1 non-key agent config constant; 3
read-only surfaces reflecting the change (fees page, Trust Center, admin revenue).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS — this feature *strengthens* the non-custody proof.** The Safe is a plain, non-privileged fee holder that gains **zero** authority over user funds (N1): no withdraw/redeem path, not the vault guardian, no Timelock role. The withdraw-always exit is untouched (N2, FR-013). No user wallet is generated or held (N3). No session-key / PolicyModule scope changes (N4). **N5 is the star:** "any multisig or timelock MUST govern PAUSE ONLY, never fund movement" — the fee Safe governs *nothing* (it merely receives fee shares), and the vault guardian Timelock already governs pause-only + a hard-capped `feeRate`, both unchanged. The Trust Center surfaces the Safe's exact (nil) power from chain. |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** No AI, policy layer, or user-signing path is touched. Moving the fee recipient is an operator governance ceremony; the model has no role and cannot cause or suppress it. |
| **III. Provable, Not Promised** | **PASS.** The fee recipient and the Safe's powers are read **live from chain** (fees page + `NonCustodyBadge` via `feeRecipient()`; Trust Center permissions) and the admin-revenue balances are live reads that honest-degrade (FR-014) — no asserted or fabricated figures. The migration ceremony (schedule/execute tx hashes + `FeeRecipientUpdated`) is recorded (FR-016). |
| **IV. Security & Bounded Blast Radius** | **PASS — reduces blast radius.** Replacing a single hot EOA with a 2-of-3 multisig adds signer redundancy to the revenue treasury. The change is enforced through the existing delayed, public Timelock (no new privileged path); the vault surface stays simple (no contract change, no redeploy); the pause-only kill-switch and the Aave/Aerodrome whitelist are untouched. |
| **V. Conservative, Transparent Launch** | **PASS.** The vault fee model is unchanged: the fee recipient remains a **non-privileged share holder** (now a multisig instead of an EOA), `feeRate` remains the only mutable, timelocked, hard-capped param, and the fee never touches principal or the withdraw path. No new fee, strategy, or token incentive is introduced; SRK is untouched. |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** spec → plan → tasks; no code/ceremony before tasks; spec/plan/research trace to each other and to the constitution. |
| **VII. Simplicity & YAGNI** | **PASS with a recorded scope note (below).** No new dependency (explicitly no Safe SDK), no migration, no contract change; the Safe is created via the existing Safe UI and the change flows through the existing Timelock and existing live reads. |

**Recorded scope note (Principle VII / I — a multisig on the fee recipient).** Introducing a Safe as the fee
recipient could be misread as adding a custody actor. It is the opposite: the Safe is a **plain,
non-privileged fee-share / token holder** with **no** fund-movement authority over user funds — it is never
the vault guardian (immutable; a fresh guardian would require a redeploy to a new address, which is out of
scope) and is granted **no** Timelock role in this feature. This is precisely the N5-shaped arrangement the
constitution sanctions ("any multisig or timelock MUST govern PAUSE ONLY, never fund movement"): the fee Safe
governs nothing at all. The change is client/operator-directed (2026-07-21) and **does not touch N1–N5, the
pause-only kill-switch, the AI-disposition rule, or the non-upgradeable vault semantics, so no
re-ratification is required.** The on-chain step is an operator **governance ceremony** on the existing
Timelock (recorded in `DEPLOYMENT.md`), not new code; the Safe is created via `app.safe.global`, tracked in
`DEPLOYMENT.md` / `COOLIFY.md`.

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations.

## Project Structure

### Documentation (this feature)

```text
specs/014-fee-multisig/
├── plan.md                    # This file
├── spec.md                    # WHAT/WHY (approved)
├── research.md                # Phase 0 — decisions & rationale
├── data-model.md              # Phase 1 — entities, config records, wire shapes (no DB tables)
├── quickstart.md              # Phase 1 — Safe creation + the Timelock ceremony + per-story verify
├── contracts/
│   └── fee-multisig-interfaces.md   # Phase 1 — the ceremony contract (schedule/execute), address-book + config shapes
├── checklists/
│   └── requirements.md        # Spec-quality checklist (from specify)
└── tasks.md                   # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
packages/shared/src/addresses/
├── types.ts                   # (optional) a plain `feeTreasury?: Address` field on AddressBook — NOT a TargetRef
├── baseSepolia.ts             # record the Safe as the Base-Sepolia fee treasury (address-of-record; vault fee still moves via Timelock)
└── robinhoodTestnet.ts        # CHANGE swapFeeRecipient (currently the deployer EOA 0xA71e…5c30) → the Safe (constant surface; needs web redeploy)

services/agent/src/sparkpoint_agent/
└── config/…                   # NEW non-key constant FEE_WALLET_ADDRESS (public address only) — consumed by 013's admin-revenue Safe-balance read

apps/web/src/
├── app/(app)/fees/page.tsx           # NO data-source change — already reads vault.feeRecipient() live; copy may note the treasury is a multisig
├── app/(app)/trust/page.tsx          # surface the fee treasury's exact (nil) power over user funds — provable from chain (N5 / Principle III)
├── app/(app)/trust/permissions/…     # the permissions view reflects the Safe as a non-privileged holder (not guardian, no fund-movement path)
├── components/**/NonCustodyBadge…    # NO change — already reads vault.feeRecipient() live
└── app/admin/revenue/…               # Safe balance card (feature 013) fed the FEE_WALLET_ADDRESS — live on-chain read, honest-degrade

contracts/                            # NO change — no contract edit, no redeploy; feeRecipient is mutable state, guardian is immutable
                                      #   (ceremony targets the deployed vault 0x15D269…47f2 via the Timelock 0x0A21A9B4…d720)

# Outside the repo (testnet only, 0600): /home/hello/project/.claude/testnet-wallets.txt — the two NEW signer keys.

Living docs: CHANGELOG.md · DEVELOPMENT.md (FEE_WALLET_ADDRESS + feeTreasury address-book field) ·
DEPLOYMENT.md (the Safe creation + the Timelock schedule/execute ceremony, tx hashes) ·
COOLIFY.md (46630 web redeploy) · services/agent/content_seed/whats-new.json (client-facing entry) ·
MIGRATIONS.md (NO new migration — latest is 0016_vault_factory)
```

**Structure Decision**: Web-application layout (Next.js frontend + Python agent + unchanged contracts), with
the substantive change being **operational, not code**: a Safe created via the Safe UI and a Timelock
governance ceremony against the already-deployed vault. The only committed edits are config-level — the
shared address book (record the Safe; change the 46630 constant), a non-key agent constant, and read-only
Trust Center / fees / admin-revenue surfaces that already read live from chain. No new top-level project, no
migration, no contract change.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Two independent fee surfaces (vault Timelock ceremony **and** the hardcoded 46630 constant) | They are genuinely different mechanisms: the vault recipient is mutable on-chain state gated by the guardian Timelock, while 46630 has no vault so its swap fee is a client-shipped constant. One switch cannot move both. | Treating it as a single change would leave the 46630 fee silently on the old EOA after the Timelock move — an honest, complete migration must handle both. |
| A Timelock `schedule` → wait → `execute` ceremony instead of a setter call | `setFeeRecipient` is `onlyGuardian` and the guardian is the Timelock; a direct EOA call reverts. The delay + public queue is the constitutional governance surface (Principle IV). | A direct call is impossible by construction; making the Safe the guardian would require a vault redeploy (immutable guardian) and would violate N5 by handing the Safe governance power. |
| Creating the Safe via `app.safe.global` (no SDK) | There is no `@safe-global/*` dependency in the repo; a fee recipient needs no programmatic Safe integration — it only needs to be an address that holds fee shares. | Adding a Safe SDK to create one testnet Safe is unjustified infrastructure (Principle VII); the Safe needs no on-chain role, so no SDK is required. |

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary.

- **Phase 0 — Recon & decisions (this doc + research.md).** Confirm the two surfaces, the Timelock ceremony
  mechanics (guardian = Timelock, `minDelay` 60s, `setFeeRecipient` `onlyGuardian`, mutable `_feeRecipient`,
  immutable guardian), and the swap-fee fallback. No change.
- **Phase A → US1 (🎯 MVP).** Create the 2-of-3 Safe on Base Sepolia via `app.safe.global` (deployer + two
  new keys, threshold 2); record its address in the shared address book + the agent's non-key
  `FEE_WALLET_ADDRESS`. No on-chain fee move yet; no private key committed. Independently shippable — a
  recorded, multi-signer treasury address that changes no money flow.
- **Phase B → US2 (🛡️).** The Timelock ceremony: as proposer, `schedule(target=vault,
  data=setFeeRecipient(Safe), delay ≥ minDelay)`; verify the encoded calldata / operation id; wait; as
  executor, `execute`. Confirm `FeeRecipientUpdated` + a live `feeRecipient()==Safe`, vault address + guardian
  unchanged. This also moves the Base / Base-Sepolia swap fee automatically. Foundry fork test locks the
  semantics. Recorded in `DEPLOYMENT.md`.
- **Phase C → US3.** Change the Robinhood 46630 `swapFeeRecipient` constant to the Safe and **redeploy web**;
  the 46630 fee then pays the Safe (not before the redeploy). Independent of the Timelock.
- **Phase D → US4 (🛡️).** Trust Center surfaces the Safe's exact (nil) power over user funds — not guardian,
  no withdraw/redeem path — provable from chain; the fees page copy may note the treasury is a multisig (its
  data source is unchanged, already live). Withdraw-always demonstrably unaffected.
- **Phase E → US5.** Feed `FEE_WALLET_ADDRESS` to feature 013's admin-revenue Safe-balance card (live
  `eth_getBalance` + ERC20 `balanceOf`), honest-degrade on RPC failure, real zero when empty.

**Cross-feature sequencing note (recorded).** To minimize the window in which feature 013's swap-fee indexer
must union two recipient addresses, the recommended global order is: **create + record the Safe (Phase A)
first**, wire it as the premium treasury (012) and swap-fee-indexer target (013), then **execute the vault
Timelock move (Phase B) last**. Within this feature each phase still ships independently; the sequencing is a
coordination hint across 012/013/014, not a hard dependency of 014 on the others.
