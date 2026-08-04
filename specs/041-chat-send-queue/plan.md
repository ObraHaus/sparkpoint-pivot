# Implementation Plan: One turn at a time (041)

**Spec**: [`spec.md`](./spec.md) · **Branch**: `feature/041-chat-send-queue` · **Scope**: web only

## Summary

Serialise chat sends behind a queue that runs one message at a time, and make the waiting state
visible. No agent change, no migration, no contract change — the defect is entirely in the client's
dispatch.

## Where the defect actually is

`apps/web/src/app/(app)/chat/page.tsx`, in `send()`:

```ts
setTurns((prev) => [...prev, { id: nextId(), kind: "user", text: t }]);
if (online) void sendLive(t);   // ← fired unconditionally
else respond(t);
```

`void sendLive(t)` starts a stream and returns. Nothing consults, or records, whether one is already
running.

The agent side needs no defending against this — it behaves correctly given what it is sent:

- `db/conversations.py :: ensure_conversation` treats a missing `conversation_id` as "create one".
  That is right; the client simply had no id to send yet.
- `api/chat.py` appends the user turn at the start of the stream and the assistant turn at the end,
  ordered by row id. That is right too; two overlapping streams simply interleave into it.

So the fix belongs where the concurrency is created.

## Design

### A pure leaf module — `apps/web/src/lib/chat/sendQueue.ts`

No React, no imports, following `historyGroups.ts` / `followups.ts` / `thinking.ts`.

- `decideSend(raw, snapshot)` — trims, rejects empty, rejects over the bound with a notice, and
  reports whether the accepted message goes out now or waits.
- `suggestionsVisible(snapshot)` — chips only when nothing is in flight and nothing waits.
- `queueNotice(snapshot)` — the count above the composer, `null` when nothing waits.
- `serialQueue({run, onChange, onHalted})` — the runner. `push` starts the item if nothing is
  running, else queues it. `clear()` drops what waits and leaves the running one alone.

The concurrency guarantee rests on `drain()` being entered synchronously: an async function body
runs to its first `await` before yielding, so `if (running) return` is evaluated before any caller
can interleave. A push during a run therefore joins the existing drain rather than starting a second
one.

`onHalted` fires only once the queue is idle, so a caller that responds to a failure by re-queueing
gets a fresh drain instead of pushing into a queue that still believes it is running.

**Why a pure module.** The guarantee — never two at once — is a counter that must never reach two.
That is a unit assertion, and a browser cannot make it reliably. Removing the guard fails four of
the twenty tests; that was verified, not assumed (040's lesson: a test can assert the rule you wrote
and still miss the case the rule exists for).

### Page wiring

| Concern | Change |
|---|---|
| Dispatch | `send()` calls `decideSend` against the queue's **own** snapshot (two Enter presses in one tick read the same stale React copy), renders the bubble, and pushes. |
| Turn state | The user turn gains `wait?: "queued" \| "unsent"`. Cleared when the message actually goes out. |
| Live path | `sendLive` returns `Promise<boolean>`; the runner throws on `false` so the queue halts. |
| Offline path | `respond()` dispatches an animation, so it is wrapped: `thinkSeq` counts thinking turns created synchronously inside `respond`, and the turn's `onDone` releases the queue. Without this the scripted path would still send in parallel. |
| Conversation switch | An `epochRef` + `AbortController`. `resetSendQueue()` clears the queue **before** aborting — aborting first would let the drain advance and send the next queued message into the thread just navigated away from. |
| Stale writes | Every post-stream write in `sendLive` (conversation id, cards, chips, history refresh) is guarded by the epoch, so an abandoned stream cannot write into the new screen. This also fixes a latent 039-shaped bug: a stream finishing after a thread switch used to overwrite the new thread's chips. |
| Chips | Wrapped in `suggestionsVisible(queue)`. |
| Composer | `queueNotice(queue)` in an `aria-live="polite"` region. |
| Auto-reload | `useHoldCriticalOp` now also holds on queued work — the "busy" (data-loss) hold, never the funds lock. |

### Presentation

`chat.css`: `.cturn.user` becomes a column so a note can sit under its bubble (`align-items:flex-end`
preserves the right alignment `justify-content:flex-end` gave when the bubble was the only child);
`.cbubble-user.waiting` is dimmed and dashed; `.qmark` / `.qmark.unsent` / `.qsend` / `.qnotice` are
new and scoped.

## Constitution check

| Invariant | Status |
|---|---|
| N1/N3 — nothing here makes anything signable | Untouched. Cards still validate fail-closed. |
| N2 — never gate or slow the withdraw/exit path | Untouched. This is the chat composer only. |
| Policy gate / `/build-tx` chokepoint | Untouched. |
| AI proposes, deterministic policy + user disposes | Unchanged. |

## Verification

Unit (20 new, `sendQueue.test.ts`) — the guarantee under four same-tick pushes; ordering; a push
during a run; snapshot transitions; halt-and-hand-back; idle-at-halt; `clear()` semantics; the
decision and chip rules including the `busy:false, queued>0` sliver between turns.

Live, in a browser with an injected wallet (SC-001…SC-009): the three-message burst in a fresh chat
must leave **one** conversation in the sidebar, correctly interleaved.
