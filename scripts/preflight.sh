#!/usr/bin/env bash
# SparkPoint Phase-2 machine-checkable preflight — the wave-barrier gate (R7/§04).
# Re-run at each wave barrier. W0 baseline expects some FAILs (unfunded wallets,
# Anvil not yet up); later barriers require PREFLIGHT GREEN. Informational exit 0.
set -uo pipefail
ENVF="${ENV_FILE:-$HOME/.env}"
# shellcheck disable=SC1090
[ -f "$ENVF" ] && { set -a; . "$ENVF"; set +a; }
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
pass=0; fail=0
ok(){ echo "  PASS  $1"; pass=$((pass+1)); }
no(){ echo "  FAIL  $1"; fail=$((fail+1)); }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "== toolchain =="
for t in forge anvil cast slither node pnpm uv jq; do have "$t" && ok "$t on PATH" || no "$t missing"; done
if have docker; then
  if docker info >/dev/null 2>&1; then ok "docker usable without sudo"
  elif id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then no "in 'docker' group but daemon unreachable — start dockerd / re-login for the group to take effect (W3/W4)"
  else no "docker needs the group: 'sudo usermod -aG docker \$USER' then re-login (W3/W4)"; fi
else no "docker missing (W3/W4)"; fi

echo "== env vars (no vendor Tenderly) =="
for v in ANTHROPIC_OAUTH_TOKEN ALCHEMY_ACCESS_KEY REOWN_WALLET_CONNECT_PROJECT_ID DUNE_API_KEY BASESCAN_ETHERSCAN_API_KEY DEPLOYER_ADDRESS DEPLOYER_PRIVATE_KEY TEST_USER_ADDRESS BASE_MAINNET_ARCHIVE_RPC_URL SIM_FORK_RPC_URL; do
  [ -n "${!v:-}" ] && ok "$v set" || no "$v missing"
done
[ -z "${TENDERLY_API_URL:-}" ] && ok "no TENDERLY_* runtime dep" || echo "  WARN  TENDERLY_* still present — remove (downstream sync)"

echo "== sim-fork reachable (<anvil-host>) =="
if [ -n "${SIM_FORK_RPC_URL:-}" ] && cast block-number --rpc-url "$SIM_FORK_RPC_URL" >/dev/null 2>&1; then ok "SIM_FORK eth_blockNumber"; else no "SIM_FORK unreachable (install Anvil on <anvil-host> — W3)"; fi

echo "== chain: pinned code + deployer + Aave USDC (Base Sepolia 84532) =="
SEP="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032
POOL=0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27
USDC=0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f
AUSDC=0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC
for a in "$EP" "$POOL" "$USDC" "$AUSDC"; do
  code=$(cast code "$a" --rpc-url "$SEP" 2>/dev/null || echo 0x)
  [ -n "$code" ] && [ "$code" != "0x" ] && ok "code @ ${a:0:10}…" || no "no code @ ${a:0:10}…"
done
if [ -n "${DEPLOYER_ADDRESS:-}" ]; then
  # Minimum deployer balance to clear the gate — parameterizable (a testnet deploy + the
  # withdraw-always drill costs well under 0.02 ETH on Base Sepolia). Override for a bigger buffer.
  MIN_ETH="${PREFLIGHT_MIN_DEPLOYER_ETH:-0.02}"
  bal=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$SEP" 2>/dev/null || echo 0)
  if python3 -c "import sys;sys.exit(0 if int('${bal:-0}')>=int(float('${MIN_ETH}')*10**18) else 1)" 2>/dev/null; then ok "deployer >= ${MIN_ETH} ETH"; else no "deployer < ${MIN_ETH} ETH (faucet Base Sepolia ETH — human)"; fi
  eoa="${TEST_USER_ADDRESS:-$DEPLOYER_ADDRESS}"
  ud=$(cast call "$USDC" "balanceOf(address)(uint256)" "$eoa" --rpc-url "$SEP" 2>/dev/null | awk '{print $1}')
  { [ -n "$ud" ] && [ "$ud" != "0" ]; } && ok "Aave-reserve USDC balance > 0" || no "test EOA has no Aave-reserve USDC (TestnetERC20.mint — pre-W5c)"
fi

echo ""
echo "== SUMMARY: $pass pass / $fail fail =="
if [ "$fail" -eq 0 ]; then echo "PREFLIGHT GREEN"; else echo "PREFLIGHT INCOMPLETE — expected before funding/Anvil; must be GREEN at the W5c/Gate-B barrier."; fi
exit 0
