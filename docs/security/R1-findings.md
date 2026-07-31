# Alpha security audit — Round 1 (R1) findings register

> Part of the mainnet-readiness set. **Start at [`mainnet-readiness.md`](../orchestration/mainnet-readiness.md)** for the
> full picture; this file is the detail behind one part of it.

**Audit date:** 2026-07-21 · **Target:** the alpha at `develop` (pre-019/020/021/022/023) ·
**Mode:** full-depth adversarial, **report-only — no code was changed by the audit itself**.

**Result:** 32 raw findings → 7 refuted → **25 real: 0 critical, 0 high survived verification,
3 medium, ~15 low, 7 info.** Verdict at the time: *the custody/auth core is genuinely and competently
hardened; residual risk is defence-in-depth and ops, not a broken control.*

---

## ⚠️ Provenance and completeness — read before relying on this

R1 was delivered as an **artifact, and its report was never committed to this repo**. This register was
reconstructed on **2026-07-30** while preparing T103, from the audit's recorded summary. It is
therefore **partial by construction**:

| | Status here |
|---|---|
| The 3 **mediums** | Recorded in full, each verified against current code and given a status. |
| The ~15 **lows** | Titles recorded. **Not individually verified** against current code. |
| The 7 **info** items | Titles recorded. Not verified. |
| The **round-2 seam list** | Recorded — this is the highest-value input to R2. |
| Per-finding detail, repro steps, file:line for lows/infos | **MISSING.** Only in the artifact. |

**Action:** transcribe the full artifact over this file when it is to hand. Until then, treat the
medium rows as authoritative (verified today) and the low/info rows as an index, not a report.

**Why this file exists at all:** an audit whose findings live outside the repo cannot be tracked to
closure, and gets re-litigated. Two of the three mediums are now resolved and that fact was recorded
nowhere. See [`../orchestration/t103-audit-readiness.md`](../orchestration/t103-audit-readiness.md) §2.

---

## Mediums — all three, with status verified 2026-07-30

### M1 · Chat inline swap slippage unbounded → **FIXED** (2026-07-30)

**Finding.** `live-blocks.tsx` forwarded the agent's `maxSlippageBps` straight to the on-chain
`minOut`; `ActionParamsSchema` (`action.ts:25`) had no upper bound; and the swap "Review" button renders
regardless of `policy.status === 'approved'` because the swap path is policy-independent by design. So a
compromised or prompt-injected agent proposing 9900 bps ⇒ `minOut ≈ 0` ⇒ sandwichable.

**Verified still live on 2026-07-30** while recording [D-GC-02](../orchestration/gate-c-decisions.md):
the schema was still `nonnegative()` with no max, the forward was unchanged, and
`amountOutMinimum`'s own clamp is `[0, 10000]` bps — 100%, i.e. no protection. The bound was chosen by
the **model**, not the user.

**Fix** (`fix/r1-medium-unbounded-chat-slippage`), three layers:

1. **Agent, at source** — `_swap_proposed_action` clamps to `SLIPPAGE.absolute_ceiling_bps` (300).
2. **Wire schema** — `maxSlippageBps` is now `.max(300)`, so an out-of-range value cannot be
   *represented*, not merely clamped.
3. **Web, defensively** — `lib/swap/math.clampProposedSlippageBps`, a pure leaf function (hence
   node:test-able), applied before the value can reach `amountOutMinimum`.

Layer 1 is required *because of* layer 2: a rejecting schema means an over-range emission would fail
validation and drop a legitimate block, so the agent must never produce one. `undefined` passes through
so the card falls back to its own 50 bps preset — a missing value must never become a permissive one.
**8 regression tests** (5 web, 3 agent), including that the clamped worst case still floors `minOut` at
97% of quote where the unclamped case floored it at 1%.

### M2 · Idempotency cache key unscoped → **FIXED** (2026-07-30, feature 023)

