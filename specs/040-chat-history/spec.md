# Feature Specification: Chat history you can actually navigate

**Feature Branch**: `feature/040-chat-history`

**Created**: 2026-08-04

**Status**: Draft

**Input**: Client proposal + four locked decisions (artifact `1477fdaa`).

---

## Why this exists

The chat sidebar is one undifferentiated column of conversation titles, newest first, with nothing to
say when any of them happened. On the busiest wallet on alpha that column is fifty rows long,
**forty-seven of them from a single day**, and the title *"Explain the performance fee"* appears five
times. It is a list you scroll rather than read.

Three separate problems sit behind that, and the client asked for all three:

1. **No sense of time.** Nothing distinguishes this morning from three weeks ago.
2. **The list silently ends.** It is capped at fifty rows and that wallet has **110** conversations.
   Sixty are invisible and nothing says so. Grouping makes this *worse* before better: a flat list
   that stops is ambiguous, but a list that stops under a heading reading "Previous 30 days" looks
   like a definite claim that nothing older exists.
3. **You cannot find anything.** No search, and identical titles are indistinguishable from
   each other.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - I can see when things happened (Priority: P1)

The sidebar groups conversations under time headings — Today, Yesterday, Previous 7 days, Previous 30
days, then month names, then years — each with a count. A conversation belongs to the group of its
**last activity**, so a thread resumed this morning appears under Today rather than where it began.

**Why this priority**: The headline request, and the thing every other part of this feature hangs off.

**Independent Test**: Open the sidebar on a wallet with conversations spanning several weeks and
confirm the headings, their order, their counts, and that a resumed thread has moved.

**Acceptance Scenarios**:

1. **Given** conversations from today, yesterday, five days ago and three weeks ago, **When** the
   sidebar renders, **Then** four headings appear in that order, each with the number below it.
2. **Given** a conversation created three weeks ago and replied to today, **When** the sidebar
   renders, **Then** it appears under Today.
3. **Given** no conversation in a period, **When** the sidebar renders, **Then** that heading does
   not appear at all.
4. **Given** a conversation from 23:59 local time yesterday, **When** the sidebar renders just after
   local midnight, **Then** it appears under Yesterday — the boundary is the reader's midnight, not
   UTC's.
5. **Given** conversations from a previous year, **When** the sidebar renders, **Then** they are
   grouped by year rather than by month name alone, so "January" can never mean two different things.

---

### User Story 2 - The list stops telling me it has ended when it has not (Priority: P1)

When more conversations exist than have been loaded, the sidebar says so and offers to load them. A
heading never implies a boundary that is really a page limit.

**Why this priority**: Equal first. Shipping the headings without this makes the sidebar
*confidently* wrong, which is worse than the vague wrongness it has today.

**Independent Test**: On a wallet with more than one page of conversations, confirm the control
appears, states how many remain, and that using it reveals older groups.

**Acceptance Scenarios**:

1. **Given** more conversations exist than are loaded, **When** the sidebar renders, **Then** a
   control appears saying how many more there are.
2. **Given** that control is used, **When** the next page arrives, **Then** the new conversations
   appear in their correct groups, including groups that did not exist before.
3. **Given** every conversation is loaded, **When** the sidebar renders, **Then** no control appears
   — the absence of the control is itself the statement that this is all of them.
4. **Given** the next page fails to load, **When** the failure happens, **Then** the sidebar says so
   and what is already there is untouched.

---

### User Story 3 - I can find a conversation by name (Priority: P2)

A search box above the list filters conversations by title. Searching looks through the user's
**whole** history, not only the page that happens to be loaded.

**Why this priority**: Grouping helps you find recent things; search is what finds old ones. It is
also what makes the page limit tolerable rather than merely honest.

**Independent Test**: Search for a word appearing only in a conversation older than the first page,
and confirm it is found.

**Acceptance Scenarios**:

1. **Given** a search term, **When** results return, **Then** only conversations whose title matches
   are listed, still under their time headings.
2. **Given** a term matching a conversation older than the loaded page, **When** results return,
   **Then** that conversation appears — search is not limited to what is on screen.
3. **Given** a term matching nothing, **When** results return, **Then** the sidebar says nothing
   matched, and clearing the box restores the full list.
4. **Given** a search is in progress, **When** the user keeps typing, **Then** only the final term is
   requested — a keystroke is not a request.

---

### User Story 4 - I can tell identical conversations apart (Priority: P2)

Conversations with the same title are distinguishable at a glance.

**Why this priority**: Five threads called "Explain the performance fee" is a real state of the live
data, and grouping makes it more visible rather than less. The titles are *honest* — the questions
were identical — so the fix is disambiguation, not invention.

**Independent Test**: With several identically-titled conversations in one group, confirm each row
carries something that distinguishes it.

**Acceptance Scenarios**:

