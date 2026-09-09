#!/usr/bin/env bash
# sync-allowlist-env.sh — the ONE way to set BETA_ALLOWLIST / ADMIN_ALLOWLIST (Phase B).
#
# Only the AGENT consumes these (it seeds the DB-backed allowlist on boot); the web derives access
# purely from the session claims, so a web copy is vestigial/dead. This script therefore writes to
# the AGENT ONLY (the earlier "sync to both" was dropped in B.1 — the web copy is inert; delete any
# lingering one). NOTE: the seed is ADDITIVE — removing a wallet here + redeploy does NOT revoke it;
# use the admin panel (/admin/allowlist) or a DB delete for removal. This env is bootstrap only.
#
# Usage:
#   COOLIFY_API_TOKEN_RWD=… \
#   scripts/sync-allowlist-env.sh "<beta_csv>" "<admin_csv>"
#
# where <beta_csv>/<admin_csv> are comma-separated 0x wallet addresses (case-insensitive; the agent
# checksum-normalizes). Idempotent (bulk upsert). Addresses are PUBLIC (not secrets) — printed for
# confirmation. After running, redeploy BOTH apps so the agent re-seeds. ACCESS gate only — these
# never gate /exit, /trust, or withdraw (N2).
set -euo pipefail

BASE="${COOLIFY_BASE:-https://coolifyadmin.aldrickb.xyz}"
: "${COOLIFY_API_TOKEN_RWD:?set COOLIFY_API_TOKEN_RWD (write token)}"
BETA_CSV="${1:?usage: sync-allowlist-env.sh <beta_csv> <admin_csv>}"
ADMIN_CSV="${2:?usage: sync-allowlist-env.sh <beta_csv> <admin_csv>}"

# develop agent app UUID (see COOLIFY.md inventory). The agent is the ONLY consumer.
AGENT_UUID="${AGENT_UUID:-fw8s4ko4080wgk8okso8go48}"

set_var() { # <app_uuid> <key> <value>
  local uuid="$1" key="$2" val="$3"
  # Build-time AND runtime so the value is present in both phases (mirrors SITE_LOCKED handling).
  curl -sS -X PATCH "$BASE/api/v1/applications/$uuid/envs/bulk" \
    -H "Authorization: Bearer $COOLIFY_API_TOKEN_RWD" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"data":[{"key":sys.argv[1],"value":sys.argv[2],"is_preview":False,"is_build_time":True,"is_literal":True}]}))' "$key" "$val")" \
    -o /dev/null -w "  %{http_code} $key -> ${uuid}\n"
}

echo "Setting allowlists on the AGENT (the only consumer; seeds the DB on boot):"
echo "  BETA_ALLOWLIST  = $BETA_CSV"
echo "  ADMIN_ALLOWLIST = $ADMIN_CSV"
for uuid in "$AGENT_UUID"; do
  set_var "$uuid" "BETA_ALLOWLIST"  "$BETA_CSV"
  set_var "$uuid" "ADMIN_ALLOWLIST" "$ADMIN_CSV"
done
echo "Done. Now redeploy the AGENT (it re-seeds spark-postgres on boot). Removal is NOT via env — use the admin panel or a DB delete."
