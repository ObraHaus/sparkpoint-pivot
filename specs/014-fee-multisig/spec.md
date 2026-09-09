# Feature Specification: Fee Treasury Multisig Migration

**Feature Branch**: `feature/014-fee-multisig`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Move the protocol fee-receiving wallet from the deployer EOA to a dedicated multisig Safe and surface its balances and permissions on the admin revenue dashboard."

Today **every protocol fee SparkPoint earns lands on a single deployer-controlled EOA** (`0xA71e24359A6cb7A939aae2d62dD12b6256365c30`): the vault's performance-fee shares, the Base / Base-Sepolia swap routing fee, and the Robinhood-testnet swap routing fee all resolve to that one key. A single hot key holding all revenue is an operational and trust liability — it has no signer redundancy, and the Trust Center cannot point to a treasury whose custody posture is provably separated from an individual's key. This feature migrates the fee recipient to a **dedicated 2-of-3 multisig Safe** on Base Sepolia and makes that Safe's real balances and real (deliberately nil) on-chain powers visible: to operators on the admin revenue dashboard, and to users on the Trust Center / fees page. Critically, the Safe is a **plain, non-privileged fee holder** — it gains **zero** authority over user funds and can never become the vault guardian — which is exactly what constitutional invariant **N5** ("any multisig or timelock MUST govern PAUSE ONLY, never fund movement") requires. The migration touches **two independent surfaces** with two different mechanisms, and getting that right is the crux of the work.

## Clarifications

### Session 2026-07-21

Resolved with the operator before authoring (locked decisions):

- **Q: One treasury or several fee recipients?** → **A: One shared Safe.** A single Safe receives all protocol fees — vault performance-fee shares, the Base / Base-Sepolia swap fee, and the Robinhood swap fee. A shared treasury simplifies operations; the revenue-indexer disambiguation this creates (swap vs premium vs performance fee) is feature 013's concern, not this feature's.
- **Q: Does the Safe get any on-chain governance role — vault guardian, or Timelock proposer/executor?** → **A: No.** The Safe is a plain, non-privileged fee-share / token holder ONLY. It is never granted the vault guardian role (which is immutable and cannot change without a redeploy anyway) and is NOT granted any Timelock role in this feature. It has zero fund-movement power (N5).
- **Q: How is the Safe created?** → **A: Via the Safe web app** (`app.safe.global`) on Base Sepolia. There is no Safe SDK / `@safe-global/*` dependency anywhere in the repo, and none is added — the Safe is created through the UI, not Foundry.
- **Q: What is the threshold and signer set?** → **A: 2-of-3.** Signers = the existing deployer EOA plus two new testnet keys, held **outside the repo**. This is a testnet configuration; the mainnet signer set and threshold are a separate later decision, out of scope here.
- **Q: Does moving the fee recipient require redeploying the vault?** → **A: No.** `_feeRecipient` is mutable vault state, changed **only through the Timelock ceremony** (`schedule` → wait `minDelay` → `execute`). The vault address and its immutable guardian are unchanged; no redeploy.
- **Q: Is there a database migration or a new persisted table?** → **A: No.** The Safe address goes into the shared address book plus a non-key agent config constant (`FEE_WALLET_ADDRESS`). Balances shown on the admin revenue dashboard are **live on-chain reads**, not a persisted ledger.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stand up the fee-treasury Safe and make it the address of record (Priority: P1) 🎯 MVP

An operator creates a dedicated 2-of-3 Safe on Base Sepolia and records its address as the single source of truth for the protocol fee treasury — in the shared address book and in the agent's non-key config — without yet changing where any fee is actually paid. Nothing about custody or fund movement changes; this is purely establishing the treasury account and wiring its address so every later step (re-pointing the vault fee, re-pointing the Robinhood fee, showing balances, proving permissions) has one canonical address to reference.

**Why this priority**: Every other story references the Safe address. It must exist and be recorded first, and it is independently valuable on its own — a funded, multi-signer treasury account with signer redundancy replaces a lone hot key even before any fee is re-pointed. It is also the safe (no-op-on-chain) MVP: creating and recording an address changes no fee flow and cannot regress custody, so it can ship to `develop` on its own.

**Independent Test**: Create the Safe via `app.safe.global` with the three configured signers and a 2-of-3 threshold; confirm the Safe address is resolvable through the shared address book for Base Sepolia and readable from the agent's config as `FEE_WALLET_ADDRESS`; confirm no private key for any signer is present anywhere in the repository or in committed config.

**Acceptance Scenarios**:

