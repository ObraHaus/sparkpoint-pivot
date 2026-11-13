# Phase A — LLM gateway pivot (OpenRouter via LiteLLM): live verification

Evidence that the assistant is unblocked via the new gateway, captured against the **deployed**
develop stack (public web → same-origin BFF → agent → LiteLLM gateway → OpenRouter). No mocks.

## Topology

`browser → https://<coolify-uuid><internal-host> (web) → /api/agent BFF → agent (Hermes) →
LiteLLM gateway (<internal-host>, alias sparkpoint-chat) → OpenRouter`

- Gateway model group `sparkpoint-chat`: primary `openrouter/google/gemma-4-31b-it:free`
  (operator's `OPENROUTER_MODEL`) + verified free fallback `google/gemma-4-26b-a4b-it:free`,
  router retries + 30s cooldown. Only the gateway holds the OpenRouter key; Hermes uses a
  per-service **virtual key** (rpm 20 / tpm 40k / $5-a-day).
- `readyz` `llm` check = a live GET of the gateway `/health/liveliness` (cached ~60s).

## 1. Real chat completion (verbatim, via the public BFF)

Request: `POST /api/agent/chat {"message":"What is an ERC-4626 vault?"}` → SSE. A genuine
model completion (NOT the fail-closed error block):

```
event: block  data: {"type":"tool_step","label":"Understanding your request","status":"done"}
event: block  data: {"type":"tip","topic":"...","body":"An ERC-4626 vault is a standardized
  way for a smart contract to act as a digital savings account that automatically manages your
  deposits. When you deposit funds, the vault uses that money to participate in yield-generating
  activities and issues you tokens that represent your share of the pool. Yield…"}
event: done   data: {"conversationId":"cnv_…","blockCount":5}
```

## 2. Chat soak — 20 messages through the deployed BFF

**20 / 20 REAL completions.** Latency min/median/max = **7.3 / 12.3 / 28.3 s** (the OpenRouter
free tier is slow, and the primary model is frequently 429 so the router falls back — but every
turn returned a real answer). The client-side resilience layer (jittered retry / limiter /
fail-closed SSE) is unchanged; the gateway adds enforcement on top.

## 3. Live recommendation cards render REAL Obsidian citations

After persisting a conservative mandate (`POST /mandate` → v1), `GET /recommendations`
returned **2 policy-approved recommendations, each with 6 real Obsidian citations** — proving
the P2 retrieval path is live now that the LLM turn works:

```
REC "Liquidity Supply"  (protocol aave_v3, policy=approved)
   cite: USDC Yield Strategies on Base            → obsidian://usdc-yield-strategies
   cite: Conservative/Moderate/Growth Risk Framing → obsidian://risk-profiles
   cite: Aave v3 Supply Mechanics                 → obsidian://aave-v3-supply
REC "Vault Deposit"     (protocol aave_v3, policy=approved)   [same relevant sources]
```

## Honest notes

- **Latency**: free-tier OpenRouter models are slow (median ~12s, tail ~28s). For a snappy demo,
  swap `sparkpoint-chat` to a cheap paid model or add a BYOK provider key on the gateway — a
  one-line `config.yaml` change; no code change (the alias is stable).
- **Gateway `/openapi.json`** is still 200 (schema only; `/docs` is 404 and every functional
  endpoint requires the virtual key — 401 without). Disabling the schema route is a minor
  follow-up.

_Raw per-turn logs: `scratchpad/e2e-out/` (ephemeral). Reproduce: the 20-chat + mandate + 5-rec
script hits the public URLs with the s2s bearer + scoping headers._
