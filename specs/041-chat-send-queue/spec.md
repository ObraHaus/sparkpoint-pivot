# Feature Specification: One turn at a time

**Feature Branch**: `feature/041-chat-send-queue`

**Created**: 2026-08-04

**Status**: Draft

**Input**: Client report — "I am starting a new conversation and just manually input my message
instead of selecting from the suggestion buttons… it is better to remove the suggestion buttons if
there is a message being processed or queued. Speaking of queued — it seems that I can also send
multiple messages and it was being processed all in once. Won't that confuse the AI or the
conversation log?"

---

## Why this exists

Yes — it confuses both, and worse than the report supposed. `send()` called the streaming turn
handler with no regard for whether one was already running, so a second message went out **in
parallel** with the first. Two consequences follow, and the more serious one leaves no trace on
screen:

1. **In a new chat, every parallel send forks its own conversation.** The client only learns the
   conversation id from the terminal frame of the *first* stream. Until that frame arrives it sends
   no id, and the agent treats a missing id as "create a conversation". Three quick messages in a
   fresh chat therefore became **three separate threads**, each titled after its own message. The
   screen shows one conversation; the sidebar has three.

2. **In an existing chat, the turns interleave.** Both requests read the conversation history
   before either had written to it, so neither saw the other's message, and the rows are appended in
   completion order. A transcript that reads `you: A · you: B · Sparky: answer to B · Sparky: answer
   to A` is what gets replayed, and what gets fed back as context to every later turn.

The suggestion chips are the third face of the same bug: each chip **is** a send, so leaving them up
during a turn was the product offering a one-click way to fire a parallel message. They are also
answering the wrong question — chips propose what to ask *next*, and until the answer lands there is
no "next" to propose from.

Serialising the sends fixes all three at the root. Message two starts only after message one's
terminal frame has recorded the conversation id, so it joins the thread instead of forking it, and
it is composed against a history that contains message one.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My messages go one at a time, in the order I typed them (Priority: P1)

While Sparky is answering, a further message is accepted and held. It is sent when the current
answer finishes. Messages are never in flight together.

**Why this priority**: It is the defect. Everything else here is how the behaviour is made visible.

**Independent Test**: In a new chat, send three messages in quick succession; confirm one
conversation exists afterwards, containing all three exchanges in order.

**Acceptance Scenarios**:

1. **Given** an idle chat, **When** a message is sent, **Then** it goes out immediately.
2. **Given** an answer is streaming, **When** another message is sent, **Then** it is accepted and
   waits, and no second request is made until the first completes.
3. **Given** three messages sent in quick succession in a **new** chat, **When** all three have been
   answered, **Then** exactly **one** conversation exists and it holds all three exchanges.
4. **Given** three messages sent in quick succession, **When** they are answered, **Then** the
   answers appear against the questions they belong to, in the order the questions were typed.
5. **Given** a queued message, **When** its turn arrives, **Then** it is sent with the conversation
   id established by the preceding turn.

---

### User Story 2 - I can see that a message has not been sent yet (Priority: P1)

A message that is waiting looks different from one that has been sent, and the composer says how
many are waiting.

**Why this priority**: Equal first. A queue nobody can see is indistinguishable from a message that
was silently dropped — which is precisely the confusion this feature is meant to end.

**Independent Test**: Send two messages during an answer and confirm both appear, marked as waiting,
with a count above the composer.

**Acceptance Scenarios**:

1. **Given** a message is queued, **When** it renders, **Then** it is visibly marked as not yet
   sent.
2. **Given** a message is queued, **When** its turn arrives, **Then** the marking clears.
3. **Given** any number of messages are waiting, **When** the composer renders, **Then** it states
   how many.
4. **Given** nothing is waiting, **When** the composer renders, **Then** it says nothing about a
   queue — silence is the normal state.

---

### User Story 3 - No suggestions while a turn is in flight (Priority: P1)

The suggested-prompt chips are hidden from the moment a message is sent until everything queued has
been answered.

**Why this priority**: It is the client's stated request, and each chip is itself a send — leaving
them up is the product handing the user the bug.

**Independent Test**: Send a message and confirm the chips disappear for the duration, then return.

**Acceptance Scenarios**:

1. **Given** an answer is streaming, **When** the composer renders, **Then** no chips are shown.
2. **Given** messages are queued, **When** the composer renders, **Then** no chips are shown.
3. **Given** every message has been answered, **When** the composer renders, **Then** the chips
   return, reflecting the finished turn (037/039).

---

### User Story 4 - A failure does not swallow what I typed (Priority: P2)

If a message fails, the ones behind it are not sent, are not lost, and can be sent on request.

**Why this priority**: Introduced by the queue itself. Holding messages creates the possibility of
holding them forever, which would be a worse defect than the one being fixed.

**Independent Test**: Force a turn to fail with messages queued behind it; confirm they remain
visible, marked unsent, and can be sent.

**Acceptance Scenarios**:

