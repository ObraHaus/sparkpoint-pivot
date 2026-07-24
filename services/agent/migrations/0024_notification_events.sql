-- 0024_notification_events.sql — feature 021 phase 2: edge-triggered notifications a background poller
-- writes (the ones phase 1 couldn't derive-on-read because they watch for a CHANGE over time):
-- a "vault near capacity" (caps crossing), an "Aave rate moved" (rate delta), and a proactive
-- "new recommendation for you" per wallet. Unlike phase-1 rows (derived live from indexed data), these
-- are real, provable EVENTS captured at the moment they occurred (still never fabricated — each is a
-- real on-chain/model reading at a real time). `notification_poller_state` holds the last-seen value
-- per signal so the poller edge-triggers (emits only on a genuine change) instead of re-notifying.
-- Additive, forward-only. Apply with PGCLIENTENCODING=UTF8.
--
-- NON-CUSTODY (N1/N2/N3/N5): advisory notifications only — no key, no signature, no fund authority,
-- never on the withdraw/exit path (N2). The poller is off the request path and fail-open; losing these
-- tables only means those alerts don't show, never traps funds.

-- ── notification_events — edge-triggered events the poller emits (deduped by content) ─────────────
CREATE TABLE IF NOT EXISTS notification_events (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet      CITEXT,                                  -- NULL = protocol-wide (caps/rate); set = per-user (new-rec)
    category    TEXT         NOT NULL,                   -- a NotifKey: capsNearLimit | rateChanges
    type        TEXT         NOT NULL,                   -- vault_near_capacity | rate_moved | new_recommendation
    title       TEXT         NOT NULL,
    body        TEXT         NOT NULL,
    icon        TEXT         NOT NULL DEFAULT 'bell',
    href        TEXT,
    dedupe_key  TEXT         NOT NULL,                   -- one row per distinct crossing (poller idempotency)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT notification_events_dedupe_uniq UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS notification_events_created_idx ON notification_events (created_at DESC);
CREATE INDEX IF NOT EXISTS notification_events_wallet_idx ON notification_events (wallet, created_at DESC);

-- ── notification_poller_state — the last-seen value per signal (edge detection) ───────────────────
CREATE TABLE IF NOT EXISTS notification_poller_state (
    key         TEXT         PRIMARY KEY,                -- e.g. cap:vault, rate:aave, newrec:<wallet>
    num         BIGINT,                                  -- numeric state (cap fill bps, last rate bps)
    txt         TEXT,                                    -- text state (last-notified rec dedupe_key)
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
