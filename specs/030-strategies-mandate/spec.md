# Feature Specification: Strategies & a mandate that mean something

**Feature Branch**: `feature/030-strategies-mandate`
**Created**: 2026-08-03
**Status**: Draft
**Input**: The Aug-3 review of `/strategies` and the mandate (artifact `9f7dd404`), with four client
decisions locked on the same day. Every defect cited below was reproduced against the live alpha
deployment using the test wallet — none is theoretical.

## Why this feature exists

Two surfaces the product leans on are, from a user's seat, close to empty.

**The strategies screen ranks two options and tells the user almost nothing true about either.**
The risk rating on every card is a constant. The sentence about how a strategy fits the user's plan
is a constant — a wallet whose plan is growth-oriented is told "lower risk, steady yield". The rate
is a percentage with no indication of what it means in money, next to no baseline. Choosing an
option forgets which one was chosen. And because the two options are never actually differentiated
by anything the screen carries, the assistant invents a difference: the live rationale sells
"leveraging vault aggregation … rather than passive lending" for a strategy that *is* passive
lending.

*(Correction, recorded deliberately: an earlier draft of this spec claimed the screen could only
ever show ONE strategy because the second was silently dropped. That was wrong. It came from a
truncated read of the live API response plus reading one resolution path and missing the address-book
fallback in `resolve_target_ref`. The live API returns both strategies, approved, and has all along.
The defects below are the ones that are real, and each was re-verified against live alpha.)*

**The plan a user sets is collected in detail and then read by almost nothing.** Of six things the
mandate captures, one genuinely functions. The rest are stored, displayed, and consulted by no
decision the product makes. The gap became acute when the assistant started telling people to
"set a mandate — how much you're willing to put at risk", because a mandate cannot express that. It
has no notion of an amount at all.

The through-line: both screens *look* finished and *behave* as though the user's input matters. That
is a worse failure than an obviously unfinished screen, because it spends trust rather than
deferring it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A real choice between real options (Priority: P1)

A user opens the strategies screen wanting to know where to put their money. They see more than one
option, understand what separates them, and can tell which suits the plan they set.

**Why this priority**: The screen's entire purpose is comparison. Without a second option nothing
else on it — ranking, "why this?", fit — can be honest. Every other story reads better once this
lands, and this one is independently shippable.

**Independent Test**: With a funded wallet, open the strategies screen and confirm two distinct
options appear, each with its own risk rating and a stated tradeoff, and that choosing either one
carries through to a review step that already knows which was chosen and for how much.

**Acceptance Scenarios**:

1. **Given** a signed-in wallet on a network where both options are available, **When** the user
   opens the strategies screen, **Then** both options are shown, each ranked, each with the safety
   check applied identically, and each stating what it costs and who manages it — the last of
   which the screen could not say at all before.
2. **Given** the two options, **When** the user reads either card, **Then** the card states what the
   money would earn in a year on *their own balance*, alongside the alternative of leaving it idle.
3. **Given** a user who chooses an option, **When** they proceed to review it, **Then** the review
   step already knows which strategy and what amount, and the resulting activity is later
   attributable to the recommendation they acted on.
4. **Given** a network where only one option is deployed, **When** the user opens the screen,
   **Then** the screen shows what exists and says plainly why there is only one — never a phantom
   ranking.
5. **Given** rates on a test network are near zero, **When** any figure is shown, **Then** the screen
   states that these are test-network rates and not indicative of real ones.

---

### User Story 2 - The screen tells the truth about my plan (Priority: P1)

A user whose plan is growth-oriented is not told that a conservative product "fits your plan: lower
risk". What the screen says about fit, and the risk rating it shows, both follow from the actual
strategy and the actual plan.

**Why this priority**: This is a correctness defect on the same screen, visible in the same glance,
and cheap once Story 1 exists. Shipping Story 1 without it would put two cards on screen carrying
the same wrong risk badge.

**Independent Test**: Set a growth plan, open the screen, and confirm neither the risk badge nor the
fit sentence claims the user's plan is conservative; set a conservative plan and confirm the wording
changes accordingly.

**Acceptance Scenarios**:

1. **Given** any strategy, **When** its card renders, **Then** the risk rating shown is that
   strategy's own rating, not a constant.
2. **Given** a user's saved plan, **When** the fit line renders, **Then** it is derived from that
   plan and never contradicts it.
3. **Given** a user holding only the most conservative product while their plan permits more risk,
   **When** they view their position, **Then** the product can say so — the plan comparison is not
   limited to flagging excess risk only.
4. **Given** any explanation of a strategy, **When** it is displayed, **Then** it does not describe
   the strategy as pursuing higher risk or returns than it actually does.

