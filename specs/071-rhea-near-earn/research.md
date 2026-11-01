# Research — Rhea Finance (Burrow) on NEAR via 1Click (verified 2026-11-01)

All facts below come from live **read-only** calls: NEAR mainnet JSON-RPC `query`/`call_function`
VIEW calls on `multica.near` and `contract.main.burrow.near` (via
`https://free.rpc.fastnear.com`), and 1Click `POST /v0/quote` with `"dry": true`. No key, JWT,
signature or env value is printed; no transaction was signed or sent. The Rhea SDK at
`/home/aldrickb/tmp-071/rhea-sdk` was read for the wire shapes only (its embedded
`LSD_INTENTS_QUOTE_AUTHORIZATION` was never used or copied).

## 1. Route: an ordinary 1Click quote with a Rhea business message

Origin Base USDC `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`,
destination NEAR native USDC
`nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 dp),
`recipientType: DESTINATION_CHAIN`, `refundType: ORIGIN_CHAIN`, plus `customRecipientMsg`
(a JSON **string**).

| case | recipient | `customRecipientMsg` | dry result |
|---|---|---|---|
| existing MCA | the MCA account id | `{"w":[{"EVM":"<addr no 0x>"}],"b":{"r":"BurrowSupply"}}` | accepted |
| first deposit | `multica.near` | `{"w":[...],"b":{"r":"BurrowRegisterAndSupply"},"s":["<personal_sign hex no 0x>"]}` | accepted |
| collateral variant | — | `"b":{"r":"BurrowCollateral"}` | not used (supply only) |

`w` is a one-element wallet array; the EVM address is **without** `0x` and keeps its **original
case**. The signature is the off-chain `personal_sign` of
`JSON.stringify([{"EVM":"<addr without 0x>"}])` — one signature, no gas, no chain switch, no NEAR
wallet. For dry previews a placeholder signature is accepted; the real signature is Phase C.

### Dry quotes observed (2026-11-01 ~11:53 PHT)

| route | amountOut | ETA |
|---|---|---|
| Base USDC 100 → NEAR USDC, supply msg | `99.9808` | ~35 s |
| Base USDC 100 → NEAR USDC, register msg | `99.989431` (≈`99.9894`) | ~35 s |
| Base USDC 5000 → NEAR USDC | `4999.040045` | ~35 s |

The keyless 0.25% routing fee is included. A nonexistent MCA as recipient returns
`400 Internal server error`, so the preview uses `multica.near` until an MCA is known.

## 2. Multichain Account (MCA)

`multica.near` view `get_mca_by_wallet {"wallet":{"EVM":"<addr no 0x>"}}`:

- `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` → `null` (no MCA).
- A known MCA returns its account id string. `list_wallets_by_mca {"mca_id"}` lists bound wallets
  (SDK `getListWalletsByMca`).

One-off creation fee — `multica.near` view `get_create_mca_fee_paged {}`:

```json
{"usdt.tether-token.near":"300000",
 "eth.bridge.near":"100000000000000",
 "zec.omft.near":"30000",
 "wrap.near":"100000000000000000000000",
 "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near":"400",
 "nbtc.bridge.near":"400",
 "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1":"300000"}
```

For 6-dp USDC `300000` = **0.30 USDC**, charged once on the first (register) deposit and taken
from the deposited amount. The preview shows it as a separate one-off line and computes
`netSupplied = amountOut − fee`; it is omitted when an MCA exists. Read live with a TTL and a
config fallback (`mca_fee_fallback {USDC:"0.30"}`).

## 3. Burrow asset / APR / TVL

`contract.main.burrow.near` view `get_asset {"token_id":"17208628…133a1"}` (2026-11-01):

| field | value |
|---|---|
| `supply_apr` | `0.140459036159116681312316847` (fraction) |
| `borrow_apr` | `0.210371458131239129376850672` |
| `config.extra_decimals` | `12` |
| `config.can_deposit` / `can_withdraw` / `can_use_as_collateral` | `true` / `true` / `true` |
| `supplied.balance` | `12733763455236751230092183` inner units |
| `borrowed.balance` | `11335962000985552412216748` inner units |
| `farms` | one `TokenNetBalance` farm with empty `rewards` (0 reward today) |

Inner units are `token decimals (6) + extra_decimals (12) = 18`, so the supplied balance is
**12,733,763.455236751230092183 USDC**. The registry row uses `supply_apr` as `net_apy` (quantized
to 4 fraction decimals → the wire's `netApy="14.05"`), and a stablecoin TVL estimate from the
supplied balance (USDC/USDT are pegged ~$1; other assets stay `null` rather than inventing a price).

The Rhea UI at `https://app.rhea.finance/lending` shows "USDC Native — Supply APY 14.05%, Borrow
APY 21.04%" (same numbers; the UI labels the contract's `supply_apr` as APY; base rate, excludes
farm rewards, variable, utilization ~89%). The preview displays "Supply APY 14.05% (Rhea,
variable)" and always carries a `source` object naming the contract/method/field.

