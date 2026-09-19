#!/usr/bin/env bash
# =============================================================================
# 049 — deploy the universal wrapper fleet on Robinhood Chain (4663), with CAST.
# =============================================================================
# WHY A SHELL SCRIPT AND NOT A FORGE SCRIPT (same reason as
# deploy-vault-v2-base-sepolia.sh): the deployer `0xA71e…5c30` is EIP-7702 DELEGATED, and firing
# transactions back-to-back from it has been observed to drop the receipt for the second while a
# `cast call` dry-run of identical args succeeded. Every step below is therefore a SEPARATE, AWAITED,
# RECEIPT-CHECKED `cast send`, with a small configurable gap (`SEND_GAP_SEC`, default 2s).
#
# WHAT IT DEPLOYS (operator-signed; chain 4663 only):
#   0. proposer Safe (3-of-5) + independent canceller Safe (2-of-3) via Safe v1.4.1's canonical
#      factory — the deploying EOA gains NO power over either Safe;
#   1. TimelockController (delay ≥72h): PROPOSER → Safe A, CANCELLER → Safe B, EXECUTOR open,
#      deployer RENOUNCES admin in this same run;
#   2. SparkPointUniversalVault implementation + UpgradeableBeacon (owner = timelock);
#   3. SparkPointVaultFactoryV2 implementation + Transparent proxy (ProxyAdmin owner = timelock).
#
# SAFETY CHECKS IN THE SCRIPT: chain id, deployer balance, both Safe addresses are contracts after
# creation, every receipt status == 1, and role/ownership reads are asserted at the end.
#
# Env:
#   RPC_URL                     (required) — 4663 RPC
#   DEPLOYER_PRIVATE_KEY        (required) — the operator deployer EOA
#   PROPOSER_OWNERS             csv (default: the five generated signer wallets W1..W5)
#   CANCELLER_OWNERS            csv (default: W3,W4,W5)
#   PROPOSER_THRESHOLD          default 3
#   CANCELLER_THRESHOLD         default 2
#   TIMELOCK_MIN_DELAY          default 259200 (72h); values below the floor are refused
#   WRAPPER_FEE_RECIPIENT       default 4663 beta treasury
#   SEND_GAP_SEC                default 2
#   DRY_RUN=1                   print the plan + the deterministic Safe addresses; send nothing
#
# Usage:
#   cd contracts
#   DRY_RUN=1 bash script/deploy-wrapper-fleet-4663.sh          # plan first
#   bash script/deploy-wrapper-fleet-4663.sh                    # then for real
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." # contracts/

: "${RPC_URL:?set RPC_URL to the 4663 endpoint}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY (the operator deployer EOA)}"

CHAIN_ID=4663
SAFE_SINGLETON=0x41675C099F32341bf84BFc5382aF534df5C7461a
SAFE_FACTORY=0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
SAFE_HANDLER=0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99
ZERO=0x0000000000000000000000000000000000000000

# The five generated signer wallets (public addresses only; the keystore lives outside the repo).
W1=${W1:-0x95c72A341bA9F7b97820caffF9B8179DF0668E04}
W2=${W2:-0xCE1098d1be482A458F40F6078f53055a434F05FF}
W3=${W3:-0xB11c12673E6cC8b8636239DFcC1d92317Fd4968D}
W4=${W4:-0x529459AC59e539a51C43C99E5e88A9074bA4a6BC}
W5=${W5:-0x5843cE8c3DDA1F2262FD5A6c09D10953B8BE256c}

PROPOSER_OWNERS=${PROPOSER_OWNERS:-"$W1,$W2,$W3,$W4,$W5"}
CANCELLER_OWNERS=${CANCELLER_OWNERS:-"$W3,$W4,$W5"}
PROPOSER_THRESHOLD=${PROPOSER_THRESHOLD:-3}
CANCELLER_THRESHOLD=${CANCELLER_THRESHOLD:-2}
TIMELOCK_MIN_DELAY=${TIMELOCK_MIN_DELAY:-259200}
WRAPPER_FEE_RECIPIENT=${WRAPPER_FEE_RECIPIENT:-0x376293DDb027555aB7F483c00e1D61b2a7757dE8}
SEND_GAP_SEC=${SEND_GAP_SEC:-2}
DRY_RUN=${DRY_RUN:-0}

SAFE_SALT_PROPOSER=4663001
SAFE_SALT_CANCELLER=4663002

if [ "$TIMELOCK_MIN_DELAY" -lt 259200 ]; then
  echo "TIMELOCK_MIN_DELAY below the 72h floor — refusing" >&2
  exit 1
fi

log() { printf '%s\n' "$*" >&2; }

# ── helpers ───────────────────────────────────────────────────────────────────

