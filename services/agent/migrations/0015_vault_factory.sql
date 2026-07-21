-- =============================================================================
-- 0015_vault_factory.sql  -  Feature 011: branded Morpho wrapper factory (MANAGE half)
-- =============================================================================
-- Feature 011 adds an admin-gated CREATE2 factory that deploys branded SparkPointMorphoVault
-- wrappers over a CURATED, on-chain Morpho allowlist. The on-chain contracts are the enforcement;
-- this migration owns the small amount of OFF-CHAIN provenance state the admin panel + the 010
-- vault reader consume. 010 owns a STATIC-config registry (AddressBook.vaults[] + config.py; NO DB
-- table), so there is nothing here to ALTER -- 011 CREATES two brand-new 011-owned tables:
--
--   1. morpho_curated_allowlist  -- the human vetting record behind each on-chain allowlist add
--      (data-model.md sec.3). The on-chain `morphoAllowlist[addr]=true` is the ENFORCEMENT; this
--      row carries the rationale (curator, native fee, oracle/gates/timelock findings) that gated
--      the operator's decision so the honest double-fee disclosure (III) has a source.
--
--   2. sparkpoint_wrappers  -- provenance the 010 reader MERGES with its static registry
--      (data-model.md sec.4). Factory-created wrappers are minted at RUNTIME, so they cannot live
--      in 010's compile-time static config; the create flow inserts a 'pending' row here, which the
--      010 reader renders once its on-chain provenance (factory.isSparkPointVault) verifies.
--
-- NON-CUSTODY (N1/N2): both tables are pure PROVENANCE / ACCESS records. Nothing here is ever a
-- signing input or a fund path -- the admin BFF only READS these + returns prepared calldata the
-- operator signs off-app; the on-chain wrapper's withdraw/redeem escape hatch never depends on any
-- row here. Additive + idempotent (IF NOT EXISTS), no backfill. Apply with PGCLIENTENCODING=UTF8.
-- =============================================================================

-- 1) Curated Morpho allowlist -- off-chain vetting record (data-model.md sec.3) ---------------
CREATE TABLE IF NOT EXISTS morpho_curated_allowlist (
    morpho_vault   text        NOT NULL,                     -- the curated IERC4626 (lower-cased 0x)
    chain_id       integer     NOT NULL,                     -- 8453 (curated mainnet) / 84532 (test)
    allowed        boolean     NOT NULL DEFAULT false,       -- mirrors the on-chain mapping
    curator        text,                                     -- the Morpho vault's on-chain curator/owner
    label          text,                                     -- human label for the curated vault
    native_fee_bps integer,                                  -- the wrapped vault's OWN Morpho fee (III)
    vetting_notes  text,                                     -- why it was allowlisted (TVL/audit/market)
    oracle_notes   text,                                     -- oracle finding (price feed, staleness)
    gates_notes    text,                                     -- market gates / supply caps finding
    timelock_notes text,                                     -- the curator's timelock finding
    allowlisted_tx text,                                     -- the allowlistMorphoVault tx hash (on-chain)
    status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'allowlisted', 'revoked')),
    author         text,                                     -- admin wallet (lower-cased), or 'seed'
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, morpho_vault)
);

-- 2) Wrapper provenance -- rows the create flow writes, the 010 reader merges (data-model.md sec.4)
CREATE TABLE IF NOT EXISTS sparkpoint_wrappers (
    vault_address   text        NOT NULL,                    -- the deployed wrapper (CREATE2, lower 0x)
    chain_id        integer     NOT NULL,                    -- network of the instance
    kind            text        NOT NULL DEFAULT 'morpho_wrapper'
                    CHECK (kind IN ('aave_launch', 'morpho_wrapper')),
    label           text        NOT NULL,                    -- branded display name (createVault ...label)
    morpho_vault    text,                                    -- wrapped curated vault (NULL for aave_launch)
    native_fee_bps  integer,                                 -- the wrapped Morpho fee (double-fee, III)
    deploy_tx       text,                                    -- CREATE2 deploy tx hash (NULL until signed)
    factory_address text,                                    -- the attesting SparkPointVaultFactory
    status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'live')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, vault_address)
);

CREATE INDEX IF NOT EXISTS idx_sparkpoint_wrappers_chain
    ON sparkpoint_wrappers (chain_id, created_at DESC);
