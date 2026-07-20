## What & why

<!-- One or two sentences. Link the spec/issue if there is one. -->

## Release housekeeping (feature 006 — the force-refresh shows /changelog ~60s after deploy)

- [ ] `CHANGELOG.md` — dev bullet under `## [Unreleased]` for any behavior/schema/infra change
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for any user-visible change
      (tester-friendly; no dev detail) — or the **`skip-changelog`** label is applied for an infra-only PR
- [ ] Migrations apply cleanly (`PGCLIENTENCODING=UTF8`); every new agent seed dir has a Dockerfile `COPY`
- [ ] Tests / typecheck / lint green; deploy respects **never-Friday**

<!-- The `changelog-required` check enforces the two changelog boxes above. -->
