#!/usr/bin/env bash
# FR-020 / T034 — vault-eligibility no-drift gate (REAL on-chain assertions).
#
# Before a SparkPoint Fee Wrapper may bind to a third-party Morpho Vault V2, that child MUST pass an
# AUTOMATED on-chain eligibility check. `abdicated(bytes4)` is a public mapping and `isVaultV2` is a
# public factory view, so this is fully automatable — which is exactly why it is a gate and not a
# checklist. Per candidate in contracts/deployments/vault-candidates.json this asserts:
#
#     factory.isVaultV2(child)                         == true      (provenance)
#     child.abdicated(setReceiveSharesGate 0x2cb19f98) == true      (no gate can block a user)
#     child.abdicated(setSendSharesGate   0xc21ad028)  == true      (   ⤳ the N2 exit path)
#     child.abdicated(setReceiveAssetsGate 0x04dbf0ce) == true      (   ⤳ the N2 exit path)
#     child.asset()                                    == expectedAsset
#     child.performanceFee()  <= maxNativePerformanceFeeBps        (recorded for NET disclosure)
#     child.managementFee()   <= maxNativeManagementFeeBps
#
# WHY THE GATE ABDICATIONS ARE THE POINT. Wrapping someone else's vault means inheriting their
# ability to freeze us. A live `receiveSharesGate` / `sendSharesGate` / `receiveAssetsGate` lets the
# child's curator block share or asset movement — which on the exit path is precisely the
# SparkPoint-decision-blocks-a-withdrawal failure N2 forbids. `abdicate(bytes4)` is PERMANENT, so
# asserting it is asserting the hole is closed forever. A fourth setter exists
# (setSendAssetsGate 0x871c979c); it gates the DEPOSIT side only and is deliberately not required.
#
# LIQUIDITY. FR-020 also names a liquidity floor. It is NOT asserted here, and that is a deliberate,
# documented limit rather than an oversight: withdrawable liquidity on a Vault V2 is idle assets PLUS
# what each Blue market can currently pay out, which needs Morpho's indexer — and a naive on-chain
# `asset.balanceOf(vault)` is worthless for it (verified 2026-07-30: Steakhouse Prime USDC holds
# $567M of totalAssets and exactly 0 idle, so an idle-ratio floor would read 0% for a perfectly
# healthy vault and fail every candidate). The declared ratio therefore lives in the candidates file
# as the human allowlist record, is printed here as evidence, and is enforced pre-signature in the UI
# (spec US2 AC4 / US4 AC4). This script never PASSES a liquidity check it did not perform.
#
# FAILS (non-zero + ::error::) on ANY drift, and reports every violation before exiting rather than
# stopping at the first. Green-by-skips ONLY when the chain has no candidates yet — it never
# silently passes on a real mismatch, and a missing RPC secret falls back to the chain's public RPC
# rather than skipping.
#
# READ-ONLY BY CONSTRUCTION: `cast call` only, never `cast send`; no private key is read or needed.
# It is safe to point at mainnet precisely because it cannot write.
#
# Usage:  bash contracts/script/vault-eligibility-check.sh [chainId]     (default: all chains)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CANDIDATES_FILE="$REPO_ROOT/contracts/deployments/vault-candidates.json"

err() { echo "::error::$*" >&2; }
note() { echo "::notice::$*"; }

# ── guard: green-by-skip ONLY when the input genuinely does not exist yet ──────
if [ ! -f "$CANDIDATES_FILE" ]; then
  note "vault-eligibility: $CANDIDATES_FILE absent — no candidates declared; green-by-skip."
  exit 0
fi

# ── tool preconditions (a missing tool is a hard failure, never a silent pass) ─
command -v cast >/dev/null 2>&1 || { err "vault-eligibility: 'cast' (foundry) not on PATH."; exit 1; }
command -v jq   >/dev/null 2>&1 || { err "vault-eligibility: 'jq' not on PATH."; exit 1; }
# python3 does the WAD→bps arithmetic. It is NOT optional: bash arithmetic is 64-bit signed, and
# `wad * 10000` overflows for any fee ≥ ~0.92e18 — a 25% fee (0.25e18 × 10000 = 2.5e21) silently
# wrapped to -8 bps, which PASSED a 0-bps ceiling. That bug was caught by pointing this gate at
# Steakhouse High Yield USDC Edition (a real 25%-fee vault) before shipping; do not reintroduce
# shell arithmetic here.
command -v python3 >/dev/null 2>&1 || { err "vault-eligibility: 'python3' not on PATH (needed for exact WAD→bps arithmetic)."; exit 1; }

jq -e . "$CANDIDATES_FILE" >/dev/null 2>&1 || { err "vault-eligibility: $CANDIDATES_FILE is not valid JSON."; exit 1; }

