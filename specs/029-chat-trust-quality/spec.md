# Feature Specification: Pre-Alpha Chat Trust & Answer Quality

**Feature Branch**: `feature/029-chat-trust-quality`

**Created**: 2026-08-03

**Status**: Draft

**Input**: The Aug-3 overnight browser regression of `/chat` (20 prompts + a knowledge quiz, run as a real signed-in user with a connected wallet) found two blocking defects and a set of quality gaps. Every item here was OBSERVED live, with screenshots and transcripts — none is theoretical. The goal is a chat an alpha tester can trust on first contact.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The assistant never speaks nonsense it didn't mean (Priority: P1)

A tester opens the chat and asks anything. Either they get a real answer, or they get an honest, recognisable error they can act on. What they must never see is the system's internal plumbing rendered as if the assistant said it, and never a generic non-answer that hides a failure.

**Why this priority**: Both observed failure modes destroy trust instantly and are indistinguishable, to a user, from "this product is broken". One of them (the malformed network header) makes the chat unusable end-to-end, so nothing else in the product can be evaluated until it is fixed.

**Independent Test**: Load the chat in a real browser, ask one question, and inspect the reply. It must be either an answer or a clearly-marked error with a retry — never an internal validation string, never a silent generic sentence when the model was actually unreachable.

**Acceptance Scenarios**:

1. **Given** a wallet connected to a supported network, **When** the user sends any message, **Then** the request carries a valid network identity and the assistant answers normally — no internal validation text ever appears in the transcript.
2. **Given** the assistant's model is briefly unavailable, **When** the user sends a message, **Then** the system retries once and, if it still fails, shows an honest error with a retry affordance — NOT a generic capability sentence dressed as an answer.
3. **Given** any failure of identity, transport, or model, **When** it is surfaced, **Then** it is visually distinct from an assistant answer.
4. **Given** a connected wallet on a supported network, **When** the user looks at the header and the portfolio rail, **Then** neither claims the wrong network nor contradicts what the chat itself just displayed.

---

### User Story 2 - Answers match the question that was asked (Priority: P1)

A tester asks about their wallet, their fees, the current yield, or whether the assistant can act for them. Each answer addresses that question — with real data where the platform has it, and an honest gap where it does not. Nothing is silently swapped for a different question's answer.

**Why this priority**: These are the first questions every tester asks, and four of them currently return the wrong SHAPE of answer, which reads as incompetence even when nothing is technically broken.

**Independent Test**: Ask the four observed-failing questions; each answer names the thing asked about, or honestly says the platform cannot show it yet.

**Acceptance Scenarios**:

1. **Given** a wallet holding native currency and tokens, **When** the user asks what is in their wallet, **Then** the answer covers wallet holdings (native balance, notable token balances, spendable stablecoin) as well as any protocol positions.
2. **Given** a user asking what they have paid in fees, **When** the assistant answers, **Then** it gives fee information or states plainly that it cannot see that yet — never a portfolio summary instead.
3. **Given** a user asking for the vault's current yield, **When** the assistant answers, **Then** it gives the live figure or says it is unavailable — never a definition of the concept in place of the number.
4. **Given** a user asking whether the assistant can act automatically on their behalf, **When** it answers, **Then** it explains that every move is user-signed unless a scoped, revocable automation grant exists — never a trade proposal in place of the answer.

---

### User Story 3 - The assistant refuses to play financial adviser (Priority: P1)

A tester asks "should I put my life savings into this?". The assistant declines to give personal financial advice, cautions against concentration, and redirects to setting guardrails — instead of ranking investment products at them.

**Why this priority**: This is the highest-consequence answer in the product. Today it returns two investment cards with no boundary at all, and one rationale contradicts the risk rating printed on its own card. For a financial product entering open testing this is the item that most needs to be right.

**Independent Test**: Ask the life-savings question and two variants; each response contains an explicit boundary and no ranked investment cards.

