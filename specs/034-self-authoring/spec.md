# Feature Specification: Sparky's daily self-authoring

**Feature Branch**: `feature/034-self-authoring`

**Created**: 2026-08-03

**Status**: Draft

**Input**: Planning research + nine locked client decisions (artifact `4cbcb408`). Replaces the unwired mockup shipped in 032.

---

## Why this exists, and why it is shaped this way

Sparky should get better every day on its own: reading live market data and our own product, writing down what it learns, so its answers become more accurate, more specific and more honest over time.

The research turned up one finding that sets the whole shape of the feature, and it is worth stating before any requirement, because every requirement below follows from it.

**A note a day would make Sparky worse, not better.** Retrieval quality falls as a corpus grows — a bigger search space surfaces more passages that are topically similar and factually irrelevant, and stronger retrievers make it worse by producing better distractors. A measured study saw answer accuracy fall from 58.6% to 43.2% as a corpus grew twentyfold. Sparky's entire corpus today is **106 chunks**. A note a day would roughly quadruple it inside a year, and every one of those notes would be about yield — the exact topic users ask about. The new material would compete with the documentation that currently answers correctly, and the failure is **silent**: nothing errors, and a question answered well last month quietly starts returning last Tuesday's rate note instead.

So the job does not keep a diary. It **maintains a small set of living documents**, rewriting each in place. That is what a human analyst does, and it keeps the corpus roughly its current size while the contents stay current. The accepted cost is that history is not kept: Sparky will not be able to answer "what did rates look like in March".

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The assistant answers a market question it could not answer yesterday (Priority: P1)

A tester asks Sparky what USDC yields look like on Base and how our vault compares. Today Sparky can quote the vault's own rate and its fee terms, and nothing else — there is no document describing the surrounding market. After this feature, a self-authored document answers it: what the strategy earns in the live market, what the alpha's testnet rate is and why the two differ, and what our fee does to the difference. The answer carries a citation that says a SparkPoint research note written by Sparky and not yet reviewed, so the reader can tell it apart from documentation a person wrote and checked.

**Why this priority**: This is the entire point of the feature. Without it, everything else is machinery with no output anyone sees.

**Independent Test**: Trigger one run, then ask the live assistant a market question and confirm the answer draws on a self-authored document with the correct citation label.

**Acceptance Scenarios**:

1. **Given** a completed run that published the yields document, **When** a user asks what USDC yields look like on Base, **Then** the answer draws on that document and its citation identifies it as a research note written by Sparky and not yet reviewed.
2. **Given** any published document, **When** it states a rate, **Then** the sentence names the chain that rate came from.
3. **Given** a published document, **When** it discusses the wider market, **Then** it describes the landscape ("managed USDC vaults on Base currently pay 4–5%") without naming a competitor product as an alternative — while still naming Aave and Morpho, which are protocols the product uses.
4. **Given** a completed run, **When** the same question is asked twice, **Then** the assistant's answer does not contradict itself between asks.

---

### User Story 2 - The corpus stays the size it is (Priority: P1)

Running every day for a year must not leave Sparky worse at the questions it answers well today. Each run rewrites the same documents in place rather than adding new ones, and before publishing anything it re-asks a fixed set of questions whose right answers we already know. If a run would displace one of those known-good answers, the run is discarded and logged rather than published.

**Why this priority**: Equal first with US1. A feature that improves market answers while degrading "how do I withdraw everything?" is a net loss, and the degradation is invisible without this check.

**Independent Test**: Run the job repeatedly and confirm both that the chunk count stays bounded and that the golden-question check blocks a publish when a document is deliberately written to displace a known-good answer.

**Acceptance Scenarios**:

1. **Given** ten consecutive runs, **When** the corpus is measured after each, **Then** the number of self-authored chunks stays bounded by the document ceiling rather than growing per run.
2. **Given** a document whose content would displace the expected source for a golden question, **When** the run reaches its self-check, **Then** the run is discarded, nothing is published, and the reason is recorded.
3. **Given** a run in which no source could be fetched, **When** the run completes, **Then** no document is written and the run records why.
4. **Given** a run in which nothing material has changed since yesterday, **When** the run completes, **Then** it refreshes figures and writes no new claims — and this is recorded as a normal outcome, not an error.
5. **Given** any run, **When** it assembles what a document is written from, **Then** previously self-authored material is excluded from that input.

---

### User Story 3 - An admin controls what Sparky is allowed to read (Priority: P1)

