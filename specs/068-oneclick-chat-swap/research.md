# Research — 068 NEAR Intents 1Click (verified 2026-10-31; rechecked 2026-11-01)

**Base URL:** `https://1click.chaindefuser.com/v0/`
**Docs / behaviour observed:** live `GET /tokens` + `POST /quote` (`dry: true`) calls from the
agent environment. No key was set, so these were keyless quotes. No secret, env value or key was
printed.

## API facts

- `GET /tokens` → a list of
  `{assetId, decimals, blockchain, symbol, price, priceUpdatedAt, contractAddress}`.
- `POST /quote` body:
  ```json
  {
    "dry": true,
    "swapType": "EXACT_INPUT",
    "slippageTolerance": 100,
    "originAsset": "<assetId>",
    "depositType": "ORIGIN_CHAIN",
    "destinationAsset": "<assetId>",
    "amount": "<smallest units>",
    "refundTo": "<origin address>",
    "refundType": "ORIGIN_CHAIN",
    "recipient": "<destination address>",
    "recipientType": "DESTINATION_CHAIN",
    "deadline": "<ISO-8601, now + 30min>"
  }
  ```
  → `201 {quote: {amountIn, amountInFormatted, amountInUsd, amountOut, amountOutFormatted,
  amountOutUsd, minAmountOut, timeEstimate (s), depositAddress (only when dry=false), deadline,
  timeWhenInactive}, quoteRequest, signature, timestamp}`.
- `POST /deposit/submit` `{txHash, depositAddress}` — optional speed-up after the user broadcasts.
- `GET /status?depositAddress=…` → `{status: PENDING_DEPOSIT | KNOWN_DEPOSIT_TX | PROCESSING |
  SUCCESS | INCOMPLETE_DEPOSIT | REFUNDED | FAILED, swapDetails{...}}`.
- `400 {message}` examples: `Quoting for this pair is not available`, `No liquidity available`,
  `Temporary swap limits: minimum swap amount is $100`. These are ordinary quote answers.
- **Cloudflare:** the default Python UA is blocked. Every request sends
  `User-Agent: sparkpoint-agent/1.0`.
- **Auth:** `Authorization: Bearer $ONECLICK_API_KEY` is optional. Without a key 1Click adds a
  keyless routing fee (surfaced in the preview as “Includes 1Click's 0.25% keyless routing fee”).
  The key is never logged or exposed.
- **Recipient validation:** 1Click validates the recipient even for `dry=true`; the preview uses a
  format-valid placeholder and the confirm path collects the real destination address.

## Asset ids / decimals (verified from `GET /tokens`)

| key | blockchain | symbol | decimals | assetId |
|---|---|---|---|---|
| `base:USDC` | base | USDC | 6 | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` |
| `eth:USDC` | eth | USDC | 6 | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` |
| `eth:USDT` | eth | USDT | 6 | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near` |
| `hood:USDG` | hood | USDG | 6 | `nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near` |
| `btc:BTC` | btc | BTC | 8 | `nep141:btc.omft.near` |
| `sol:SOL` | sol | SOL | 9 | `nep141:sol.omft.near` |
| `near:wNEAR` | near | wNEAR | 24 | `nep141:wrap.near` |
| `tron:USDT` | tron | USDT | 6 | `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` |

Robinhood Chain is blockchain `hood`, EVM chain id **4663**. USDG is 6 dp there (matches the
on-chain read used by the web).

## Tron finding

- **2026-10-31 verification:** a Tron **payout** returned `400 {"message":"Quoting for this pair is
  not available"}`. The route is therefore present in `routes.json` but `enabled: false` with
  `unavailable_reason: "1Click is not quoting Tron payouts right now"`.
- **2026-11-01 recheck (dry, keyless):** with a format-valid Tron recipient, `eth:USDT → tron:USDT`
  returned a `201` quote. This does not change the shipped default: the route stays disabled until
  the client reviews the change (one JSON edit to enable). The chat answer for the Tron demo prompt
  is an `unavailable` card, never an error/500.

## Implications for the implementation

1. **Config, not code.** The route table ships as JSON (`CROSSCHAIN_ROUTES_PATH` overrides it), so
   Tron, a Kamino SOL vault or Rhea can be turned on/changed without a deploy of new code.
2. **No floats.** Amounts are `Decimal`/integer smallest-unit strings end-to-end; `minAmountOut`
   is formatted from base units with the destination decimals.
3. **Errors are answers.** `400` → `QuoteUnavailable` → `state="unavailable"`; only transport
   failures become a friendly text fallback in chat or `UPSTREAM_UNAVAILABLE` on HTTP.
4. **Non-custody.** A live quote returns a deposit address; the user sends the origin transaction
   from their own wallet. The row in `crosschain_quotes` records the quote (including 1Click's
   ed25519 signature) for audit and binds the address to its owner — nothing there can move funds.

## Open questions for the client

- **Tron:** the route quotes again with a valid recipient (2026-11-01). Enable it, or keep it
  paused until the client confirms their payout path?
- **Kamino / SOL vault and Rhea:** should these become destination assets when 1Click lists their
  asset ids? Config-only change.
- **Fee copy:** confirm “0.25% keyless routing fee” matches what the client wants shown (1Click
  adds it only when no API key is configured).
- **Recipient collection:** Phase 2 decides whether the chat confirm collects a destination address
  once and remembers it per wallet, or links to a settings screen.