1. **Given** three configured signer addresses, **When** the operator creates the Safe on Base Sepolia, **Then** a 2-of-3 Safe is deployed and its address is captured for wiring.
2. **Given** the Safe address, **When** it is added to the shared address book and the agent config, **Then** application code can resolve a single canonical fee-treasury address for Base Sepolia (and no code path resolves two different treasury addresses).
3. **Given** the recorded configuration, **When** the repository is inspected, **Then** no signer private key or seed appears in the repo or in any committed config — only public addresses.
4. **Given** the Safe exists but no fee has been re-pointed yet, **When** a swap or the vault accrues a fee, **Then** the fee still lands on the current recipient (unchanged) — recording the address alone moves no money.

---

### User Story 2 - Re-point the vault fee recipient to the Safe via the Timelock ceremony (Priority: P1) 🛡️

An operator moves the vault's fee recipient from the deployer EOA to the Safe by executing the **governance ceremony**, not a setter call: because `setFeeRecipient` is `onlyGuardian` and the guardian is the Timelock, the operator (as Timelock proposer) **schedules** the exact encoded `setFeeRecipient(Safe)` call, waits the Timelock's `minDelay`, then (as executor) **executes** it. This single change also automatically moves the Base / Base-Sepolia **swap** routing fee, because the swap flow falls back to the vault's live `feeRecipient()` when no chain-specific swap treasury is set. No vault redeploy occurs and the immutable guardian is untouched.

**Why this priority**: This is where the real revenue actually moves, and it is the step most easily done wrong (a raw EOA call to `setFeeRecipient` reverts; a mis-encoded scheduled call executes the wrong thing after a delay). Because the swap fee follows the vault automatically on Base chains, this one ceremony migrates the bulk of live revenue. It is tagged 🛡️ because the ceremony sits directly on the custody-governance boundary (Principle I / N5): it must demonstrably move only *where fees land*, never grant the Safe any power over user funds.

**Independent Test**: As the Timelock proposer, schedule `setFeeRecipient(Safe)` on the vault with a delay ≥ `minDelay`; confirm an execute attempted before the delay elapses is rejected; after the delay, execute and confirm the vault's live `feeRecipient()` returns the Safe, a `FeeRecipientUpdated` event was emitted, and no vault redeploy occurred (same vault address, same guardian). Then perform a Base-Sepolia swap and confirm its routing fee is paid to the Safe with no separate configuration change.

**Acceptance Scenarios**:

1. **Given** the operator holds the Timelock proposer role, **When** they attempt `vault.setFeeRecipient(Safe)` directly from the EOA, **Then** it reverts (only the guardian/Timelock may call it) and the recipient is unchanged.
2. **Given** the exact encoded `setFeeRecipient(Safe)` call, **When** it is scheduled on the Timelock with delay ≥ `minDelay`, **Then** the operation is queued and cannot be executed until the delay elapses.
3. **Given** a scheduled operation whose delay has not yet elapsed, **When** execute is called, **Then** the Timelock rejects it.
4. **Given** the delay has elapsed, **When** the operation is executed, **Then** `msg.sender` is the Timelock (the guardian), the call succeeds, `feeRecipient()` becomes the Safe, and `FeeRecipientUpdated` is emitted — with no change to the vault address or its immutable guardian.
5. **Given** the vault fee recipient is now the Safe, **When** a user performs a Base-Sepolia swap, **Then** the routing fee is paid to the Safe automatically (the swap flow falls back to the live `feeRecipient()`), with no separate swap-treasury configuration.

---

### User Story 3 - Move the Robinhood-testnet swap fee to the Safe (Priority: P2)

The Robinhood (46630) swap fee recipient does **not** follow the Timelock — it is a hardcoded constant in the shared address book (there is no vault on 46630). An operator updates that constant to the Safe address and redeploys the web app; the change is only complete once both happen, because until the web app is redeployed the old constant is still shipped to clients.

**Why this priority**: 46630 is a real live swap surface whose fee currently pays the same deployer EOA, so it must migrate too for the treasury consolidation to be honest. It is P2 (not P1) because it is a smaller, separate surface than the vault + Base swap fee, and it is mechanically independent — a simple constant edit plus redeploy — rather than the governance ceremony that carries the custody-boundary risk.

**Independent Test**: Edit the Robinhood-testnet `swapFeeRecipient` constant to the Safe address and redeploy the web app; confirm a 46630 swap now pays its routing fee to the Safe, and confirm that before the redeploy the old value was still in effect (i.e. the constant change alone, without redeploy, does not move the 46630 fee).

**Acceptance Scenarios**:

