# Research: Fee Treasury Multisig Migration (Phase 0)

Decisions and rationale grounding the plan. Sources: a direct code read of
`contracts/src/vault/SparkPointVault.sol` (`_feeRecipient` state, `setFeeRecipient` `onlyGuardian` at :340,
the immutable guardian) and `contracts/src/interfaces/ISparkPointVault.sol`; the deployed addresses
(`contracts/deployments/84532/addresses.json`) — vault `0x15D269B1D4fb3581E5a47482A70215e63Ed547f2`, guardian
OZ `TimelockController` `0x0A21A9B4c2cd2d6a68EC828188826B673572d720` (`minDelay` 60s, deployer sole
proposer/executor/admin), fee recipient today the deployer EOA `0xA71e24359A6cb7A939aae2d62dD12b6256365c30`;
the swap-fee resolution in `apps/web/src/lib/swap/useSwapConfirm.ts` + the address books
`packages/shared/src/addresses/{baseSepolia,robinhoodTestnet}.ts`; the fees page
`apps/web/src/app/(app)/fees/page.tsx` + `NonCustodyBadge`; a repo-wide check for `@safe-global/*` (absent);
and the operator's locked decisions (spec §Clarifications).

## D1 — Treat the migration as TWO independent surfaces, not one switch

**Decision**: Migrate the fee recipient as two distinct changes: **(A)** the vault `_feeRecipient` (covers the
vault performance fee **and**, by fallback, the Base / Base-Sepolia swap fee) via the Timelock ceremony, and
**(B)** the Robinhood 46630 `swapFeeRecipient` hardcoded constant via a web edit + redeploy.

**Rationale**: The two surfaces are governed by genuinely different mechanisms. The vault recipient is mutable
on-chain state gated by `onlyGuardian`; the 46630 recipient is a client-shipped TypeScript constant because
46630 has no vault. `useSwapConfirm.ts` resolves `feeRecipient = swapFeeRecipient ?? vault.feeRecipient()`,
and `baseSepolia.ts` leaves `swapFeeRecipient` unset, so the Base-Sepolia swap fee *follows the vault*
automatically — but `robinhoodTestnet.ts` sets `swapFeeRecipient` explicitly, so 46630 does **not**. A single
change cannot move both. **Alternatives rejected**: (i) "one setter moves everything" — false; leaves 46630 on
the old EOA. (ii) Setting a `swapFeeRecipient` on `baseSepolia.ts` too — unnecessary and worse: it would
*break* the automatic follow-the-vault behavior and create a second place to keep in sync.

## D2 — Move the vault recipient through the Timelock ceremony, never a setter call

**Decision**: Change the vault fee recipient with `timelock.schedule(target=vault, value=0,
data=abi.encodeWithSelector(setFeeRecipient.selector, Safe), predecessor=0x0, salt, delay ≥ minDelay)` → wait
`minDelay` → `timelock.execute(vault, 0, data, 0x0, salt)`. The deployer (sole proposer + executor) drives
both steps.

**Rationale**: `setFeeRecipient` is `onlyGuardian` and the guardian is the Timelock, so a direct EOA call
reverts (`NotGuardian`). Only a scheduled-then-executed Timelock operation makes `msg.sender == guardian`.
This is also the constitutional posture (Principle IV): the fee-recipient change is delayed and public, not an
instant privileged action. **Alternatives rejected**: a raw EOA `setFeeRecipient` (reverts by construction);
routing through a new privileged path (there is none, and adding one would widen blast radius).

## D3 — No vault redeploy; reuse the mutable `_feeRecipient`; the guardian stays immutable

**Decision**: Do not redeploy the vault. `_feeRecipient` is mutable state and is the only thing that changes;
the immutable guardian and the vault address are untouched.

**Rationale**: `_feeRecipient` is designed to be updatable via `setFeeRecipient`; moving it is a state change,
not a code change. The guardian, by contrast, is set immutably in the constructor — changing *it* would mean a
fresh CREATE2 deploy at a new address, which is out of scope and unnecessary (the Safe should NOT be the
guardian anyway — see D7). **Alternatives rejected**: redeploying to bake in a new recipient (pointless churn,
new address, breaks every downstream reference); making the Safe the guardian (requires redeploy and violates
N5).

## D4 — One shared Safe as the single treasury of record

**Decision**: A single Safe receives all protocol fees — vault performance-fee shares, the Base /
Base-Sepolia swap fee, and the 46630 swap fee. Record it as the one canonical fee-treasury address per
network.

**Rationale**: A shared treasury is operationally simplest and matches the operator's locked decision. The
cost — that feature 013's revenue indexers must disambiguate swap vs premium vs performance-fee inflows when
they share a recipient — is 013's responsibility, resolvable by source (`from==router` for swaps,
`from==buyer ∧ token==SRK` for premium, performance-fee events for the vault fee), not a reason to fragment
the treasury. **Alternatives rejected**: separate recipients per stream (more addresses to fund/secure/track,
no custody benefit; the disambiguation is cheap where it belongs, in the indexer).

