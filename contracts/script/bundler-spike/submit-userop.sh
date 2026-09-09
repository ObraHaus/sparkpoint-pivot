#!/usr/bin/env bash
# submit-userop.sh — ITEM 8 (R10/OQ-2) bundler spike.
#
# Builds ONE ERC-4337 v0.7 UserOp (owner-mode, a harmless no-op `execute(owner, 0, "")`),
# computes its userOpHash on-chain via the EntryPoint, signs it in the account's custom
# `mode(0x00) || r || s || v` scheme, submits it to a bundler via `eth_sendUserOperation`,
# and polls `eth_getUserOperationReceipt`.
#
# Depends only on `cast` (foundry), `jq`, and `curl` — no JS bundler-client library.
#
# Env in:
#   ANVIL_RPC   local Anvil fork RPC (e.g. http://127.0.0.1:8545) — used for hashing/nonce
#   ALTO_RPC    bundler JSON-RPC (e.g. http://127.0.0.1:4337)
#   ENTRYPOINT  v0.7 EntryPoint singleton
#   ACCOUNT     the deployed SparkPointAccount (op sender)
#   OWNER_PK    owner private key (signs the op; MODE_OWNER = 0x00)
set -euo pipefail

: "${ANVIL_RPC:?}"; : "${ALTO_RPC:?}"; : "${ENTRYPOINT:?}"; : "${ACCOUNT:?}"; : "${OWNER_PK:?}"

FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
export PATH="$FOUNDRY_BIN:$PATH"

OWNER_ADDR="$(cast wallet address --private-key "$OWNER_PK")"

# ── Gas fields (fixed & generous; op-stack PVG has an L1-data component, so PVG is padded). ──
# These EXACT values are folded into userOpHash, so they must not change after signing.
CALL_GAS=300000        # 0x493e0
VER_GAS=600000         # 0x927c0
PVG=500000             # 0x7a120  (padded for Base/op-stack L1 data gas)
MAX_PRIO=1000000000    # 1 gwei
MAX_FEE=20000000000    # 20 gwei

# ── nonce (key 0) ──
NONCE_DEC="$(cast call "$ENTRYPOINT" 'getNonce(address,uint192)(uint256)' "$ACCOUNT" 0 --rpc-url "$ANVIL_RPC" | awk '{print $1}')"

# ── callData: execute(owner, 0, "") — a no-op that proves the full validate→execute path ──
CALLDATA="$(cast calldata 'execute(address,uint256,bytes)' "$OWNER_ADDR" 0 0x)"

# ── packed fields for getUserOpHash ──
ACCOUNT_GAS_LIMITS="$(printf '0x%032x%032x' "$VER_GAS" "$CALL_GAS")"
GAS_FEES="$(printf '0x%032x%032x' "$MAX_PRIO" "$MAX_FEE")"

# ── userOpHash from the on-chain EntryPoint (signature field empty for the hash) ──
PACKED="($ACCOUNT,$NONCE_DEC,0x,$CALLDATA,$ACCOUNT_GAS_LIMITS,$PVG,$GAS_FEES,0x,0x)"
USEROP_HASH="$(cast call "$ENTRYPOINT" \
  'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)' \
  "$PACKED" --rpc-url "$ANVIL_RPC")"

# ── sign EIP-191(userOpHash) with the owner key, prepend MODE_OWNER (0x00) ──
RAW_SIG="$(cast wallet sign --private-key "$OWNER_PK" "$USEROP_HASH")"   # 65-byte r||s||v
SIGNATURE="0x00${RAW_SIG#0x}"                                            # mode(0x00) || r || s || v

# ── unpacked v0.7 UserOp for eth_sendUserOperation ──
tohex() { printf '0x%x' "$1"; }
USEROP_JSON="$(jq -n \
  --arg sender "$ACCOUNT" \
  --arg nonce "$(tohex "$NONCE_DEC")" \
  --arg callData "$CALLDATA" \
  --arg callGasLimit "$(tohex "$CALL_GAS")" \
  --arg verificationGasLimit "$(tohex "$VER_GAS")" \
  --arg preVerificationGas "$(tohex "$PVG")" \
  --arg maxFeePerGas "$(tohex "$MAX_FEE")" \
  --arg maxPriorityFeePerGas "$(tohex "$MAX_PRIO")" \
  --arg signature "$SIGNATURE" \
  '{sender:$sender, nonce:$nonce, callData:$callData,
    callGasLimit:$callGasLimit, verificationGasLimit:$verificationGasLimit,
    preVerificationGas:$preVerificationGas, maxFeePerGas:$maxFeePerGas,
    maxPriorityFeePerGas:$maxPriorityFeePerGas, signature:$signature}')"

echo "computed userOpHash: $USEROP_HASH"
echo "submitting to bundler: $ALTO_RPC"

rpc() { # method, params-json  -> raw JSON response
  curl -sS -X POST "$ALTO_RPC" -H 'content-type: application/json' \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",id:1,method:$m,params:$p}')"
}

SEND_RESP="$(rpc eth_sendUserOperation "$(jq -n --argjson op "$USEROP_JSON" --arg ep "$ENTRYPOINT" '[$op,$ep]')")"
echo "eth_sendUserOperation response: $SEND_RESP"

RETURNED_HASH="$(echo "$SEND_RESP" | jq -r '.result // empty')"
if [ -z "$RETURNED_HASH" ]; then
  echo "SUBMIT_FAILED"
  echo "$SEND_RESP" | jq -r '.error // .' >&2
  exit 2
fi
echo "bundler-accepted userOpHash: $RETURNED_HASH"

# ── poll for the receipt ──
for i in $(seq 1 30); do
  RCPT="$(rpc eth_getUserOperationReceipt "$(jq -n --arg h "$RETURNED_HASH" '[$h]')")"
  if [ "$(echo "$RCPT" | jq -r '.result')" != "null" ]; then
    echo "RECEIPT:"
    echo "$RCPT" | jq '{userOpHash:.result.userOpHash, sender:.result.sender, success:.result.success, actualGasUsed:.result.actualGasUsed, txHash:.result.receipt.transactionHash, block:.result.receipt.blockNumber}'
    echo "SPIKE_OK"
    exit 0
  fi
  sleep 1
done

echo "NO_RECEIPT_AFTER_TIMEOUT (op accepted, hash=$RETURNED_HASH)"
exit 3