1. **Given** the hardcoded 46630 `swapFeeRecipient`, **When** it is changed to the Safe address and the web app is redeployed, **Then** a 46630 swap pays its routing fee to the Safe.
2. **Given** the constant is edited but the web app is NOT yet redeployed, **When** a 46630 swap occurs, **Then** the fee still pays the old recipient (the change is not "done" until redeploy).
3. **Given** the vault Timelock change (US2) has executed, **When** a 46630 swap occurs, **Then** it is unaffected by the Timelock (46630 has no vault) — its recipient is governed solely by the constant.

---

### User Story 4 - Prove on the Trust Center / fees page that the Safe has zero fund-movement power (Priority: P2) 🛡️

A user opens the Trust Center (and the fees page) and sees, from live on-chain data, that the fee treasury is now the Safe **and** that the Safe's actual on-chain authority over user funds is nil: it is a plain fee-share / token holder, not the vault guardian, with no code path by which it could withdraw, redeem, or move any user's funds. The fees page and the non-custody badge already read the vault's `feeRecipient()` live, so they reflect the Safe automatically the moment the Timelock change executes — the proof is the chain, not a claim.

**Why this priority**: Principle III (Provable, Not Promised) and N5 require the Trust Center to surface the *exact* on-chain permissions, so a user can independently confirm that moving the fee to a multisig did not hand that multisig any custody power. Without this proof, the migration could be misread as "a multisig now controls the money," which is the opposite of the truth. It is P2 (after the money actually moves in US1–US3) and 🛡️ because it is the constitutional non-custody proof.

**Independent Test**: After the Timelock change executes, load the fees page and the Trust Center and confirm the displayed fee recipient equals the Safe (a live read, no code change to those pages), and confirm the surfaces represent the Safe's power over user funds as nil (it is not the guardian; there is no fund-movement path); confirm the withdraw-always exit path is entirely unaffected.

**Acceptance Scenarios**:

1. **Given** the Timelock change has executed, **When** the fees page renders, **Then** the fee recipient it shows (read live from `feeRecipient()`) is the Safe, with no edit to the page's data source.
2. **Given** the Trust Center's permissions view, **When** a user inspects the fee treasury, **Then** it shows the Safe's actual on-chain power over user funds is none (not the guardian, no withdraw/redeem path) — provable from chain, not asserted.
3. **Given** the fee treasury is a multisig, **When** a user exits (redeem vault shares / withdraw), **Then** the withdraw-always path is unaffected — the Safe has no ability to block, delay, or capture it (N2, N5).

---

### User Story 5 - Operators see the Safe's balances on the admin revenue dashboard (Priority: P3)

An operator opens the admin revenue dashboard and sees the fee treasury Safe's current balances — its native balance and the relevant fee-token balances — read live from chain, so they can see accrued protocol revenue accumulating in the Safe. If the on-chain read is unavailable, the card degrades honestly (states it cannot load) rather than showing a fabricated figure.

**Why this priority**: Operator visibility of the treasury closes the loop on the migration ("is revenue actually landing in the Safe now?"), but it is P3 because it is a read-only convenience atop the real work (US1–US3 move the money; US4 proves the custody posture). The balance surface is the admin revenue dashboard's Safe card (feature 013); this feature supplies the address and the requirement, not a new persistence layer.

**Independent Test**: With the Safe recorded and funded on testnet, open the admin revenue dashboard and confirm it shows the Safe's real native + fee-token balances from a live on-chain read; disable the RPC read path and confirm the card states it cannot load rather than showing a number.

**Acceptance Scenarios**:

1. **Given** the Safe address is configured and the Safe holds balances, **When** an operator opens the revenue dashboard, **Then** it shows the Safe's real native + fee-token balances from a live on-chain read (no persisted/cached figure treated as truth).
2. **Given** the on-chain balance read is unavailable, **When** the operator opens the revenue dashboard, **Then** the Safe card degrades honestly (states it cannot load) rather than presenting a fabricated balance.
3. **Given** the Safe holds nothing yet, **When** the dashboard renders, **Then** it shows a real zero, not a placeholder/sample figure.

---

### Edge Cases