## D5 — Create the Safe via `app.safe.global`, add no Safe SDK

**Decision**: Create the 2-of-3 Safe through the Safe web app on Base Sepolia. Do not add `@safe-global/*` or
any Safe SDK, and do not create the Safe via Foundry.

**Rationale**: A fee recipient needs to be nothing more than an address that can hold and later move *its own*
fee shares/tokens with multi-sig approval — it needs no programmatic integration into the app. The repo has no
Safe SDK today; adding one to stand up a single testnet Safe is unjustified infrastructure (Principle VII).
Foundry cannot conveniently produce a canonical Safe (the Safe factory/singleton flow is what the UI wraps).
**Alternatives rejected**: Safe SDK / `protocol-kit` (needless dependency for one Safe with no on-chain role);
a bespoke multisig contract (reinventing an audited, standard artifact).

## D6 — 2-of-3 threshold; new signer keys held outside the repo

**Decision**: Threshold 2-of-3. Signers = the deployer EOA `0xA71e…5c30` plus two new keys
(`0x867ED872388D9fB613892E0a73c696c2207E5fEb`, `0x122DAB67a798179304CFEe0CD143b121E7A805Ed`). The two new
private keys are stored `0600` at `/path/to/testnet-wallets.txt`, **outside** the
repository (testnet only).

**Rationale**: 2-of-3 gives signer redundancy (tolerates one lost key) without requiring all three to move
funds, a sane default for a testnet treasury. Keeping the deployer as one signer preserves operational
continuity during the cutover. Keys must never enter the repo/config — only public addresses are recorded
(FR-003). **Alternatives rejected**: 1-of-N (no better than the single EOA it replaces); 3-of-3 (a single lost
key strands the treasury); committing keys anywhere in-repo (unacceptable, even on testnet).

## D7 — The Safe is a plain, non-privileged holder — zero on-chain roles (N5)

**Decision**: The Safe receives fee shares/tokens only. It is NOT the vault guardian and is NOT granted any
Timelock role (no proposer/executor). It has no code path to move any user's funds.

**Rationale**: This is the crux of the constitutional check. N5 requires that "any multisig or timelock MUST
govern PAUSE ONLY, never fund movement." The fee Safe governs *nothing* — it is exactly the non-privileged
fee-share holder Principle V already describes, now a multisig rather than an EOA. Making it the guardian
(impossible without a redeploy) or granting it Timelock roles would hand it governance power and break N5.
**Alternatives rejected**: Safe-as-guardian (redeploy + N5 violation); granting the Safe Timelock
proposer/executor "for convenience" (out of scope, expands its authority, and is a separate governance
decision).

## D8 — The Base / Base-Sepolia swap fee follows the vault automatically; 46630 does not

**Decision**: Rely on `feeRecipient = swapFeeRecipient ?? vault.feeRecipient()` — with `swapFeeRecipient`
unset on `baseSepolia.ts` — so the Timelock move of the vault recipient carries the Base-Sepolia swap fee with
it. Move 46630 separately by editing its explicit `swapFeeRecipient` constant + redeploying web.

**Rationale**: The fallback is deliberate existing behavior; leaning on it means one ceremony moves both the
vault fee and the Base-Sepolia swap fee with no drift risk. 46630 has no vault, so its constant is the only
source and must be changed by hand. **Alternatives rejected**: hardcoding a `swapFeeRecipient` on Base Sepolia
to "make it explicit" (breaks the automatic follow, adds a sync burden); trying to make 46630 read a vault
(there is none).

## D9 — No migration; address book + a non-key agent config constant; live-read balances

