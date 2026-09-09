-- =============================================================================
-- 0009_gateway_audit.sql  -  R3: append-only audit of admin LLM-gateway config changes
-- =============================================================================
-- The admin "LLM gateway" panel can mutate the LiteLLM proxy's model config (add/remove a
-- deployment behind the `sparkpoint-chat` alias). Those writes go to LiteLLM's own DB via its
-- management API; THIS table is our local, queryable provability record of who changed what and
-- when (the panel's Activity/Config tabs read it). Mirrors `knowledge_audit` (0008) + the
-- append-only posture of `audit_logs` (0001).
--
-- NO SECRETS (VR-A3): `detail` carries model NAMES / ids / rpm only — never api keys, the master
-- key, or virtual-key material. The admin_llm API scrubs key-shaped fields before anything lands
-- here. ACCESS/config only — never custody (N2); the gateway can't move funds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gateway_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('model_add', 'model_delete', 'config_update')),
    subject text        NOT NULL,                 -- model deployment id / alias affected
    actor   text,                                 -- the admin wallet (lower-cased), or NULL
    detail  jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- scrubbed: names/ids/rpm only, NO key material
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_audit_at ON gateway_audit (at DESC);
