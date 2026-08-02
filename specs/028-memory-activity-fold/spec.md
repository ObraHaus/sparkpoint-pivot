# Feature Specification: Sparky Memory v2 — Platform-Activity Awareness

**Feature Branch**: `feature/028-memory-activity-fold`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Fold the user's real platform actions — manual vault deposits/withdrawals, executions signed through the app, swaps made on the swap page, and test-token faucet claims — into Sparky's existing cross-conversation memory, so the assistant knows what the user actually DID, not just what was said in chat. Client decision D3: swaps and faucet claims are in scope NOW, not deferred."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sparky knows about my manual vault actions (Priority: P1)

A user deposits USDC into the vault directly from the vault page (or withdraws via the always-available exit path) without ever opening the chat. Later — possibly days later, possibly in a brand-new conversation — they ask Sparky "what have I done recently?" and Sparky's answer names the deposit: what kind of action, roughly how much, and when. The user never had to tell Sparky about it.

**Why this priority**: This is the core client request ("even the manual actions that didn't go thru the ai chat"). Vault deposits/withdrawals are the platform's primary value action, and an assistant that doesn't know the user deposited yesterday feels blind. It is also the only story that requires nothing new from the user — the platform already records these events.

**Independent Test**: Make an on-chain vault deposit as a test wallet WITHOUT touching chat; open a fresh conversation and ask "what have I done recently?" — the answer must name the deposit. Deliverable value even if no other story ships.

**Acceptance Scenarios**:

1. **Given** a user with an empty memory who deposited 500 USDC via the vault page an hour ago, **When** they start any chat turn, **Then** their memory gains a line equivalent to "deposited 500.00 USDC into the vault (yourself, <date>)" and a question about recent activity is answered with that fact.
2. **Given** a user who withdrew via the exit page, **When** they next chat, **Then** the withdrawal appears in memory labeled as their own action.
3. **Given** a user who has NOT performed any new platform action since their last chat turn, **When** they chat again, **Then** no new activity lines are added (no duplicates, ever).

---

### User Story 2 - Sparky knows which moves went through its own advice (Priority: P2)

A user reviews a move Sparky proposed, signs it in the execution drawer, and it confirms on-chain. In later conversations, Sparky distinguishes "things you did yourself" from "things you executed from my suggestions" — so "did I ever act on your advice?" gets an honest, specific answer. A signed transaction that reverted is also remembered, gently, as something that didn't go through.

**Why this priority**: Closes the "Sparky proposed it but never learns you did it" gap. Depends on the same fold mechanism as Story 1 (same event, different label), so it ships naturally second.

**Independent Test**: Execute a Sparky-proposed vault deposit through the drawer; in a new conversation ask "did I act on any of your suggestions?" — the answer must reference the executed deposit as advised-and-done.

**Acceptance Scenarios**:

1. **Given** a vault deposit executed through the app's signing flow, **When** the user next chats, **Then** the memory line for that deposit is labeled as done via Sparky's plan (not "yourself").
2. **Given** an app-signed transaction that reverted on-chain, **When** the user next chats, **Then** memory gains a gentle line noting the action didn't go through.
3. **Given** an execution with no corresponding vault event (e.g. an automation grant), **When** the user next chats, **Then** it appears as its own memory line.

---

### User Story 3 - Swaps and faucet claims count too (Priority: P3)

A user swaps tokens on the swap page, or claims test SRK from the faucet on the Premium page. Sparky's memory picks both up like any other platform action: "made a token swap (~1,000 USDC, <date>)", "claimed test SRK from the faucet (<date>)".

**Why this priority**: Client decision D3 moved this into scope now. Lower priority than vault actions only because the amounts involved are smaller and the events are testnet conveniences — but for alpha testers these are the most frequent actions, so covering them makes memory feel complete.

**Independent Test**: Perform a swap on the swap page and a faucet claim; a fresh conversation asking about recent activity must mention both.

**Acceptance Scenarios**:

1. **Given** a completed swap on the swap page, **When** the user next chats, **Then** memory gains a swap line with an approximate size (clearly marked approximate) and date.
2. **Given** a faucet claim, **When** the user next chats, **Then** memory gains a faucet-claim line with a date (no amount — historical claim sizes are not knowable).
3. **Given** a swap made on the Robinhood test network, **When** the user next chats, **Then** it is folded the same way as a Base Sepolia swap.

---

### User Story 4 - My memory stays mine: visible, clearable, and honest (Priority: P1, invariant-bearing)

Activity lines appear verbatim in Settings → Memory exactly like chat-derived lines; the disclosure copy says platform activity is included. Clearing memory removes activity lines AND they never resurrect — cleared is cleared. Memory (including activity) remains advisory context only: it can never make a move eligible, approve anything, or touch funds.

**Why this priority**: These are the standing constitutional guarantees of the memory feature. Activity awareness must inherit every one of them or it cannot ship.

**Independent Test**: After activity lines exist: view them in Settings; clear; chat again — cleared activity must not reappear. Policy verdicts on identical proposals must be byte-identical with and without activity lines present.

**Acceptance Scenarios**:

1. **Given** folded activity lines, **When** the user opens Settings → Memory, **Then** the lines are listed verbatim alongside chat lines, and the disclosure copy mentions platform activity.
2. **Given** a user who clears their memory, **When** they chat again, **Then** previously-cleared activity does not reappear (only genuinely NEW activity may).
3. **Given** any proposal evaluated by the policy gate, **When** activity lines are present vs absent, **Then** the gate's verdict is byte-identical.