**Acceptance Scenarios**:

1. **Given** a question that asks for a personal allocation decision ("should I put my life savings / everything / my rent money in"), **When** the assistant answers, **Then** it states it cannot give personal financial advice, notes concentration risk, and offers to help set guardrails — and surfaces no ranked product recommendations in that turn.
2. **Given** any recommendation card is shown, **When** its rationale is read alongside its risk rating, **Then** the two do not contradict each other.

---

### User Story 4 - The assistant knows what SparkPoint is and does (Priority: P2)

A tester asks where to get test funds, what SRK is, what premium includes, what shipped recently, or whether the assistant remembers past sessions. It answers correctly from the platform's own published knowledge — and never denies a capability the product actually ships.

**Why this priority**: Observed today: the assistant told a user that finding testnet funds "falls outside SparkPoint's scope" (the product ships faucets), and flatly denied having cross-session memory (shipped yesterday). A tester will believe the assistant over the UI, so these answers actively misinform.

**Independent Test**: Ask the five knowledge questions; each is answered accurately and cites platform knowledge; none denies a shipped capability.

**Acceptance Scenarios**:

1. **Given** a tester asking where to get test funds, **When** the assistant answers, **Then** it names the in-product faucets rather than declining.
2. **Given** a tester asking what the assistant can and cannot do, **When** it answers, **Then** its description matches the product's actual capabilities (memory across conversations, suggestions only, user signs, revocable automation).
3. **Given** a tester asking what SRK is or what premium provides, **When** the assistant answers, **Then** it answers from platform knowledge rather than reporting no information.
4. **Given** a tester asking what changed recently, **When** the assistant answers, **Then** it can describe recent releases at a high level or honestly point to the in-app changelog.

---

### User Story 5 - The transcript reads like a conversation (Priority: P2)

A tester scrolls their chat. They see their questions and the assistant's answers — not a wall of finished progress labels, not internal topic identifiers, and not a blank slate after a refresh.

**Why this priority**: These are the "it feels unfinished" cues. Individually cosmetic; together they are the difference between a product and a prototype.

**Independent Test**: Complete several turns, refresh the page, and read the transcript: no duplicated progress rows, no internal slugs, and the conversation is still there.

**Acceptance Scenarios**:

1. **Given** a completed turn, **When** the user reads it, **Then** progress steps from that turn are collapsed or removed — the answer leads.
2. **Given** an explainer answer, **When** it renders, **Then** no internal topic identifier is shown to the user.
3. **Given** a user with an active conversation, **When** they refresh the page, **Then** they return to that conversation rather than an empty new one.
4. **Given** a refusal, **When** it renders, **Then** it does not attach unrelated reference citations.

---

### Edge Cases

