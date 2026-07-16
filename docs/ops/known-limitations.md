# Known limitations — develop (as-built)

Honest, current-state caveats for the deployed develop stack. Each is intentional/tracked, not
a silent gap. Update in the same change that resolves one.

## LLM gateway (Phase A)

- **`readyz.llm` is process-liveness only.** The check GETs the gateway's `/health/liveliness`
  (cached ~60s) — it proves the LiteLLM proxy is *reachable*, NOT that OpenRouter/the model can
  actually complete. A gateway that is up but whose upstream is fully rate-limited would still
  report `llm: true`; chat then degrades fail-closed (a real answer or an inert error, never a
  fabrication). A true model-health check (a cheap 1-token ping) is a follow-up.
- **`Retry-After` is not honored on the gateway path.** The client resilience layer honors
  `Retry-After` for the Anthropic SDK path, but `GatewayError` (OpenAI/LiteLLM path) carries only
  a status code, not the upstream response headers — so a 429 from the gateway is retried on the
  jittered backoff schedule, ignoring any `Retry-After` the gateway/OpenRouter returned. Acceptable
  (bounded retries, fail-closed) but not optimal; thread the header into `GatewayError` to fix.
- **Per-user budgets are inert until Phase B.** The gateway is wired to key budgets/limits off the
  LiteLLM `user` field, but the production callers (planner / recommender / literacy) do not yet
  pass a `user` (no server-verified identity exists until SIWE lands in Phase B). Today only the
  service-level virtual-key limits (rpm/tpm + daily budget) apply. **Also: `readyz` does not warn on
  budget exhaustion** — if the virtual key's daily budget is spent, chat fails-closed but `readyz.llm`
  stays green (it only probes liveness).
- **Free-tier latency.** `sparkpoint-chat`'s models are OpenRouter `:free` (primary heavily 429'd);
  chat latency is ~7–28 s (median ~12 s). Swap the alias to a cheap paid model / BYOK key on the
  gateway (`services/litellm/config.yaml`) for a snappy demo — config-only, no code change.

## Knowledge / retrieval (P2)

- **The chat path has no Obsidian grounding.** Citation retrieval is wired into the *recommender*
  only, so `/recommendations` cards carry real Obsidian citations but the conversational `/chat`
  replies do not cite the corpus. Wiring `knowledge_search` into the chat DAG (planner/literacy) is
  a Phase B/C item.

## Contracts / AA (from the Jul-16 audit — Phase 3)

- **Session-key automation (US6) is undeployed.** The ERC-4337 account + PolicyModule are not on
  chain; `/trust/permissions` says so honestly. The safe-mode bundler spike could not render a clean
  ERC-7562 verdict on Anvil (tooling), but the tracer confirmed a `recordSpend`-in-validation
  external-storage write to resolve before Phase-3 AA (see `contracts/script/bundler-spike/RESULT-safemode.md`).
