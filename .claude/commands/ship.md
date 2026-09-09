---
description: Run the SparkPoint release checklist before opening a PR to develop.
---

You are running the **/ship** release checklist for SparkPoint (feature-006 housekeeping is mandatory).
Do these in order and STOP with a clear report if any step fails — never open a PR on a red step.

1. **Scope** — `git diff --name-only origin/develop...HEAD` (plus uncommitted). Note whether it touches
   user-facing product source (`apps/web/src`, `services/agent/src`).
2. **Both changelogs** (if user-facing):
   - `CHANGELOG.md` has a bullet under `## [Unreleased]` describing the change (dev-technical is fine).
   - `services/agent/content_seed/whats-new.json` has a **client-facing** entry (tester-friendly, no dev
     detail, stable `slug`). Infra-only? Plan to apply the `skip-changelog` PR label instead.
3. **Version signal** — nothing hand-bumped; confirm the build derives the id automatically.
4. **Migrations / seeds** — new agent migrations apply with `PGCLIENTENCODING=UTF8`; every new seed dir
   has an explicit `COPY` in `services/agent/Dockerfile`.
5. **Green** — run web `tsc` + `eslint` + `node --test`; agent `ruff` + `mypy` + `pytest`. Paste evidence.
6. **PR** — only after 1–5 pass: open the PR to `develop` with the validation evidence in the body.
   Respect **never-Friday** (PH/Asia-Manila). Confirm with the operator before the actual push/PR.