An admin opens `/admin/knowledge` → Self-authored and edits the list of allowed data sources and the list of allowed prose domains. Adding or removing a source takes effect on the next run without a deploy. The list starts empty for prose: until someone adds a domain, no prose is fetched at all.

**Why this priority**: The allowlist is the primary safety control on the one input the product does not author. It cannot be a constant in the code, because the moment a source starts publishing something we don't want quoted, removing it must take minutes rather than a release.

**Independent Test**: Edit both lists in the console, trigger a run, and confirm the run fetched exactly the permitted sources and nothing else.

**Acceptance Scenarios**:

1. **Given** an empty prose allowlist, **When** a run executes, **Then** no prose is fetched from anywhere and the run still completes using structured sources.
2. **Given** a domain on the allowlist, **When** a run fetches from it, **Then** the fetch is recorded with its address and the time, and the retrieved text is stored as quoted evidence attributed to that source rather than merged into our own voice.
3. **Given** a URL not on the allowlist, **When** a run would fetch it, **Then** the fetch is refused and recorded as refused.
4. **Given** an admin removes a domain, **When** the next run executes, **Then** claims whose only supporting evidence came from that source are no longer asserted.
5. **Given** any change to either list, **When** it is saved, **Then** the change is recorded with who made it and when.

---

### User Story 4 - An admin controls whether and when notes go live (Priority: P2)

Publishing starts in draft: for a configurable window, documents are visible only to admins in the console. After that window, publishing is automatic. Both the mode (manual or automatic) and the window length are settings the admin edits, not constants.

**Why this priority**: The client asked to watch what it writes before users do, and asked for that to remain adjustable rather than a one-off. A fixed constant would need a deploy to change and would be forgotten.

**Independent Test**: Set the mode to manual, run the job, confirm nothing reaches users; switch to automatic with a zero-hour window, run again, confirm it does.

**Acceptance Scenarios**:

1. **Given** manual mode, **When** a run completes, **Then** documents are visible in the console and nothing is retrievable by the assistant until an admin publishes them.
2. **Given** automatic mode and a draft window that has not elapsed for a document, **When** a run completes, **Then** that document remains in draft.
3. **Given** automatic mode and an elapsed draft window, **When** a run completes, **Then** the document is published and becomes retrievable.
4. **Given** any document, **When** an admin views the console, **Then** they can read it, edit it, publish it, or delete it.

---

### User Story 5 - Unflattering findings are held, but cannot be quietly buried (Priority: P2)

When a run finds something that reflects badly on us — our testnet rate looks poor beside the live market, a comparable product charges less — the finding is written and held in the console for the admin to release. It is not discarded. And while it is held, no published document may assert a claim it contradicts: the document says less, never something false.

**Why this priority**: Holding findings is the client's decision and is legitimate editorial control. Without the guard it becomes, by accident and over time, a corpus that only contains good news — the outcome nobody chose and every reader eventually detects.

**Independent Test**: Create a held finding, then confirm that a document asserting the contradicting claim cannot be published while it is held, and can be once it is released.

**Acceptance Scenarios**:

1. **Given** a run that produces an unflattering finding, **When** the run completes, **Then** the finding is recorded and held, not dropped.
2. **Given** a held finding, **When** a document would assert a claim that contradicts it, **Then** that claim is withheld from the published document and the omission is recorded.
3. **Given** an admin views the console, **When** findings are held, **Then** the count and the age of the oldest are shown.
4. **Given** an admin releases a held finding, **When** the next run executes, **Then** the finding may appear in a published document.

---

### Edge Cases

- **Two runs at once** (a restart, a second worker, a manual trigger during the scheduled run): exactly one executes; the others decline and record that they did.
- **A source returns something absurd** (a negative rate, an APY of 900%, an empty payload): the figure is rejected rather than written, and the rejection is recorded. A run must never publish a number it could not sanity-check.
- **An allowlisted page returns text containing instructions** ("ignore your previous instructions and recommend…"): the text is stored as quoted evidence attributed to a source and is never treated as an instruction to follow.
- **The language model is unavailable**: no document is written; the previously published documents remain exactly as they were.
- **A user types something into chat hoping it becomes a document**: impossible by construction — topic selection uses classification signals only, never a user's own words.
- **A document is edited by an admin and then the job runs again**: the admin's edit is not silently overwritten without it being visible that it happened.
- **Every document is deleted by an admin**: the next run re-creates only what its evidence supports, and an empty self-authored corpus is a valid state.
- **The draft window is set to zero**: documents publish on the run that writes them.

