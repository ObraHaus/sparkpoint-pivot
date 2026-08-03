-- 0035_self_authoring.sql — feature 034: Sparky writes its own research, on a schedule, inside
-- limits an admin controls. Additive, forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- WHY THE SHAPE IS WHAT IT IS. The obvious version of this feature — write a note every day — would
-- make the assistant WORSE at answering, not better. Retrieval quality falls as a corpus grows: a
-- bigger search space surfaces more passages that are topically similar and factually irrelevant
-- (measured elsewhere: 58.6% -> 43.2% answer accuracy as a corpus grew twentyfold). Sparky's entire
-- corpus is ~106 chunks. A note a day would quadruple it inside a year, all of it about yield — the
-- exact topic users ask about — and the degradation is SILENT.
--
-- So `self_authoring_documents` holds SIX rows, keyed by a stable slug, rewritten in place. There is
-- no version history and no per-run note table, deliberately: `ingest_note(source=slug)` derives
-- chunk ids from (source, index) and prunes orphans, so rewriting a document replaces exactly its
-- own chunks and the corpus stays the size it is.
--
-- NON-CUSTODY (N1/N2/N3). Nothing here authorises anything. This feature writes TEXT. No table below
-- is read by policy.evaluate, by build_action, by the recommendation ranker, or by anything on the
-- withdraw/exit path — that boundary is asserted by a test, not just by intent. Constitution
-- Principle II (AI proposes, deterministic policy disposes) is why: 031 made `self_authored`
-- retrievable, and this feature makes it GENERATED. Generated text that could rank a recommendation
-- would be the assistant curating, which Principle VII forbids in plain words.
--
-- SQL_ASCII: the develop database rejects \uXXXX escapes above ASCII, so every jsonb write in
-- db/self_authoring.py passes ensure_ascii=False. tests/db/test_jsonb_encoding_guard.py enforces it
-- across the whole data layer — this bug has been found five times and is now killed as a class.

-- ── settings: the admin's control panel, one row ────────────────────────────────────────────────
-- Singleton by construction. A second settings row would be a bug that is very hard to see, and
-- CHECK (id = 1) makes it impossible rather than unlikely.
CREATE TABLE IF NOT EXISTS self_authoring_settings (
    id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    -- SHIPS DISABLED. A feature that starts writing on the deploy that introduces it gives nobody a
    -- chance to look first. The first run happens because someone chose it.
    enabled               boolean     NOT NULL DEFAULT false,
    publish_mode          text        NOT NULL DEFAULT 'manual'
                                      CHECK (publish_mode IN ('manual', 'automatic')),
    -- 336 hours = two weeks, the client's number — but a SETTING, not a constant, so it can be
    -- shortened once the output is trusted without a redeploy. 0 publishes immediately.
    draft_window_hours    integer     NOT NULL DEFAULT 336
                                      CHECK (draft_window_hours BETWEEN 0 AND 8760),
    -- Which structured feeds may be called, by name. Configurable for the same operational reason
    -- as the domains: a feed that starts returning nonsense must be switchable off in minutes.
    allowed_data_sources  text[]      NOT NULL DEFAULT '{}',
    -- EMPTY MEANS FETCH NO PROSE — never "fetch anything". A misconfiguration fails CLOSED.
    allowed_prose_domains text[]      NOT NULL DEFAULT '{}',
    updated_at            timestamptz NOT NULL DEFAULT now(),
    updated_by            text
);

INSERT INTO self_authoring_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- "Which sources was Sparky reading in March" has to be answerable, and the settings row only holds
-- the present. Both snapshots are stored whole rather than as a diff: a diff of a two-element array
-- is harder to read a year later than the two arrays.
CREATE TABLE IF NOT EXISTS self_authoring_settings_audit (
    id         bigserial PRIMARY KEY,
    changed_at timestamptz NOT NULL DEFAULT now(),
    changed_by text,
    before     jsonb       NOT NULL DEFAULT '{}',
    after      jsonb       NOT NULL DEFAULT '{}'
);