# The three CRITICAL gate setters. Pinned here AND in the candidates file; the parity between the two
# is asserted below, so a typo in either cannot silently weaken the gate.
SEL_RECEIVE_SHARES="0x2cb19f98"
SEL_SEND_SHARES="0xc21ad028"
SEL_RECEIVE_ASSETS="0x04dbf0ce"

want_chain="${1:-}"
fail=0
checked=0

# `cast call` appends a scientific annotation to large numbers (' [5.671e14]') — keep the first field.
_call() { cast call "$1" "$2" ${3:+"$3"} --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}'; }
_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# WAD (1e18 = 100%) → bps, as an EXACT integer, rounded UP.
#
# Rounded up on purpose: this feeds a ceiling comparison, so truncating down would let a fee a hair
# above the limit (0.200001e18) read as exactly 2000bps and pass a 2000bps ceiling. Rounding up makes
# the gate err toward refusing a candidate, never toward admitting one. Python because the
# intermediate `wad * 10000` reaches 1e22 and must not be done in 64-bit shell arithmetic.
_wad_to_bps_ceil() {
  python3 -c '
import sys
raw = sys.argv[1].strip()
if not raw.isdigit():
    sys.exit(1)
wad = int(raw)
print((wad * 10000 + 10**18 - 1) // 10**18)
' "$1"
}

# ── assert the selector constants match the committed file (no silent divergence) ──
for pair in "setReceiveSharesGate(address):$SEL_RECEIVE_SHARES" \
            "setSendSharesGate(address):$SEL_SEND_SHARES" \
            "setReceiveAssetsGate(address):$SEL_RECEIVE_ASSETS"; do
  sig="${pair%:*}"; expect="${pair##*:}"
  from_file="$(jq -r --arg k "$sig" '.gateSelectors[$k] // empty' "$CANDIDATES_FILE")"
  if [ "$from_file" != "$expect" ]; then
    err "vault-eligibility: gateSelectors['$sig'] is '$from_file' in $CANDIDATES_FILE but '$expect' in this script."
    fail=1
  fi
  # Re-derive from the signature so neither copy can be wrong in the same way.
  derived="$(cast sig "$sig" 2>/dev/null || true)"
  if [ "$derived" != "$expect" ]; then
    err "vault-eligibility: cast sig '$sig' = '$derived', expected '$expect' — the pinned selector is WRONG."
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1

CHAIN_IDS="$(jq -r '.chains | keys[]' "$CANDIDATES_FILE")"

for chain_id in $CHAIN_IDS; do
  if [ -n "$want_chain" ] && [ "$want_chain" != "$chain_id" ]; then continue; fi

  label="$(jq -r --arg c "$chain_id" '.chains[$c].label' "$CANDIDATES_FILE")"
  factory="$(jq -r --arg c "$chain_id" '.chains[$c].vaultV2Factory' "$CANDIDATES_FILE")"
  public_rpc="$(jq -r --arg c "$chain_id" '.chains[$c].publicRpcUrl' "$CANDIDATES_FILE")"
  rpc_env="$(jq -r --arg c "$chain_id" '.chains[$c].rpcUrlEnv // empty' "$CANDIDATES_FILE")"
  n_cand="$(jq -r --arg c "$chain_id" '.chains[$c].candidates | length' "$CANDIDATES_FILE")"

  if [ "$n_cand" -eq 0 ]; then
    note "vault-eligibility: chainId $chain_id ($label) has no candidates — green-by-skip."
    continue
  fi

  # A configured secret wins; otherwise the chain's public RPC. A MISSING secret must never skip.
  RPC_URL="$public_rpc"; rpc_src="public $public_rpc"
  if [ -n "$rpc_env" ]; then
    from_env="$(printenv "$rpc_env" 2>/dev/null || true)"
    if [ -n "$from_env" ]; then RPC_URL="$from_env"; rpc_src="secret $rpc_env"; fi
  fi

  # Fail closed if the RPC does not actually serve this chain — otherwise every read below would be
  # answered by the wrong network and could report a false PASS.
  live_chain="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
  if [ "$live_chain" != "$chain_id" ]; then
    err "vault-eligibility: chainId $chain_id ($label): RPC ($rpc_src) reports chain '$live_chain' — refusing to check against the wrong network."
    fail=1
    continue
  fi

  echo "── chainId $chain_id · $label · factory=$factory · rpc=$rpc_src · $n_cand candidate(s)"

  i=0
  while [ "$i" -lt "$n_cand" ]; do
    cand="$(jq -c --arg c "$chain_id" --argjson i "$i" '.chains[$c].candidates[$i]' "$CANDIDATES_FILE")"
    i=$((i + 1))

    child="$(printf '%s' "$cand" | jq -r '.address')"
    clabel="$(printf '%s' "$cand" | jq -r '.label')"
    want_asset="$(_lower "$(printf '%s' "$cand" | jq -r '.expectedAsset')")"
    max_perf="$(printf '%s' "$cand" | jq -r '.maxNativePerformanceFeeBps')"
    max_mgmt="$(printf '%s' "$cand" | jq -r '.maxNativeManagementFeeBps')"
    checked=$((checked + 1))

    problems=0
    _bad() { err "vault-eligibility: [$chain_id] $clabel ($child): $*"; problems=1; fail=1; }

    # 1 — provenance. An address the factory does not attest is not a Vault V2, whatever it claims.
    prov="$(_call "$factory" 'isVaultV2(address)(bool)' "$child")"
    [ "$prov" = "true" ] || _bad "factory.isVaultV2 = '${prov:-<no response>}', expected true (provenance)."

    # 2 — the three CRITICAL gate setters, permanently abdicated.
    gates_ok=true
    for g in "receiveSharesGate:$SEL_RECEIVE_SHARES" "sendSharesGate:$SEL_SEND_SHARES" "receiveAssetsGate:$SEL_RECEIVE_ASSETS"; do
      gname="${g%:*}"; gsel="${g##*:}"
      abd="$(_call "$child" 'abdicated(bytes4)(bool)' "$gsel")"
      if [ "$abd" != "true" ]; then
        _bad "abdicated($gname $gsel) = '${abd:-<no response>}', expected true — a live gate can block a user (N2)."
        gates_ok=false
      fi
    done

    # 3 — asset match. Our own factory never checked this; a mismatch bricks the first deposit.
    got_asset="$(_lower "$(_call "$child" 'asset()(address)')")"
    [ "$got_asset" = "$want_asset" ] || _bad "asset() = '${got_asset:-<no response>}', expected '$want_asset'."

    # 4 — native fees, for the NET stacked-fee disclosure (IV.5). Vault V2 fees are WAD (1e18 = 100%);
    #     bps = wad * 10000 / 1e18. Integer maths only — no float rounding in a gate.
    perf_wad="$(_call "$child" 'performanceFee()(uint256)')"
    mgmt_wad="$(_call "$child" 'managementFee()(uint256)')"
    perf_bps=""; mgmt_bps=""
    if perf_bps="$(_wad_to_bps_ceil "${perf_wad:-}")"; then
      [ "$perf_bps" -le "$max_perf" ] || _bad "performanceFee = ${perf_bps}bps (wad $perf_wad), declared ceiling ${max_perf}bps."
    else
      perf_bps=""
      _bad "performanceFee() returned '${perf_wad:-<no response>}' — not a readable uint256."
    fi
    if mgmt_bps="$(_wad_to_bps_ceil "${mgmt_wad:-}")"; then
      # A non-zero management fee is charged even in a loss (V2's own NatSpec) — hence a ceiling.
      [ "$mgmt_bps" -le "$max_mgmt" ] || _bad "managementFee = ${mgmt_bps}bps (wad $mgmt_wad), declared ceiling ${max_mgmt}bps."
    else
      mgmt_bps=""
      _bad "managementFee() returned '${mgmt_wad:-<no response>}' — not a readable uint256."
    fi

    # Evidence, printed whether or not the candidate passed (this is the vault_allowlist row).
    total_assets="$(_call "$child" 'totalAssets()(uint256)')"
    curator="$(_call "$child" 'curator()(address)')"
    liq_note="$(printf '%s' "$cand" | jq -r '.observed.liquidityRatioNote // "not declared"')"
    if [ "$problems" -eq 0 ]; then
      echo "   PASS  $clabel  $child"
    else
      echo "   FAIL  $clabel  $child"
    fi
    echo "         provenance=$prov gatesAbdicated=$gates_ok asset=$got_asset perfBps=${perf_bps:-?} mgmtBps=${mgmt_bps:-?}"
    echo "         totalAssets=${total_assets:-?} curator=${curator:-?}"
    echo "         liquidity (NOT asserted here — needs Morpho's indexer): $liq_note"
  done
done

if [ "$checked" -eq 0 ]; then
  if [ -n "$want_chain" ]; then
    note "vault-eligibility: no candidates declared for chainId $want_chain — green-by-skip."
  else
    note "vault-eligibility: no candidates declared on any chain — green-by-skip."
  fi
  exit 0
fi

if [ "$fail" -ne 0 ]; then
  err "vault-eligibility: FR-020 eligibility FAILED — see the errors above. A candidate that does not pass MUST NOT be allowlisted or wrapped."
  exit 1
fi

echo "vault-eligibility: all $checked candidate(s) pass FR-020 (provenance · 3 critical gates abdicated · asset match · native fee ceilings)."
