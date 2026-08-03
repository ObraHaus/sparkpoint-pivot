# Implementation Plan: Sparky's daily self-authoring

**Branch**: `feature/034-self-authoring` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-self-authoring/spec.md`

## Summary

A once-daily background job that fetches live evidence, rewrites six living documents in place,
verifies it did no harm, and publishes into the `self_authored` corpus that 031 already built. An
admin controls the whole thing from `/admin/knowledge` → Self-authored: what it may read, whether it
publishes automatically, how long documents sit in draft, and which unflattering findings have been
released.

The design is dominated by two properties that are easy to state and easy to lose:

1. **The corpus must not grow.** Documents are rewritten, never appended. `ingest_note` already
   makes this free — chunk ids are UUID5 over `(source, index)` and orphans are pruned — so a
   rewrite of `self-authored-base-usdc-yields` replaces its own chunks and nothing else.
2. **The job must be unable to hurt anything.** It runs in the background, never on a request path,
   never awaited during boot, holds a single-runner lock, and writes only into a source kind that
   the policy gate cannot read. Every failure mode ends in "no document written", never in
   "a degraded document written".

## Technical Context

**Language/Version**: Python 3.12 (agent) · TypeScript / Next.js 16 App Router (web console)

**Primary Dependencies**: FastAPI · asyncpg · httpx · pgvector · the existing LiteLLM client
(`llm/claude.py`) · `knowledge/ingestion.py` · `knowledge/store.py` · `chain/aave_rate.py` ·
`chain/vault_reader.py` · `data/morpho_api.py`

**Storage**: PostgreSQL (develop instance is `SQL_ASCII` — every jsonb write passes
`ensure_ascii=False`, enforced by `tests/db/test_jsonb_encoding_guard.py`). Migration **0035**.

**Testing**: pytest + pytest-asyncio (agent) · `node --test --experimental-strip-types` leaf modules
(web) · a live end-to-end pass on alpha

**Target Platform**: Linux containers on Coolify (agent + web), Base Sepolia 84532

**Project Type**: Web service + admin console

**Performance Goals**: One run per day, budgeted at ≤10 minutes wall clock. Zero measurable effect
on any request path — the job never runs inline with a request and never holds a connection a
request needs.

**Constraints**: Fail-open everywhere; a failure writes no document and never propagates. Boot must
not wait on it. Embedding and LLM calls are bounded by timeout and count. The prose allowlist is
empty by default and fails closed.

**Scale/Scope**: 6 documents, ~30 evidence rows per run, ~106 existing corpus chunks that must not
be displaced.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **N1 — no custody** | Does the feature touch funds? | **PASS.** It writes text. No key, no signature, no transaction, no balance mutation. |
| **N2 — withdraw always open** | Does it gate or slow the exit path? | **PASS.** It never runs on a request path at all. `test_self_authoring_never_on_withdraw_path` pins it. |
| **N3/N4 — user signs everything** | Does it change what can be signed? | **PASS.** No change to `/build-tx`, the policy gate, or the session-key validator. |
| **N5 — single-purpose, non-upgradeable** | Contract changes? | **PASS.** None. |
| **II — AI proposes, policy disposes** | Does self-authored text reach a decision? | **PASS, and pinned.** `self_authored` is retrievable by the *prose* path only. The classifier, the policy gate and `build_action` never see it. A test asserts policy verdicts are byte-identical with and without self-authored chunks in the corpus. |
| **III — honesty about yield** | Can it state a rate it cannot support? | **PASS.** Every figure carries its chain; implausible figures are rejected before writing; a run with no evidence writes nothing. |
| **VII — discretionary curation FORBIDDEN** | Does it select markets, set caps, or allocate? | **PASS.** It describes the landscape in aggregate and names no competitor product as an alternative. It cannot read the curated Morpho allowlist — that registry is unreadable by the agent path by construction. |

**No violations. Complexity Tracking is therefore omitted.**

The one gate worth restating: **Principle II is the reason `self_authored` must stay out of the
decision path.** 031 made it retrievable; this feature makes it *generated*. A generated document
that could rank a recommendation would be the assistant curating, which the constitution forbids in
plain words.

## Project Structure

### Documentation (this feature)

```text
specs/034-self-authoring/
├── plan.md              # This file
├── spec.md              # What and why
├── research.md          # Phase 0 — the six decisions that were genuinely open
├── data-model.md        # Phase 1 — migration 0035 and the entity shapes
├── quickstart.md        # Phase 1 — how to run and verify it
├── contracts/
│   └── admin-api.md     # Phase 1 — the admin surface the console drives
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
services/agent/
├── migrations/
│   └── 0035_self_authoring.sql              # settings · runs · evidence · documents · findings
├── src/sparkpoint_agent/
│   ├── selfauthor/                          # NEW package — the job
│   │   ├── __init__.py
│   │   ├── settings.py                      # the admin-editable config + its fail-closed defaults
│   │   ├── allowlist.py                     # PURE: is this URL permitted? (no I/O)
│   │   ├── evidence.py                      # PURE: shapes, plausibility bounds, chain labelling
│   │   ├── sources.py                       # the fetchers (chain · llama · morpho · own corpus · gaps)
│   │   ├── documents.py                     # PURE: the six document definitions + rendering
│   │   ├── claims.py                        # PURE: claim/finding contradiction — the held guard
│   │   ├── selfcheck.py                     # the golden-question regression check
│   │   └── run.py                           # the orchestrator: lock → fetch → write → verify → publish
│   ├── db/
│   │   └── self_authoring.py                # the store (one module, all five tables)
│   └── api/
│       ├── admin_self_authoring.py          # NEW router — settings, runs, documents, findings
│       └── main.py                          # + the daily loop, mirroring _index_changelog (033)
└── tests/
    ├── selfauthor/                          # the pure logic, exhaustively
    └── db/                                  # store behaviour against fakes