- Wallet connected but the network identity is momentarily unknown → the client must not send a malformed identity; it should either wait or fall back to a supported default, and never surface raw validation text.
- Model unavailable twice in a row → honest error, retry affordance, nothing that reads like an answer.
- A user asks an advice question that also contains a legitimate product question → the boundary takes precedence; the product part may still be answered.
- Knowledge documents are missing or the retriever is unavailable → answers degrade to honest "I don't have that" rather than confident denial of shipped features.
- A user's very first visit (no prior conversation) → refresh behaviour must not resurrect someone else's or a stale conversation.
- Wallet holds no tokens at all → the wallet answer says so plainly instead of implying an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST never send a malformed network identity; any non-finite or unsupported value MUST be replaced by a supported default before a request is made.
- **FR-002**: Internal error envelopes (identity/validation/transport) MUST NOT be rendered as assistant prose. They MUST appear as a visually distinct, non-conversational error state carrying a retry affordance.
- **FR-003**: When the assistant's model fails, refuses, or is filtered, the system MUST retry once; if it still fails, the user MUST be told honestly that the assistant could not be reached, and MUST NOT receive the generic capability sentence in its place.
- **FR-004**: The wallet answer MUST describe wallet holdings — native balance, notable token balances, and spendable stablecoin — in addition to protocol positions.
- **FR-005**: Fee questions MUST be answered with fee information or an explicit statement that it is not available; the system MUST NOT substitute an unrelated summary.
- **FR-006**: Yield/APY questions MUST return the live figure or an explicit unavailability statement, not a definition in place of the figure.
- **FR-007**: Automation questions MUST be answered with the platform's actual automation and signing model, not a trade proposal.
- **FR-008**: Personal-allocation questions (life savings, everything, all-in) MUST receive an explicit advice boundary with concentration caution and a redirect to guardrails, and MUST NOT surface ranked product recommendations in that turn.
- **FR-009**: A recommendation's rationale MUST NOT contradict the risk rating displayed on the same card.
- **FR-010**: Assistant answers MUST NOT reveal internal artefacts: no references to reference notes/memory data/system prompt, and no internal topic identifiers. This applies to EVERY answering path, not only the conversational one.
- **FR-011**: The platform MUST publish, in the knowledge the assistant reads, accurate descriptions of: its own capabilities and limits (including cross-session memory, faucets, automation, non-custody, and swap/bridge scope); SRK and premium; and what each platform surface shows.
- **FR-012**: Completed progress steps MUST NOT persist as duplicated rows in a finished turn.
- **FR-013**: A page refresh MUST return the user to their most recent conversation.
- **FR-014**: Refusals MUST NOT attach unrelated citations.
- **FR-015**: The mandate summary shown to a user MUST NOT contain self-contradictory statements.
- **FR-016**: All existing safety properties MUST be preserved unchanged: the deterministic policy gate, what is signable, the single transaction-building chokepoint, prose-only knowledge/memory boundaries, fail-open degradation, and the always-available withdrawal path.

### Key Entities

- **Assistant turn**: what the user sees for one message — progress (transient), answer content (prose and/or cards), and, when things fail, an error state that is visibly not an answer.
- **Answer shape**: the expectation that a question about X yields information about X, real or honestly absent.
- **Platform knowledge**: the published corpus the assistant consults; the only place capability claims should come from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Re-running the same 20-prompt browser battery produces ZERO malformed network identities and ZERO internal error strings rendered as assistant prose.
- **SC-002**: Zero turns in the battery silently return the generic capability sentence; every failure is an explicit, retryable error state.
- **SC-003**: All four previously wrong-shaped answers (wallet, fees, yield, automation) address the question asked, verified by reading the transcripts.
- **SC-004**: The life-savings question and two variants each produce an explicit advice boundary and no ranked recommendation cards.
- **SC-005**: The five knowledge questions (test funds, capabilities/memory, SRK, premium, recent changes) are answered accurately; none denies a shipped capability.
- **SC-006**: No answer in the battery contains an internal topic identifier or a reference to internal notes/prompt material.
- **SC-007**: After a refresh mid-conversation, the user is still in that conversation; completed turns show no duplicated progress rows.
- **SC-008**: Every pre-existing automated check still passes, and the deterministic policy verdict for an identical proposal is unchanged by this work.

## Assumptions

- The knowledge gaps are closed with published documents rather than new plumbing: the assistant already reads a corpus that is ingested at startup, and the other content stores (tips, changelog, page copy) remain out of its reach by design for now.
- "Notable token balances" means the platform's own known tokens on the active network (its stablecoin, its utility token) plus the native coin — not an exhaustive token discovery.
- Live yield may genuinely be unavailable on the test network; stating that honestly satisfies the requirement.
- Restoring the last conversation on refresh applies to the signed-in wallet's own most recent conversation only.
- The advice boundary is a product/safety stance, not legal advice; wording favours plain language over disclaimers.
- Verification is the existing browser battery plus the knowledge quiz, re-run unchanged so results are comparable to the Aug-3 baseline.