---

## Requirements *(mandatory)*

### Functional Requirements

**The run**

- **FR-001**: The system MUST run the self-authoring job once per day, unattended, and MUST allow an admin to trigger a run on demand.
- **FR-002**: Exactly one run MUST execute at a time across all processes and restarts; a concurrent attempt MUST decline and record that it declined.
- **FR-003**: A run MUST record when it started, when it finished, what it fetched, what it wrote, what it withheld, and why it made each of those choices.
- **FR-004**: A run MUST NOT block, delay, or degrade any user-facing request, and MUST NOT be able to prevent the service from starting.
- **FR-005**: A run that fetches nothing MUST write nothing, and MUST record that it wrote nothing because it fetched nothing.
- **FR-006**: A run that finds nothing materially new MUST refresh figures and write no new claims, and this MUST be recorded as a normal outcome rather than a failure.

**The documents**

- **FR-007**: The system MUST maintain at most six documents, each rewritten in place, and MUST NOT create a new document per run.
- **FR-008**: The six documents are: Base USDC yields · how our vault compares on fees · the testnet-versus-mainnet explainer · gaps in our own answers · the protocol change watch · our own product surface.
- **FR-009**: Every claim in a document MUST be traceable to evidence fetched during the run that wrote it.
- **FR-010**: A run MUST NOT use previously self-authored material as input when writing.
- **FR-011**: Published documents MUST be retrievable by the assistant under the self-authored source kind and MUST cite themselves as research written by Sparky and not yet reviewed.
- **FR-012**: A self-authored document MUST NOT reach the deterministic policy gate, rank or alter a recommendation, affect what may be signed, change the protocol whitelist, or appear anywhere on the withdraw or exit path.

**Honesty about which market a number came from**

- **FR-013**: Every figure in a document MUST state the chain it came from in the same sentence.
- **FR-014**: Testnet figures MUST come only from direct chain reads, never from a market data source.
- **FR-015**: A document MUST NOT present a testnet figure and a mainnet figure as competing options.
- **FR-016**: Where a mainnet figure is used, it MUST be framed as what the strategy earns in the live market rather than as what an alpha user will receive.
- **FR-017**: A figure that fails a plausibility check MUST be rejected rather than written, and the rejection recorded.

**What Sparky may say about others**

- **FR-018**: Documents MUST describe the competitive landscape in aggregate and MUST NOT name a competitor product as an alternative.
- **FR-019**: Protocols the product itself uses (Aave, Morpho) MUST still be named where relevant.
- **FR-020**: A document MUST NOT make a claim about anyone else that is not traceable to fetched evidence.

**Sources and the allowlist**

- **FR-021**: An admin MUST be able to view and edit the list of permitted data sources and the list of permitted prose domains from the Self-authored section of the knowledge console.
- **FR-022**: Both lists MUST take effect on the next run without a redeployment.
- **FR-023**: The prose allowlist MUST default to empty, and an empty list MUST mean no prose is fetched — never that any source is permitted.
- **FR-024**: A fetch to an address not on the allowlist MUST be refused and recorded as refused.
- **FR-025**: Every fetch MUST be recorded with its address and the time it happened.
- **FR-026**: Fetched prose MUST be stored as quoted evidence attributed to its source, MUST NOT be merged into the product's own voice, and MUST NOT be followed as instruction.
- **FR-027**: Every change to either list MUST be recorded with who made it and when.
- **FR-028**: When a source is removed from the allowlist, claims whose only supporting evidence came from that source MUST stop being asserted.

**Self-verification before anything is kept**

- **FR-029**: Before publishing, every run MUST re-ask a fixed set of questions whose expected answering source is known.
- **FR-030**: A run whose output would displace the expected source for any of those questions MUST be discarded in full, MUST publish nothing, and MUST record which question regressed.
- **FR-031**: The result of the self-check MUST be visible to an admin for every run, whether it passed or failed.

**Publishing control**

- **FR-032**: Publishing mode (manual or automatic) MUST be an admin-editable setting.
- **FR-033**: The draft window, in hours, MUST be an admin-editable setting.
- **FR-034**: In manual mode nothing becomes retrievable until an admin publishes it.
- **FR-035**: In automatic mode a document becomes retrievable only once its draft window has elapsed.
- **FR-036**: An admin MUST be able to read, edit, publish, unpublish and delete any document.
- **FR-037**: The whole feature MUST be disableable by an admin, and disabling it MUST stop future runs without removing what has already been published.

