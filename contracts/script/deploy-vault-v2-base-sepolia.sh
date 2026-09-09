#!/usr/bin/env bash
# 024 Phase 3 — deploy a REAL Morpho Vault V2 on Base Sepolia (84532).
#
# Replaces the retired mock-backed `SparkPointMorphoVault` demo with an actual Morpho vault:
# Morpho's own audited Vault V2, created by Morpho's factory, allocating into a LIVE Morpho Blue
# market. Nothing here is a mock, and nothing here is bespoke SparkPoint custody Solidity —
# constitution v3.0.0's organising rule is "stop writing custody-critical Solidity; configure
# Morpho's instead."
#
# WHY THIS IS A SHELL SCRIPT AND NOT A FORGE SCRIPT.
#   1. The vault is deployed BY Morpho's already-deployed factory, so no vault-v2 source needs
#      vendoring or compiling. This repo pins solc 0.8.24; vault-v2 does not have to agree with it.
#      Every call below therefore runs against the REAL deployed bytecode, not a recompiled copy —
#      which is strictly better evidence than a fork test over vendored sources.
#   2. The deployer `0xA71e…5c30` is EIP-7702 DELEGATED (code size 49). Firing two transactions
#      back-to-back from it has been observed to produce NO RECEIPT for the second while a `cast
#      call` dry-run of the identical args succeeded. So every step here is a separate, awaited,
#      receipt-checked transaction — `forge script` would need `--slow` and still batches.
#
# THE CANONICAL FEE-WRAPPER PATH DOES NOT RUN HERE. `FeeWrapperDeployer` requires
# `MorphoVaultV1AdapterFactory`, which is ABSENT on Base Sepolia (verified: no bytecode). So this
# rehearsal uses a plain Vault V2 + `MorphoMarketV1AdapterV2` into a live Blue market. The Base
# Sepolia deployment is a REHEARSAL for the mainnet Fee Wrapper, not the Fee Wrapper itself.
#
# ─────────────────────────────────────────────────────────────────────────────────────────────
# EVERY CONSTANT AND ORDERING RULE BELOW WAS VERIFIED ON AN ANVIL FORK OF BASE SEPOLIA
# (block 44823082, 2026-07-30) AGAINST THE REAL DEPLOYED FACTORY. Findings:
#
#   * THE DEAD-DEPOSIT DOC CONFLICT IS SETTLED — the dead-deposit page is right, the
#     vault-creation page's Phase-8 comment is wrong. Measured on the fork:
#         virtualShares()          = 1e12          (decimalOffset 12 for a 6-dp asset)
#         previewMint(1e18 shares) = 1000000       = EXACTLY 1.000000 USDC
#         after mint(1e18, 0xdead) : totalAssets 999999, 0xdead holds 1e18 shares
#     The value passed is SHARES, not assets. Reading the vault-creation page's "1e12 for ≤9
#     decimals" as ASSETS would mean 1,000,000 USDC (unaffordable and absurd); reading it as SHARES
#     would cost 0.000001 USDC — far too small to defend against the inflation attack that is the
#     dead deposit's entire purpose. This step is ONE-SHOT AND IRREVERSIBLE, which is why it was
#     measured rather than inferred.
#
#   * CAP ID PRE-IMAGES ARE CORRECT. `increaseAbsoluteCap(bytes idData, …)` takes the PRE-IMAGE;
#     the vault hashes it. Verified `keccak256(abi.encode("this", adapter))` equals the adapter's
#     own on-chain `adapterId()` exactly. The adapter exposes three ids and all three are capped.
#
#   * `increaseTimelock` MUST BE LAST, and here is the proof: after raising its own timelock, a
#     further `submit` + immediate `increaseTimelock` REVERTED on the fork (delay not elapsed). Any
#     selector left un-timelocked after that point stays that way for 3 days.
#
#   * THE N2 EXIT PATH WORKS. Fork round trip: deposit 2 USDC → redeem ALL shares → full principal
#     returned, shares 0. `forceDeallocate(address,bytes,uint256,address)` is present.
#
#   * `maxDeposit/maxMint/maxWithdraw/maxRedeem` ALL RETURN 0, by design (`pure returns (0)`), and
#     are NOT enforced inside deposit/withdraw. NEVER derive a UI limit from them on a V2.
#
#   * The resulting vault PASSES `vault-eligibility-check.sh` (FR-020) — the gate and this script
#     agree.
#
# ORDER IS LOAD-BEARING, and getting it wrong is not a style question:
#     config → abdications → DEAD DEPOSIT → TIMELOCKS → roles to the Safe (owner absolutely last)
#
#   * Timelocks come BEFORE the role handover. `submit` is CURATOR-gated, so the moment
#     `setCurator(Safe)` runs the deployer can no longer submit anything and every remaining
#     `increaseTimelock` reverts `Unauthorized` (0x82b42900). An earlier draft of this script put
#     roles first and failed exactly there on the fork — recorded because Morpho's own docs list
#     roles (their Phase 6) before timelocks (their Phase 9), which only works if the NEW curator
#     performs them.
#   * Owner is last of all: while the deployer still owns the vault it can re-appoint a curator and
#     repair a mistake above. Afterwards every change needs the 2-of-3 Safe AND a 3-day wait.
#
# Usage:
#   bash contracts/script/deploy-vault-v2-base-sepolia.sh --simulate    # anvil fork, safe, repeatable
#   bash contracts/script/deploy-vault-v2-base-sepolia.sh --broadcast   # REAL Base Sepolia, IRREVERSIBLE
#   VAULT=0x… bash …/deploy-vault-v2-base-sepolia.sh --broadcast        # RESUME after step 1 committed
#
# RESUMING. `createVaultV2` is the only non-repeatable step (the salt is spent; a second create
# reverts). The first real broadcast on 2026-07-30 committed exactly that step and then aborted on a
# lagging view read, so the resume path exists and is exercised: pass VAULT=0x… and step 1 is
# skipped after being verified three ways (it is the vault OUR salt produced, its asset matches, and
# it is still deployer-owned). Steps 2's two calls self-skip when already done. Everything from
# step 3 on is unconditional, so resume only from a run that stopped before it.
#
# --broadcast requires DEPLOYER_PRIVATE_KEY + BASE_SEPOLIA_RPC_URL and spends ~1 USDC of the
# deployer's Circle USDC on the dead deposit. It refuses to run against any chain but 84532.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  --simulate|--broadcast) ;;
  *) echo "usage: $0 --simulate | --broadcast" >&2; exit 2 ;;