---

### User Story 3 - A plan I can state, and change (Priority: P1)

A user can say how much they are willing to put at risk, what they are saving for and by when, what
they are comfortable holding, and what they intend to add over time — and can change any one of
those later without repeating the rest.

**Why this priority**: The assistant already directs users here; the destination has to exist. It is
also the precondition for Story 4.

**Independent Test**: Complete the plan flow supplying all four new answers, confirm they persist and
are shown back accurately, then change exactly one from settings without being asked the others
again.

**Acceptance Scenarios**:

1. **Given** a user setting a plan, **When** they are asked what they are willing to put at risk,
   **Then** they can express it either as an amount or as a share of their wallet, and it is stored.
2. **Given** a user whose goal is to reach a target, **When** they choose it, **Then** they are asked
   for the amount and the date, and a goal is never stored without them.
3. **Given** a saved plan, **When** the user opens settings, **Then** every field can be changed
   individually and saved without re-answering unrelated questions.
4. **Given** a stated intention to add money regularly, **When** it is saved, **Then** it is recorded
   and used only for projection and reminders — it never causes a transfer, and the product never
   implies that it will.
5. **Given** a user asks the assistant how much they should commit, **When** it answers, **Then** the
   limit it invites them to set is one the plan can actually hold.
6. **Given** any saved plan, **When** its summary is displayed anywhere, **Then** the summary does
   not contradict itself, including for plans saved before this feature.

---

### User Story 4 - Progress toward what I'm actually saving for (Priority: P2)

A user who set a target and a date can see how far along they are, and whether they are on pace.

**Why this priority**: The strongest argument for asking the goal question at all — but it cannot
exist until the target is captured, so it follows Story 3.

**Independent Test**: With a target and date saved and a real position held, confirm progress is
shown as a share of the target with the date, and that it is derived from real balances rather than
an estimate.

**Acceptance Scenarios**:

1. **Given** a target amount and date and a real balance, **When** the user views their progress,
   **Then** it states how far along they are and by when.
2. **Given** a target that cannot be reached at the current rate and contribution intent, **When**
   progress is shown, **Then** the shortfall is stated plainly rather than implied.
3. **Given** no target has been set, **When** the user views the same surface, **Then** they are
   invited to set one rather than shown a fabricated or empty figure.
4. **Given** a projection is shown, **When** it is displayed, **Then** it is labelled as a projection
   based on current rates, never as a promise.

---

### Edge Cases

- A network where only one strategy is deployed, or none.
- A user with no balance at all: earnings figures must not divide by zero or display a fabricated
  amount, and the do-nothing baseline is still meaningful.
- A rate feed that is unavailable: figures degrade to an honest "unavailable", never to zero or to a
  stale number presented as live.
- A plan whose stated exposure limit is below the amount a strategy would suggest.
- A plan saved before this feature, missing every new field.
- A target date already in the past, or a target already exceeded.
- An exposure limit expressed as a percentage when the wallet balance is unknown.
- A user who never sets a plan at all — every surface must remain usable.
- Two strategies whose displayed figures are identical: the ranking must still be explainable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The strategies surface MUST present every strategy that is permitted and available on
  the current network, and MUST state what distinguishes them.
- **FR-002**: Each presented strategy MUST pass the same deterministic safety evaluation as any
  other, and MUST be actionable only when that evaluation approves it.
- **FR-003**: Each strategy MUST state what it costs the user and who manages the position, so the
  tradeoff between a managed, fee-bearing option and a self-managed, fee-free one is explicit.
- **FR-004**: Each strategy MUST state the projected annual earnings on the user's own balance
  alongside the outcome of leaving the money idle.
- **FR-005**: Where displayed rates come from a test network, the surface MUST say so and state that
  they are not indicative of real rates.
- **FR-006**: The risk rating displayed for a strategy MUST be that strategy's own rating.
- **FR-007**: Any statement about how a strategy fits the user MUST be derived from that user's saved
  plan, and MUST NOT contradict it.
- **FR-008**: No explanation of a strategy may describe it as pursuing more risk or return than it
  actually does.
- **FR-009**: Choosing a strategy MUST carry both the chosen strategy and the amount into the review
  step, and the resulting activity MUST remain attributable to the recommendation acted upon.
- **FR-010**: The plan MUST be able to record a maximum the user is willing to put at risk, expressed
  as an amount or as a share of their wallet.
- **FR-011**: The plan MUST be able to record a goal target amount and target date, and a
  target-seeking goal MUST NOT be storable without them.
- **FR-012**: The plan MUST be able to record which assets or protocols the user is comfortable with.
- **FR-013**: The plan MUST be able to record an intended contribution rhythm, used only for
  projection and reminders. Recording it MUST NOT move funds, MUST NOT create standing authority, and
  MUST NOT be described to the user as automatic.
