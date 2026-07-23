-- 0020_network_diagnostics.sql — hot-fix follow-up: persist the SIWE network-gate diagnostic
-- captures (the client-reported wallet/network snapshot the /verify beacon posts) so ops can review
-- "wrong network" incidents at /admin/diagnostics instead of grepping web logs. Additive,
-- forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY / privacy (N2): rows hold ONLY a CLIENT-REPORTED (unverified) wallet address + browser
-- network state — no keys, no funds, no authority, and nothing here is ever read on the
-- withdraw/redeem/exit path. Ingest is S2S from the web tier; the read surface is admin-only. The
-- address is stored lowercased; the full (capped) payload is kept in `raw`.

CREATE TABLE IF NOT EXISTS network_diagnostics (
    id               BIGSERIAL   PRIMARY KEY,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason           TEXT        NOT NULL,               -- 'off-network' | 'signin-attempt' | client-reported
    address          TEXT,                              -- client-reported wallet (lowercased), UNVERIFIED
    wagmi_chain_id   BIGINT,                            -- chainId wagmi surfaced to the gate (may be null)
    wallet_chain_id  BIGINT,                            -- wallet's own eth_chainId (ground truth, may be null)
    chain_mismatch   BOOLEAN,                           -- wallet_chain_id present AND != wagmi_chain_id
    wagmi_status     TEXT,                              -- connecting | reconnecting | connected | disconnected
    connector_id     TEXT,
    connector_name   TEXT,
    is_metamask      BOOLEAN,
    injected_count   INTEGER,                           -- EIP-6963 discovered provider count
    injected_names   TEXT[]      NOT NULL DEFAULT '{}', -- EIP-6963 provider names
    user_agent       TEXT,
    build_id         TEXT,
    raw              JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- List query orders by created_at DESC; the address + mismatch filters back the admin surface.
CREATE INDEX IF NOT EXISTS network_diagnostics_created_idx  ON network_diagnostics (created_at DESC);
CREATE INDEX IF NOT EXISTS network_diagnostics_address_idx  ON network_diagnostics (address);
CREATE INDEX IF NOT EXISTS network_diagnostics_mismatch_idx ON network_diagnostics (chain_mismatch) WHERE chain_mismatch;
