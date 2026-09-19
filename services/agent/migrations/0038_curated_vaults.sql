-- =============================================================================
-- 0038_curated_vaults.sql  -  Feature 048: the AI-curated vault list (off-chain)
-- =============================================================================
-- Spec 048: an off-chain curator (the daily `runners/src/curator.ts`) discovers vaults from a
-- chain-configured source (Morpho's API today), screens + scores them, and this store holds the
-- result. `/vault` renders it; chat answers from it; Admin -> Vaults manages it.
--
-- WHY OFF-CHAIN (FR-001). Adding, ranking or removing a vault is a ROW here, never an on-chain
-- transaction. No gas, no deploy, no allowlist upgrade. The chain only ever sees user-signed
-- deposits/withdrawals.
--
-- ⚠️ M1 GATE — there is NO live ERC-4626 vault on Robinhood Chain 4663 today (Morpho reports 0
-- vaults there; verified 2026-09-18). These tables are empty until a source appears, and the
-- public surface is required to say so plainly (FR-008), never to render an empty table as a
-- market. `chain_id` is per-row and `source` is free text precisely so re-pointing discovery is
-- configuration, not a rewrite.
--
-- NON-CUSTODY (N1/N2). Nothing in this file moves funds or grants authority:
--   * The curator runner holds NO key. It reads a public API and POSTs observations to the agent.
--   * `wrapped` / `wrapper_address` are DISPLAY routing hints for the deposit rail; the actual
--     SparkPoint wrapper is deployed and signed by the operator separately (M1, gated).
--   * No policy module reads these tables. Per IV.5(d) curation is admission/display-time only.
--
-- ADMIN PRECEDENCE (FR-007). A scan may refresh an AI candidate; it must never overwrite an
-- admin's edit. `provenance='admin'` is the durable marker, and the ingest upsert CASEs on it
-- for every editable metadata field. Status decisions (`approved`/`denied`/`hidden`) and pins
-- belong to admins alone: the scan never writes `status` on an existing row at all.
--
-- Additive, idempotent, order-insensitive. Apply with PGCLIENTENCODING=UTF8 (the dev DB is
-- SQL_ASCII). An old agent on this DB is unaffected (nothing existing is altered); a new agent on
-- an unapplied DB degrades to the honest empty shape (the store swallows UndefinedTableError).
-- =============================================================================

-- ── curated_vaults — one row per (chain, vault) that has ever been discovered or added ─────────
CREATE TABLE IF NOT EXISTS curated_vaults (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id         integer NOT NULL,
    -- Lowercase 0x address, mirroring every other address column in this schema.
    vault_address    text    NOT NULL,
    -- Which discovery source saw it ('morpho' today). Free text: a new source is not a migration.
    source           text    NOT NULL DEFAULT 'morpho',

    -- Source-provided metadata. `provenance='admin'` freezes the editable ones (see ingest upsert).
    label            text    NOT NULL,
    asset_address    text,
    asset_symbol     text,
    asset_decimals   smallint CHECK (asset_decimals BETWEEN 0 AND 36),
    curator          text,
    curator_verified boolean NOT NULL DEFAULT false,
    listed           boolean NOT NULL DEFAULT false,

    -- Lifecycle. `candidate` = AI-proposed, awaiting an admin; `approved` = public; `hidden` =
    -- formerly public, now suppressed; `denied` = reviewed and rejected (kept so the next scan
    -- does not silently re-propose it as if it were fresh).
    status           text    NOT NULL DEFAULT 'candidate'
                     CHECK (status IN ('candidate', 'approved', 'hidden', 'denied')),
    -- Who owns the metadata: 'ai' (scan-refreshable) or 'admin' (authoritative, never overwritten).
    provenance       text    NOT NULL DEFAULT 'ai' CHECK (provenance IN ('ai', 'admin')),

    -- Curation output. Score 0..100 and the VERBATIM score inputs at scan time (FR-002 "why").
    score            integer CHECK (score BETWEEN 0 AND 100),
    score_inputs     jsonb   NOT NULL DEFAULT '{}'::jsonb,
    -- Screening verdicts for THIS row's last scan: [{code, ok, detail}, ...]. Nullable history is
    -- deliberately not kept: the audit table records decisions, and a stale verdict list would be
    -- read as if it were current.
    screening        jsonb   NOT NULL DEFAULT '[]'::jsonb,

    -- Observed figures, all nullable: NULL is "unknown", never a fabricated 0 (Principle III).
    net_apy_bps      integer,
    tvl_usd          numeric(20, 2),
    liquidity_usd    numeric(20, 2),
    vault_age_seconds bigint,

    -- Deposit rail routing (FR-005/D4 hybrid). `wrapped` REQUIRES an address; a direct vault must
    -- not carry one (an address with no wrapper is a lie the UI would render as a fee).
    wrapped          boolean NOT NULL DEFAULT false,
    wrapper_address  text,
    deposit_mode     text    NOT NULL DEFAULT 'direct' CHECK (deposit_mode IN ('direct', 'wrapper')),
    admin_note       text,

    -- Admin decision + pin bookkeeping.
    pinned_at        timestamptz,
    decided_by       text,
    decided_at       timestamptz,

    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_scan_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT curated_vaults_addr_lower    CHECK (vault_address = lower(vault_address)),
    CONSTRAINT curated_vaults_asset_lower   CHECK (asset_address IS NULL OR asset_address = lower(asset_address)),
    CONSTRAINT curated_vaults_wrapper_lower CHECK (wrapper_address IS NULL OR wrapper_address = lower(wrapper_address)),
    CONSTRAINT curated_vaults_wrapper_iff   CHECK (wrapped = (wrapper_address IS NOT NULL)),
    CONSTRAINT curated_vaults_wrapper_mode  CHECK (wrapped = (deposit_mode = 'wrapper')),
    UNIQUE (chain_id, vault_address)
);

-- The public board's read: approved vaults on one chain, best score first.
CREATE INDEX IF NOT EXISTS curated_vaults_chain_status_idx
    ON curated_vaults (chain_id, status, score DESC);

-- ── vault_recommendations — the published daily pick (+ alternates) with its as-of ──────────────
-- One row per curator run (idempotent on run_key). `published=false` is an AI PROPOSAL: it exists
-- for the admin panel and is invisible to the public read. With auto-publish on, the ingest marks
-- the row published in the same write; with it off (the default: "AI proposes, admin publishes")
-- an admin pinning/approving is what publishes. The row is append-only: history is the audit trail
-- of what was recommended when, and a failed run writes nothing at all (FR-011 fail-open).
CREATE TABLE IF NOT EXISTS vault_recommendations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id     integer NOT NULL,
    -- The runner's idempotency key. NULL is allowed for admin-authored publications (a pin).
    run_key      text,
    as_of        timestamptz NOT NULL,
    source       text    NOT NULL DEFAULT 'morpho',

    pick_address text    NOT NULL,
    pick_reason  text    NOT NULL,
    -- [{address, reason, score}, ...] — the two runners-up as recommended at `as_of`.
    alternates   jsonb   NOT NULL DEFAULT '[]'::jsonb,

    published    boolean NOT NULL DEFAULT false,
    provenance   text    NOT NULL DEFAULT 'ai' CHECK (provenance IN ('ai', 'admin')),
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vault_recommendations_pick_lower CHECK (pick_address = lower(pick_address))
);