## 4. Positions

`contract.main.burrow.near` view `get_account_all_positions {"account_id": mca}` returns
`{account_id, supplied:[{token_id, apr, balance, shares}], positions:{<shadow>:{collateral:[…],
borrowed:[…]}}, farms, …}` (`IAccountAllPositionsDetailed` in the SDK `index.d.ts`). Balances are
inner units (token dp + `extra_decimals` from `get_asset.config`). An unknown account returns
`null` (verified with `doesnotexist.near`), which the API renders as an honest empty state.

No MCA was found for the probe wallet, so the live non-empty shape was not exercised end-to-end;
the parsing follows the contract method + the SDK type and is covered by mocked tests.

## 5. Wallet / rail facts

- The beta web uses an EVM wallet only. The Rhea recipient is **derived** (MCA or
  `multica.near`); the signed-in EVM wallet identifies the user. Refund = the origin-chain address
  of the user (Base/Ethereum wallet for EVM origins; the configured dry-probe Solana address for a
  `sol:USDC` dry quote).
- Origins reuse the 068 route keys: `base:USDC` (primary), `eth:USDC`, `sol:USDC`; configurable in
  `earn.json`.
- Withdraw is a link-out to `https://app.rhea.finance/lending` ("withdraw on Rhea with the same
  wallet"). In-app withdraw is optional and pending the owner.

## 6. SDK reference (read-only)

`/home/aldrickb/tmp-071/rhea-sdk/README.md`:

- **Cross-chain Supply** — `format_wallet`, `getSupplyCustomRecipientMsg({useAsCollateral, w})`,
  `intentsQuotation({recipient, customRecipientMsg, …})`; `recipient` is the MCA or
  `rhea00000x.multica.near`.
- **Create MCA** — `serializationObj([w])` → `prepare_sign_message_evm` → wallet `signMessage` →
  `process_signature_evm` → `getCreateMcaCustomRecipientMsg({useAsCollateral, wallets,
  signedMessages})`; `getCreateMcaFeeData({asset, bufferMultiple})` returns
  `{amountRaw, amountReadable}`.
- **getMcaByWallet** (`{chain:"evm", identityKey}`), **getListWalletsByMca(mcaId)**,
  **getAccountAllPositions(accountId)**, **getCreateMcaFeePaged()**.
- The README's "LSD Intents" module embeds a hardcoded authorization; it is reference only and was
  **not** used. This feature calls 1Click directly with our own keyless client, never
  `api.rhea.finance`.

## Sources

- NEAR mainnet JSON-RPC VIEW calls (2026-11-01): `multica.near.get_mca_by_wallet`,
  `multica.near.get_create_mca_fee_paged`, `contract.main.burrow.near.get_asset`,
  `contract.main.burrow.near.get_account_all_positions` (unknown account → `null`).
- 1Click `POST /v0/quote` (`dry:true`) with `customRecipientMsg`, 2026-11-01.
- Rhea UI reading `https://app.rhea.finance/lending` ("USDC Native — Supply APY 14.05%, Borrow APY
  21.04%").
- Rhea SDK README + `index.d.ts` (`IAccountAllPositionsDetailed`, `IPortfolioAssetOrigin`,
  `IPositionsOrigin`, `IWallet`), reference only.
- Repo: 069/070 research + `earn/registry.py` snapshot posture, `crosschain/routes.json`.

## Open questions for the owner

1. **First deposit signature:** confirm the exact `personal_sign` payload/format the web wallet
   should sign (`[{"EVM":"<addr no 0x>"}]`) and whether a signature should be cached per wallet.
2. **In-app withdraw:** keep the `app.rhea.finance/lending` link-out, or build the Rhea relayer
   withdraw business (requires signing and gas)?
3. **USDT / other Burrow markets:** enable by config now, or wait for a product decision? The
   `get_asset`/fee views already support them.
4. **TVL:** stablecoin TVL is a $1-peg estimate; do we want a real price feed before showing it?
5. **Generic NEAR guidance copy:** the legacy guidance still says "NEAR yield isn't supported yet"
   for vague turns without an amount (e.g. "earn yield on Rhea"); explicit Rhea deposit/list/
   positions/withdraw turns are now answered. Update the copy in a follow-up?
