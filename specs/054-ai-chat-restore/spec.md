# Spec 054 — Restore free chat and refund failed turns

**Status:** implemented 2026-10-27 · **Owner:** build · **Branch:** `fix/054-ai-models`
**Contracts:** none (gateway config + agent quota internals only).

## Why

Beta chat was failing every free turn with an inert `UPSTREAM_UNAVAILABLE` block. The diagnosis
(`/home/hello/project/.oc-ai-fix/diagnosis.md`, 2026-10-27) found:

- `sparkpoint-chat` had two free deployments, both dead: Nvidia returned **404** for
  `nvidia/nemotron-3-super-120b-a12b:free` (endpoint `status -5`) and Google AI Studio returned
  **429** for `google/gemma-4-31b-it:free`.
- The router cooled both, then returned `No deployments available`; a 404 from the dead primary
  also reached the agent, whose resilience layer treats 404 as non-retryable.
- There was no free → paid fallback (correctly, for cost), so the group had no healthy member.

Separately, quota was charged **before** the route ran, so a turn that ended in
`UPSTREAM_UNAVAILABLE` still consumed that day's chat allowance.

## What

1. **Restore the free group with three verified free deployments from three providers** in
   `services/litellm/config.yaml`:
   - `nvidia/nemotron-3-ultra-550b-a55b:free` (primary, weight 4)
   - `cohere/north-mini-code:free` (fallback, weight 3)
   - `poolside/laguna-s-2.1:free` (fallback, weight 1)
   Premium/self-authoring groups are unchanged. No paid model joins the free group.
2. **Make a 404 fail over inside the group.** The pinned gateway is LiteLLM **1.92.0**, whose
   `should_retry_this_error` raises `NotFoundError` before the retry loop and whose `RetryPolicy`
   has no 404 field. Set `router_settings.enable_weighted_failover: true`, which re-picks a
   weighted healthy deployment in the same group while excluding the failed one. Keep
   `allowed_fails: 1` / `cooldown_time: 30`.
3. **Give reasoning models prose headroom.** The new free models reason before answering, so
   Sparky's `MAX_TOKENS` moves 320 → 640; `MAX_CHARS = 700` still bounds the visible reply.
4. **Refund failed turns.** `/chat`, `/recommendations`, and `/onboarding/turn` keep charging once
   on admission, but an LLM/upstream failure decrements the same owner/metric/**window captured at
   consume time**, clamped at 0, with a masked `refund` limits event. No migration. Refunds are
   fail-safe; success and client disconnects are not refunded.

Evidence table: `/home/hello/project/.oc-ai-fix/candidates.md`.

## Acceptance

- A real free-chat question on beta returns prose (no `UPSTREAM_UNAVAILABLE`) and an intent-shaped
  JSON answer still validates; a Taglish question gets a sensible answer.
- A 404 from one free deployment serves from another deployment in the same group; no paid group
  is entered from free.
- A failed `/chat` turn leaves the owner's quota unchanged (refund), while a successful turn and
  a client disconnect do not refund.
- Agent CI: ruff (whole tree), strict mypy, and the full pytest suite pass. The only ruff failures
  are four pre-existing `test_mint_whitelist.py` E501s that also fail on a clean `origin/main`.
- Both repo and in-app changelogs handled per the living-docs rule. The swap itself gets no
  user-facing in-app entry (operator decision in #307); the quota refund has proposed wording only.

## Rollout

1. Deploy `sparkpoint-litellm-beta` (`kw80k400c4ssc04w0kwkgwow`) from this branch/main so the new
   `config.yaml` is baked into the gateway image.
2. Deploy `sparkpoint-agent-beta` (`k4cwosc0c8kkswcco0wg8cko`) so Sparky's 640-token cap and the
   quota refund are live.
3. Verify on beta: one prose question, one Taglish question, one intent-style action request; then
   force/observe a failed turn and confirm the quota counter is unchanged.

## Operator-only option (not applied)

**Paid backstop:** create a separate `sparkpoint-chat-paid` group (e.g. Ling 3.0 Flash) and add a
one-way fallback `sparkpoint-chat → sparkpoint-chat-paid` (never a two-way chat ↔ premium cycle).
This buys hard availability at a small per-turn cost, but it changes spend, so it needs the
operator's explicit approval. Not part of this change.