esac

# ── addresses, all verified on-chain 2026-07-30 (see specs/024-.../research.md §1, §6) ──────────
CHAIN_ID=84532
VAULT_V2_FACTORY=0xE3a2CEbca662d99D0F279aF13a6bb8c9825D2ea0
ADAPTER_FACTORY=0xa24674Cc2c603FBA8AE6b442E3dB05f3dDaAa3D5
MORPHO_REGISTRY=0xCED92dd29B6E99120DD41CB79321126Abd5852b2
# Circle's test USDC — NOT Aave's 0xba50Cd2A… . Both report symbol()=="USDC" at 6 dp on this chain
# and are NOT interchangeable; Morpho's markets use this one (the "two USDC" problem, D4).
ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
# The 2-of-3 fee Safe (contracts/deployments/84532/addresses.json :: feeTreasurySafe).
SAFE=0xCB135893C84876aab9E10792b56e5bEa91dc578f
DEAD=0x000000000000000000000000000000000000dEaD

# Target Blue market 0x01351cf859346bbae655f1c9da71ba0e9ad201dd79a276c28f34e574386b0bfb, read back
# from `Morpho.idToMarketParams` rather than transcribed from a doc.
M_LOAN=0x036CbD53842c5426634e7929541eC2318f3dCF7e
M_COLL=0xd49c27a56631e63151e9d61D4eF746bE049032fC   # dTBTC, 8 dp
M_ORACLE=0x28bC28136acAe8db215558aAd5E5291C33F4781a
M_IRM=0x46415998764C29aB2a25CbeA6254146D50D22687     # AdaptiveCurveIrm
M_LLTV=860000000000000000                            # 86%

# Name/symbol MUST NOT contain "morpho" (Morpho naming restriction, FR-022). `spMORPHO` is retired.
VAULT_NAME="SparkPoint USDC Yield"
VAULT_SYMBOL="spUSDCv2"

# 1e18 SHARES ⇒ exactly 1.000000 USDC for this 6-dp asset. See the dead-deposit finding above.
DEAD_SHARES=1000000000000000000
DEAD_ASSETS_EXPECTED=1000000

