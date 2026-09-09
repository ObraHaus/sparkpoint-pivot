# Session-key endpoints — request/response (022; agent-service-api §3.9)

All three are S2S-authed + scoped by `X-Account` / `X-Owner` / `X-Chain-Id` (the standard middleware).
**Non-custody:** the service builds **unsigned** txs only — it never signs and never holds a session
key (N1/N3). The owner signs the grant/revoke in their own wallet. `POST /session-keys/revoke/build`
is a **sacred exit**: always buildable, never gated (N2).

## POST /session-keys/grant/build
Validate a `SessionScope` (§6 grammar) and build the unsigned owner `authorizeSessionKey` tx.

**Request**
```jsonc
{
  "sessionPubkey": "0x…",            // PUBLIC key (client-generated; service never sees the private key)
  "validUntil":   1800000000,        // unix seconds — HARD expiry (required, ≤ 30d out)
  "validAfter":   0,                 // unix seconds (0 = now)
  "perTxCap":     500000000,         // USDC base units (≤ 500 USDC ceiling)
  "cumulativeCap": 5000000000,       // (≤ 5,000 USDC ceiling)
  "maxSlippageBps": 0,               // ∈ [50, 300] when a swap is in scope; else n/a
  "allowlist": [{ "target": "0x…", "selector": "0x6e553f65" }]   // ⊆ the global §3 allowlist
}
```
**Response 200** — approved:
```jsonc
{ "ok": true, "policyVersion": "policy@2026.06.0", "reasons": ["OK"],
  "scopeEcho": { "sessionKey": "0x…", "validAfter": 0, "validUntil": 1800000000,
                 "perTxCap": "500000000", "cumulativeCap": "5000000000", "maxSlippageBps": 0,
                 "allowlist": [...], "recipientPin": "user_account", "revocable": true, "spent": "0" },
  "tx": { "to": "<smart account>", "data": "0xbc3cabbb…", "value": "0x0", "chainId": 84532 } }
```
**Response 200** — rejected (out of §6 grammar): `{ "ok": false, "reasons": ["CAP_PER_TX_EXCEEDED"],
"scopeEcho": null, "tx": null }`. NO signable tx is produced for an out-of-policy grant (fail-closed).

## POST /session-keys/revoke/build
**Request** `{ "sessionPubkey": "0x…" }` → **200** `{ "tx": { "to": "<smart account>",
"data": "0x84f4fc6a…", "value": "0x0", "chainId": 84532 } }`. Always returns a tx (sacred exit).

## GET /session-keys
**200** `{ "account": "0x…", "sessionKeys": [ { "sessionKey", "status", "allowlist",
"perTxCap", "cumulativeCap", "spent", "maxSlippageBps", "validUntil", "validAfter",
"registeredTxHash", "revokedTxHash" } ] }`. `status` is chain-truth-derived
(active/expired/exhausted/revoked). Reads the on-chain-mirror store; fail-open to `[]`.

## Automated-move submission path (extends the 019 spine — remaining increment)
`POST /build-tx` with `execMode: "session_key"` → an unsigned session-key `PackedUserOperation`
(`signature: null`) + `exec_mode='session_key'`, `is_session_key_path=true`. A CLIENT session-signer
signs it; `POST /submit-signed-tx` with `opType: "userop"` submits it via the bundler client
(`execution/bundler.py` → Alchemy Rundler `eth_sendUserOperation`) and records
`signing_mode='session_key'` + `userop_hash`; `GET /submit-signed-tx/{id}` resolves the userOp receipt.
The mechanism is **proven live** (feature 022, tx `0x1d1fad64…`); wiring the builder + the client
session-signer is the remaining increment (the service must never hold the session key, N3).
