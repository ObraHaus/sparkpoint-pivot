#!/usr/bin/env bash
#
# One scheduled cycle of the testnet activity bots.
#
# ⚠️ THE RUNNER OWNS THE SCHEDULE. Nothing in the deployed stack can start, stop or re-time this —
# the agent is provably keyless and must stay that way, so the keys and the cadence both live here.
# The admin panel is a mirror: this script reports what it did afterwards, and the panel renders
# that. If the panel says a stream is overdue, the answer is on this machine, not in the app.
#
# Cadence is declared here and reported to the panel, so "what should be happening" and "what did
# happen" come from the same place. Change the timer, change BOT_INTERVAL_SEC to match — a schedule
# the panel is told about but that nothing enforces would be worse than none.
#
#   BOT_SCHEDULE      human string shown in the panel        (e.g. "hourly")
#   BOT_INTERVAL_SEC  seconds until the next run             (e.g. 3600)
#   AGENT_BASE_URL    where to report                        (unset = reporting off)
#   AGENT_S2S_TOKEN   the service bearer
#
# Usage:  ./run-cycle.sh            # dry run, prints what it would do
#         ./run-cycle.sh --broadcast
#
set -euo pipefail
cd "$(dirname "$0")"

BROADCAST="${1:-}"
export BOT_SCHEDULE="${BOT_SCHEDULE:-hourly}"
export BOT_INTERVAL_SEC="${BOT_INTERVAL_SEC:-3600}"
export BOT_COMMIT="${BOT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"

run() { node --experimental-strip-types src/bot.ts "$@" ${BROADCAST:+--broadcast}; }

echo "── cycle $(date -u +%Y-%m-%dT%H:%M:%SZ)  schedule=${BOT_SCHEDULE}  broadcast=${BROADCAST:-no}"

# Swaps on Robinhood ONLY. Base Sepolia's WETH/USDC pool holds ~0.034 WETH — bot volume there would
# visibly move the price a real tester is quoted, so the tool refuses it and so does this.
echo "── swaps (robinhood)"
run swap --chain 46630 --count 2 --wallets 5 --amount 0.0002 || echo "  swap cycle degraded"

# Realising the vault fee is permissionless and cheap (82,896 gas). Running it every cycle is
# harmless: with nothing above the high-water mark it is a no-op that costs one call, and the
# alternative — realising rarely — makes the revenue surface lumpy for no benefit.
echo "── accrue (base sepolia)"
run accrue --chain 84532 || echo "  accrue degraded"

echo "── cycle done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