_send() { # desc to sig args...
  local desc=$1 to=$2 sig=$3
  shift 3
  local tx rc status
  tx=$(cast send "$to" "$sig" "$@" --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json |
    jq -r '.transactionHash')
  rc=$(cast receipt "$tx" --rpc-url "$RPC_URL" --json)
  status=$(printf '%s' "$rc" | jq -r '.status')
  if [ "$status" != "0x1" ]; then
    echo "FAILED: $desc (tx $tx, status $status)" >&2
    exit 1
  fi
  log "ok    $desc  tx=$tx"
  sleep "$SEND_GAP_SEC"
}

_create() { # desc bytecode -> echoes the contract address
  local desc=$1 code=$2 tx rc status addr
  tx=$(cast send --create "$code" --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --json |
    jq -r '.transactionHash')
  rc=$(cast receipt "$tx" --rpc-url "$RPC_URL" --json)
  status=$(printf '%s' "$rc" | jq -r '.status')
  if [ "$status" != "0x1" ]; then
    echo "FAILED: create $desc (tx $tx, status $status)" >&2
    exit 1
  fi
  addr=$(printf '%s' "$rc" | jq -r '.contractAddress')
  log "ok    $desc  $addr  tx=$tx"
  sleep "$SEND_GAP_SEC"
  printf '%s' "$addr"
}

_bytecode() { forge inspect "$1" bytecode; }

_assert_code() { # name addr
  local code
  code=$(cast code "$2" --rpc-url "$RPC_URL")
  if [ "$code" = "0x" ]; then
    echo "FAILED: $1 at $2 has no code" >&2
    exit 1
  fi
}

# ── preflight ─────────────────────────────────────────────────────────────────

ACTUAL_CHAIN=$(cast chain-id --rpc-url "$RPC_URL")
if [ "$ACTUAL_CHAIN" != "$CHAIN_ID" ]; then
  echo "RPC is chain $ACTUAL_CHAIN, expected $CHAIN_ID — refusing" >&2
  exit 1
fi
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether)
log "deployer $DEPLOYER  balance ${BALANCE} ETH  chain $CHAIN_ID"

INIT_A=$(cast calldata "setup(address[],uint256,address,bytes,address,address,uint256,address)" \
  "[$PROPOSER_OWNERS]" "$PROPOSER_THRESHOLD" "$ZERO" 0x "$SAFE_HANDLER" "$ZERO" 0 "$ZERO")
INIT_B=$(cast calldata "setup(address[],uint256,address,bytes,address,address,uint256,address)" \
  "[$CANCELLER_OWNERS]" "$CANCELLER_THRESHOLD" "$ZERO" 0x "$SAFE_HANDLER" "$ZERO" 0 "$ZERO")

# Deterministic — eth_call against the factory returns the CREATE2 address without sending.
SAFE_A=$(cast call "$SAFE_FACTORY" "createProxyWithNonce(address,bytes,uint256)(address)" \
  "$SAFE_SINGLETON" "$INIT_A" "$SAFE_SALT_PROPOSER" --rpc-url "$RPC_URL")
SAFE_B=$(cast call "$SAFE_FACTORY" "createProxyWithNonce(address,bytes,uint256)(address)" \
  "$SAFE_SINGLETON" "$INIT_B" "$SAFE_SALT_CANCELLER" --rpc-url "$RPC_URL")

log ""
log "PLAN"
log "  0  proposer Safe (${PROPOSER_THRESHOLD}-of-$(printf '%s' "$PROPOSER_OWNERS" | awk -F, '{print NF}'))  -> $SAFE_A"
log "  0  canceller Safe (${CANCELLER_THRESHOLD}-of-$(printf '%s' "$CANCELLER_OWNERS" | awk -F, '{print NF}')) -> $SAFE_B"
log "  1  TimelockController delay=${TIMELOCK_MIN_DELAY}s, proposer=$SAFE_A, canceller=$SAFE_B, executor=open"
log "  2  SparkPointUniversalVault impl + UpgradeableBeacon(owner=timelock)"
log "  3  SparkPointVaultFactoryV2 impl + TransparentProxy (owner=timelock, feeRecipient=$WRAPPER_FEE_RECIPIENT)"
log ""

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — nothing sent."
  exit 0
fi

# ── 0 · the two Safes ─────────────────────────────────────────────────────────

_send "create proposer Safe (3-of-5)" "$SAFE_FACTORY" \
  "createProxyWithNonce(address,bytes,uint256)" "$SAFE_SINGLETON" "$INIT_A" "$SAFE_SALT_PROPOSER"
_assert_code "proposer Safe" "$SAFE_A"

_send "create canceller Safe (2-of-3)" "$SAFE_FACTORY" \
  "createProxyWithNonce(address,bytes,uint256)" "$SAFE_SINGLETON" "$INIT_B" "$SAFE_SALT_CANCELLER"
_assert_code "canceller Safe" "$SAFE_B"

# ── 1 · TimelockController (roles explicit; deployer renounces admin) ─────────