apps/web/src/
├── components/admin/
│   └── SelfAuthoredPanel.tsx                # REPLACES SelfAuthoredPreview.tsx (the 032 mockup)
└── lib/selfauthor/
    ├── settings.ts                          # PURE: validation/normalisation of the two lists
    └── settings.test.ts                     # leaf-module tests
```

**Structure Decision**: A new `selfauthor/` package in the agent, with the pure logic separated from
everything that touches the network or the database. That split is not tidiness — it is what makes
the guarantees testable. "A held finding blocks a contradicting claim" and "an empty allowlist
permits nothing" are properties of pure functions, and pinning them with fakes is how they stay true
when the fetchers change. The web side replaces one component; the console's five-section shell from
032 is untouched.

## Phase 0 — Research

See [research.md](./research.md). Six questions were genuinely open; the rest were settled by the
client decisions or by existing code.

## Phase 1 — Design

- [data-model.md](./data-model.md) — migration 0035, five tables, and why each column exists.
- [contracts/admin-api.md](./contracts/admin-api.md) — the admin endpoints the console drives.
- [quickstart.md](./quickstart.md) — how to run it locally, on alpha, and how to verify each SC.

### Post-design Constitution re-check

Re-ran after the data model was fixed. Two things surfaced and were resolved in the design rather
than deferred:

1. **The evidence table stores fetched prose.** That is untrusted third-party text living in our
   database. It is stored with its attribution, is never embedded, is never placed in a system
   prompt, and is passed to the writer inside a clearly delimited quotation block in the *user* turn
   — the same boundary 027 established for a user's own words. `test_prose_evidence_is_never_system`
   pins it.
2. **`documents.markdown` is written by a model and then embedded.** This is the one genuinely new
   trust surface in the product. The mitigation is not cleverness, it is scope: the text lands under
   `self_authored`, which the policy path cannot read, and it is labelled to every reader as
   unreviewed. Verdict: acceptable, and exactly what decision 3 approved.

**Still no violations.**