- **FR-014**: Every plan field MUST be individually editable without re-answering unrelated
  questions.
- **FR-015**: The plan's stated risk level MUST be expressed on a single scale everywhere it is
  shown.
- **FR-016**: A plan summary MUST NOT contain self-contradictory statements, including for plans
  saved before this feature.
- **FR-017**: The comparison between a user's holdings and their plan MUST be able to express both
  exceeding the plan and falling short of it.
- **FR-018**: Where a target and date exist, the product MUST show progress toward them derived from
  real balances, labelled as a projection based on current rates.
- **FR-019**: Where no target exists, the product MUST invite the user to set one rather than display
  an empty or fabricated figure.
- **FR-020**: All existing safety properties MUST be preserved unchanged: the deterministic safety
  evaluation, what is actionable, the single transaction-building chokepoint, the always-available
  withdrawal path, and the rule that a plan may only narrow what is permitted and never widen it.
- **FR-021**: A plan missing any new field MUST continue to work everywhere, degrading to the
  behaviour that existed before this feature rather than to an error.

### Key Entities *(include if feature involves data)*

- **Plan (mandate)**: the user's stated intent. Gains an exposure limit, a goal target with a date, an
  asset/protocol comfort list, and a contribution rhythm — alongside the existing risk level,
  slippage tolerance, horizon and drawdown tolerance. Advisory throughout: it constrains what may be
  proposed and never authorises anything.
- **Strategy**: one permitted way to put money to work, carrying its own risk rating, cost structure,
  and management responsibility.
- **Goal progress**: the relationship between a target, a date, a current balance, and a projection —
  derived, never stored as a claim.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user on a network with two permitted strategies sees two, each independently
  evaluated and each stating its cost and who manages it.
- **SC-002**: For any strategy shown, the risk rating and the fit statement both change when the
  user's saved plan changes, and neither ever asserts a plan the user did not set.
- **SC-003**: A user can tell, without leaving the strategies screen, what a strategy would earn them
  in a year and what doing nothing would earn — in money, not only in percent.
- **SC-004**: An action begun from the strategies screen arrives at the review step with the strategy
  and amount already known, and appears afterwards in the outcome record attributed to the
  recommendation it came from.
- **SC-005**: A user can state a maximum they are willing to risk, a target with a date, what they
  are comfortable holding, and an intended contribution rhythm — and can change any one of them
  afterwards without re-answering the others.
- **SC-006**: The assistant's invitation to set a limit refers to something the plan can hold, and a
  user who follows that invitation can complete it.
- **SC-007**: No plan summary anywhere in the product contradicts itself, and the risk level reads
  identically across the plan flow, settings, and every card.
- **SC-008**: A user with a target and a date sees their progress toward it, expressed as a share of
  the target and a date, with any shortfall stated plainly.
- **SC-009**: A user whose holdings sit below the risk level their plan permits is told so; a user
  above it is still told so.
- **SC-010**: Every existing safety behaviour verified before this feature still holds, and the
  previous release's conversational quality checks still pass unchanged.

## Assumptions

- The second strategy to surface is a direct supply to the same lending market the vault already
  uses. It is already permitted by the safety rules and already configured; nothing new is being
  added to what the product is allowed to touch. This is explicitly a presentation and resolution
  change, not an expansion of scope, and it does not constitute the product selecting or curating a
  market.
- Listing a fee-free alternative alongside the fee-bearing vault is a deliberate, client-approved
  business decision. The user could always reach it directly; stating it is consistent with the
  product's stated character.
- The exposure limit constrains what may be *proposed* to the user. It is not a second on-chain cap
  and does not alter the existing deterministic limits, which continue to apply independently.
- A contribution rhythm is an intent only. No recurring transfer capability exists or is implied, and
  none is created here.
- Goal progress is computed from balances the product already reads; no new source of financial data
  is introduced.
- Plans saved before this feature will not have the new fields. They remain valid and usable, and the
  product treats their absence as "not stated" rather than as zero.
- Where rates are unavailable, honest absence is preferred to any inferred figure — consistent with
  how the product already treats unavailable data.

## Out of Scope

- Any change to which protocols or markets the product may touch. The permitted set is fixed and is
  not chosen, curated, or extended by this feature.
- Automatic movement of funds, recurring deposits, rebalancing between strategies, or any standing
  authority. Contribution rhythm is a stated intention only.
- New strategy types, new networks, or any vault beyond those already deployed.
- Changes to the deterministic safety evaluation, to what is actionable, or to the transaction
  chokepoint.
