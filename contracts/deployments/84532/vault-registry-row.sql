-- 024 Phase 3 — register the REAL Morpho Vault V2 on Base Sepolia (84532) in `vault_registry`.
--
-- NOT A YOYO MIGRATION, DELIBERATELY. `0026_vault_registry` is already APPLIED to develop
-- (2026-07-30 11:35:20 UTC), and `yoyo apply` applies EVERY pending migration — including other
-- features' work, which is literally how 0026 reached develop (it went in on feature 023's run).
-- This file adds a DATA row to an already-applied schema, and `db/vault_registry.py` sanctions
-- exactly that: "rows are seeded by the migration and changed by a reviewed migration OR AN
-- OPERATOR, never by a request handler." There is no programmatic write path for `vault_registry`
-- anywhere in the service, by design.
--
-- It lives OUTSIDE services/agent/migrations/ on purpose: `services/agent/yoyo.ini` sets
-- `sources = %(here)s/migrations`, so a file there would become a numbered migration and re-couple
-- this row to the shared migration queue. Here it is committed and reviewable with none of that.
--
-- Run once, by the operator:
--   PGCLIENTENCODING=UTF8 psql "$DATABASE_URL" -f contracts/deployments/84532/vault-registry-row.sql
--
-- Idempotent (both statements are ON CONFLICT DO NOTHING); safe to re-run.
--
-- NON-CUSTODY (Constitution N1/N2/N5, v3.0.0). These are DISPLAY + AUTHORIZATION rows. They hold no
-- keys, move no funds, and every column is re-derivable from chain. NOTHING here may ever gate a
-- withdrawal, and losing these rows degrades discovery/disclosure only — never custody.
--
-- THIS ROW IS INERT TODAY, AND THAT IS EXPECTED, NOT BROKEN. Vault resolution hard-filters
-- `kind = 'first_party' AND status = 'live'`, so a `fee_wrapper` row cannot move the deposit target.
-- Its only visible effect is the `vaults` array in `GET /admin/vault-registry`. Verify there, not in
-- the logs (the fallback warning is memoised per chain).
BEGIN;

