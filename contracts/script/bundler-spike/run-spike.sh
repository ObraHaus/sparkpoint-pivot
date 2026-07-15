#!/usr/bin/env bash
# run-spike.sh — ITEM 8 (R10/OQ-2): push ONE ERC-4337 v0.7 UserOp through a REAL bundler
# (Pimlico Alto) against a LOCAL Anvil fork of Base Sepolia. SPIKE ONLY — de-risks Phase-3 AA.
#
# What it does (all local; NEVER broadcasts to any mainnet):
#   1. boots Anvil forking SIM_FORK_RPC_URL (the fork carries the v0.7 EntryPoint singleton
#      0x0000000071727De22E5E9d8BAf0edAc6f37da032 and the live vault)
#   2. deploys the SparkPoint account stack + one account via forge script (BundlerSpikeDeploy)
#   3. starts Alto pointed at the local Anvil RPC (op-stack gas model, safe-mode off for the spike)
#   4. builds/signs/submits ONE owner-mode no-op UserOp and polls the receipt (submit-userop.sh)
#
# The fork RPC URL is read from .claude/.env and NEVER printed. Anvil's stdout (which echoes the
# fork URL) is redirected to a log this script never prints.
#
# Requirements: foundry (anvil/forge/cast), jq, curl, and the Alto binary.
#   Install Alto once:  npm i -g @pimlico/alto   (or point ALTO_BIN at a local install)
#
# Env overrides: SPARK_ROOT, ENV_FILE, ANVIL_PORT, ALTO_PORT, ALTO_BIN, FOUNDRY_BIN, LOGDIR
set -euo pipefail

SPARK_ROOT="${SPARK_ROOT:-/home/hello/project/sparkpoint-pivot}"
ENV_FILE="${ENV_FILE:-/home/hello/project/.claude/.env}"
CONTRACTS="$SPARK_ROOT/contracts"
HERE="$CONTRACTS/script/bundler-spike"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
export PATH="$FOUNDRY_BIN:$PATH"

ANVIL_PORT="${ANVIL_PORT:-8545}"
ALTO_PORT="${ALTO_PORT:-4337}"
ANVIL_RPC="http://127.0.0.1:${ANVIL_PORT}"
ALTO_RPC="http://127.0.0.1:${ALTO_PORT}"
ENTRYPOINT="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
LOGDIR="${LOGDIR:-$(mktemp -d)}"
ALTO_BIN="${ALTO_BIN:-alto}"

echo "== bundler spike =="
echo "logs: $LOGDIR"

# ── read the fork RPC WITHOUT printing it ──
[ -f "$ENV_FILE" ] || { echo "ENV_FILE not found: $ENV_FILE" >&2; exit 1; }
SIM_FORK_RPC_URL="$(grep -E '^SIM_FORK_RPC_URL=' "$ENV_FILE" | head -1 | sed -E 's/^SIM_FORK_RPC_URL=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
[ -n "$SIM_FORK_RPC_URL" ] || { echo "SIM_FORK_RPC_URL empty/unset in $ENV_FILE" >&2; exit 1; }

# ── anvil's default (public, non-secret) test accounts, derived — no anvil-log scraping ──
MN="test test test test test test test test test test test junk"
OWNER_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 0)"
EXEC_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 1)"
UTIL_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 2)"
OWNER_ADDR="$(cast wallet address --private-key "$OWNER_PK")"
echo "owner (anvil #0): $OWNER_ADDR"

ANVIL_PID=""; ALTO_PID=""
cleanup() {
  [ -n "$ALTO_PID" ] && kill "$ALTO_PID" 2>/dev/null || true
  [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1) anvil fork (stdout → log; the log echoes the secret URL, so we never print it) ──
echo "[1/4] booting anvil fork on $ANVIL_RPC ..."
anvil --fork-url "$SIM_FORK_RPC_URL" --port "$ANVIL_PORT" --silent >"$LOGDIR/anvil.log" 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 40); do
  if cast chain-id --rpc-url "$ANVIL_RPC" >/dev/null 2>&1; then break; fi
  sleep 0.5
  [ "$i" = 40 ] && { echo "anvil did not come up" >&2; exit 1; }