TL=$(_create "timelock" "$(_bytecode TimelockController)$(
  cast abi-encode "constructor(uint256,address[],address[],address)" \
    "$TIMELOCK_MIN_DELAY" "[]" "[$ZERO]" "$DEPLOYER"
)")
_assert_code "timelock" "$TL"

ROLE_PROPOSER=$(cast keccak "PROPOSER_ROLE")
ROLE_CANCELLER=$(cast keccak "CANCELLER_ROLE")
ROLE_ADMIN=$(cast keccak "DEFAULT_ADMIN_ROLE")

_send "grant PROPOSER_ROLE" "$TL" "grantRole(bytes32,address)" "$ROLE_PROPOSER" "$SAFE_A"
_send "grant CANCELLER_ROLE" "$TL" "grantRole(bytes32,address)" "$ROLE_CANCELLER" "$SAFE_B"
_send "renounce deployer admin" "$TL" "renounceRole(bytes32,address)" "$ROLE_ADMIN" "$DEPLOYER"

[ "$(cast call "$TL" "hasRole(bytes32,address)(bool)" "$ROLE_PROPOSER" "$SAFE_A" --rpc-url "$RPC_URL")" = "true" ] ||
  { echo "proposer role missing" >&2; exit 1; }
[ "$(cast call "$TL" "hasRole(bytes32,address)(bool)" "$ROLE_CANCELLER" "$SAFE_B" --rpc-url "$RPC_URL")" = "true" ] ||
  { echo "canceller role missing" >&2; exit 1; }
[ "$(cast call "$TL" "hasRole(bytes32,address)(bool)" "$ROLE_ADMIN" "$DEPLOYER" --rpc-url "$RPC_URL")" = "false" ] ||
  { echo "deployer still admin" >&2; exit 1; }

# ── 2 · implementation + beacon ───────────────────────────────────────────────

IMPL=$(_create "SparkPointUniversalVault impl" "$(_bytecode SparkPointUniversalVault)")
_assert_code "impl" "$IMPL"

BEACON=$(_create "UpgradeableBeacon" "$(_bytecode UpgradeableBeacon)$(
  cast abi-encode "constructor(address,address)" "$IMPL" "$TL"
)")
_assert_code "beacon" "$BEACON"

# ── 3 · factory implementation + Transparent proxy ────────────────────────────

FACTORY_IMPL=$(_create "SparkPointVaultFactoryV2 impl" "$(_bytecode SparkPointVaultFactoryV2)")
_assert_code "factory impl" "$FACTORY_IMPL"

FACTORY_INIT=$(cast calldata "initialize(address,address,address,address)" \
  "$TL" "$BEACON" "$TL" "$WRAPPER_FEE_RECIPIENT")

FACTORY=$(_create "SparkPointVaultFactoryV2 proxy" "$(_bytecode TransparentUpgradeableProxy)$(
  cast abi-encode "constructor(address,address,bytes)" "$FACTORY_IMPL" "$TL" "$FACTORY_INIT"
)")
_assert_code "factory proxy" "$FACTORY"

# ── verify ────────────────────────────────────────────────────────────────────

[ "$(cast call "$BEACON" "implementation()(address)" --rpc-url "$RPC_URL")" = "$IMPL" ] ||
  { echo "beacon implementation mismatch" >&2; exit 1; }
[ "$(cast call "$FACTORY" "owner()(address)" --rpc-url "$RPC_URL")" = "$TL" ] ||
  { echo "factory owner mismatch" >&2; exit 1; }
[ "$(cast call "$FACTORY" "guardian()(address)" --rpc-url "$RPC_URL")" = "$TL" ] ||
  { echo "factory guardian mismatch" >&2; exit 1; }
[ "$(cast call "$FACTORY" "beacon()(address)" --rpc-url "$RPC_URL")" = "$BEACON" ] ||
  { echo "factory beacon mismatch" >&2; exit 1; }

cat <<SUMMARY

============================================================
 WRAPPER FLEET DEPLOYED (4663)
============================================================
 TIMELOCK      $TL
 PROPOSER SAFE $SAFE_A
 CANCELLER SAFE $SAFE_B
 BEACON        $BEACON
 IMPL          $IMPL
 FACTORY       $FACTORY      <-- record + wire THIS
 FACTORY IMPL  $FACTORY_IMPL

 NEXT (through the timelock: Safe A schedules -> 72h -> anyone executes; Safe B can veto):
   factory.setDeployer(0xB555dbEc2cC5908c8B245ED84cb038D5d205D875, true)
   factory.setAllowlisted(<child vault>, true)      # per curated vault, once Gate 0 exists

 BOOK: add a \`wrapper\` section to contracts/deployments/4663/addresses.json with the addresses above.
 RUNNER APPS: SERVICE=deployer + SERVICE=curator (env tables in runners/README.md).
============================================================
SUMMARY
