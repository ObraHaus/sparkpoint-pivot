# Implementation Plan: Strategies & a mandate that mean something

**Branch**: `feature/030-strategies-mandate` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/030-strategies-mandate/spec.md`

## Summary

> **CORRECTION (recorded, not quietly edited).** The first draft of this plan led with
> "`/strategies` shows one card because `_build_chain_context` resolves only the vault". **That was
> wrong.** `resolve_target_ref` falls back to the static address book, which carries `aavePool` on
> Base Sepolia, so `AAVE_SUPPLY` has always resolved. The live API returns both strategies,
> approved. The error came from a truncated (`head -60`) read of the API response combined with
> reading one resolution path and missing the fallback. The `_build_chain_context` change written
> against that premise has been REVERTED — overriding a book address from env would let the two
> diverge silently, and the book is what the on-chain PolicyModule mirrors.

Two defects sit under this feature, plus a screen full of constants.

1. **The displayed risk and fit are constants** in `lib/agent/recView.ts` (`risk: 1`, a hardcoded
   `fit` string) and in the chat card (`<RiskChip tier={1} />`). Neither reads the strategy or the
   mandate, so the page's whole promise — *ranked against your plan* — is delivered by a sentence
   that never reads the plan.

2. **The mandate's one real power is unreachable.** `build_action` stamps
   `risk_class=risk_profile` — the *user's own* mandate profile — onto every candidate, and
   `evaluate.py` step 5 then compares `action.risk_class > mandate.max_risk_class`. Both sides come
   from the same value, so the comparison is `X > X` and **can never reject**. The mandate check has
   been a no-op on the recommendation path since it was written. Giving each strategy its own
   intrinsic risk class is what makes both the badge (FR-006) and the gate real.

Both live strategies are genuinely conservative USDC supply, so classing them honestly leaves every
current verdict byte-identical while turning a tautology into a working check — which is exactly the
property `policy-parity` CI will assert.

The mandate work is additive: four new optional fields, one editable settings surface, one derived
progress view. Nothing existing is removed, and absence is always "not stated" rather than zero.

## Technical Context

**Language/Version**: Python 3.12 (agent), TypeScript 5 / Next.js 16 (web)
**Primary Dependencies**: FastAPI, asyncpg, yoyo migrations; React 19, wagmi, TanStack Query
**Storage**: PostgreSQL (dev instance is **SQL_ASCII** — every jsonb write MUST use
`json.dumps(..., ensure_ascii=False)`)
**Testing**: pytest + ruff + strict mypy (agent); `node --test` with `--experimental-strip-types`,
`tsc`, `typecheck:test`, eslint (web)
**Target Platform**: Coolify (develop -> alpha.sparkpoint.io), Base Sepolia 84532 + Robinhood 46630
**Project Type**: web (Next.js front end + FastAPI agent + Foundry contracts)
**Performance Goals**: `/recommendations` and `/strategies` stay within their current budget; the
extra target resolution adds no network call (the address is already in config)
**Constraints**: no change to `policy.evaluate`'s decision semantics, to signability, or to the
`/build-tx` chokepoint; the mandate may only narrow; the withdraw path is never gated or slowed;
every new read fails open with a once-per-process warning
**Scale/Scope**: two strategies today; the design must not assume two

### Where the work lands

| Area | Files |
|---|---|
| Per-strategy risk class | `services/agent/src/sparkpoint_agent/agents/recommender.py` (`build_action` takes the strategy's own class; `_YIELD_STRATEGIES` carries it) |
| Strategy metadata on the wire | `services/agent/src/sparkpoint_agent/api/recommendations.py` + `coordinator/chat_blocks.py` (`riskTier`, `feeStance`, `managedBy`) |
| Rationale guard | `services/agent/src/sparkpoint_agent/agents/recommender.py` (`_AGGRESSIVE_RE` — `leverag(e\|ing\|ed)`) |
| Mandate schema | new migration `0033`; `services/agent/src/sparkpoint_agent/api/mandate.py`; `db/mandates.py` |
| Card truth | `apps/web/src/lib/agent/recView.ts` (risk + fit derived), `components/screens/chat/live-blocks.tsx` |
| Money framing | new leaf `apps/web/src/lib/strategy/projection.ts` |
| Confirm link | `apps/web/src/app/(app)/strategies/page.tsx` -> `/confirm/deposit?assets=...&rec=...` |
| Plan editing | `apps/web/src/app/(app)/settings/page.tsx` (`MandateTab`) |
| One risk scale | `apps/web/src/lib/agent/mandate.ts`, `lib/agent/mandateDraft.ts`, `app/onboarding/page.tsx` |
| Drift both ways | `apps/web/src/lib/agent/mandate.ts` (`mandateDrift`) |
| Goal progress | new leaf `apps/web/src/lib/goal/progress.ts` + a portfolio surface |

## Constitution Check

*Checked against `.specify/memory/constitution.md` v3.0.0 before design and again after.*

| Principle | Assessment |
|---|---|
| **I — Non-custodial by construction** | No custody surface changes. No new contract, no new approval, no new authority. Contribution rhythm is stored text used for projection; FR-013 forbids implying automation. **PASS** |
| **II — AI proposes, deterministic policy + user disposes** | The second candidate passes the identical `policy.evaluate`. The risk-class change *strengthens* step 5 (from a tautology to a live check) and never widens what is permitted. Ranking and rationale remain model-authored prose over a code-authored candidate set. **PASS** |
| **III — Provable, not promised** | Every figure is derived from a real balance or a real rate; unavailable rates degrade to an honest absence. Projections are labelled projections (FR-018). **PASS** |
| **IV — Bounded blast radius** | New fields are advisory and optional. The exposure limit constrains *proposals* only; on-chain caps are untouched and continue to apply independently. **PASS** |
| **V — Conservative, transparent launch** | Surfacing an already-permitted strategy, with its cost stated, is the transparent option. **PASS** |
| **VII — Simplicity & YAGNI, no discretionary curation** | The permitted set is unchanged: this resolves an address the allowlist already names. SparkPoint selects, curates and allocates nothing. No meta-vault, no routing, no rebalancing. **PASS — and this is the boundary to keep re-checking during implementation.** |

**Gate result: PASS, no violations, no Complexity Tracking entries required.**

The one item worth an explicit reviewer note: step 5 of the policy gate becomes capable of rejecting
where it previously could not. That is a *tightening*, permitted and desirable — but it must be
proven not to change any current verdict, which is what the parity test in Phase 1 is for.

## Project Structure

### Documentation (this feature)

```
specs/030-strategies-mandate/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions + rejected alternatives
├── data-model.md        # the mandate's new fields and their semantics
├── quickstart.md        # how to verify, and the pass criteria
├── checklists/
│   └── requirements.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```
apps/web/src/
├── app/(app)/strategies/page.tsx        # two cards, money framing, rec-carrying link
├── app/(app)/settings/page.tsx          # per-field mandate editing
├── app/onboarding/page.tsx              # new questions
├── lib/agent/recView.ts                 # risk + fit derived, not constant
├── lib/agent/mandate.ts                 # one scale; drift both directions
├── lib/agent/mandateDraft.ts            # new fields
├── lib/strategy/projection.ts           # NEW — money, not percent
└── lib/goal/progress.ts                 # NEW — progress toward a target

services/agent/src/sparkpoint_agent/
├── api/recommendations.py               # resolve aave_v3_pool; emit strategy metadata
├── api/mandate.py                       # accept + persist the new fields
├── agents/recommender.py                # per-strategy risk class; rationale guard
└── db/mandates.py                       # persistence

services/agent/migrations/
└── 0033_mandate_goal_and_limits.py      # NEW — additive, nullable
```

## Phasing

1. **Foundation** — per-strategy risk class + the resolution fix, with a parity test proving no
   current verdict changes. Everything else depends on candidates existing.
2. **US1** — two cards, tradeoff stated, money framing, rec-carrying confirm link.
3. **US2** — risk badge and fit line derived; drift expressible both ways; rationale guard widened.
4. **US3** — mandate schema, onboarding questions, per-field settings editing, one risk scale,
   legacy summary repair.
5. **US4** — goal progress from real balances.
6. **Verification** — the 029 battery re-run unchanged, plus the new criteria.

## Complexity Tracking

No constitutional violations require justification. Two deliberate simplifications are recorded here
because a reviewer will otherwise ask:

| Decision | Why not the more general thing |
|---|---|
| Strategy risk classes are a static map in code, not a database table | Two strategies exist and the permitted set is constitutionally fixed. A table would be configuration for something that cannot vary at runtime, and would put a curation surface exactly where the constitution forbids one. |
| The exposure limit is checked when *proposing*, not added to the on-chain cap registry | Changing on-chain caps alters the custody-critical path for an advisory preference. The deterministic caps already bound the blast radius; this bounds what the user is *shown*. |
