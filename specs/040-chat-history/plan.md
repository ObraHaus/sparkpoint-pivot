# Implementation Plan: Chat history you can actually navigate

**Branch**: `feature/040-chat-history` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

## Summary

Group the sidebar by time, stop the list pretending it has ended, let a search reach the whole
history, and make identical titles tellable apart. Four client decisions, one feature.

The grouping itself is a pure function over data the API **already sends and the web already throws
away** (`createdAt`, `updatedAt`, `turnCount` are fetched and then narrowed to `{id, title}`). The
other three need two new query parameters on an existing endpoint.

## Technical Context

**Language/Version**: TypeScript / Next.js 16 App Router (`apps/web`) · Python 3.12 (`services/agent`)

**Storage**: PostgreSQL — `conversations`, read-only here. **No migration.**

**Testing**: `node --test --experimental-strip-types` leaf modules (web) · pytest (agent) · a live
browser pass on alpha.

**Constraints**: The list is on the chat screen's critical path — it must not delay first paint, and
a failure to page or search must never take the sidebar with it.

**Scale**: 154 conversations on alpha, 110 for the busiest wallet, page size 50.

## Constitution Check

| Principle | Verdict |
|---|---|
| **N1 — no custody** | **PASS.** Reads conversation titles and timestamps. No key, no signature, no amount. |
| **N2 — withdraw always open** | **PASS.** The sidebar is not on the exit path; the exit lives in the left nav and the banner and is untouched. |
| **N3/N4 — user signs everything** | **PASS.** No change to what is signable. |
| **II — AI proposes, policy disposes** | **PASS.** No model is involved anywhere in this feature. |
| **Privacy** | **PASS, and load-bearing.** Every query stays scoped to the session wallet via the existing `JOIN users u ON u.eoa_address = $1`. Search adds a `WHERE title ILIKE` **inside** that scope — it must never become a way to see another wallet's titles, and a test asserts the ownership predicate survives. |

**No violations.**

## Project Structure

```text
apps/web/src/
├── lib/chat/
│   ├── historyGroups.ts        # PURE: bucket, order, label, count. The whole rule set.
│   └── historyGroups.test.ts
└── app/(app)/chat/page.tsx     # keep the timestamps; render groups; search box; show-older

services/agent/src/sparkpoint_agent/
├── db/conversations.py         # + offset, + title search, + total count
└── api/conversations.py        # + ?offset= & ?q= , + `total` in the response
```

**Structure Decision**: The entire rule set — which bucket, what label, what order — is a pure
function taking `(rows, now)`. Dates are the classic thing that is hard to test through a UI and
trivial to test as data: "a conversation from 23:59 yesterday, read at 00:01 today" is one line as a
unit test and a scheduling problem in a browser.

## Phase 0 — Research

See [research.md](./research.md).

## Phase 1 — Design

**Wire shape.** `GET /conversations?limit=50&offset=0&q=` returns
`{ conversations: [...], total: number }`. `total` is what lets the button say *"Show 60 older"*
rather than the vague "Show more" — the honest number is the point of FR-009.

**Grouping.** `groupConversations(rows, now)` → `{ key, label, count, rows }[]`, newest period first,
empty periods omitted. Local midnight via `new Date(...).setHours(0,0,0,0)`, never UTC arithmetic.

**Search.** Server-side `ILIKE` inside the ownership scope, debounced client-side. Server-side
because FR-013 says the search covers the whole history and the client only holds a page.

**Telling rows apart.** Each row gains the time of its last activity — already fetched, and the thing
that actually differs between two identical questions.

### Post-design constitution re-check

One thing surfaced and was handled: the search parameter reaches SQL. It is bound as a parameter and
wrapped, never concatenated, and the ownership `JOIN` is unchanged — a test asserts both, because a
title search is exactly the shape of change that quietly widens a scope.