- **Wrong calldata scheduled**: a scheduled Timelock operation encodes the wrong selector or a wrong argument (e.g. a mistyped Safe address). Because the delay is real, this is caught before execution — the encoded calldata and the resulting operation id MUST be verified before executing, and after execution the change is confirmed via the `FeeRecipientUpdated` event and a live `feeRecipient()` read.
- **Zero-address recipient**: an attempt to set the recipient to the zero address is rejected by the vault (`ZeroAddress` revert); the ceremony cannot strand the fee on `0x0`.
- **Execute before delay**: executing a scheduled operation before `minDelay` elapses is rejected by the Timelock; the operator must wait.
- **Robinhood constant edited but web not redeployed**: the 46630 fee still pays the old recipient until the redeploy; the story is not "done" until both the edit and the redeploy land.
- **Reorg / finality after execute**: on testnet a shallow post-execute confirmation can reorg; the migration is treated as settled only after the change is re-confirmed by a live `feeRecipient()` read at sufficient depth, not by the execute receipt alone.
- **Cutover block for the swap-fee indexer**: when the recipient moves, feature 013's swap-fee indexer must union the old EOA and the new Safe across the cutover block, or historical pre-cutover fees drop from the stream (cross-feature note; not a change in this feature).
- **Shared treasury double-count**: if the same Safe is also the premium payment treasury (012) and the swap fee recipient, the revenue indexers (013) must disambiguate by source (performance-fee events vs `from==router` swap transfers vs `from==buyer ∧ token==SRK` premium transfers); the shared Safe is deliberate, the disambiguation is 013's responsibility.
- **Signer-key loss (testnet)**: a 2-of-3 Safe tolerates the loss of one signer key; losing two would strand the treasury. This is acceptable on testnet and is documented; the mainnet signer policy is a separate later decision.
- **Guardian unchanged**: the Safe does NOT become the vault guardian (immutable); this feature moves *where fees land*, not *who governs the vault* — that distinction is stated honestly in the Trust Center, not blurred.

## Requirements *(mandatory)*

### Functional Requirements

**Treasury creation & address of record**

- **FR-001**: The system MUST establish a dedicated **2-of-3 multisig Safe** on Base Sepolia as the protocol fee treasury, with signers = the deployer EOA plus two new keys, created via the Safe web app (no Safe SDK / Foundry dependency added).
- **FR-002**: The Safe address MUST be recorded as the single source of truth in the shared address book (per network) and as a **non-key** agent config constant (`FEE_WALLET_ADDRESS`); no code path may resolve two different fee-treasury addresses for the same network.
- **FR-003**: No signer private key or seed phrase may appear in the repository or in any committed config — only public addresses. (The testnet signer keys are held outside the repo.)

**Fee-recipient migration — vault + Base swap (the Timelock surface)**

- **FR-004**: The vault fee recipient MUST be moved **only** through the Timelock governance ceremony — `schedule(setFeeRecipient(Safe))` → wait ≥ `minDelay` → `execute` — never a direct EOA setter call (which reverts under `onlyGuardian`).
- **FR-005**: The scheduled operation MUST encode `setFeeRecipient(Safe)` exactly (correct selector, correct Safe address), and the encoded calldata / operation id MUST be verified before execution.
- **FR-006**: The migration MUST NOT redeploy the vault and MUST NOT change the vault's immutable guardian; `_feeRecipient` is mutable state and is the only thing that changes.
- **FR-007**: Moving the vault's `feeRecipient` MUST automatically move the Base and Base-Sepolia **swap** routing fee to the Safe (the swap flow falls back to the live `vault.feeRecipient()` when no chain-specific swap treasury is set) — with no separate change on those chains.
- **FR-008**: After execution, the change MUST be confirmed by a `FeeRecipientUpdated` event and a live `feeRecipient()` read returning the Safe, before the migration is treated as settled.

**Fee-recipient migration — Robinhood 46630 (the constant surface)**

- **FR-009**: The Robinhood-testnet (46630) `swapFeeRecipient` constant MUST be updated to the Safe address AND the web app redeployed; the change is complete only when both have happened.
- **FR-010**: The 46630 constant change MUST be understood to NOT follow the Timelock (46630 has no vault); it is an independent web-shipped surface.

**Provable non-custody (N5 / Principle III)**

- **FR-011**: The Safe MUST gain **zero** fund-movement authority over user funds: it MUST NOT be the vault guardian, MUST NOT be granted any Timelock role, and MUST have no code path to withdraw, redeem, or move any user's funds — it is a plain, non-privileged fee-share / token holder.
- **FR-012**: The Trust Center and the fees page MUST display the Safe's **actual** on-chain powers — nil authority over user funds — provable from chain, not asserted; and MUST show the Safe as the current fee recipient via the existing live `feeRecipient()` read (no bespoke data source).
- **FR-013**: No limit, delay, or authority introduced by this feature may touch the withdraw-always exit path; a user MUST be able to exit exactly as before (N2), unaffected by the fact that the fee recipient is now a multisig.

