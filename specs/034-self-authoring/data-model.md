# Phase 1 — Data model: daily self-authoring

Migration **0035**, five tables. Additive, forward-only, order-insensitive with respect to code
(new code on the old schema degrades to "feature unavailable", never to an error on a user path).

Apply with `PGCLIENTENCODING=UTF8`. Every jsonb write in the store passes `ensure_ascii=False` —
the develop database is `SQL_ASCII` and rejects `\uXXXX` escapes above ASCII, a bug this project has
now found five times and killed as a class in `tests/db/test_jsonb_encoding_guard.py`.

---

## `self_authoring_settings` — one row, the admin's control panel

| Column | Type | Why it exists |
|---|---|---|
| `id` | `smallint PRIMARY KEY DEFAULT 1` + `CHECK (id = 1)` | Singleton by construction. A second settings row is a bug that would be very hard to see. |
| `enabled` | `boolean NOT NULL DEFAULT false` | FR-037. **Ships disabled.** A feature that starts writing on the deploy that introduces it gives nobody a chance to look first. |
| `publish_mode` | `text NOT NULL DEFAULT 'manual'` + `CHECK (publish_mode IN ('manual','automatic'))` | FR-032. Manual is the safe default; decision 4's two-week draft period is expressed by leaving this manual, not by a hidden timer. |
| `draft_window_hours` | `integer NOT NULL DEFAULT 336` + `CHECK (draft_window_hours BETWEEN 0 AND 8760)` | FR-033. 336 = two weeks, the client's number, but editable. 0 means publish immediately. |
| `allowed_data_sources` | `text[] NOT NULL DEFAULT '{}'` | FR-021/023. Which structured feeds may be called, by name (`chain`, `defillama`, `morpho`, `own_corpus`, `answer_gaps`). |
| `allowed_prose_domains` | `text[] NOT NULL DEFAULT '{}'` | FR-023. **Empty means fetch no prose.** Never "fetch anything". |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_by` | `text` | FR-027, with `self_authoring_settings_audit` below. |

**Why the data-source list is also configurable and not just the prose list.** The client asked for
"the list of allowed api and domains" to be editable. Being able to switch off a feed that has
started returning nonsense, without a deploy, is the same operational need as pulling a domain.

**Why `enabled` defaults to false.** SC-012 requires disabling to work; shipping disabled proves the
default path is the safe one, and means the first run happens because someone chose it.

### `self_authoring_settings_audit` — who changed what, when

`id bigserial` · `changed_at timestamptz` · `changed_by text` · `before jsonb` · `after jsonb`

FR-027. "Which sources was Sparky reading in March" has to be answerable, and the settings row only
holds the present. Both snapshots are stored whole rather than as a diff — a diff of a two-element
array is harder to read a year later than the two arrays.

---

## `self_authoring_runs` — what happened, and why

| Column | Type | Why it exists |
|---|---|---|
| `id` | `bigserial PRIMARY KEY` | |
| `started_at` / `finished_at` | `timestamptz` | FR-003. `finished_at IS NULL` means in-flight or crashed. |
| `trigger` | `text NOT NULL` `CHECK IN ('schedule','manual')` | Distinguishes "the job ran" from "someone pressed the button". |
| `outcome` | `text` `CHECK IN ('published','no_change','no_evidence','blocked_selfcheck','skipped_locked','skipped_disabled','error')` | FR-005/006/030. **`no_change` and `no_evidence` are successes, not failures** — the spec says silence is the common correct outcome, and an enum that called them errors would train everyone to ignore the status. |
| `detail` | `text` | The human sentence: which golden question regressed, which fetch failed. |
| `stats` | `jsonb NOT NULL DEFAULT '{}'` | Counts: evidence fetched, refused, documents written, claims withheld. |

---

## `self_authoring_evidence` — everything a run fetched

| Column | Type | Why it exists |
|---|---|---|
| `id` | `bigserial PRIMARY KEY` | |
| `run_id` | `bigint NOT NULL REFERENCES self_authoring_runs(id) ON DELETE CASCADE` | Evidence belongs to the run that fetched it. FR-009 requires "fetched during that run" to be a checkable fact, not a claim. |
| `source` | `text NOT NULL` | `chain`, `defillama`, `morpho`, `own_corpus`, `answer_gaps`, `prose`. |
| `url` | `text` | FR-025. Null for chain reads, which have no URL. |
| `chain_id` | `integer` | FR-013. **The column exists so the chain cannot be forgotten.** A figure with a null `chain_id` is not eligible to appear in a document. |
| `label` | `text NOT NULL` | What this is, e.g. `aave_supply_apy_bps`. |
| `value` | `numeric` | The figure, where the evidence is a figure. |
| `quote` | `text` | The verbatim text, where the evidence is prose. FR-026. |
| `attribution` | `text` | Who said it — the host. Prose without attribution is not usable. |
| `fetched_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `status` | `text NOT NULL DEFAULT 'ok'` `CHECK IN ('ok','refused','implausible','error')` | FR-017/024. A refused fetch is *recorded*, not silently absent — that is the difference between "we didn't look" and "we were not allowed to look". |
| `payload` | `jsonb NOT NULL DEFAULT '{}'` | The raw shape, for diagnosis. |

