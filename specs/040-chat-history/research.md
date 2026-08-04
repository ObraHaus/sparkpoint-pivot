# Phase 0 — Research: chat history navigation

Four decisions were taken by the client before this started (artifact `1477fdaa`). What follows is
what the codebase and the live data decided.

## R1 — Does grouping need anything from the backend?

**No.** `GET /conversations` already returns `createdAt`, `updatedAt` and `turnCount` per row;
`apps/web/src/app/(app)/chat/page.tsx` narrows it to `{ id: string; title: string }[]` and discards
the rest. Grouping is reading a field already on the wire.

**But the other three decisions do.** `list_conversations` takes `limit` only — no offset, no search,
no total. So paging and search are a small, additive change to one endpoint. Worth stating plainly
because the proposal said "no backend work needed", and that was true only of grouping alone.

## R2 — Group by `updatedAt` or `createdAt`?

**`updatedAt`** — the client's decision, and it is also the only one consistent with the list's
existing sort (`ORDER BY c.updated_at DESC`). Grouping by creation while sorting by activity would
produce a list whose headings and order disagree: a "Previous 30 days" conversation sitting above a
"Today" one.

Live evidence that this matters: the top conversation on alpha was created at 15:31 and last touched
at 23:51 the same day — and threads resumed days later exist.

## R3 — Why is the boundary local midnight and not UTC?

Because "Today" means the reader's today. The API sends UTC ISO strings; the browser converts. The
failure this avoids is real and dull: a user in UTC+8 opening the app at 07:00 would otherwise see
yesterday's conversations under "Today" for the first eight hours of every day.

Computed with `setHours(0,0,0,0)` on a local `Date` rather than by subtracting 86,400,000 — day
arithmetic in milliseconds is wrong twice a year in any zone that observes daylight saving.

## R4 — Client-side or server-side search?

**Server-side.** FR-013 requires the search to cover the whole history, and the client holds one page
of fifty. A client-side filter would silently search only what is loaded — which looks identical to a
working search right up until the moment it matters.

Bound as a parameter inside the existing ownership `JOIN`. A title search is exactly the shape of
change that quietly widens a scope, so the ownership predicate is asserted by a test.

## R5 — What actually distinguishes two identically-titled conversations?

The **time of last activity**. Considered and rejected:

- *Rewriting the title from the first answer* — the title is honest; the user did ask the same thing
  five times, and inventing different words for identical questions is a lie that reads as a
  feature.
- *De-duplicating them away* — they are different conversations with different contents.
- *A turn count* — "4 turns" does not help you remember which one you want.

The time is already fetched, needs no new data, and is the thing that genuinely differs.

## R6 — What does the "show older" control say?

The exact number remaining, which is why `total` joins the response. "Show more" is the version of
this control that leaves you not knowing whether you are near the end; **"Show 60 older
conversations"** is the version that answers the question the missing rows create.
