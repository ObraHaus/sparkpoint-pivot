#!/usr/bin/env bash
# submit-session-userop.sh — item 6 (P1.5) SAFE-MODE session-key spike.
#
# Builds ONE ERC-4337 v0.7 MODE-0x01 (session-key) UserOp whose callData is
# execute(VAULT, 0, deposit(amount, ACCOUNT)) — an allowlisted, in-policy, recipient-pinned
# action. SessionKeyValidator.validateUserOp runs the §4 checks and, on success, calls
# policyModule.recordSpend(...) DURING VALIDATION (a write to the external PolicyModule's
# account-keyed storage). Submitted to a bundler running --safe-mode true, the bundler's
# ERC-7562 validation tracer decides whether that write is permitted (the "bundler-compliant"
# claim) or a storage-rule violation. We report the RAW bundler response either way.
#
# Env in: ANVIL_RPC, ALTO_RPC, ENTRYPOINT, ACCOUNT, VAULT, SESSION_PK, [AMOUNT]
set -euo pipefail
: "${ANVIL_RPC:?}"; : "${ALTO_RPC:?}"; : "${ENTRYPOINT:?}"; : "${ACCOUNT:?}"; : "${VAULT:?}"; : "${SESSION_PK:?}"
FOUNDRY_BIN="${FOUNDRY_BIN:-$HOME/.foundry/bin}"; export PATH="$FOUNDRY_BIN:$PATH"
AMOUNT="${AMOUNT:-100000000}" # 100 USDC (6dp), within the 500 USDC per-tx cap

SESSION_ADDR="$(cast wallet address --private-key "$SESSION_PK")"
echo "session key: $SESSION_ADDR"

# Fixed, generous gas (folded into userOpHash → must not change after signing).
CALL_GAS=300000; VER_GAS=600000; PVG=500000; MAX_PRIO=1000000000; MAX_FEE=20000000000

NONCE_DEC="$(cast call "$ENTRYPOINT" 'getNonce(address,uint192)(uint256)' "$ACCOUNT" 0 --rpc-url "$ANVIL_RPC" | awk '{print $1}')"

# callData: execute(VAULT, 0, deposit(AMOUNT, ACCOUNT)) — recipient pinned to the account (N1).
INNER="$(cast calldata 'deposit(uint256,address)' "$AMOUNT" "$ACCOUNT")"
CALLDATA="$(cast calldata 'execute(address,uint256,bytes)' "$VAULT" 0 "$INNER")"

ACCOUNT_GAS_LIMITS="$(printf '0x%032x%032x' "$VER_GAS" "$CALL_GAS")"
GAS_FEES="$(printf '0x%032x%032x' "$MAX_PRIO" "$MAX_FEE")"
PACKED="($ACCOUNT,$NONCE_DEC,0x,$CALLDATA,$ACCOUNT_GAS_LIMITS,$PVG,$GAS_FEES,0x,0x)"
USEROP_HASH="$(cast call "$ENTRYPOINT" \
  'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)' \
  "$PACKED" --rpc-url "$ANVIL_RPC")"

# Sign EIP-191(userOpHash) with the SESSION key, prepend MODE_SESSION (0x01).
RAW_SIG="$(cast wallet sign --private-key "$SESSION_PK" "$USEROP_HASH")"
SIGNATURE="0x01${RAW_SIG#0x}" # mode(0x01) || r || s || v

tohex() { printf '0x%x' "$1"; }
USEROP_JSON="$(jq -n \
  --arg sender "$ACCOUNT" --arg nonce "$(tohex "$NONCE_DEC")" --arg callData "$CALLDATA" \
  --arg callGasLimit "$(tohex "$CALL_GAS")" --arg verificationGasLimit "$(tohex "$VER_GAS")" \
  --arg preVerificationGas "$(tohex "$PVG")" --arg maxFeePerGas "$(tohex "$MAX_FEE")" \
  --arg maxPriorityFeePerGas "$(tohex "$MAX_PRIO")" --arg signature "$SIGNATURE" \
  '{sender:$sender, nonce:$nonce, callData:$callData, callGasLimit:$callGasLimit,
    verificationGasLimit:$verificationGasLimit, preVerificationGas:$preVerificationGas,
    maxFeePerGas:$maxFeePerGas, maxPriorityFeePerGas:$maxPriorityFeePerGas, signature:$signature}')"

echo "computed userOpHash: $USEROP_HASH"
echo "submitting MODE-0x01 session UserOp to safe-mode bundler: $ALTO_RPC"

rpc() {
  curl -sS -X POST "$ALTO_RPC" -H 'content-type: application/json' \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",id:1,method:$m,params:$p}')"
}

SEND_RESP="$(rpc eth_sendUserOperation "$(jq -n --argjson op "$USEROP_JSON" --arg ep "$ENTRYPOINT" '[$op,$ep]')")"
echo "=== RAW eth_sendUserOperation RESPONSE (verbatim) ==="
echo "$SEND_RESP"
echo "======================================================"

RETURNED_HASH="$(echo "$SEND_RESP" | jq -r '.result // empty')"
if [ -z "$RETURNED_HASH" ]; then
  echo "SESSION_OP_REJECTED"
  # Surface the 7562 / storage-rule reason explicitly if present.
  echo "$SEND_RESP" | jq -r '.error // .'
  echo "$SEND_RESP" | grep -qiE "7562|aa2[0-9]|storage|opcode|GREP|not staked|associated" \
    && echo "==> matches an ERC-7562 validation-rule signature" || true
  exit 2
fi
echo "SESSION_OP_ACCEPTED bundler-hash=$RETURNED_HASH (validation passed the safe-mode 7562 tracer)"
for i in $(seq 1 25); do
  RCPT="$(rpc eth_getUserOperationReceipt "$(jq -n --arg h "$RETURNED_HASH" '[$h]')")"
  if [ "$(echo "$RCPT" | jq -r '.result')" != "null" ]; then
    echo "RECEIPT:"; echo "$RCPT" | jq '{success:.result.success, actualGasUsed:.result.actualGasUsed, txHash:.result.receipt.transactionHash}'
    exit 0
  fi
  sleep 1
done
echo "NO_RECEIPT_AFTER_TIMEOUT (op accepted by validation; execution unfunded is expected — the 7562 validation question is already answered by ACCEPTED above)"
exit 0