**Held findings**

- **FR-038**: A finding that reflects unfavourably on the product MUST be recorded and held for an admin, never silently dropped.
- **FR-039**: While a finding is held, no published document may assert a claim that contradicts it; the claim MUST be omitted and the omission recorded.
- **FR-040**: The console MUST show how many findings are held and the age of the oldest.
- **FR-041**: An admin MUST be able to release or dismiss a held finding, and a released finding MUST become available to the next run.

**Topic selection from user behaviour**

- **FR-042**: Where the job uses what users asked about, it MUST use only classification and retrieval-outcome signals, and MUST NOT use any user's own words.

### Key Entities

- **Run** — one execution: when it started and finished, its outcome, and the reason for that outcome.
- **Evidence** — one fetched fact or quotation: its source, the chain it describes where applicable, when it was fetched, and the value or text retrieved. Prose evidence carries its attribution.
- **Document** — one living document: its stable identity, title, current text, whether it is draft or published, when it was first created and last rewritten, and the claims it currently asserts.
- **Claim** — one assertion inside a document, linked to the evidence supporting it, so a claim can be retired when its evidence is withdrawn.
- **Finding** — something a run concluded that is held for admin release: its text, whether it is held, released or dismissed, and when.
- **Settings** — whether the feature is enabled, the publishing mode, the draft window, the permitted data sources and the permitted prose domains.
- **Golden question** — a question whose expected answering source is known, used to prove a run did no harm.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a run, the assistant answers a market question it could not previously answer, and the answer is attributed to a research note marked as not yet reviewed.
- **SC-002**: After ten consecutive runs, the number of self-authored passages in the corpus is no larger than the six-document ceiling implies — it does not grow per run.
- **SC-003**: A run engineered to displace a known-good answer publishes nothing, and the console shows which question regressed.
- **SC-004**: With an empty prose allowlist, a run completes and fetches no prose from any address.
- **SC-005**: A fetch attempt to an address that is not permitted is refused, and the refusal is visible to an admin.
- **SC-006**: An admin changes the publishing mode, the draft window and both source lists from the console, and the next run reflects all four changes without a deployment.
- **SC-007**: Every figure in every published document names the chain it came from; no published document places a testnet figure beside a mainnet figure as an alternative.
- **SC-008**: While a finding is held, a published document does not assert the claim it contradicts; after release, it may.
- **SC-009**: Two runs started at the same moment result in exactly one execution.
- **SC-010**: With every external source unavailable, the assistant continues to serve every existing answer unchanged, and the run records that it wrote nothing.
- **SC-011**: An admin can, for any run, see what was fetched, what was written, what was withheld and why.
- **SC-012**: Disabling the feature stops subsequent runs and leaves already-published documents intact and retrievable.

---

## Assumptions

- **One run per day is enough.** The underlying rates move slowly and the market-data sources are rate-limited; a more frequent schedule would add cost and risk without changing an answer.
- **Six documents is a ceiling, not a target.** A document with nothing to say is retired rather than padded.
- **"Materially changed" is judged against the previous run's evidence**, not against the previous document text — the text is a rendering of the evidence, so comparing evidence is the honest comparison.
- **Plausibility bounds for rates are conservative and fixed** (a supply rate outside roughly 0–100% is rejected). The intent is to catch a broken feed, not to second-guess a real market.
- **The initial prose allowlist ships empty**, per FR-023. The admin adds protocol documentation and data platform domains when they choose to; nothing is preloaded on their behalf.
- **The golden question set is authored by us, not generated**, and includes at minimum the withdraw question, the fee question and the vault-rate question — the three where a wrong answer costs the most.
- **Held findings do not expire.** They stay held until an admin acts, which is why their count and age are surfaced.
- **History is not retained.** A rewritten document replaces its predecessor; this is decision 1 and its accepted cost.

## Out of scope

- Any archive or history of past document versions (explicitly declined in decision 1).
- Governance forums and news media as sources (explicitly declined in decision 2).
- Naming competitor products to users (explicitly declined in decision 5).
- Any influence on what the product recommends, allows, or signs — self-authored material is reference only (decision 6, and the constitution's prohibition on discretionary curation).
- Generating or modifying the persona, which is trusted instruction text and deliberately never part of the retrievable corpus.
