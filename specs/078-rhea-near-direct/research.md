# Research — Rhea same-chain NEAR direct earn (2026-11-09)

All facts below come from **read-only** NEAR mainnet JSON-RPC views and public Burrow documentation.
No key, signature, approval, transfer, submit or broadcast was made. No value from
`/path/to/.claude/` was read, printed or copied.

## Scope: same-chain only (and what it is not)

- **Implemented by 078:** a same-chain rail where the user's own NEAR account supplies native USDC
  to Burrow (Rhea) and withdraws it, signing ordinary NEAR transactions in their wallet.
- **NOT implemented:** 071's cross-chain **MCA/1Click Phase C** rail. That path needs an EVM
  `personal_sign` (or SDK MCA message signing), a 1Click quote/deposit address, `customRecipientMsg`
  with `BurrowSupply` / `BurrowRegisterAndSupply`, and a live `dry=false` 1Click deposit. It remains
  **deferred**. This spec does not claim it is satisfied.

## Pinned authoritative IDs

| item | value |
|---|---|
| Burrow lending contract | `contract.main.burrow.near` |
| Native USDC (NEP-141) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| USDC `ft_metadata.decimals` | `6` (verified live) |
| Burrow `get_asset.config.extra_decimals` | `12` (verified live) ⇒ Burrow inner units = 18 dp |
| Burrow storage min | `100000000000000000000000` yocto = `0.1` NEAR |
| USDC storage min/max | `1250000000000000000000` yocto = `0.00125` NEAR |
| Burrow registration on USDC | already registered (`total = 0.00125 NEAR`, `available = 0`) |
| Probe account | `sparkpoint2026.near` — 1.5 NEAR, **0 USDC**, no Burrow storage, no position |
| `can_deposit` / `can_withdraw` | `true` / `true` |

Anything not in the allowlist above (for example `wrap.near`, `usdt.tether-token.near`, or any other
Burrow market) is refused by the builder. `wrap.near` is **not needed**: the asset is native USDC,
and gas/storage are paid in NEAR.

## Wire shapes (public docs + on-chain examples)

### Supply

Burrow has no separate `Deposit` action. A supply is an ordinary NEP-141 call with an optional
`msg`; the documented "simple deposit" uses an **empty msg**. On-chain examples of the
collateral variant show the same envelope:

```
ft_transfer_call(
  receiver_id = "contract.main.burrow.near",
  amount      = "<USDC 6-dp base units>",
  msg         = ""
)
```

- Attached deposit: exactly `1` yoctoNEAR (NEP-141 storage requirement).
- Gas: `100 Tgas` (on-chain examples use 100 Tgas).
- If the user has no Burrow storage record, prepend
  `contract.main.burrow.near::storage_deposit({})` with exactly the contract minimum (`0.1` NEAR).
- If the token receiver were unregistered, prepend
  `USDC::storage_deposit({account_id:"contract.main.burrow.near", registration_only:true})` with
  exactly `0.00125` NEAR. On mainnet today it is registered, so this action is not built.

The supply amount stays in **6-dp token units**; Burrow internally credits 18-dp inner units.

### Withdraw

```
contract.main.burrow.near::execute({
  "actions": [{
    "Withdraw": {
      "token_id": "<USDC>",
      "max_amount": "<inner units: 6 dp + extra_decimals 12 = 18 dp>"
    }
  }]
})
```

- Attached deposit: exactly `1` yoctoNEAR.
- Gas: `100 Tgas`.
- `max_amount` is in Burrow inner units: `amount6 × 10^12`.
- Refuse when the account has no supplied position, when `can_withdraw` is false, or when the
  requested amount exceeds the live supplied balance. No over-approval exists in this flow (there is
  no allowance/approve action at all).

## Wallet capability (075 → 078)

075 deliberately exposed only NEP-413 `signMessage`, and `noTransaction.test.ts` proves the login
path never reaches a transaction method. 078 adds a **separate** explicit capability:

- `NearWalletAdapter.sendTransactions(transactions, { expectedAccountId })`.
- Only the live earn confirm step calls it. Login/NEP-413 modules remain transaction-free (the
  source guard is split: login-path files vs. the single adapter boundary).
- Immediately before the wallet call, the adapter re-reads `getAccounts()` and refuses when the
  connected account differs from the reviewed account. The UI also re-checks and requires an
  explicit acknowledgement checkbox.
- No access key is added at sign-in; no allowance, approval, transfer or arbitrary contract call is
  possible through the UI.

## Safety model

- Contract/token allowlist is enforced inside `functionCall` and the preflight route.
- Amounts are exact: parse rejects over-precision; supply bounds `0.01 … 1,000,000` USDC; withdraw
  bounds `> 0 … 1,000,000` USDC and never above the live supplied balance.
- Attached deposits are exact (storage minima or 1 yocto); there is no user-entered deposit.
- Gas reserve: `0.02` NEAR plus any storage deposit; the plan refuses if the account cannot cover it.
- Reviewed plans expire after **60 seconds**; the UI must rebuild and re-review.
- Receipts are reported `confirmed` only when the RPC marks the execution final and successful;
  optimistic/unknown states stay `pending`, failures are shown as failures.

## Sources

- Rhea guide: same-chain NEAR users connect a NEAR wallet and sign Supply/Withdraw directly
  (`https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/step-by-step-guide`).
- Rhea contracts: `contract.main.burrow.near`, `multica.near`
  (`https://guide.rhea.finance/developers/contracts`).
- Burrow SDK (read-only reference for `execute` / `ft_transfer_call` shapes):
  `https://github.com/burrowHQ/burrow-sdk-python`.
- Burrow docs for `storage_deposit`, simple `ft_transfer_call` supply, `execute` withdraw:
  `https://github.com/NearDeFi/burrowland`.
- Live read-only views (2026-11-09): `ft_metadata`, `storage_balance_bounds`,
  `storage_balance_of`, `ft_balance_of`, `get_asset`, `get_account_all_positions`, `view_account`.

## Open funded-test gaps

- `sparkpoint2026.near` has **0 USDC**, no Burrow storage record and no position. The simulation
  therefore reports expected `insufficient_token_balance` / `no_position` refusals — these are
  **not** funded-path passes.
- A funded NEAR account is required to exercise a real supply (including the one-time Burrow
  storage deposit), then a withdraw, and to confirm the receipt polling end-to-end.
- Wallet availability (Meteor) and the exact wallet UI copy for a multi-transaction batch are only
  exercised with a real wallet; no automated funded test is attempted here.
