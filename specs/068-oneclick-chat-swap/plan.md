# Plan — 068 one-click cross-chain swaps in chat

**Base:** `origin/develop` · **Worktree:** `~/project/sparkpoint-pivot-068` (branch
`feat/068-oneclick-chat-swap`).

## Design

### 1. Config-driven route table (`crosschain/routes.json`, `crosschain/config.py`)

`routes.json` ships in the package and is loaded once. `CROSSCHAIN_ROUTES_PATH` overrides the file;
`CROSSCHAIN_ENABLED` overrides the JSON `feature_enabled` flag.

- Assets: `base:USDC`, `eth:USDC`, `eth:USDT`, `hood:USDG`, `btc:BTC`, `sol:SOL`, `near:wNEAR`,
  `tron:USDT` (enabled **false**, reason “1Click is not quoting Tron payouts right now”).
- Chain aliases (`ethereum`/`eth`/`mainnet` → `eth`, `robinhood`/`hood`/`robinhood chain` → `hood`,
  `bitcoin`/`btc`/`native btc` → `btc`, `solana`/`sol` → `sol`, `tron`, `near`).
- Default origins: `USDC→base:USDC`, `USDG→hood:USDG`, `USDT→eth:USDT`, `BTC→btc:BTC`,
  `SOL→sol:SOL`, `NEAR→near:wNEAR`.
- Defaults: 100 bps slippage, 30-minute deadline; 1Click base URL.

`CrossChainAsset` emits the `origin` / `destination` wire shapes so chat and HTTP share one source
of truth.

### 2. 1Click client (`crosschain/oneclick.py`)

Async `httpx` client with a 15s timeout, mandatory `User-Agent: sparkpoint-agent/1.0`, optional
`Authorization: Bearer $ONECLICK_API_KEY` (never logged), cached `GET /tokens`, and
`quote` / `submit_deposit` / `status`.

- `400` → `QuoteUnavailable(message)` (an ordinary answer, not an outage).
- Transport / unusable body / 5xx → `CrossChainTransportError`.
- Non-quote 4xx → `OneClickRejected`.
- All money is decimal/integer strings; no floats. `QuoteResult.raw` keeps the signature for the
  persisted row.

### 3. Parser (`crosschain/parse.py`)

Narrow deterministic grammar: action verb + amount + source symbol + a destination chain (or a
destination token on a non-EVM chain). Handles commas and `k`/`m`; accepts `from <chain>`,
`into|to <token|chain> [on <chain>]`, `into native BTC`, and `pay … on Tron`.

It returns `None` unless the resolved origin and destination are on different 1Click chains (or the
destination is non-EVM). That keeps same-chain swaps and the existing bridge refusal intact.

### 4. Service (`crosschain/service.py`)

- `preview(request)` → dry quote → `CrossChainOutcome(text, CrossChainQuoteBlock)`.
- Disabled route → `state=unavailable` with no HTTP call.
- `QuoteUnavailable` → `state=unavailable`; transport errors propagate for the chat fallback.
- `live_quote(...)` → `dry=false`, requires a deposit address.
- `submit_deposit`, `status` delegate to the client.

### 5. ChatBlock + DAG hook

`CrossChainQuoteBlock` (`type="crosschain_quote"`) in `coordinator/chat_blocks.py`, camelCase wire
fields, no calldata/signature. The hook lives in `CoordinatorDag.run_chat` immediately after the
unsafe-request refusal and before `unsupported_swap_target`, the bridge guard, the fast read-only
path and `understand()`. Feature flag off / `crosschain is None` ⇒ fall through unchanged. The
service is injected (`CoordinatorDag.crosschain`) so tests never touch the network; production
wires `build_service_from_env()` in `api/chat.py`.

`crosschain_quote` is persisted with the turn (like other cards) so reopening a conversation
replays it; `text`/`error`/`tool_step` behaviour is unchanged.

### 6. HTTP router (`api/crosschain.py`, mounted in `api/main.py`)

- All routes depend on `get_account` (S2S + `X-Account`/`X-Owner`/`X-Chain-Id` from middleware).
- Quote/submit also use a per-wallet `SlidingWindowLimiter` (120/h) — advisory abuse control.
- `POST /quote` validates keys and amount precision; `dry=true` default; `dry=false` validates
  recipient/refund address by chain family, persists via `db/crosschain_quotes.py`.
- Submit/status query `(user_eoa, deposit_address)` so another wallet’s quote is a 404.
- A disabled route and a 1Click `400` both return 200 with `state="unavailable"`.

### 7. Persistence (`migrations/0044_crosschain_quotes.sql`)

Additive table: `user_eoa`, `origin_key`, `destination_key`, `amount_in`, `deposit_address`,
`deadline`, `quote_response JSONB`, `last_status`, `created_at`; unique deposit address and an
owner/created index. No key material. Update `MIGRATIONS.md`.

### 8. Tests

- `tests/crosschain/test_parse.py` — demo table + negatives + precision.
- `tests/crosschain/test_service.py` — dry preview, keyless fee note, API-key Bearer, Tron
  unavailable, 400 min amount, transport failure, live quote deposit address, tokens cache.
- `tests/crosschain/test_api_crosschain.py` — assets, dry default, unavailable, validation,
  live persist, ownership, rate limit.
- `tests/crosschain/test_chat_crosschain.py` — four demo prompts emit the block without the
  planner; Tron unavailable; transport text; old bridge/same-chain paths unchanged.
- `scripts/oneclick_dry_smoke.py` — real dry quotes (no key printed).

### 9. Phase 2 (pending)

Frontend: add `crosschain_quote` to the shared zod `ChatBlock` union, render the preview card, and
build confirm → deposit → status UI. No frontend files are changed in this backend half.