**Operator visibility**

- **FR-014**: The admin revenue dashboard MUST show the Safe's balances (native + relevant fee tokens) from a **live on-chain read**, and MUST degrade honestly (state it cannot load) when the read is unavailable — never a fabricated figure.
- **FR-015**: This feature MUST NOT introduce a database migration or a persisted balance ledger; balances are live reads and the address lives in config / the address book.

**Governance & audit**

- **FR-016**: The migration ceremony (the `schedule` and `execute` transactions and the resulting `FeeRecipientUpdated`) MUST be recorded in the living docs (tx hashes + the before/after recipient), since the change is public and time-delayed by design.

### Key Entities *(include if feature involves data)*

- **Fee Treasury Safe**: a 2-of-3 multisig on Base Sepolia that receives all protocol fees. A plain, non-privileged holder — no vault role, no Timelock role, no authority over user funds. Identified only by its public address in the address book + agent config.
- **Vault fee recipient (`_feeRecipient`)**: mutable vault state naming the address that receives performance-fee shares; changed only via the Timelock. Read live by the fees page, the non-custody badge, and (by fallback) the swap flow.
- **Timelock operation**: a scheduled-then-executed governance call (`schedule`/`execute`, guarded by `minDelay`, keyed by target + value + calldata + predecessor + salt) that carries the `setFeeRecipient(Safe)` change. Public and delayed.
- **Robinhood swap-fee constant**: the hardcoded 46630 `swapFeeRecipient` in the shared address book; changed by editing the constant and redeploying the web app; does not follow the Timelock.
- **Fee-treasury config record**: the Safe address as recorded in the shared address book (per network) and the agent's non-key `FEE_WALLET_ADDRESS` constant. No private material.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After cutover, **100%** of protocol fees on the migrated surfaces — vault performance-fee shares, the Base / Base-Sepolia swap fee, and the Robinhood 46630 swap fee — land on the Safe; the deployer EOA receives **zero** new fees on those surfaces.
- **SC-002**: The vault fee recipient is changed with **zero** vault redeploys and **zero** change to the vault address or its immutable guardian — verified by an unchanged vault address and guardian before/after.
- **SC-003**: The fees page and Trust Center reflect the Safe as the current fee recipient within **one page load** of the Timelock `execute`, with **no** code change to those pages' data source (they read `feeRecipient()` live).
- **SC-004**: The Trust Center provably shows the Safe's authority over user funds is **none** (not guardian, no withdraw/redeem path), and **zero** withdrawals/exits are blocked, delayed, or captured by the fact that the fee recipient is a multisig (N2, N5) — verified across the migrated and pre-migration states.
- **SC-005**: The admin revenue dashboard shows the Safe's **real** balances (or an honest "cannot load"), with **no** sample/placeholder figure in any state.
- **SC-006**: **Zero** signer private keys or seeds are present in the repository or committed config — verified by inspection.

## Assumptions

- **The vault's `_feeRecipient` is mutable state** and its `setFeeRecipient` is `onlyGuardian`, where the guardian is the OZ TimelockController; moving the recipient is therefore a Timelock ceremony, not a redeploy and not an EOA call. (Verified against the deployed vault + guardian.)
- **The Base / Base-Sepolia swap fee follows the vault's live `feeRecipient()`** because no chain-specific swap treasury is set on those chains, so the vault Timelock change moves the swap fee automatically there. The Robinhood 46630 fee is a hardcoded constant and must be moved separately.
- **The Safe is created via `app.safe.global`** on Base Sepolia; there is no Safe SDK in the repo and none is added. The two new signer keys are testnet-only and stored outside the repository.
- **The Safe receives fee shares/tokens only** and gains no on-chain role; it cannot become the vault guardian (immutable) and is not granted any Timelock role.
- **The admin revenue dashboard's Safe balance card** is provided by feature 013; this feature supplies the Safe address and the balance/permission requirements, not a new persistence layer. Balances are live reads.
- **No database migration** is introduced; the Safe address lives in the shared address book and the agent's non-key `FEE_WALLET_ADDRESS` constant.
- **Ordering across 012/013/014** (recorded, not built here): create + record the Safe first, wire it as the premium (012) and swap-fee-indexer (013) target, and execute the vault Timelock move last, to minimize the window in which the swap-fee indexer must union two recipient addresses.
- **Networks in scope** are Base Sepolia (84532) — the vault + Base swap surface — and Robinhood testnet (46630) — the constant surface. Base mainnet (8453) has no vault and no fee configured today and is out of scope for this migration.
