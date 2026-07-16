#!/usr/bin/env bash
# run-spike-safemode.sh — item 6 (P1.5): re-run the ERC-4337 v0.7 spike with Alto in SAFE-MODE
# and a MODE-0x01 SESSION-KEY UserOp, to observe whether the recordSpend-in-validation write to the
# external PolicyModule survives the ERC-7562 validation storage rules. SPIKE ONLY; never broadcasts.
#
# Outcome is REPORTED, not tuned: if safe-mode rejects the op on a 7562 rule, that is the finding.
#
# Env overrides: SPARK_ROOT, ENV_FILE, ANVIL_PORT, ALTO_PORT, ALTO_BIN, FOUNDRY_BIN, LOGDIR
set -uo pipefail
SPARK_ROOT="${SPARK_ROOT:-/home/hello/project/sparkpoint-pivot}"
ENV_FILE="${ENV_FILE:-/home/hello/project/.claude/.env}"
CONTRACTS="$SPARK_ROOT/contracts"; HERE="$CONTRACTS/script/bundler-spike"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v22.23.1/bin}"
export PATH="$FOUNDRY_BIN:$NODE_BIN:$PATH"
ANVIL_PORT="${ANVIL_PORT:-8546}"; ALTO_PORT="${ALTO_PORT:-4338}"
ANVIL_RPC="http://127.0.0.1:${ANVIL_PORT}"; ALTO_RPC="http://127.0.0.1:${ALTO_PORT}"
ENTRYPOINT="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
ALTO_BIN="${ALTO_BIN:-alto}"
LOGDIR="${LOGDIR:-$HERE/safemode-logs}"; mkdir -p "$LOGDIR"

echo "== bundler spike (SAFE-MODE, session-key mode 0x01) =="; echo "logs: $LOGDIR"
[ -f "$ENV_FILE" ] || { echo "ENV_FILE not found" >&2; exit 1; }
SIM_FORK_RPC_URL="$(grep -E '^SIM_FORK_RPC_URL=' "$ENV_FILE" | head -1 | sed -E 's/^SIM_FORK_RPC_URL=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
[ -n "$SIM_FORK_RPC_URL" ] || { echo "SIM_FORK_RPC_URL empty" >&2; exit 1; }

MN="test test test test test test test test test test test junk"
OWNER_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 0)"
EXEC_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 1)"
UTIL_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 2)"
SESSION_PK="$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 3)"
OWNER_ADDR="$(cast wallet address --private-key "$OWNER_PK")"
SESSION_ADDR="$(cast wallet address --private-key "$SESSION_PK")"
echo "owner=$OWNER_ADDR  session=$SESSION_ADDR"

ANVIL_PID=""; ALTO_PID=""
cleanup() { [ -n "$ALTO_PID" ] && kill "$ALTO_PID" 2>/dev/null; [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null; true; }
trap cleanup EXIT

echo "[1/4] anvil fork on $ANVIL_RPC ..."
anvil --fork-url "$SIM_FORK_RPC_URL" --port "$ANVIL_PORT" --silent >"$LOGDIR/anvil.log" 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 40); do cast chain-id --rpc-url "$ANVIL_RPC" >/dev/null 2>&1 && break; sleep 0.5; [ "$i" = 40 ] && { echo "anvil down" >&2; exit 1; }; done
echo "     fork up. chainId=$(cast chain-id --rpc-url "$ANVIL_RPC")"

echo "[2/4] deploy stack + allowlist + authorize session ..."
SPIKE_OWNER="$OWNER_ADDR" SPIKE_DEPLOYER_PK="$OWNER_PK" SPIKE_SESSION_KEY="$SESSION_ADDR" \
  forge script "$HERE/BundlerSpikeSessionDeploy.s.sol:BundlerSpikeSessionDeploy" \
  --root "$CONTRACTS" --rpc-url "$ANVIL_RPC" --broadcast --skip-simulation \
  >"$LOGDIR/deploy.log" 2>&1 || { echo "deploy failed" >&2; tail -40 "$LOGDIR/deploy.log" >&2; exit 1; }
ACCOUNT="$(grep -oE 'SPIKE_ACCOUNT=0x[0-9a-fA-F]{40}' "$LOGDIR/deploy.log" | head -1 | cut -d= -f2)"
VAULT="$(grep -oE 'SPIKE_VAULT=0x[0-9a-fA-F]{40}' "$LOGDIR/deploy.log" | head -1 | cut -d= -f2)"
[ -n "$ACCOUNT" ] || { echo "no ACCOUNT parsed" >&2; tail -40 "$LOGDIR/deploy.log" >&2; exit 1; }
echo "     account=$ACCOUNT vault=$VAULT"

echo "[3/4] start Alto with --safe-mode TRUE on $ALTO_RPC ..."
"$ALTO_BIN" --entrypoints "$ENTRYPOINT" --executor-private-keys "$EXEC_PK" --utility-private-key "$UTIL_PK" \
  --rpc-url "$ANVIL_RPC" --port "$ALTO_PORT" --safe-mode true --chain-type op-stack \
  --enable-cors true --log-level info >"$LOGDIR/alto.log" 2>&1 &
ALTO_PID=$!
UP=""
for i in $(seq 1 60); do
  curl -sS -X POST "$ALTO_RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' 2>/dev/null | grep -qi "$ENTRYPOINT" && { UP=1; break; }
  kill -0 "$ALTO_PID" 2>/dev/null || { echo "Alto exited; see alto.log" >&2; tail -40 "$LOGDIR/alto.log" >&2; exit 1; }
  sleep 1
done
[ -n "$UP" ] || { echo "Alto not ready" >&2; tail -40 "$LOGDIR/alto.log" >&2; exit 1; }
echo "     Alto ready (safe-mode)"

echo "[4/4] submit MODE-0x01 session UserOp ..."
ANVIL_RPC="$ANVIL_RPC" ALTO_RPC="$ALTO_RPC" ENTRYPOINT="$ENTRYPOINT" ACCOUNT="$ACCOUNT" \
  VAULT="$VAULT" SESSION_PK="$SESSION_PK" FOUNDRY_BIN="$FOUNDRY_BIN" \
  bash "$HERE/submit-session-userop.sh" 2>&1 | tee "$LOGDIR/submit.log"
RC=${PIPESTATUS[0]}
echo "== done (submit rc=$RC) =="
exit "$RC"
