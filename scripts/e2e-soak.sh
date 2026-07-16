#!/usr/bin/env bash
# e2e-soak.sh — reproducible full-stack soak for the SparkPoint develop deploy.
#
# Drives the PUBLIC stack end-to-end: web BFF → agent → LiteLLM gateway → OpenRouter (chat),
# and agent /mandate + /recommendations (real Obsidian citations). Emits a per-turn results
# table so "VERIFIED LIVE" claims are reproducible.
#
# Usage:
#   WEB_URL=https://<web-slug>.aldrickb.app \
#   AGENT_URL=https://<agent-slug>.aldrickb.app \
#   S2S_TOKEN=<agent s2s bearer> \
#   [CHATS=20] [RECS=5] \
#   bash scripts/e2e-soak.sh
#
# Prints a Markdown table to stdout. Non-secret: the s2s token scopes reads only (never fund
# authority); model output is not sensitive. The gateway's OpenRouter key is never touched here.
set -u
: "${WEB_URL:?set WEB_URL}"; : "${AGENT_URL:?set AGENT_URL}"; : "${S2S_TOKEN:?set S2S_TOKEN}"
CHATS="${CHATS:-20}"; RECS="${RECS:-5}"
ACC="${TEST_ACCOUNT:-0x2222222222222222222222222222222222222222}"
H=(-H "X-Account: $ACC" -H "X-Owner: $ACC" -H "X-Chain-Id: 84532" -H "Content-Type: application/json")
BH=(-H "Authorization: Bearer $S2S_TOKEN")

Q=("What is an ERC-4626 vault?" "Explain impermanent loss." "Is my vault non-custodial?"
   "What yield does Aave give?" "How does sim-before-sign work?" "What is slippage?"
   "Can you move my funds?" "What is a mandate?" "APY vs APR?" "What is Base network?"
   "How do I withdraw while paused?" "What is a performance fee?" "Define TVL."
   "What is an ERC-4337 account?" "How is risk profile used?" "What is a stablecoin?"
   "Explain a yield strategy." "What is the deposit cap?" "How does rebalancing work?"
   "What is a guardian role?")

echo "## chat soak ($CHATS turns via BFF → agent → gateway → OpenRouter)"
echo
echo "| # | verdict | latency (ms) |"
echo "|---|---------|--------------|"
real=0
for i in $(seq 0 $((CHATS - 1))); do
  msg="${Q[$((i % ${#Q[@]}))]}"
  t0=$(date +%s%N)
  body=$(curl -s -N --max-time 90 "${H[@]}" -X POST "$WEB_URL/api/agent/chat" \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"message":sys.argv[1]}))' "$msg")" 2>/dev/null)
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  if printf '%s' "$body" | grep -qiE '"type":"(text|tip|recommendation)"' && printf '%s' "$body" | grep -qi 'event: done'; then
    v=REAL; real=$((real + 1)); else v=FAILCLOSED; fi
  echo "| $i | $v | $ms |"
  sleep 2
done
echo
echo "**=> $real/$CHATS REAL completions**"
echo

echo "## recommendations (real Obsidian citations)"
echo
mres=$(curl -s --max-time 30 "${BH[@]}" "${H[@]}" -X POST "$AGENT_URL/mandate" \
  -d '{"mandate":{"goals":[{"kind":"preserve","label":"Preserve capital"}],"riskProfile":"conservative","riskParams":{"maxSlippageBps":50,"drawdownTolerance":"low","horizonMonths":12},"summaryText":"Conservative capital preservation on Base."}}' 2>/dev/null)
echo "- mandate POST: $(printf '%s' "$mres" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("OK v"+str(d.get("mandate",{}).get("version","?")) if "mandate" in d else d.get("error",{}).get("code","?"))' 2>/dev/null)"
echo
echo "| # | recs | total citations |"
echo "|---|------|-----------------|"
count_recs() {  # reads the JSON on stdin → "<recs> | <total citations>"
  python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
r = d.get("recommendations", [])
print(f"{len(r)} | {sum(len(x.get('citations', [])) for x in r)}")
PY
}
for i in $(seq 0 $((RECS - 1))); do
  r=$(curl -s --max-time 60 "${BH[@]}" "${H[@]}" "$AGENT_URL/recommendations?limit=5" 2>/dev/null)
  echo "| $i | $(printf '%s' "$r" | count_recs 2>/dev/null) |"
  sleep 2
done