done
CHAIN_ID="$(cast chain-id --rpc-url "$ANVIL_RPC")"
echo "     fork up. chainId=$CHAIN_ID"
EP_CODE_LEN="$(cast code "$ENTRYPOINT" --rpc-url "$ANVIL_RPC" | wc -c)"
[ "$EP_CODE_LEN" -gt 4 ] || { echo "EntryPoint v0.7 not present on fork (code empty)" >&2; exit 1; }
echo "     EntryPoint v0.7 present (code bytes ~$((EP_CODE_LEN/2)))"

# ── 2) deploy the account stack + one account on the fork ──
echo "[2/4] deploying account stack (forge script) ..."
SPIKE_OWNER="$OWNER_ADDR" SPIKE_DEPLOYER_PK="$OWNER_PK" \
  forge script "$HERE/BundlerSpikeDeploy.s.sol:BundlerSpikeDeploy" \
  --root "$CONTRACTS" --rpc-url "$ANVIL_RPC" --broadcast --skip-simulation \
  >"$LOGDIR/deploy.log" 2>&1 || { echo "forge deploy failed; see $LOGDIR/deploy.log" >&2; tail -30 "$LOGDIR/deploy.log" >&2; exit 1; }
ACCOUNT="$(grep -oE 'SPIKE_ACCOUNT=0x[0-9a-fA-F]{40}' "$LOGDIR/deploy.log" | head -1 | cut -d= -f2)"
FACTORY="$(grep -oE 'SPIKE_FACTORY=0x[0-9a-fA-F]{40}' "$LOGDIR/deploy.log" | head -1 | cut -d= -f2)"
[ -n "$ACCOUNT" ] || { echo "could not parse deployed ACCOUNT; see $LOGDIR/deploy.log" >&2; tail -30 "$LOGDIR/deploy.log" >&2; exit 1; }
echo "     factory=$FACTORY account=$ACCOUNT"
echo "     account EntryPoint deposit: $(cast call "$ENTRYPOINT" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$ANVIL_RPC")"

# ── 3) start Alto against the local fork ──
echo "[3/4] starting Alto bundler on $ALTO_RPC ..."
"$ALTO_BIN" \
  --entrypoints "$ENTRYPOINT" \
  --executor-private-keys "$EXEC_PK" \
  --utility-private-key "$UTIL_PK" \
  --rpc-url "$ANVIL_RPC" \
  --port "$ALTO_PORT" \
  --safe-mode false \
  --chain-type op-stack \
  --enable-cors true \
  --log-level info \
  >"$LOGDIR/alto.log" 2>&1 &
ALTO_PID=$!
UP=""
for i in $(seq 1 60); do
  if curl -sS -X POST "$ALTO_RPC" -H 'content-type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' 2>/dev/null | grep -qi "$ENTRYPOINT"; then
    UP=1; break
  fi
  if ! kill -0 "$ALTO_PID" 2>/dev/null; then echo "Alto exited early; see $LOGDIR/alto.log" >&2; tail -40 "$LOGDIR/alto.log" >&2; exit 1; fi
  sleep 1
done
[ -n "$UP" ] || { echo "Alto RPC never became ready; see $LOGDIR/alto.log" >&2; tail -40 "$LOGDIR/alto.log" >&2; exit 1; }
echo "     Alto ready (eth_supportedEntryPoints returns the v0.7 EP)"

# ── 4) build + sign + submit ONE UserOp through the bundler ──
echo "[4/4] submitting one UserOp through the bundler ..."
ANVIL_RPC="$ANVIL_RPC" ALTO_RPC="$ALTO_RPC" ENTRYPOINT="$ENTRYPOINT" \
  ACCOUNT="$ACCOUNT" OWNER_PK="$OWNER_PK" FOUNDRY_BIN="$FOUNDRY_BIN" \
  bash "$HERE/submit-userop.sh"
echo "== done =="
