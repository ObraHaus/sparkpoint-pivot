# Quickstart — validate Force-Refresh + What's New end-to-end

Prereqs: web + agent running on develop; an authenticated (beta-allowlisted) wallet; ability to trigger a deploy (push to develop) or simulate a new build id locally.

## 1. Version signal
- `curl -s https://<web>/api/version` → `{"version":"<id>"}`, `Cache-Control: no-store`, HTTP 200 JSON (even under SITE_LOCKED).
- Confirm the page's baked `NEXT_PUBLIC_BUILD_ID` equals that value on a fresh load (CI assert covers this).

## 2. Auto-reload (happy path)
- Open the app; note the build id. Deploy a trivial change (or locally bump `SPARKPOINT_BUILD_ID`).
- Within ~60 s the bottom-left banner appears ("A new version is ready") and counts down 60 s, then reloads. `Reload now` skips the wait. There is no dismiss.

## 3. Safety gating (must not interrupt)
- Start a deposit and reach the signing/broadcast step (testnet). Trigger a new build id.
- EXPECT: the banner switches to "we'll refresh when you're done" and does NOT reload until the tx settles.
- Navigate to `/exit`; trigger a new build id. EXPECT: never auto-reloads there.
- Start a chat stream / type an unsent draft; EXPECT: reload deferred; draft preserved after the eventual reload.

## 4. What's New greeting
- With ≥1 new `whats-new.yml` entry, reload onto a new build. EXPECT: the greeting lists the new items; "Got it" dismisses and it does not reappear for that build.
- Deploy an infra-only change (no new entry). EXPECT: fresh code loads, but NO greeting (never blank).
- First-time user (clear `sp-app-version-seen`): EXPECT: no greeting; marker set silently.

## 5. Loop-breaker / no-op safety
- Point `/api/version` at a value the client can never match (test). EXPECT: after one reload it stops and shows a manual Refresh button (no infinite loop).
- Make `/api/version` 500 / non-JSON. EXPECT: no banner, no reload (no-op-on-unknown).

## 6. Changelog source + ingest
- Add an entry to `content_seed/whats-new.yml`, redeploy the agent (or `POST /admin/content/reingest`). EXPECT: it appears at `/changelog`; re-ingest twice → no duplicate rows; an operator hand-edit is not reverted.

## 7. Enforcement gate
- Open a PR touching `apps/web/src` with no `CHANGELOG.md`/`whats-new.yml` change → `changelog-required` is RED and the merge is blocked.
- Add both entries → GREEN. Or apply `skip-changelog` on an infra-only PR → GREEN (audited).

## 8. Deploy smoke check
- Post-deploy: `GET /content/changelog` active count == `whats-new.yml` active count; `GET /api/version` == baked id.