ABSOLUTE_CAP=1000000000          # 1,000 USDC — testnet-appropriate, deliberately small
RELATIVE_CAP=1000000000000000000 # 100% (WAD)
TIMELOCK_S=259200                # 3 days, the constitutional minimum for curator selectors
MAX_RATE=63419583967             # ~200%/yr in WAD/sec; suppliers earn nothing until this is set

err() { echo "::error::$*" >&2; }

command -v cast >/dev/null || { err "cast (foundry) not on PATH"; exit 1; }

if [ "$MODE" = "--simulate" ]; then
  RPC_URL="${SIMULATE_RPC_URL:-http://127.0.0.1:8546}"
  echo "SIMULATE against $RPC_URL"
  echo "  (start one with: anvil --fork-url \"\$BASE_SEPOLIA_RPC_URL\" --port 8546)"
else
  : "${BASE_SEPOLIA_RPC_URL:?--broadcast needs BASE_SEPOLIA_RPC_URL}"
  RPC_URL="$BASE_SEPOLIA_RPC_URL"
  echo "!! BROADCAST to REAL Base Sepolia. Irreversible. Spends ~1 USDC on the dead deposit."
fi
: "${DEPLOYER_PRIVATE_KEY:?need DEPLOYER_PRIVATE_KEY}"
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")

# Refuse to act on the wrong chain. Every address above is 84532-specific, so a mismatched RPC
# would deploy a differently-shaped vault against silently wrong targets.
LIVE_CHAIN=$(cast chain-id --rpc-url "$RPC_URL")
[ "$LIVE_CHAIN" = "$CHAIN_ID" ] || { err "RPC serves chain $LIVE_CHAIN, expected $CHAIN_ID"; exit 1; }
echo "deployer=$DEPLOYER chain=$LIVE_CHAIN"

# ── one transaction at a time, receipt-checked (the EIP-7702 rule) ──────────────────────────────
# A silent no-receipt is the observed failure mode, so a missing/failed receipt aborts the whole
# run rather than letting a later step build on state that was never committed.
# ── the script owns the nonce, not the RPC ──────────────────────────────────────────────────────
# The second broadcast attempt died on `replacement transaction underpriced`: setCurator was MINED
# (status 1, block 44824288) but Alchemy's pending-nonce view still counted it as in-flight, so the
# next `cast send` built against the same nonce and the node read it as an underpriced replacement.
# Letting cast ask the RPC for a nonce on every step means trusting a view that demonstrably lags.
# A strictly sequential deployer can just count: read the nonce ONCE, pass it explicitly, increment
# on each confirmed receipt. This is also the cleanest expression of the EIP-7702 one-at-a-time rule.
NONCE=$(cast nonce "$DEPLOYER" --rpc-url "$RPC_URL")
echo "starting nonce=$NONCE"

# Wait for the node's own latest/pending views to agree before the next send. Belt and braces on top
# of the explicit nonce: correctness comes from --nonce, this just avoids racing a lagging mempool.
nonce_settle() {
  local t=0 lat pen
  while [ "$t" -lt 30 ]; do
    lat=$(cast nonce "$DEPLOYER" --rpc-url "$RPC_URL" 2>/dev/null || true)
    pen=$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC_URL" 2>/dev/null || true)
    if [ -n "$lat" ] && [ "$lat" = "$pen" ] && [ "$lat" -ge "$NONCE" ] 2>/dev/null; then return 0; fi
    t=$((t + 1)); command sleep 2
  done
  return 0   # never fatal: --nonce already pins correctness, so a slow view must not abort the run
}

tx() {
  local label="$1"; shift
  printf '  %-56s ' "$label"
  local out status hash
  out=$(cast send "$@" --nonce "$NONCE" --private-key "$DEPLOYER_PRIVATE_KEY" \
        --rpc-url "$RPC_URL" --json 2>&1) || {
    err "$label: cast send failed at nonce $NONCE: $(printf '%s' "$out" | head -2)"; exit 1; }
  # Print the hash on every step. The first real broadcast aborted after createVaultV2 with the hash
  # discarded, so the already-created vault had to be recovered by hand — never again.
  read -r status hash <<<"$(printf '%s' "$out" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print(d.get("status",""), d.get("transactionHash",""))' 2>/dev/null || true)"
  [ "$status" = "0x1" ] || { err "$label: status=${status:-<no receipt>} nonce=$NONCE tx=${hash:-<none>} — ABORTING before the next step"; exit 1; }
  NONCE=$((NONCE + 1))
  nonce_settle
  echo "ok  $hash"
}

