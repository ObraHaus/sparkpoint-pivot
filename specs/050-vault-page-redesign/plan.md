# Plan 050 — Vault page redesign

## Constitution check

- **N1/N2:** display-only; the deposit rail and exits are untouched; no new fund path. ✅
- **N3/N4:** no key material; admin panel reads existing admin-gated endpoints only. ✅
- **N5 / IV.5:** no contract change; the public filter is a display rule over stored curation. ✅
- **III (Provable):** figures stay stored-scan values (`null → —`); the sparkline is real stored history,
  never synthesized; empty states say why. ✅
- **VII (YAGNI):** one new additive table (scan history) and no new service; infinite scroll is
  client-side until the live set justifies a cursor. ✅

## Approach

### Agent (`services/agent`)
1. `api/curated_vaults.py::public_board` becomes **live-only**:
   - `live = {v | status==approved, wrapped, wrapper_address}`;
   - hero: pinned-live → published-rec pick if live → top-score live (score desc, tvl desc, address);
   - `vaults` = live; `alternates` = rec alternates ∩ live;
   - `note`: a new honest "nothing wrapped yet" sentence when there are no live vaults.
2. `db/curated_vaults.py`:
   - migration **0041** `curated_vault_apy_history` (additive, indexed, fail-open reads);
   - `upsert_scan_vaults` also appends one history row per vault with a non-null `netApyBps`;
   - new `apy_history(chain_id, addresses, limit_per=30) -> dict[str, list[point]]` (fail-open `{}`).
3. `list_curated` passes history into `public_board`, which merges `apyHistory` into each vault wire
   (`_hydrate`). `chat.py` keeps calling `public_board` and inherits the live-only rule.
4. Tests: update `test_curated_vaults_store.py` + `test_curated_vaults.py` fixtures to wrapped vaults;
   add filter/hero/note cases + history store tests + migration-next-free test.

### Web (`apps/web`)
1. `lib/curation/model.ts`: add `ApyPoint` + optional `apyHistory` to `CurationVault`.
2. **New** `lib/curation/boardV2.ts` (pure, tested):
   - `liveVaults(board)` (defensive filter), `heroPick(board)` (mirror of the server precedence),
   - `nextBatch(shown, total, size)`, `sparklinePath(points, w, h)` (chronological, nulls skipped),
   - `inFlightCounts(entries, candidates, curationVaults)` for the admin panel.
3. **Rewrite** `components/vault/CuratedBoard.tsx` to the Option C design:
   - `FeatureCard` (gradient, badges, APY, sparkline, stats, CTAs),
   - `AdminInFlightPanel` (`useSession().session?.admin`; fetches `/api/agent/admin/vaults/whitelist`
     + `/api/agent/admin/vaults/curation`; hides on any failure; deep link `/admin/vault?section=curated`),
   - `VaultCardGrid` (IntersectionObserver batches of 6, spinner row, terminal message),
   - empty/loading/error states.
4. `components/screens/vault.css`: board styles (feature, cards, chips, spinner, admin panel) on the
   existing tokens; light/dark inherited.
5. Tests: `lib/curation/boardV2.test.ts`.

### Wiring / disclosure
- No page changes needed (`vault/page.tsx` already renders `CuratedBoard` in both branches).
- Both changelogs (repo + in-app seed) in the same PR.

## Verification
- `services/agent`: `.venv/bin/ruff check .` · `.venv/bin/mypy src/sparkpoint_agent` · `.venv/bin/pytest -q`
- `apps/web`: `pnpm --filter @sparkpoint/web test` · `tsc --noEmit` · `eslint`
- Live sanity after deploy: `/vault` shows Steakhouse only when wrapped; the admin panel appears for the
  operator session; the public payload contains no in-flight rows.

## Rollback
- Web: revert the PR (page returns to hero+table). Agent: revert the filter; migration 0041 is additive
  and unused by old code, so it can stay (`DROP TABLE` later if desired).
