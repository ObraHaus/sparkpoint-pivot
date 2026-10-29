# Plan 061 — A9 UX quick fixes

## Constitution check

- **N1/N3:** no key, signature, signing path or custody surface touched. Feedback is advisory
  telemetry; `/brokers/owned` remains a read-only gallery lookup.
- **N2:** `/exit`, `/trust` and withdraw are untouched. The new BFF deadline is on chat only.
- **III:** the vault poll and chat states say what is true (unavailable ≠ empty; rate limit says
  when it clears).
- **VII:** reuse existing seams — `useVault`, nav config, `chatErrorCopy`, `POST /chat/feedback`,
  seed prune, react-query. One additive migration (0043).

## Approach

### Web
1. **What's New** — `lib/whatsNew.ts` (pure selection by newest slug) + convert
   `WhatsNewModal` to a non-blocking `aside` panel. Seed prune + new 061 entry.
2. **Brokers** — send `X-Chain-Id` from the hook; agent marks `/brokers/owned` as an
   optional-account path and returns `{available:false, reason:"no-account"}` with 200.
3. **Recommendations** — gate `useRecommendationsView` on a ready mandate; map a NOT_FOUND to an
   empty list. `useStrategiesVisible` drives both primary navs.
4. **Vault polling** — `lib/chain/vaultPolling.ts`: 60s, visible-only, exponential backoff, stop
   after 5 failures. Every `useVault` read uses it.
5. **Mobile header/trust banner** — CSS collapse at phone width; `DisclaimerStrip` dismiss stored
   via `useLocalState`.
6. **Chat slow state/timeout/retry** — 8s reassurance copy in `lib/chat/thinking.ts`; BFF
   `withChatDeadline` emits a clean `error` block at 60s; existing `TurnError` Retry remains.
7. **Error copy** — `chatErrorCopy` adds reset time + what still works + `/changelog`.
8. **Thumbs** — `TurnFeedback` on a finished live turn; POSTs the existing feedback endpoint with
   `blockId` as the message id and optional reason.

### Agent
1. `OPTIONAL_ACCOUNT_PATHS` + middleware softening (auth still required).
2. `FeedbackRequest.reason`; `_PgFeedbackSink` over `ChatFeedbackStore`; migration
   `0043_chat_feedback.sql` (unique user+message, upsert).
3. Seed prune of the October mint-whitelist entry + 061 seed entry.

## Files

| File | Change |
|---|---|
| `apps/web/src/lib/whatsNew.ts` (+test) | Release selection logic. |
| `apps/web/src/components/shell/WhatsNewModal.tsx` | Non-blocking panel. |
| `apps/web/src/components/shell/DisclaimerStrip.tsx` | Persisted dismissal. |
| `apps/web/src/components/shell/{PrimaryNav,MobileTabBar}.tsx` | Conditional Strategies. |
| `apps/web/src/app/globals.css` | Phone header collapse. |
| `apps/web/src/lib/chain/{useVault.ts,vaultPolling.ts(+test),useIndexedBrokers.tsx,useBrokerEngine.ts}` | Polling + chain header. |
| `apps/web/src/lib/agent/{useAgent.ts,chatError.ts(+test)}` | Recommendation gating, nav visibility, error copy. |
| `apps/web/src/lib/chat/thinking.ts(+test)` | 8s slow-state copy. |
| `apps/web/src/app/api/agent/[...path]/route.ts` | 60s chat deadline. |
| `apps/web/src/components/screens/chat/live-blocks.tsx` | Thumbs on finished answers. |
| `apps/web/src/app/(app)/chat/page.tsx` | Wire feedback target. |
| `services/agent/src/sparkpoint_agent/api/{security.py,middleware.py,brokers.py,chat.py}` | Optional account, feedback persistence. |
| `services/agent/src/sparkpoint_agent/db/{chat_feedback.py,__init__.py}` | Store. |
| `services/agent/migrations/0043_chat_feedback.sql` | Table. |
| `services/agent/tests/...` | Broker 200, feedback reason/store, seed. |
| `apps/web/e2e/pw/f061-ux-quick-fixes.spec.ts` | E2E for a–h UI items. |
| `CHANGELOG.md`, `content_seed/whats-new.json`, `MIGRATIONS.md` | Living docs. |

## Risks / mitigations

- **Hiding nav could bury a page (N2).** Hide only on a positive empty result; keep it in ⌘K and
  deep-linkable.
- **BFF deadline cutting legitimate long answers.** 60s matches the agent's worst observed turn;
  on expiry the user gets an error + Retry, never a silent hang. Env-overridable.
- **Feedback write failing.** Fail-open sink with a once-per-process warning.
- **059 overlap.** Chat edits are additive (feedback props, a timeout wrapper) and do not touch the
  streaming reducer.

## Verification

- `services/agent`: `ruff check .`, `mypy src/sparkpoint_agent`, `pytest -q`.
- `apps/web`: `pnpm lint`, `pnpm typecheck:test`, `pnpm test`, `pnpm build`, the new Playwright
  spec (mocked agent; no beta calls).
- Migration: additive/idempotent; note in `MIGRATIONS.md`.
