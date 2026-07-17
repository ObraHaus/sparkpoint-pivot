-- =============================================================================
-- 0011_content_entries.sql  -  Alpha: admin-authored changelog + announcement content
-- =============================================================================
-- The "always-hot" alpha shows a LIVE CHANGELOG page and an admin-configurable ANNOUNCEMENT
-- (surfaced in the sidebar tip widget). Both are admin-curated, tester-friendly content that must
-- be editable WITHOUT a deploy, so they live here (not the dev-oriented git CHANGELOG.md). One
-- table with a `type` discriminator serves both: type='changelog' rows are the What's-New feed;
-- the newest active type='announcement' row is the sidebar banner.
--
-- Mirrors knowledge_notes (0008): a first-party table + an append-only content_audit written in
-- the SAME transaction as every mutation. ACCESS/content only -- never custody (N2).
-- =============================================================================

CREATE TABLE IF NOT EXISTS content_entries (
    id           bigserial   PRIMARY KEY,
    type         text        NOT NULL CHECK (type IN ('changelog', 'announcement')),
    title        text        NOT NULL,
    body         text        NOT NULL,
    tag          text        CHECK (tag IN ('New', 'Fixed', 'Improved', 'Announcement')),
    cta_label    text,
    cta_href     text,
    is_active    boolean     NOT NULL DEFAULT true,
    published_at timestamptz NOT NULL DEFAULT now(),
    author       text,                                   -- admin wallet (lower-cased), or 'seed'
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_entries_type_pub
    ON content_entries (type, published_at DESC);

CREATE TABLE IF NOT EXISTS content_audit (
    id      bigserial   PRIMARY KEY,
    action  text        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    subject text        NOT NULL,                        -- the entry id (as text) affected
    actor   text,                                        -- admin wallet (lower-cased), or NULL
    detail  jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_audit_at ON content_audit (at DESC);

-- Seed: initial tester-friendly changelog + a welcome announcement (Alpha launch content). Runs
-- once (yoyo tracks applied migrations); the operator can edit/delete any of these via Admin →
-- Updates. published_at is staggered so the feed reads as a real timeline (newest first).
INSERT INTO content_entries (type, tag, title, body, cta_label, cta_href, author, published_at) VALUES
  ('changelog', 'New', 'Robinhood Chain testnet',
   'Chat and portfolio now work on Robinhood Chain testnet. The Aave vault stays on Base for now.',
   NULL, NULL, 'seed', now()),
  ('changelog', 'New', 'Manual swap',
   'Swap tokens directly on-chain via Uniswap V3 or Aerodrome — non-custodial, you sign every trade.',
   'Open swap', '/swap', 'seed', now() - interval '1 day'),
  ('changelog', 'Improved', 'Faster assistant',
   'We moved Sparky to a faster model, so replies come back quicker.',
   NULL, NULL, 'seed', now() - interval '1 day'),
  ('changelog', 'New', 'Grounded chat assistant',
   'Sparky answers with real completions and cites the SparkPoint knowledge base when it explains a concept.',
   'Chat with Sparky', '/chat', 'seed', now() - interval '2 days'),
  ('changelog', 'New', 'Live portfolio',
   'Your portfolio shows real vault positions, idle USDC, and ETH — read live from the chain, with honest states when offline or on the wrong network.',
   'Open portfolio', '/portfolio', 'seed', now() - interval '3 days');

INSERT INTO content_entries (type, tag, title, body, cta_label, cta_href, author) VALUES
  ('announcement', 'Announcement', 'Welcome to the SparkPoint Alpha',
   'You are testing an early build on Base Sepolia testnet. Explore freely — and check the Changelog for what is new.',
   'See what''s new', '/changelog', 'seed');
