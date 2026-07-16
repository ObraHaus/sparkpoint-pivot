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

## Auth / access control (Phase B)

- **SIWE session is stateless (no server-side revocation list).** The session is a signed, 7-day
  httpOnly cookie; there is no per-session store, so a specific session can't be revoked before
  expiry short of rotating `SESSION_SECRET` (which logs everyone out). Allowlist changes take effect
  on the wallet's **next login** (roles are baked into the cookie at login). Acceptable for the
  access gate — it never gates custody (/exit, /trust, withdraw stay open, N2). *(Phase-3: add a
  server-side session/jti store or short TTL + refresh for true revocation.)*
- **Allowlist env seed is ADDITIVE-ONLY.** `BETA_ALLOWLIST` / `ADMIN_ALLOWLIST` seed the DB on agent
  boot by *adding* missing rows — removing a wallet from the env and redeploying does **NOT** revoke
  it (the row persists). The **DB / admin panel is the authority**: remove a wallet via `/admin/allowlist`
  (audit-logged) or a DB delete; the env is bootstrap + disaster-recovery only.
- **The web copy of `BETA_ALLOWLIST`/`ADMIN_ALLOWLIST` is vestigial (dead).** Only the **agent** reads
  them (to seed the DB); the web derives access purely from the session claims. `sync-allowlist-env.sh`
  now writes them to the **agent only** — any lingering copy on the web app is inert and can be deleted.
- **The agent trusts `X-Owner` with format-validation only.** The agent authenticates the *web tier*
  via the S2S bearer, then trusts the `X-Owner`/`X-Account` headers the BFF sets (20-byte-address
  format check only — no on-chain owner proof). A **leak of `AGENT_S2S_TOKEN` = full admin impersonation**
  (an attacker could set `X-Owner` to an admin wallet and hit `/admin/*`). Mitigations today: the token
  is server-side only (never `NEXT_PUBLIC`, never logged) and the agent is reached only via the BFF.
  **Phase-3 hardening:** bind the S2S call to a signed session assertion (or mTLS / per-request MAC over
  the derived identity) so a bare token can't assert an arbitrary owner.
- **Beta gate now covers the API, not just pages (B.1).** The BFF (`/api/agent/*`) requires an
  allowlisted (beta) session for the assistant + all write/derivation endpoints (403 otherwise); only
  read-only liveness probes (`readyz`/`healthz`) are exempt. Previously a signed-in but non-beta wallet
  could POST `/api/agent/chat`.
- **Admin LLM-gateway view is best-effort + read-only.** `/admin/gateway` reads the LiteLLM proxy
  with the agent's virtual key; fields the gateway version doesn't expose show as "—"/null, and the
  page cannot mutate gateway config (no master key is placed on the agent). Spend/limits reflect the
  single service virtual key, not per-user rollups yet.
- **Client `useBeta` still has a testnet-permissive fallback.** When signed in, the server session's
  `beta` claim is authoritative; but while the session is still loading (or when disconnected) the
  deposit gate falls back to the client default (permissive on Base Sepolia). The middleware is the
  real enforcement, so this only affects a brief pre-session render.

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
