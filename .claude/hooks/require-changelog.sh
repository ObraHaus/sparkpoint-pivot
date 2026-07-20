#!/usr/bin/env bash
# require-changelog.sh — Stop / SubagentStop hook (feature 006, advisory).
#
# If product source under apps/web/src or services/agent/src changed vs origin/develop but neither
# changelog surface was updated, BLOCK the agent from finishing with a reminder. Agent-scoped only
# (a human merge is gated by the changelog-required CI check + oh-git-guard, not this). Fail-OPEN on
# any error so it can never wedge a session.
set -u
command -v git >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
CWD=""
if command -v jq >/dev/null 2>&1; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
fi
[ -z "$CWD" ] && CWD="$(pwd)"
cd "$CWD" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BASE="origin/develop"
git rev-parse --verify -q "$BASE" >/dev/null 2>&1 || exit 0

CHANGED="$( { git diff --name-only "$BASE"...HEAD; git diff --name-only; git diff --name-only --cached; } 2>/dev/null | sort -u )"
PRODUCT="$(printf '%s\n' "$CHANGED" | grep -E '^(apps/web/src/|services/agent/src/)' | grep -vE '(\.test\.|\.spec\.|\.stories\.|__tests__/|\.d\.ts$)' || true)"
[ -z "$PRODUCT" ] && exit 0

CL_ADDS="$( { git diff -U0 "$BASE"...HEAD -- CHANGELOG.md; git diff -U0 -- CHANGELOG.md; git diff -U0 --cached -- CHANGELOG.md; } 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true )"
WN="$(printf '%s\n' "$CHANGED"  | grep -E '^services/agent/content_seed/whats-new\.json$' || true)"
[ -n "$CL_ADDS" ] && [ -n "$WN" ] && exit 0

reason="Release housekeeping: product source under apps/web/src or services/agent/src changed, but the changelog is not updated. Before finishing, add a bullet to CHANGELOG.md (## [Unreleased]) AND a client entry to services/agent/content_seed/whats-new.json (or apply the skip-changelog PR label for an infra-only change). See the Definition of Done in DEVELOPMENT.md."
if command -v jq >/dev/null 2>&1; then
  jq -cn --arg r "$reason" '{decision:"block", reason:$r}'
else
  printf '{"decision":"block","reason":"%s"}\n' "$reason"
fi
exit 0