**Finding.** The cache was keyed on the **raw** `Idempotency-Key` alone — a client-supplied value with
no tenant component — so a key collision across wallets could serve one caller's cached `IntentBundle`
to another. (Auth still ran first; the *cache key* was the unscoped part.) Flagged as recovered and
unverified at R1.

**Fixed in 023** (PR #114, merged `cdd22a7`). The key is now the composite
`(account, chain_id, method, path, key)`, and the store is Postgres-backed (migration `0027`) so
replay protection survives a restart and spans workers; first-write-wins moved from an in-process lock
to a DB `UNIQUE` constraint. `chain_id` was added after OH Defender's review pointed out that a built
bundle is chain-specific. Fails **open** (N2) with a distinct `idempotency_table_missing` warning.
11 tests.

### M3 · S2S / `X-Owner` trust model → **OPEN**

**Finding.** The agent sits on a public FQDN behind a **single shared static bearer** as the only
boundary. It trusts `X-Owner` **format-only** — there is no cryptographic binding between the token and
the owner it asserts — and the beta gate is enforced only at the BFF. An S2S-token leak therefore means
admin takeover plus cross-user PII / portfolio / chat access.

Rated medium, not high, because it **needs a leaked secret**, the comparison is constant-time, and it
is **non-custodial**: the custody spine is header- and LLM-independent, so a forged header cannot move
funds.

**Recommended fix (unimplemented):** a signed, short-lived owner assertion the agent verifies itself;
network-isolate the agent (mTLS or a private network — dropping the public FQDN is already a documented
follow-up in `DEPLOYMENT.md`); per-token rate limiting; and enforce the beta gate agent-side, not only
at the BFF.

**Note:** 023 *deepened the reliance* on this boundary — the idempotency scope now uses `X-Account` as
a tenant key. That does not weaken M3 (a forged header could already scope reads), but it means M3 is
now load-bearing for cache isolation too. **This is the single highest-value item for R2.**

---

## Lows — swept and statused 2026-07-30

Each row was **verified against current code**, not inferred from the changelog.

| # | Finding | Status (verified 2026-07-30) |
|---|---|---|
| L1 | SIWE nonce not server-side single-use ⇒ a captured signed message is replayable within its expiry | **OPEN.** The nonce is issued into an httpOnly cookie and `/verify` clears it — exactly the cookie-clearing-only defence R1 adjudicated as insufficient (an attacker sets their own cookie). No server-side nonce store exists. |
| L2 | 7-day stateless session freezes the beta/admin role ⇒ removal/kill-switch ineffective for up to 7d | **CLOSED on the security-critical path.** `api/allowlist.require_admin` does a **live DB `is_admin` check per request** (404, never 403), so an admin removal takes effect immediately on every `/admin/*` route. A stale role may linger in the web session for UI purposes — cosmetic, not authorisation. |
| L3 | `X-Chain-Id` client-controlled, not bound to the SIWE chain | **OPEN — and now part of M3.** 023 made the chain part of the idempotency scope, so a forged `X-Chain-Id` is a cache-partition input as well as a read scope. Fix with M3's signed assertion (bind owner **and** chain), not separately. |
| L4 | `Secure` flag omitted on http deploys | **NOT A DEFECT.** `isRequestSecure(req)` sets `secure` conditionally; on an `http://` slug the flag *cannot* be set. A consequence of http deploys, not a missing control — closes with TLS. |
| L5 | No per-wallet rate limit on `/chat` + `/recommendations`; LiteLLM vkey had no budget/rate cap | **CLOSED.** Feature 008's `require_within_quota` is attached to `/chat`, `/recommendations` and `/onboarding/turn`, and the virtual key carries rpm/tpm + a daily budget. |
| L6 | PII denylist misses seed phrases and bare-hex keys | **HALF FIXED, half deliberately deferred.** The bare (non-`0x`) 64-hex key pattern was **added** in this sweep. Mnemonic detection is **not** implemented, on purpose — see below. |
| L7 | Admin-content CTA allows a protocol-relative `//evil.com` open redirect | **FIXED in this sweep.** The validator accepted anything starting with `/`, which includes `//host` — a browser resolves that as external. Now rejected explicitly. |
| L8 | agent + litellm containers run as root; the agent ignored `uv.lock` | **OPEN, and worse than R1 described** — see the callout below. |

### L6 — why mnemonic detection is absent (a decision, not an oversight)

A structural pattern (12/24 lowercase words in a row) was written during this sweep and then
**rejected**: against the repo's own corpus it matched ordinary English —
*"move now flows through our normal safety pipeline the exact same way"* — because that is simply the
shape of twelve lowercase words.

This denylist is **fail-closed over `knowledge_notes` that admins author as prose**
(`api/admin_knowledge.py`), so a prose-matching pattern would reject legitimate notes and train people
to route around the guard — strictly worse than not having it. Proper detection needs the 2048-word
BIP-39 list (match on ≥N members), a vendored asset and a real design decision. A regression test now
pins the false-positive string, plus a test that every shipped corpus file passes the guard — that
corpus test is what caught this.

### ⚠️ L8 — the deployed image does not use `uv.lock` at all

R1 said the agent "ignores `uv.lock`". Verified 2026-07-30: **CI** pins correctly (`uv sync --frozen`),
but `services/agent/Dockerfile` builds the runtime image with bare package **names and no versions**
(`uv pip install --system fastapi "uvicorn[standard]" pydantic httpx anthropic asyncpg eth-abi`), and
`uv.lock` is never copied in. So the deployed agent's dependency set is whatever was latest at
image-build time and **can differ from the set CI tested** — a reproducibility and supply-chain gap,
not merely a pinning nit. There are also **zero `USER` directives**, so both containers run as root.

**Not fixed here, deliberately:** changing how the production image resolves dependencies alters the
deployed artifact, needs a rebuild, and the existing comment justifies the explicit list as keeping the
image slim — a rationale to weigh, not override in a sweep. **Proposed:**
`COPY pyproject.toml uv.lock ./` + `RUN uv sync --frozen --no-dev` + a non-root `USER`.

## Round-2 blind spots (R1's own critic — the cross-layer seams the layer-split under-covered)

**This list is the seed for R2.** It is the part of R1 whose loss would have been most costly.

1. **sim-then-sign / propose→execute freshness TOCTOU.** *(023 addressed one half: bundle expiry is now
   enforced server-side on the session-key submit branch. The wallet path is deliberately unchanged —
   see FR-023-012. Re-attack the whole seam.)*
2. **Cross-language policy parity** — Python agent vs TS web, especially 46630's empty allowlist
   failing closed on *both* sides. *(A CI parity gate exists; attack it rather than trust it.)*
3. **Second-order / stored prompt injection** — persisted `conversation_turns` replayed into
   `run_chat`, and admin/Obsidian content flowing into RAG.
4. **Persona-as-trusted-system-prompt tampering.**
5. `/api/subscribe` + `/api/version` (email-header injection, no rate limit) — outside the custody path.
6. **Secret rotation / revocation immediacy.**

## Confirmed solid at R1 (hardening that held)

N1/N2/N5 custody invariants + an 83-attack refuter swarm; session-key scope (recipient pin,
approve/transfer rejected by construction, monotonic spend, `validUntil == 0` rejected, immediate
revoke, no batch smuggling, no cross-chain replay); S2S constant-time + fail-closed; every `/admin`
route behind `Depends(require_admin)` returning **404 not 403** with a live DB re-check per request; the
BFF strips client identity, allowlists methods, forwards no Auth/Cookie; no SQLi/SSRF/path-traversal;
conversation isolation by `eoa_address`; the T126 knowledge↛policy boundary holds at runtime;
OpenRouter/master keys confined to the gateway and never logged; no secrets committed; SHA-pinned
actions; non-broadcast `deploy-testnet` with mainnet denied; the pnpm@9 override trap avoided; `/exit`
backend-independent; admin content rendered as escaped React children; the manual swap path pins the
recipient, uses an exact-amount approve, and offers preset-only slippage.
