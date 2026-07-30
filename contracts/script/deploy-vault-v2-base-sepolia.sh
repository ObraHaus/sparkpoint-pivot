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
tx() {
  local label="$1"; shift
  printf '  %-56s ' "$label"
  local out status
  out=$(cast send "$@" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC_URL" --json 2>&1) || {
    err "$label: cast send failed: $(printf '%s' "$out" | head -2)"; exit 1; }
  status=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)
  [ "$status" = "0x1" ] || { err "$label: status=${status:-<no receipt>} — ABORTING before the next step"; exit 1; }
  echo "ok"
}

# A timelocked curator selector: submit(calldata) then the call itself. Immediate while the
# selector's timelock is still 0 — which is why every timelock is raised LAST.
tl() {
  local label="$1"; shift
  local sig="$1"; shift
  tx "submit $label" "$VAULT" "submit(bytes)" "$(cast calldata "$sig" "$@")"
  tx "exec   $label" "$VAULT" "$sig" "$@"
}

echo "── 1. create the vault (owner = deployer for now, handed to the Safe at step 6)"
SALT=$(cast keccak "sparkpoint-usdc-v2-basesepolia-001")
tx "createVaultV2" "$VAULT_V2_FACTORY" "createVaultV2(address,address,bytes32)" "$DEPLOYER" "$ASSET" "$SALT"
# Read the address back from the factory's own view rather than parsing logs.
VAULT=$(cast call "$VAULT_V2_FACTORY" "vaultV2(address,address,bytes32)(address)" \
        "$DEPLOYER" "$ASSET" "$SALT" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || true)
if [ -z "${VAULT:-}" ] || [ "$VAULT" = "0x0000000000000000000000000000000000000000" ]; then
  err "could not resolve the created vault address from the factory — inspect the receipt logs and re-run with VAULT preset."
  exit 1
fi
echo "     VAULT = $VAULT"
[ "$(cast call "$VAULT_V2_FACTORY" "isVaultV2(address)(bool)" "$VAULT" --rpc-url "$RPC_URL")" = "true" ] \
  || { err "factory does not attest $VAULT"; exit 1; }