---

### Edge Cases

- **First fold for a long-time user**: a user with months of history must not have their chat memory flooded — the first fold takes only the 5 most recent events (client decision D1) and then tracks forward.
- **Very active user between chats**: a fold adds at most 10 lines; the digest's overall 40-line cap continues to evict oldest-first.
- **The activity data is unavailable** (store outage, missing schema, indexer behind): the chat turn proceeds normally with un-folded memory; one warning is logged per process; nothing 500s and no turn is blocked.
- **The same action visible twice** (an app-signed execution AND its on-chain event): exactly one memory line results, carrying the via-Sparky label.
- **Two chat turns racing**: no duplicated lines; the losing fold is a no-op.
- **A user who never chats**: their activity is never folded and no memory row is created — memory only advances for users who use the assistant.
- **Pending (not yet confirmed) app-signed actions**: not folded until they reach a terminal state; they must not be lost, only deferred.
- **Faucet claim visibility limit**: only the most recent claim since the last fold is derivable; multiple claims between chats may fold as one line (accepted — memory is a digest, not an audit log).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST fold the user's new platform activity into their existing cross-conversation memory when (and only when) that user begins a chat turn — no background processing, no folding for users who don't chat.
- **FR-002**: Folded sources MUST include: (a) on-chain vault deposits and withdrawals for the user's wallet regardless of origin; (b) app-signed executions in terminal states; (c) swaps attributable to the user's wallet on any supported network; (d) test-SRK faucet claims.
- **FR-003**: Each folded event MUST become one human-readable memory line carrying the action kind, an amount where truthfully known (approximations clearly marked; omitted where unknowable), an attribution label ("yourself" vs via-Sparky), and an absolute date.
- **FR-004**: An action recorded both as an app-signed execution and as an on-chain event MUST produce exactly one line, labeled via-Sparky.
- **FR-005**: Reverted app-signed transactions MUST be remembered with a gentle "didn't go through" line (client decision D2); pending ones MUST be deferred, not dropped; proposals that were never signed MUST NOT fold (chat already remembers them).
- **FR-006**: The system MUST track per-user progress through each activity source so that (a) no event is ever folded twice, (b) the first fold is capped at the 5 most recent events (D1), and (c) any single fold adds at most 10 lines.
- **FR-007**: Folding MUST be fail-open at every layer: any data source being unavailable (including the schema addition not yet applied) degrades that fold to a no-op with a once-per-process operator-visible warning, and can never delay-block, error, or alter the chat turn beyond the digest content.
- **FR-008**: Activity lines MUST inherit every existing memory guarantee unchanged: same length clamp and sanitization, same 40-line digest cap, same prose/classification-only boundary (never proposal building, policy evaluation, or transaction construction), same verbatim visibility in Settings, same Clear behavior.
- **FR-009**: Clearing memory MUST NOT resurrect previously-folded activity: after a clear, only activity newer than the clear point may appear.
- **FR-010**: The Settings memory disclosure MUST state that recent platform activity is included (the only user-interface change in this feature).
- **FR-011**: The living docs (developer changelog, migration register, client-facing in-app changelog entry) MUST ship in the same change.

### Key Entities

- **Memory digest** (existing): the per-user rolling list of at most 40 short lines Sparky consults; activity lines join it as peers of chat lines.
- **Activity event**: one real platform action derived from an existing record — a vault flow (kind, amount, when, transaction id), an execution (kind, status, when, transaction id, advised-or-not), a swap (approximate size, network, when), or a faucet claim (when).
- **Fold cursor** (new): the per-user high-water mark per activity source that guarantees exactly-once folding and survives memory clears.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A vault deposit made without any chat involvement is mentioned, with amount and date, in Sparky's answer to "what have I done recently?" in a brand-new conversation — verified live on alpha.
- **SC-002**: An action executed from Sparky's own suggestion is described as such (distinct from self-directed actions) in a later conversation — verified live.
- **SC-003**: A swap and a faucet claim each produce exactly one memory line, visible verbatim in Settings — verified live.
- **SC-004**: Re-asking in repeated new conversations never duplicates an activity line (exactly-once folding holds across at least 3 consecutive turns).
- **SC-005**: After Clear, previously-shown activity never reappears in memory or answers.
- **SC-006**: Policy verdicts are byte-identical with and without activity lines (automated test), and no chat turn fails or errors when every activity source is forced unavailable (automated test).
- **SC-007**: A first fold for a wallet with a long history adds at most 5 lines; no fold ever adds more than 10.

## Assumptions

- The existing per-source records (indexed vault events, execution records, swap-fee records) are the sources of truth and are already populated in the target environment; this feature adds no new indexing.
- Faucet-claim recency is derivable from the faucet's public per-address state; historical claim amounts are not knowable and are deliberately omitted.
- Swap size is estimated from the recorded platform fee (a fixed, known percentage of notional) and is always labeled approximate.
- Vault activity exists on Base Sepolia only today; swaps may exist on Base Sepolia and the Robinhood test network; the fold covers whatever networks each source actually records.
- Memory retention semantics are unchanged from feature 027 (40 lines, oldest evicted, user-clearable, no admin view).
- The develop database's SQL_ASCII encoding constraint applies to any new stored JSON (raw UTF-8, never escaped non-ASCII) — a standing platform constraint since feature 025.
