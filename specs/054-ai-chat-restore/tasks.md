# Tasks — 054 Restore free chat and refund failed turns

## Gateway

- [x] **T901** Probe all listed free candidates with the deployed key (prose, real intent JSON,
      Taglish), record status/latency/content/JSON/quality in `candidates.md`.
- [x] **T902** Replace the dead `sparkpoint-chat` pair with Nemotron 3 Ultra (4) / Cohere North
      Mini Code (3) / Poolside Laguna S 2.1 (1); three providers.
- [x] **T903** Confirm pinned LiteLLM 1.92.0 behaviour for `NotFoundError`; add
      `enable_weighted_failover: true` (the 1.92.0 safe knob) and document it.
- [x] **T904** Update header comments in house style; no premium/selfauthor changes; no paid
      fallback.

## Agent

- [x] **T905** Sparky `MAX_TOKENS` 320 → 640 (reasoning headroom; visible reply still clamped).
- [x] **T906** `LimitsStore.refund` (same window, clamp at 0, no migration).
- [x] **T907** `LimitDecision` carries `window_start`/`consumed`; fail-safe `refund()` + masked
      `refund` event.
- [x] **T908** Wire `/chat` (SSE error path), `/recommendations` (`UPSTREAM_UNAVAILABLE` only),
      `/onboarding/turn` (stream failure).
- [x] **T909** Tests: refund on upstream failure, no refund on success, fail-open no-op, clamp at
      0, refund error swallowed, N2 dependency-tree guard.

## Docs / verification

- [x] **T910** `CHANGELOG.md` + `COOLIFY.md` lineup; this Spec Kit record.
- [x] **T911** Run CI checks locally: ruff, strict mypy, full pytest; record the pre-existing
      `test_mint_whitelist.py` ruff failures with `origin/main` evidence.
- [ ] **T912** Operator: deploy `sparkpoint-litellm-beta` then `sparkpoint-agent-beta`; verify real
      answers + refund on beta.
- [ ] **T913** Operator decision: paid backstop (`sparkpoint-chat-paid` + one-way fallback), only
      if hard availability is worth the spend.