echo "── 2. temporary curator + the market adapter"
tx "setCurator(deployer)" "$VAULT" "setCurator(address)" "$DEPLOYER"
tx "createMorphoMarketV1AdapterV2" "$ADAPTER_FACTORY" "createMorphoMarketV1AdapterV2(address)" "$VAULT"
ADAPTER=$(cast call "$ADAPTER_FACTORY" "morphoMarketV1AdapterV2(address)(address)" "$VAULT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "     ADAPTER = $ADAPTER"

echo "── 3. caps (three id PRE-IMAGES; the vault hashes them)"
ID_ADAPTER=$(cast abi-encode "f(string,address)" "this" "$ADAPTER")
ID_COLL=$(cast abi-encode "f(string,address)" "collateralToken" "$M_COLL")
MP="($M_LOAN,$M_COLL,$M_ORACLE,$M_IRM,$M_LLTV)"
ID_MARKET=$(cast abi-encode "f(string,address,(address,address,address,address,uint256))" "this/marketParams" "$ADAPTER" "$MP")
MARKET_DATA=$(cast abi-encode "f((address,address,address,address,uint256))" "$MP")
# Cross-check: keccak of the "this" pre-image must equal the adapter's own adapterId.
ONCHAIN_ADAPTER_ID=$(cast call "$ADAPTER" "adapterId()(bytes32)" --rpc-url "$RPC_URL" | awk '{print $1}')
[ "$(cast keccak "$ID_ADAPTER")" = "$ONCHAIN_ADAPTER_ID" ] \
  || { err "cap-id pre-image mismatch: keccak(idData) != adapter.adapterId() — caps would be set on the wrong id"; exit 1; }
echo "     cap-id pre-image verified against adapter.adapterId()"

tl "setIsAllocator(deployer)" "setIsAllocator(address,bool)" "$DEPLOYER" true
tl "addAdapter" "addAdapter(address)" "$ADAPTER"
tl "absCap(adapter)"  "increaseAbsoluteCap(bytes,uint256)" "$ID_ADAPTER" "$ABSOLUTE_CAP"
tl "relCap(adapter)"  "increaseRelativeCap(bytes,uint256)" "$ID_ADAPTER" "$RELATIVE_CAP"
tl "absCap(collateral)" "increaseAbsoluteCap(bytes,uint256)" "$ID_COLL" "$ABSOLUTE_CAP"
tl "relCap(collateral)" "increaseRelativeCap(bytes,uint256)" "$ID_COLL" "$RELATIVE_CAP"
tl "absCap(market)"   "increaseAbsoluteCap(bytes,uint256)" "$ID_MARKET" "$ABSOLUTE_CAP"
tl "relCap(market)"   "increaseRelativeCap(bytes,uint256)" "$ID_MARKET" "$RELATIVE_CAP"
tl "setAdapterRegistry" "setAdapterRegistry(address)" "$MORPHO_REGISTRY"

echo "── 4. allocator settings (not timelocked) + name/symbol"
tx "setMaxRate" "$VAULT" "setMaxRate(uint256)" "$MAX_RATE"
tx "setLiquidityAdapterAndData" "$VAULT" "setLiquidityAdapterAndData(address,bytes)" "$ADAPTER" "$MARKET_DATA"
tx "setName"   "$VAULT" "setName(string)" "$VAULT_NAME"
tx "setSymbol" "$VAULT" "setSymbol(string)" "$VAULT_SYMBOL"

echo "── 5. abdicate PERMANENTLY: the three critical gate setters + the adapter registry"
# The three gates are the one real N2 hole: a live gate lets a role holder block share or asset
# movement, and on the exit path that is a SparkPoint-side block on a withdrawal. `abdicate` is
# irreversible, which is the point — after this, no one can ever install one.
for sig in "setReceiveSharesGate(address)" "setSendSharesGate(address)" "setReceiveAssetsGate(address)" "setAdapterRegistry(address)"; do
  tl "abdicate $sig" "abdicate(bytes4)" "$(cast sig "$sig")"
done
for sel in 0x2cb19f98 0xc21ad028 0x04dbf0ce; do
  [ "$(cast call "$VAULT" "abdicated(bytes4)(bool)" "$sel" --rpc-url "$RPC_URL")" = "true" ] \
    || { err "gate $sel is NOT abdicated — refusing to continue (N2)"; exit 1; }
done
echo "     all three critical gates abdicated"

echo "── 6. DEAD DEPOSIT — one-shot, irreversible, and the FIRST deposit on the empty vault"
NEED=$(cast call "$VAULT" "previewMint(uint256)(uint256)" "$DEAD_SHARES" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "     previewMint($DEAD_SHARES) = $NEED asset base units (expected $DEAD_ASSETS_EXPECTED)"
# Guard the doc conflict for real: refuse to proceed if the cost is not what the fork measured.
[ "$NEED" = "$DEAD_ASSETS_EXPECTED" ] \
  || { err "dead deposit would cost $NEED, expected $DEAD_ASSETS_EXPECTED — the share/asset semantics changed. STOP and re-derive; this step cannot be undone."; exit 1; }
tx "approve(vault, $NEED)" "$ASSET" "approve(address,uint256)" "$VAULT" "$NEED"
tx "mint(DEAD_SHARES, 0xdead)" "$VAULT" "mint(uint256,address)" "$DEAD_SHARES" "$DEAD"
echo "     0xdead shares = $(cast call "$VAULT" "balanceOf(address)(uint256)" "$DEAD" --rpc-url "$RPC_URL" | awk '{print $1}')"

echo "── 7. timelocks ≥3 days — increaseTimelock MUST BE LAST (verified: it self-gates once raised)"
# BEFORE the role handover, deliberately. `submit` is CURATOR-gated, so once `setCurator(Safe)` runs
# the deployer can no longer submit anything and every one of these reverts `Unauthorized`
# (0x82b42900). Caught by running this script against a fork with the steps the other way round —
# which is also why Morpho's own flow keeps a temporary curator until the very end.
for sig in "addAdapter(address)" "increaseAbsoluteCap(bytes,uint256)" "increaseRelativeCap(bytes,uint256)" \
           "setForceDeallocatePenalty(address,uint256)" "abdicate(bytes4)" "removeAdapter(address)" \
           "increaseTimelock(bytes4,uint256)"; do
  tl "timelock $sig" "increaseTimelock(bytes4,uint256)" "$(cast sig "$sig")" "$TIMELOCK_S"
done

echo "── 8. roles to the 2-of-3 Safe — curator then owner, owner ABSOLUTELY last"
# While the deployer is still owner it can repair a mistake above (owner may re-appoint a curator).
# After `setOwner`, every further change needs the Safe AND a 3-day wait.
tx "setIsSentinel(Safe)" "$VAULT" "setIsSentinel(address,bool)" "$SAFE" true
tx "setCurator(Safe)"    "$VAULT" "setCurator(address)" "$SAFE"
tx "setOwner(Safe)"      "$VAULT" "setOwner(address)" "$SAFE"

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
