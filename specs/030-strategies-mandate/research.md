# Research — 030 strategies & mandate

Decisions taken before implementation, with what was rejected and why. Every "current behaviour"
claim was verified against the live alpha deployment or by reading the code path, not assumed.

## R1 — WITHDRAWN: "the second strategy is silently dropped"

**This decision was based on a false premise and has been withdrawn.** It claimed `AAVE_SUPPLY`
never resolved because `_build_chain_context` populates `resolved_targets` with the vault alone,
and that resolving the pool from config would restore a missing second card.

**What is actually true.** `resolve_target_ref` falls back to the static address book when a ref is
not overridden, and Base Sepolia's book carries `aavePool`. `AAVE_SUPPLY` has always resolved; the
live API returns both strategies, both approved, and did so before any change in this feature.

**How the error happened**, recorded so the same shape is easier to catch next time: the live API
response was read through `head -60`, which truncated the second item, and the resolution path was
read in `_build_chain_context` without following `resolve_target_ref` to its fallback. Two partial
reads agreeing with each other is not corroboration.

**What was done about it.** The `_build_chain_context` change is reverted. It was not merely
unnecessary — an env-sourced override would WIN over the address book, so the two could drift apart
silently, and the book is what the on-chain `PolicyModule` mirrors. The tests written for it now
assert the truth instead: both strategies build, the vault from the override map and the Aave pool
from the book, and a chain with no Aave deployment drops that candidate fail-closed.

## R2 — Per-strategy risk class, and the tautology it fixes

**Decision.** `_YIELD_STRATEGIES` carries each strategy's own `RiskProfile`; `build_action` accepts
it as a distinct parameter from the user's mandate profile and stamps it on the `Action`.

**Why this is the load-bearing change.** Today `build_action` is called with
`risk_profile=ctx.risk_profile` and assigns `risk_class=risk_profile`. Policy step 5 then evaluates
`RISK_PROFILE_RANK[action.risk_class] > RISK_PROFILE_RANK[ctx.mandate.max_risk_class]` — both sides
derived from the same value, so it is `X > X` and **can never reject**. The mandate's only real
authority has been unreachable on the recommendation path. It also means the UI has nothing truthful
to render a per-strategy badge from, which is why `recView.ts` hardcodes `risk: 1`.

**Both current strategies are classed `CONSERVATIVE`** — supplying USDC to Aave v3, directly or
through a vault that does exactly that. So every current verdict is unchanged, and the mechanism
becomes real for the first strategy that isn't. This is a tightening, never a widening: an action can
now be rejected where it previously could not, and no action can be approved that previously was not.

**Rejected.** Leaving the tautology and deriving the badge separately in the UI — that would put two
sources of truth for "how risky is this" one screen apart, which is how the current contradiction
arose. Also rejected: classing direct Aave supply as `MODERATE` to "differentiate" it. It is not
riskier; the vault adds a fee and management, not safety. Inventing a risk difference to justify a
ranking is the same failure as the "leveraging vault aggregation" rationale.

**Verification.** `policy-parity` CI plus a dedicated test asserting the verdict, reason codes and
check trace are byte-identical before and after for both strategies across all three mandate
profiles.

## R3 — What the tradeoff between the two strategies actually is

**Decision.** State it as cost and responsibility, not as risk or return.

- **SparkPoint vault** — managed for you; 10% of yield, profit only, above a high-water mark; 0% on
  principal, deposits and withdrawals.
- **Direct Aave supply** — no SparkPoint fee; you manage the position yourself.

**Why.** That is the true difference and the whole difference. Both supply the same asset to the same
market. Anything else the model might reach for ("higher returns", "aggregation") is invented.

**Consequence accepted by the client.** The fee-free option earns SparkPoint nothing. It was always
reachable directly; stating it is consistent with a product whose pitch is that you can verify
everything.

## R4 — Money, not percent

**Decision.** A pure `projection.ts` computes projected annual earnings from the user's own balance
and a net rate, in exact integer arithmetic, alongside the do-nothing baseline of zero.

