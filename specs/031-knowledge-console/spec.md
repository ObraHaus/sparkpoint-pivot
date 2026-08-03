# Feature Specification: One knowledge console, and an assistant that reads everything we publish

**Feature Branch**: `feature/031-knowledge-console`
**Created**: 2026-08-03
**Status**: Draft
**Input**: Client decision 3 of the Aug-3 review (artifact `9f7dd404`), taken 3 August.

## Why this feature exists

The assistant reads one corpus and one corpus only. Two other bodies of writing the team publishes —
the tip databank and the in-app changelog — are invisible to it, and one of them is the direct cause
of a gap found the night before: asked *"what shipped this week?"*, the assistant can only point at a
page, because it cannot read the page.

Meanwhile an admin maintaining that writing works across three separate screens with three different
shapes, and there is nowhere at all for the assistant's own research to live.

The client's decision: **one console with five sections — knowledge, persona, self-authored, updates,
tips** — and let the assistant write into the self-authored section daily, unattended, with an admin
able to read, edit and delete anything in it exactly like the rest.

The reason indexing updates and tips is the standout part: every future release then teaches the
assistant automatically, with no separate step to forget.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The assistant knows what we published (Priority: P1)

A user asks what changed recently, or asks something a published tip already answers, and gets a real
answer instead of a pointer.

**Why this priority**: It closes a gap already observed with users, and it is the reason the client
asked for the consolidation at all.

**Independent Test**: Publish a changelog entry, then ask the assistant what shipped recently and
confirm it answers from that entry and cites it.

**Acceptance Scenarios**:

1. **Given** published updates, **When** a user asks what changed recently, **Then** the assistant
   answers from them rather than directing the user to a page.
2. **Given** a published tip covering a topic, **When** a user asks about that topic, **Then** the
   tip's content is available to the answer.
3. **Given** an answer drawn from any of these, **When** it is displayed, **Then** its source is
   identified honestly, and the reader can tell what KIND of source it was.
4. **Given** the persona, **When** any answer is produced, **Then** persona text is never retrievable
   and never citable — it remains instructions, not content.

---

### User Story 2 - One place to maintain everything (Priority: P2)

An admin opens a single console and can see and edit all five bodies of writing, each in its own
section, without learning three different screens.

**Independent Test**: From the consolidated console, view and edit an item of each kind, and confirm
the previous separate screens still resolve.

**Acceptance Scenarios**:

1. **Given** the console, **When** an admin opens it, **Then** all five sections are present and
   each states plainly what it is and who wrote it.
2. **Given** any item in any section, **When** an admin edits or deletes it, **Then** the change
   takes effect and is recorded in the audit trail.
3. **Given** an existing bookmark to one of the old screens, **When** it is opened, **Then** it still
   works.

---

### User Story 3 - The assistant's own research, visible and revocable (Priority: P2)

The assistant writes research notes on a schedule. They are clearly marked as its own, an admin can
correct or remove any of them, and a reader can tell them apart from documentation a person wrote.

**Why this priority**: The client accepted unattended authoring; the safeguard is that it is
visible, correctable, and distinguishable — not that it is gated.

**Independent Test**: Trigger a generation, confirm the note appears in its own section, edit it,
delete it, and confirm a citation to it identifies it as assistant-written.

**Acceptance Scenarios**:

1. **Given** a scheduled run, **When** it completes, **Then** any note it wrote appears in the
   self-authored section, attributed and dated.
2. **Given** a self-authored note, **When** an admin edits or deletes it, **Then** the change takes
   effect immediately, exactly as for a hand-written document.
3. **Given** an answer citing a self-authored note, **When** the citation is shown, **Then** it is
   identified as the assistant's own research rather than as external documentation.
4. **Given** a generation run, **When** it produces a note, **Then** that note is grounded in a
   source fetched during the run, and the run does not read previously self-authored notes as input.
5. **Given** a failure at any point in a run, **When** it happens, **Then** nothing is written and
   the assistant continues serving unchanged.

---

### Edge Cases

- An empty changelog or tip databank: the assistant simply has nothing extra, never an error.
- A published entry containing characters the database encodes strictly.
- A generation run that produces something unusable — nothing is stored.
- A very long published entry: it is split for retrieval like any other document.
- An admin deleting a note the assistant re-creates on the next run.
- The embedding backend being unavailable: publishing still works; retrieval degrades honestly.

## Requirements *(mandatory)*

- **FR-001**: Content the team publishes as updates and tips MUST be available to the assistant's
  answers.
- **FR-002**: The persona MUST remain non-retrievable and non-citable.
- **FR-003**: Every citation MUST identify the KIND of source it came from, distinguishing
  hand-written documentation, published updates, tips, and the assistant's own research.
- **FR-004**: One console MUST present all five bodies of writing, each separately identified.
- **FR-005**: Any item in any section MUST be readable, editable and deletable by an admin, with the
  change recorded.
- **FR-006**: Previously published admin routes MUST continue to resolve.
- **FR-007**: The assistant MAY write research notes without prior approval, into a section reserved
  for them.
- **FR-008**: A generation run MUST ground each note in a source fetched during that run, and MUST
  NOT use previously self-authored notes as input.
- **FR-009**: A generation run MUST NOT produce anything that claims custody of user funds or
  promises a return.
- **FR-010**: A failure during generation MUST leave existing content untouched and MUST NOT affect
  the assistant's availability.
- **FR-011**: Making more content retrievable MUST NOT change what the assistant is permitted to
  propose, or any safety decision.

## Success Criteria *(mandatory)*

- **SC-001**: Asked what shipped recently, the assistant answers from published updates and cites
  them.
- **SC-002**: A citation makes the kind of source apparent to a reader.
- **SC-003**: Persona text appears in no answer and no citation.
- **SC-004**: All five sections are reachable from one console, and every old admin route still
  resolves.
- **SC-005**: A self-authored note can be edited and deleted by an admin, and the change is visible
  immediately.
- **SC-006**: A generation failure leaves the assistant serving normally with content unchanged.
- **SC-007**: No safety behaviour changes: the deterministic gate, what is signable, and the
  withdrawal path are unaffected.

## Assumptions

- Retrieval already exists and is scoped to one kind of content; widening the scope is a change to
  what is searched, not to how answers are produced.
- The assistant's own notes are stored like any other document so that every existing admin
  capability applies to them without new machinery.
- "Unattended" means no approval step before a note becomes visible. It does not mean unbounded: a
  note must still be grounded in something fetched, and must not make custody or return claims.

## Out of Scope

- Any change to what the assistant may propose or to the safety evaluation.
- Making the persona retrievable.
- Automatic publication of assistant-written text to user-facing pages — self-authored notes inform
  answers; they are not the changelog.