-- ── the vault itself ────────────────────────────────────────────────────────────────────────────
-- kind = 'fee_wrapper' (NOT 'external_4626', NOT 'first_party'):
--   * 0026 defines fee_wrapper as "a Morpho Vault V2 Fee Wrapper SparkPoint owns (adapter list +
--     critical gates abdicated)" — a literal description of what was deployed.
--   * external_4626 means "an allowlisted THIRD-PARTY ERC-4626 the user deposits into directly
--     (passthrough)", which is false for a vault our own 2-of-3 Safe owns.
--   * 'first_party' would be actively DANGEROUS: it is in the HWM kind set (wrong fee copy) and it
--     would create a SECOND live first-party row on 84532, making the resolver ambiguous. Today
--     `ORDER BY created_at ASC` keeps the Aave vault winning, so the mistake would stay invisible
--     until someone retired that row and the deposit target silently moved.
-- Both fee_wrapper and external_4626 map to the same honest `per_period_gain` disclosure, so this
-- choice has zero wire consequence — it is purely about the record being true.
INSERT INTO vault_registry (
  chain_id, protocol, kind, vault_address, child_address, asset_address, asset_symbol,
  asset_decimals, share_decimals, status, sparkpoint_fee_bps, native_fee_note, apy_source,
  label, vetting_notes
) VALUES (
  84532,
  'morpho_vault_v2',
  'fee_wrapper',
  lower('0x756C41dD33481620EbCB0357F759d31c9eE72170'),
  -- The `child_address`. 0026's column comment presumes the canonical V2-over-MetaMorpho shape ("its
  -- IMMUTABLE child"), which does not exist on this chain: `MorphoVaultV1AdapterFactory` has no
  -- bytecode on 84532, so the canonical Fee Wrapper path could not run. The auditable "what is
  -- underneath" is therefore the market adapter, one-per-vault and deterministic from
  -- `morphoMarketV1AdapterV2(vault)`. It is NOT strictly immutable — `removeAdapter` exists behind a
  -- 3-day timelock — and that deviation is recorded here rather than glossed over.
  lower('0x4C4dCd2e2Bb985a606C1e7d4822bB330637D8E24'),
  -- CIRCLE's USDC. NOT Aave's 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f, which is what the rest of
  -- the 84532 address book calls `usdc`. Both report symbol()=='USDC' at 6 dp and are NOT
  -- interchangeable; Morpho's markets use this one. This is the whole reason asset_address is
  -- per-row rather than a per-chain constant.
  lower('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  'USDC',
  6,    -- asset_decimals
  18,   -- share_decimals — NOT 6. The V2 applies a decimals offset (virtualShares() == 1e12).
        -- Stored separately from asset_decimals precisely because assuming they match is a 1e12
        -- mis-scale on every displayed amount.
  'live',
  0,    -- sparkpoint_fee_bps — the LIVE on-chain value. `performanceFee()` reads 0 because the
        -- deploy never called setPerformanceFee. Do NOT copy the launch vault's 1000: displaying a
        -- fee we do not charge is exactly the dishonesty Principle III forbids. Raising it later is
        -- a curator action by the Safe behind a 3-day timelock, and this row must follow it.
  'SparkPoint''s fee IS this Vault V2''s own performanceFee() — there is no child vault to stack on, '
  'so there is no second layer to disclose. The vault allocates into Morpho Blue market '
  '0x01351cf859346bbae655f1c9da71ba0e9ad201dd79a276c28f34e574386b0bfb, which charges no vault-level '
  'fee (its market fee reads 0). Read performanceFee()/managementFee() on chain for live values; both '
  'were 0 at registration.',
  'unavailable',   -- Morpho's API covers NO testnet (chainId 84532 is rejected outright), so the
                   -- honest answer here is "unavailable" and net_apy_bps must stay NULL. A 0 would
                   -- be a fabricated yield, and the vault_apy_unavailable_is_null CHECK enforces it.
  'SparkPoint USDC Yield',
  'Broadcast 2026-07-30 in 52 receipt-checked transactions; role handover tx '
  '0x5f44f1af009a303da311ccfc4698d4511acfa9ccf6ad01847f8d7f06c11958fd. Morpho''s OWN audited Vault '
  'V2 from factory 0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0 — no bespoke SparkPoint custody '
  'Solidity, per constitution v3.0.0. Verified live after the handover: FR-020 — isVaultV2 true, '
  'setReceiveSharesGate/setSendSharesGate/setReceiveAssetsGate ALL permanently abdicated, asset() == '
  'Circle USDC, performanceFee/managementFee 0/0. FR-021 — owner + curator + sentinel = the 2-of-3 '
  'Safe 0xCB135893C84876aab9E10792b56e5bEa91dc578f. FR-022 — name/symbol carry no "morpho". 3-day '
  'timelocks on all 7 curator selectors. Dead deposit placed: 1e18 SHARES to 0xdead = exactly '
  '1.000000 USDC (measured, not inferred; the argument is shares, not assets). A Vault V2 keeps NO '
  'high-water mark, so the fee basis is per_period_gain (T024) — a gain following an earlier loss IS '
  'charged. NOTE: maxDeposit/maxMint/maxWithdraw/maxRedeem are all `pure returns (0)` on a V2 and are '
  'NOT enforced in deposit/withdraw — never derive a UI limit from them. KNOWN TESTNET POSTURE: the '
  'deployer remains an allocator (setIsAllocator is not timelocked, so the Safe can revoke it '
  'immediately); this must NOT carry over to a mainnet Fee Wrapper.'
)
ON CONFLICT (chain_id, vault_address) DO NOTHING;

-- ── the governance/eligibility record ───────────────────────────────────────────────────────────
-- Column-for-column what contracts/script/vault-eligibility-check.sh asserted against live chain
-- state on 2026-07-30 (it reported PASS for this candidate).
INSERT INTO vault_allowlist (
  chain_id, candidate_address, status, provenance_verified, gates_abdicated,
  asset_matches_expected, native_performance_fee_bps, native_management_fee_bps,
  curator_address, checked_at, vetting_notes
) VALUES (
  84532,
  lower('0x756C41dD33481620EbCB0357F759d31c9eE72170'),
  'allowlisted',
  true,   -- MorphoVaultV2Factory.isVaultV2(vault) == true
  true,   -- all three CRITICAL gate setters abdicated — permanent, so the N2 hole is shut forever
  true,   -- asset() == 0x036cbd53842c5426634e7929541ec2318f3dcf7e
  0,      -- performanceFee() → 0 bps (WAD 0)
  0,      -- managementFee()  → 0 bps (WAD 0)
  lower('0xCB135893C84876aab9E10792b56e5bEa91dc578f'),
  now(),
  'FR-020 evidence from contracts/script/vault-eligibility-check.sh 84532 against the live vault; '
  'the gate is now enforcing on every PR via .github/workflows/vault-eligibility.yml. '
  'liquidity_ratio_bps deliberately left NULL — the gate does not assert a liquidity floor (a Vault '
  'V2''s withdrawable liquidity is idle assets plus what each Blue market can currently pay, which '
  'needs Morpho''s indexer), and NULL means NOT CHECKED, never a pass.'
)
ON CONFLICT (chain_id, candidate_address) DO NOTHING;

COMMIT;