**`value` and `quote` are separate columns rather than one polymorphic field.** A figure and a
quotation get different treatment everywhere downstream — one gets plausibility bounds and a chain,
the other gets attribution and a trust tier — and merging them would invite code that forgets which
it is holding.

---

## `self_authoring_documents` — the six living documents

| Column | Type | Why it exists |
|---|---|---|
| `slug` | `text PRIMARY KEY` | Stable, constant, one per document. **This is what makes rewriting in place work**: `ingest_note(source=slug)` replaces exactly this document's chunks. |
| `title` | `text NOT NULL` | |
| `markdown` | `text NOT NULL` | Current text. Replaced on rewrite — no history, per decision 1. |
| `status` | `text NOT NULL DEFAULT 'draft'` `CHECK IN ('draft','published','retired')` | FR-034/035. `retired` is for a document that has nothing to say — FR-007's ceiling means retiring, not padding. |
| `claims` | `jsonb NOT NULL DEFAULT '[]'` | The claims asserted, each with its `topic` key and evidence ids. This is what the held-findings guard reads. |
| `first_written_at` | `timestamptz NOT NULL DEFAULT now()` | FR-035 — the draft window is measured from here, so a document's clock does not restart every time it is rewritten. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `published_at` | `timestamptz` | |
| `last_run_id` | `bigint REFERENCES self_authoring_runs(id) ON DELETE SET NULL` | |
| `edited_by_admin` | `boolean NOT NULL DEFAULT false` | An admin edit must not be silently overwritten (edge case). The next run sees this and records that it replaced hand-edited text. |

**Why `first_written_at` and not `published_at` drives the window.** If the clock restarted on each
rewrite, a document rewritten daily would never leave draft — the window would be unreachable by
construction, and it would take weeks to notice.

---

## `self_authoring_findings` — held, released, dismissed

| Column | Type | Why it exists |
|---|---|---|
| `id` | `bigserial PRIMARY KEY` | |
| `run_id` | `bigint REFERENCES self_authoring_runs(id) ON DELETE SET NULL` | Which run concluded it. `SET NULL` so pruning old runs never destroys a finding. |
| `topic` | `text NOT NULL` | The key the guard matches on, e.g. `fee_competitiveness`. Deliberately a key, not a sentence — see research R4. |
| `summary` | `text NOT NULL` | What was found, in words, for the admin to read. |
| `status` | `text NOT NULL DEFAULT 'held'` `CHECK IN ('held','released','dismissed')` | FR-038/041. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | FR-040 — the console shows the age of the oldest held finding. |
| `resolved_at` | `timestamptz` · `resolved_by` `text` | |
| `evidence` | `jsonb NOT NULL DEFAULT '[]'` | The evidence ids behind it, so a released finding can be checked. |

**Findings do not expire.** A time-based auto-release would convert editorial control into a delay,
which is not what was agreed. Instead the count and the age are surfaced (FR-040) so a growing pile
is visible rather than quiet.

---

## Indexes

```sql
CREATE INDEX self_authoring_evidence_run_idx    ON self_authoring_evidence (run_id);
CREATE INDEX self_authoring_findings_status_idx ON self_authoring_findings (status, created_at);
CREATE INDEX self_authoring_runs_started_idx    ON self_authoring_runs (started_at DESC);
```

Three, and no more. `documents` has six rows and needs none; the others are read by run, by status
and by recency, which is exactly what the console asks for.

---

## What is deliberately NOT stored

- **Any version history of a document.** Decision 1. The corpus stays small because old text is
  gone, not archived-but-indexed.
- **Any user's words.** FR-042. The `answer_gaps` evidence rows carry a classification label and a
  count, never a message.
- **The persona.** It is trusted instruction text with no source kind, and it stays that way.
- **Anything the policy gate reads.** No table here is joined by `policy.evaluate`, `build_action`,
  or the recommendation ranker. That is the constitutional boundary, and a test asserts it.