-- ── runs: what happened, and why ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_authoring_runs (
    id          bigserial PRIMARY KEY,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    trigger     text        NOT NULL DEFAULT 'schedule'
                            CHECK (trigger IN ('schedule', 'manual')),
    -- `no_change` and `no_evidence` are SUCCESSES, not failures. Most days nothing material changes,
    -- and an outage should produce no note rather than a stale one — an enum that called those
    -- errors would train everyone to ignore the status line.
    outcome     text        CHECK (outcome IN (
                                'published', 'no_change', 'no_evidence', 'blocked_selfcheck',
                                'skipped_locked', 'skipped_disabled', 'error')),
    detail      text,
    stats       jsonb       NOT NULL DEFAULT '{}'
);

-- ── evidence: everything a run fetched, including what it was refused ───────────────────────────
CREATE TABLE IF NOT EXISTS self_authoring_evidence (
    id          bigserial PRIMARY KEY,
    run_id      bigint      NOT NULL REFERENCES self_authoring_runs (id) ON DELETE CASCADE,
    source      text        NOT NULL,
    url         text,
    -- The column exists so the chain CANNOT BE FORGOTTEN. Our vault reads 0.44% on Base Sepolia
    -- while the identical strategy pays 3.48% on Base mainnet; a figure that does not know which
    -- world it came from is not publishable, and this column is how that is enforced.
    chain_id    integer,
    label       text        NOT NULL,
    -- A figure and a quotation get different treatment everywhere downstream — one gets plausibility
    -- bounds and a chain, the other gets attribution and a trust tier. Separate columns so code
    -- cannot forget which it is holding.
    value       numeric,
    quote       text,
    attribution text,
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    -- A refused fetch is RECORDED, not silently absent: that is the difference between "we didn't
    -- look" and "we were not allowed to look".
    status      text        NOT NULL DEFAULT 'ok'
                            CHECK (status IN ('ok', 'refused', 'implausible', 'error')),
    payload     jsonb       NOT NULL DEFAULT '{}'
);

-- ── documents: the six living documents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_authoring_documents (
    slug             text PRIMARY KEY,
    title            text        NOT NULL,
    markdown         text        NOT NULL,
    -- 'retired' is for a document that has nothing to say. Six is a CEILING, so a thin document is
    -- retired rather than padded.
    status           text        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'retired')),
    claims           jsonb       NOT NULL DEFAULT '[]',
    -- The draft window is measured from FIRST write, not from the last one. If the clock restarted
    -- on every rewrite, a document rewritten daily would never leave draft — unreachable by
    -- construction, and it would take weeks to notice.
    first_written_at timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    published_at     timestamptz,
    last_run_id      bigint REFERENCES self_authoring_runs (id) ON DELETE SET NULL,
    -- An admin edit must not be silently overwritten. The next run sees this and records that it
    -- replaced hand-edited text.
    edited_by_admin  boolean     NOT NULL DEFAULT false
);

-- ── findings: held, released, dismissed ─────────────────────────────────────────────────────────
-- The guard that stops "hold the unflattering ones" from becoming "only publish good news". Each
-- finding carries a TOPIC KEY, and while a finding on that key is held, claims on that key are
-- withheld from the published document. A key match, not a model judging whether two sentences
-- contradict each other — that is exactly the kind of thing that fails quietly.
CREATE TABLE IF NOT EXISTS self_authoring_findings (
    id          bigserial PRIMARY KEY,
    -- SET NULL so pruning old runs never destroys a finding an admin has not yet acted on.
    run_id      bigint REFERENCES self_authoring_runs (id) ON DELETE SET NULL,
    topic       text        NOT NULL,
    summary     text        NOT NULL,
    status      text        NOT NULL DEFAULT 'held'
                            CHECK (status IN ('held', 'released', 'dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by text,
    evidence    jsonb       NOT NULL DEFAULT '[]'
);

-- Three indexes and no more. `documents` has six rows and needs none; the others are read by run,
-- by status and by recency, which is exactly what the console asks for.
CREATE INDEX IF NOT EXISTS self_authoring_evidence_run_idx    ON self_authoring_evidence (run_id);
CREATE INDEX IF NOT EXISTS self_authoring_findings_status_idx ON self_authoring_findings (status, created_at);
CREATE INDEX IF NOT EXISTS self_authoring_runs_started_idx    ON self_authoring_runs (started_at DESC);