# ── every view read must tolerate read-after-write lag ──────────────────────────────────────────
# THE FIRST BROADCAST ABORTED HERE. `createVaultV2` committed with status 0x1, and the very next
# `cast call` to the factory's `vaultV2` view returned EMPTY — the documented Alchemy
# read-after-write lag. The script correctly refused to build on an unresolved address, but the
# vault was already created, so the run could not simply be repeated. Retrying the read is the fix;
# aborting on the first miss was over-strict for a value that is merely late, not wrong.
#
# This matters beyond step 1: the ADAPTER read-back was entirely unguarded, so a lagging read there
# would have silently carried an EMPTY address into the cap-id pre-images and the addAdapter call.
ZERO_ADDR=0x0000000000000000000000000000000000000000
ZERO_B32=0x0000000000000000000000000000000000000000000000000000000000000000

read_view() {   # read_view <nonzero|true|any> <target> <sig> [args...] — echoes the value
  local want="$1"; shift
  local tries=0 val=""
  while [ "$tries" -lt 20 ]; do
    val=$(cast call "$@" --rpc-url "$RPC_URL" 2>/dev/null | awk 'NR==1{print $1}' || true)
    case "$want" in
      nonzero) if [ -n "$val" ] && [ "$val" != "$ZERO_ADDR" ] && [ "$val" != "$ZERO_B32" ] && [ "$val" != "0" ]; then
                 printf '%s' "$val"; return 0; fi ;;
      true)    if [ "$val" = "true" ]; then printf '%s' "$val"; return 0; fi ;;
      any)     if [ -n "$val" ]; then printf '%s' "$val"; return 0; fi ;;
    esac
    tries=$((tries + 1))
    command sleep 3
  done
  printf '%s' "$val"
  return 1
}

# ── idempotency predicates: "is this step still NEEDED?" ────────────────────────────────────────
# EVERY step below is guarded by a read of the state it is trying to produce, so the whole script is
# safely re-runnable. This is not defensive decoration — it is what let a 52-transaction irreversible
# deploy survive three separate RPC-view failures without any step being applied twice. A re-run of an
# already-applied step is not merely wasteful: `addAdapter` on a known adapter and
# `increaseAbsoluteCap` to an equal value both REVERT, which would abort the run at a false failure.
lc() { printf '%s' "${1,,}"; }
rd() { cast call "$@" --rpc-url "$RPC_URL" 2>/dev/null | awk 'NR==1{print $1}' || true; }

