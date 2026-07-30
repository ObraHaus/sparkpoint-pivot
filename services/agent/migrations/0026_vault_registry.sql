-- 0026_vault_registry.sql — feature 024 multi-protocol vaults: the (chain, protocol, vault) REGISTRY
-- that replaces the single `SPARKPOINT_VAULT_ADDRESS` env var, plus the governance allowlist record and
-- the source-tagged APY snapshot store. Additive, forward-only, idempotent. Apply with PGCLIENTENCODING=UTF8.
--
-- WHY THIS EXISTS. Before 024 the service knew exactly ONE vault, resolved from an env var, and there was
-- no `vaults` table at all (0002_vault.sql's `fee_events.vault_address` comment claims it "mirrors
-- vaults.address" — that entity was never created). Supporting Aave + Morpho across Base mainnet, Base
-- Sepolia and Robinhood Chain 4663 makes "which vault" a per-row data question, not a deploy-time constant.
--
-- NON-CUSTODY (Constitution N1/N2/N5, v3.0.0). This is a DISPLAY + AUTHORIZATION registry, never a custody
-- surface:
--   * It holds NO keys and moves NO funds. Every column is re-derivable from chain (Principle III).
--   * It is NOT readable by the deterministic policy path. Per IV.5(d) the curated-vault record is
--     consulted at admission/display time only and MUST NOT leak into PolicyModule / SessionKeyValidator /
--     any agent strategy-direction path — exactly as the on-chain Morpho allowlist is isolated today.
--   * `status = 'redeem_only'` is the durable form of a RETIRED vault: SparkPoint stops authorizing
--     DEPOSITS while withdraw/redeem stays permanently open. N2 says only underlying liquidity may block
--     an exit, never a SparkPoint decision — so NOTHING in this table may ever gate a withdrawal. Losing
--     this table degrades discovery and disclosure, never custody.
--   * A user can always exit directly on-chain with this service entirely offline.
--
-- DECIMALS. `asset_decimals` and `share_decimals` are stored SEPARATELY and deliberately: a Morpho Vault V2
-- mints 18-dp shares over a 6-dp asset, while SparkPoint's own ERC-4626 uses 6/6. Assuming they match is a
-- 1e12 mis-scale on every displayed amount, so neither is derived from the other.
--
-- TWO "USDC"s. Base Sepolia genuinely has two: Aave's market + our launch vault use
-- 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f, while Morpho's markets use Circle's
-- 0x036CbD53842c5426634e7929541eC2318f3dCF7e. Both report symbol()="USDC" and 6 dp and are NOT
-- interchangeable — hence `asset_address` per row, not a per-chain constant.
--
-- FK note: consistent with 0021/0025, these tables are standalone (no FK churn into intent_bundles /
-- executions / recommendations).

-- ── enums (guarded — CREATE TYPE has no IF NOT EXISTS) ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE vault_protocol AS ENUM ('aave_v3', 'morpho_vault_v2', 'morpho_metamorpho_v1');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- first_party   = SparkPoint's own ERC-4626 (the Aave launch vault)
  -- fee_wrapper   = a Morpho Vault V2 Fee Wrapper SparkPoint owns (adapter list + critical gates abdicated)
  -- external_4626 = an allowlisted third-party ERC-4626 the user deposits into directly (passthrough)
  -- legacy_wrapper= a deployed SparkPointMorphoVault (SUPERSEDED for new deploys, v3.0.0)
  CREATE TYPE vault_kind AS ENUM ('first_party', 'fee_wrapper', 'external_4626', 'legacy_wrapper');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- live        = deposits + withdrawals open
  -- paused      = deposits paused on-chain (withdrawals STILL open — the vault's own pause is deposit-side)
  -- redeem_only = SparkPoint no longer authorizes deposits; withdrawals permanently open (RETIRED)
  -- deprecated  = hidden from discovery; still redeemable on-chain
  CREATE TYPE vault_status AS ENUM ('live', 'paused', 'redeem_only', 'deprecated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vault_apy_source AS ENUM ('morpho_api', 'aave_onchain', 'unavailable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── vault_registry — one row per (chain, vault) we display or authorize ───────────────────────────────
CREATE TABLE IF NOT EXISTS vault_registry (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id           integer          NOT NULL,
  protocol           vault_protocol   NOT NULL,
  kind               vault_kind       NOT NULL,
  -- What the user's deposit/withdraw actually targets.
  vault_address      text             NOT NULL,
  -- For a fee_wrapper / legacy_wrapper: its IMMUTABLE child. NULL for first_party + external_4626.
  child_address      text,
  asset_address      text             NOT NULL,
  asset_symbol       text             NOT NULL,
  asset_decimals     smallint         NOT NULL CHECK (asset_decimals BETWEEN 0 AND 36),
  share_decimals     smallint         NOT NULL CHECK (share_decimals BETWEEN 0 AND 36),
  status             vault_status      NOT NULL DEFAULT 'live',
  -- SparkPoint's own performance fee, in bps. Constitution caps this at 2000 (≤20%); enforced here too so
  -- a bad row can never *display* a fee the constitution forbids.
  sparkpoint_fee_bps smallint         NOT NULL DEFAULT 0 CHECK (sparkpoint_fee_bps BETWEEN 0 AND 2000),
  -- The CHILD's own fees, verbatim, so the UI can disclose the fee chain NET (IV.5 stacked-fee rule).
  native_fee_note    text,
  apy_source         vault_apy_source NOT NULL DEFAULT 'unavailable',
  label              text             NOT NULL,
  vetting_notes      text,
  created_at         timestamptz      NOT NULL DEFAULT now(),
  updated_at         timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT vault_registry_addr_lower  CHECK (vault_address = lower(vault_address)),
  CONSTRAINT vault_registry_child_lower CHECK (child_address IS NULL OR child_address = lower(child_address)),
  CONSTRAINT vault_registry_asset_lower CHECK (asset_address = lower(asset_address)),
  -- A wrapper without its child is unauditable; a non-wrapper with one is a data error.
  CONSTRAINT vault_registry_child_iff_wrapper CHECK (
    (kind IN ('fee_wrapper', 'legacy_wrapper') AND child_address IS NOT NULL)
    OR (kind IN ('first_party', 'external_4626') AND child_address IS NULL)
  ),
  UNIQUE (chain_id, vault_address)
);

CREATE INDEX IF NOT EXISTS vault_registry_chain_status_idx ON vault_registry (chain_id, status);
CREATE INDEX IF NOT EXISTS vault_registry_chain_protocol_idx ON vault_registry (chain_id, protocol);

-- ── vault_allowlist — the GOVERNANCE record + the FR-020 eligibility evidence ─────────────────────────
-- Mirrors the on-chain curated allowlist's intent for candidates we vet BEFORE any deploy/admission. The
-- eligibility columns are the automatable on-chain checks: provenance (isVaultV2 / isMetaMorpho), the three
-- CRITICAL gate setters permanently abdicated (the one real N2 hole in wrapping a third-party vault), the
-- asset match our own factory never checked, and a liquidity-ratio floor. All are re-derivable from chain.
CREATE TABLE IF NOT EXISTS vault_allowlist (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id               integer     NOT NULL,
  candidate_address      text        NOT NULL,
  -- 'allowlisted' | 'rejected' | 'pending' | 'revoked' — plain text so a new posture needs no enum churn.
  status                 text        NOT NULL DEFAULT 'pending',
  -- FR-020 eligibility evidence. NULL = not yet checked (never assume a pass).
  provenance_verified    boolean,
  gates_abdicated        boolean,
  asset_matches_expected boolean,
  liquidity_ratio_bps    integer     CHECK (liquidity_ratio_bps IS NULL OR liquidity_ratio_bps BETWEEN 0 AND 10000),
  native_performance_fee_bps integer CHECK (native_performance_fee_bps IS NULL OR native_performance_fee_bps BETWEEN 0 AND 10000),
  native_management_fee_bps  integer CHECK (native_management_fee_bps IS NULL OR native_management_fee_bps BETWEEN 0 AND 10000),
  curator_address        text,
  checked_at             timestamptz,
  vetting_notes          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_allowlist_addr_lower CHECK (candidate_address = lower(candidate_address)),
  UNIQUE (chain_id, candidate_address)
);

CREATE INDEX IF NOT EXISTS vault_allowlist_chain_status_idx ON vault_allowlist (chain_id, status);

-- ── vault_apy_snapshots — timestamped, SOURCE-TAGGED yield reads ──────────────────────────────────────
-- Written by a BACKGROUND poller, never on the request path: the Morpho API is rate-limited and sustained
-- abuse reportedly triggers a long cooldown, so a chatty read path would take the whole feed down.
--
-- HONESTY (Principle III, and spec 010's rule). `net_apy_bps` is NULLABLE and `source = 'unavailable'` is a
-- FIRST-CLASS value: Morpho's API covers NO testnet (its chains list is all mainnets; chainId 84532 is
-- rejected outright), so on Base Sepolia the honest answer is "unavailable", never 0. A 0 here would be a
-- fabricated figure. `net_apy_bps` is stored NET of the entire fee chain (child fees + our fee + rewards)
-- because that is what Morpho's `avgNetApy` already returns and what IV.5 requires us to disclose.
CREATE TABLE IF NOT EXISTS vault_apy_snapshots (
  id           bigserial PRIMARY KEY,
  chain_id     integer          NOT NULL,
  vault_address text            NOT NULL,
  source       vault_apy_source NOT NULL,
  -- NULL ⇒ genuinely unavailable. Never write 0 to mean "unknown".
  net_apy_bps  integer,
  tvl_usd      numeric(20, 2),
  liquidity_usd numeric(20, 2),
  fetched_at   timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT vault_apy_addr_lower CHECK (vault_address = lower(vault_address)),
  CONSTRAINT vault_apy_unavailable_is_null CHECK (source <> 'unavailable' OR net_apy_bps IS NULL)
);

CREATE INDEX IF NOT EXISTS vault_apy_latest_idx
  ON vault_apy_snapshots (chain_id, vault_address, fetched_at DESC);

-- ── seed: the vaults that exist TODAY, so day-one reads are byte-identical to the env-var behaviour ────
-- Base Sepolia (84532) only — Base mainnet and Robinhood 4663 have no SparkPoint deployment yet, and a row
-- for an undeployed vault would be a fabricated capability.
INSERT INTO vault_registry (
  chain_id, protocol, kind, vault_address, child_address, asset_address, asset_symbol,
  asset_decimals, share_decimals, status, sparkpoint_fee_bps, native_fee_note, apy_source, label, vetting_notes
) VALUES
  (84532, 'aave_v3', 'first_party',
   lower('0x15D269B1D4fb3581E5a47482A70215e63Ed547f2'), NULL,
   lower('0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f'), 'USDC', 6, 6,
   'live', 1000, NULL, 'aave_onchain', 'Aave Yield Vault',
   'The launch vault. Own ERC-4626 over Aave v3; real _highWaterMark, so the "over a high-water mark" fee copy is accurate for THIS row only.'),
  (84532, 'morpho_metamorpho_v1', 'legacy_wrapper',
   lower('0xff0a43FA397a90c1277C96A783e1171e1efbE9BB'),
   lower('0x7f377fe96DaD2eEa494F0fb095233EF4aB438420'),
   lower('0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f'), 'USDC', 6, 6,
   'redeem_only', 1000, 'Underlying is a MOCK, not a Morpho vault — no native fee.', 'unavailable',
   'SparkPoint Morpho USDC',
   'RETIRED 2026-07-30 (024 Phase 0). Its immutable underlying is the test-tree MockMorphoVault, whose simulateYield/simulateLoss/lendOut/setAvailableLiquidity/setMaxReturnsZero hooks are external with NO access control. Deposits closed; withdrawals permanently open (N2). Superseded by Morpho Vault V2 Fee Wrappers per constitution v3.0.0.')
ON CONFLICT (chain_id, vault_address) DO NOTHING;

-- The mock is recorded as REJECTED so it can never be re-admitted by a future allowlist pass.
INSERT INTO vault_allowlist (
  chain_id, candidate_address, status, provenance_verified, gates_abdicated, asset_matches_expected, vetting_notes
) VALUES
  (84532, lower('0x7f377fe96DaD2eEa494F0fb095233EF4aB438420'), 'rejected', false, false, true,
   'TESTNET DEMO MOCK — not a Morpho vault. Unpermissioned simulation hooks let any caller move share price or drain withdrawable liquidity. MUST NOT be admitted on any chain.')
ON CONFLICT (chain_id, candidate_address) DO NOTHING;
