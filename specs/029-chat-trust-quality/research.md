# Research — 029 Pre-Alpha Chat Trust & Answer Quality

Decisions taken before implementation, each checked against the code on develop `4b19fe4`.

## R1 — Where the malformed network identity is born, and where to guard

**Decision**: guard in `useAgentIdentity` (the single place identity is built) with a finite +
supported-chain check, and ALSO defensively in the client's header assembly.

**Rationale**: `chainId ?? DEFAULT_CHAIN_ID` cannot catch `NaN` (only `null`/`undefined`), and
`String(NaN)` is what reaches the wire. One guard at the source fixes every consumer (chat,
portfolio, notifications, tips, mandate — the regression saw NaN on all of them). The second,
belt-and-braces check in the header builder means a future identity source cannot reintroduce it.

**Alternatives**: normalising server-side (hides a client bug and would accept a wrong chain);
patching only the chat path (the regression showed six other endpoints affected).

## R2 — An error must not be able to look like an answer

**Decision**: the chat renders agent error envelopes through a dedicated inert error state with a
"Try again" affordance; a new pure module classifies "is this an internal envelope?" and supplies
user-facing copy.

**Rationale**: today the error text is placed in the same visual slot as prose, so
"X-Account/X-Owner/X-Chain-Id are malformed or mismatched." reads as Sparky speaking. Keeping the
classification pure (no React) makes the guarantee unit-testable — the same discipline that made
the 025 honesty rules enforceable.

## R3 — The general-branch fallback: retry once, then admit it

**Decision**: in the DAG's general branch, one retry of the prose call; if it still fails, emit an
`error`-shaped honest message instead of `_GENERAL_HELP`. Keep `_GENERAL_HELP` only for the
genuinely-nothing-to-say case (no model configured at all).

**Rationale**: the regression showed 3/20 turns silently degrading to the canned line — including
the persona intro, memory recall, and the withdrawal explanation — with the user unable to tell a
failure from a bad answer. A single retry covers the observed transient (queue timeout under
back-to-back turns) without turning a bad minute into a retry storm; the honest error covers the
rest. Rejected: retrying more than once (latency and cost on a chat path), and leaving the canned
line in place (indistinguishable from an answer — the whole complaint).

## R4 — Answer shapes: route in the planner, answer in the DAG

**Decision**: extend the planner's understanding with four hints (fees, yield/APY, automation,
personal-allocation advice) and handle each in the DAG before the generic branches. The advice
boundary short-circuits BEFORE propose so no ranked cards can be produced in that turn.

**Rationale**: the wrong shapes come from questions falling into the nearest existing intent
(fees → portfolio, APY → learn, automation → build_action). The taxonomy is the right place to
disambiguate; putting the boundary in the recommender would still let a card be built and then
suppressed, which is a weaker guarantee than never building one.

## R5 — The wallet answer needs two reads the chat provider doesn't make

**Decision**: `_VaultChatPortfolioProvider` additionally reads the native balance and the
platform's known token balances for the active chain; the portfolio answer names them.

**Rationale**: the provider today reads vault shares + idle stablecoin only, so "what's in my
wallet?" can only ever describe positions. `VaultReader` already exposes `native_balance` and
`token_balance_of`, so this is two extra reads inside the existing fail-closed try block — no new
transport, no new dependency. Scope is the address book's known tokens (stablecoin + SRK) plus the
native coin, per the spec's assumption; general token discovery is out of scope.

## R6 — One meta/slug guard, shared

**Decision**: extract the 028-hotfix `_looks_meta_shaped` into a shared module used by BOTH prose
agents, extend its patterns with the phrasings the regression caught ("the notes I am reviewing",
"reference notes provided", "in the notes"), and stop putting the internal topic identifier on the
tip wire.

**Rationale**: the hotfix guarded `sparky.py` only; the regression then caught the same leak on
the literacy/tip path ("I don't have information about 'srktoken' in the reference notes
provided"), plus raw slugs (`vault_safety`, `what_are_vault_shares`, `vault_apy`) printed above
answers. A shared guard means the next prose agent inherits it by construction.

## R7 — Restoring the conversation on refresh

**Decision**: on mount with no explicit conversation selected, load the wallet's most recent
conversation from the existing list endpoint and replay it (the 025 replay path already renders
persisted turns and cards).

**Rationale**: no new persistence is needed — conversations, turns and card blocks are already
stored and already replayable. The regression's "refresh drops you into an empty chat" is purely
a mount-time choice.

## R8 — Knowledge gaps are content, not plumbing

**Decision**: add three markdown documents to the existing seed corpus.

**Rationale**: the retriever, embedder and ingest path all work (6 docs, 25 chunks, live
embeddings, citations rendering). The assistant denied shipped features purely because nothing in
the corpus described them. Content is the cheapest, lowest-risk fix and is re-editable by an
operator through `/admin/knowledge` afterwards. Rejected: teaching the retriever to read the tips
and changelog tables (new plumbing, new failure modes, and those stores are written for a
different audience).
