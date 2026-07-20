# Contract: .github/workflows/changelog-required.yml

Pre-merge gate. Fails a develop PR that changes user-facing product code without updating both changelog surfaces.

**Trigger**: `pull_request: { branches: [develop] }` — **no `paths:` filter** (a path-skipped required check stays perpetually pending). Compute the diff internally.

**Job `changelog`** (ubuntu-latest, no secrets):
1. `checkout` with `fetch-depth: 0`.
2. `CHANGED = git diff --name-only origin/$BASE...HEAD`.
3. `PRODUCT = CHANGED matching ^apps/web/src/ or ^services/agent/src/`.
4. If `PRODUCT` non-empty:
   - require added lines under `## [Unreleased]` in `CHANGELOG.md`, AND
   - require `services/agent/content_seed/whats-new.yml` in `CHANGED`.
   - else → **exit 1** (red).
5. **Escape hatch**: skip if the PR has label `skip-changelog` OR the body/commit contains `[skip changelog]` (recorded for audit).

**Binding**: `oh-git-guard.sh` runs `gh pr checks` before `gh pr merge` and blocks on red/pending; check-name-agnostic so this gate binds once present. (GitHub Free: binds agent-driven merges; no server-side required check.)