-- The public read's query: latest PUBLISHED recommendation on one chain.
CREATE INDEX IF NOT EXISTS vault_recommendations_chain_as_of_idx
    ON vault_recommendations (chain_id, published, as_of DESC);

-- Run-key idempotency (a retried publish must not append a second identical pick). NULL run_keys
-- are distinct in Postgres, which is exactly right for admin-authored rows.
CREATE UNIQUE INDEX IF NOT EXISTS vault_recommendations_run_key_idx
    ON vault_recommendations (chain_id, run_key)
    WHERE run_key IS NOT NULL;

-- ── vault_curation_audit — every admin action AND every accepted run report ──────────────────────
-- The spec's "every autonomous action has a manual equivalent" (FR-007) needs a record of both. A
-- plain append-only table: no reader decides anything from it.
CREATE TABLE IF NOT EXISTS vault_curation_audit (
    id            bigserial PRIMARY KEY,
    action        text NOT NULL,
    chain_id      integer,
    vault_address text,
    -- The acting wallet for admin actions; NULL for the machine runner.
    actor         text,
    -- Free-form, but every caller stores the decision inputs (from -> to, reason, run key) so the
    -- panel can explain an action without joining anything.
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_curation_audit_created_idx
    ON vault_curation_audit (created_at DESC);

-- ── vault_curation_state — per-chain control row (auto-publish, last run, run-now marker) ───────
-- The RUNNER owns its schedule; this row is how the agent and the runner agree on "is a run due or
-- requested?" without either holding the other's authority. `run_requested_at` is set by the
-- admin panel's "Run now" and CLEARED by the next completed run report — it is a request, never a
-- command: the agent cannot make the keyless runner act, and the runner decides when to ask.
CREATE TABLE IF NOT EXISTS vault_curation_state (
    chain_id          integer PRIMARY KEY,
    auto_publish      boolean NOT NULL DEFAULT false,
    last_run_at       timestamptz,
    last_run_ok       boolean,
    last_run_key      text,
    last_failed_at    timestamptz,
    last_failed_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    run_requested_at  timestamptz,
    run_requested_by  text,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
