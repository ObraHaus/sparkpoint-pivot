-- =============================================================================
-- 0017_subscriptions.sql  -  Feature 012: SRK-paid Premium purchase
-- =============================================================================
-- Records verified on-chain SRK payments and the time-boxed Premium subscriptions they grant.
-- The grant itself REUSES the 008 tier engine (wallet_tier.tier='premium', source='srk'); this
-- migration only ADDS the receipt ledger, the subscription-history table, and the `expires_at`
-- column that the 008 tier-resolve now honours.
--
-- NON-CUSTODY (Constitution N1/N2): a subscription NEVER gates the vault, the withdraw/exit path,
-- or any funds movement -- it is an advisory-compute entitlement only (chat/recs/onboarding).
--
-- Anti-replay: payments.UNIQUE(network_id, tx_hash) is THE control that stops one on-chain payment
-- from granting Premium twice (NOT the BFF idempotency cache). Addresses/hashes stored LOWERCASE.
-- Amounts are raw base units (NUMERIC; SRK is 18dp). No wallet_tier.source CHECK change is needed
-- -- 'srk' is ALREADY in the 0015 CHECK.
--
-- Applied via yoyo with the deploy batch (idempotent; PGCLIENTENCODING=UTF8), BEFORE the agent
-- boots. Latest on develop before this = 0016_vault_factory (feature 011). Not applied to the live
-- DB here.
-- =============================================================================

-- Immutable receipt of one verified SRK payment. UNIQUE(network_id, tx_hash) = the anti-replay key.
CREATE TABLE IF NOT EXISTS payments (
    id           bigserial   PRIMARY KEY,
    network_id   text        NOT NULL DEFAULT 'base' REFERENCES networks (id),
    tx_hash      text        NOT NULL CHECK (tx_hash = lower(tx_hash)),
    buyer        text        NOT NULL CHECK (buyer = lower(buyer)),
    token        text        NOT NULL CHECK (token = lower(token)),
    amount_raw   numeric     NOT NULL CHECK (amount_raw >= 0),
    block_number bigint      NOT NULL,
    verified_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (network_id, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_payments_buyer ON payments (buyer, verified_at DESC);

-- Subscription history (audit / provable source-of-truth). The HOT PATH resolves premium from
-- wallet_tier.expires_at (below); this table records every grant for provable history + the revenue
-- membership stream (feature 013). expires_at is NOT NULL here -- a paid sub always has an end date;
-- a non-expiring admin grant lives only in wallet_tier with a NULL expires_at.
CREATE TABLE IF NOT EXISTS subscriptions (
    id              bigserial   PRIMARY KEY,
    wallet          text        NOT NULL CHECK (wallet = lower(wallet)),
    tier            text        NOT NULL REFERENCES tier_definitions (tier),
    started_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    payment_tx_hash text        NOT NULL CHECK (payment_tx_hash = lower(payment_tx_hash)),
    amount_raw      numeric     NOT NULL CHECK (amount_raw >= 0)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_wallet ON subscriptions (wallet, started_at DESC);

-- Expiry for a tier grant. NULL => non-expiring (admin/env-seed grants keep working unchanged).
-- The 008 tier-resolve now treats a row with a PAST expires_at as absent => fail-closed to free,
-- with no sweeper on the hot path.
ALTER TABLE wallet_tier ADD COLUMN IF NOT EXISTS expires_at timestamptz;
