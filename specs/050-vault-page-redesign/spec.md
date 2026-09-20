# Spec 050 — Vault page redesign (Option C, card-first, live-only)

**Status:** approved by operator 2026-09-20 (wireframe artifact `docs/artifacts/vault-page-wireframes.html`,
Option C chosen and refined) · **Owner:** build · **Depends on:** 048 (curated board), 049 (V3 wrapper admission).

## Why

The public `/vault` page currently renders a hero + **table** of every approved curated vault, including
vaults with **no wrapper yet** (a direct ERC-4626 deposit) and rows that are still in flight. The operator
wants the page to be card-first and to show **only what a user can actually deposit into today**; the
in-flight states (candidates, approved-unwrapped, whitelisted/cooling, cancelled/failed) belong to the
admin panel. The recommendation story moves into a full-width feature card, and the list lazy-loads on
scroll.

## What (user-visible)

1. **Feature card (top):** the recommendation — badges (Sparky recommends, AI-curated, Wrapped,
   perf-fee), net APY, 30d sparkline, TVL/withdrawable, Deposit + Ask Sparky CTAs, honest fee/exit note.
2. **Admin-only panel (directly under the feature):** rendered **only for an admin session**; shows
   in-flight counts (approved-unwrapped, whitelisted/cooling, failed, candidates) and a **Manage in
   Admin → Vaults** button (`/admin/vault?section=curated`). Public sessions never see it, and the public
   board response never carries those rows.
3. **All live vaults (below):** cards (no table) with name/curator, badges, net APY, sparkline (when
   history exists), TVL/withdrawable/perf-fee, optional "why", Deposit/Details CTAs. **Infinite scroll:**
   batches revealed on scroll, a loading row, then the terminal message
   *“You’ve reached the bottom — that’s every live vault Sparky has wrapped.”* No pagination.
4. **Empty state:** when nothing is wrapped/live, the public sees an honest "Sparky is screening vaults"
   card (no upcoming/pending rows); an admin additionally sees the in-flight panel.

## Rules (non-negotiable)

- **Public list = `status === "approved" && wrapped && wrapperAddress != null`.** The agent filters this
  server-side; the UI never receives in-flight rows.
- **Hero precedence:** admin-pinned **live** vault → published recommendation **if live** → highest-score
  live vault. No live vaults ⇒ `pick = null`.
- Figures are stored scans (`null → "—"`, never 0); the perf-fee line stays performance-only above HWM;
  exits are never gated (N2); the deposit rail disclosure is unchanged.
- The admin panel's data comes from **admin-gated** endpoints only (404 for non-admins).

## Data

- Existing `/vaults/curated` fields cover everything except the sparkline.
- **New (additive):** `curated_vault_apy_history` (migration 0041) — one row per vault per scan
  (`chain_id, vault_address, observed_at, net_apy_bps`); the public read returns the last ~30 points per
  vault as `apyHistory`. Fail-open: unapplied table ⇒ empty history ⇒ cards render without a chart.

## Out of scope

- Wrapper/child history backfill, new scoring, any on-chain change, the admin curation UI itself.
- Cursor pagination (client-side chunking is enough while the live set is small; add `?cursor=` later).

## Acceptance

- `/vault` shows only wrapped vaults; a pending/approved-unwrapped vault never renders publicly.
- Admin session sees the in-flight panel + deep link; public session never does (and the API never sends it).
- Scrolling reveals batches; the bottom message appears after the last batch; no pagination controls.
- Empty state renders honestly with no in-flight rows.
- Unit tests: agent (`public_board` filter/hero/note, history store) + web (hero/live filter, batch math,
  sparkline path, admin counts). Full suites green; both changelogs updated.