**Why.** "0.4% net APY" on a $1,503 balance is about $6.01/yr. The percentage is not the answer to
the question the user opened the page with. Both figures shown together also make the fee's effect
legible without a separate explanation.

**Honesty rules.** No balance ⇒ show the rate and an explicit "on your balance: —" rather than $0.00,
which would read as "this earns nothing". No rate ⇒ no projection at all. Test-network rates carry an
explicit note that they are not indicative. Every projection is labelled a projection at current
rates, never a promise (Principle III).

**Rejected.** Compounding assumptions, multi-year projections, and any "if you also add $X/month"
figure on the strategies screen — that belongs to goal progress, where the contribution intent lives.

## R5 — Mandate fields: shape and semantics

**Decision.** Four additive, nullable fields (see `data-model.md`). Absence means *not stated*, never
zero.

**Why nullable matters.** Every existing mandate lacks all four. A zero exposure limit would silently
forbid every proposal for existing users; a zero target would render "0% of $0". `NULL` is the only
value that means "the user never said".

**Exposure limit is checked at PROPOSAL time, not on chain.** It bounds what the user is *shown* and
what the assistant may suggest. The deterministic on-chain caps are untouched and continue to apply
independently — this is an advisory preference, and putting it on the custody path would change the
safety model for a preference (Principle IV).

**Contribution rhythm is an intent.** It feeds projection and reminders only. FR-013 forbids any
copy implying automation, because the product holds no standing authority and creating one is out of
scope.

## R6 — One risk scale

**Decision.** The 1..5 tier is the user-facing scale; the three stored profiles remain the wire and
policy vocabulary; the mapping lives in exactly one place per side and the tier round-trips.

**Current state.** Onboarding shows 1..5 and writes a summary saying "5/5"; the server stores one of
three profiles; `mandate.ts` maps `growth → 4`. A user who chose 5 sees 5/5 in their summary and 4/5
in Settings.

**Rejected.** Storing the raw tier as the authority — the policy layer's `RiskProfile` is the safety
vocabulary and must stay canonical. Instead the chosen tier is persisted alongside the profile so the
display can be faithful without the gate ever reading it.

**Legacy repair.** Existing `summaryText` rows still read "High risk (5/5), capital-preservation-first."
029 fixed only new writes. The summary is derived at display time from the stored profile and tier, so
stale strings stop being authoritative rather than needing a data migration to be correct.

## R7 — Drift in both directions

**Decision.** `mandateDrift` returns `above_plan | on_plan | below_plan | unknown`.

**Why.** Today it is `realizedTier > targetTier`, so with one tier-1 strategy live it can only ever
say "on plan". The case it cannot express is the one that matters most right now: a growth-mandate
user sitting entirely in the most conservative product available. That is not a violation and must
never be alarming — it is an observation, and the copy has to make that difference obvious.

**Non-goal.** "Below plan" MUST NOT become a prompt to take more risk. It states a fact and offers
the mandate as the place to change it; the advice boundary shipped in 029 continues to apply.

## R8 — Goal progress

**Decision.** A pure `progress.ts` derives share-of-target, time remaining, and an on-pace judgement
from the target, the date, the current balance, and the stated contribution rhythm.

**Honesty rules.** A target already met reads as met. A date in the past reads as passed, not
negative. Unreachable at the current rate states the shortfall plainly rather than implying it. No
target ⇒ an invitation to set one, never a fabricated figure (FR-019).

**Rejected.** Monte-Carlo or probabilistic projections — the product does not have the data to make
them honest, and a confidence band would read as a promise.

## R9 — The rationale guard gap

**Decision.** Widen 029's `_AGGRESSIVE_RE` to `leverag(?:e|ed|ing)` and add the observed phrasings.

**Why.** The live rationale reads "leveraging vault aggregation to seek higher returns than passive
lending" for a strategy that *is* passive lending. `\bleverage[d]?\b` cannot match "leveraging"
because there is no word boundary before "ing". The deeper cause was R2/R3 — the model was asked to
differentiate two things when only one existed — but the guard should still have caught it.
