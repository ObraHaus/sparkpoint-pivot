# Phase 1 — Admin API contract: daily self-authoring

Every endpoint is admin-only (`require_admin`, the same dependency the rest of `/admin/*` uses) and
lives under `/admin/self-authoring`. The console is the only client.

Nothing here is reachable by a user, and nothing here appears on the withdraw path.

---

## `GET /admin/self-authoring`

One call that fills the whole section — the console renders in a single round trip rather than
five, which matters on a page an admin opens to check one number.

```jsonc
{
  "settings": {
    "enabled": false,
    "publishMode": "manual",              // "manual" | "automatic"
    "draftWindowHours": 336,
    "allowedDataSources": ["chain", "defillama", "morpho", "own_corpus", "answer_gaps"],
    "allowedProseDomains": [],            // EMPTY MEANS FETCH NO PROSE
    "updatedAt": "2026-08-03T07:00:00Z",
    "updatedBy": "0x32ed…e8b5"
  },
  "documents": [
    {
      "slug": "self-authored-base-usdc-yields",
      "title": "USDC yields on Base",
      "status": "draft",                  // "draft" | "published" | "retired"
      "markdown": "…",
      "claimCount": 4,
      "withheldCount": 1,                 // claims dropped by a held finding
      "firstWrittenAt": "…", "updatedAt": "…", "publishedAt": null,
      "editedByAdmin": false
    }
  ],
  "findings": {
    "heldCount": 4,
    "oldestHeldAt": "2026-07-22T…Z",      // FR-040 — the console shows count AND age
    "items": [{ "id": 12, "topic": "fee_competitiveness", "summary": "…", "status": "held", "createdAt": "…" }]
  },
  "runs": [
    {
      "id": 7, "trigger": "schedule", "startedAt": "…", "finishedAt": "…",
      "outcome": "no_change",             // published | no_change | no_evidence | blocked_selfcheck | skipped_locked | skipped_disabled | error
      "detail": "no material change since the previous run",
      "stats": { "evidenceOk": 12, "evidenceRefused": 0, "documentsWritten": 0, "claimsWithheld": 1 },
      "selfCheck": { "passed": true, "regressed": [] }
    }
  ]
}
```

`outcome` is returned verbatim rather than collapsed into ok/failed. `no_change` and `no_evidence`
are *successes* — the spec says silence is the common correct outcome, and a UI that painted them
red would train an admin to ignore the status line.

---

## `PUT /admin/self-authoring/settings`

```jsonc
{ "enabled": true, "publishMode": "automatic", "draftWindowHours": 0,
  "allowedDataSources": ["chain", "defillama"], "allowedProseDomains": ["docs.aave.com"] }
```

- Partial bodies are accepted; absent keys are unchanged.
- `allowedProseDomains` entries are normalised to bare lowercase hosts. A full URL, a scheme, a
  path, a port or a wildcard is **rejected with a message naming the offending entry** rather than
  quietly coerced — an admin who typed `https://docs.aave.com/v3` deserves to know it was not stored
  as they wrote it.
- `draftWindowHours` outside 0–8760 is rejected.
- Writes an audit row (FR-027) with the before and after snapshots.
- **Takes effect on the next run** (FR-022): settings are read at the start of a run, never cached
  in the process.

Returns the same shape as the `settings` block above.

---

## `POST /admin/self-authoring/run`

Triggers a run now (FR-001). Returns `202` with `{ "runId": 8 }` and executes in the background —
the request never waits for embeddings or a model.

If a run is already in flight the lock is not granted: returns `200` with
`{ "runId": null, "outcome": "skipped_locked" }`. A refusal is an ordinary answer here, not an error;
pressing the button twice is a normal thing an admin does.

If the feature is disabled: `{ "runId": null, "outcome": "skipped_disabled" }`.

---

## `PUT /admin/self-authoring/documents/{slug}`

```jsonc
{ "title": "…", "markdown": "…", "status": "published" }
```

FR-036. Any field may be sent alone. Setting `markdown` marks `editedByAdmin`, so the next run
records that it replaced hand-edited text instead of overwriting it invisibly.

Publishing ingests the document into the corpus under `self_authored`; unpublishing prunes its
chunks. Both are idempotent.

## `DELETE /admin/self-authoring/documents/{slug}`

Removes the row and prunes its chunks. The next run may recreate it if its evidence supports it —
an empty self-authored corpus is a valid state, not a broken one.

---

## `POST /admin/self-authoring/findings/{id}`

```jsonc
{ "status": "released" }   // "released" | "dismissed" | "held"
```

FR-041. Releasing lets the next run assert claims on that topic; dismissing means it never will.
Both record who acted and when.

---

## Web BFF

The console calls these through the existing admin proxy pattern — the browser never talks to the
agent directly, and the owner identity is derived server-side from the session, never from a client
header.