1. **Given** a turn fails with messages queued, **When** the failure lands, **Then** the queued
   messages are not sent.
2. **Given** those messages, **When** they render, **Then** they show their original text, say they
   were not sent, and offer to send.
3. **Given** the user chooses to send one, **When** it is sent, **Then** it behaves like any other
   send.

---

### Edge Cases

- **Switching conversations with messages queued**: the queue is abandoned. A message typed at one
  conversation must never be answered in another.
- **"New chat" mid-answer**: same — the in-flight request is abandoned and its result is not written
  into the new screen. The answer is still persisted server-side and is there when the thread is
  reopened.
- **Typing ahead without limit**: bounded. Each queued message is a real request that will be made,
  and the free model pool already saturates under rapid-fire load. Over the bound the message is
  **refused out loud**, never silently dropped.
- **The offline demo path** (no wallet, scripted replies): serialised too. A fix that only works
  when connected is one that cannot be demonstrated.
- **A failure with nothing queued**: unchanged from today — the honest error card and its per-turn
  "Try again".
- **Two browser tabs**: out of scope. Each tab serialises its own sends; nothing here coordinates
  across tabs.

---

## Requirements *(mandatory)*

### Functional Requirements

**Serialisation**

- **FR-001**: At most ONE chat turn may be in flight at any moment.
- **FR-002**: Messages sent while a turn is in flight MUST be queued, not dropped and not sent.
- **FR-003**: Queued messages MUST be sent in the order they were submitted.
- **FR-004**: A queued message MUST be sent with the conversation established by the preceding turn,
  so a burst in a new chat produces exactly one conversation.
- **FR-005**: The decision to queue MUST be taken from the queue's own state, not from a copy that
  may be stale within the same tick.

**Visibility**

- **FR-006**: A queued message MUST be visibly distinguishable from a sent one.
- **FR-007**: The marking MUST clear when the message is actually sent.
- **FR-008**: The composer MUST state how many messages are waiting, and state nothing when none
  are.

**Suggestions**

- **FR-009**: Suggestion chips MUST be hidden while any message is in flight or waiting.
- **FR-010**: They MUST return once everything has been answered, unchanged in content from 037/039.

**Failure and abandonment**

- **FR-011**: A turn that fails **at the transport** — no stream at all, an HTTP error, the agent
  unreachable — MUST stop the queue rather than send the remaining messages into the same wall.
  A turn that RUNS and returns an error block MUST NOT stop the queue: the assistant is reachable
  and the next message may well succeed. Verified live — a burst of three produced fail · succeed ·
  fail, so halting on the first would have suppressed an answer that worked.
- **FR-012**: Messages the queue did not send MUST remain visible with their text intact, marked
  unsent, with an affordance to send.
- **FR-013**: Changing conversation (opening a thread, or "New chat") MUST abandon the queue and the
  in-flight request, and MUST NOT write that request's result into the new screen.
- **FR-014**: The queue MUST be bounded, and exceeding the bound MUST be reported to the user.

**Throughout**

- **FR-015**: A queued or in-flight message MUST hold the auto-reload (unsent work, same as an
  untyped draft) — never with a funds-safety lock, only the existing "busy" hold.
- **FR-016**: Nothing in this feature may change what is signable, what the policy gate decides, or
  the withdraw/exit path (N2).

### Key Entities

- **Queued message** — the text, and the thread bubble already rendered for it.
- **Queue state** — whether something is in flight, and how many wait behind it.

---

## Success Criteria *(mandatory)*

- **SC-001**: Three messages sent in quick succession in a new chat produce ONE conversation
  containing all three exchanges, in order.
- **SC-002**: While an answer streams, a further message appears marked as waiting and no second
  request is issued.
- **SC-003**: No suggestion chip is present at any moment between the first send and the last
  answer.
- **SC-004**: The chips return after the last answer, showing follow-ups for the finished turn.
- **SC-005**: The composer states the number waiting, and shows nothing when none are.
- **SC-006**: A failed turn leaves the messages behind it visible, unsent, and sendable.
- **SC-007**: Opening another conversation with messages queued sends none of them into it.
- **SC-008**: Sending past the bound reports the refusal rather than dropping the message.
- **SC-009**: The scripted (no-wallet) path serialises identically.

## Assumptions

- **Holding is better than blocking.** Disabling the composer during a turn would also prevent
  parallel sends, but it discards what the user typed. Everything typed is kept.
- **The bound is four waiting messages.** More than anyone types ahead deliberately; few enough that
  a stuck queue cannot become a burst.
- **A failure stops the queue.** A failure here almost always means the assistant is unreachable,
  and draining more messages into it produces more identical error cards and more doomed requests.

## Out of scope

- Coordinating sends across browser tabs or devices.
- Editing or reordering a queued message.
- Server-side rejection of concurrent turns for the same conversation (the client is the only
  producer today; if that changes, this becomes a separate problem with its own answer).
- Anything about what an answer contains.