1. **Given** two conversations with the same title in the same group, **When** the sidebar renders,
   **Then** each row shows a distinguishing detail.
2. **Given** any conversation, **When** its row renders, **Then** the title is never rewritten or
   invented — what it says is what the user asked.

---

### Edge Cases

- **A brand-new user with no conversations**: no headings, no search box, no "show older" — an empty
  list should look empty, not like a broken filter.
- **Exactly one conversation**: one heading, no controls.
- **A conversation with no title** (a thread abandoned before the first answer): it still groups and
  still opens, under whatever the product already shows for an untitled thread.
- **The clock crossing midnight while the sidebar is open**: the grouping is computed from a clock
  read at render, so it corrects itself on the next render rather than freezing at "Today" forever.
- **A device whose clock is wrong**: grouping is relative to the device's own midnight — a wrong
  clock produces wrong groups, and nothing else in the product depends on it.
- **Searching while more pages are unloaded**: the search covers everything, so its results must not
  be confused with the paged list — clearing the search returns to the paged view unchanged.

---

## Requirements *(mandatory)*

### Functional Requirements

**Grouping**

- **FR-001**: Conversations MUST be grouped under time headings, ordered newest period first.
- **FR-002**: The periods are: Today · Yesterday · Previous 7 days · Previous 30 days · each month of
  the current year · each month of a previous year, labelled with its year · then years alone.
- **FR-003**: A conversation MUST be grouped by its **last activity**, not its creation.
- **FR-004**: Day boundaries MUST be the reader's LOCAL midnight.
- **FR-005**: An empty period MUST NOT render a heading.
- **FR-006**: Each heading MUST show how many conversations are under it.
- **FR-007**: Within a group, conversations MUST stay in most-recent-first order.

**The page limit**

- **FR-008**: When more conversations exist than are loaded, the sidebar MUST say so and offer to
  load more.
- **FR-009**: The control MUST state how many more exist.
- **FR-010**: Loading more MUST add to the list, never replace it, and MUST place new arrivals in
  their correct groups.
- **FR-011**: When everything is loaded, no such control may appear.
- **FR-012**: A failure to load more MUST be visible and MUST leave the loaded list intact.

**Search**

- **FR-013**: A search MUST cover the user's entire history, not only the loaded page.
- **FR-014**: Results MUST remain grouped by time.
- **FR-015**: A search matching nothing MUST say so.
- **FR-016**: Clearing the search MUST restore the previous list exactly.
- **FR-017**: Typing MUST NOT issue one request per keystroke.

**Telling conversations apart**

- **FR-018**: Every row MUST carry a distinguishing detail beyond its title.
- **FR-019**: A conversation's title MUST NOT be rewritten, invented, or de-duplicated away — what it
  says is what the user asked.

**Throughout**

- **FR-020**: Every conversation in the list MUST remain openable by keyboard as well as pointer.
- **FR-021**: Nothing in this feature may touch what a conversation *contains*, only how it is found.

### Key Entities

- **Conversation summary** — id, title, when it was created, when it was last active, how many turns.
- **Group** — a period, its label, its conversations, and its count.
- **Page state** — how many are loaded, how many exist, whether more can be fetched.

---

## Success Criteria *(mandatory)*

- **SC-001**: A wallet with conversations spanning several weeks sees them under correctly ordered,
  correctly counted headings.
- **SC-002**: A conversation created weeks ago and replied to today appears under Today.
- **SC-003**: A conversation from just before local midnight appears under Yesterday just after it.
- **SC-004**: On a wallet with more conversations than one page, the sidebar states how many more
  exist, and loading them reveals groups that were not previously visible.
- **SC-005**: With everything loaded, no "show older" control is present.
- **SC-006**: A search finds a conversation that is older than the loaded page.
- **SC-007**: A search matching nothing says so; clearing it restores the list unchanged.
- **SC-008**: Typing a five-character search term issues fewer than five requests.
- **SC-009**: Two identically-titled conversations in the same group are distinguishable.
- **SC-010**: Every row can be opened with the keyboard alone.
- **SC-011**: A brand-new user sees an empty list, not a broken one.

---

## Assumptions

- **Search is by title.** Full-text over message bodies is a different feature with different privacy
  questions; titles are what the sidebar shows and what a person remembers.
- **A page is fifty conversations**, matching today's behaviour, so nothing gets slower for existing
  users.
- **The distinguishing detail is the time of last activity**, which is already being fetched, needs no
  new data, and is the thing that actually differs between two identical questions.
- **Search results are not paged.** A title search returns a bounded set; if that stops being true it
  becomes a separate problem with its own answer.

## Out of scope

- Renaming, merging or auto-titling conversations (FR-019 — the titles are honest).
- Searching message contents rather than titles.
- Pinning, archiving, folders, or any organisation the user does by hand.
- Anything about what a conversation contains — this feature is only about finding one.
