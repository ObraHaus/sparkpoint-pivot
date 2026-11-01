# Spec 068 — one-click cross-chain swaps in Sparky chat (NEAR Intents 1Click)

**Status:** backend implemented · frontend Phase 2 pending · **Owner:** build · **Branch:**
`feat/068-oneclick-chat-swap` · **Base:** `origin/develop`
**Branch worktree:** `~/project/sparkpoint-pivot-068`

## Problem

Sparky can read a portfolio, explain yield, and open the same-chain Uniswap swap card, but a
cross-chain request is answered with "bridging isn't available yet". The demo prompts the client
wants to show are:

- “Swap 5,000 USDC into native BTC.”
- “Move 10,000 USDC from Ethereum to Base.”
- “Turn 2,000 USDC into SOL on Solana.”
- “Swap 500 USDG to USDC on Base” (Robinhood Chain origin).
- “Pay my supplier 3,000 USDT on Tron.” — must be **parsed**, but answered honestly as
  “this route is not available right now”, never an error/500.

The flow is non-custodial: preview (dry quote) → confirm (live quote gives a 1Click deposit
address) → the user sends funds from their own wallet → live status. Sparky never signs and never
holds a key.

## Requirements

- **R1 — Deterministic chat route.** The parser runs before the LLM `understand()` call and before
  the fast read-only path, so the demo prompts work with zero model credits. It must not steal
  same-chain swaps (“swap 0.1 ETH to USDC”) from the existing Aerodrome/Uniswap flow; only a
  different 1Click chain or a non-EVM destination qualifies.
- **R2 — Preview card.** A preview is a dry quote rendered as a new `crosschain_quote` ChatBlock
  (`state="preview"`) preceded by a short factual `text` block. It carries origin/destination
  metadata, amount out (human), USD estimates, minimum out, ETA, slippage, quote time/expiry and a
  keyless-fee note when no API key is configured. It is NOT signable and carries no calldata.
- **R3 — Unavailable, not an error.** A disabled route (Tron today) and a `400` from 1Click
  (`Quoting for this pair is not available`, `No liquidity available`, minimum amount) produce a
  `crosschain_quote` with `state="unavailable"` and a plain-language reason. Transport failures
  produce a friendly `text` fallback — never a stack trace or 500.
- **R4 — Config-driven routes.** Asset ids, decimals, enabled flags, unavailable reasons, chain
  aliases, default origins, slippage and deadline live in a package JSON file overridable by
  `CROSSCHAIN_ROUTES_PATH`; `CROSSCHAIN_ENABLED` is the deployment flag. A client change (Tron,
  Kamino SOL vault, Rhea) is a config edit.
- **R5 — HTTP surface.** `GET /crosschain/assets`, `POST /crosschain/quote` (dry default),
  `POST /crosschain/deposit/submit`, `GET /crosschain/status`, behind the same S2S auth + account
  scoping + rate limiting as other write endpoints. A live quote validates the destination and
  refund address, persists the quote (owner, routes, amount, deposit address, deadline, full
  response incl. signature) in `crosschain_quotes`, and returns the deposit address. Submit/status
  only work for a deposit address the caller owns.
- **R6 — Tests + smoke.** Parser table tests, service tests with mocked 1Click, router tests
  (validation, ownership, dry default), a DAG test that the demo prompts emit the block without
  the LLM, and `scripts/oneclick_dry_smoke.py` which runs REAL dry quotes.
- **R7 — Spec-kit artifacts** in this directory. Frontend work (shared zod schema member, chat
  card, confirm/deposit/status UI) is Phase 2 and stays pending.

## Non-goals

- No signing, no custody, no on-chain transaction from the agent.
- No change to the deterministic policy gate, Defender config, CI secrets, model/billing config.
- No live 1Click call in tests; only `dry: true` is ever sent by the smoke script.
- No change to the existing same-chain swap card or bridge refusal when the parser does not match.

## Acceptance

1. The four demo prompts produce `[text, crosschain_quote]` from chat with no LLM call; the Tron
   prompt produces `state=unavailable` with a reason.
2. `POST /crosschain/quote` defaults to `dry=true`; `dry=false` requires a chain-valid recipient
   (and refund address), returns `depositAddress`, and persists exactly one owned row.
3. Unknown assets / non-positive / over-precision amounts return the canonical 400 envelope.
4. Submit/status return 404 for a deposit address the caller does not own.
5. Parser negatives (same-chain swaps, “what is bridging”, compact/decimal amounts) behave.
6. Full agent `pytest`, `ruff check`, `ruff format --check` and `mypy` pass.
7. The dry smoke prints route / HTTP / amountOut / ETA for the demo prompts.