**Decision**: Record the Safe address in `packages/shared/src/addresses/` (per network) and as a non-key agent
config constant `FEE_WALLET_ADDRESS`. Introduce no database migration and no persisted balance ledger; the
admin-revenue Safe balances are live on-chain reads (feature 013's card).

**Rationale**: The only new data is a single public address — config, not schema. Latest migration on disk is
`0015_limits.sql`; this feature adds none, so it stays out of the 0017/0018 numbering that the parallel
012/013 work is claiming. Balances are inherently live (the whole point is to show real accrual), so a
persisted mirror would only add drift risk against Principle III. **Alternatives rejected**: a
`fee_treasury`/balance-snapshot table (unneeded persistence, drift risk, a migration for one address); baking
the address only into web (the agent's revenue read also needs it → the non-key constant).

## D10 — Prove nil power from live chain reads (Principle III), not assertions

**Decision**: The fees page + `NonCustodyBadge` keep their existing live `vault.feeRecipient()` read (so they
show the Safe automatically post-execute, no data-source change), and the Trust Center surfaces the Safe's
exact power over user funds — none: not guardian, no withdraw/redeem path — read/derived from chain.

**Rationale**: Principle III and N5 require the Trust Center to display *exact* on-chain permissions so a user
can independently confirm the multisig gained no custody power. Because the surfaces already read live, the
migration needs no rewiring of the fee-recipient display — only the Trust Center's permissions framing to make
the Safe's nil authority explicit. **Alternatives rejected**: hardcoding "the treasury is safe" copy
(asserted, not proven — violates III); a bespoke off-chain permissions store (unnecessary; the chain is the
source).

## D11 — Cutover sequencing across 012/013/014

**Decision**: Recommended global order: create + record the Safe (this feature's Phase A) first; wire it as
the premium treasury (012) and the swap-fee-indexer target (013); execute the vault Timelock move (Phase B)
last.

**Rationale**: When the vault recipient moves, 013's swap-fee indexer must union {old EOA, new Safe} across the
cutover block or historical fees drop. Creating + recording the Safe first lets 012/013 target it from
inception, so only *pre-cutover* history needs the dual-address union — the smallest possible window. Each
feature still ships independently to `develop`; this is a coordination hint, not a hard dependency.
**Alternatives rejected**: executing the Timelock move before 012/013 target the Safe (widens the dual-address
window and risks a stretch where new swap fees land on the Safe while the indexer still filters the old EOA).

## D12 — Verify the ceremony end-to-end, don't trust the execute receipt alone

**Decision**: Before executing, assert the scheduled operation's encoded calldata (correct
`setFeeRecipient.selector` + correct Safe address) and its derived operation id. After executing, confirm the
`FeeRecipientUpdated` event **and** a live `feeRecipient()` read returning the Safe at sufficient depth, with
the vault address + guardian unchanged. Lock the semantics with a Foundry fork test.

**Rationale**: A delayed ceremony is only safe if the queued call is exactly what you think; the delay exists
precisely so a mis-encoded call can be caught before it executes. A testnet execute receipt can reorg, so the
authoritative confirmation is the live post-execute read, not the receipt. **Alternatives rejected**: trusting
the schedule/execute succeeded without re-reading `feeRecipient()` (a wrong-argument or reorged change would
go unnoticed).

## Adversarial review notes (recorded)

- **Wrong-calldata / operation-id mismatch (highest ceremony risk).** A mistyped Safe address or wrong
  selector in the scheduled call would, after the delay, execute a change to the wrong recipient (or fail).
  Answered by D12: verify the encoded calldata + operation id **before** execute, and confirm
  `FeeRecipientUpdated` + a live `feeRecipient()==Safe` after. The `minDelay` window is the safety margin.
- **Replay / predecessor / salt.** Timelock operations are keyed by (target, value, calldata, predecessor,
  salt); a reused salt for an identical call collides with the prior operation id. Use a fresh salt for the
  migration operation and record it with the schedule tx (FR-016).
- **Reorg / finality after execute.** A shallow post-execute confirmation can reorg on testnet, appearing to
  move the recipient when it did not settle. Treat the migration as done only after a live `feeRecipient()`
  read at sufficient depth (D12), never on the execute receipt alone.
- **Double-count if the Safe is also the premium (012) and swap recipient.** A shared treasury means 013's
  indexers could ingest an SRK premium `Transfer` as swap revenue. Answered by source disambiguation
  (`from==router` = swap; `from==buyer ∧ token==SRK` = premium; performance-fee events = vault fee) — 013's
  responsibility; the shared Safe (D4) is deliberate.
- **N5 — the Safe must have provably nil power.** The single most important invariant here: the Safe must gain
  zero authority over user funds. It is never the guardian (immutable; would need a redeploy) and gets no
  Timelock role (D7), and the Trust Center proves this from chain (D10). Withdraw-always (N2) is untouched.
- **Native-ETH swap-fee gap (cross-feature).** The `unwrapWETH9WithFee` native-out leg emits no log, so 013's
  swap-fee indexer under-counts native-ETH fees unless it traces — an honest, disclosed gap for 013 (Principle
  III), not a defect this feature introduces.
- **Robinhood constant drift.** Editing `robinhoodTestnet.ts` without redeploying web leaves 46630 fees on the
  old EOA; the story is "done" only after edit **and** redeploy (FR-009). A repo/deploy check should confirm
  the shipped bundle carries the Safe.
- **Honest about what moved.** This feature moves *where fees land*, not *who governs the vault*: the guardian
  is still the deployer-controlled Timelock. The Trust Center must not imply the multisig now "controls the
  protocol" — it controls only its own accumulated fees, and governs nothing. Stated plainly (D10), this is a
  strengthening of the non-custody proof, not a new custody actor.
- **Key custody (testnet).** The two new signer keys live outside the repo (`0600`), testnet only; losing two
  of three strands the treasury. Acceptable and documented for testnet; the mainnet signer policy + threshold
  are a separate later decision, out of scope.
