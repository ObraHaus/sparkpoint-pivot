#!/usr/bin/env bash
# ITEM 3 / T098 — policy-parity no-drift gate (REAL on-chain assertions).
#
# Reads the LIVE vault + CapRegistry deployed on a chain and asserts, PER chainId,
# that the on-chain policy reads equal packages/shared getPolicyConstants(chainId)
# AND the services/agent Python policy constants:
#
#     vault.asset()                     == addresses[chainId].usdc
#     vault.performanceFeeBps()         == governance default perf-fee bps
#     vault.MAX_PERFORMANCE_FEE_BPS()   == governance perf-fee ceiling bps
#     CapRegistry.perUserCap()          == caps.perUserTvl.amount
#     CapRegistry.totalCap()            == caps.totalProtocol.amount
#     CapRegistry.vaultCap()            == caps.vaultDeposit.amount
#
# FAILS (non-zero + ::error::) on ANY drift. Green-by-skips ONLY when the chain's
# contracts/deployments/<chainId>/addresses.json is ABSENT (not deployed) — it
# never silently passes on a real mismatch, and a missing RPC secret falls back
# to the public RPC rather than skipping.
#
# Usage:  bash contracts/script/policy-parity-check.sh [chainId]   (default 84532)
# RPC:    $BASE_SEPOLIA_RPC_URL if set, else the public https://sepolia.base.org.
set -euo pipefail

CHAIN_ID="${1:-84532}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADDR_FILE="$REPO_ROOT/contracts/deployments/$CHAIN_ID/addresses.json"
DIST_DIR="$REPO_ROOT/packages/shared/dist"
AGENT_SRC="$REPO_ROOT/services/agent/src"
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

err() { echo "::error::$*" >&2; }

# ── guard: green-by-skip ONLY when the deployment is absent ───────────────────
if [ ! -f "$ADDR_FILE" ]; then
  echo "::notice::policy-parity: $ADDR_FILE absent — not deployed on chainId $CHAIN_ID;"
  echo "::notice::policy-parity: green-by-skip (this gate ENFORCES once the chain is deployed)."
  exit 0
fi

# ── tool preconditions (a missing tool is a hard failure, never a silent pass) ─
command -v cast >/dev/null 2>&1 || { err "policy-parity: 'cast' (foundry) not on PATH."; exit 1; }
command -v jq   >/dev/null 2>&1 || { err "policy-parity: 'jq' not on PATH."; exit 1; }
command -v node >/dev/null 2>&1 || { err "policy-parity: 'node' not on PATH (needed for the shared/TS view)."; exit 1; }
command -v python3 >/dev/null 2>&1 || { err "policy-parity: 'python3' not on PATH (needed for the agent/py view)."; exit 1; }

VAULT="$(jq -r '.SparkPointVault // empty' "$ADDR_FILE")"
CAPREG="$(jq -r '.CapRegistry // empty' "$ADDR_FILE")"
[ -n "$VAULT" ]  || { err "policy-parity: 'SparkPointVault' missing from $ADDR_FILE"; exit 1; }
[ -n "$CAPREG" ] || { err "policy-parity: 'CapRegistry' missing from $ADDR_FILE"; exit 1; }

if [ -n "${BASE_SEPOLIA_RPC_URL:-}" ]; then RPC_SRC="secret BASE_SEPOLIA_RPC_URL"; else RPC_SRC="public https://sepolia.base.org"; fi
echo "policy-parity: chainId=$CHAIN_ID vault=$VAULT capRegistry=$CAPREG rpc=$RPC_SRC"

# ── live on-chain reads (strip cast's trailing ' [5e9]' scientific annotation) ─
_call() { cast call "$1" "$2" --rpc-url "$RPC_URL" | awk '{print $1}'; }

ASSET="$(_call "$VAULT"  'asset()(address)')"
FEE="$(_call "$VAULT"    'performanceFeeBps()(uint16)')"
MAXFEE="$(_call "$VAULT"  'MAX_PERFORMANCE_FEE_BPS()(uint16)')"
PERUSER="$(_call "$CAPREG" 'perUserCap()(uint256)')"
TOTAL="$(_call "$CAPREG"   'totalCap()(uint256)')"
VAULTCAP="$(_call "$CAPREG" 'vaultCap()(uint256)')"

# All numerics kept as JSON strings — caps reach 1e12+, compared as exact ints downstream.
ONCHAIN_JSON="$(jq -cn \
  --arg fee "$FEE" --arg max "$MAXFEE" --arg pu "$PERUSER" --arg tot "$TOTAL" \
  --arg vc "$VAULTCAP" --arg asset "$ASSET" \
  '{performanceFeeBps:$fee, maxPerformanceFeeBps:$max, perUserCap:$pu, totalCap:$tot, vaultCap:$vc, asset:($asset|ascii_downcase)}')"

# ── shared/TS source of truth (tsc-built dist; import getPolicyConstants) ──────
if [ ! -f "$DIST_DIR/policy/index.js" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    echo "policy-parity: building packages/shared (dist absent)…"
    ( cd "$REPO_ROOT" && pnpm --filter @sparkpoint/shared build >/dev/null )
  else
    err "policy-parity: $DIST_DIR not built and pnpm unavailable — run 'pnpm --filter @sparkpoint/shared build'."
    exit 1
  fi
fi
TS_JSON="$(node "$SCRIPT_DIR/policy_parity_ts_dump.mjs" "$DIST_DIR" "$CHAIN_ID")"

# ── three-way compare (imports the agent/py constants; fails on any drift) ─────
python3 "$SCRIPT_DIR/policy_parity_compare.py" \
  --chain-id "$CHAIN_ID" \
  --agent-src "$AGENT_SRC" \
  --onchain "$ONCHAIN_JSON" \
  --ts "$TS_JSON"
