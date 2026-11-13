#!/usr/bin/env bash
#
# Cron entry point for the activity bots.
#
# ⚠️⚠️ THIS FILE IS THE PRODUCTION ENTRY POINT AND IT MUST STAY IN THE REPO. It spent a day as an
# untracked file on one machine, which meant the thing actually running the fleet was reviewed by
# nobody, backed up nowhere, and invisible to anyone reading this directory.
#
# ⚠️ The repo's .timer/.service units are for a real host; this workspace has no systemd --user
# bus, so cron is the equivalent here. The cadence must match BOT_INTERVAL_SEC below or the panel
# judges lateness against a promise the schedule never makes.
#
# ⚠️ Run from a DEDICATED checkout, never a dev working copy: the parallel sparkpoint-pivot-N
# copies get rebased and reset by other agents, and a recurring job whose code silently changes
# underneath it is worse than no job.
#
set -uo pipefail
cd "$(dirname "$0")"

LOG=$HOME/.config/sparkpoint/bots-cron.log

# ⚠️⚠️ cron runs with a MINIMAL PATH — roughly /bin:/usr/bin:/sbin — which does NOT include an
# nvm-managed node. Every scheduled cycle for ten hours died on `node: command not found`, logged
# "degraded", and exited 0. The bot fired punctually, on time, and did absolutely nothing.
#
# It surfaced only because the admin panel went `overdue`: no cycle completed, so no run was ever
# reported. That is the monitor doing its job, but the runner should not need rescuing by it.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  # A missing interpreter is a BROKEN RUNNER, not a degraded cycle. Fail loudly and non-zero so
  # cron reports it and the next person to read the log sees a cause rather than a symptom.
  echo "FATAL $(date -u +%Y-%m-%dT%H:%M:%SZ): node not on PATH (PATH=$PATH)" | tee -a "$LOG" >&2
  exit 127
fi

set -a
# shellcheck disable=SC1091
. $HOME/.env 2>/dev/null
set +a

export BOT_SCHEDULE="hourly"
export BOT_INTERVAL_SEC=3600
export AGENT_BASE_URL="${AGENT_BASE_URL:-http://localhost:8000}"
BOT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export BOT_COMMIT

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) commit=$BOT_COMMIT node=$(node --version)"
  ./run-cycle.sh --broadcast 2>&1
  echo "── wrapper exit=$?"
} >> "$LOG" 2>&1

# Keep the log bounded; a runner nobody prunes eventually fills a disk.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