need_true() {  # needed while the flag is not yet true
  [ "$(rd "$@")" != "true" ]
}
need_addr() {  # needed while the stored address differs from $1
  local want; want=$(lc "$1"); shift
  [ "$(lc "$(rd "$@")")" != "$want" ]
}
need_ge() {    # needed while the stored number is below $1
  local want="$1"; shift
  local got; got=$(rd "$@")
  [ -z "$got" ] || [ "$got" -lt "$want" ] 2>/dev/null
}
need_str() {   # needed while the stored string differs from $1 (cast quotes strings)
  local want="$1"; shift
  [ "$(cast call "$@" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '"')" != "$want" ]
}

# The vault must itself report a submitted action as executable before we try to execute it.
# `exec absCap(market)` failed gas estimation with TimelockNotExpired on the live run even though
# timelock(increaseAbsoluteCap) was 0 and the submit had a receipt: the estimator ran against a state
# view that predated the submit, where executableAt reads 0 — and V2 reverts TimelockNotExpired for 0
# exactly as it does for "not yet due". A nonce check cannot catch that; only asking the vault can.
await_executable() {
  local cd="$1" label="$2" t=0 ea now
  while [ "$t" -lt 45 ]; do
    ea=$(rd "$VAULT" "executableAt(bytes)(uint256)" "$cd")
    now=$(cast block latest --field timestamp --rpc-url "$RPC_URL" 2>/dev/null || true)
    if [ -n "$ea" ] && [ "$ea" != "0" ] && [ -n "$now" ] && [ "$now" -ge "$ea" ] 2>/dev/null; then return 0; fi
    t=$((t + 1)); command sleep 2
  done
  err "$label: submitted action never became executable (executableAt=${ea:-?}, now=${now:-?})"
  exit 1
}

# A timelocked curator selector: submit(calldata) then the call itself. Immediate while the
# selector's timelock is still 0 — which is why every timelock is raised LAST.
tl() {
  local label="$1"; shift
  local sig="$1"; shift
  local cd; cd=$(cast calldata "$sig" "$@")
  # HALF-APPLIED CASE. A previous run can leave an action submitted but not executed — exactly what
  # happened live to absCap(market). Re-submitting the identical calldata reverts DataAlreadyPending
  # (0xd91ff208), so adopt the existing submit rather than duplicating it. Without this, the step-level
  # guards above are not enough: they see the cap still unset and correctly say "needed", but the work
  # that is already banked is the submit, not the exec.
  local pending; pending=$(rd "$VAULT" "executableAt(bytes)(uint256)" "$cd")
  if [ -n "$pending" ] && [ "$pending" != "0" ]; then
    printf '  %-56s adopt pending submit (executableAt=%s)\n' "submit $label" "$pending"
  else
    tx "submit $label" "$VAULT" "submit(bytes)" "$cd"
  fi
  await_executable "$cd" "$label"
  tx "exec   $label" "$VAULT" "$sig" "$@"
}

# tl, but skipped entirely when the guard says the state is already in place.
# Usage: tl_if <guard-fn> <guard-args...> -- <label> <sig> <call-args...>
tl_if() {
  local guard=() ; while [ "$1" != "--" ]; do guard+=("$1"); shift; done; shift
  if "${guard[@]}"; then
    tl "$@"
  else
    printf '  %-56s skip (already applied)\n' "$1"
  fi
}

# tx, but skipped when the guard says the state is already in place.
tx_if() {
  local guard=() ; while [ "$1" != "--" ]; do guard+=("$1"); shift; done; shift
  if "${guard[@]}"; then
    tx "$@"
  else
    printf '  %-56s skip (already applied)\n' "$1"
  fi
}

echo "── 1. create the vault (owner = deployer for now, handed to the Safe at step 6)"
SALT=$(cast keccak "sparkpoint-usdc-v2-basesepolia-001")
# RESUME. `createVaultV2` is the one step that cannot be retried — the salt is spent, so a second
# create reverts. If a previous run committed it and then died (see read_view above), pass the
# address back in as VAULT=0x… and step 1 is skipped. The preset is verified three ways before use,
# so a typo cannot silently point the remaining 51 transactions at somebody else's vault.
if [ -n "${VAULT:-}" ]; then
  echo "     RESUME: VAULT preset to $VAULT — skipping createVaultV2"
  FROM_SALT=$(read_view nonzero "$VAULT_V2_FACTORY" "vaultV2(address,address,bytes32)(address)" \
              "$DEPLOYER" "$ASSET" "$SALT") \
    || { err "factory has no vault for (deployer, asset, salt) — VAULT was preset but step 1 never committed"; exit 1; }
  [ "${FROM_SALT,,}" = "${VAULT,,}" ] \
    || { err "VAULT preset ($VAULT) is NOT the vault our salt produced ($FROM_SALT) — refusing"; exit 1; }
  ONCHAIN_ASSET=$(read_view nonzero "$VAULT" "asset()(address)")
  [ "${ONCHAIN_ASSET,,}" = "${ASSET,,}" ] \
    || { err "preset vault's asset is $ONCHAIN_ASSET, expected $ASSET"; exit 1; }
  ONCHAIN_OWNER=$(read_view nonzero "$VAULT" "owner()(address)")
  [ "${ONCHAIN_OWNER,,}" = "${DEPLOYER,,}" ] \
    || { err "preset vault's owner is $ONCHAIN_OWNER, not the deployer — the handover already ran; cannot resume"; exit 1; }
  echo "     verified: from our salt, asset matches, still deployer-owned"
else
  tx "createVaultV2" "$VAULT_V2_FACTORY" "createVaultV2(address,address,bytes32)" "$DEPLOYER" "$ASSET" "$SALT"
  # Read the address back from the factory's own view rather than parsing logs.
  VAULT=$(read_view nonzero "$VAULT_V2_FACTORY" "vaultV2(address,address,bytes32)(address)" \
          "$DEPLOYER" "$ASSET" "$SALT") || {
    err "could not resolve the created vault address from the factory after retries. THE VAULT WAS CREATED — do not re-run plain; find the address (cast call $VAULT_V2_FACTORY 'vaultV2(address,address,bytes32)(address)' $DEPLOYER $ASSET $SALT) and re-run with VAULT=0x… preset."
    exit 1; }
fi
echo "     VAULT = $VAULT"
[ "$(read_view true "$VAULT_V2_FACTORY" "isVaultV2(address)(bool)" "$VAULT")" = "true" ] \
  || { err "factory does not attest $VAULT"; exit 1; }

echo "── 2. temporary curator + the market adapter"
CURRENT_CURATOR=$(cast call "$VAULT" "curator()(address)" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || true)
if [ "${CURRENT_CURATOR,,}" = "${DEPLOYER,,}" ]; then
  echo "     curator is already the deployer — skipping setCurator"
else
  tx "setCurator(deployer)" "$VAULT" "setCurator(address)" "$DEPLOYER"
fi
EXISTING_ADAPTER=$(cast call "$ADAPTER_FACTORY" "morphoMarketV1AdapterV2(address)(address)" "$VAULT" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || true)
if [ -n "$EXISTING_ADAPTER" ] && [ "$EXISTING_ADAPTER" != "$ZERO_ADDR" ]; then
  echo "     adapter already exists — skipping createMorphoMarketV1AdapterV2"
  ADAPTER="$EXISTING_ADAPTER"
else
  tx "createMorphoMarketV1AdapterV2" "$ADAPTER_FACTORY" "createMorphoMarketV1AdapterV2(address)" "$VAULT"
  ADAPTER=$(read_view nonzero "$ADAPTER_FACTORY" "morphoMarketV1AdapterV2(address)(address)" "$VAULT") \
    || { err "adapter created but its address never resolved — re-run (this step is idempotent)"; exit 1; }
fi
echo "     ADAPTER = $ADAPTER"

echo "── 3. caps (three id PRE-IMAGES; the vault hashes them)"
ID_ADAPTER=$(cast abi-encode "f(string,address)" "this" "$ADAPTER")
ID_COLL=$(cast abi-encode "f(string,address)" "collateralToken" "$M_COLL")
MP="($M_LOAN,$M_COLL,$M_ORACLE,$M_IRM,$M_LLTV)"
ID_MARKET=$(cast abi-encode "f(string,address,(address,address,address,address,uint256))" "this/marketParams" "$ADAPTER" "$MP")
MARKET_DATA=$(cast abi-encode "f((address,address,address,address,uint256))" "$MP")
# Cross-check: keccak of the "this" pre-image must equal the adapter's own adapterId.
ONCHAIN_ADAPTER_ID=$(read_view nonzero "$ADAPTER" "adapterId()(bytes32)") \
  || { err "could not read adapter.adapterId() after retries — refusing to set caps on an unverified id"; exit 1; }
[ "$(cast keccak "$ID_ADAPTER")" = "$ONCHAIN_ADAPTER_ID" ] \
  || { err "cap-id pre-image mismatch: keccak(idData) != adapter.adapterId() — caps would be set on the wrong id"; exit 1; }
echo "     cap-id pre-image verified against adapter.adapterId()"

# Caps are keyed on the HASH of the pre-image, so the guards read absoluteCap/relativeCap at keccak(id).
H_ADAPTER=$(cast keccak "$ID_ADAPTER")
H_COLL=$(cast keccak "$ID_COLL")
H_MARKET=$(cast keccak "$ID_MARKET")

tl_if need_true "$VAULT" "isAllocator(address)(bool)" "$DEPLOYER" \
  -- "setIsAllocator(deployer)" "setIsAllocator(address,bool)" "$DEPLOYER" true
tl_if need_true "$VAULT" "isAdapter(address)(bool)" "$ADAPTER" \
  -- "addAdapter" "addAdapter(address)" "$ADAPTER"
tl_if need_ge "$ABSOLUTE_CAP" "$VAULT" "absoluteCap(bytes32)(uint256)" "$H_ADAPTER" \
  -- "absCap(adapter)" "increaseAbsoluteCap(bytes,uint256)" "$ID_ADAPTER" "$ABSOLUTE_CAP"
tl_if need_ge "$RELATIVE_CAP" "$VAULT" "relativeCap(bytes32)(uint256)" "$H_ADAPTER" \
  -- "relCap(adapter)" "increaseRelativeCap(bytes,uint256)" "$ID_ADAPTER" "$RELATIVE_CAP"
tl_if need_ge "$ABSOLUTE_CAP" "$VAULT" "absoluteCap(bytes32)(uint256)" "$H_COLL" \
  -- "absCap(collateral)" "increaseAbsoluteCap(bytes,uint256)" "$ID_COLL" "$ABSOLUTE_CAP"
tl_if need_ge "$RELATIVE_CAP" "$VAULT" "relativeCap(bytes32)(uint256)" "$H_COLL" \
  -- "relCap(collateral)" "increaseRelativeCap(bytes,uint256)" "$ID_COLL" "$RELATIVE_CAP"
tl_if need_ge "$ABSOLUTE_CAP" "$VAULT" "absoluteCap(bytes32)(uint256)" "$H_MARKET" \
  -- "absCap(market)" "increaseAbsoluteCap(bytes,uint256)" "$ID_MARKET" "$ABSOLUTE_CAP"
tl_if need_ge "$RELATIVE_CAP" "$VAULT" "relativeCap(bytes32)(uint256)" "$H_MARKET" \
  -- "relCap(market)" "increaseRelativeCap(bytes,uint256)" "$ID_MARKET" "$RELATIVE_CAP"
tl_if need_addr "$MORPHO_REGISTRY" "$VAULT" "adapterRegistry()(address)" \
  -- "setAdapterRegistry" "setAdapterRegistry(address)" "$MORPHO_REGISTRY"

echo "── 4. allocator settings (not timelocked) + name/symbol"
tx_if need_ge "$MAX_RATE" "$VAULT" "maxRate()(uint256)" \
  -- "setMaxRate" "$VAULT" "setMaxRate(uint256)" "$MAX_RATE"
tx_if need_addr "$ADAPTER" "$VAULT" "liquidityAdapter()(address)" \
  -- "setLiquidityAdapterAndData" "$VAULT" "setLiquidityAdapterAndData(address,bytes)" "$ADAPTER" "$MARKET_DATA"
tx_if need_str "$VAULT_NAME" "$VAULT" "name()(string)" \
  -- "setName" "$VAULT" "setName(string)" "$VAULT_NAME"
tx_if need_str "$VAULT_SYMBOL" "$VAULT" "symbol()(string)" \
  -- "setSymbol" "$VAULT" "setSymbol(string)" "$VAULT_SYMBOL"

echo "── 5. abdicate PERMANENTLY: the three critical gate setters + the adapter registry"
# The three gates are the one real N2 hole: a live gate lets a role holder block share or asset
# movement, and on the exit path that is a SparkPoint-side block on a withdrawal. `abdicate` is
# irreversible, which is the point — after this, no one can ever install one.
for sig in "setReceiveSharesGate(address)" "setSendSharesGate(address)" "setReceiveAssetsGate(address)" "setAdapterRegistry(address)"; do
  tl_if need_true "$VAULT" "abdicated(bytes4)(bool)" "$(cast sig "$sig")" \
    -- "abdicate $sig" "abdicate(bytes4)" "$(cast sig "$sig")"
done
for sel in 0x2cb19f98 0xc21ad028 0x04dbf0ce; do
  [ "$(read_view true "$VAULT" "abdicated(bytes4)(bool)" "$sel")" = "true" ] \
    || { err "gate $sel is NOT abdicated — refusing to continue (N2)"; exit 1; }
done
echo "     all three critical gates abdicated"

echo "── 6. DEAD DEPOSIT — one-shot, irreversible, and the FIRST deposit on the empty vault"
# THE DONE-CHECK MUST PRECEDE THE previewMint ASSERTION, and the ordering is load-bearing on a re-run.
# Once 0xdead holds the shares the vault is no longer empty, so previewMint(1e18) need not still equal
# exactly 1000000 — asserting first would abort an already-finished deployment at a false failure and
# tempt a re-mint of a one-shot step. Ask "is it already done?" before "is it safe to do?".
DEAD_HELD=$(rd "$VAULT" "balanceOf(address)(uint256)" "$DEAD")
if [ -n "$DEAD_HELD" ] && [ "$DEAD_HELD" -ge "$DEAD_SHARES" ] 2>/dev/null; then
  echo "     skip — 0xdead already holds $DEAD_HELD shares (one-shot step already applied)"
else
  NEED=$(read_view nonzero "$VAULT" "previewMint(uint256)(uint256)" "$DEAD_SHARES") \
    || { err "previewMint never returned after retries — refusing to run the one-shot dead deposit blind"; exit 1; }
  echo "     previewMint($DEAD_SHARES) = $NEED asset base units (expected $DEAD_ASSETS_EXPECTED)"
  # Guard the doc conflict for real: refuse to proceed if the cost is not what the fork measured.
  [ "$NEED" = "$DEAD_ASSETS_EXPECTED" ] \
    || { err "dead deposit would cost $NEED, expected $DEAD_ASSETS_EXPECTED — the share/asset semantics changed. STOP and re-derive; this step cannot be undone."; exit 1; }
  tx "approve(vault, $NEED)" "$ASSET" "approve(address,uint256)" "$VAULT" "$NEED"
  tx "mint(DEAD_SHARES, 0xdead)" "$VAULT" "mint(uint256,address)" "$DEAD_SHARES" "$DEAD"
  echo "     0xdead shares = $(rd "$VAULT" "balanceOf(address)(uint256)" "$DEAD")"
fi

echo "── 7. timelocks ≥3 days — increaseTimelock MUST BE LAST (verified: it self-gates once raised)"
# BEFORE the role handover, deliberately. `submit` is CURATOR-gated, so once `setCurator(Safe)` runs
# the deployer can no longer submit anything and every one of these reverts `Unauthorized`
# (0x82b42900). Caught by running this script against a fork with the steps the other way round —
# which is also why Morpho's own flow keeps a temporary curator until the very end.
for sig in "addAdapter(address)" "increaseAbsoluteCap(bytes,uint256)" "increaseRelativeCap(bytes,uint256)" \
           "setForceDeallocatePenalty(address,uint256)" "abdicate(bytes4)" "removeAdapter(address)" \
           "increaseTimelock(bytes4,uint256)"; do
  tl_if need_ge "$TIMELOCK_S" "$VAULT" "timelock(bytes4)(uint256)" "$(cast sig "$sig")" \
    -- "timelock $sig" "increaseTimelock(bytes4,uint256)" "$(cast sig "$sig")" "$TIMELOCK_S"
done

echo "── 8. roles to the 2-of-3 Safe — curator then owner, owner ABSOLUTELY last"
# While the deployer is still owner it can repair a mistake above (owner may re-appoint a curator).
# After `setOwner`, every further change needs the Safe AND a 3-day wait.
tx_if need_true "$VAULT" "isSentinel(address)(bool)" "$SAFE" \
  -- "setIsSentinel(Safe)" "$VAULT" "setIsSentinel(address,bool)" "$SAFE" true
tx_if need_addr "$SAFE" "$VAULT" "curator()(address)" \
  -- "setCurator(Safe)" "$VAULT" "setCurator(address)" "$SAFE"
tx_if need_addr "$SAFE" "$VAULT" "owner()(address)" \
  -- "setOwner(Safe)" "$VAULT" "setOwner(address)" "$SAFE"

echo
echo "════════════════════ RESULT ════════════════════"
printf '  %-22s %s\n' "vault"    "$VAULT"
printf '  %-22s %s\n' "adapter"  "$ADAPTER"
printf '  %-22s %s\n' "asset"    "$(cast call "$VAULT" 'asset()(address)' --rpc-url "$RPC_URL")"
printf '  %-22s %s\n' "name"     "$(cast call "$VAULT" 'name()(string)' --rpc-url "$RPC_URL")"
printf '  %-22s %s\n' "symbol"   "$(cast call "$VAULT" 'symbol()(string)' --rpc-url "$RPC_URL")"
printf '  %-22s %s\n' "owner"    "$(cast call "$VAULT" 'owner()(address)' --rpc-url "$RPC_URL")"
printf '  %-22s %s\n' "curator"  "$(cast call "$VAULT" 'curator()(address)' --rpc-url "$RPC_URL")"
printf '  %-22s %s\n' "totalAssets" "$(cast call "$VAULT" 'totalAssets()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
printf '  %-22s %s / %s\n' "perf/mgmt fee" \
  "$(cast call "$VAULT" 'performanceFee()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')" \
  "$(cast call "$VAULT" 'managementFee()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"
echo
echo "NEXT: add the vault + adapter to contracts/deployments/$CHAIN_ID/addresses.json and to"
echo "      packages/shared/src/addresses/baseSepolia.ts, add a vault_registry row (kind"
echo "      'fee_wrapper' ⇒ feeBasis per_period_gain, so T024's honest copy applies), and run"
echo "      contracts/script/vault-eligibility-check.sh $CHAIN_ID against it."
